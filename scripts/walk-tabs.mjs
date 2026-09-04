import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';

const [route, heightStr, maxStepsStr, outName] = process.argv.slice(2);
if (!route || !heightStr || !maxStepsStr || !outName) {
  console.error('Usage: node scripts/walk-tabs.mjs ROUTE HEIGHT MAXSTEPS OUTNAME');
  process.exit(1);
}

const height = parseInt(heightStr, 10);
const maxSteps = parseInt(maxStepsStr, 10);
if (Number.isNaN(height) || Number.isNaN(maxSteps)) {
  console.error('INVALID_ARGUMENTS: height and maxSteps must be numbers');
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
const response = await page.goto(resolvedUrl, { waitUntil: 'load', timeout: 60000 });
const status = response ? response.status() : 0;
console.log(`ROUTE_STATUS ${status}`);

if (status !== 200) {
  console.error(`ROUTE_STATUS_FAILED ${status} ${resolvedUrl}`);
  await browser.close();
  await srv.close();
  process.exit(1);
}

const viewportMetrics = await page.evaluate(() => ({
  width: window.innerWidth,
  height: window.innerHeight,
  docHeight: document.documentElement.scrollHeight,
}));
console.log(`VIEWPORT ${viewportMetrics.width} ${viewportMetrics.height}`);
console.log(`DOC_HEIGHT ${viewportMetrics.docHeight}`);

await page.evaluate(() => {
  window.__tabVisited = new Set();
  window.__firstTabEl = null;
});

let noOutlineCount = 0;
let offscreenCount = 0;
let bodyStepCount = 0;
let totalSteps = 0;

for (let step = 1; step <= maxSteps; step++) {
  totalSteps = step;
  await page.keyboard.press('Tab');

  const stepInfo = await page.evaluate((n) => {
    const active = document.activeElement;
    const isBody = !active || active === document.body;
    let wrapped = false;

    if (!isBody) {
      if (n === 1) {
        window.__firstTabEl = active;
      } else if (window.__firstTabEl && active === window.__firstTabEl) {
        wrapped = true;
      }
      window.__tabVisited.add(active);
    }

    const tag = active ? active.tagName.toLowerCase() : 'body';
    const id = (active && active.id) ? active.id : '-';
    const text = (active && active.textContent ? active.textContent : '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const rect = active ? active.getBoundingClientRect() : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const cs = active ? window.getComputedStyle(active) : null;

    const x = Math.round(rect.left + window.scrollX);
    const y = Math.round(rect.top + window.scrollY);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const vtop = Math.round(rect.top);
    const scrollY = Math.round(window.scrollY);

    const outlineColor = cs ? cs.outlineColor : 'none';
    const outlineWidth = cs ? cs.outlineWidth : '0px';
    const outlineStyle = cs ? cs.outlineStyle : 'none';
    const outlineOffset = cs ? cs.outlineOffset : '0px';

    const visible = (rect.width > 0 || rect.height > 0) &&
      rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;

    return {
      isBody,
      wrapped,
      tag,
      id,
      text,
      x, y, w, h,
      vtop,
      scrollY,
      outlineColor,
      outlineWidth,
      outlineStyle,
      outlineOffset,
      visible,
    };
  }, step);

  if (stepInfo.isBody) {
    bodyStepCount++;
    console.log(`FOCUS_LOST_AT ${step}`);
  } else {
    if (stepInfo.outlineWidth === '0px' || stepInfo.outlineStyle === 'none') {
      noOutlineCount++;
    }
    if (!stepInfo.visible) {
      offscreenCount++;
    }
  }

  console.log(`TAB ${step} tag=${stepInfo.tag} id=${stepInfo.id} rect=${stepInfo.x}:${stepInfo.y}:${stepInfo.w}:${stepInfo.h} outline=${stepInfo.outlineColor} style=${stepInfo.outlineStyle} width=${stepInfo.outlineWidth} offset=${stepInfo.outlineOffset} vtop=${stepInfo.vtop} scrollY=${stepInfo.scrollY} visible=${stepInfo.visible} text=${stepInfo.text}`);

  if (stepInfo.wrapped) {
    console.log(`TAB_WRAP_AT ${step}`);
    break;
  }
}

const distinctTotal = await page.evaluate(() => window.__tabVisited ? window.__tabVisited.size : 0);

console.log(`TAB_TOTAL ${totalSteps}`);
console.log(`TAB_DISTINCT ${distinctTotal}`);
console.log(`TAB_BODY_STEPS ${bodyStepCount}`);
console.log(`TAB_NO_OUTLINE ${noOutlineCount}`);
console.log(`TAB_OFFSCREEN ${offscreenCount}`);

fs.mkdirSync('.shots', { recursive: true });
const shotPath = path.join('.shots', `${outName}.png`);
await page.screenshot({ path: shotPath, fullPage: true });
const shotBytes = fs.statSync(shotPath).size;
console.log(`SHOT_PATH ${shotPath}`);
console.log(`SHOT_BYTES ${shotBytes}`);

await browser.close();
await srv.close();
