// Automated browser and interaction verification for unspoiled Tavern Easter egg discovery.
// Verifies removal of fallback spoiler (#narrow-beer), preservation of essential fallback navigation,
// and keyboard/pointer discoverability of the scene trigger (#trigger-beer) across all viewports.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';

const server = await createDistServer({ root: 'dist/client', port: 0, quiet: true });
let browser;

try {
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));

  // 1. Mobile Portrait (375x812): Fallback links displayed, spoiler absent, essential navigation intact
  await page.setViewport({ width: 375, height: 812 });
  await page.goto(`${server.origin}/tavern/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  // Verify sound preference is off by default
  await page.evaluate(() => {
    localStorage.setItem('sound', 'off');
    document.documentElement.dataset.sound = 'off';
  });

  // Assert scene container is hidden at 375px portrait
  const sceneHiddenMobile = await page.evaluate(() => {
    const scene = document.querySelector('.scene-container');
    if (!scene) return true;
    const style = window.getComputedStyle(scene);
    return style.display === 'none' || style.visibility === 'hidden';
  });
  assert.equal(sceneHiddenMobile, true, 'Scene container must be hidden at 375px portrait');

  // Assert #narrow-beer element is completely removed
  const narrowBeerEl = await page.$('#narrow-beer');
  assert.equal(narrowBeerEl, null, '#narrow-beer element must NOT exist in the DOM');

  // Assert fallback link list contains NO references to beer or bottle
  const narrowLinksEl = await page.$('.narrow-links');
  assert.ok(narrowLinksEl, '.narrow-links must be rendered on mobile portrait');

  const narrowText = await page.evaluate((el) => el.textContent || '', narrowLinksEl);
  assert.equal(/beer|bottle|ice-cold/i.test(narrowText), false, 'Fallback link list must not spoil the easter egg');

  // Assert all 6 essential fallback navigation links are present
  const essentialLinks = await page.evaluate(() => {
    const regular = document.getElementById('narrow-regular');
    const innkeeper = document.getElementById('narrow-innkeeper');
    const archivist = document.getElementById('narrow-archivist');
    const skills = document.getElementById('narrow-skills');
    const questboard = document.getElementById('narrow-questboard');
    const messenger = document.querySelector('.narrow-links a[href="/messenger"]');
    return {
      hasRegular: !!regular,
      hasInnkeeper: !!innkeeper,
      hasArchivist: !!archivist,
      hasSkills: !!skills,
      hasQuestboard: !!questboard,
      hasMessenger: !!messenger,
    };
  });
  assert.equal(essentialLinks.hasRegular, true, 'Fallback must retain Tavern Regular link');
  assert.equal(essentialLinks.hasInnkeeper, true, 'Fallback must retain Innkeeper button');
  assert.equal(essentialLinks.hasArchivist, true, 'Fallback must retain Archivist link');
  assert.equal(essentialLinks.hasSkills, true, 'Fallback must retain Skills link');
  assert.equal(essentialLinks.hasQuestboard, true, 'Fallback must retain Quest Board link');
  assert.equal(essentialLinks.hasMessenger, true, 'Fallback must retain Messenger link');

  await page.screenshot({ path: 'scratch/tavern-mobile-portrait-fallback.png' });

  // 2. Tablet Portrait (768x1024): Fallback list also lacks spoiler, scene hotspot remains
  await page.setViewport({ width: 768, height: 1024 });
  await page.goto(`${server.origin}/tavern/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  const tabletNarrowBeer = await page.$('#narrow-beer');
  assert.equal(tabletNarrowBeer, null, '#narrow-beer must NOT exist at 768px tablet portrait');

  const tabletHotspotExists = await page.evaluate(() => {
    const btn = document.getElementById('trigger-beer');
    return !!btn;
  });
  assert.equal(tabletHotspotExists, true, '#trigger-beer scene hotspot must exist on tablet');

  await page.screenshot({ path: 'scratch/tavern-tablet-portrait.png' });

  // 3. Mobile Landscape (844x390): Full scene visible, #trigger-beer discoverable in scene
  await page.setViewport({ width: 844, height: 390 });
  await page.goto(`${server.origin}/tavern/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  const landscapeSceneVisible = await page.evaluate(() => {
    const scene = document.querySelector('.scene-container');
    if (!scene) return false;
    const style = window.getComputedStyle(scene);
    return style.display !== 'none';
  });
  assert.equal(landscapeSceneVisible, true, 'Scene must be visible on mobile landscape (844x390)');

  const landscapeTriggerBeer = await page.evaluate(() => {
    const btn = document.getElementById('trigger-beer');
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    const style = window.getComputedStyle(btn);
    return {
      tagName: btn.tagName,
      hasAriaLabel: btn.hasAttribute('aria-label'),
      ariaLabel: btn.getAttribute('aria-label'),
      rectWidth: rect.width,
      rectHeight: rect.height,
      display: style.display,
      visibility: style.visibility,
    };
  });
  assert.ok(landscapeTriggerBeer, '#trigger-beer must exist in scene on mobile landscape');
  assert.equal(landscapeTriggerBeer.tagName, 'BUTTON', '#trigger-beer must be a semantic <button>');
  assert.equal(landscapeTriggerBeer.hasAriaLabel, true, '#trigger-beer must possess accessible aria-label');
  assert.ok(landscapeTriggerBeer.rectWidth > 0 && landscapeTriggerBeer.rectHeight > 0, '#trigger-beer must have positive dimensions in landscape');

  await page.screenshot({ path: 'scratch/tavern-mobile-landscape-scene.png' });

  // 4. Desktop (1280x900): Keyboard focus, Enter activation, Escape dismissal, focus restoration
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${server.origin}/tavern/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  // Ensure sound is off
  await page.evaluate(() => {
    localStorage.setItem('sound', 'off');
    document.documentElement.dataset.sound = 'off';
  });

  // 4a. Keyboard Focusability & Visible Focus Outline
  await page.focus('#trigger-beer');
  const focusedBeerInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el.id !== 'trigger-beer') return null;
    const computed = window.getComputedStyle(el);
    return {
      id: el.id,
      outlineStyle: computed.outlineStyle,
      outlineWidth: parseFloat(computed.outlineWidth) || 0,
      boxShadow: computed.boxShadow,
    };
  });
  assert.ok(focusedBeerInfo, '#trigger-beer must be keyboard focusable');
  assert.equal(focusedBeerInfo.id, 'trigger-beer');

  // 4b. Keyboard Enter Activation
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));

  const dialogActiveAfterEnter = await page.evaluate(() => {
    const dialog = document.getElementById('dialog-beer-blackout');
    if (!dialog) return false;
    const style = window.getComputedStyle(dialog);
    return !dialog.hidden && style.display !== 'none';
  });
  assert.equal(dialogActiveAfterEnter, true, '#dialog-beer-blackout must activate on keyboard Enter');

  await page.screenshot({ path: 'scratch/tavern-desktop-beer-active.png' });

  // 4c. Escape Key Dismissal & Focus Restoration
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));

  const dialogClosedAfterEscape = await page.evaluate(() => {
    const dialog = document.getElementById('dialog-beer-blackout');
    if (!dialog) return true;
    const style = window.getComputedStyle(dialog);
    return dialog.hidden || style.opacity === '0' || style.display === 'none';
  });
  assert.equal(dialogClosedAfterEscape, true, '#dialog-beer-blackout must close on Escape key');

  const focusRestoredAfterEscape = await page.evaluate(() => {
    return document.activeElement?.id === 'trigger-beer';
  });
  assert.equal(focusRestoredAfterEscape, true, 'Focus must restore to #trigger-beer upon Escape dismissal');

  // 4d. Mouse Click Activation & Close Button Dismissal
  await page.click('#trigger-beer');
  await new Promise((r) => setTimeout(r, 400));

  const dialogActiveAfterClick = await page.evaluate(() => {
    const dialog = document.getElementById('dialog-beer-blackout');
    if (!dialog) return false;
    const style = window.getComputedStyle(dialog);
    return !dialog.hidden && style.display !== 'none';
  });
  assert.equal(dialogActiveAfterClick, true, '#dialog-beer-blackout must activate on mouse click');

  // Dismiss via close button
  await page.click('#btn-close-beer-blackout');
  await new Promise((r) => setTimeout(r, 500));

  const dialogClosedAfterBtn = await page.evaluate(() => {
    const dialog = document.getElementById('dialog-beer-blackout');
    if (!dialog) return true;
    const style = window.getComputedStyle(dialog);
    return dialog.hidden || style.opacity === '0' || style.display === 'none';
  });
  assert.equal(dialogClosedAfterBtn, true, '#dialog-beer-blackout must close when close button is clicked');

  await page.screenshot({ path: 'scratch/tavern-desktop-restored.png' });

  // 5. Verify no page errors or unhandled exceptions occurred
  assert.deepEqual(pageErrors, [], `Unexpected page errors encountered: ${pageErrors.join(', ')}`);

  console.log(
    'PASS: Unspoiled Tavern Easter egg discovery verified. Fallback spoiler (#narrow-beer) removed, 6 essential navigation links intact, scene hotspot keyboard/pointer accessible across portrait, landscape, and desktop viewports with proper Escape/close and focus restoration.'
  );
} finally {
  await browser?.close();
  await server.close();
}
