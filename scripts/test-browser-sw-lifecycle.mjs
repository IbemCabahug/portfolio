// Fixtures supply network responses, never copies of worker logic.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';
import { buildRoot, browserArgs } from './security-browser-helpers.mjs';

let generation = 1;
let offline = false;
let passed = 0;
const requests = [];
const source = await readFile(join(buildRoot, 'sw.js'), 'utf8');
const shell = 'nhovem-shell-v8';
const runtime = 'nhovem-runtime-v8';
const server = await createDistServer({ root: buildRoot, port: 0, quiet: true, handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  requests.push({ path: url.pathname, method: req.method });
  if (offline) { req.socket.destroy(); return true; }
  if (url.pathname === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(`${source}\n// Local test generation ${generation}\n`);
    return true;
  }
  if (url.pathname.startsWith('/security-fixture/') || url.pathname.startsWith('/api/security-fixture')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': url.searchParams.get('policy') || 'public, max-age=60' });
    res.end('/* deterministic local fixture */');
    return true;
  }
  return false;
} });
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: browserArgs });
const page = await browser.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(120_000);
const unexpected = [];
await page.setRequestInterception(true);
page.on('request', req => {
  if (new URL(req.url()).origin === server.origin) return void req.continue();
  unexpected.push(req.url());
  void req.abort();
});
async function test(name, fn) {
  await fn();
  console.log(`PASS ${++passed}: ${name}`);
}
async function cacheHas(cacheName, path) {
  return page.evaluate(async ({ cacheName, path }) => Boolean(await (await caches.open(cacheName)).match(path)), { cacheName, path });
}
async function waitCached(path) {
  await page.waitForFunction(async ({ runtime, path }) => Boolean(await (await caches.open(runtime)).match(path)), {}, { runtime, path });
}
try {
  console.log(`Build: ${buildRoot}\nOrigin: ${server.origin}`);
  await page.goto(server.origin, { waitUntil: 'load' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await test('real worker controls page and precaches critical routes', async () => {
    for (const path of ['/', '/tavern', '/quests', '/simple', '/offline', '/favicon.svg', '/manifest.webmanifest']) {
      assert.equal(await cacheHas(shell, path), true, path);
    }
  });
  await test('eligible asset enters runtime cache; ineligible path does not', async () => {
    await page.evaluate(async () => { await fetch('/security-fixture/public.js'); await fetch('/security-fixture/not-an-asset'); });
    await waitCached('/security-fixture/public.js');
    assert.equal(await cacheHas(runtime, '/security-fixture/not-an-asset'), false);
  });
  await test('no-store and private assets AND HTML are excluded by real worker', async () => {
    for (const accept of ['text/javascript', 'text/html']) {
      for (const policy of ['public', 'no-store', 'private']) {
        const path = `/security-fixture/policy-${accept.includes('html') ? 'html' : 'js'}-${policy}.js?policy=${policy}`;
        await page.evaluate(async ({ path, accept }) => { await fetch(path, { headers: { Accept: accept } }); }, { path, accept });
        if (policy === 'public') await waitCached(path);
        else assert.equal(await cacheHas(runtime, path), false, path);
      }
    }
  });
  await test('GET /api and POST/PUT/DELETE reach server without being cached', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const path = method === 'GET' ? '/api/security-fixture.js' : `/security-fixture/${method}.js`;
      await page.evaluate(async ({ method, path }) => { await fetch(path, { method }); }, { method, path });
      assert(requests.some(r => r.path === path && r.method === method));
      assert.equal(await cacheHas(runtime, path), false);
      assert.equal(await cacheHas(shell, path), false);
    }
  });
  await test('explicit cross-origin negative control is blocked and never cached', async () => {
    const url = 'https://blocked.security.example/fixture.js';
    await page.evaluate(async url => { await fetch(url).catch(() => {}); }, url);
    assert(unexpected.includes(url));
    assert.equal(await cacheHas(runtime, url), false);
    unexpected.splice(unexpected.indexOf(url), 1);
  });
  await test('network outage serves query navigation and offline fallback', async () => {
    offline = true;
    await page.goto(`${server.origin}/tavern?security=offline`, { waitUntil: 'load' });
    assert.match(await page.title(), /Tavern/i);
    await page.waitForSelector('#trigger-innkeeper');
    await page.goto(`${server.origin}/security-unknown-route`, { waitUntil: 'load' });
    assert.match(await page.title(), /offline/i);
    offline = false;
    await page.goto(server.origin, { waitUntil: 'load' });
  });
  await test('offline SVG uses favicon; missing JS and CSS fail as network errors', async () => {
    offline = true;
    const result = await page.evaluate(async () => {
      const svg = await fetch('/security-fixture/missing.svg');
      const results = { svg: await svg.text(), failures: [] };
      for (const ext of ['js', 'css']) {
        try { await fetch(`/security-fixture/missing.${ext}`); results.failures.push(false); }
        catch { results.failures.push(true); }
      }
      return results;
    });
    offline = false;
    const favicon = await page.evaluate(async shell => (await (await caches.open(shell)).match('/favicon.svg')).text(), shell);
    assert.equal(result.svg, favicon);
    assert.deepEqual(result.failures, [true, true]);
  });
  await test('65 real asset requests invoke worker eviction', async () => {
    await page.evaluate(async runtime => { await caches.delete(runtime); }, runtime);
    for (let i = 1; i <= 65; i++) {
      const path = `/security-fixture/bound-${i}.js`;
      await page.evaluate(async path => { await fetch(path); }, path);
      await waitCached(path);
    }
    // cache.put completes before the worker's waitUntil eviction does. Wait for
    // that asynchronous cleanup, rather than sampling its intermediate state.
    await page.waitForFunction(async runtime => {
      return (await (await caches.open(runtime)).keys()).length <= 60;
    }, {}, runtime);
    const count = await page.evaluate(async runtime => (await (await caches.open(runtime)).keys()).length, runtime);
    assert.equal(count, 60);
    assert.equal(await cacheHas(runtime, '/security-fixture/bound-1.js'), false);
    assert.equal(await cacheHas(runtime, '/security-fixture/bound-65.js'), true);
  });
  await test('waiting update preserves draft; approval reloads and real activation purges old caches', async () => {
    await page.goto(`${server.origin}/messenger`, { waitUntil: 'load' });
    await page.waitForSelector('#desktop-missive-body');
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(async () => {
      const input = document.getElementById('desktop-missive-body');
      input.value = 'UNSAVED_UPDATE_DRAFT';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.__securityPageInstance = 'original-document';
      await caches.open('nhovem-shell-v7');
      await caches.open('nhovem-runtime-v7');
      await caches.open('unrelated-security-cache');
    });
    generation++;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
    await page.waitForFunction(() => !document.getElementById('pwa-toast-action').classList.contains('hidden'));
    await new Promise(ok => setTimeout(ok, 1500));
    assert.equal(await page.evaluate(() => window.__securityPageInstance), 'original-document');
    assert.equal(await page.$eval('#desktop-missive-body', el => el.value), 'UNSAVED_UPDATE_DRAFT');
    const navigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.click('#pwa-toast-action');
    await navigation;
    assert.equal(await page.evaluate(() => window.__securityPageInstance), undefined);
    const names = await page.evaluate(() => caches.keys());
    assert(!names.includes('nhovem-shell-v7'));
    assert(!names.includes('nhovem-runtime-v7'));
    assert(names.includes('unrelated-security-cache'));
    assert(names.includes(shell));
  });
  await test('no unexpected external page requests', async () => assert.deepEqual(unexpected, []));
  console.log(`All ${passed} real service-worker integration tests passed.`);
} finally {
  await browser.close();
  await server.close();
}