import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const targetDir = 'C:/antigravity-proj/IbemCabahug';
const readmePath = path.join(targetDir, 'README.md');
const assetsDir = path.join(targetDir, 'assets');
const bookplateSvgPath = path.join(assetsDir, 'artificer_bookplate.svg');

const finalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 72" width="100%" height="72" style="max-width: 680px; display: block;">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1c150e" />
      <stop offset="100%" stop-color="#100b07" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe4a0" stop-opacity="0.16" />
      <stop offset="100%" stop-color="#ffe4a0" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#e8c574" />
      <stop offset="50%" stop-color="#fff4d4" />
      <stop offset="100%" stop-color="#e8c574" />
    </linearGradient>
    <linearGradient id="brassRule" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#a87a27" stop-opacity="0" />
      <stop offset="25%" stop-color="#cda85a" stop-opacity="0.85" />
      <stop offset="50%" stop-color="#ffe4a0" stop-opacity="1" />
      <stop offset="75%" stop-color="#cda85a" stop-opacity="0.85" />
      <stop offset="100%" stop-color="#a87a27" stop-opacity="0" />
    </linearGradient>
    <filter id="shadow" x="-2%" y="-10%" width="104%" height="130%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.4" />
    </filter>
  </defs>

  <!-- Outer Plate Frame -->
  <rect x="2" y="2" width="676" height="68" rx="7" fill="url(#bgGrad)" stroke="#a87a27" stroke-width="1.2" filter="url(#shadow)" />
  
  <!-- Hearth Glow -->
  <rect x="3" y="3" width="674" height="66" rx="6" fill="url(#glow)" />

  <!-- Inner Inset Frame -->
  <rect x="7" y="7" width="666" height="58" rx="4" fill="none" stroke="#cda85a" stroke-opacity="0.25" stroke-width="0.75" />

  <!-- Corner Diamonds -->
  <polygon points="12,12 15.5,8.5 19,12 15.5,15.5" fill="#cda85a" />
  <polygon points="661,12 664.5,8.5 668,12 664.5,15.5" fill="#cda85a" />
  <polygon points="12,60 15.5,56.5 19,60 15.5,63.5" fill="#cda85a" />
  <polygon points="661,60 664.5,56.5 668,60 664.5,63.5" fill="#cda85a" />

  <!-- Top Inset Diamond -->
  <polygon points="340,5 343,7 340,9 337,7" fill="#cda85a" opacity="0.6" />

  <!-- Name -->
  <text x="340" y="33" text-anchor="middle" font-family="'Cinzel', Georgia, 'Times New Roman', serif" font-size="19" font-weight="600" letter-spacing="0.22em" fill="url(#gold)">NHOVEM CABAHUG</text>

  <!-- Decorative Center Rule with Micro Diamond -->
  <line x1="220" y1="41" x2="460" y2="41" stroke="url(#brassRule)" stroke-width="0.85" />
  <polygon points="340,38.5 342.5,41 340,43.5 337.5,41" fill="#fff2ce" />

  <!-- Subtitle -->
  <text x="340" y="55" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="600" letter-spacing="0.28em" fill="#c49e58">WEB DEVELOPER</text>
</svg>`;

const readmeContent = `<p align="left">
  <img src="assets/artificer_bookplate.svg" alt="Nhovem Cabahug — Web Developer" width="680" />
</p>

High-performance browser graphics, accessibility, and relational systems.

- **Live Portfolio & Interactive Case Studies:** [portfolio-ibem.vercel.app](https://portfolio-ibem.vercel.app)
- **Primary Codebases:** Pinned below (\`ArcaneTyper\`, \`bits\`, \`portfolio\`)
- **Direct Contact:** [ncabahug223@gmail.com](mailto:ncabahug223@gmail.com)
`;

// Ensure assets dir exists in profile repo
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

fs.writeFileSync(bookplateSvgPath, finalSvg, 'utf8');
fs.writeFileSync(readmePath, readmeContent, 'utf8');

// Mirror in docs repo
const docsDir = 'c:/antigravity-proj/web-portfolio/docs/portfolio-docs';
const docsAssetsDir = path.join(docsDir, 'assets');
if (!fs.existsSync(docsAssetsDir)) {
  fs.mkdirSync(docsAssetsDir, { recursive: true });
}

fs.writeFileSync(path.join(docsAssetsDir, 'artificer_bookplate.svg'), finalSvg, 'utf8');
fs.writeFileSync(path.join(docsDir, 'github-profile-README.md'), readmeContent, 'utf8');

console.log('Artificer Bookplate and profile README successfully deployed!');
