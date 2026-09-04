import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';

const [route, heightStr, selector, outName] = process.argv.slice(2);
if (!route || !heightStr || !selector || !outName) {
  console.error('Usage: node scripts/capture-focus.mjs ROUTE HEIGHT SELECTOR OUTNAME');
  process.exit(1);
}
const height = parseInt(heightStr, 10);
if (Number.isNaN(height)) {
  console.error(`INVALID_HEIGHT: ${heightStr}`);
  process.exit(1);
}

let cleanRoute = route;
const mangleToken = 'Program Files/Git';
const mIdx = cleanRoute.indexOf(mangleToken);
if (mIdx !== -1) cleanRoute = cleanRoute.substring(mIdx + mangleToken.length);
if (!cleanRoute || cleanRoute === '') cleanRoute = '/';
if (!cleanRoute.startsWith('/')) cleanRoute = '/' + cleanRoute;

const srv = await createDistServer({ root: 'dist', port: 0, quiet: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
const resolvedUrl = srv.origin + cleanRoute;
const response = await page.goto(resolvedUrl, { waitUntil: 'load' });
const status = response ? response.status() : 0;
console.log(`ROUTE_STATUS ${status}`);
if (status !== 200) {
  console.error(`ROUTE_STATUS_FAILED ${status} ${resolvedUrl}`);
  await browser.close();
  await srv.close();
  process.exit(1);
}

const targetExists = await page.$(selector);
if (!targetExists) {
  console.error(`SELECTOR_NOT_FOUND: ${selector}`);
  await browser.close();
  await srv.close();
  process.exit(1);
}

await page.focus(selector);
await new Promise(function settle(r) { return setTimeout(r, 250); });
await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (el) {
    try { el.focus({ focusVisible: true }); } catch { el.focus(); }
  }
}, selector);

const focusInfo = await page.evaluate((sel) => {
  const active = document.activeElement;
  if (!active || active === document.body) return { isBody: true };
  const el = document.querySelector(sel);
  const matched = active === el;
  const tag = active.tagName.toLowerCase();
  const text = (active.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const rect = active.getBoundingClientRect();
  const cs = window.getComputedStyle(active);
  return {
    isBody: false,
    matched,
    tag,
    text,
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top + window.scrollY),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
  };
}, selector);

if (focusInfo.isBody) {
  console.error('ACTIVE_ELEMENT_IS_BODY');
  await browser.close();
  await srv.close();
  process.exit(1);
}

console.log(`FOCUS_TAG ${focusInfo.tag}`);
console.log(`FOCUS_TEXT ${focusInfo.text}`);
console.log(`FOCUS_MATCHED ${focusInfo.matched}`);
console.log(`FOCUS_RECT ${focusInfo.x} ${focusInfo.y} ${focusInfo.w} ${focusInfo.h}`);
console.log(`FOCUS_OUTLINE_STYLE ${focusInfo.outlineStyle}`);
console.log(`FOCUS_OUTLINE_WIDTH ${focusInfo.outlineWidth}`);
console.log(`FOCUS_OUTLINE_COLOR ${focusInfo.outlineColor}`);
console.log(`FOCUS_OUTLINE_OFFSET ${focusInfo.outlineOffset}`);

fs.mkdirSync('.shots', { recursive: true });
const shotPath = path.join('.shots', `${outName}.png`);
await page.screenshot({ path: shotPath, fullPage: true });
const shotBytes = fs.statSync(shotPath).size;
console.log(`SHOT_PATH ${shotPath}`);
console.log(`SHOT_BYTES ${shotBytes}`);

await browser.close();
await srv.close();
