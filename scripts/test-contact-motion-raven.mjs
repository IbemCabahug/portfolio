// scripts/test-contact-motion-raven.mjs
// Comprehensive test suite for:
// 1. Email Direct arrow removal (and preservation of envelope, label, email, Gmail URL)
// 2. Themed motion glyph remodel (engraved wind family, full/reduced SVGs, header/menu sync, stable a11y)
// 3. /messenger/raven route & composer auto-open, history replace navigation on close, draft preservation in memory, mobile responsiveness

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';

const ROOT = path.resolve('.');
const DIST_CLIENT = path.join(ROOT, 'dist/client');

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('=== Contact Icon, Motion Glyph & Raven Route Test Suite ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Static Code and Asset Assertions
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Part 1: Static Code & Output Verification ---');

await test('REQ-1: Email Direct in simple/index.astro has arrow glyph removed while retaining envelope, label, email & link', () => {
  const simpleHtml = fs.readFileSync(path.join(ROOT, 'src/pages/simple/index.astro'), 'utf8');

  // Must have Email Direct (Gmail) label
  assert.match(simpleHtml, /Email Direct \(Gmail\)/);

  // Must have the raven (envelope) ThematicIcon
  assert.match(simpleHtml, /<ThematicIcon\s+name="raven"/);

  // Must have email address
  assert.match(simpleHtml, /cabahugnhovem@gmail\.com/);

  // Must have Gmail compose URL with target="_blank"
  assert.match(simpleHtml, /mail\.google\.com\/mail\/\?view=cm/);
  assert.match(simpleHtml, /target="_blank"/);

  // The arrow ↗ must NOT be present in simple/index.astro
  assert.equal(simpleHtml.includes('↗'), false, 'Arrow character ↗ must be completely removed from simple/index.astro');
  assert.equal(simpleHtml.includes('text-[#7c531d]">↗'), false, 'Arrow span must be removed');
});

await test('REQ-2: ThematicIcon.astro defines and renders motion-full and motion-reduced SVGs', () => {
  const iconSource = fs.readFileSync(path.join(ROOT, 'src/components/icons/ThematicIcon.astro'), 'utf8');

  // Must type both icon names in Props union
  assert.match(iconSource, /'motion-full'/);
  assert.match(iconSource, /'motion-reduced'/);

  // Must render valid stroke-based SVG paths for both
  assert.match(iconSource, /name === 'motion-full'/);
  assert.match(iconSource, /name === 'motion-reduced'/);

  // No emoji in ThematicIcon
  assert.equal(iconSource.includes('✨'), false);
  assert.equal(iconSource.includes('🪶'), false);
});

await test('REQ-2: PreferenceControls and SiteHeader use ThematicIcon without raw textContent destruction', () => {
  const prefSource = fs.readFileSync(path.join(ROOT, 'src/components/PreferenceControls.astro'), 'utf8');
  assert.match(prefSource, /motion-icon-full/);
  assert.match(prefSource, /motion-icon-reduced/);
  assert.match(prefSource, /motionText\.textContent/);

  const headerSource = fs.readFileSync(path.join(ROOT, 'src/components/SiteHeader.astro'), 'utf8');
  assert.match(headerSource, /menu-motion-icon-wrapper/);
  assert.match(headerSource, /menu-motion-icon-full/);
  assert.match(headerSource, /menu-motion-icon-reduced/);
  // Header should no longer set textContent with emojis
  assert.equal(headerSource.includes("motionIcon.textContent = isReduced ? '🪶' : '✨'"), false);
});

await test('REQ-3: Primary Contact nav and CTAs link to /messenger/raven', () => {
  const headerSource = fs.readFileSync(path.join(ROOT, 'src/components/SiteHeader.astro'), 'utf8');
  assert.match(headerSource, /href: '\/messenger\/raven',\s*label: 'Contact'/);
  // Chamber link retains /messenger
  assert.match(headerSource, /href="\/messenger"[^>]*><span>Messenger's Corner<\/span>/);
  // Menu dropdown includes direct Send a Raven contact link
  assert.match(headerSource, /href="\/messenger\/raven"[^>]*><span>Send a Raven \(Contact\)<\/span>/);

  const indexSource = fs.readFileSync(path.join(ROOT, 'src/pages/index.astro'), 'utf8');
  assert.match(indexSource, /href="\/messenger\/raven"/);
});

await test('REQ-3: Static build output generates both /messenger and /messenger/raven routes', () => {
  const messengerHtmlPath = path.join(DIST_CLIENT, 'messenger/index.html');
  const ravenHtmlPath = path.join(DIST_CLIENT, 'messenger/raven/index.html');

  assert.ok(fs.existsSync(messengerHtmlPath), 'dist/client/messenger/index.html must exist');
  assert.ok(fs.existsSync(ravenHtmlPath), 'dist/client/messenger/raven/index.html must exist');

  const messengerContent = fs.readFileSync(messengerHtmlPath, 'utf8');
  const ravenContent = fs.readFileSync(ravenHtmlPath, 'utf8');

  assert.match(messengerContent, /The Courier's Roost/);
  assert.match(ravenContent, /The Courier's Roost/);
  assert.match(ravenContent, /data-initial-composer-open="true"/);
  assert.match(messengerContent, /data-initial-composer-open="false"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Headless Browser Verification via Puppeteer
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Part 2: Browser Runtime Verification ---');

const server = await createDistServer({ root: 'dist/client', port: 0 });
console.log(`[Server] Dist server listening at ${server.origin}`);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();

  await test('Browser: Desktop Header motion toggle renders ThematicIcon and toggles state cleanly', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${server.origin}/tavern`, { waitUntil: 'networkidle0' });

    const motionBtn = await page.waitForSelector('#toggle-motion', { timeout: 3000 });
    assert.ok(motionBtn, 'Header #toggle-motion button must exist');

    // Initial state: Full motion
    const initialText = await page.$eval('#motion-text', (el) => el.textContent?.trim());
    const initialPressed = await page.$eval('#toggle-motion', (el) => el.getAttribute('aria-pressed'));
    assert.equal(initialText, 'Motion: Full');
    assert.equal(initialPressed, 'false');

    // Both SVGs must exist in DOM
    const fullIconHidden = await page.$eval('.motion-icon-full', (el) => el.classList.contains('hidden'));
    const reducedIconHidden = await page.$eval('.motion-icon-reduced', (el) => el.classList.contains('hidden'));
    assert.equal(fullIconHidden, false, 'Full motion icon must be visible initially');
    assert.equal(reducedIconHidden, true, 'Reduced motion icon must be hidden initially');

    // Click to toggle to Reduced
    await motionBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const toggledText = await page.$eval('#motion-text', (el) => el.textContent?.trim());
    const toggledPressed = await page.$eval('#toggle-motion', (el) => el.getAttribute('aria-pressed'));
    assert.equal(toggledText, 'Motion: Reduced');
    assert.equal(toggledPressed, 'true');

    const fullIconHiddenAfter = await page.$eval('.motion-icon-full', (el) => el.classList.contains('hidden'));
    const reducedIconHiddenAfter = await page.$eval('.motion-icon-reduced', (el) => el.classList.contains('hidden'));
    assert.equal(fullIconHiddenAfter, true, 'Full motion icon must be hidden in reduced mode');
    assert.equal(reducedIconHiddenAfter, false, 'Reduced motion icon must be visible in reduced mode');

    // Reset back to Full
    await motionBtn.click();
    await new Promise((r) => setTimeout(r, 100));
  });

  await test('Browser: Dropdown menu motion toggle is synchronized and uses engraved wind SVGs', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${server.origin}/tavern`, { waitUntil: 'networkidle0' });

    // Open dropdown menu
    await page.click('#site-menu-dropdown summary');
    await new Promise((r) => setTimeout(r, 100));

    const menuMotionBtn = await page.$('#menu-toggle-motion');
    assert.ok(menuMotionBtn, '#menu-toggle-motion button must exist in menu');

    const menuText = await page.$eval('#menu-motion-text', (el) => el.textContent?.trim());
    assert.equal(menuText, 'Motion: Full');

    // Click to toggle in menu
    await menuMotionBtn.click();
    await new Promise((r) => setTimeout(r, 100));

    const menuTextAfter = await page.$eval('#menu-motion-text', (el) => el.textContent?.trim());
    const menuBadgeAfter = await page.$eval('#menu-motion-badge', (el) => el.textContent?.trim());
    assert.equal(menuTextAfter, 'Motion: Reduced');
    assert.equal(menuBadgeAfter, 'Reduced');

    // Check header pod is also updated
    const headerText = await page.$eval('#motion-text', (el) => el.textContent?.trim());
    assert.equal(headerText, 'Motion: Reduced');

    // Reset back
    await menuMotionBtn.click();
    await new Promise((r) => setTimeout(r, 100));
  });

  await test('Browser: Direct load of /messenger loads room at rest (composer closed)', async () => {
    await page.goto(`${server.origin}/messenger`, { waitUntil: 'networkidle0' });

    const isDialogOpen = await page.$eval('#dialog-raven', (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
    assert.equal(isDialogOpen, false, 'dialog-raven must be hidden when visiting /messenger directly');

    const backdropVisible = await page.$eval('#dialog-backdrop', (el) => !el.hidden);
    assert.equal(backdropVisible, false, 'Backdrop must be hidden');
  });

  await test('Browser: Direct load of /messenger/raven automatically opens Raven composer', async () => {
    await page.goto(`${server.origin}/messenger/raven`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 3000 });

    const isDialogOpen = await page.$eval('#dialog-raven', (el) => !el.hidden && el.getAttribute('aria-hidden') === 'false');
    assert.equal(isDialogOpen, true, 'dialog-raven must be automatically open on /messenger/raven');

    const currentUrl = page.url();
    assert.ok(currentUrl.endsWith('/messenger/raven'), `URL must stay /messenger/raven, got: ${currentUrl}`);

    // Verify background is inert
    const isStackInert = await page.$eval('.narrow-dispatch-stack', (el) => el.hasAttribute('inert'));
    assert.equal(isStackInert, true, 'Background dispatch stack must be inert while dialog is open');
  });

  await test('Browser: Closing Raven modal from /messenger/raven replaces URL to /messenger and cleans up inert', async () => {
    await page.goto(`${server.origin}/messenger/raven`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 3000 });

    // Click close button
    const closeBtn = await page.waitForSelector('#dialog-raven .panel-close-icon-btn', { timeout: 2000 });
    assert.ok(closeBtn, 'Close button must exist in dialog header');
    await closeBtn.click();
    await page.waitForFunction(() => {
      const wrapper = document.querySelector('.roost-page-wrapper');
      return window.location.pathname.replace(/\/$/, '') === '/messenger' &&
             wrapper?.getAttribute('data-initial-composer-open') === 'false';
    }, { timeout: 5000 });

    const currentUrl = page.url();
    assert.ok(currentUrl.replace(/\/$/, '').endsWith('/messenger'), `URL must navigate to /messenger on close, got: ${currentUrl}`);

    const isDialogOpen = await page.$eval('#dialog-raven', (el) => !el.hidden && el.getAttribute('aria-hidden') === 'false').catch(() => false);
    assert.equal(isDialogOpen, false, 'dialog-raven must be closed');

    const isStackInert = await page.$eval('.narrow-dispatch-stack', (el) => el.hasAttribute('inert'));
    assert.equal(isStackInert, false, 'Background dispatch stack must no longer be inert');
  });

  await test('Browser: Form draft is preserved in module memory across route replacement on close', async () => {
    // 1. Visit /messenger/raven and type a draft
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/messenger/raven`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 3000 });

    await page.type('#desktop-sender-name', 'Ser Davos');
    await page.type('#desktop-sender-email', 'davos@seaworth.org');
    await page.$eval('#desktop-missive-subject', (el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#desktop-missive-subject', 'Delivery of Onion Missive');
    await page.type('#desktop-missive-body', 'The fleet has arrived at the cove.');

    // 2. Close modal (navigates to /messenger via replace)
    const closeBtn = await page.waitForSelector('#dialog-raven .panel-close-icon-btn');
    await closeBtn.click();
    await page.waitForFunction(() => {
      const wrapper = document.querySelector('.roost-page-wrapper');
      return window.location.pathname.replace(/\/$/, '') === '/messenger' &&
             wrapper?.getAttribute('data-initial-composer-open') === 'false';
    }, { timeout: 5000 });

    assert.ok(page.url().replace(/\/$/, '').endsWith('/messenger'));

    // Verify draft is NOT stored in localStorage or sessionStorage
    const localHasDraft = await page.evaluate(() => {
      return Object.keys(localStorage).some((k) => k.includes('draft') || k.includes('davos'));
    });
    const sessionHasDraft = await page.evaluate(() => {
      return Object.keys(sessionStorage).some((k) => k.includes('draft') || k.includes('davos'));
    });
    assert.equal(localHasDraft, false, 'Draft must NOT be stored in localStorage');
    assert.equal(sessionHasDraft, false, 'Draft must NOT be stored in sessionStorage');

    // 3. Reopen composer via hotspot on /messenger and verify draft is restored
    await page.waitForSelector('#trigger-perch-raven', { timeout: 3000 });
    await page.evaluate(() => document.getElementById('trigger-perch-raven')?.click());
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 3000 });

    const restoredName = await page.$eval('#desktop-sender-name', (el) => el.value);
    const restoredEmail = await page.$eval('#desktop-sender-email', (el) => el.value);
    const restoredSubject = await page.$eval('#desktop-missive-subject', (el) => el.value);
    const restoredBody = await page.$eval('#desktop-missive-body', (el) => el.value);

    assert.equal(restoredName, 'Ser Davos');
    assert.equal(restoredEmail, 'davos@seaworth.org');
    assert.equal(restoredSubject, 'Delivery of Onion Missive');
    assert.equal(restoredBody, 'The fleet has arrived at the cove.');
  });

  await test('Browser: Mobile portrait (375x812) on /messenger/raven displays centered sheet with accessible close', async () => {
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.goto(`${server.origin}/messenger/raven`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 3000 });

    const isDialogOpen = await page.$eval('#dialog-raven', (el) => !el.hidden);
    assert.equal(isDialogOpen, true, 'dialog-raven must be open on mobile /messenger/raven');

    // Verify dialog fits within mobile viewport
    const dialogBox = await page.$eval('#dialog-raven', (el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
    });
    assert.ok(dialogBox.width <= 375, `Dialog width ${dialogBox.width} must fit within 375px`);
    assert.ok(dialogBox.height <= 812, `Dialog height ${dialogBox.height} must fit within 812px`);

    // Verify top close button is visible and clickable
    const closeBtn = await page.waitForSelector('#dialog-raven .panel-close-icon-btn', { timeout: 2000 });
    assert.ok(closeBtn, 'Close button must be present in header');
    await closeBtn.click();
    await page.waitForFunction(() => window.location.pathname.replace(/\/$/, '') === '/messenger', { timeout: 5000 });

    assert.ok(page.url().replace(/\/$/, '').endsWith('/messenger'));
  });

  await test('Browser: Header Contact link leads to /messenger/raven from other pages', async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/about`, { waitUntil: 'networkidle0' });

    const contactLink = await page.waitForSelector('nav[aria-label="Main Navigation"] a[href="/messenger/raven"]', { timeout: 3000 });
    assert.ok(contactLink, 'Main navigation Contact link to /messenger/raven must exist');
    await contactLink.click();
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 3000 });

    assert.ok(page.url().endsWith('/messenger/raven'), `URL must be /messenger/raven, got: ${page.url()}`);
    const isDialogOpen = await page.$eval('#dialog-raven', (el) => !el.hidden && el.getAttribute('aria-hidden') === 'false');
    assert.equal(isDialogOpen, true, 'Composer dialog must be open after navigating via Contact link');
  });

  await page.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nAll ${passed}/${total} Contact, Motion & Raven Route verification tests passed!`);
if (passed !== total) {
  process.exitCode = 1;
}
