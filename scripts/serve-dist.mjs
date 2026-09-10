// scripts/serve-dist.mjs
// Static file server for the built site. X139: every geometry number this project
// records is measured against this server, so the server is version-controlled too.
// Node stdlib only, so it cannot fail the way npx -y serve did.
//
// D187 gives this file two ways in, and the two ways are the whole point.
//
//   1. As a MODULE. createDistServer resolves only once the socket is listening
//      and returns { origin, port, root, indexMtime, close }. Pass port 0 to take
//      any free port the OS offers. The layout harness does this, so port 4321 is
//      no longer a shared resource and an orphaned server is impossible.
//
//   2. As a COMMAND. node scripts/serve-dist.mjs [port] [root]
//      Defaults: port 4321, root dist. Prints its own process.pid and writes
//      .serve-dist.pid, so a cleanup step can name its target from printed
//      evidence instead of an expired shell variable. That is X192.
//
// Nothing runs at module scope. Importing this file must never read argv and must
// never call process.exit, or it would kill the harness that imported it.

import { createServer } from 'node:http'
import { stat, readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

export async function createDistServer({ root = 'dist', port = 4321, quiet = false } = {}) {
  const ROOT = resolve(root)

  // Refuse to serve a root that is missing or has no index.html. A harness pointed
  // at a half-built or absent dist would return internally consistent numbers about
  // a site that does not exist, which is X160 with no way to detect it.
  const rootStat = await stat(ROOT).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error('serve-dist: not a directory: ' + ROOT + ' - run npm.cmd run build first')
  }
  const indexStat = await stat(join(ROOT, 'index.html')).catch(() => null)
  if (!indexStat) {
    throw new Error('serve-dist: no index.html in ' + ROOT + ', refusing to serve a partial build')
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
      if (!quiet) console.log('404 ' + req.url)
      return
    }
    const body = await readFile(file)
    const mime = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const rangeHeader = req.headers.range

    if (rangeHeader && req.method === 'GET') {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
      if (match) {
        const start = parseInt(match[1], 10)
        const end = match[2] ? parseInt(match[2], 10) : body.length - 1
        if (start < body.length && end < body.length && start <= end) {
          const chunk = body.subarray(start, end + 1)
          res.writeHead(206, {
            'content-type': mime,
            'content-range': `bytes ${start}-${end}/${body.length}`,
            'accept-ranges': 'bytes',
            'content-length': chunk.length,
            'cache-control': 'no-store',
          })
          res.end(chunk)
          if (!quiet) console.log('206 ' + req.url + ` (${start}-${end})`)
          return
        }
      }
    }

    res.writeHead(200, {
      'content-type': mime,
      'content-length': body.length,
      'accept-ranges': 'bytes',
      // no-store so a probe can never measure a cached copy of a previous build.
      'cache-control': 'no-store',
    })
    res.end(body)
    if (!quiet) console.log('200 ' + req.url)
  })

  await new Promise((ok, fail) => {
    const onError = (err) => {
      if (err && err.code === 'EADDRINUSE') {
        fail(new Error('serve-dist: port ' + port + ' is already in use - find the holder with netstat -ano and stop it by pid'))
        return
      }
      fail(err)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError)
      ok()
    })
  })

  const actualPort = server.address().port

  return {
    origin: 'http://127.0.0.1:' + actualPort,
    port: actualPort,
    root: ROOT,
    indexMtime: indexStat.mtime.toISOString(),
    close: () => new Promise((ok) => {
      server.closeAllConnections()
      server.close(() => ok())
    }),
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const cliPort = Number(process.argv[2] ?? 4321)
  const cliRoot = process.argv[3] ?? 'dist'
  let srv = null
  try {
    srv = await createDistServer({ root: cliRoot, port: cliPort })
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
  await writeFile('.serve-dist.pid', String(process.pid) + '\n')
  console.log('serve-dist: pid ' + process.pid)
  console.log('serve-dist: root ' + srv.root)
  console.log('serve-dist: index.html mtime ' + srv.indexMtime)
  console.log('serve-dist: listening on ' + srv.origin)
}
