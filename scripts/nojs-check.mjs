// B11 gate: the no-JS fallback must be readable with JavaScript genuinely
// disabled. Reading the markup is not evidence. Committed for the same reason
// as measure-layout.mjs.
// Usage: node scripts/nojs-check.mjs [route]
//
// Output contract:
// Prefix lines:
//   ROUTE_SOURCE
//   NOJS_SERVE_ROOT
//   NOJS_SERVE_PORT
//   NOJS_ROUTE
//   NOJS_ROUTE_STATUS
//   NOJS_ROUTE_BYTES
//   NOJS_ROUTE_SHA256
//   NOJS_START
//   NOJS_END
//
// JSON fields:
//   h1
//   headingCount
//   bodyTextLength
//   hiddenTextBearingElements (total, items [tag, id, classes])
//   fallback (found, fallbackVisible, fallbackDisplay, clientHeight, scrollHeight, overflowing, overflowYOfFallback, qaPairCount)
//   stack (present, hidden, computedHidden)
//   reachability (reachable, overflowing, overflowY)

import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';

const args = process.argv.slice(2).filter(a => a !== '--');
const rawRoute = args[0];
const routeSource = rawRoute !== undefined ? 'argument' : 'default';
let route = rawRoute || '/';
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
console.log('NOJS_SERVE_ROOT ' + srv.root);
console.log('NOJS_SERVE_PORT ' + srv.port);
console.log('NOJS_ROUTE ' + resolvedUrl);
console.log('NOJS_ROUTE_STATUS ' + status);
console.log('NOJS_ROUTE_BYTES ' + bytes);
console.log('NOJS_ROUTE_SHA256 ' + sha256);

if (status !== 200) {
  await srv.close();
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height: 768 },
});

const page = await browser.newPage();
await page.setJavaScriptEnabled(false);
await page.goto(resolvedUrl, { waitUntil: 'networkidle0' });

const data = await page.evaluate(() => {
  const h1El = document.querySelector('h1');
  const h1 = h1El ? (h1El.textContent || '').trim() : null;
  const headingCount = document.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
  const bodyTextLength = document.body ? (document.body.innerText || '').length : 0;

  const hiddenElements = [];
  for (const el of (document.body ? document.body.querySelectorAll('*') : [])) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue;
    const text = (el.textContent || '').trim();
    if (text.length > 200) {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        hiddenElements.push({ tag: el.tagName.toLowerCase(), id: el.id || null, classes: Array.from(el.classList) });
      }
    }
  }

  const fb = document.getElementById('npc-fallback');
  const fbCs = fb ? window.getComputedStyle(fb) : null;
  const fallback = fb ? {
    found: true,
    fallbackVisible: fbCs.display !== 'none' && fbCs.visibility !== 'hidden' && !fb.hidden,
    fallbackDisplay: fbCs.display,
    clientHeight: fb.clientHeight,
    scrollHeight: fb.scrollHeight,
    overflowing: fb.scrollHeight > fb.clientHeight,
    overflowYOfFallback: fbCs.overflowY,
    qaPairCount: fb.querySelectorAll('.qa-pair').length,
  } : {
    found: 'ABSENT',
    fallbackVisible: 'ABSENT',
    fallbackDisplay: 'ABSENT',
    clientHeight: 'ABSENT',
    scrollHeight: 'ABSENT',
    overflowing: 'ABSENT',
    overflowYOfFallback: 'ABSENT',
    qaPairCount: 'ABSENT',
  };

  const stack = document.getElementById('npc-stack');
  const stackCs = stack ? window.getComputedStyle(stack) : null;
  const stackProbe = stack ? {
    present: true,
    hidden: !!stack.hidden,
    computedHidden: !!(stack.hidden || (stackCs && (stackCs.display === 'none' || stackCs.visibility === 'hidden'))),
  } : {
    present: 'ABSENT',
    hidden: 'ABSENT',
    computedHidden: 'ABSENT',
  };

  const reachability = fb ? {
    reachable: !(fb.scrollHeight > fb.clientHeight) || (fbCs.overflowY === 'auto' || fbCs.overflowY === 'scroll'),
    overflowing: fb.scrollHeight > fb.clientHeight,
    overflowY: fbCs.overflowY,
  } : 'ABSENT';

  return {
    h1,
    headingCount,
    bodyTextLength,
    hiddenTextBearingElements: {
      total: hiddenElements.length,
      items: hiddenElements.slice(0, 10),
    },
    fallback,
    stack: stackProbe,
    reachability,
  };
});

console.log('NOJS_START');
console.log(JSON.stringify(data, null, 2));
console.log('NOJS_END');

await browser.close();
await srv.close();

if (status === 200 && data.bodyTextLength > 0) {
  process.exit(0);
} else {
  process.exit(1);
}
