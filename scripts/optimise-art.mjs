import fs from 'node:fs';
import sharp from 'sharp';

const [, , inputPath, baseName, widthsArg, outDirArg] = process.argv;
const outDir = outDirArg || 'public/art';

if (!inputPath || !baseName) {
  console.error('Usage: npm run art <input-path> <base-name> [widths-csv] [output-dir]');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

let widths = [1280, 2560];
if (widthsArg) {
  widths = widthsArg.split(',').map(w => Number(w.trim()));
  for (const w of widths) {
    if (isNaN(w) || w <= 0) {
      console.error(`ERROR: Invalid width. Widths must be positive numbers.`);
      process.exit(1);
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });

const BUDGET_KB = 150;
const BUDGET_BYTES = BUDGET_KB * 1024;

async function optimise() {
  const writtenFiles = [];

  for (const width of widths) {
    const outputPath = `${outDir}/${baseName}-${width}.webp`;
    
    // WebP with high quality but within budget constraints
    await sharp(inputPath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 6 })
      .toFile(outputPath);

    writtenFiles.push(outputPath);

    const stats = fs.statSync(outputPath);
    console.log(`Generated ${outputPath}: ${(stats.size / 1024).toFixed(2)} KB`);

    if (stats.size > BUDGET_BYTES) {
      console.error(`ERROR: ${outputPath} exceeds budget of ${BUDGET_KB} KB!`);
      for (const file of writtenFiles) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); }
        catch (e) { console.error(`WARNING: could not delete ${file}: ${e.message}`); }
      }
      process.exit(1);
    }

    const buf = fs.readFileSync(outputPath);
    const metadata = await sharp(buf).metadata();
    if (metadata.width !== width) {
      console.error(`ERROR: ${outputPath} width mismatch! Expected ${width}, got ${metadata.width}.`);
      for (const file of writtenFiles) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); }
        catch (e) { console.error(`WARNING: could not delete ${file}: ${e.message}`); }
      }
      process.exit(1);
    }
  }
  console.log('Optimisation complete.');
}

optimise().catch(err => {
  console.error('Optimisation failed:', err);
  process.exit(1);
});
