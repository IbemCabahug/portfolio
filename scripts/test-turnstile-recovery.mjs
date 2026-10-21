/** Isolated real-browser widget lifecycle tests. All non-local requests are mocked or blocked. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';
import { buildRoot, browserArgs } from './security-browser-helpers.mjs';

const server = await createDistServer({ root: buildRoot, port: 0, quiet: true });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: browserArgs });
  const page = await browser.newPage();
  const forbidden = [];
  let apiCalls = 0;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(`${server.origin}/api/missive`)) {
      apiCalls++;
      return request.respond({ status: 500, body: 'Unexpected API request' });
    }
    if (url.startsWith(server.origin + '/') || url.startsWith('data:')) return request.continue();
    if (url.startsWith('https://js.hcaptcha.com/1/api.js')) {
      return request.respond({ contentType: 'application/javascript', body: '// Mock installed later.' });
    }
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/api.js')) {
      return request.respond({ contentType: 'application/javascript', body: '// Deliberately unavailable until the test installs its mock.' });
    }
    // No third-party bytes are fetched, including fonts and telemetry.
    forbidden.push(url);
    return request.abort();
  });

  await page.goto(`${server.origin}/messenger/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('desktop-turnstile-slot-status')?.textContent.includes('longer than expected'), { timeout: 15000 });
  assert.equal(apiCalls, 0);

  await page.evaluate(() => {
    window.__widgetOptions = {};
    window.__widgetResets = [];
    window.__widgetRemovals = [];
    window.turnstile = {
      render(selector, options) {
        const id = selector.slice(1);
        window.__widgetOptions[id] = options;
        document.querySelector(selector).appendChild(document.createElement('span'));
        return id;
      },
      reset(id) { window.__widgetResets.push(id); },
      remove(id) { window.__widgetRemovals.push(id); document.getElementById(id)?.replaceChildren(); },
      getResponse() { return ''; },
    };
    // The SDK arrived AFTER the initial polling window. Retry must recover it.
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'Retry security verification').click();
  });
  assert.equal(await page.evaluate(() => Object.keys(window.__widgetOptions).length), 2);
  for (const slot of ['desktop-turnstile-slot', 'mobile-turnstile-slot']) {
    for (const [callback, expected] of [
      ['callback', 'complete'], ['expired-callback', 'expired'],
      ['timeout-callback', 'timed out'], ['error-callback', 'unavailable'],
    ]) {
      const status = await page.evaluate(({ slot, callback }) => {
        window.__widgetOptions[slot][callback]();
        const node = document.getElementById(`${slot}-status`);
        return { text: node.textContent, role: node.getAttribute('role'), live: node.getAttribute('aria-live') };
      }, { slot, callback });
      assert.ok(status.text.includes(expected));
      assert.equal(status.role, 'status');
      assert.equal(status.live, 'polite');
    }
  }
  await page.evaluate(() => {
    window.__hOptions = {};
    window.__hResets = [];
    window.__hRemoves = [];
    window.hcaptcha = {
      render(container, options) { window.__hOptions[container.id] = options; return container.id; },
      getResponse() { return 'synthetic-provider-proof'; },
      reset(id) { window.__hResets.push(id); },
      remove(id) { window.__hRemoves.push(id); },
    };
    window.portfolioHCaptchaReady();
  });
  assert.equal(await page.evaluate(() => Object.keys(window.__hOptions).length), 2);
  for (const slot of ['desktop-hcaptcha-slot', 'mobile-hcaptcha-slot']) {
    for (const [callback, expected] of [
      ['callback', 'complete'], ['expired-callback', 'expired'],
      ['chalexpired-callback', 'timed out'], ['error-callback', 'unavailable'],
    ]) {
      const status = await page.evaluate(({ slot, callback }) => {
        window.__hOptions[slot][callback]();
        const node = document.getElementById(`${slot}-status`);
        return { text: node.textContent, role: node.getAttribute('role') };
      }, { slot, callback });
      assert.ok(status.text.includes(expected));
      assert.equal(status.role, 'status');
    }
    await page.evaluate((slot) => document.getElementById(`${slot}-retry`).click(), slot);
  }
  assert.equal(await page.evaluate(() => window.__hResets.length), 2);
  await page.evaluate(() => document.dispatchEvent(new Event('astro:before-swap')));
  assert.equal(await page.evaluate(() => window.__hRemoves.length), 2);
  assert.equal(await page.evaluate(() => window.__widgetRemovals.length), 2);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].filter((button) => button.textContent === 'Retry security verification').length), 0);
  assert.equal(apiCalls, 0);
  console.log('PASS: SDK timeout, late-load recovery, desktop/mobile callbacks, accessible status and swap cleanup.');
  console.log(`All non-local browser requests mocked/blocked (${forbidden.length} ancillary requests blocked).`);
} finally {
  await browser?.close();
  await server.close();
}