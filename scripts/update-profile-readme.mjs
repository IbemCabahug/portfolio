import fs from 'node:fs';
import path from 'node:path';

const targetDir = 'C:/antigravity-proj/IbemCabahug';
const readmePath = path.join(targetDir, 'README.md');
const assetsDir = path.join(targetDir, 'assets');

const content = `# Nhovem Cabahug

**Web Developer** · High-performance browser graphics, accessibility, and relational systems.

- **Live Portfolio & Interactive Case Studies:** [portfolio-ibem.vercel.app](https://portfolio-ibem.vercel.app)
- **Primary Codebases:** Pinned below (\`ArcaneTyper\`, \`bits\`, \`portfolio\`)
- **Direct Contact:** [ncabahug223@gmail.com](mailto:ncabahug223@gmail.com)
`;

fs.writeFileSync(readmePath, content, 'utf8');

// Remove assets folder from profile repo if exists
if (fs.existsSync(assetsDir)) {
  fs.rmSync(assetsDir, { recursive: true, force: true });
}

// Sync to docs repo
const docsDir = 'c:/antigravity-proj/web-portfolio/docs/portfolio-docs';
fs.writeFileSync(path.join(docsDir, 'github-profile-README.md'), content, 'utf8');
const docsAssetsDir = path.join(docsDir, 'assets');
if (fs.existsSync(docsAssetsDir)) {
  fs.rmSync(docsAssetsDir, { recursive: true, force: true });
}

console.log('Ultra-minimalist README successfully written.');
