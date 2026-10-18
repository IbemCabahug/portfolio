import { resolve } from 'node:path';

export const buildRoot = resolve(process.env.SECURITY_BUILD_ROOT || 'dist/client');
export const browserArgs = [
  '--host-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--no-default-browser-check',
];

// Inspect actual stored keys AND values, including response bodies and binary IDB values.
// Runs in the browser, so keep this function self-contained.
export async function inspectPersistentStorage(markers) {
  const findings = [];
  const checked = { localStorage: 0, sessionStorage: 0, cookies: 0, cacheEntries: 0, databases: 0, records: 0 };
  async function inspect(value, location) {
    if (value === undefined || value === null) return;
    if (value instanceof Blob) return inspect(await value.text(), location);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return inspect(new TextDecoder().decode(value), location);
    }
    if (typeof value === 'object') {
      if (value instanceof Map || value instanceof Set) return inspect([...value], location);
      for (const [key, child] of Object.entries(value)) {
        await inspect(key, location);
        await inspect(child, location);
      }
      return;
    }
    for (const marker of markers) {
      if (String(value).includes(marker)) findings.push({ location, marker });
    }
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    const store = window[name];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      checked[name]++;
      await inspect([key, store.getItem(key)], name);
    }
  }
  checked.cookies = document.cookie ? document.cookie.split(';').length : 0;
  await inspect(document.cookie, 'document.cookie');
  await inspect(history.state, 'history.state');
  await inspect(location.href, 'location.href');
  for (const name of await caches.keys()) {
    await inspect(name, 'CacheStorage name');
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      checked.cacheEntries++;
      const response = await cache.match(request);
      await inspect([request.url, [...request.headers], [...response.headers], await response.text()], `CacheStorage:${name}`);
    }
  }
  for (const info of await indexedDB.databases()) {
    checked.databases++;
    await inspect(info.name, 'IndexedDB name');
    const db = await new Promise((ok, fail) => {
      const req = indexedDB.open(info.name);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    try {
      for (const name of db.objectStoreNames) {
        await inspect(name, 'IndexedDB store name');
        const records = await new Promise((ok, fail) => {
          const tx = db.transaction(name, 'readonly');
          const result = [];
          const cursor = tx.objectStore(name).openCursor();
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (item) { result.push([item.key, item.value]); item.continue(); }
          };
          tx.oncomplete = () => ok(result);
          tx.onerror = () => fail(tx.error);
          tx.onabort = () => fail(tx.error || new Error('IndexedDB inspection aborted'));
        });
        checked.records += records.length;
        await inspect(records, `IndexedDB:${info.name}/${name}`);
      }
    } finally { db.close(); }
  }
  return { findings, checked };
}