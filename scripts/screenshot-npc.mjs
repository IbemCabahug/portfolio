// Evidence capture. Committed under X139: any script whose output is used as
// evidence lives in the repository. Under X140 the answer click MUST fail
// loudly, because a caption is not a measurement.
// Usage: node scripts/screenshot-npc.mjs [route] [viewportHeight] [answer]
//
// Output contract:
// Prefix lines:
//   ROUTE_SOURCE
//   HEIGHT_SOURCE
//   SHOT_SERVE_ROOT
//   SHOT_SERVE_PORT
//   SHOT_ROUTE
//   SHOT_ROUTE_STATUS
//   SHOT_ROUTE_BYTES
//   SHOT_ROUTE_SHA256
//   CLICKED
//   WROTE
//   SHOT_PATH
//   SHOT_BYTES
//   SHOT_SHA256

import fs from 'node:fs';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';

const args = process.argv.slice(2).filter(a => a !== '--');
const answerMode = args.includes('answer');
const heightStr = args.find(a => /^\d+$/.test(a));
const height = Number(heightStr || 768);
const heightSource = heightStr !== undefined ? 'argument' : 'default';

const routeArg = args.find(a => a !== heightStr && a !== 'answer');
const routeSource = routeArg !== undefined ? 'argument' : 'default';
let route = routeArg || '/tavern/npc';
if (!route.startsWith('/')) route = '/' + route;

const srv = await createDistServer({ root: 'dist', port: 0, quiet: true });
const resolvedUrl = `${srv.origin}${route}`;

const res = await fetch(resolvedUrl);
const status = res.status;
const arrayBuffer = await res.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);
const bytes = buffer.length;
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

console.log('ROUTE_SOURCE ' + routeSource);
console.log('HEIGHT_SOURCE ' + heightSource);
console.log('SHOT_SERVE_ROOT ' + srv.root);
console.log('SHOT_SERVE_PORT ' + srv.port);
console.log('SHOT_ROUTE ' + resolvedUrl);
console.log('SHOT_ROUTE_STATUS ' + status);
console.log('SHOT_ROUTE_BYTES ' + bytes);
console.log('SHOT_ROUTE_SHA256 ' + sha256);

if (status !== 200) {
  await srv.close();
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
await page.goto(resolvedUrl, { waitUntil: 'networkidle0' });

let label = 'initial';
if (answerMode) {
  const result = await page.evaluate(() => {
    const pairs = Array.from(document.querySelectorAll('#npc-fallback .qa-pair'));
    let best = -1;
    let bestLen = -1;
    pairs.forEach((pair, i) => {
      const p = pair.querySelector('p');
      const len = p ? (p.textContent || '').trim().length : 0;
      if (len > bestLen) { bestLen = len; best = i; }
    });
    if (best < 0) return { clicked: false, reason: 'no qa-pair found' };
    const btn = document.querySelector('#npc-replies [data-question-index="' + best + '"]');
    if (!btn) return { clicked: false, reason: 'no reply button for index ' + best };
    btn.click();
    return { clicked: true, index: best, answerLength: bestLen };
  });
  if (!result.clicked) {
    console.error('ANSWER MODE FAILED: ' + result.reason);
    await browser.close();
    await srv.close();
    process.exit(1);
  }
  console.log('CLICKED ' + JSON.stringify(result));
  await new Promise((r) => setTimeout(r, 400));
  label = 'answered';
}

fs.mkdirSync('.shots', { recursive: true });
const out = '.shots/npc-' + label + '-' + height + '.png';
await page.screenshot({ path: out });
console.log('WROTE ' + out);

const shotBuffer = fs.readFileSync(out);
const shotSha256 = crypto.createHash('sha256').update(shotBuffer).digest('hex');
const shotBytes = shotBuffer.length;

console.log('SHOT_PATH ' + out);
console.log('SHOT_BYTES ' + shotBytes);
console.log('SHOT_SHA256 ' + shotSha256);

await browser.close();
await srv.close();
