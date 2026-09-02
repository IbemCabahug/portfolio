// scripts/serve-dist.mjs
// Static file server for the built site, on the port the layout harness expects.
// This file exists to discharge X139: every geometry number this project records is
// measured against http://127.0.0.1:4321, so the server behind that address has to be
// version-controlled too. It is Node stdlib only, so it cannot fail the way
// `npx -y serve` did.
//
// Usage:  node scripts/serve-dist.mjs [port] [root]
// Default port 4321, default root dist.

import { createServer } from 'node:http'
import { stat, readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const PORT = Number(process.argv[2] ?? 4321)
const ROOT = resolve(process.argv[3] ?? 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// Refuse to serve a root that is missing or has no index.html. A harness pointed at a
// half-built or absent dist would return internally consistent numbers about a site
// that does not exist, which is X160 with no way to detect it.
const rootStat = await stat(ROOT).catch(() => null)
if (!rootStat || !rootStat.isDirectory()) {
  console.error('serve-dist: not a directory: ' + ROOT)
  console.error('serve-dist: run npm.cmd run build first')
  process.exit(1)
}
const indexStat = await stat(join(ROOT, 'index.html')).catch(() => null)
if (!indexStat) {
  console.error('serve-dist: no index.html in ' + ROOT + ', refusing to serve a partial build')
  process.exit(1)
}

async function resolveFile(rawUrl) {
  const clean = decodeURIComponent(rawUrl.split('?')[0].split('#')[0])
  const candidate = resolve(join(ROOT, normalize(clean)))
  // Path-traversal guard: never serve anything outside ROOT.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
  const direct = await stat(candidate).catch(() => null)
  if (direct && direct.isFile()) return candidate
  if (direct && direct.isDirectory()) {
    const nested = join(candidate, 'index.html')
    const nestedStat = await stat(nested).catch(() => null)
    if (nestedStat && nestedStat.isFile()) return nested
  }
  const asHtml = candidate + '.html'
  const htmlStat = await stat(asHtml).catch(() => null)
  if (htmlStat && htmlStat.isFile()) return asHtml
  return null
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? '/')
  if (!file) {
    const fallback = await readFile(join(ROOT, '404.html')).catch(() => null)
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(fallback ?? 'Not found')
    console.log('404 ' + req.url)
    return
  }
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    // no-store so a probe can never measure a cached copy of a previous build.
    'cache-control': 'no-store',
  })
  res.end(body)
  console.log('200 ' + req.url)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('serve-dist: root ' + ROOT)
  console.log('serve-dist: index.html mtime ' + indexStat.mtime.toISOString())
  console.log('serve-dist: listening on http://127.0.0.1:' + PORT)
})
