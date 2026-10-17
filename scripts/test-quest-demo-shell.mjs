// Portfolio-only browser verification for the unified QuestDemoShell across ArcaneTyper, BITS, and Mimic.
// External documents are mocked; no external application or attendance API is contacted.
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
  const externalFrameRequests = [];
  let delayNextExternalRequest = false;

  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith(server.origin)) {
      return void request.continue();
    }
    if (request.isNavigationRequest()) {
      externalFrameRequests.push(request.url());
      if (delayNextExternalRequest) {
        delayNextExternalRequest = false;
        setTimeout(() => {
          request
            .respond({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><title>Delayed Mock</title><h1>Delayed Mock View</h1>',
            })
            .catch(() => {});
        }, 220);
        return;
      }
      return void request.respond({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Mock Demo</title><h1>Mock External View</h1><input id="state-input" value="initial">',
      });
    }
    void request.abort();
  });

  // 1. ArcaneTyper: Resting state, zero initial iframes, no tabs, 44px targets, honest copy
  await page.setViewport({ width: 1280, height: 800 });
  externalFrameRequests.length = 0;
  await page.goto(`${server.origin}/quests/arcanetyper/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForFunction(() => !!customElements.get('quest-demo-shell'));
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-quest-demo-shell] [data-launch]');
    return btn && getComputedStyle(btn).minHeight === '44px';
  });

  assert.equal(await page.$$eval('[data-quest-demo-shell] iframe', (els) => els.length), 0);
  assert.equal(externalFrameRequests.length, 0);
  assert.equal(await page.$$eval('[data-quest-demo-shell] [role="tablist"]', (els) => els.length), 0);
  assert.equal(
    await page.$eval('[data-quest-demo-shell] .shell-heading', (el) => el.textContent.trim()),
    'Live Demo — ArcaneTyper'
  );

  const shellText = await page.$eval('[data-quest-demo-shell]', (el) => el.textContent || '');
  assert.equal(/Zero tracking|Zero data exfiltration/i.test(shellText), false);

  const launchBtnHeight = await page.$eval(
    '[data-quest-demo-shell] [data-launch]',
    (el) => el.getBoundingClientRect().height
  );
  assert.equal(launchBtnHeight >= 44, true, `Expected >=44px launch button height, got ${launchBtnHeight}`);

  // 2. ArcaneTyper: Launch, fit-canvas scaling, portrait hint responsiveness, reload, fullscreen denial fallback, close
  await page.click('[data-quest-demo-shell] [data-launch]');
  await page.waitForSelector('[data-frame="game"] iframe');
  assert.equal(externalFrameRequests.length, 1);
  assert.equal(
    await page.evaluate(() => document.activeElement?.hasAttribute('data-close')),
    true,
    'Single-view launch should move focus to a shell control ([data-close]), not inside cross-origin iframe'
  );

  const canvasTransformDesktop = await page.$eval(
    '[data-frame="game"] iframe',
    (el) => el.style.transform
  );
  assert.match(canvasTransformDesktop, /translate\(-50%, -50%\) scale\(/);

  // Mobile portrait (375x812): portrait hint visible, no horizontal page overflow
  await page.setViewport({ width: 375, height: 812 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  assert.equal(
    await page.$eval('[data-active-portrait-hint]', (el) => !el.hidden),
    true,
    'Expected active portrait hint to be visible at 375x812'
  );
  assert.equal(
    await page.$eval('[data-quest-demo-shell]', (el) => el.getBoundingClientRect().width <= 375),
    true
  );

  // Narrow 320px width check
  await page.setViewport({ width: 320, height: 568 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  assert.equal(
    await page.$eval('[data-quest-demo-shell]', (el) => el.getBoundingClientRect().width <= 320),
    true
  );

  // Fullscreen denial fallback
  await page.evaluate(() => {
    const section = document.querySelector('[data-shell-section]');
    section.requestFullscreen = () => Promise.reject(new Error('Simulated fullscreen denial'));
  });
  await page.click('[data-quest-demo-shell] [data-fullscreen]');
  assert.match(
    await page.$eval('[data-quest-demo-shell] [data-announcement]', (el) => el.textContent || ''),
    /Fullscreen is unavailable/
  );

  // Close ArcaneTyper demo and verify cleanup + focus restoration
  await page.click('[data-quest-demo-shell] [data-close]');
  assert.equal(await page.$$eval('[data-quest-demo-shell] iframe', (els) => els.length), 0);
  assert.equal(
    await page.evaluate(() => document.activeElement?.hasAttribute('data-launch')),
    true
  );

  // 3. BITS: Shared shell consistency, reload isolation, slow-view timer, and arrow key isolation from global nav
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${server.origin}/quests/bits/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForFunction(() => !!customElements.get('bits-live-demo'));

  assert.equal(
    await page.$eval('bits-live-demo .shell-heading', (el) => el.textContent.trim()),
    'Live Demo — BITS'
  );
  await page.evaluate(() => {
    const host = document.querySelector('bits-live-demo');
    host.dataset.terminalUrl = 'https://terminal.example.test/';
    host.dataset.slowTimeoutMs = '75';
  });

  await page.click('bits-live-demo [data-launch]');
  await page.waitForSelector('[data-frame="dashboard"] iframe');

  // Arrow keys on tabs must NOT trigger global project navigation
  await page.focus('[data-view="dashboard"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(new URL(page.url()).pathname, '/quests/bits/');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-view')),
    'terminal'
  );
  assert.equal(
    await page.$eval('[data-view="terminal"]', (el) => el.getAttribute('aria-selected')),
    'false'
  );

  // Slow view threshold test on terminal activation
  delayNextExternalRequest = true;
  await page.keyboard.press('Space');
  await page.waitForSelector('[data-frame="terminal"] iframe');
  await new Promise((r) => setTimeout(r, 110));
  assert.match(
    await page.$eval('[data-status="terminal"]', (el) => el.textContent || ''),
    /taking longer than expected/
  );
  // Wait for delayed load to complete and clear slow status
  await page.waitForFunction(
    () => (document.querySelector('[data-status="terminal"]')?.textContent || '').includes('External view requested'),
    { timeout: 3000 }
  );

  // Reload isolation: reloading terminal must preserve the exact dashboard iframe element
  await page.evaluate(() => {
    window.__savedDashFrame = document.querySelector('[data-frame="dashboard"] iframe');
    window.__savedTermFrame = document.querySelector('[data-frame="terminal"] iframe');
  });
  await page.click('[data-retry="terminal"]');
  await page.waitForSelector('[data-frame="terminal"] iframe');
  const reloadIsolation = await page.evaluate(() => ({
    dashPreserved:
      window.__savedDashFrame === document.querySelector('[data-frame="dashboard"] iframe'),
    termReplaced:
      window.__savedTermFrame !== document.querySelector('[data-frame="terminal"] iframe'),
  }));
  assert.equal(reloadIsolation.dashPreserved, true, 'Sibling dashboard iframe must remain untouched on terminal reload');
  assert.equal(reloadIsolation.termReplaced, true, 'Reloaded terminal iframe must be replaced');

  // 4. Multi-instance fixture isolation on the same page
  const multiInstanceResult = await page.evaluate(() => {
    const first = document.querySelector('bits-live-demo');
    const clone = first.cloneNode(true);
    clone.dataset.instanceId = 'bits-second';
    // Reset clone to resting state before mounting
    clone.querySelector('[data-resting]').hidden = false;
    clone.querySelector('[data-active]').hidden = true;
    clone.querySelector('[data-active-controls]').hidden = true;
    clone.querySelectorAll('[data-frame]').forEach((s) => s.replaceChildren());
    document.body.appendChild(clone);

    clone.querySelector('[data-launch]').click();
    const bothActive =
      first.querySelectorAll('iframe').length === 2 &&
      clone.querySelectorAll('iframe').length === 1 &&
      document.body.dataset.demoActive === 'true';

    // Closing clone should keep document.body.dataset.demoActive === 'true' while first is still open
    clone.querySelector('[data-close]').click();
    const firstStillActive =
      first.querySelectorAll('iframe').length === 2 &&
      clone.querySelectorAll('iframe').length === 0 &&
      document.body.dataset.demoActive === 'true';

    clone.remove();
    return { bothActive, firstStillActive };
  });
  assert.equal(multiInstanceResult.bothActive, true);
  assert.equal(multiInstanceResult.firstStillActive, true);

  await page.click('bits-live-demo [data-close]');
  assert.equal(await page.evaluate(() => document.body.dataset.demoActive), undefined);

  // 5. Mimic regression check
  await page.goto(`${server.origin}/quests/mimic/`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  assert.equal(await page.$('#mimic-active-step-label, .mimic-step-btn') !== null, true);
  assert.equal(await page.$$eval('[data-quest-demo-shell]', (els) => els.length), 0);
  assert.deepEqual(pageErrors, []);

  console.log(
    'PASS: Shared QuestDemoShell verified across ArcaneTyper, BITS, multi-instance fixture, and Mimic regression baseline.'
  );
} finally {
  await browser?.close();
  await server.close();
}
