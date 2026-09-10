// scripts/generate-pwa-icons.mjs
// Generates high-res PWA and Apple Touch icons using Sharp with pure vector paths (no external font dependencies).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const iconsDir = resolve(rootDir, 'public', 'icons');

await mkdir(iconsDir, { recursive: true });

function generateIconSvg({ size, maskable = false }) {
  // Pure vector path for Serif 'N' normalized on a 100x100 grid:
  // Center is (50, 50). Elegant proportions with serifs and confident diagonal.
  const nPath100 = "M 23,24 L 38,24 L 38,27.5 L 34,28.5 L 34,71.5 L 38,72.5 L 38,76 L 23,76 L 23,72.5 L 27,71.5 L 27,28.5 L 23,27.5 Z M 32.5,26 L 37,26 L 68,73 L 68,28.5 L 63.5,27.5 L 63.5,24 L 77,24 L 77,27.5 L 73,28.5 L 73,71.5 L 77,72.5 L 77,76 L 65,76 L 32.5,26 Z";

  const padding = maskable ? size * 0.12 : size * 0.05;
  const innerSize = size - padding * 2;
  const radius = maskable ? size * 0.18 : size * 0.22;
  const strokeWidth = Math.max(2, Math.round(size * 0.025));
  const innerStrokeWidth = Math.max(1, Math.round(size * 0.012));

  // Scale and translate the 100x100 N monogram to fit proportionally in the center
  const glyphScale = (innerSize * 0.62) / 100;
  const glyphOffset = (size - 100 * glyphScale) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#2a180b"/>
        <stop offset="50%" stop-color="#180e06"/>
        <stop offset="100%" stop-color="#0e0703"/>
      </linearGradient>
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f7dc8e"/>
        <stop offset="50%" stop-color="#c99839"/>
        <stop offset="100%" stop-color="#805615"/>
      </linearGradient>
      <linearGradient id="nGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#fff6e0"/>
        <stop offset="100%" stop-color="#e6cca0"/>
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
        <feDropShadow dx="0" dy="${Math.round(size * 0.02)}" stdDeviation="${Math.round(size * 0.02)}" flood-color="#000000" flood-opacity="0.6"/>
      </filter>
      <filter id="glyphShadow" x="-10%" y="-10%" width="130%" height="130%">
        <feDropShadow dx="0" dy="${Math.round(size * 0.012)}" stdDeviation="${Math.round(size * 0.01)}" flood-color="#000000" flood-opacity="0.75"/>
      </filter>
    </defs>

    <!-- Base Canvas (fills complete viewport for maskable icons) -->
    <rect width="${size}" height="${size}" fill="#120a04"/>

    <!-- Shield Plate -->
    <rect
      x="${padding}"
      y="${padding}"
      width="${innerSize}"
      height="${innerSize}"
      rx="${radius}"
      fill="url(#woodGrad)"
      stroke="url(#goldGrad)"
      stroke-width="${strokeWidth}"
      filter="url(#shadow)"
    />

    <!-- Inner Filigree Inset -->
    <rect
      x="${padding + strokeWidth * 1.5}"
      y="${padding + strokeWidth * 1.5}"
      width="${innerSize - strokeWidth * 3}"
      height="${innerSize - strokeWidth * 3}"
      rx="${Math.max(4, radius - strokeWidth * 1.5)}"
      fill="none"
      stroke="url(#goldGrad)"
      stroke-width="${innerStrokeWidth}"
      stroke-opacity="0.35"
      stroke-dasharray="${Math.round(size * 0.035)},${Math.round(size * 0.02)}"
    />

    <!-- Tavern 'N' Monogram Crest -->
    <g transform="translate(${glyphOffset}, ${glyphOffset}) scale(${glyphScale})" filter="url(#glyphShadow)">
      <path d="${nPath100}" fill="url(#nGrad)" stroke="url(#goldGrad)" stroke-width="0.75" />
    </g>
  </svg>`;
}

const targets = [
  { file: 'public/icons/icon-192.png', size: 192, maskable: false },
  { file: 'public/icons/icon-512.png', size: 512, maskable: false },
  { file: 'public/icons/icon-maskable-192.png', size: 192, maskable: true },
  { file: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
  { file: 'public/apple-touch-icon.png', size: 180, maskable: false },
];

console.log('Generating PWA icons...');
for (const target of targets) {
  const svg = generateIconSvg({ size: target.size, maskable: target.maskable });
  const outPath = resolve(rootDir, target.file);
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${target.file} (${target.size}x${target.size}${target.maskable ? ' maskable' : ''})`);
}

console.log('All PWA icons generated successfully!');
