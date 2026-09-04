import fs from 'node:fs';
import { loadRaster, analyseSubRegion, parseColor } from './measure-contrast.mjs';

const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
const BOLD_WEIGHT = 700;

function thresholdFor(sizePx, weight) {
  if (sizePx >= LARGE_PX) { return 3; }
  if (sizePx >= LARGE_BOLD_PX && weight >= BOLD_WEIGHT) { return 3; }
  return 4.5;
}

function readBlock(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  const e = text.indexOf(endMarker);
  if (s < 0 || e < 0 || e < s) { return null; }
  return text.slice(s + startMarker.length, e).trim();
}

function readPrefixed(text, prefix) {
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.indexOf(prefix + ' ') === 0) { return t.slice(prefix.length + 1).trim(); }
  }
  return null;
}

function flatten(value) {
  return String(value == null ? '' : value).split('\n').join(' ').slice(0, 60);
}

async function run() {
  const logPath = process.argv[2];
  const minIndex = process.argv.indexOf('--min');
  const minOverride = minIndex > 0 ? parseFloat(process.argv[minIndex + 1]) : null;

  if (!logPath) {
    console.error('Usage: node scripts/audit-contrast.mjs <harnessLogPath> [--min RATIO]');
    process.exit(1);
  }

  const text = fs.readFileSync(logPath, 'utf8');
  const shotPath = readPrefixed(text, 'SHOT_PATH');
  const shotSha = readPrefixed(text, 'SHOT_SHA256');
  const shotDocH = readPrefixed(text, 'SHOT_DOCH');
  const probeRaw = readBlock(text, 'TEXT_PROBE_START', 'TEXT_PROBE_END');

  if (!shotPath || !probeRaw) {
    console.error('LOG_INCOMPLETE shotPath=' + shotPath + ' probe=' + (probeRaw ? 'present' : 'missing'));
    process.exit(1);
  }

  const probe = JSON.parse(probeRaw);
  const items = probe.items || probe.candidates || probe.valid || [];

  console.log('AUDIT_LOG ' + logPath);
  console.log('AUDIT_SHOT ' + shotPath);
  console.log('AUDIT_SHOT_SHA256 ' + shotSha);
  console.log('AUDIT_SHOT_DOCH ' + shotDocH);
  console.log('AUDIT_ITEMS ' + items.length);
  console.log('AUDIT_MIN_OVERRIDE ' + (minOverride === null ? 'NONE' : minOverride));

  if (items.length === 0) {
    console.error('NO_ITEMS keys=' + Object.keys(probe).join(','));
    process.exit(1);
  }

  const raster = await loadRaster(shotPath);
  console.log('AUDIT_RASTER ' + raster.info.width + ' ' + raster.info.height + ' ' + raster.info.channels);

  let pass = 0;
  let fail = 0;
  let unmeasured = 0;
  let dupRect = 0;
  let clampedCount = 0;
  let badColor = 0;
  let badRatio = 0;
  const seen = new Set();

  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const rect = it.documentRect || {};
    const left = rect.left;
    const top = rect.top;
    const w = rect.width;
    const h = rect.height;
    const key = left + ':' + top + ':' + w + ':' + h;
    const isDup = seen.has(key);
    if (isDup) { dupRect++; }
    seen.add(key);

    const sizePx = parseFloat(String(it.fontSize));
    const weight = Number(it.numericWeight || parseInt(String(it.fontWeight), 10) || 400);
    const threshold = minOverride === null ? thresholdFor(sizePx, weight) : minOverride;

    const head = 'ITEM ' + n + ' ' + it.tag + ' id=' + (it.id || '-')
      + ' size=' + sizePx + ' weight=' + weight
      + ' rect=' + key + (isDup ? ' DUP_RECT' : '');

    const parsed = parseColor(it.color);
    const colorReadable = parsed !== null
      && Number.isFinite(Number(parsed.r))
      && Number.isFinite(Number(parsed.g))
      && Number.isFinite(Number(parsed.b));
    if (!colorReadable) {
      unmeasured++;
      badColor++;
      console.log(head + ' STATUS UNMEASURED_BAD_COLOR need=' + threshold
        + ' color=' + it.color + ' text=' + flatten(it.text));
      continue;
    }

    const a = analyseSubRegion(raster, left, top, w, h, it.color);

    if (a === null) {
      unmeasured++;
      console.log(head + ' STATUS UNMEASURED_OFF_RASTER need=' + threshold);
      continue;
    }
    if (a.clamped) { clampedCount++; }

    const ratio = a.contrastModal;
    if (!Number.isFinite(ratio)) {
      unmeasured++;
      badRatio++;
      console.log(head + ' STATUS UNMEASURED_BAD_RATIO need=' + threshold
        + ' color=' + it.color + ' text=' + flatten(it.text));
      continue;
    }
    const bgStr = 'bg=rgb(' + a.bg.r + ', ' + a.bg.g + ', ' + a.bg.b + ')';
    const tail = ' ratio=' + ratio.toFixed(2) + ' need=' + threshold + ' ' + bgStr
      + ' share=' + a.bgShare.toFixed(4) + (a.clamped ? ' CLAMPED' : '');

    if (a.bgConfidence === 'LOW') {
      unmeasured++;
      console.log(head + ' STATUS UNMEASURED_LOW_CONFIDENCE' + tail
        + ' text=' + flatten(it.text));
      continue;
    }
    if (ratio >= threshold) {
      pass++;
      console.log(head + ' STATUS PASS' + tail);
    } else {
      fail++;
      console.log(head + ' STATUS FAIL' + tail + ' color=' + it.color
        + ' text=' + flatten(it.text));
    }
  }

  console.log('AUDIT_TOTAL ' + items.length);
  console.log('AUDIT_PASS ' + pass);
  console.log('AUDIT_FAIL ' + fail);
  console.log('AUDIT_UNMEASURED ' + unmeasured);
  console.log('AUDIT_DUP_RECT ' + dupRect);
  console.log('AUDIT_CLAMPED ' + clampedCount);
  console.log('AUDIT_BAD_COLOR ' + badColor);
  console.log('AUDIT_BAD_RATIO ' + badRatio);
  console.log('AUDIT_STATUS ' + (fail > 0 ? 'FAIL' : (unmeasured > 0 ? 'INCOMPLETE' : 'PASS')));
  process.exit(fail > 0 || unmeasured > 0 ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
