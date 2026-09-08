import fs from 'node:fs';
import path from 'node:path';

const targetDir = 'C:/antigravity-proj/IbemCabahug';
const readmePath = path.join(targetDir, 'README.md');
const assetsDir = path.join(targetDir, 'assets');

const pureTextContent = `# Nhovem Cabahug

**Web Developer** · High-performance browser graphics, accessibility, and relational systems.

- **Live Portfolio & Interactive Case Studies:** [portfolio-ibem.vercel.app](https://portfolio-ibem.vercel.app)
- **Primary Codebases:** Pinned below (\`ArcaneTyper\`, \`bits\`, \`portfolio\`)
- **Direct Contact:** [cabahugnhovem@gmail.com](mailto:cabahugnhovem@gmail.com)
`;

// Write pure markdown README
fs.writeFileSync(readmePath, pureTextContent, 'utf8');

// Remove assets folder in profile repo if exists
if (fs.existsSync(assetsDir)) {
  fs.rmSync(assetsDir, { recursive: true, force: true });
}

// Mirror to docs repository
const docsDir = 'c:/antigravity-proj/web-portfolio/docs/portfolio-docs';
const docsAssetsDir = path.join(docsDir, 'assets');
fs.writeFileSync(path.join(docsDir, 'github-profile-README.md'), pureTextContent, 'utf8');

if (fs.existsSync(docsAssetsDir)) {
  fs.rmSync(docsAssetsDir, { recursive: true, force: true });
}

console.log('Reverted to pure-text GitHub profile without design.');
