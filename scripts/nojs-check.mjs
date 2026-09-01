// B11 gate: the no-JS fallback must be readable with JavaScript genuinely
// disabled. Reading the markup is not evidence. Committed for the same reason
// as measure-layout.mjs.
// Usage: node scripts/nojs-check.mjs [viewportHeight]

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const height = Number(process.argv[2] || 768);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
await page.setJavaScriptEnabled(false);
await page.goto('http://localhost:4321/tavern/npc', { waitUntil: 'networkidle0' });

const data = await page.evaluate(() => {
  const fb = document.getElementById('npc-fallback');
  const stack = document.getElementById('npc-stack');
  const cs = fb ? getComputedStyle(fb) : null;
  const r = fb ? fb.getBoundingClientRect() : null;
  return {
    fallbackPresent: !!fb,
    fallbackVisible: !!fb && cs.display !== 'none' && cs.visibility !== 'hidden' && !fb.hidden,
    fallbackDisplay: cs ? cs.display : null,
    fallbackRect: r ? { top: Math.round(r.top), height: Math.round(r.height), bottom: Math.round(r.bottom) } : null,
    scrollHeightOfFallback: fb ? fb.scrollHeight : null,
    clientHeightOfFallback: fb ? fb.clientHeight : null,
    overflowYOfFallback: cs ? cs.overflowY : null,
    qaPairCount: document.querySelectorAll('.qa-pair').length,
    stackPresent: !!stack,
    stackHidden: !!stack && stack.hidden,
  };
});

console.log('NOJS_START');
console.log(JSON.stringify(data, null, 2));
console.log('NOJS_END');

await browser.close();
