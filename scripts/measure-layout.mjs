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
const path = (process.argv[3] && process.argv[3] !== 'answer') ? process.argv[3] : '/tavern/npc';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
await page.goto('http://localhost:4321' + path, { waitUntil: 'networkidle0' });

const answerMode = process.argv.includes('answer');
if (answerMode) {
  const isReduced = process.argv.includes('reduced');
  if (isReduced) {
    await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; });
    console.log('MOTION reduced');
  } else {
    const currentMotion = await page.evaluate(() => document.documentElement.dataset.motion || '');
    console.log('MOTION ' + currentMotion);
  }

  const clicked = await page.evaluate(() => {
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
  if (!clicked.clicked) {
    console.error('ANSWER MODE FAILED: ' + clicked.reason);
    await browser.close();
    process.exit(1);
  }
  console.log('ANSWER_MODE ' + JSON.stringify(clicked));

  if (!isReduced) {
    const started = await page.waitForFunction(
      () => {
        const p = document.querySelector('.npc-dialogue-panel .dialogue-prose');
        return !!p && p.querySelectorAll('.dialogue-unread').length > 0;
      },
      { timeout: 2000 },
    ).then(() => true).catch(() => false);
    if (!started) {
      console.error('TYPE OUT NEVER STARTED: no dialogue-unread span appeared within 2 seconds');
      await browser.close();
      process.exit(1);
    }
    console.log('TYPING_STARTED');
  }

  const settled = await page.waitForFunction(
    () => {
      const p = document.querySelector('.npc-dialogue-panel .dialogue-prose');
      if (!p) return false;
      return p.querySelectorAll('.dialogue-unread').length === 0;
    },
    { timeout: 20000 },
  ).then(() => true).catch(() => false);
  if (!settled) {
    console.error('TYPE OUT DID NOT SETTLE WITHIN 20 SECONDS');
    await browser.close();
    process.exit(1);
  }
  if (!isReduced) console.log('TYPING_SETTLED');
}

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
  const repliesEl = document.querySelector('.npc-dialogue-panel .dialogue-replies');
  const repliesProbe = rect(repliesEl);
  const plateProbe = rect(document.querySelector('.npc-table-front'));
  bandProbe.overlapsSprite = overlaps(bandProbe, spriteProbe);
  stackProbe.overlapsSprite = overlaps(stackProbe, spriteProbe);
  repliesProbe.overlapsSprite = overlaps(repliesProbe, spriteProbe);
  if (repliesEl) {
    repliesProbe.scrollHeight = repliesEl.scrollHeight;
    repliesProbe.clientHeight = repliesEl.clientHeight;
    repliesProbe.scrollable = repliesEl.scrollHeight > repliesEl.clientHeight + 1;
  }

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

  const proseEl = document.querySelector('.npc-dialogue-panel .dialogue-prose');
  const proseProbe = rect(proseEl);
  if (proseEl) {
    proseProbe.scrollHeight = proseEl.scrollHeight;
    proseProbe.clientHeight = proseEl.clientHeight;
    proseProbe.clipped = proseEl.scrollHeight > proseEl.clientHeight + 1;
  }
  const bodyEl = document.querySelector('.npc-dialogue-panel .panel-body');
  const bodyProbe = rect(bodyEl);
  if (bodyEl) {
    bodyProbe.scrollHeight = bodyEl.scrollHeight;
    bodyProbe.clientHeight = bodyEl.clientHeight;
    bodyProbe.overflowY = getComputedStyle(bodyEl).overflowY;
    bodyProbe.scrollable = bodyEl.scrollHeight > bodyEl.clientHeight + 1;
  }
  const closeProbe = rect(document.querySelector('.npc-dialogue-panel .panel-actions .close-panel-btn'));

  const proseEl2 = document.querySelector('.npc-dialogue-panel .dialogue-prose');
  const announceEl = document.getElementById('npc-announce');
  const repliesEl2 = document.querySelector('.npc-dialogue-panel .dialogue-replies');
  const typingProbe = {
    unreadCount: proseEl2 ? proseEl2.querySelectorAll('.dialogue-unread').length : null,
    proseTextLength: proseEl2 ? (proseEl2.textContent || '').length : null,
    announceTextLength: announceEl ? (announceEl.textContent || '').length : null,
    repliesHidden: repliesEl2 ? repliesEl2.hidden : null,
    motion: document.documentElement.dataset.motion || null,
  };

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
    proseProbe,
    bodyProbe,
    typingProbe,
    closeProbe,
  };
});

console.log('JSON_START_' + height);
console.log(JSON.stringify(data, null, 2));
console.log('JSON_END_' + height);

await browser.close();
