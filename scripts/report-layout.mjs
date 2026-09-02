// scripts/report-layout.mjs
// D188. Runs the layout harness as a child process and prints a FIXED, FLAT
// KEY = value list, so no measurement is ever retyped by a human again. X199 was
// six wrong numbers in a hand-built table that contradicted the logs beside it.
//
// It also echoes the harness provenance lines verbatim, because X198 says a
// measurement whose SERVE_MTIME and SERVE_PORT were never read is not admissible.
//
// This file is the sanctioned form under X191: verification logic belongs in a
// committed script, never in a shell string that needs quoting.
//
// Usage: node scripts/report-layout.mjs [viewportHeight] [route] [modes...]
// Arguments are passed straight through to scripts/measure-layout.mjs.
//
// Exit 0 only when the JSON markers were found, the JSON parsed, and
// controlProbe.count is 0. Any other outcome exits 1 with a REPORT_STATUS line.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const height = argv.find((a) => /^\d+$/.test(a)) ?? '768'
const harness = resolve('scripts/measure-layout.mjs')

const child = spawn(process.execPath, [harness, ...argv], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
let err = ''
child.stdout.on('data', (c) => { out += c })
child.stderr.on('data', (c) => { err += c })
const exitCode = await new Promise((ok) => child.on('close', ok))

console.log('HARNESS_ARGS = ' + argv.join(' '))
console.log('HARNESS_EXIT = ' + exitCode)

// Provenance first, verbatim, never reformatted.
for (const line of out.split(/\r?\n/)) {
  if (
    line.startsWith('SERVE_') ||
    line.startsWith('ROUTE_') ||
    line.startsWith('RESOLVED_URL') ||
    line.startsWith('MOTION') ||
    line.startsWith('TYPING_') ||
    line.startsWith('OPEN_') ||
    line.startsWith('SETTLED') ||
    line.startsWith('PAGE_NOT_READY') ||
    line.startsWith('PROBE MACHINERY')
  ) {
    console.log(line)
  }
}
if (err.trim() !== '') {
  for (const line of err.split(/\r?\n/)) {
    if (line.trim() !== '') console.log('HARNESS_STDERR ' + line)
  }
}

const startMarker = 'JSON_START_' + height
const endMarker = 'JSON_END_' + height
const startAt = out.indexOf(startMarker)
const endAt = out.indexOf(endMarker)
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.log('REPORT_STATUS = NO_JSON_MARKERS')
  process.exit(1)
}

let data
try {
  data = JSON.parse(out.slice(startAt + startMarker.length, endAt))
} catch (parseErr) {
  console.log('REPORT_STATUS = JSON_PARSE_FAILED ' + parseErr.message)
  process.exit(1)
}

// Dotted paths. Numeric segments index arrays. Missing paths print ABSENT rather
// than crashing, because a missing field is a finding, not an error (X120).
const pick = (path) => {
  let node = data
  for (const key of path.split('.')) {
    if (node === null || node === undefined) return 'ABSENT'
    node = node[key]
  }
  if (node === null || node === undefined) return 'ABSENT'
  if (typeof node === 'object') return JSON.stringify(node)
  return String(node)
}

const FIELDS = [
  'innerHeight',
  'docScrollHeight',
  'overflowPx',
  'frameW',
  'frameH',
  'frameTopInDoc',
  'spaceBelowFrame',
  'wrapper.h',
  'wrapper.minHeight',
  'wrapper.display',
  'chromeProbe.header.height',
  'chromeProbe.locationBar.height',
  'chromeProbe.content.height',
  'styleProbe.prose.fontSize',
  'styleProbe.prose.lineHeight',
  'scrollProbe.REPLIES.gap',
  'scrollProbe.REPLIES.clientWidth',
  'scrollProbe.REPLIES.offsetWidth',
  'scrollProbe.REPLIES.scrollHeight',
  'scrollProbe.REPLIES.clientHeight',
  'scrollProbe.REPLIES.overflowing',
  'scrollProbe.REPLIES.barPx',
  'scrollProbe.BODY.scrollHeight',
  'scrollProbe.BODY.clientHeight',
  'scrollProbe.BODY.overflowing',
  'navLinkProbe.visibleCount',
  'replyBtnProbe.count',
  'replyBtnProbe.matches.0.w',
  'replyBtnProbe.matches.0.h',
  'replyBtnProbe.matches.0.top',
  'replyBtnProbe.matches.1.top',
  'replyBtnProbe.matches.6.top',
  'closeProbe.count',
  'closeProbe.matches.0.w',
  'closeProbe.matches.0.h',
  'controlProbe.count',
  'typingProbe.motion',
  'typingProbe.repliesHidden',
  'typingProbe.proseTextLength',
  'typingProbe.unreadCount',
  'repliesProbe.w',
  'repliesProbe.h',
  'repliesProbe.left',
  'repliesProbe.scrollable',
  'proseProbe.h',
  'proseProbe.clipped',
  'bodyProbe.h',
  'bodyProbe.scrollable',
  'spriteProbe.w',
  'spriteProbe.h',
  'spriteProbe.naturalW',
  'artProbe.boxW',
  'artProbe.boxH',
  'artProbe.naturalW',
  'plateProbe.w',
  'plateProbe.h',
  'skipLinkProbe.position',
  'skipLinkProbe.w',
  'tooltipProbe',
]

console.log('FIELDS_START')
for (const path of FIELDS) {
  console.log(path + ' = ' + pick(path))
}

// Derived values. B10 is a rule about pixels on screen, so it is checked against
// measured geometry, never against what the stylesheet claims (X121).
const matches = Array.isArray(data.replyBtnProbe?.matches) ? data.replyBtnProbe.matches : []
if (matches.length >= 2) {
  const pitch = matches[1].top - matches[0].top
  console.log('DERIVED.replyPitchPx = ' + pitch)
  console.log('DERIVED.replyGapPx = ' + (pitch - matches[0].h))
} else {
  console.log('DERIVED.replyPitchPx = ABSENT')
  console.log('DERIVED.replyGapPx = ABSENT')
}
if (matches.length > 0) {
  console.log('DERIVED.replyMinHeightPx = ' + Math.min(...matches.map((m) => m.h)))
  console.log('DERIVED.replyMinWidthPx = ' + Math.min(...matches.map((m) => m.w)))
  console.log('DERIVED.replyUnmeasurableCount = ' + matches.filter((m) => !m.measurable).length)
}
console.log('FIELDS_END')

const controlCount = data.controlProbe?.count
if (controlCount !== 0) {
  console.log('REPORT_STATUS = PROBE_UNTRUSTWORTHY controlProbe.count is ' + controlCount)
  process.exit(1)
}
console.log('REPORT_STATUS = OK')
