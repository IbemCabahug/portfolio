/**
 * Client-side re-computation of the "Pushed: <relative>" telemetry label.
 *
 * WHY THIS EXISTS
 * The relative string is produced at BUILD time by formatRelativeTime() in
 * ./github.ts, then frozen into static HTML. The Quest Board pages are
 * prerendered and the data is only refreshed when the site is rebuilt, so a
 * label can sit un-rebuilt for days and keep claiming "just now" — observed
 * live on 2026-09-29, where /quests/arcanetyper still read "just now" for a
 * push six days old. The build-time value is kept as the server-rendered
 * fallback so the no-JS Field Ledger variant and any crawler still get a
 * sensible, honest string; this only corrects it once JS runs.
 *
 * The ISO timestamp is already in the markup as data-pushed-at, so this needs
 * no network call and no CSP change.
 *
 * The thresholds below MUST stay identical to formatRelativeTime() in
 * ./github.ts, otherwise the client and server will disagree and the text will
 * visibly change on hydration. Change one, change both.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Mirrors formatRelativeTime() in ./github.ts. */
function formatRelative(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffMs = now - then;
  if (diffMs < 0) return 'recently';

  const diffMins = Math.floor(diffMs / MINUTE);
  const diffHours = Math.floor(diffMs / HOUR);
  const diffDays = Math.floor(diffMs / DAY);
  const diffMonths = Math.floor(diffMs / MONTH);
  const diffYears = Math.floor(diffMs / YEAR);

  if (diffDays <= 0) {
    if (diffHours <= 0) return 'just now';
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

/** Absolute fallback, matching formatDate() in ./github.ts. */
function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function refresh() {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-pushed-at]').forEach((el) => {
    const iso = el.dataset.pushedAt;
    if (!iso) return;

    const relative = formatRelative(iso, now);
    if (relative) el.textContent = relative;

    // The tooltip is the escape hatch for the ambiguity relative time carries:
    // "3d ago" is vague, "Sep 26, 2026" is not. Set it whether or not the
    // element already had one, so the two never drift apart.
    const absolute = formatAbsolute(iso);
    if (absolute) el.title = `Pushed ${absolute}`;
  });
}

function init() {
  refresh();
  // "just now" -> "5m ago" -> "1h ago" all happen inside a single viewing
  // session, so one pass on load is not enough. Once a minute is cheap (a
  // handful of text nodes) and matches the granularity actually displayed.
  window.setInterval(refresh, 60_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}