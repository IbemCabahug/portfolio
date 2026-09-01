// Layout measurement harness. Committed deliberately: this file is a GATE,
// and a gate that lives outside version control is not a gate.
// Usage: node scripts/measure-layout.mjs [viewportHeight] [path] [modes...]
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
const args = process.argv.slice(2);
const heightStr = args.find(a => /^\d+$/.test(a));
const height = Number(heightStr || 768);
const answerMode = args.includes('answer');
const reducedMode = args.includes('reduced');
const openMode = args.includes('open');
const triggerArg = args.find(a => a.startsWith('trigger-') || a === 'narrow-innkeeper');

const routeArg = args.find(a => 
  a !== heightStr && 
  a !== 'answer' && 
  a !== 'reduced' && 
  a !== 'open' && 
  a !== triggerArg
);

let path;
let routeSource;

if (routeArg !== undefined) {
  if (/^\d+$/.test(routeArg)) {
    console.error('ERROR: Route argument cannot be purely numeric');
    process.exit(1);
  }
  
  routeSource = 'argument';
  let cleaned = routeArg;
  
  const mangleToken = 'Program Files/Git';
  const idx = cleaned.indexOf(mangleToken);
  if (idx !== -1) {
    cleaned = cleaned.substring(idx + mangleToken.length);
  }
  
  if (!cleaned || cleaned.trim() === '') {
    console.error('ERROR: Route argument resolved to an empty path');
    process.exit(1);
  }
  
  if (!cleaned.startsWith('/')) {
    cleaned = '/' + cleaned;
  }
  
  if (cleaned === '/') {
    console.error('ERROR: Route argument resolved to an empty path');
    process.exit(1);
  }
  
  path = cleaned;
} else {
  routeSource = 'default';
  path = '/tavern/npc';
}

if (openMode && !triggerArg) {
  console.log('OPEN_NEEDS_TRIGGER');
  process.exit(1);
}

const resolvedUrl = 'http://localhost:4321' + path;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
const response = await page.goto(resolvedUrl, { waitUntil: 'load' });
const status = response.status();
if (status !== 200) {
  console.log(`ROUTE_STATUS_FAILED ${status} ${resolvedUrl}`);
  process.exit(1);
}
let routeStatus = status;
await page.evaluate(() => {
  document.querySelectorAll('img').forEach(img => {
    img.loading = 'eager';
    img.decoding = 'sync';
  });
});
await page.waitForFunction(() => {
  const imgs = Array.from(document.querySelectorAll('img'));
  return imgs.every(img => img.complete && img.naturalWidth > 0);
}, { timeout: 15000 }).catch(() => {});


const readyStateCheck = await page.evaluate(() => {
  if (document.readyState !== 'complete') return 'readyState is ' + document.readyState;
  const imgs = Array.from(document.querySelectorAll('img'));
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (!img.complete) return 'img ' + (img.src || img.id || i) + ' not complete';
    if (img.naturalWidth <= 0) return 'img ' + (img.src || img.id || i) + ' naturalWidth ' + img.naturalWidth;
  }
  const main = document.querySelector('main#main-content') || document.querySelector('.tavern-shell');
  if (!main) return 'main#main-content not found';
  if (main.getBoundingClientRect().height <= 0) return 'main#main-content height ' + main.getBoundingClientRect().height;
  return 'OK';
});

if (readyStateCheck !== 'OK') {
  console.log('PAGE_NOT_READY: ' + readyStateCheck);
  await browser.close();
  process.exit(1);
}

if (answerMode || reducedMode) {
  if (reducedMode) {
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

  if (!reducedMode) {
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
  if (!reducedMode) console.log('TYPING_SETTLED');
} else if (openMode) {
  try {
    const triggerSel = '#' + triggerArg;
    await page.waitForSelector(triggerSel, { timeout: 2000 });
    
    // Wait for JS to attach event listeners (it adds aria-haspopup or data-filter)
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      return el && (el.hasAttribute('aria-haspopup') || el.hasAttribute('data-filter'));
    }, { timeout: 5000 }, triggerSel).catch(() => {});

    await page.evaluate((sel) => document.querySelector(sel).click(), triggerSel);
    
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('.tavern-panel, .npc-dialogue-panel');
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && !els[i].hidden) return true;
      }
      return false;
    }, { timeout: 5000 });

    // Wait for CSS open animation to settle (slideUp is 0.3s with scale)
    await page.waitForFunction(() => {
      const panels = document.querySelectorAll('.tavern-panel:not([hidden])');
      for (const p of panels) {
        const anims = p.getAnimations();
        if (anims.length > 0 && anims.some(a => a.playState === 'running')) return false;
      }
      return true;
    }, { timeout: 2000 }).catch(() => {});
    
    console.log('OPEN_MODE');
    console.log('OPEN_TRIGGER ' + triggerArg);
    console.log('OPEN_PANEL_VISIBLE');
  } catch (err) {
    console.log('OPEN_FAILED');
    await browser.close();
    process.exit(1);
  }
}

const data = await page.evaluate(() => {
  const probeAll = (selector) => {
    const elements = document.querySelectorAll(selector);
    const matches = [];
    const cap = 20;
    for (let i = 0; i < elements.length && i < cap; i++) {
      const el = elements[i];
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      matches.push({
        i,
        w,
        h,
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left + window.scrollX),
        measurable: w > 0 && h > 0
      });
    }
    return { selector, count: elements.length, matches, capped: elements.length > cap };
  };

  const rect = (el) => {
    if (!el) return { present: false, measurable: false };
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    return {
      present: true,
      top: Math.round(r.top + window.scrollY),
      left: Math.round(r.left + window.scrollX),
      w,
      h,
      bottom: Math.round(r.bottom + window.scrollY),
      measurable: w > 0 && h > 0
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

  const bandProbe = rect(document.querySelector('.npc-dialogue-panel .dialogue-band') || document.querySelector('.dialogue-panel .dialogue-band'));
  const stackProbe = rect(document.querySelector('.npc-dialogue-panel .dialogue-stack') || document.querySelector('.dialogue-panel .dialogue-stack'));
  const repliesEl = document.querySelector('.npc-dialogue-panel .dialogue-replies') || document.querySelector('.dialogue-panel .dialogue-replies');
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
    ? (() => {
        const r = art.getBoundingClientRect();
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        return {
          present: true,
          naturalW: art.naturalWidth,
          naturalH: art.naturalHeight,
          currentSrc: art.currentSrc,
          boxW: w,
          boxH: h,
          measurable: w > 0 && h > 0
        }
      })()
    : { present: false, measurable: false };

  const skip = document.querySelector('a[href="#main-content"]');
  const skipLinkProbe = skip
    ? (() => {
        const r = skip.getBoundingClientRect();
        const cs = getComputedStyle(skip);
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        return {
          present: true,
          measurable: w > 0 && h > 0,
          x: Math.round(r.left),
          y: Math.round(r.top),
          w,
          h,
          position: cs.position,
          offsetParentTag: skip.offsetParent ? skip.offsetParent.tagName : null,
        };
      })()
    : { present: false, measurable: false };

  const frame = document.querySelector('.npc-page');
  const content = document.querySelector('.tavern-content');
  const wrapper = content
    ? (() => {
        const cs = getComputedStyle(content);
        const w = Math.round(content.getBoundingClientRect().width);
        const h = Math.round(content.getBoundingClientRect().height);
        return {
          present: true,
          measurable: w > 0 && h > 0,
          h,
          minHeight: cs.minHeight,
          display: cs.display,
        };
      })()
    : { present: false, measurable: false };

  const frameRect = rect(frame);
  const siblingsOfFrame = frame && frame.parentElement
    ? Array.from(frame.parentElement.children).map((c) => c.tagName + '.' + (c.className || '').toString().split(' ')[0])
    : [];

  const docScrollHeight = document.documentElement.scrollHeight;

  const proseEl = document.querySelector('.npc-dialogue-panel .dialogue-prose') || document.querySelector('.dialogue-panel .dialogue-prose');
  const proseProbe = rect(proseEl);
  if (proseEl) {
    proseProbe.scrollHeight = proseEl.scrollHeight;
    proseProbe.clientHeight = proseEl.clientHeight;
    proseProbe.clipped = proseEl.scrollHeight > proseEl.clientHeight + 1;
  }
  const bodyEl = document.querySelector('.npc-dialogue-panel .panel-body') || document.querySelector('.dialogue-panel .panel-body');
  const bodyProbe = rect(bodyEl);
  if (bodyEl) {
    bodyProbe.scrollHeight = bodyEl.scrollHeight;
    bodyProbe.clientHeight = bodyEl.clientHeight;
    bodyProbe.overflowY = getComputedStyle(bodyEl).overflowY;
    bodyProbe.scrollable = bodyEl.scrollHeight > bodyEl.clientHeight + 1;
  }
  
  const proseEl2 = document.querySelector('.npc-dialogue-panel .dialogue-prose') || document.querySelector('.dialogue-panel .dialogue-prose');
  const announceEl = document.getElementById('npc-announce');
  const repliesEl2 = document.querySelector('.npc-dialogue-panel .dialogue-replies') || document.querySelector('.dialogue-panel .dialogue-replies');
  const typingProbe = {
    unreadCount: proseEl2 ? proseEl2.querySelectorAll('.dialogue-unread').length : null,
    proseTextLength: proseEl2 ? (proseEl2.textContent || '').length : null,
    announceTextLength: announceEl ? (announceEl.textContent || '').length : null,
    repliesHidden: repliesEl2 ? repliesEl2.hidden : null,
    motion: document.documentElement.dataset.motion || null,
  };

  const closeProbe = probeAll('.close-panel-btn');
  const controlProbe = probeAll('.close-panel-btn-does-not-exist');
  const replyBtnProbe = probeAll('.reply-btn');

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
    controlProbe,
    replyBtnProbe
  };
});

if (data.controlProbe.count !== 0 || data.controlProbe.matches.length !== 0) {
  console.log('PROBE MACHINERY UNTRUSTWORTHY');
  process.exit(1);
}

console.log('ROUTE_SOURCE=' + routeSource);
console.log('ROUTE_STATUS=' + routeStatus);
console.log('RESOLVED_URL ' + resolvedUrl);
console.log('JSON_START_' + height);
console.log(JSON.stringify(data, null, 2));
console.log('JSON_END_' + height);

await browser.close();
