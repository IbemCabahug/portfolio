import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createDistServer } from './serve-dist.mjs';
import { EDGE } from './browser-path.mjs';
const height = 768;

const srv = await createDistServer({ root: 'dist', port: 0, quiet: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1366, height },
});

const page = await browser.newPage();
await page.goto(srv.origin + '/resume', { waitUntil: 'networkidle0' });

const pdfPath = 'public/resume.pdf';
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

const stats = fs.statSync(pdfPath);
console.log('PDF_PATH ' + pdfPath);
console.log('PDF_BYTES ' + stats.size);
console.log('SERVE_PORT ' + srv.port);

await browser.close();
await srv.close();
