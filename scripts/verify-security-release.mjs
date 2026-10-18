// Reproducible, no-secret local verification. Evidence stays outside the repository.
import { mkdir, cp, symlink, writeFile, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.env.SECURITY_REPORT_DIR || 'C:/antigravity-security-reports/web-portfolio/SECURITY-IMPLEMENTATION-20261018-REV3');
const workspace = join(output, 'isolated-build');
await mkdir(workspace, { recursive: true });
for (const name of ['src', 'public', 'package.json', 'package-lock.json', 'tsconfig.json', 'astro.config.mjs', 'vercel.json']) {
  await cp(join(root, name), join(workspace, name), { recursive: true, force: true });
}
await symlink(join(root, 'node_modules'), join(workspace, 'node_modules'), 'junction').catch(error => {
  if (error.code !== 'EEXIST') throw error;
});
// An allowlisted environment prevents inherited deployment secrets reaching the build.
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'HOME']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  NODE_ENV: 'production',
  PUBLIC_SITE_URL: 'https://portfolio-ibem.vercel.app',
  SECURITY_BUILD_ROOT: join(workspace, 'dist/client'),
});
const results = [];
async function run(name, args, cwd = root, timeout = 900_000) {
  const log = createWriteStream(join(output, `${name}.log`));
  const started = new Date().toISOString();
  console.log(`START ${name}`);
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeout);
  const code = await new Promise((ok, fail) => { child.on('error', fail); child.on('close', ok); });
  clearTimeout(timer);
  await new Promise(ok => log.end(ok));
  results.push({ name, args, cwd, started, finished: new Date().toISOString(), code, timedOut });
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`END ${name}: ${code}${timedOut ? ' TIMEOUT' : ''}`);
  return code === 0 && !timedOut;
}
async function hashes(base, names) {
  const rows = [];
  async function walk(relative) {
    const entries = await readdir(join(base, relative), { withFileTypes: true });
    for (const entry of entries) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) rows.push({ path, sha256: createHash('sha256').update(await readFile(join(base, path))).digest('hex') });
    }
  }
  for (const name of names) {
    if (['src', 'public', 'scripts', 'dist/client'].includes(name)) await walk(name);
    else rows.push({ path: name, sha256: createHash('sha256').update(await readFile(join(base, name))).digest('hex') });
  }
  return rows;
}
await writeFile(join(output, 'source-manifest.json'), JSON.stringify(await hashes(root, ['src', 'public', 'scripts', 'package.json', 'package-lock.json', 'astro.config.mjs', 'vercel.json', 'tsconfig.json']), null, 2));
await writeFile(join(output, 'baseline.txt'), `Node ${process.version}\n${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root })}${execFileSync('git', ['status', '--short'], { cwd: root })}`);
const astro = join(root, 'node_modules/astro/bin/astro.mjs');
const check = await run('check', [astro, 'check'], workspace);
const build = await run('build', [astro, 'build'], workspace);
if (build) {
  const assets = await hashes(workspace, ['dist/client']);
  await writeFile(join(output, 'build-manifest.json'), JSON.stringify(assets, null, 2));
  for (const path of ['index.html', 'messenger/raven/index.html', 'quests/bits/index.html', 'sw.js']) {
    if (!(await readFile(join(workspace, 'dist/client', path))).length) throw new Error(`Empty build asset: ${path}`);
  }
  await run('node-audit', ['scripts/test-security-ux-audit.mjs']);
  await run('browser-sw', ['scripts/test-browser-sw-lifecycle.mjs']);
  await run('browser-draft', ['scripts/test-browser-draft-lifecycle.mjs']);
  await run('browser-embeds', ['scripts/test-browser-embeds.mjs']);
}
const after = await hashes(root, ['src', 'public', 'scripts', 'package.json', 'package-lock.json', 'astro.config.mjs', 'vercel.json', 'tsconfig.json']);
await writeFile(join(output, 'source-manifest-after.json'), JSON.stringify(after, null, 2));
const unchanged = await readFile(join(output, 'source-manifest.json'), 'utf8') === JSON.stringify(after, null, 2);
console.log(`Source unchanged during run: ${unchanged}`);
process.exitCode = check && build && unchanged && results.every(result => result.code === 0 && !result.timedOut) ? 0 : 1;
console.log(`Evidence: ${output}\nFinal exit code: ${process.exitCode}`);