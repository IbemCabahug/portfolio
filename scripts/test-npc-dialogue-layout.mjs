// scripts/test-npc-dialogue-layout.mjs
// Deterministic layout regression harness for NPC dialogue modals and standalone pages.
// Validates all matrix viewports, orientations, hit targets, scroll containment, and zero-JS fallbacks.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';

const DIST_CLIENT = path.resolve('dist/client');
const ASTRO_ASSETS = path.join(DIST_CLIENT, '_astro');

// 1. Build Health Gate
function verifyBuildHealth() {
  console.log('[Health Gate] Checking built CSS assets...');
  assert.ok(fs.existsSync(DIST_CLIENT), 'dist/client directory must exist');
  assert.ok(fs.existsSync(ASTRO_ASSETS), 'dist/client/_astro directory must exist');

  const files = fs.readdirSync(ASTRO_ASSETS);
  const cssFiles = files.filter((f) => f.endsWith('.css'));
  assert.ok(cssFiles.length > 0, `Expected at least one CSS bundle in _astro, found ${cssFiles.length}`);

  let totalBytes = 0;
  for (const f of cssFiles) {
    const size = fs.statSync(path.join(ASTRO_ASSETS, f)).size;
    assert.ok(size > 0, `CSS bundle ${f} must not be empty (was ${size} bytes)`);
    totalBytes += size;
  }
  console.log(`[Health Gate] Found ${cssFiles.length} CSS bundles (${totalBytes} total bytes). PASSED.`);
}

// 2. Viewport Matrix
const MODAL_VIEWPORTS = [
  // User-reported failure points
  { width: 768, height: 1024, name: 'iPad Mini portrait (768x1024)' },
  { width: 960, height: 1440, name: 'Surface Pro 10 portrait (960x1440)' },
  { width: 1032, height: 1376, name: 'iPad Pro 13 portrait (1032x1376)' },

  // Rotations of the above
  { width: 1024, height: 768, name: 'iPad Mini landscape (1024x768)' },
  { width: 1440, height: 960, name: 'Surface Pro 10 landscape (1440x960)' },
  { width: 1376, height: 1032, name: 'iPad Pro 13 landscape (1376x1032)' },

  // Other key matrix sizes
  { width: 601, height: 900, name: 'Tablet portrait lower boundary (601x900)' },
  { width: 820, height: 1180, name: 'iPad Air portrait (820x1180)' },
  { width: 1023, height: 1366, name: 'Just under desktop threshold portrait (1023x1366)' },
  { width: 1024, height: 1366, name: 'At desktop threshold portrait (1024x1366)' },
  { width: 768, height: 768, name: 'Square tablet (768x768)' },
  { width: 800, height: 800, name: 'Square tablet (800x800)' },
  { width: 800, height: 600, name: 'SVGA landscape (800x600)' },
  { width: 1000, height: 700, name: 'Intermediate landscape (1000x700)' },
  { width: 1200, height: 500, name: 'Short landscape threshold -1 (1200x500)' },
  { width: 1200, height: 501, name: 'Short landscape threshold boundary (1200x501)' },
  { width: 1200, height: 549, name: 'Short landscape threshold upper (1200x549)' },
  { width: 1200, height: 550, name: 'Desktop landscape threshold boundary (1200x550)' },
  { width: 844, height: 390, name: 'Short mobile landscape (844x390)' },
  { width: 568, height: 320, name: 'Short mobile landscape (568x320)' },
  { width: 375, height: 812, name: 'Mobile portrait (375x812)' },
  { width: 320, height: 568, name: 'Mobile portrait SE (320x568)' },
  { width: 600, height: 900, name: 'Mobile portrait boundary (600x900)' },
  { width: 1440, height: 900, name: 'Classic desktop (1440x900)' },
];

const NPCS = ['innkeeper', 'regular', 'archivist'];

async function runTests() {
  verifyBuildHealth();

  console.log('[Server] Starting distribution server...');
  const server = await createDistServer({ root: 'dist/client', port: 0, quiet: true });
  console.log(`[Server] Live at ${server.origin}`);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let totalAssertions = 0;

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: Matrix Viewport Validation on /tavern/ Modal Mode
    // -------------------------------------------------------------------------
    console.log('\n=== Test Suite 1: Matrix Viewport Validation on /tavern/ Modal Mode ===');

    for (const vp of MODAL_VIEWPORTS) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: vp.width, height: vp.height });
        await page.goto(`${server.origin}/tavern/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

        for (const npc of NPCS) {

        // Open modal - wait for trigger readiness (initTavernPage attaches aria-controls)
        await page.waitForFunction(
          (npcId, isNarrow) => {
            const trigger = document.querySelector(isNarrow ? `#narrow-${npcId}` : `#trigger-${npcId}`);
            return trigger && trigger.getAttribute('aria-controls') === `dialog-${npcId}`;
          },
          { timeout: 15000 },
          npc,
          vp.width <= 600
        );

        const opened = await page.evaluate((npcId, isNarrow) => {
          const trigger = document.querySelector(isNarrow ? `#narrow-${npcId}` : `#trigger-${npcId}`);
          if (trigger) {
            trigger.click();
            return true;
          }
          return false;
        }, npc, vp.width <= 600);

        assert.ok(opened, `[${vp.name}] Trigger for ${npc} was found and clicked`);
        totalAssertions++;

        // Wait for modal to become visible
        await page.waitForFunction(
          (npcId) => {
            const dialog = document.getElementById(`dialog-${npcId}`);
            return dialog && !dialog.hidden && getComputedStyle(dialog).display !== 'none';
          },
          { timeout: 3000 },
          npc
        );

        // Ensure portrait image is decoded if present and visible
        await page.evaluate(async (npcId) => {
          const img = document.querySelector(`#dialog-${npcId} .npc-dialogue-portrait`);
          if (img && getComputedStyle(img).display !== 'none' && !img.complete) {
            await img.decode().catch(() => {});
          }
        }, npc);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

        // Inspect layout geometry & hit tests
        const geo = await page.evaluate((npcId, vpH, vpW) => {
          const dialog = document.getElementById(`dialog-${npcId}`);
          if (!dialog || dialog.hidden) return { open: false };

          const dRect = dialog.getBoundingClientRect();
          const portrait = dialog.querySelector('.npc-dialogue-portrait');
          const stack = dialog.querySelector('.dialogue-stack');
          const band = dialog.querySelector('.dialogue-band');
          const tray = dialog.querySelector('.dialogue-replies-tray');
          const closeIconBtn = dialog.querySelector('.panel-close-icon-btn');
          const firstReply = dialog.querySelector('.reply-btn:not(.farewell-btn)');
          const allReplies = Array.from(dialog.querySelectorAll('.reply-btn'));
          const lastReply = allReplies[allReplies.length - 1];
          const prose = dialog.querySelector('.dialogue-prose');

          const pRect = portrait ? portrait.getBoundingClientRect() : null;
          const sRect = stack ? stack.getBoundingClientRect() : null;
          const bRect = band ? band.getBoundingClientRect() : null;
          const tRect = tray ? tray.getBoundingClientRect() : null;
          const cRect = closeIconBtn ? closeIconBtn.getBoundingClientRect() : null;
          const firstRRect = firstReply ? firstReply.getBoundingClientRect() : null;

          // Hit test close button
          let closeHit = false;
          if (cRect && cRect.width > 0 && cRect.height > 0) {
            const cx = cRect.left + cRect.width / 2;
            const cy = cRect.top + cRect.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            closeHit = closeIconBtn ? closeIconBtn.contains(hit) : false;
          }

          // Hit test first reply button
          let firstReplyHit = false;
          if (firstRRect && firstRRect.width > 0 && firstRRect.height > 0) {
            const rx = firstRRect.left + firstRRect.width / 2;
            const ry = firstRRect.top + firstRRect.height / 2;
            const hit = document.elementFromPoint(rx, ry);
            firstReplyHit = firstReply ? firstReply.contains(hit) : false;
          }

          // Reachability test for last reply via scrolling
          let lastReplyReachable = false;
          if (lastReply && tray) {
            lastReply.scrollIntoView({ block: 'nearest' });
            const lRect = lastReply.getBoundingClientRect();
            lastReplyReachable = lRect.top >= -2 && lRect.bottom <= vpH + 10;
          }

          let verticalGap = null;
          if (pRect && bRect && pRect.height > 0 && bRect.height > 0) {
            verticalGap = Math.round((bRect.top - pRect.bottom) * 10) / 10;
          }

          return {
            open: true,
            dialogRect: { top: dRect.top, left: dRect.left, right: dRect.right, bottom: dRect.bottom, width: dRect.width, height: dRect.height },
            portraitRect: pRect ? { width: pRect.width, height: pRect.height, top: pRect.top, bottom: pRect.bottom } : null,
            stackRect: sRect ? { width: sRect.width, height: sRect.height, top: sRect.top, bottom: sRect.bottom } : null,
            bandRect: bRect ? { width: bRect.width, height: bRect.height, top: bRect.top, bottom: bRect.bottom, textLen: prose ? prose.textContent.trim().length : 0 } : null,
            trayRect: tRect ? { width: tRect.width, height: tRect.height, top: tRect.top, bottom: tRect.bottom } : null,
            closeBtn: cRect ? { width: cRect.width, height: cRect.height, top: cRect.top, bottom: cRect.bottom, left: cRect.left, right: cRect.right, hit: closeHit } : null,
            firstReply: firstRRect ? { width: firstRRect.width, height: firstRRect.height, top: firstRRect.top, bottom: firstRRect.bottom, hit: firstReplyHit } : null,
            lastReplyReachable,
            verticalGap,
            repliesCount: allReplies.length,
            initialProse: prose ? prose.textContent.trim() : ''
          };
        }, npc, vp.height, vp.width);

        assert.ok(geo.open, `[${vp.name}] ${npc} dialogue must be open`);
        totalAssertions++;

        // Speech band assertions
        assert.ok(geo.bandRect && geo.bandRect.height > 0, `[${vp.name}] ${npc} speech band must have height > 0 (was ${geo.bandRect?.height})`);
        assert.ok(geo.bandRect.top >= -2, `[${vp.name}] ${npc} speech band top (${geo.bandRect.top}) must not overflow top`);
        assert.ok(geo.bandRect.bottom <= vp.height + 2, `[${vp.name}] ${npc} speech band bottom (${geo.bandRect.bottom}) must not overflow viewport (${vp.height})`);
        assert.ok(geo.bandRect.textLen > 0, `[${vp.name}] ${npc} speech band must contain readable text`);
        totalAssertions += 4;

        // Vertical gap assertion for tablet portrait connected staging (8-16px, target 12px)
        const isTabletPortrait = vp.width >= 601 && vp.height >= vp.width;
        if (isTabletPortrait) {
          assert.ok(geo.verticalGap !== null, `[${vp.name}] ${npc} must have vertical gap measured between portrait and dialogue`);
          assert.ok(
            geo.verticalGap >= 7 && geo.verticalGap <= 17,
            `[${vp.name}] ${npc} vertical gap between portrait bottom and dialogue band top must be 8-16px (was ${geo.verticalGap}px)`
          );
          totalAssertions += 2;
        }

        // Replies tray assertions
        assert.ok(geo.trayRect && geo.trayRect.height > 0, `[${vp.name}] ${npc} replies tray must have height > 0 (was ${geo.trayRect?.height})`);
        assert.ok(geo.trayRect.bottom <= vp.height + 5, `[${vp.name}] ${npc} replies tray bottom (${geo.trayRect.bottom}) must be within viewport (${vp.height})`);
        totalAssertions += 2;

        // Close button assertions
        assert.ok(geo.closeBtn, `[${vp.name}] ${npc} header close button must exist`);
        assert.ok(geo.closeBtn.width >= 44, `[${vp.name}] ${npc} close button width >= 44 (was ${geo.closeBtn.width})`);
        assert.ok(geo.closeBtn.height >= 44, `[${vp.name}] ${npc} close button height >= 44 (was ${geo.closeBtn.height})`);
        assert.ok(geo.closeBtn.hit, `[${vp.name}] ${npc} close button hit-test must succeed`);
        totalAssertions += 4;

        // Reply interaction assertions
        assert.ok(geo.repliesCount > 0, `[${vp.name}] ${npc} must have replies`);
        assert.ok(geo.firstReply && geo.firstReply.hit, `[${vp.name}] ${npc} first reply hit-test must succeed`);
        assert.ok(geo.lastReplyReachable, `[${vp.name}] ${npc} last reply must be reachable without overflow`);
        totalAssertions += 3;

        // Click first reply and assert prose updates
        await page.evaluate((npcId) => {
          const first = document.querySelector(`#dialog-${npcId} .reply-btn:not(.farewell-btn)`);
          if (first) first.click();
        }, npc);

        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

        const proseAfter = await page.evaluate((npcId) => {
          const prose = document.getElementById(`${npcId}-dialogue-prose`);
          return prose ? prose.textContent.trim() : '';
        }, npc);

        assert.ok(proseAfter.length > 0, `[${vp.name}] ${npc} prose after clicking reply must not be empty`);
        totalAssertions++;

        // Test Escape key closes modal and returns focus
        await page.keyboard.press('Escape');
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

        const isClosed = await page.evaluate((npcId) => {
          const dialog = document.getElementById(`dialog-${npcId}`);
          return !dialog || dialog.hidden || getComputedStyle(dialog).display === 'none';
        }, npc);

        assert.ok(isClosed, `[${vp.name}] ${npc} modal must be closed after pressing Escape`);
        totalAssertions++;
      }

      console.log(`  ✓ ${vp.name}: all 3 NPCs passed layout, hit-test, interaction, and Escape`);
      } finally {
        await page.close();
      }
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 2: Standalone Pages (/tavern/npc and /tavern/archivist)
    // -------------------------------------------------------------------------
    console.log('\n=== Test Suite 2: Standalone Pages Validation ===');

    const STANDALONE_PAGES = [
      { route: '/tavern/npc/', title: 'Tavern Regular', npcId: 'regular' },
      { route: '/tavern/archivist/', title: 'Hooded Archivist', npcId: 'archivist' },
    ];

    const STANDALONE_VIEWPORTS = [
      { width: 768, height: 1024, name: '768x1024 tablet portrait' },
      { width: 1024, height: 768, name: '1024x768 landscape' },
      { width: 375, height: 812, name: '375x812 mobile portrait' },
      { width: 1440, height: 900, name: '1440x900 desktop' },
    ];

    const suite2Page = await browser.newPage();
    try {
      for (const pageDef of STANDALONE_PAGES) {
        for (const vp of STANDALONE_VIEWPORTS) {
          await suite2Page.setViewport({ width: vp.width, height: vp.height });
          await suite2Page.goto(`${server.origin}${pageDef.route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await suite2Page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

          const pageGeo = await suite2Page.evaluate((npcId, vpH) => {
            const stack = document.querySelector('.dialogue-stack');
            const band = document.querySelector('.dialogue-band');
            const tray = document.querySelector('.dialogue-replies-tray');
            const prose = document.querySelector('.dialogue-prose');
            const firstReply = document.querySelector('.reply-btn:not(.farewell-btn)');

            const bRect = band ? band.getBoundingClientRect() : null;
            const tRect = tray ? tray.getBoundingClientRect() : null;
            const fRect = firstReply ? firstReply.getBoundingClientRect() : null;

            const scrollW = document.documentElement.scrollWidth;
            const clientW = window.innerWidth;

            return {
              hasBand: !!band,
              bandVisible: bRect ? bRect.height > 0 : false,
              hasTray: !!tray,
              trayVisible: tRect ? tRect.height > 0 : false,
              proseLen: prose ? prose.textContent.trim().length : 0,
              hasReply: !!firstReply,
              noHorizontalOverflow: scrollW <= clientW + 1,
              initialProse: prose ? prose.textContent.trim() : ''
            };
          }, pageDef.npcId, vp.height);

          assert.ok(pageGeo.hasBand && pageGeo.bandVisible, `[Standalone ${pageDef.title} ${vp.name}] Speech band must be visible`);
          assert.ok(pageGeo.hasTray && pageGeo.trayVisible, `[Standalone ${pageDef.title} ${vp.name}] Replies tray must be visible`);
          assert.ok(pageGeo.proseLen > 0, `[Standalone ${pageDef.title} ${vp.name}] Prose text must be present`);
          assert.ok(pageGeo.noHorizontalOverflow, `[Standalone ${pageDef.title} ${vp.name}] Page must not have horizontal overflow`);
          totalAssertions += 4;

          // Click first reply and assert text updates
          await suite2Page.evaluate(() => {
            const btn = document.querySelector('.reply-btn:not(.farewell-btn)');
            if (btn) btn.click();
          });
          await suite2Page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

          const updatedProse = await suite2Page.evaluate(() => {
            const prose = document.querySelector('.dialogue-prose');
            return prose ? prose.textContent.trim() : '';
          });
          assert.ok(updatedProse.length > 0, `[Standalone ${pageDef.title} ${vp.name}] Prose after click must not be empty`);
          totalAssertions++;
        }

        console.log(`  ✓ ${pageDef.title} standalone passed across all test viewports`);
      }
    } finally {
      await suite2Page.close();
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 3: Dynamic Resize Without Reload
    // -------------------------------------------------------------------------
    console.log('\n=== Test Suite 3: Dynamic Resize Without Reload ===');

    const suite3Page = await browser.newPage();
    try {
      // Start in tablet portrait (768x1024)
      await suite3Page.setViewport({ width: 768, height: 1024 });
      await suite3Page.goto(`${server.origin}/tavern/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await suite3Page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

      // Open Archivist - wait for trigger readiness
      await suite3Page.waitForFunction(() => {
        const trigger = document.getElementById('trigger-archivist');
        return trigger && trigger.getAttribute('aria-controls') === 'dialog-archivist';
      });
      await suite3Page.evaluate(() => document.getElementById('trigger-archivist')?.click());
      await suite3Page.waitForFunction(() => !document.getElementById('dialog-archivist')?.hidden);

      // Verify open in 768x1024
      let archGeo = await suite3Page.evaluate(() => {
        const d = document.getElementById('dialog-archivist');
        const b = d?.querySelector('.dialogue-band')?.getBoundingClientRect();
        const t = d?.querySelector('.dialogue-replies-tray')?.getBoundingClientRect();
        const c = d?.querySelector('.panel-close-icon-btn')?.getBoundingClientRect();
        return {
          open: !d?.hidden,
          bBottom: b?.bottom,
          tBottom: t?.bottom,
          cVisible: c && c.width >= 44 && c.height >= 44
        };
      });
      assert.ok(archGeo.open && archGeo.bBottom <= 1026 && archGeo.tBottom <= 1026 && archGeo.cVisible, 'Archivist must fit 768x1024');
      totalAssertions += 2;

      // Dynamically rotate to 1024x768 landscape WITHOUT reloading
      await suite3Page.setViewport({ width: 1024, height: 768 });
      await suite3Page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));

      archGeo = await suite3Page.evaluate(() => {
        const d = document.getElementById('dialog-archivist');
        const b = d?.querySelector('.dialogue-band')?.getBoundingClientRect();
        const t = d?.querySelector('.dialogue-replies-tray')?.getBoundingClientRect();
        const c = d?.querySelector('.panel-close-icon-btn')?.getBoundingClientRect();
        return {
          open: !d?.hidden,
          bBottom: b?.bottom,
          tBottom: t?.bottom,
          cVisible: c && c.width >= 44 && c.height >= 44
        };
      });
      assert.ok(archGeo.open, 'Modal must remain open during rotation to landscape');
      assert.ok(archGeo.bBottom <= 770, `Speech band bottom (${archGeo.bBottom}) must fit in 768px height`);
      assert.ok(archGeo.tBottom <= 770, `Replies tray bottom (${archGeo.tBottom}) must fit in 768px height`);
      assert.ok(archGeo.cVisible, 'Close button must remain visible and >= 44px');
      totalAssertions += 4;

      // Dynamically rotate back to 768x1024 portrait WITHOUT reloading
      await suite3Page.setViewport({ width: 768, height: 1024 });
      await suite3Page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));

      archGeo = await suite3Page.evaluate(() => {
        const d = document.getElementById('dialog-archivist');
        const b = d?.querySelector('.dialogue-band')?.getBoundingClientRect();
        const t = d?.querySelector('.dialogue-replies-tray')?.getBoundingClientRect();
        const c = d?.querySelector('.panel-close-icon-btn')?.getBoundingClientRect();
        return {
          open: !d?.hidden,
          bBottom: b?.bottom,
          tBottom: t?.bottom,
          cVisible: c && c.width >= 44 && c.height >= 44
        };
      });
      assert.ok(archGeo.open, 'Modal must remain open rotating back to portrait');
      assert.ok(archGeo.bBottom <= 1026, `Speech band bottom (${archGeo.bBottom}) must fit in 1024px height`);
      assert.ok(archGeo.tBottom <= 1026, `Replies tray bottom (${archGeo.tBottom}) must fit in 1024px height`);
      assert.ok(archGeo.cVisible, 'Close button must remain visible');
      totalAssertions += 4;

      // Press Escape to verify clean close after dynamic rotations
      await suite3Page.keyboard.press('Escape');
      await suite3Page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
      const closedAfterResize = await suite3Page.evaluate(() => document.getElementById('dialog-archivist')?.hidden);
      assert.ok(closedAfterResize, 'Modal must close cleanly via Escape after dynamic resize');
      totalAssertions++;
      console.log('  ✓ Dynamic resize between portrait and landscape preserved dialogue state, fit, and dismissal');
    } finally {
      await suite3Page.close();
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 4: Zero-JS Fallback Validation
    // -------------------------------------------------------------------------
    console.log('\n=== Test Suite 4: Zero-JS Fallback Validation ===');

    const noJsPage = await browser.newPage();
    await noJsPage.setJavaScriptEnabled(false);
    await noJsPage.setViewport({ width: 768, height: 1024 });

    // Test /tavern/npc/ with JS disabled
    await noJsPage.goto(`${server.origin}/tavern/npc/`, { waitUntil: 'domcontentloaded' });
    const regularFallback = await noJsPage.evaluate(() => {
      const fallback = document.getElementById('npc-fallback');
      const qaPairs = document.querySelectorAll('.qa-pair');
      return {
        exists: !!fallback,
        qaCount: qaPairs.length
      };
    });
    assert.ok(regularFallback.exists, 'No-JS fallback must exist on /tavern/npc/');
    assert.ok(regularFallback.qaCount > 0, `No-JS fallback on /tavern/npc/ must render QA pairs (found ${regularFallback.qaCount})`);
    totalAssertions += 2;

    // Test /tavern/archivist/ with JS disabled
    await noJsPage.goto(`${server.origin}/tavern/archivist/`, { waitUntil: 'domcontentloaded' });
    const archivistFallback = await noJsPage.evaluate(() => {
      const fallback = document.getElementById('npc-fallback');
      const branches = document.querySelectorAll('.archivist-branch-section');
      return {
        exists: !!fallback,
        branchCount: branches.length
      };
    });
    assert.ok(archivistFallback.exists, 'No-JS fallback must exist on /tavern/archivist/');
    assert.ok(archivistFallback.branchCount > 0, `No-JS fallback on /tavern/archivist/ must render branch sections (found ${archivistFallback.branchCount})`);
    totalAssertions += 2;

    await noJsPage.close();
    console.log('  ✓ Zero-JS fallback correctly displayed on both standalone NPC pages');

    console.log(`\n=======================================================`);
    console.log(`ALL NPC DIALOGUE REGRESSION TESTS PASSED (${totalAssertions} assertions verified)`);
    console.log(`=======================================================\n`);
  } finally {
    await browser.close();
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n❌ NPC Dialogue Test Suite Failed:', err);
  process.exit(1);
});
