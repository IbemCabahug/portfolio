import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import axe from 'axe-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';

const GIT_EXE = 'C:\\Program Files\\Git\\cmd\\git.exe';

async function main() {
  let rawRoute = process.argv[2] || 'simple';

  // Handle Git Bash / MSYS POSIX path conversion on Windows where '/' is mangled to 'C:/Program Files/Git/'
  const mangleToken = 'Program Files/Git';
  const mIdx = rawRoute.indexOf(mangleToken);
  if (mIdx !== -1) {
    rawRoute = rawRoute.substring(mIdx + mangleToken.length);
    if (!rawRoute || rawRoute === '') rawRoute = '/';
  }

  const clean = rawRoute.replace(/^\/+/, '').replace(/\/+$/, '');

  let routeFilePath = null;
  if (clean === '') {
    const p = join('dist', 'index.html');
    if (existsSync(p)) routeFilePath = p;
  } else {
    const p1 = join('dist', clean, 'index.html');
    const p2 = join('dist', clean + '.html');
    const p3 = join('dist', clean);
    if (existsSync(p1) && statSync(p1).isFile()) routeFilePath = p1;
    else if (existsSync(p2) && statSync(p2).isFile()) routeFilePath = p2;
    else if (existsSync(p3) && statSync(p3).isFile()) routeFilePath = p3;
  }

  if (!routeFilePath) {
    console.log('AX_STATUS = UNKNOWN_ROUTE');
    process.exit(1);
  }

  const routeBytesBuffer = await readFile(routeFilePath);
  const routeBytes = routeBytesBuffer.length;
  const routeSha256 = createHash('sha256').update(routeBytesBuffer).digest('hex');
  const routeFile = routeFilePath.split(sep).join('/');

  let srv = null;
  let browser = null;
  let page = null;

  try {
    srv = await createDistServer({ root: 'dist', port: 0, quiet: true });
    const url = clean === '' ? `${srv.origin}/` : `${srv.origin}/${clean}`;

    const runStartedAt = new Date().toISOString();
    const runStartMs = Date.now();
    console.log(`AX_STARTED_AT ${runStartedAt}`);
    console.log(`AX_ROOT ${srv.root}`);
    console.log(`AX_PORT ${srv.port}`);
    console.log(`AX_INDEX_MTIME ${srv.indexMtime}`);
    console.log(`AX_ROUTE ${rawRoute}`);
    console.log(`AX_ROUTE_FILE ${routeFile}`);
    console.log(`AX_ROUTE_BYTES ${routeBytes}`);
    console.log(`AX_ROUTE_SHA256 ${routeSha256}`);
    console.log(`AX_URL ${url}`);

    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    await page.evaluate(axe.source);

    const runTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
    const results = await page.evaluate(async (tags) => {
      return await axe.run({
        runOnly: {
          type: 'tag',
          values: tags,
        },
      });
    }, runTags);

    console.log(`AX_WALL_MS ${Date.now() - runStartMs}`);

    let measuredCommit = 'UNKNOWN';
    let treeDirty = 'UNKNOWN';
    try {
      measuredCommit = execFileSync(GIT_EXE, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      treeDirty = execFileSync(GIT_EXE, ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '' ? 'CLEAN' : 'DIRTY';
    } catch {
      try {
        measuredCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        treeDirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === '' ? 'CLEAN' : 'DIRTY';
      } catch {
        measuredCommit = treeDirty = 'GIT_UNAVAILABLE';
      }
    }
    console.log(`AX_COMMIT ${measuredCommit}`);
    console.log(`AX_TREE ${treeDirty}`);

    const axePkgPath = resolve('node_modules', 'axe-core', 'package.json');
    let axeVersion = axe.version;
    try {
      const pkg = JSON.parse(await readFile(axePkgPath, 'utf8'));
      if (pkg.version) axeVersion = pkg.version;
    } catch {
      // fallback
    }

    const violationsCount = results.violations?.length ?? 0;
    const passesCount = results.passes?.length ?? 0;
    const incompleteCount = results.incomplete?.length ?? 0;
    const inapplicableCount = results.inapplicable?.length ?? 0;

    const uniqueRuleIds = new Set([
      ...(results.violations || []).map(r => r.id),
      ...(results.passes || []).map(r => r.id),
      ...(results.incomplete || []).map(r => r.id),
      ...(results.inapplicable || []).map(r => r.id),
    ]);
    const expectedRuleCount = axe.getRules().filter(r => r.enabled !== false && !r.tags.includes('experimental')).length;
    const arithmeticStatus = (uniqueRuleIds.size === expectedRuleCount) ? 'OK' : 'MISMATCH';

    console.log('AX_START');
    console.log(`AX_AXE_VERSION ${axeVersion}`);
    console.log(`AX_VIOLATIONS ${violationsCount}`);
    console.log(`AX_PASSES ${passesCount}`);
    console.log(`AX_INCOMPLETE ${incompleteCount}`);
    console.log(`AX_INAPPLICABLE ${inapplicableCount}`);
    console.log(`AX_ARITHMETIC ${arithmeticStatus}`);
    for (const v of (results.violations || [])) {
      console.log(`AX_VIOLATION ${v.id} ${v.impact || 'unknown'} ${v.nodes?.length ?? 0}`);
    }
    console.log(`AX_TAGS ${runTags.join(',')}`);
    console.log('AX_END');
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    if (srv) {
      try {
        await srv.close();
      } catch {
        // ignore
      }
    }
  }
}

await main();
