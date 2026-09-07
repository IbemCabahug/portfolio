import fs from 'node:fs';
import path from 'node:path';

const targetDir = 'C:/antigravity-proj/IbemCabahug';
const assetsDir = path.join(targetDir, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 170" width="100%" height="auto">
  <defs>
    <linearGradient id="woodGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#24160b" />
      <stop offset="50%" stop-color="#190f07" />
      <stop offset="100%" stop-color="#120a04" />
    </linearGradient>
    <radialGradient id="hearthGlow" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#d5803b" stop-opacity="0.22" />
      <stop offset="60%" stop-color="#d5803b" stop-opacity="0.05" />
      <stop offset="100%" stop-color="#d5803b" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="brassBorder" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#6e4f20" />
      <stop offset="25%" stop-color="#c49a45" />
      <stop offset="50%" stop-color="#ffe4a0" />
      <stop offset="75%" stop-color="#c49a45" />
      <stop offset="100%" stop-color="#6e4f20" />
    </linearGradient>
  </defs>

  <rect width="800" height="170" rx="6" fill="url(#woodGrad)" />
  <rect width="800" height="170" rx="6" fill="url(#hearthGlow)" />

  <rect x="10" y="10" width="780" height="150" rx="4" fill="none" stroke="url(#brassBorder)" stroke-width="1.5" stroke-opacity="0.85" />
  <rect x="14" y="14" width="772" height="142" rx="2" fill="none" stroke="#a87a27" stroke-width="0.75" stroke-opacity="0.4" />

  <path d="M10 24 L24 10 M790 24 L776 10 M10 146 L24 160 M790 146 L776 160" stroke="#c49a45" stroke-width="1.2" />
  <circle cx="20" cy="20" r="2" fill="#ffe4a0" />
  <circle cx="780" cy="20" r="2" fill="#ffe4a0" />
  <circle cx="20" cy="150" r="2" fill="#ffe4a0" />
  <circle cx="780" cy="150" r="2" fill="#ffe4a0" />

  <text x="400" y="46" text-anchor="middle" font-family="'Cinzel', 'Trajan Pro', 'Georgia', serif" font-size="11" font-weight="600" letter-spacing="4" fill="#c49a45">TAVERN ARTIFICER &#8226; WEB DEVELOPER</text>
  <text x="400" y="94" text-anchor="middle" font-family="'Cinzel', 'Trajan Pro', 'Georgia', serif" font-size="34" font-weight="700" letter-spacing="2.5" fill="#ffe4a0">NHOVEM CABAHUG</text>

  <line x1="280" y1="110" x2="375" y2="110" stroke="#a87a27" stroke-width="1" stroke-opacity="0.6" />
  <polygon points="400,107 404,110 400,113 396,110" fill="#ffe4a0" />
  <line x1="425" y1="110" x2="520" y2="110" stroke="#a87a27" stroke-width="1" stroke-opacity="0.6" />

  <text x="400" y="136" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12.5" font-weight="400" letter-spacing="0.8" fill="#dcd0bc">High-Performance Browser Graphics &#8226; Semantic Architecture &#8226; Relational Systems</text>
</svg>`;

const portalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 68" width="100%" height="auto">
  <defs>
    <linearGradient id="portalBg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1f1308" />
      <stop offset="50%" stop-color="#2a180a" />
      <stop offset="100%" stop-color="#1f1308" />
    </linearGradient>
    <linearGradient id="portalBorder" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#6e4f20" />
      <stop offset="30%" stop-color="#d5803b" />
      <stop offset="50%" stop-color="#ffe4a0" />
      <stop offset="75%" stop-color="#d5803b" />
      <stop offset="100%" stop-color="#6e4f20" />
    </linearGradient>
  </defs>

  <rect width="800" height="68" rx="6" fill="url(#portalBg)" />
  <rect x="2" y="2" width="796" height="64" rx="4" fill="none" stroke="url(#portalBorder)" stroke-width="1.2" stroke-opacity="0.9" />

  <g transform="translate(36, 34)">
    <circle cx="0" cy="0" r="14" fill="none" stroke="#a87a27" stroke-width="1" />
    <circle cx="0" cy="0" r="10" fill="none" stroke="#ffe4a0" stroke-width="0.75" opacity="0.6" />
    <polygon points="0,-12 3,-3 12,0 3,3 0,12 -3,3 -12,0 -3,-3" fill="#ffe4a0" />
    <circle cx="0" cy="0" r="2" fill="#24160b" />
  </g>

  <text x="68" y="32" font-family="'Cinzel', 'Trajan Pro', 'Georgia', serif" font-size="14.5" font-weight="700" letter-spacing="1.2" fill="#ffe4a0">
    ENTER IBEM'S TAVERN &#8226; LIVE PORTFOLIO EXPERIENCE &#8594;
  </text>

  <text x="68" y="49" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="11.5" font-weight="400" letter-spacing="0.5" fill="#dcd0bc">
    Explore 2.5D spatial chambers, interactive live demo arenas, and complete technical dossiers at <tspan fill="#d5803b" font-weight="600">portfolio-ibem.vercel.app</tspan>
  </text>

  <g transform="translate(760, 34)">
    <circle cx="0" cy="0" r="12" fill="#24160b" stroke="#a87a27" stroke-width="1" />
    <polyline points="-3,-5 2,0 -3,5" fill="none" stroke="#ffe4a0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`;

const dividerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 16" width="100%" height="auto">
  <defs>
    <linearGradient id="divGradLeft" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#a87a27" stop-opacity="0" />
      <stop offset="100%" stop-color="#c49a45" stop-opacity="0.8" />
    </linearGradient>
    <linearGradient id="divGradRight" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#c49a45" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#a87a27" stop-opacity="0" />
    </linearGradient>
  </defs>

  <line x1="50" y1="8" x2="385" y2="8" stroke="url(#divGradLeft)" stroke-width="1" />
  <circle cx="390" cy="8" r="1.5" fill="#a87a27" />
  <polygon points="400,3 405,8 400,13 395,8" fill="#ffe4a0" stroke="#a87a27" stroke-width="0.75" />
  <circle cx="410" cy="8" r="1.5" fill="#a87a27" />
  <line x1="415" y1="8" x2="750" y2="8" stroke="url(#divGradRight)" stroke-width="1" />
</svg>`;

fs.writeFileSync(path.join(assetsDir, 'header.svg'), headerSvg, 'utf8');
fs.writeFileSync(path.join(assetsDir, 'portal.svg'), portalSvg, 'utf8');
fs.writeFileSync(path.join(assetsDir, 'divider.svg'), dividerSvg, 'utf8');

const readmeContent = `<p align="center">
  <img src="assets/header.svg" alt="Nhovem Cabahug — Web Developer" width="100%" />
</p>

<p align="center">
  <a href="https://portfolio-ibem.vercel.app">
    <img src="assets/portal.svg" alt="Enter Ibem's Tavern · Live Portfolio Experience" width="100%" />
  </a>
</p>

<p align="center">
  <img src="assets/divider.svg" alt="" width="100%" />
</p>

### Selected Codebases & Systems

The repositories below showcase core engineering solutions, high-performance browser rendering, and relational architectures. Explore their source code directly or visit the live portfolio above for interactive execution:

◆ **[ArcaneTyper](https://github.com/IbemCabahug/ArcaneTyper)** — High-performance browser combat typing game featuring a 60 FPS \`requestAnimationFrame\` game loop with falling word collision physics and zero-latency procedural Web Audio synthesis.

◆ **[bits](https://github.com/IbemCabahug/bits)** — Enterprise time-and-attendance platform interfacing with ZKTeco biometric hardware terminals, architected with PostgreSQL ACID transaction boundaries across 25 relational models to eliminate partial record anomalies during batch approvals.

◆ **[portfolio](https://github.com/IbemCabahug/portfolio)** — Accessible 2.5D medieval tavern portfolio engine built in Astro 7 and Vanilla CSS, featuring real-time build telemetry, 100/100 Lighthouse accessibility, and an instant Zero-JS fallback mode.

<p align="center">
  <img src="assets/divider.svg" alt="" width="100%" />
</p>

### Verified Quality Standards

· **Accessibility:** 100/100 Lighthouse score · 0 axe-core automated violations across all routes  
· **Performance:** LCP < 2.5s · Initial JavaScript in Simple Mode: 0 bytes  
· **Type Safety:** Astro 7 + strict TypeScript · Zero compiler warnings  

<p align="center">
  <img src="assets/divider.svg" alt="" width="100%" />
</p>

### Coordinates

· **Location:** Philippines  
· **Email:** [ncabahug223@gmail.com](mailto:ncabahug223@gmail.com)  
· **Portfolio:** [portfolio-ibem.vercel.app](https://portfolio-ibem.vercel.app)
`;

fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent, 'utf8');

// Also sync to docs repo
const docsTargetDir = 'c:/antigravity-proj/web-portfolio/docs/portfolio-docs';
const docsAssetsDir = path.join(docsTargetDir, 'assets');
if (!fs.existsSync(docsAssetsDir)) fs.mkdirSync(docsAssetsDir, { recursive: true });
fs.writeFileSync(path.join(docsAssetsDir, 'header.svg'), headerSvg, 'utf8');
fs.writeFileSync(path.join(docsAssetsDir, 'portal.svg'), portalSvg, 'utf8');
fs.writeFileSync(path.join(docsAssetsDir, 'divider.svg'), dividerSvg, 'utf8');
fs.writeFileSync(path.join(docsTargetDir, 'github-profile-README.md'), readmeContent, 'utf8');

console.log('Successfully written pure UTF-8 files to both repos.');
