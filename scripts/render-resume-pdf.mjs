import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';
const height = 768;

// One PDF per resume variant, each with an ATS-safe filename (recruiters see the
// filename in their inbox and in the ATS document list). `roleQuery` deep-links
// the page so the right variant is on screen before printing.
// `legacyPath` keeps the old /resume.pdf link (profile.resumeFile) working.
const VARIANTS = [
  {
    id: 'developer',
    roleQuery: '',
    path: 'public/Cabahug-Nhovem-Resume-Developer.pdf',
    legacyPath: 'public/resume.pdf',
  },
  {
    id: 'qa',
    roleQuery: '?role=qa',
    path: 'public/Cabahug-Nhovem-Resume-QA-Tester.pdf',
  },
];

const srv = await createDistServer({ root: 'dist/client', port: 0, quiet: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const variant of VARIANTS) {
  const page = await browser.newPage();
  await page.goto(srv.origin + '/resume' + variant.roleQuery, { waitUntil: 'networkidle0' });

  // Prove the requested variant is the visible one before printing, so a broken
  // deep link fails the run instead of silently shipping the wrong resume.
  const visible = await page.$eval(
    `[data-resume-panel="${variant.id}"]`,
    (el) => !el.hidden,
  );
  if (!visible) {
    throw new Error(`resume variant "${variant.id}" is hidden - refusing to export the wrong PDF`);
  }
  await sleep(150);

  await page.pdf({
    path: variant.path,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '12mm',
      right: '12mm',
      bottom: '12mm',
      left: '12mm',
    },
  });

  if (variant.legacyPath) fs.copyFileSync(variant.path, variant.legacyPath);

  console.log('PDF_PATH ' + variant.path);
  console.log('PDF_BYTES ' + fs.statSync(variant.path).size);
  if (variant.legacyPath) console.log('PDF_LEGACY_PATH ' + variant.legacyPath);

  await page.close();
}

console.log('SERVE_PORT ' + srv.port);

await browser.close();
await srv.close();
