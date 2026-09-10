// scripts/generate-pwa-icons.mjs
// Generates high-res PWA and Apple Touch icons using the 3D pixel art avatar.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const iconsDir = resolve(rootDir, 'public', 'icons');
const sourceAvatar = resolve(rootDir, 'public', 'art', 'profile-pixel-3d.webp');

await mkdir(iconsDir, { recursive: true });

async function generateIcons() {
  console.log('Generating PWA icons from 3D pixel avatar:', sourceAvatar);

  // 1. Apple Touch Icon (180x180): Full-bleed square, optimized for iOS squircle crop
  await sharp(sourceAvatar)
    .resize(180, 180, { fit: 'cover', position: 'top' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(rootDir, 'public', 'apple-touch-icon.png'));
  console.log('✓ Generated public/apple-touch-icon.png (180x180)');

  // 2. Standard PWA Icons (192x192 & 512x512): Full-bleed square for Chrome / Desktop
  await sharp(sourceAvatar)
    .resize(192, 192, { fit: 'cover', position: 'top' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(iconsDir, 'icon-192.png'));
  console.log('✓ Generated public/icons/icon-192.png (192x192)');

  await sharp(sourceAvatar)
    .resize(512, 512, { fit: 'cover', position: 'top' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(iconsDir, 'icon-512.png'));
  console.log('✓ Generated public/icons/icon-512.png (512x512)');

  // 3. Maskable PWA Icons (192x192 & 512x512):
  // Scaled into 80% safe zone with seamless dark tavern background (#120a06)
  // Ensures Android adaptive launcher masks (circle, squircle) never cut off the hair or chin
  for (const size of [192, 512]) {
    const innerSize = Math.round(size * 0.82); // 82% scale sits safely within Android 80% circle
    const offset = Math.round((size - innerSize) / 2);

    const resizedAvatar = await sharp(sourceAvatar)
      .resize(innerSize, innerSize, { fit: 'cover', position: 'top' })
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: { r: 18, g: 12, b: 8 } // Matches avatar ambient darkness
      }
    })
      .composite([{ input: resizedAvatar, top: offset, left: offset }])
      .png({ compressionLevel: 9 })
      .toFile(resolve(iconsDir, `icon-maskable-${size}.png`));

    console.log(`✓ Generated public/icons/icon-maskable-${size}.png (${size}x${size} maskable)`);
  }

  console.log('\nAll PWA avatar icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
