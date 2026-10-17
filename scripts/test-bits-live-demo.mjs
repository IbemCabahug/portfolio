// Portfolio-only browser checks. External documents are mocked; no BITS API is called.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';
import { demoUrl } from '../src/lib/bits-demo-url.ts';

assert.equal(demoUrl('javascript:alert(1)'), null);
assert.equal(demoUrl('http://localhost:3030'), null);
assert.equal(demoUrl('http://localhost:3030', true), 'http://localhost:3030/');
assert.equal(demoUrl('https://name:secret@example.com'), null);
assert.equal(demoUrl('https://example.com?token=secret'), null);
assert.equal(demoUrl('https://example.com'), 'https://example.com/');
const server = await createDistServer({ root: 'dist/client', port: 0, quiet: true });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(server.origin)) return void request.continue();
    if (request.isNavigationRequest()) return void request.respond({ status: 200, contentType: 'text/html', body: '<h1>Mock external demo</h1><input aria-label="Demo state" value="preserved">' });
    void request.abort();
  });
  await page.goto(`${server.origin}/quests/bits/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!customElements.get('bits-live-demo'));
  await page.evaluate(() => { delete document.querySelector('bits-live-demo').dataset.terminalUrl; });
  assert.equal(await page.$$eval('bits-live-demo iframe', frames => frames.length), 0);
  await page.click('[data-launch]');
  await page.waitForSelector('[data-frame="dashboard"] iframe');
  await page.evaluate(() => { window.testDashboard = document.querySelector('[data-frame="dashboard"] iframe'); });
  await page.click('[data-view="terminal"]');
  assert.match(await page.$eval('[data-status="terminal"]', el => el.textContent), /not configured/);
  assert.equal(await page.$$eval('bits-live-demo iframe', frames => frames.length), 1);
  await page.click('[data-close]');
  assert.equal(await page.$$eval('bits-live-demo iframe', frames => frames.length), 0);
  await page.evaluate(() => { document.querySelector('bits-live-demo').dataset.terminalUrl = 'https://terminal.example.test/'; });
  await page.click('[data-launch]');
  await page.evaluate(() => { window.testDashboard = document.querySelector('[data-frame="dashboard"] iframe'); });
  await page.focus('[data-view="dashboard"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('[data-view="terminal"]', el => el.getAttribute('aria-selected')), 'false');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-frame="terminal"] iframe');
  assert.equal(await page.$$eval('bits-live-demo iframe', frames => frames.length), 2);
  await page.click('[data-view="dashboard"]');
  assert.equal(await page.evaluate(() => window.testDashboard === document.querySelector('[data-frame="dashboard"] iframe')), true);
  await page.setViewport({ width: 375, height: 812 });
  assert.equal(await page.$eval('bits-live-demo', el => el.getBoundingClientRect().width <= 375), true);
  await page.click('[data-close]');
  assert.equal(await page.$$eval('bits-live-demo iframe', frames => frames.length), 0);
  assert.equal(await page.$eval('[data-launch]', el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
  console.log('PASS: URL validation, opt-in loading, missing configuration, lazy simulator, persistent dashboard, keyboard tabs, mobile width, unload and focus restoration. External apps mocked.');
} finally {
  await browser?.close();
  await server.close();
}