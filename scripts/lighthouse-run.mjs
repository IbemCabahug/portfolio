import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';

async function main() {
  const route = process.argv[2] || 'simple';
  const cleanRoute = route.startsWith('/') ? route.slice(1) : route;

  let srv = null;
  const tempReportPath = join(tmpdir(), `lh-report-${randomUUID()}.json`);

  try {
    // Ensure chrome-launcher does not crash on Windows due to asynchronous Edge termination
    try {
      const launcherPath = resolve(fileURLToPath(new URL('../node_modules/chrome-launcher/dist/chrome-launcher.js', import.meta.url)));
      const launcherContent = await readFile(launcherPath, 'utf8');
      if (launcherContent.includes('rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 10 });')) {
        const patched = launcherContent.replace(
          'rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 10 });',
          'try { rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 10 }); } catch {}'
        );
        await writeFile(launcherPath, patched, 'utf8');
      }
    } catch {
      // Ignore if not present or cannot patch
    }

    srv = await createDistServer({ root: 'dist', port: 0, quiet: true });
    const url = `${srv.origin}/${cleanRoute}`;

    console.log(`LH_ROOT ${srv.root}`);
    console.log(`LH_PORT ${srv.port}`);
    console.log(`LH_INDEX_MTIME ${srv.indexMtime}`);
    console.log(`LH_ROUTE ${route}`);
    console.log(`LH_URL ${url}`);

    const lhCliPath = resolve(fileURLToPath(new URL('../node_modules/lighthouse/cli/index.js', import.meta.url)));

    const child = spawn(
      process.execPath,
      [
        lhCliPath,
        url,
        '--only-categories=accessibility',
        '--output=json',
        `--output-path=${tempReportPath}`,
        '--chrome-flags=--headless=new',
        '--quiet',
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

    if (exitCode !== 0) {
      console.log('LH_STATUS = NO_REPORT');
      process.exitCode = exitCode;
      return;
    }

    let report;
    try {
      const content = await readFile(tempReportPath, 'utf8');
      report = JSON.parse(content);
    } catch {
      console.log('LH_STATUS = NO_REPORT');
      process.exitCode = 1;
      return;
    }

    if (!report || report.runtimeError || !report.categories?.accessibility) {
      console.log('LH_STATUS = NO_REPORT');
      process.exitCode = 1;
      return;
    }

    const a11yScore = report.categories?.accessibility?.score != null
      ? Math.round(report.categories.accessibility.score * 100)
      : null;

    const audits = Object.values(report.audits || {});
    const failedAudits = audits.filter(
      (a) => a && a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary'
    );
    const naCount = audits.filter(
      (a) => a && a.scoreDisplayMode === 'notApplicable'
    ).length;

    console.log('LH_START');
    console.log(`LH_A11Y_SCORE ${a11yScore}`);
    for (const audit of failedAudits) {
      console.log(`LH_AUDIT_FAILED ${audit.id} ${audit.title}`);
    }
    console.log(`LH_AUDIT_NA ${naCount}`);
    console.log(`LH_URL_FINAL ${report.requestedUrl}`);
    console.log('LH_END');
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
