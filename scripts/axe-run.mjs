import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import axeSource from 'axe-core';
import { createDistServer } from './serve-dist.mjs';

const startedAt = new Date().toISOString();
const startMs = Date.now();

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const GIT_PATHS = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
];

function getGitProvenance() {
  for (const gitPath of GIT_PATHS) {
    if (fs.existsSync(gitPath)) {
      try {
        const commit = execFileSync(gitPath, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const status = execFileSync(gitPath, ['status', '--porcelain'], { encoding: 'utf8' }).trim();
        return { commit, tree: status ? 'DIRTY' : 'CLEAN' };
      } catch {}
    }
  }
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    return { commit, tree: status ? 'DIRTY' : 'CLEAN' };
  } catch {
    return { commit: 'GIT_UNAVAILABLE', tree: 'UNKNOWN' };
  }
}

function getAxeVersion() {
  try {
    const axePkgPath = path.resolve('node_modules', 'axe-core', 'package.json');
    const axePkg = JSON.parse(fs.readFileSync(axePkgPath, 'utf8'));
    return axePkg.version || 'UNKNOWN';
  } catch {
    return axeSource.version || 'UNKNOWN';
  }
}

let rawRoute = process.argv[2];
if (rawRoute === undefined) {
  console.log('AX_STATUS = UNKNOWN_ROUTE');
  process.exit(1);
}

// Handle Git Bash / MSYS POSIX path conversion on Windows where '/' is mangled to 'C:/Program Files/Git/'
const mangleToken = 'Program Files/Git';
const mIdx = rawRoute.indexOf(mangleToken);
if (mIdx !== -1) {
  rawRoute = rawRoute.substring(mIdx + mangleToken.length);
  if (!rawRoute || rawRoute === '') rawRoute = '/';
}

const clean = rawRoute.replace(/^\/+/, '').replace(/\/+$/, '');

const distDir = path.resolve('dist');
let routeFilePath = null;
if (clean === '') {
  const p = path.join(distDir, 'index.html');
  if (fs.existsSync(p) && fs.statSync(p).isFile()) routeFilePath = p;
} else {
  const p1 = path.join(distDir, clean, 'index.html');
  const p2 = path.join(distDir, `${clean}.html`);
  const p3 = path.join(distDir, clean);
  if (fs.existsSync(p1) && fs.statSync(p1).isFile()) routeFilePath = p1;
  else if (fs.existsSync(p2) && fs.statSync(p2).isFile()) routeFilePath = p2;
  else if (fs.existsSync(p3) && fs.statSync(p3).isFile()) routeFilePath = p3;
}

if (!routeFilePath) {
  console.log('AX_STATUS = UNKNOWN_ROUTE');
  process.exit(1);
}

const edgePath = EDGE_PATHS.find((p) => fs.existsSync(p));
if (!edgePath) {
  console.error('No Edge executable found');
  process.exit(1);
}

let server;
let browser;

try {
  server = await createDistServer({ root: distDir, port: 0 });
  const serverPort = server.port;
  const indexHtmlPath = path.join(distDir, 'index.html');
  const indexMtime = fs.existsSync(indexHtmlPath) ? fs.statSync(indexHtmlPath).mtime.toISOString() : 'MISSING';

  const fileBytes = fs.statSync(routeFilePath).size;
  const fileBuffer = fs.readFileSync(routeFilePath);
  const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const normalizedRoute = clean === '' ? '/' : `/${clean}`;
  const relativeFile = path.relative(process.cwd(), routeFilePath).replace(/\\/g, '/');
  const pageUrl = clean === '' ? `${server.baseUrl}/` : `${server.baseUrl}/${clean}`;

  console.log(`AX_ROOT ${distDir.replace(/\\/g, '/')}`);
  console.log(`AX_PORT ${serverPort}`);
  console.log(`AX_INDEX_MTIME ${indexMtime}`);
  console.log(`AX_ROUTE ${normalizedRoute}`);
  console.log(`AX_ROUTE_FILE ${relativeFile}`);
  console.log(`AX_ROUTE_BYTES ${fileBytes}`);
  console.log(`AX_ROUTE_SHA256 ${fileSha256}`);
  console.log(`AX_URL ${pageUrl}`);
  console.log(`AX_STARTED_AT ${startedAt}`);

  let launchArgs = [];
  let sandboxDisabled = false;
  try {
    browser = await puppeteer.launch({
      executablePath: edgePath,
      headless: true,
      args: launchArgs,
    });
  } catch {
    launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    sandboxDisabled = true;
    browser = await puppeteer.launch({
      executablePath: edgePath,
      headless: true,
      args: launchArgs,
    });
  }
  if (sandboxDisabled) {
    console.log('AX_SANDBOX DISABLED');
  }

  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'networkidle0' });

  // Inject and run axe-core
  const axeRawSource = axeSource.source;
  await page.evaluate(axeRawSource);

  const evalResult = await page.evaluate(async () => {
    const rulesTotal = window.axe.getRules().length;
    const results = await window.axe.run(document, {
      resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],
    });
    return {
      rulesTotal,
      results,
    };
  });

  const { rulesTotal, results } = evalResult;

  const provenance = getGitProvenance();
  const wallMs = Date.now() - startMs;
  const axeVersion = getAxeVersion();

  console.log(`AX_WALL_MS ${wallMs}`);
  console.log(`AX_COMMIT ${provenance.commit}`);
  console.log(`AX_TREE ${provenance.tree}`);

  console.log('AX_START');
  console.log(`AX_AXE_VERSION ${axeVersion}`);

  const violationsCount = results.violations ? results.violations.length : 0;
  const passesCount = results.passes ? results.passes.length : 0;
  const incompleteCount = results.incomplete ? results.incomplete.length : 0;
  const inapplicableCount = results.inapplicable ? results.inapplicable.length : 0;

  console.log(`AX_VIOLATIONS ${violationsCount}`);
  console.log(`AX_PASSES ${passesCount}`);
  console.log(`AX_INCOMPLETE ${incompleteCount}`);
  console.log(`AX_INAPPLICABLE ${inapplicableCount}`);

  const rulesConsidered = violationsCount + passesCount + incompleteCount + inapplicableCount;
  console.log(`AX_RULES_TOTAL ${rulesTotal}`);
  console.log(`AX_RULES_CONSIDERED ${rulesConsidered}`);

  const diff = rulesConsidered - rulesTotal;
  const arithmeticStatus = diff === 0 ? 'OK' : `MISMATCH ${diff > 0 ? '+' : ''}${diff}`;
  console.log(`AX_ARITHMETIC ${arithmeticStatus}`);

  const allRules = [
    ...(results.violations || []),
    ...(results.passes || []),
    ...(results.incomplete || []),
    ...(results.inapplicable || []),
  ];
  const uniqueRuleIds = new Set(allRules.map((r) => r.id));
  const duplicates = allRules.length - uniqueRuleIds.size;
  console.log(`AX_DUPLICATES ${duplicates}`);

  for (const v of results.violations || []) {
    const nodeCount = v.nodes ? v.nodes.length : 0;
    console.log(`AX_VIOLATION ${v.id} ${v.impact} ${nodeCount}`);
  }

  const tagsSet = new Set();
  for (const r of allRules) {
    if (Array.isArray(r.tags)) {
      for (const t of r.tags) {
        tagsSet.add(t);
      }
    }
  }
  const sortedTags = Array.from(tagsSet).sort().join(' ');
  console.log(`AX_TAGS ${sortedTags}`);
  console.log('AX_END');
} catch (err) {
  console.error('Error running axe-run.mjs:', err);
  process.exit(1);
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (server) {
    await server.close().catch(() => {});
  }
}
