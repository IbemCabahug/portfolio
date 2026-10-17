// Only public HTTPS endpoints, or loopback HTTP during local development.
export function demoUrl(raw: string | undefined, development = false): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || url.search) return null;
    if (local && !development) return null;
    if (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) return null;
    return url.href;
  } catch { return null; }
}
