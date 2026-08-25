import sharp from 'sharp';

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHex(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16)
  };
}

async function run() {
  const [, , imagePath, xStr, yStr, wStr, hStr, textHex] = process.argv;
  if (!imagePath || !xStr || !yStr || !wStr || !hStr || !textHex) {
    console.error('Usage: node scripts/measure-contrast.mjs <imagePath> <x> <y> <w> <h> <textColorHex>');
    process.exit(1);
  }

  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);
  const w = parseInt(wStr, 10);
  const h = parseInt(hStr, 10);

  const { r: tr, g: tg, b: tb } = parseHex(textHex);
  const textLuminance = getLuminance(tr, tg, tb);

  const { data, info } = await sharp(imagePath)
    .extract({ left: x, top: y, width: w, height: h })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minL = 1;
  let maxL = 0;
  let minColor = null;
  let maxColor = null;

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = getLuminance(r, g, b);
    if (lum < minL) {
      minL = lum;
      minColor = {r, g, b};
    }
    if (lum > maxL) {
      maxL = lum;
      maxColor = {r, g, b};
    }
  }

  const c1 = getContrastRatio(textLuminance, minL);
  const c2 = getContrastRatio(textLuminance, maxL);

  console.log(`Text color: ${textHex}`);
  console.log(`Darkest pixel in region: rgb(${minColor.r}, ${minColor.g}, ${minColor.b}) -> Contrast: ${c1.toFixed(2)}:1`);
  console.log(`Lightest pixel in region: rgb(${maxColor.r}, ${maxColor.g}, ${maxColor.b}) -> Contrast: ${c2.toFixed(2)}:1`);
}

run().catch(console.error);
