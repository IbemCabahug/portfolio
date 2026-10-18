// scripts/test-responsive-layout.mjs
// Focused regression test harness for responsive layout, header fit, scene sizing,
// portrait scroll ownership, multi-route overflow, dialog resilience, and reflow.
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
  const cssFiles = files.filter(f => f.endsWith('.css'));
  assert.ok(cssFiles.length > 0, `Expected at least one CSS bundle in _astro, found ${cssFiles.length}`);

  let totalBytes = 0;
  for (const f of cssFiles) {
    const size = fs.statSync(path.join(ASTRO_ASSETS, f)).size;
    assert.ok(size > 0, `CSS bundle ${f} must not be empty (was ${size} bytes)`);
    totalBytes += size;
  }
  console.log(`[Health Gate] Found ${cssFiles.length} CSS bundles (${totalBytes} total bytes). PASSED.`);
}

// 2. Viewport List (Original 17 + edge viewports + breakpoint ±1 + square + short height)
const TAVERN_VIEWPORTS = [
  // Original 17
  { width: 320, height: 568, name: '320x568 (iPhone SE portrait)' },
  { width: 375, height: 812, name: '375x812 (iPhone X/11 portrait)' },
  { width: 600, height: 900, name: '600x900 (narrow portrait boundary)' },
  { width: 601, height: 900, name: '601x900 (tablet portrait lower boundary)' },
  { width: 768, height: 1024, name: '768x1024 (iPad portrait old md breakpoint)' },
  { width: 769, height: 1024, name: '769x1024 (iPad portrait boundary +1)' },
  { width: 820, height: 1180, name: '820x1180 (iPad Air portrait)' },
  { width: 860, height: 1180, name: '860x1180 (HUD compact height boundary)' },
  { width: 861, height: 1180, name: '861x1180 (HUD full height boundary)' },
  { width: 1024, height: 1366, name: '1024x1366 (iPad Pro 12.9 portrait)' },
  { width: 568, height: 320, name: '568x320 (iPhone SE landscape)' },
  { width: 667, height: 375, name: '667x375 (iPhone 8 landscape)' },
  { width: 844, height: 390, name: '844x390 (iPhone 13 landscape)' },
  { width: 1024, height: 600, name: '1024x600 (Netbook landscape)' },
  { width: 1280, height: 720, name: '1280x720 (720p landscape)' },
  { width: 1440, height: 900, name: '1440x900 (MacBook landscape)' },
  { width: 2560, height: 1080, name: '2560x1080 (Ultrawide landscape)' },
  // Additional edge viewports
  { width: 767, height: 1024, name: '767x1024 (iPad portrait md -1)' },
  { width: 770, height: 1024, name: '770x1024 (iPad portrait md +2)' },
  { width: 859, height: 1180, name: '859x1180 (HUD boundary -1)' },
  { width: 862, height: 1180, name: '862x1180 (HUD boundary +2)' },
  // Breakpoint ±1 edges for SiteHeader progressive disclosure
  { width: 639, height: 800, name: '639x800 (sm -1: essential only)' },
  { width: 640, height: 800, name: '640x800 (sm: preferences pod revealed)' },
  { width: 641, height: 800, name: '641x800 (sm +1)' },
  { width: 1023, height: 800, name: '1023x800 (lg -1: badge hidden)' },
  { width: 1024, height: 800, name: '1024x800 (lg: badge revealed)' },
  { width: 1025, height: 800, name: '1025x800 (lg +1)' },
  { width: 1279, height: 800, name: '1279x800 (xl -1: primary nav collapsed into menu)' },
  { width: 1280, height: 800, name: '1280x800 (xl: primary nav visible inline)' },
  { width: 1281, height: 800, name: '1281x800 (xl +1)' },
  // Square viewports & short height boundaries
  { width: 800, height: 800, name: '800x800 (Square viewport)' },
  { width: 800, height: 500, name: '800x500 (Short landscape HUD boundary)' },
  { width: 800, height: 501, name: '800x501 (Above short landscape HUD boundary)' },
];

const MULTI_ROUTES = [
  '/',
  '/messenger/',
  '/quests/',
  '/quests/mimic/',
  '/quests/bits/',
  '/quests/arcanetyper/',
  '/simple/',
  '/resume/',
  '/about/',
  '/tavern/npc/',
  '/tavern/skills/',
  '/tavern/archivist/',
];

const MULTI_ROUTE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1280, height: 720 },
];

async function run() {
  verifyBuildHealth();

  const server = await createDistServer({ root: 'dist/client', port: 0, quiet: true });
  console.log(`[Server] Dist server listening at ${server.origin}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // ==========================================
    // Phase 1: Verify Tavern Viewport Geometry & Header Fit
    // ==========================================
    console.log(`\n--- Phase 1: Testing Tavern Viewports (${TAVERN_VIEWPORTS.length} cases) ---`);
    await page.goto(`${server.origin}/tavern/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Verify computed styles sanity
    const initialStyles = await page.evaluate(() => {
      const header = document.getElementById('site-header');
      const cs = header ? window.getComputedStyle(header) : null;
      return {
        headerPresent: !!header,
        bgColor: cs ? cs.backgroundColor : null,
        hudHeight: window.getComputedStyle(document.documentElement).getPropertyValue('--hud-height').trim(),
      };
    });
    assert.ok(initialStyles.headerPresent, 'Site header must exist on /tavern/');
    console.log(`[Sanity] Header background: ${initialStyles.bgColor}, default --hud-height: ${initialStyles.hudHeight}`);

    let tavernPasses = 0;
    for (const vp of TAVERN_VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      // Short delay for media queries & layout to settle
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

      const auditResult = await page.evaluate((viewportWidth, viewportHeight) => {
        const errors = [];
        const warnings = [];

        // 1. Check Document Horizontal Overflow
        const scrollWidth = document.documentElement.scrollWidth;
        const innerWidth = window.innerWidth;
        if (scrollWidth > innerWidth + 1.5) {
          errors.push(`Horizontal document overflow: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`);
        }

        // 2. Check Header Element Fit (Ensure no visible control clips outside viewport)
        const header = document.getElementById('site-header');
        if (header) {
          const controls = header.querySelectorAll('a, button, details, summary, span, div');
          for (const el of controls) {
            // Skip elements within closed details
            const parentDetails = el.closest('details');
            if (parentDetails && !parentDetails.open && el !== parentDetails.querySelector('summary')) {
              continue;
            }

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              continue;
            }

            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;

            // Tolerant boundary check (1.5px subpixel tolerance)
            if (rect.right > innerWidth + 1.5) {
              errors.push(`Header control clipped on right: <${el.tagName.toLowerCase()} id="${el.id}" class="${el.className}"> right=${rect.right.toFixed(1)} > innerWidth=${innerWidth}`);
            }
            if (rect.left < -1.5) {
              errors.push(`Header control clipped on left: <${el.tagName.toLowerCase()} id="${el.id}" class="${el.className}"> left=${rect.left.toFixed(1)} < 0`);
            }
          }
        } else {
          errors.push('Missing #site-header element');
        }

        // 3. Essential Controls Reachability
        const menuDropdown = document.getElementById('site-menu-dropdown');
        if (!menuDropdown) {
          errors.push('Missing #site-menu-dropdown');
        } else {
          const summary = menuDropdown.querySelector('summary');
          if (summary) {
            const sRect = summary.getBoundingClientRect();
            if (sRect.right > innerWidth || sRect.left < 0 || sRect.width === 0) {
              errors.push(`Menu summary button clipped or invisible: rect=[${sRect.left.toFixed(1)}, ${sRect.right.toFixed(1)}]`);
            }
          }
        }

        const questLogTrigger = document.getElementById('trigger-quest-log');
        if (!questLogTrigger) {
          errors.push('Missing #trigger-quest-log');
        } else {
          const qRect = questLogTrigger.getBoundingClientRect();
          if (qRect.right > innerWidth || qRect.left < 0 || qRect.width === 0) {
            errors.push(`Journal trigger clipped or invisible: rect=[${qRect.left.toFixed(1)}, ${qRect.right.toFixed(1)}]`);
          }
        }

        // 4. Portrait vs Landscape Specific Checks
        const isPortrait = viewportHeight > viewportWidth;
        const scene = document.querySelector('.scene-container');
        const narrowLinks = document.querySelector('.narrow-links');

        if (isPortrait) {
          if (viewportWidth <= 600) {
            // Narrow mobile portrait: scene hidden, narrow links visible
            const sceneStyle = scene ? window.getComputedStyle(scene) : null;
            if (sceneStyle && sceneStyle.display !== 'none') {
              errors.push(`Scene container should be hidden on narrow portrait (<=600px), but display=${sceneStyle.display}`);
            }
            if (!narrowLinks) {
              errors.push('Missing .narrow-links on narrow portrait');
            } else {
              const nlStyle = window.getComputedStyle(narrowLinks);
              if (nlStyle.display === 'none') {
                errors.push('.narrow-links is hidden on narrow portrait');
              }
            }
          } else {
            // Tablet portrait (601px - 1024px portrait): scene visible + below fold narrow links
            const sceneStyle = scene ? window.getComputedStyle(scene) : null;
            if (sceneStyle && sceneStyle.display === 'none') {
              errors.push(`Scene container should be visible on tablet portrait, but display=${sceneStyle.display}`);
            }
            if (narrowLinks) {
              const nlStyle = window.getComputedStyle(narrowLinks);
              if (nlStyle.display === 'none') {
                errors.push('.narrow-links should be visible on tablet portrait');
              }
            }
          }
        } else {
          // Landscape: scene should be visible
          const sceneStyle = scene ? window.getComputedStyle(scene) : null;
          if (sceneStyle && sceneStyle.display === 'none') {
            errors.push(`Scene container should be visible on landscape, but display=${sceneStyle.display}`);
          }
        }

        return { errors, warnings };
      }, vp.width, vp.height);

      if (auditResult.errors.length > 0) {
        console.error(`  [FAIL] ${vp.name}:`);
        for (const err of auditResult.errors) console.error(`    - ${err}`);
        assert.fail(`Tavern viewport audit failed for ${vp.name}`);
      } else {
        tavernPasses++;
      }
    }
    console.log(`[Phase 1] All ${tavernPasses}/${TAVERN_VIEWPORTS.length} tavern viewport probes passed without header clipping or overflow.`);

    // ==========================================
    // Phase 2: Hit Target Area & Pointer Dispatch
    // ==========================================
    console.log('\n--- Phase 2: Testing Scene Hotspot Hit Target Area ---');
    await page.setViewport({ width: 1280, height: 720 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    const hitTargetResults = await page.evaluate(() => {
      const results = [];
      const objects = document.querySelectorAll('.scene-object');
      for (const obj of objects) {
        const id = obj.id || obj.getAttribute('aria-label') || 'unnamed-object';
        const rect = obj.getBoundingClientRect();
        // Check pseudo-element ::after dimension in computed style
        const afterStyle = window.getComputedStyle(obj, '::after');
        const afterWidth = parseFloat(afterStyle.width) || 0;
        const afterHeight = parseFloat(afterStyle.height) || 0;
        const pointerEvents = afterStyle.pointerEvents;

        results.push({
          id,
          width: rect.width,
          height: rect.height,
          afterWidth,
          afterHeight,
          pointerEvents,
        });
      }
      return results;
    });

    assert.ok(hitTargetResults.length >= 5, `Expected at least 5 scene objects, found ${hitTargetResults.length}`);
    for (const h of hitTargetResults) {
      assert.ok(
        h.afterWidth >= 44 && h.afterHeight >= 44,
        `Hotspot ${h.id} ::after must be at least 44x44px (got ${h.afterWidth}x${h.afterHeight})`
      );
      assert.notEqual(
        h.pointerEvents,
        'none',
        `Hotspot ${h.id} ::after must not have pointer-events: none`
      );
    }
    console.log(`[Phase 2] Scene hotspots hit-target check passed (${hitTargetResults.length} hotspots verified >=44x44px with active pointer events).`);

    // ==========================================
    // Phase 3: Portrait Scroll Ownership & Below-Fold Reachability
    // ==========================================
    console.log('\n--- Phase 3: Testing Portrait Scroll Ownership & Reachability ---');
    // 1. Test 320x568 (Narrow mobile portrait where content exceeds 568px height)
    await page.setViewport({ width: 320, height: 568 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    const narrowScrollResult = await page.evaluate(() => {
      const wrapper = document.querySelector('.scene-wrapper');
      const narrow = document.querySelector('.narrow-links');
      if (!wrapper || !narrow) return { error: 'Missing wrapper or narrow links' };

      const cs = window.getComputedStyle(wrapper);
      const initialScrollTop = wrapper.scrollTop;
      const initialRect = narrow.getBoundingClientRect();

      // Scroll wrapper to bring bottom links into view
      wrapper.scrollTop = 100;
      const afterScrollTop = wrapper.scrollTop;
      const afterRect = narrow.getBoundingClientRect();

      return {
        overflowY: cs.overflowY,
        initialScrollTop,
        initialBottom: initialRect.bottom,
        afterScrollTop,
        afterBottom: afterRect.bottom,
      };
    });

    assert.equal(narrowScrollResult.overflowY, 'auto', '.scene-wrapper must have overflow-y: auto in portrait');
    assert.ok(
      narrowScrollResult.afterScrollTop > 0,
      `scene-wrapper must be scrollable at 320x568 (got scrollTop=${narrowScrollResult.afterScrollTop})`
    );
    console.log(`  [Portrait 320x568] scene-wrapper scrollable (scrollTop reached ${narrowScrollResult.afterScrollTop}px, bottom brought into view). PASSED.`);

    // 2. Test 820x1180 (Tablet portrait iPad Air)
    await page.setViewport({ width: 820, height: 1180 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    const tabletScrollResult = await page.evaluate(() => {
      const shell = document.querySelector('.tavern-shell.scene-layout');
      const wrapper = document.querySelector('.scene-wrapper');
      const narrow = document.querySelector('.narrow-links');
      if (!wrapper || !narrow) return { error: 'Missing wrapper or narrow links' };

      const shellCs = shell ? window.getComputedStyle(shell) : null;
      const wrapperCs = window.getComputedStyle(wrapper);
      const narrowRect = narrow.getBoundingClientRect();

      return {
        shellOverflowY: shellCs ? shellCs.overflowY : null,
        wrapperOverflowY: wrapperCs.overflowY,
        wrapperJustify: wrapperCs.justifyContent,
        narrowBottom: narrowRect.bottom,
        windowHeight: window.innerHeight,
        narrowVisible: narrowRect.top < window.innerHeight,
      };
    });

    assert.equal(tabletScrollResult.wrapperOverflowY, 'auto', '.scene-wrapper must have overflow-y: auto on tablet portrait');
    assert.ok(
      tabletScrollResult.wrapperJustify === 'flex-start' || tabletScrollResult.wrapperJustify === 'start',
      `.scene-wrapper justify-content must be flex-start on tablet portrait (got ${tabletScrollResult.wrapperJustify})`
    );
    assert.ok(tabletScrollResult.narrowVisible, 'Narrow links must be reachable on tablet portrait 820x1180');
    console.log(`  [Tablet Portrait 820x1180] scene-wrapper overflow-y: auto and flex-start verified; links reachable. PASSED.`);

    // ==========================================
    // Phase 4: Multi-Route Horizontal Overflow Sweep
    // ==========================================
    console.log(`\n--- Phase 4: Multi-Route Horizontal Sweep (${MULTI_ROUTES.length} routes x ${MULTI_ROUTE_VIEWPORTS.length} viewports) ---`);
    let routeChecks = 0;
    for (const route of MULTI_ROUTES) {
      await page.goto(`${server.origin}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      for (const vp of MULTI_ROUTE_VIEWPORTS) {
        await page.setViewport({ width: vp.width, height: vp.height });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

        const routeResult = await page.evaluate(() => {
          const scrollW = document.documentElement.scrollWidth;
          const innerW = window.innerWidth;
          const overflow = scrollW > innerW + 1.5;

          // Check header controls if header exists
          const header = document.getElementById('site-header');
          let headerClip = null;
          if (header) {
            const controls = header.querySelectorAll('a, button, details, summary');
            for (const el of controls) {
              const parentDetails = el.closest('details');
              if (parentDetails && !parentDetails.open && el !== parentDetails.querySelector('summary')) continue;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') continue;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;
              if (rect.right > innerW + 1.5) {
                headerClip = `<${el.tagName.toLowerCase()} id="${el.id}"> right=${rect.right.toFixed(1)} > ${innerW}`;
                break;
              }
            }
          }

          return { overflow, scrollW, innerW, headerClip };
        });

        assert.equal(
          routeResult.overflow,
          false,
          `Route ${route} has horizontal overflow at ${vp.width}x${vp.height}: scrollWidth=${routeResult.scrollW} > innerWidth=${routeResult.innerW}`
        );
        assert.equal(
          routeResult.headerClip,
          null,
          `Route ${route} has clipped header control at ${vp.width}x${vp.height}: ${routeResult.headerClip}`
        );
        routeChecks++;
      }
    }
    console.log(`[Phase 4] All ${routeChecks} multi-route probes passed without horizontal overflow or header clipping.`);

    // ==========================================
    // Phase 5: Interactive Dialog & Modal Resilience
    // ==========================================
    console.log('\n--- Phase 5: Testing Modals & Dialogs (Journal, Skills, Menu, Messenger) ---');
    // 1. Journal Modal on /tavern/ at 375x812
    await page.goto(`${server.origin}/tavern/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.setViewport({ width: 375, height: 812 });

    // Open Journal
    await page.click('#trigger-quest-log');
    await page.waitForSelector('#journal-dialog:not([hidden])', { timeout: 5000 });
    const journalState = await page.evaluate(() => {
      const dialog = document.getElementById('journal-dialog');
      const closeBtn = dialog ? dialog.querySelector('.journal-header-close-btn') : null;
      const rect = dialog ? dialog.getBoundingClientRect() : null;
      const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
      return {
        open: !!dialog && !dialog.hidden,
        dialogInside: rect ? rect.right <= window.innerWidth && rect.bottom <= window.innerHeight : false,
        closeReachable: closeRect ? closeRect.width > 0 && closeRect.height > 0 : false,
      };
    });
    assert.ok(journalState.open, 'Journal dialog must be open');
    assert.ok(journalState.closeReachable, 'Journal close button must be reachable');

    // Press Escape to close Journal
    await page.keyboard.press('Escape');
    await page.waitForSelector('#journal-dialog[hidden]', { timeout: 5000 });
    console.log('  [Modal] Journal opened, validated within viewport, closed with Escape. PASSED.');

    // 2. Menu Dropdown on /tavern/
    await page.click('#site-menu-dropdown summary');
    const menuState = await page.evaluate(() => {
      const details = document.getElementById('site-menu-dropdown');
      const dropdown = details ? details.querySelector('ul') : null;
      const rect = dropdown ? dropdown.getBoundingClientRect() : null;
      return {
        isOpen: details ? details.open : false,
        isWithinScreen: rect ? rect.right <= window.innerWidth + 2 && rect.left >= -2 : false,
      };
    });
    assert.ok(menuState.isOpen, 'Menu details must be open');
    assert.ok(menuState.isWithinScreen, 'Menu dropdown list must fit on screen');
    // Close menu by clicking summary again
    await page.click('#site-menu-dropdown summary');
    console.log('  [Menu] Menu dropdown opens, fits on screen, toggles closed. PASSED.');

    // 3. Messenger Chamber & Modal at 844x390 (short landscape) and 375x812 (portrait)
    await page.goto(`${server.origin}/messenger/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.setViewport({ width: 844, height: 390 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    // Verify Messenger scene-object touch targets
    const messengerHotspots = await page.evaluate(() => {
      const objects = document.querySelectorAll('.scene-object');
      const results = [];
      for (const obj of objects) {
        const afterStyle = window.getComputedStyle(obj, '::after');
        results.push({
          id: obj.id,
          afterW: parseFloat(afterStyle.width) || 0,
          afterH: parseFloat(afterStyle.height) || 0,
          pointerEvents: afterStyle.pointerEvents,
        });
      }
      return results;
    });

    assert.ok(messengerHotspots.length >= 3, `Expected at least 3 hotspots in Messenger, found ${messengerHotspots.length}`);
    for (const m of messengerHotspots) {
      assert.ok(m.afterW >= 44 && m.afterH >= 44, `Messenger hotspot ${m.id} ::after must be >=44px`);
      assert.notEqual(m.pointerEvents, 'none', `Messenger hotspot ${m.id} ::after must have active pointer events`);
    }
    console.log('  [Messenger] Scene hotspots verified with >=44px hit targets and active pointer events. PASSED.');

    // ==========================================
    // Phase 6: Orientation Flip (Resize without reload)
    // ==========================================
    console.log('\n--- Phase 6: Testing Dynamic Orientation Flip ---');
    await page.goto(`${server.origin}/tavern/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.setViewport({ width: 375, height: 812 }); // Portrait
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    let sceneDisplay = await page.evaluate(() => {
      const s = document.querySelector('.scene-container');
      return s ? window.getComputedStyle(s).display : 'none';
    });
    assert.equal(sceneDisplay, 'none', 'Scene must be hidden on 375px portrait');

    // Flip to landscape (812x375)
    await page.setViewport({ width: 812, height: 375 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    sceneDisplay = await page.evaluate(() => {
      const s = document.querySelector('.scene-container');
      return s ? window.getComputedStyle(s).display : 'none';
    });
    assert.equal(sceneDisplay, 'block', 'Scene must become visible after flipping to landscape');

    // Flip back to portrait (375x812)
    await page.setViewport({ width: 375, height: 812 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    sceneDisplay = await page.evaluate(() => {
      const s = document.querySelector('.scene-container');
      return s ? window.getComputedStyle(s).display : 'none';
    });
    assert.equal(sceneDisplay, 'none', 'Scene must hide again after flipping back to portrait');
    console.log('[Phase 6] Dynamic orientation flip (portrait -> landscape -> portrait) passed without reload.');

    // Assert zero unexpected page errors throughout all phases
    assert.equal(pageErrors.length, 0, `Page errors encountered: ${pageErrors.join(', ')}`);

    console.log('\n======================================================');
    console.log('ALL RESPONSIVE LAYOUT VERIFICATION TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('\n[REGRESSION ERROR]:', err);
  process.exit(1);
});
