import sharp from 'sharp';

export function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function getContrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function parseHex(hex) {
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

export function parseColor(value) {
  const s = String(value).trim();
  if (s.toLowerCase().startsWith('rgb')) {
    const open = s.indexOf('(');
    const close = s.indexOf(')');
    const parts = s.slice(open + 1, close).split(',').map((p) => parseFloat(p.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return parseHex(s);
}

export async function loadRaster(imagePath) {
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

export function analyseSubRegion(raster, x, y, w, h, textColor) {
  const data = raster.data;
  const info = raster.info;
  const ch = info.channels;
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(info.width, rx + rw);
  const y1 = Math.min(info.height, ry + rh);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  const tc = parseColor(textColor);
  const textLuminance = getLuminance(tc.r, tc.g, tc.b);
  const counts = new Map();
  let minL = 1;
  let maxL = 0;
  let minColor = null;
  let maxColor = null;
  let pixels = 0;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * info.width + px) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      pixels++;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) || 0) + 1);
      const lum = getLuminance(r, g, b);
      if (lum < minL) { minL = lum; minColor = { r, g, b }; }
      if (lum > maxL) { maxL = lum; maxColor = { r, g, b }; }
    }
  }
  let modalKey = -1;
  let modalCount = 0;
  for (const [key, count] of counts) {
    if (count > modalCount) { modalCount = count; modalKey = key; }
  }
  const bg = { r: (modalKey >> 16) & 255, g: (modalKey >> 8) & 255, b: modalKey & 255 };
  const share = modalCount / pixels;
  return {
    region: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    clamped: x0 !== rx || y0 !== ry || x1 !== rx + rw || y1 !== ry + rh,
    pixels: pixels,
    distinct: counts.size,
    textLuminance: textLuminance,
    bg: bg,
    bgShare: share,
    bgConfidence: share >= 0.5 ? 'HIGH' : 'LOW',
    contrastModal: getContrastRatio(textLuminance, getLuminance(bg.r, bg.g, bg.b)),
    darkest: { color: minColor, ratio: getContrastRatio(textLuminance, minL) },
    lightest: { color: maxColor, ratio: getContrastRatio(textLuminance, maxL) }
  };
}

async function run() {
  const [, , imagePath, xStr, yStr, wStr, hStr, textColor] = process.argv;
  if (!imagePath || !xStr || !yStr || !wStr || !hStr || !textColor) {
    console.error('Usage: node scripts/measure-contrast.mjs <imagePath> <x> <y> <w> <h> <textColorHex>');
    process.exit(1);
  }
  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);
  const w = parseInt(wStr, 10);
  const h = parseInt(hStr, 10);
  const raster = await loadRaster(imagePath);
  const a = analyseSubRegion(raster, x, y, w, h, textColor);
  if (!a) {
    console.error('EMPTY_REGION');
    process.exit(1);
  }
  console.log('TEXT_HEX ' + textColor);
  console.log('REGION ' + x + ' ' + y + ' ' + w + ' ' + h);
  console.log('PIXELS ' + a.pixels);
  console.log('DISTINCT ' + a.distinct);
  console.log('BG_MODAL rgb(' + a.bg.r + ', ' + a.bg.g + ', ' + a.bg.b + ')');
  console.log('BG_SHARE ' + a.bgShare.toFixed(4));
  console.log('BG_CONFIDENCE ' + a.bgConfidence);
  console.log('CONTRAST_MODAL ' + a.contrastModal.toFixed(2));
  console.log('DIAG_DARKEST rgb(' + a.darkest.color.r + ', ' + a.darkest.color.g + ', ' + a.darkest.color.b + ') RATIO ' + a.darkest.ratio.toFixed(2));
  console.log('DIAG_LIGHTEST rgb(' + a.lightest.color.r + ', ' + a.lightest.color.g + ', ' + a.lightest.color.b + ') RATIO ' + a.lightest.ratio.toFixed(2));
}

if (process.argv[1] && process.argv[1].endsWith('measure-contrast.mjs')) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
