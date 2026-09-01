// Layout measurement harness. Committed deliberately: this file is a GATE,
// and a gate that lives outside version control is not a gate.
// Usage: node scripts/measure-layout.mjs [viewportHeight] [path]
// Requires the dev server running on http://localhost:4321
//
// NOTE on units: naturalWidth and naturalHeight on an element using a
// w-descriptor srcset are DENSITY CORRECTED by the browser. They are NOT the
// file's intrinsic pixel dimensions. Never open a defect on these numbers
// without decoding the file independently.
//
// All rectangle values are DOCUMENT relative, not frame relative.

import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const height = Number(process.argv[2] || 768);
const path = process.argv[3] || '/tavern/npc';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
await page.goto('http://localhost:4321' + path, { waitUntil: 'networkidle0' });

const data = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    return {
      present: true,
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left + window.scrollX),
      w: Math.round(r.width),
      h: Math.round(r.height),
      bottom: Math.round(r.bottom + window.scrollY),
    };
  };

  const overlaps = (a, b) => {
    if (!a.present || !b.present) return false;
    return a.left < b.left + b.w && a.left + a.w > b.left && a.top < b.top + b.h && a.top + a.h > b.top;
  };

  const sprite = document.querySelector('.npc-sprite');
  const spriteProbe = rect(sprite);
  if (sprite) {
    spriteProbe.naturalW = sprite.naturalWidth;
    spriteProbe.naturalH = sprite.naturalHeight;
    spriteProbe.currentSrc = sprite.currentSrc;
  }

  const bandProbe = rect(document.querySelector('.npc-dialogue-panel .dialogue-band'));
  const stackProbe = rect(document.querySelector('.npc-dialogue-panel .dialogue-stack'));
  const repliesProbe = rect(document.querySelector('.npc-dialogue-panel .dialogue-replies'));
  const plateProbe = rect(document.querySelector('.npc-table-front'));
  bandProbe.overlapsSprite = overlaps(bandProbe, spriteProbe);
  stackProbe.overlapsSprite = overlaps(stackProbe, spriteProbe);
  repliesProbe.overlapsSprite = overlaps(repliesProbe, spriteProbe);

  const art = document.querySelector('.npc-scene-art');
  const artProbe = art
    ? {
        present: true,
        naturalW: art.naturalWidth,
        naturalH: art.naturalHeight,
        currentSrc: art.currentSrc,
        boxW: Math.round(art.getBoundingClientRect().width),
        boxH: Math.round(art.getBoundingClientRect().height),
      }
    : { present: false };

  const skip = document.querySelector('a[href="#main-content"]');
  const skipLinkProbe = skip
    ? (() => {
        const r = skip.getBoundingClientRect();
        const cs = getComputedStyle(skip);
        return {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          position: cs.position,
          offsetParentTag: skip.offsetParent ? skip.offsetParent.tagName : null,
        };
      })()
    : { present: false };

  const frame = document.querySelector('.npc-page');
  const content = document.querySelector('.tavern-content');
  const wrapper = content
    ? (() => {
        const cs = getComputedStyle(content);
        return {
          h: Math.round(content.getBoundingClientRect().height),
          minHeight: cs.minHeight,
          display: cs.display,
        };
      })()
    : { present: false };

  const frameRect = rect(frame);
  const siblingsOfFrame = frame && frame.parentElement
    ? Array.from(frame.parentElement.children).map((c) => c.tagName + '.' + (c.className || '').toString().split(' ')[0])
    : [];

  const docScrollHeight = document.documentElement.scrollHeight;

  return {
    innerHeight: window.innerHeight,
    docScrollHeight,
    overflowPx: Math.max(0, docScrollHeight - window.innerHeight),
    wrapper,
    frameTopInDoc: frameRect.present ? frameRect.top : null,
    frameH: frameRect.present ? frameRect.h : null,
    frameW: frameRect.present ? frameRect.w : null,
    spaceBelowFrame: frameRect.present && content
      ? Math.round(content.getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom)
      : null,
    siblingsOfFrame,
    spriteProbe,
    bandProbe,
    stackProbe,
    repliesProbe,
    plateProbe,
    artProbe,
    skipLinkProbe,
  };
});

console.log('JSON_START_' + height);
console.log(JSON.stringify(data, null, 2));
console.log('JSON_END_' + height);

await browser.close();
