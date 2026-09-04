import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';

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
    console.log('LH_STATUS = UNKNOWN_ROUTE');
    process.exit(1);
  }

  const routeBytesBuffer = await readFile(routeFilePath);
  const routeBytes = routeBytesBuffer.length;
  const routeSha256 = createHash('sha256').update(routeBytesBuffer).digest('hex');
  const routeFile = routeFilePath.split(sep).join('/');

  let srv = null;
  const tempReportPath = join(tmpdir(), `lh-report-${randomUUID()}.json`);

  try {
    srv = await createDistServer({ root: 'dist', port: 0, quiet: true });
    const url = clean === '' ? `${srv.origin}/` : `${srv.origin}/${clean}`;

    console.log(`LH_ROOT ${srv.root}`);
    console.log(`LH_PORT ${srv.port}`);
    console.log(`LH_INDEX_MTIME ${srv.indexMtime}`);
    console.log(`LH_ROUTE ${rawRoute}`);
    console.log(`LH_ROUTE_FILE ${routeFile}`);
    console.log(`LH_ROUTE_BYTES ${routeBytes}`);
    console.log(`LH_ROUTE_SHA256 ${routeSha256}`);
    console.log(`LH_URL ${url}`);

    const lhCliPath = resolve(fileURLToPath(new URL('../node_modules/lighthouse/cli/index.js', import.meta.url)));

    const child = spawn(
      process.execPath,
      [
        lhCliPath,
        url,
        '--only-categories=accessibility,performance',
        '--output=json',
        `--output-path=${tempReportPath}`,
        '--chrome-flags=--headless=new',
        '--quiet',
        '--throttling-method=simulate',
      ],
      {
        env: {
          ...process.env,
          CHROME_PATH: EDGE,
        },
        stdio: 'inherit',
      }
    );

    const exitCode = await new Promise((res) => {
      child.on('close', (code) => res(code ?? 1));
      child.on('error', () => res(1));
    });

    console.log(`LH_EXIT ${exitCode}`);

    let report = null;
    try {
      const content = await readFile(tempReportPath, 'utf8');
      report = JSON.parse(content);
    } catch {
      // unreadable or missing
    }

    const isMeasurement =
      report &&
      !report.runtimeError &&
      report.categories &&
      report.categories.accessibility;

    if (!isMeasurement) {
      console.log('LH_STATUS = NO_REPORT');
      process.exitCode = exitCode !== 0 ? exitCode : 1;
      return;
    }

    const a11yScore = report.categories.accessibility.score != null
      ? Math.round(report.categories.accessibility.score * 100)
      : 0;

    const a11yRefs = report.categories.accessibility.auditRefs || [];
    let applicableCount = 0;
    let passedCount = 0;
    let failedCount = 0;
    let naCount = 0;
    let manualCount = 0;
    const failedAudits = [];

    for (const ref of a11yRefs) {
      const audit = report.audits?.[ref.id];
      if (!audit) continue;

      const mode = audit.scoreDisplayMode;
      if (mode === 'binary' || mode === 'numeric') {
        applicableCount++;
        if (audit.score === 1) {
          passedCount++;
        } else if (audit.score !== null && audit.score < 1) {
          failedCount++;
          failedAudits.push({ id: audit.id, title: audit.title });
        }
      } else if (mode === 'notApplicable') {
        naCount++;
      } else if (mode === 'manual') {
        manualCount++;
      }
    }

    const arithmeticStatus = (applicableCount === passedCount + failedCount) ? 'OK' : 'MISMATCH';

    const perfScore = report.categories.performance?.score != null
      ? Math.round(report.categories.performance.score * 100)
      : 0;

    const lcp = report.audits?.['largest-contentful-paint']?.numericValue ?? null;
    const cls = report.audits?.['cumulative-layout-shift']?.numericValue ?? null;
    const tbt = report.audits?.['total-blocking-time']?.numericValue ?? null;

    const urlRequested = report.requestedUrl;
    const urlFinal = report.finalDisplayedUrl || report.requestedUrl;

    console.log('LH_START');
    console.log(`LH_A11Y_SCORE ${a11yScore}`);
    console.log(`LH_A11Y_APPLICABLE ${applicableCount}`);
    console.log(`LH_A11Y_PASSED ${passedCount}`);
    console.log(`LH_A11Y_FAILED_COUNT ${failedCount}`);
    console.log(`LH_A11Y_NA ${naCount}`);
    console.log(`LH_A11Y_MANUAL ${manualCount}`);
    console.log(`LH_A11Y_ARITHMETIC ${arithmeticStatus}`);
    for (const audit of failedAudits) {
      console.log(`LH_AUDIT_FAILED ${audit.id} ${audit.title}`);
    }
    console.log(`LH_PERF_SCORE ${perfScore}`);
    console.log(`LH_LCP_MS ${lcp}`);
    console.log(`LH_CLS ${cls}`);
    console.log(`LH_TBT_MS ${tbt}`);
    console.log('LH_INP UNMEASURED_LAB');

    const throttleMethod = report.configSettings?.throttlingMethod != null && report.configSettings.throttlingMethod !== '' ? report.configSettings.throttlingMethod : 'ABSENT';
    const throttleCpu = report.configSettings?.throttling?.cpuSlowdownMultiplier != null ? report.configSettings.throttling.cpuSlowdownMultiplier : 'ABSENT';
    const throttleRtt = report.configSettings?.throttling?.rttMs != null ? report.configSettings.throttling.rttMs : 'ABSENT';
    const throttleDown = report.configSettings?.throttling?.throughputKbps != null ? report.configSettings.throttling.throughputKbps : 'ABSENT';
    const emulatedFormFactor = report.configSettings?.emulatedFormFactor != null && report.configSettings.emulatedFormFactor !== '' ? report.configSettings.emulatedFormFactor : 'ABSENT';

    console.log(`LH_THROTTLE_METHOD ${throttleMethod}`);
    console.log(`LH_THROTTLE_CPU ${throttleCpu}`);
    console.log(`LH_THROTTLE_RTT ${throttleRtt}`);
    console.log(`LH_THROTTLE_DOWN ${throttleDown}`);
    console.log(`LH_EMULATED_FORM_FACTOR ${emulatedFormFactor}`);

    const diagIds = [
      'server-response-time',
      'first-contentful-paint',
      'speed-index',
      'interactive',
      'max-potential-fid',
      'bootup-time',
      'mainthread-work-breakdown',
      'render-blocking-resources',
      'unused-javascript',
      'total-byte-weight',
    ];

    for (const diagId of diagIds) {
      const diagAudit = report.audits?.[diagId];
      const diagVal = (diagAudit && diagAudit.numericValue != null) ? diagAudit.numericValue : 'ABSENT';
      console.log(`LH_DIAG ${diagId} ${diagVal}`);
    }

    console.log(`LH_URL_REQUESTED ${urlRequested}`);
    console.log(`LH_URL_FINAL ${urlFinal}`);
    console.log('LH_END');

    if (exitCode !== 0) {
      console.log(`LH_TEARDOWN_WARNING ${exitCode}`);
    }
  } finally {
    if (srv) {
      await srv.close();
    }
    try {
      await unlink(tempReportPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

await main();
