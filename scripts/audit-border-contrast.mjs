// scripts/audit-border-contrast.mjs
// Automated measurement instrument for Budget B9: UI border & large text contrast (target >= 3.0:1)
// Measures interactive boundaries (focus rings, button borders, card borders, pills)
// and large text against their adjacent backgrounds across the built site in dist.

import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';
import { getLuminance, getContrastRatio, parseColor } from './measure-contrast.mjs';

const THRESHOLD = 3.00;
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = 18.66;
const BOLD_WEIGHT = 700;

const DEFAULT_ROUTES = [
  '/',
  '/simple',
  '/resume',
  '/tavern',
  '/quests',
  '/quests/arcanetyper',
  '/messenger',
  '/about',
  '/tavern/skills'
];
const requestedRoute = process.argv[2];
const routesToTest = requestedRoute ? [requestedRoute] : DEFAULT_ROUTES;

console.log('=== BUDGET B9 AUDIT: UI BORDER & LARGE TEXT CONTRAST ===');
console.log(`TARGET: >= ${THRESHOLD.toFixed(2)}:1`);
console.log(`ROUTES: ${routesToTest.join(', ')}\n`);

const srv = await createDistServer({ root: 'dist', port: 0, quiet: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height: 768 },
});

let totalEvaluated = 0;
let totalPassed = 0;
let totalFailed = 0;
let worstRatio = Infinity;
let worstItem = null;

try {
  const page = await browser.newPage();

  for (const route of routesToTest) {
    let cleanRoute = route.startsWith('/') ? route : '/' + route;
    const resolvedUrl = srv.origin + cleanRoute;
    const response = await page.goto(resolvedUrl, { waitUntil: 'load', timeout: 30000 });
    const status = response ? response.status() : 0;
    if (status !== 200) {
      console.error(`ERROR: Route ${cleanRoute} returned HTTP ${status}`);
      process.exitCode = 1;
      continue;
    }

    console.log(`--- Route: ${cleanRoute} ---`);

    const elements = await page.evaluate((largePx, largeBoldPx, boldWeight) => {
      const results = [];
      const allEls = Array.from(document.querySelectorAll('a, button, input, section, article, h1, h2, h3, [role="button"], .notch, .scene-tooltip'));

      function getEffectiveBackground(el) {
        let curr = el;
        while (curr && curr !== document.documentElement) {
          const style = window.getComputedStyle(curr);
          const bg = style.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            return bg;
          }
          curr = curr.parentElement;
        }
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') {
          return bodyBg;
        }
        const docBg = window.getComputedStyle(document.documentElement).backgroundColor;
        if (docBg && docBg !== 'rgba(0, 0, 0, 0)' && docBg !== 'transparent') {
          return docBg;
        }
        return 'rgb(255, 255, 255)'; // standard user-agent canvas default
      }

      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const className = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        const identifier = `${tag}${id}${className}`;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const effectiveBg = getEffectiveBackground(el);
        const parentBg = el.parentElement ? getEffectiveBackground(el.parentElement) : effectiveBg;

        // 1. Check border contrast if element has visible border
        const borderTopW = parseFloat(style.borderTopWidth) || 0;
        const borderTopColor = style.borderTopColor;
        const borderTopStyle = style.borderTopStyle;

        if (borderTopW > 0 && borderTopStyle !== 'none' && borderTopColor) {
          results.push({
            type: 'border',
            identifier,
            color: borderTopColor,
            background: parentBg !== 'transparent' ? parentBg : effectiveBg,
            text: (el.textContent || '').trim().slice(0, 30),
          });
        }

        // 2. Check focus-visible outline if interactive
        if (tag === 'a' || tag === 'button' || tag === 'input' || el.getAttribute('tabindex') === '0') {
          const outlineW = parseFloat(style.outlineWidth) || 0;
          const outlineColor = style.outlineColor;
          const outlineStyle = style.outlineStyle;
          if (outlineW > 0 && outlineStyle !== 'none' && outlineColor) {
            results.push({
              type: 'outline',
              identifier: `${identifier}:focus-ring`,
              color: outlineColor,
              background: parentBg,
              text: (el.textContent || '').trim().slice(0, 30),
            });
          }
        }

        // 3. Check large text contrast (WCAG large text threshold >= 3.0:1)
        const fontSize = parseFloat(style.fontSize) || 0;
        const fontWeight = parseInt(style.fontWeight, 10) || 400;
        const isLarge = fontSize >= largePx || (fontSize >= largeBoldPx && fontWeight >= boldWeight);
        if (isLarge && (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'a')) {
          results.push({
            type: 'large-text',
            identifier: `${identifier} (${fontSize}px/wt${fontWeight})`,
            color: style.color,
            background: effectiveBg,
            text: (el.textContent || '').trim().slice(0, 30),
          });
        }
      }

      return results;
    }, LARGE_TEXT_PX, LARGE_BOLD_TEXT_PX, BOLD_WEIGHT);

    for (const item of elements) {
      const c1 = parseColor(item.color);
      const c2 = parseColor(item.background);
      if (!c1 || !c2) continue;

      const l1 = getLuminance(c1.r, c1.g, c1.b);
      const l2 = getLuminance(c2.r, c2.g, c2.b);
      const ratio = parseFloat(getContrastRatio(l1, l2).toFixed(2));

      totalEvaluated++;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worstItem = { ...item, ratio, route: cleanRoute };
      }

      const pass = ratio >= THRESHOLD;
      if (pass) {
        totalPassed++;
      } else {
        totalFailed++;
      }

      console.log(`  [${item.type.toUpperCase()}] ${item.identifier}`);
      console.log(`    Color: ${item.color} | Bg: ${item.background} => Ratio: ${ratio}:1 (${pass ? 'PASS' : 'FAIL'})`);
    }
  }

  console.log('\n=== BUDGET B9 AUDIT SUMMARY ===');
  console.log(`Total Evaluated: ${totalEvaluated}`);
  console.log(`Total Passed:    ${totalPassed}`);
  console.log(`Total Failed:    ${totalFailed}`);
  console.log(`Worst Ratio:     ${worstRatio}:1 on ${worstItem ? `${worstItem.route} (${worstItem.identifier})` : 'none'}`);
  console.log(`Threshold:       >= ${THRESHOLD.toFixed(2)}:1`);

  if (totalFailed === 0 && totalEvaluated > 0) {
    console.log(`\nSTANDING: PASS — Budget B9 fully satisfied across all evaluated routes.`);
    process.exitCode = 0;
  } else {
    console.error(`\nSTANDING: FAIL — Found ${totalFailed} elements below the ${THRESHOLD.toFixed(2)}:1 requirement.`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await srv.close();
}
