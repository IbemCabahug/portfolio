import fs from 'node:fs';
import sharp from 'sharp';

const [, , inputPath, baseName] = process.argv;

if (!inputPath || !baseName) {
  console.error('Usage: npm run art <input-path> <base-name>');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const BUDGET_KB = 150;
const BUDGET_BYTES = BUDGET_KB * 1024;

async function optimise() {
  const widths = [1280, 2560];
  for (const width of widths) {
    const outputPath = `public/art/${baseName}-${width}.webp`;
    
    // WebP with high quality but within budget constraints
    await sharp(inputPath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 6 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    console.log(`Generated ${outputPath}: ${(stats.size / 1024).toFixed(2)} KB`);

    if (stats.size > BUDGET_BYTES) {
      console.error(`ERROR: ${outputPath} exceeds budget of ${BUDGET_KB} KB!`);
      process.exit(1);
    }
  }
  console.log('Optimisation complete.');
}

optimise().catch(err => {
  console.error('Optimisation failed:', err);
  process.exit(1);
});
