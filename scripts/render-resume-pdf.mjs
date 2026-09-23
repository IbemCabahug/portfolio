import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';
const height = 768;

const pdfPath = 'public/Cabahug-Nhovem-Resume.pdf';
const legacyPath = 'public/resume.pdf';

// Clean up old multi-variant PDF artifacts if present
const deprecatedPdfs = [
  'public/Cabahug-Nhovem-Resume-Developer.pdf',
  'public/Cabahug-Nhovem-Resume-QA-Tester.pdf',
];
for (const deprecated of deprecatedPdfs) {
  if (fs.existsSync(deprecated)) {
    fs.unlinkSync(deprecated);
    console.log('REMOVED_DEPRECATED_PDF ' + deprecated);
  }
}

const srv = await createDistServer({ root: 'dist/client', port: 0, quiet: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = await browser.newPage();
await page.goto(srv.origin + '/resume', { waitUntil: 'networkidle0' });

// Ensure the resume sheet is present
const sheetExists = await page.$('.resume-sheet');
if (!sheetExists) {
  throw new Error('resume-sheet not found on /resume');
}
await sleep(200);

await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: {
    top: '12mm',
    right: '12mm',
    bottom: '12mm',
    left: '12mm',
  },
});

if (legacyPath) {
  fs.copyFileSync(pdfPath, legacyPath);
}

console.log('PDF_PATH ' + pdfPath);
console.log('PDF_BYTES ' + fs.statSync(pdfPath).size);
if (legacyPath) {
  console.log('PDF_LEGACY_PATH ' + legacyPath);
}

await page.close();

console.log('SERVE_PORT ' + srv.port);

await browser.close();
await srv.close();
