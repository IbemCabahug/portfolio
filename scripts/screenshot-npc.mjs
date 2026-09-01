// Evidence capture. Committed under X139: any script whose output is used as
// evidence lives in the repository. Under X140 the answer click MUST fail
// loudly, because a caption is not a measurement.
// Usage: node scripts/screenshot-npc.mjs [viewportHeight] [answer]

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const height = Number(process.argv[2] || 768);
const answerMode = process.argv[3] === 'answer';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
await page.goto('http://localhost:4321/tavern/npc', { waitUntil: 'networkidle0' });

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
    process.exit(1);
  }
  console.log('CLICKED ' + JSON.stringify(result));
  await new Promise((r) => setTimeout(r, 400));
  label = 'answered';
}

const out = 'npc-' + label + '-' + height + '.png';
await page.screenshot({ path: out });
console.log('WROTE ' + out);

await browser.close();
