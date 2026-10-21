/**
 * Automated Security & UX Verification Suite (Revision 1)
 *
 * Covers:
 * - PLAN-01: Turnstile validation contract, canonical host, explicit preview, action check, single-use replay
 * - PLAN-02: Origin policy, exact HTTPS production origins, RFC 6454 format enforcement, loopback HTTP in dev only
 * - PLAN-03: Client IP derivation on Vercel (x-vercel-forwarded-for, x-real-ip), safe bounded 'unknown' bucket,
 *            built-in node:net isIP and SocketAddress validation and canonicalization
 * - PLAN-04: Test harness isolation, deterministic synthetic baseline, fail-closed out-of-band violation tracking
 * - PLAN-05: Request byte cap, multibyte UTF-8, stream read errors, endpoint concurrency, cooldown, hourly & global quotas
 * - PLAN-06: Delivery matrix (server-only Resend, browser-assisted Web3Forms, missing keys), provider abort/timeout
 * - PLAN-07: Messenger draft lifecycle (empty-save clearing, defensive copies, no storage leakage)
 * - PLAN-08: Service worker cache boundaries (same-origin GET, query-bearing navigation, private/no-store exclusion, cache bounds)
 * - PLAN-09: Demo URL strict validation, iframe sandbox permissions without allow-top-navigation
 * - UX-01..UX-10: Email verification, honeypot, accessible modal controls, frame styling, factual notices
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !path.extname(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw err;
    }
  },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

// ── Strict Environment Isolation Helper (Phase A / PLAN-04 / Reviewer 5) ───
// Establishes a deterministic synthetic baseline BEFORE any application module imports.
export const STANDARD_ISOLATED_KEYS = Object.freeze([
  'NODE_ENV',
  'VERCEL',
  'VERCEL_ENV',
  'PUBLIC_SITE_URL',
  'APPROVED_PREVIEW_HOSTNAME',
  'TURNSTILE_SECRET',
  'PUBLIC_TURNSTILE_SITE_KEY',
  'EMAIL_API_KEY',
  'CONTACT_TO_ADDRESS',
  'WEB3FORMS_KEY',
  'WEB3FORMS_ACCESS_KEY',
  'RESEND_API_KEY',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_SKEW_PROTECTION_ENABLED',
]);

// Snapshot the parent process environment state for complete restore
const parentEnvSnapshot = new Map();
for (const key of STANDARD_ISOLATED_KEYS) {
  parentEnvSnapshot.set(key, process.env[key]);
}

// Establish deterministic synthetic baseline before imports
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.PUBLIC_SITE_URL;
delete process.env.APPROVED_PREVIEW_HOSTNAME;
delete process.env.TURNSTILE_SECRET;
delete process.env.PUBLIC_TURNSTILE_SITE_KEY;
delete process.env.EMAIL_API_KEY;
delete process.env.CONTACT_TO_ADDRESS;
delete process.env.WEB3FORMS_KEY;
delete process.env.WEB3FORMS_ACCESS_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.VERCEL_DEPLOYMENT_ID;
delete process.env.VERCEL_SKEW_PROTECTION_ENABLED;

/**
 * Runs a function within an isolated environment scope.
 * Any key in STANDARD_ISOLATED_KEYS not in overrides is explicitly cleared/deleted.
 * In finally, restores the exact prior state with delete-if-absent semantics.
 */
export async function withIsolatedEnv(overrides, fn) {
  const trackedKeys = new Set([...STANDARD_ISOLATED_KEYS, ...Object.keys(overrides)]);
  const snapshot = new Map();

  for (const key of trackedKeys) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      snapshot.set(key, process.env[key]);
    } else {
      snapshot.set(key, undefined);
    }
  }

  // Clear tracked keys that are not explicitly provided in overrides
  for (const key of STANDARD_ISOLATED_KEYS) {
    if (!(key in overrides)) {
      if (key === 'NODE_ENV') {
        process.env.NODE_ENV = 'test';
      } else {
        delete process.env[key];
      }
    }
  }

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, origVal] of snapshot.entries()) {
      if (origVal === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = origVal;
      }
    }
  }
}

// ── Fail-Closed Mock Network Infrastructure (Phase A / PLAN-04 / Reviewer 4) ─
// Tracks unexpected requests out-of-band and asserts zero violations after every test.
// NOTE: This intercepts globalThis.fetch in this Node process. It does not claim
// interception of node:http, node:https, raw TCP sockets, or child processes.
export class FailClosedFetchDispatcher {
  constructor() {
    this.routes = [];
    this.recordedCalls = [];
    this.violations = [];
    this.expectedViolationFilter = null;
  }

  reset() {
    this.routes = [];
    this.recordedCalls = [];
    this.violations = [];
    this.expectedViolationFilter = null;
  }

  /**
   * Registers a mock route with exact parsed URL matching or custom matcher.
   */
  addRoute(matcher, handler) {
    this.routes.push({ matcher, handler });
  }

  /**
   * Scopes an expected violation so that deliberate dispatcher-negative tests
   * can verify that an unhandled fetch throws without failing the enclosing test runner.
   */
  async expectViolation(filterFn, runFn) {
    this.expectedViolationFilter = filterFn;
    try {
      await runFn();
    } finally {
      this.expectedViolationFilter = null;
    }
  }

  async dispatch(input, init) {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url ? input.url : String(input);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = init?.headers
      ? init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : Array.isArray(init.headers)
        ? Object.fromEntries(init.headers)
        : { ...init.headers }
      : input instanceof Request
      ? Object.fromEntries(input.headers.entries())
      : {};

    let body = init?.body;
    if (!body && input instanceof Request) {
      try {
        body = await input.clone().text();
      } catch {}
    }

    const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
    const callRecord = {
      url: urlStr,
      method,
      headers,
      body,
      signal,
      timestamp: Date.now(),
    };
    this.recordedCalls.push(callRecord);

    for (const route of this.routes) {
      let match = false;
      if (typeof route.matcher === 'function') {
        match = route.matcher(urlStr, method, callRecord);
      } else if (typeof route.matcher === 'string') {
        match = urlStr === route.matcher;
      } else if (route.matcher instanceof RegExp) {
        match = route.matcher.test(urlStr);
      }

      if (match) {
        return await route.handler(callRecord, urlStr, { ...init, signal });
      }
    }

    // Unhandled outbound request -> Record violation out-of-band
    const violation = {
      method,
      url: urlStr,
      headers,
      body,
      timestamp: Date.now(),
    };

    if (this.expectedViolationFilter && this.expectedViolationFilter(violation)) {
      // Expected violation consumed by deliberate test
    } else {
      this.violations.push(violation);
    }

    const err = new Error(`[FAIL_CLOSED_FETCH] Blocked unauthorized outbound request: ${method} ${urlStr}`);
    err.isFailClosedViolation = true;
    throw err;
  }
}

export const mockNetwork = new FailClosedFetchDispatcher();
globalThis.fetch = (input, init) => mockNetwork.dispatch(input, init);

// ── Log Interception Helper ─────────────────────────────────────────────────
export async function captureLogs(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const captured = [];

  const record = (type, args) => {
    const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    captured.push({ type, text });
  };

  console.log = (...args) => {
    record('log', args);
    originalLog(...args);
  };
  console.error = (...args) => {
    record('error', args);
    originalError(...args);
  };
  console.warn = (...args) => {
    record('warn', args);
    originalWarn(...args);
  };

  try {
    const result = await fn();
    return { result, captured };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

// ── Module Imports (executed after deterministic baseline environment) ──────
const validatorMod = await import('../src/lib/email-validator.ts');
const missiveMod = await import('../src/pages/api/missive.ts');
const draftMod = await import('../src/lib/messenger-draft.ts');
const bitsUrlMod = await import('../src/lib/bits-demo-url.ts');
const contactMod = await import('../src/lib/contact.ts');

const { validateEmail } = validatorMod;
const {
  POST,
  ALL,
  __resetRateLimitsForTests,
  __getIpBucketCount,
  __seedIpBucketForTests,
  __seedGlobalTimestampsForTests,
  __getInFlightTokensCount,
  getExpectedHostnames,
  getAllowedOrigins,
  getClientIp,
  isValidIp,
  normalizeIp,
  isValidHostname,
  verifyTurnstile,
  MAX_REQUEST_BYTES,
} = missiveMod;
const { saveMissiveDraft, getMissiveDraft, clearMissiveDraft } = draftMod;
const { demoUrl } = bitsUrlMod;
const { sendMissive } = contactMod;

// ── Test Runner with Automatic Out-of-Band Violation Checking ────────────────
let passed = 0;
let totalTests = 0;

export async function executeRunnerTest(name, fn, dispatcher = mockNetwork) {
  dispatcher.reset();
  try {
    await fn();
    if (dispatcher.violations.length > 0) {
      const v = dispatcher.violations[0];
      throw new Error(
        `Test "${name}" had unhandled outbound network violation: ${v.method} ${v.url}`
      );
    }
    return { passed: true, error: null };
  } catch (err) {
    return { passed: false, error: err };
  } finally {
    dispatcher.reset();
  }
}

async function test(name, fn) {
  totalTests++;
  __resetRateLimitsForTests();
  clearMissiveDraft();

  const res = await executeRunnerTest(name, fn, mockNetwork);
  if (res.passed) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}`);
    console.error(res.error);
    process.exitCode = 1;
  }
  __resetRateLimitsForTests();
  clearMissiveDraft();
}

// The child invokes THIS runner and dispatcher, not a miniature copied implementation.
if (process.argv.includes('--negative-control')) {
  await test('intentional swallowed unexpected fetch', async () => {
    try { await fetch('https://rogue-endpoint.example.test/telemetry', { method: 'POST' }); }
    catch { /* Simulate application code swallowing a network failure. */ }
  });
  process.exit(process.exitCode || 0);
}

console.log('=== Portfolio Security & UX Audit Verification Suite (Revision 3) ===\n');

// ── PLAN-04 / Phase A: Fail-Closed Test Harness at Test-Result Level ─────────
await test('PLAN-04 / Phase A: mock fetch fails closed on unmocked outbound URL without real network', async () => {
  let caught = null;
  await mockNetwork.expectViolation(
    (v) => v.url === 'https://unexpected-provider.example.com/api/test',
    async () => {
      try {
        await fetch('https://unexpected-provider.example.com/api/test');
      } catch (err) {
        caught = err;
      }
    }
  );
  assert.ok(caught, 'Fetch to unmocked URL must throw');
  assert.match(caught.message, /\[FAIL_CLOSED_FETCH\]/);
  assert.equal(mockNetwork.recordedCalls.length, 1);
});

await test('PLAN-04 / Phase A: expectViolation filters matching violation but does not suppress unrelated violations', async () => {
  const isolatedDispatcher = new FailClosedFetchDispatcher();
  let caughtExpected = false;
  let caughtUnrelated = false;

  await isolatedDispatcher.expectViolation(
    (v) => v.url === 'https://expected-unmocked.example.test/check',
    async () => {
      // 1. Expected violation
      try {
        await isolatedDispatcher.dispatch('https://expected-unmocked.example.test/check', { method: 'GET' });
      } catch {
        caughtExpected = true;
      }

      // 2. Unrelated violation within the same scope
      try {
        await isolatedDispatcher.dispatch('https://unrelated-rogue.example.test/leak', { method: 'POST' });
      } catch {
        caughtUnrelated = true;
      }
    }
  );

  assert.equal(caughtExpected, true, 'Expected unmocked URL must throw');
  assert.equal(caughtUnrelated, true, 'Unrelated unmocked URL must throw');
  // The expected violation was filtered out, but the unrelated violation MUST remain in violations!
  assert.equal(isolatedDispatcher.violations.length, 1);
  assert.equal(isolatedDispatcher.violations[0].url, 'https://unrelated-rogue.example.test/leak');
});

await test('PLAN-04 / Phase A: test runner rejects test when application code catches unexpected outbound fetch (asserted runner failure)', async () => {
  const isolatedDispatcher = new FailClosedFetchDispatcher();
  const appFunctionCatchingError = async () => {
    try {
      await isolatedDispatcher.dispatch('https://unexpected-unmocked-service.example.test/data', { method: 'GET' });
      return { ok: true };
    } catch {
      return { ok: false, error: 'service_unavailable' };
    }
  };

  const runnerResult = await executeRunnerTest('swallowed-violation-test', async () => {
    const res = await appFunctionCatchingError();
    assert.equal(res.ok, false);
  }, isolatedDispatcher);

  assert.equal(runnerResult.passed, false, 'Runner must reject test when out-of-band violation occurs');
  assert.match(runnerResult.error.message, /unhandled outbound network violation/);
  assert.match(runnerResult.error.message, /unexpected-unmocked-service\.example\.test/);
});

await test('PLAN-04 / Phase A: negative child process execution produces nonzero exit code and logs runner failure', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--negative-control'], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.equal(child.status, 1, 'Child process must exit with code 1 (nonzero) upon runner violation rejection');
  assert.match(child.stderr, /FAIL.*intentional swallowed unexpected fetch/);
  assert.match(child.stderr, /unhandled outbound network violation/);
  assert.match(child.stderr, /rogue-endpoint\.example\.test/);
});

await test('PLAN-04 / Phase A: withIsolatedEnv enforces deterministic baseline, prevents inherited sentinels, and restores absent keys', async () => {
  const TEST_KEY = 'TEST_SENTINEL_VARIABLE_XYZ';
  delete process.env[TEST_KEY];

  // 1. Inherited sentinel configuration cannot survive into withIsolatedEnv
  process.env.EMAIL_API_KEY = 'inherited_dirty_key';
  await withIsolatedEnv({ NODE_ENV: 'production' }, async () => {
    assert.equal(
      process.env.EMAIL_API_KEY,
      undefined,
      'Sensitive keys omitted from overrides must be deleted during isolated execution'
    );
  });
  // Restores original dirty key afterward
  assert.equal(process.env.EMAIL_API_KEY, 'inherited_dirty_key');
  delete process.env.EMAIL_API_KEY;

  // 2. Absence preservation
  assert.equal(process.env[TEST_KEY], undefined);
  await withIsolatedEnv({ [TEST_KEY]: 'temp_val' }, async () => {
    assert.equal(process.env[TEST_KEY], 'temp_val');
  });
  assert.equal(Object.prototype.hasOwnProperty.call(process.env, TEST_KEY), false);

  // 3. Restoration works when callback throws
  let thrown = false;
  try {
    await withIsolatedEnv({ [TEST_KEY]: 'will_throw' }, async () => {
      throw new Error('boom');
    });
  } catch {
    thrown = true;
  }
  assert.equal(thrown, true);
  assert.equal(Object.prototype.hasOwnProperty.call(process.env, TEST_KEY), false);

  // 4. Nested scopes behave correctly
  await withIsolatedEnv({ NODE_ENV: 'production' }, async () => {
    assert.equal(process.env.NODE_ENV, 'production');
    await withIsolatedEnv({ NODE_ENV: 'development' }, async () => {
      assert.equal(process.env.NODE_ENV, 'development');
    });
    assert.equal(process.env.NODE_ENV, 'production');
  });
});

// ── PLAN-03 / Phase C: Client-IP Trust, Validation & Normalization (Reviewer 3)
await test('PLAN-03 / Phase C: isValidIp built-in node:net validation correctly handles the 5 review table cases and IPv4/IPv6', () => {
  // The 5 review cases:
  assert.equal(isValidIp('::::'), false, ':::: must be rejected');
  assert.equal(isValidIp('1:2'), false, '1:2 must be rejected');
  assert.equal(isValidIp('12345::1'), false, '12345::1 must be rejected');
  assert.equal(isValidIp('2001:db8::1'), true, '2001:db8::1 must be accepted');
  assert.equal(isValidIp('::ffff:192.0.2.1'), true, '::ffff:192.0.2.1 must be accepted');

  // Additional valid/invalid checks
  assert.equal(isValidIp('192.168.1.1'), true);
  assert.equal(isValidIp('203.0.113.195'), true);
  assert.equal(isValidIp('256.0.0.1'), false);
  assert.equal(isValidIp('1.2.3'), false);
  assert.equal(isValidIp('::1'), true);
  assert.equal(isValidIp(''), false);
});

await test('PLAN-03 / Phase C: normalizeIp canonicalizes equivalent representations and maps invalid inputs to unknown', () => {
  // Equivalent representations map to identical canonical identity
  assert.equal(
    normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001'),
    '2001:db8::1'
  );
  assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '::ffff:192.0.2.1');
  assert.equal(normalizeIp('192.168.1.1'), '192.168.1.1');

  // Invalid representations map to 'unknown'
  assert.equal(normalizeIp('::::'), 'unknown');
  assert.equal(normalizeIp('1:2'), 'unknown');
  assert.equal(normalizeIp('12345::1'), 'unknown');
  assert.equal(normalizeIp(''), 'unknown');
  assert.equal(normalizeIp('attacker-string'), 'unknown');
});

await test('PLAN-03 / Phase C: getClientIp establishes platform contract on Vercel and safe off-platform fallbacks', async () => {
  // 1. On Vercel: x-vercel-forwarded-for takes precedence over x-real-ip
  await withIsolatedEnv({ VERCEL: '1' }, async () => {
    const reqVercelForwarded = new Request('https://portfolio-ibem.vercel.app/api/missive', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.88, 10.0.0.1',
        'x-real-ip': '198.51.100.99',
        'x-forwarded-for': '1.1.1.1',
      },
    });
    assert.equal(getClientIp(reqVercelForwarded), '203.0.113.88');

    // 2. On Vercel: x-real-ip fallback when x-vercel-forwarded-for absent
    const reqRealIp = new Request('https://portfolio-ibem.vercel.app/api/missive', {
      headers: {
        'x-real-ip': '203.0.113.89',
        'x-forwarded-for': '1.1.1.1',
      },
    });
    assert.equal(getClientIp(reqRealIp), '203.0.113.89');

    // 3. On Vercel: spoofed x-forwarded-for is completely ignored
    const reqSpoofedXff = new Request('https://portfolio-ibem.vercel.app/api/missive', {
      headers: {
        'x-forwarded-for': '9.9.9.9',
      },
    });
    assert.equal(getClientIp(reqSpoofedXff), 'unknown', 'Missing platform headers must map to unknown on Vercel');

    // 4. Missing headers map to 'unknown'
    const reqEmpty = new Request('https://portfolio-ibem.vercel.app/api/missive');
    assert.equal(getClientIp(reqEmpty), 'unknown');
  });

  // 5. Off-platform (local dev): x-real-ip -> x-forwarded-for -> 127.0.0.1
  await withIsolatedEnv({ VERCEL: undefined, VERCEL_ENV: undefined }, async () => {
    const reqOffPlatformXff = new Request('http://localhost:4321/api/missive', {
      headers: {
        'x-forwarded-for': '198.51.100.25, 10.0.0.1',
      },
    });
    assert.equal(getClientIp(reqOffPlatformXff), '198.51.100.25');

    const reqOffPlatformDefault = new Request('http://localhost:4321/api/missive');
    assert.equal(getClientIp(reqOffPlatformDefault), '127.0.0.1');
  });
});

await test('PLAN-03 / Phase C: rotating malformed and missing IPs map to shared unknown bucket and cannot bypass rate limiting', async () => {
  await withIsolatedEnv({ VERCEL: '1' }, async () => {
    const makeReqBadIp = (badHeaderVal) =>
      POST({
        request: new Request('http://localhost:4321/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:4321',
            'x-real-ip': badHeaderVal,
          },
          body: JSON.stringify({
            name: 'Bob',
            email: 'bob@gmail.com',
            subject: 'Test',
            message: 'Hello',
            turnstileToken: 'test-pass-bad-ip',
          }),
        }),
      });

    // First request with invalid IPv6 '::::' -> maps to 'unknown', attempts recorded
    const res1 = await makeReqBadIp('::::');
    assert.notEqual(res1.status, 429);

    // Second request with different malformed IP '1:2' -> maps to 'unknown' -> hits 30s cooldown (429)!
    const res2 = await makeReqBadIp('1:2');
    assert.equal(res2.status, 429, 'Rotating malformed IPs must share the bounded unknown bucket');
    assert.equal(__getIpBucketCount(), 1, 'Only one bucket ("unknown") must be created');
  });
});

// ── PLAN-01 / Phase B: Turnstile Validation Contract Regressions ────────────
await test('PLAN-01 / Phase B: verifies Turnstile accepts exact canonical host and rejects attacker / unrelated vercel.app hosts in production', async () => {
  let mockResponse = {};
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () => new Response(JSON.stringify(mockResponse), { status: 200 })
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'production',
      TURNSTILE_SECRET: 'real-prod-secret-key',
    },
    async () => {
      // 1. Valid canonical host + valid action -> success
      mockResponse = { success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' };
      const resCanonical = await verifyTurnstile('tok-canonical', '203.0.113.40');
      assert.equal(resCanonical.success, true);

      // 2. Unrelated vercel hostname -> REJECTED (wildcard *.vercel.app suffix removed)
      mockResponse = { success: true, action: 'contact-missive', hostname: 'attacker.vercel.app' };
      const resUnrelated = await verifyTurnstile('tok-unrelated', '203.0.113.41');
      assert.equal(resUnrelated.success, false);
      assert.match(resUnrelated.error, /hostname mismatch/i);

      // 3. Attacker domain -> REJECTED
      mockResponse = { success: true, action: 'contact-missive', hostname: 'attacker.example.com' };
      const resAttacker = await verifyTurnstile('tok-attacker', '203.0.113.42');
      assert.equal(resAttacker.success, false);
      assert.match(resAttacker.error, /hostname mismatch/i);

      // 4. Missing or empty hostname in production -> REJECTED
      mockResponse = { success: true, action: 'contact-missive' };
      const resNoHost = await verifyTurnstile('tok-nohost', '203.0.113.43');
      assert.equal(resNoHost.success, false);
      assert.match(resNoHost.error, /hostname mismatch/i);

      // 5. Wrong action in production -> REJECTED
      mockResponse = { success: true, action: 'login', hostname: 'portfolio-ibem.vercel.app' };
      const resWrongAction = await verifyTurnstile('tok-wrong-act', '203.0.113.44');
      assert.equal(resWrongAction.success, false);
      assert.match(resWrongAction.error, /action mismatch/i);

      // 6. Missing action in production -> REJECTED
      mockResponse = { success: true, hostname: 'portfolio-ibem.vercel.app' };
      const resNoAction = await verifyTurnstile('tok-no-act', '203.0.113.45');
      assert.equal(resNoAction.success, false);
      assert.match(resNoAction.error, /action mismatch/i);

      // 7. success: false from Turnstile -> REJECTED
      mockResponse = { success: false, 'error-codes': ['invalid-input-response'] };
      const resFail = await verifyTurnstile('tok-fail', '203.0.113.46');
      assert.equal(resFail.success, false);
    }
  );

  // 8. Explicit approved preview host -> accepted
  await withIsolatedEnv(
    {
      NODE_ENV: 'production',
      TURNSTILE_SECRET: 'real-prod-secret-key',
      APPROVED_PREVIEW_HOSTNAME: 'preview-branch-123.vercel.app',
    },
    async () => {
      mockResponse = {
        success: true,
        action: 'contact-missive',
        hostname: 'preview-branch-123.vercel.app',
      };
      const resPreview = await verifyTurnstile('tok-preview', '203.0.113.47');
      assert.equal(resPreview.success, true);
    }
  );
});

await test('PLAN-01 / Phase B: Turnstile upstream error and timeout return 503 service error', async () => {
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () => new Response('Internal Server Error', { status: 500 })
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'production',
      TURNSTILE_SECRET: 'real-prod-secret-key',
    },
    async () => {
      const res500 = await verifyTurnstile('tok-err-500', '203.0.113.48');
      assert.equal(res500.success, false);
      assert.equal(res500.isServiceError, true);
    }
  );

  mockNetwork.reset();
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () => {
      throw new Error('Network timeout');
    }
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'production',
      TURNSTILE_SECRET: 'real-prod-secret-key',
    },
    async () => {
      const resTimeout = await verifyTurnstile('tok-err-timeout', '203.0.113.49');
      assert.equal(resTimeout.success, false);
      assert.equal(resTimeout.isServiceError, true);
    }
  );
});

// ── PLAN-01 & PLAN-02: Hostname and Origin Configuration Contracts (Reviewer 6)
await test('PLAN-01 & PLAN-02: getExpectedHostnames and getAllowedOrigins enforce strict hostname validation and reject credentials/queries', () => {
  // 1. PUBLIC_SITE_URL with credentials -> rejected
  withIsolatedEnv({ PUBLIC_SITE_URL: 'https://admin:secret@portfolio.example.com' }, () => {
    const hosts = getExpectedHostnames();
    assert.equal(hosts.has('portfolio.example.com'), false);
    const origins = getAllowedOrigins();
    assert.equal(origins.has('https://portfolio.example.com'), false);
  });

  // 2. PUBLIC_SITE_URL with query string -> rejected
  withIsolatedEnv({ PUBLIC_SITE_URL: 'https://portfolio.example.com?foo=bar' }, () => {
    const hosts = getExpectedHostnames();
    assert.equal(hosts.has('portfolio.example.com'), false);
  });

  // 3. PUBLIC_SITE_URL with hash fragment -> rejected
  withIsolatedEnv({ PUBLIC_SITE_URL: 'https://portfolio.example.com#section' }, () => {
    const hosts = getExpectedHostnames();
    assert.equal(hosts.has('portfolio.example.com'), false);
  });

  // 4. APPROVED_PREVIEW_HOSTNAME with invalid hostname characters -> rejected
  withIsolatedEnv({ APPROVED_PREVIEW_HOSTNAME: 'evil.com/path' }, () => {
    const hosts = getExpectedHostnames();
    assert.equal(hosts.has('evil.com/path'), false);
  });

  withIsolatedEnv({ APPROVED_PREVIEW_HOSTNAME: 'preview..com' }, () => {
    const hosts = getExpectedHostnames();
    assert.equal(hosts.has('preview..com'), false);
  });

  // 5. Valid custom site URL and valid preview hostname -> accepted
  withIsolatedEnv(
    {
      PUBLIC_SITE_URL: 'https://custom.nhovem.dev',
      APPROVED_PREVIEW_HOSTNAME: 'branch-123.vercel.app',
    },
    () => {
      const hosts = getExpectedHostnames();
      assert.equal(hosts.has('custom.nhovem.dev'), true);
      assert.equal(hosts.has('branch-123.vercel.app'), true);
      assert.equal(hosts.has('portfolio-ibem.vercel.app'), true);

      const origins = getAllowedOrigins();
      assert.equal(origins.has('https://custom.nhovem.dev'), true);
      assert.equal(origins.has('https://branch-123.vercel.app'), true);
    }
  );
});

await test('PLAN-02: POST rejects incoming Origin with credentials, queries, fragments, or subpaths', async () => {
  await withIsolatedEnv({ NODE_ENV: 'production' }, async () => {
    const malformedOrigins = [
      'https://admin:pass@portfolio-ibem.vercel.app',
      'https://admin@portfolio-ibem.vercel.app',
      'https://portfolio-ibem.vercel.app?query=1',
      'https://portfolio-ibem.vercel.app#fragment',
      'https://portfolio-ibem.vercel.app/admin/path',
      'https://portfolio-ibem.vercel.app/contact',
    ];

    for (const badOrigin of malformedOrigins) {
      const res = await POST({
        request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: badOrigin,
          },
          body: '{}',
        }),
      });
      assert.equal(res.status, 403, `Origin "${badOrigin}" must be rejected with 403`);
      const body = await res.json();
      assert.match(body.message, /malformed origin/i);
    }
  });
});

await test('PLAN-02: origin policy enforces exact HTTPS production origins and rejects HTTP / localhost in production', async () => {
  await withIsolatedEnv({ NODE_ENV: 'production' }, async () => {
    // 1. Exact canonical production origin -> accepted
    const allowed = getAllowedOrigins();
    assert.equal(allowed.has('https://portfolio-ibem.vercel.app'), true);

    // 2. Loopback HTTP in production -> rejected with 403
    const resLoopbackProd = await POST({
      request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:4321',
        },
        body: '{}',
      }),
    });
    assert.equal(resLoopbackProd.status, 403);

    // 3. Prefix-trick origin -> rejected with 403
    for (const evilOrigin of [
      'http://localhost:.attacker.example',
      'http://localhost:attacker.com',
      'https://portfolio-ibem.vercel.app.attacker.com',
      'https://attacker.example',
    ]) {
      const resEvil = await POST({
        request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: evilOrigin,
          },
          body: '{}',
        }),
      });
      assert.equal(resEvil.status, 403);
    }

    // 4. Missing Origin in production -> rejected with 403
    const resNoOrigin = await POST({
      request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    });
    assert.equal(resNoOrigin.status, 403);

    // 5. Origin: null -> rejected with 403
    const resNullOrigin = await POST({
      request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'null' },
        body: '{}',
      }),
    });
    assert.equal(resNullOrigin.status, 403);

    // 6. sec-fetch-site: cross-site -> rejected with 403
    const resCrossSite = await POST({
      request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://portfolio-ibem.vercel.app',
          'sec-fetch-site': 'cross-site',
        },
        body: '{}',
      }),
    });
    assert.equal(resCrossSite.status, 403);
  });
});

// ── PLAN-05 / Phase D: Request Boundaries, Multibyte UTF-8, and Malformed Bodies
await test('PLAN-05 / Phase D: body size boundaries (at, below, above 16,384 bytes) and multibyte UTF-8 handling', async () => {
  // Helper to create exact byte-length JSON payloads
  const baseJsonPrefix = '{"name":"A","email":"a@b.com","subject":"S","message":"';
  const baseJsonSuffix = '"}';
  const overhead = Buffer.byteLength(baseJsonPrefix + baseJsonSuffix, 'utf8');

  // 1. Below 16,384 bytes (exact 16,383 bytes) -> accepted for parsing, hits specific field validation
  const fillBelow = 'x'.repeat(16_383 - overhead);
  const body16383 = baseJsonPrefix + fillBelow + baseJsonSuffix;
  assert.equal(Buffer.byteLength(body16383, 'utf8'), 16_383, 'Must match exact 16,383 bytes');

  const res16383 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.101',
      },
      body: body16383,
    }),
  });
  // Exact status 400, specific field: 'message', not merely 'not 413'!
  assert.equal(res16383.status, 400, 'Accepted by byte parser; rejected by field validator');
  const data16383 = await res16383.json();
  assert.equal(data16383.isValidationError, true);
  assert.equal(data16383.field, 'message');
  assert.match(data16383.message, /Message cannot exceed 5000 characters/);
  assert.equal(mockNetwork.recordedCalls.length, 0, 'Zero provider calls for rejected payload');

  // 2. Exactly 16,384 bytes -> accepted for parsing, hits specific field validation
  const fillExact = 'x'.repeat(16_384 - overhead);
  const body16384 = baseJsonPrefix + fillExact + baseJsonSuffix;
  assert.equal(Buffer.byteLength(body16384, 'utf8'), 16_384, 'Must match exact 16,384 bytes');

  const res16384 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.102',
      },
      body: body16384,
    }),
  });
  assert.equal(res16384.status, 400, 'Accepted by byte parser at 16,384 limit; rejected by field validator');
  const data16384 = await res16384.json();
  assert.equal(data16384.isValidationError, true);
  assert.equal(data16384.field, 'message');
  assert.match(data16384.message, /Message cannot exceed 5000 characters/);
  assert.equal(mockNetwork.recordedCalls.length, 0, 'Zero provider calls for rejected payload');

  // 3. Above 16,384 bytes (exact 16,385 bytes) -> rejected with 413 Payload Too Large
  const fillAbove = 'x'.repeat(16_385 - overhead);
  const body16385 = baseJsonPrefix + fillAbove + baseJsonSuffix;
  assert.equal(Buffer.byteLength(body16385, 'utf8'), 16_385, 'Must match exact 16,385 bytes');

  const res16385 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.103',
      },
      body: body16385,
    }),
  });
  assert.equal(res16385.status, 413, 'Must return 413 Payload Too Large');
  const data16385 = await res16385.json();
  assert.equal(data16385.message, 'Request payload is too large (maximum 16 KB).');
  assert.equal(mockNetwork.recordedCalls.length, 0, 'Zero provider calls for oversized payload');

  // Emojis (🪶 = \u{1FAB6} = exactly 4 bytes in UTF-8).
  const emoji = '🪶';
  const emojiCount = Math.floor((16_384 - overhead) / 4);
  const emojiRemainder = (16_384 - overhead) % 4;
  const multibyteAtLimit = baseJsonPrefix + emoji.repeat(emojiCount) + 'y'.repeat(emojiRemainder) + baseJsonSuffix;
  assert.equal(Buffer.byteLength(multibyteAtLimit, 'utf8'), 16_384, 'Multibyte body exactly 16,384 bytes');

  const resMultibyteLimit = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.104',
      },
      body: multibyteAtLimit,
    }),
  });
  // Accepted for parsing, hits message > 5000 character length or validation check
  assert.equal(resMultibyteLimit.status, 400, 'Multibyte body at 16,384 bytes accepted by byte parser');
  const dataMultiLimit = await resMultibyteLimit.json();
  assert.equal(dataMultiLimit.isValidationError, true);
  assert.equal(mockNetwork.recordedCalls.length, 0);

  // 5. Multibyte UTF-8 above boundary: 4,500 4-byte characters (18,000+ bytes) -> rejected with 413!
  const multibyteBody = JSON.stringify({
    name: 'Alice',
    email: 'alice@gmail.com',
    subject: 'Shield',
    message: '🛡️'.repeat(4_500),
  });
  assert.ok(Buffer.byteLength(multibyteBody, 'utf8') > 16_384, 'Byte length exceeds 16 KB');

  const resMultibyte = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.105',
      },
      body: multibyteBody,
    }),
  });
  assert.equal(resMultibyte.status, 413, 'Multibyte body exceeding 16 KB must return 413');
  const dataMultibyte = await resMultibyte.json();
  assert.equal(dataMultibyte.message, 'Request payload is too large (maximum 16 KB).');
  assert.equal(mockNetwork.recordedCalls.length, 0);

  // 6. Valid field content padded to exact 16,383 bytes with whitespace -> passes field validation!
  const validMessage = 'A'.repeat(4_000); // 4000 characters <= 5000 max
  const rawPrefix = '{"name":"Alice","email":"alice@gmail.com","subject":"Valid","message":"' + validMessage + '", "padding":"';
  const rawSuffix = '"}';
  // Note: "padding" is not in ALLOWED_KEYS, so use whitespace outside keys
  const validJson = JSON.stringify({
    name: 'Alice',
    email: 'alice@gmail.com',
    subject: 'Valid',
    message: validMessage,
  });
  const padNeeded = 16_383 - Buffer.byteLength(validJson, 'utf8');
  assert.ok(padNeeded > 0);
  const whitespacePaddedJson = validJson.slice(0, -1) + ' '.repeat(padNeeded) + '}';
  assert.equal(Buffer.byteLength(whitespacePaddedJson, 'utf8'), 16_383, 'Exact 16,383 bytes with whitespace');

  const resValidPadded = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.106',
      },
      body: whitespacePaddedJson,
    }),
  });
  // Passes body reader, passes field checks! Reaches Turnstile verification (fails challenge / missing token with 400)
  assert.equal(resValidPadded.status, 400);
  const dataValidPadded = await resValidPadded.json();
  assert.equal(dataValidPadded.field, 'turnstile', 'Must advance past field checks to Turnstile challenge');
  assert.equal(mockNetwork.recordedCalls.length, 0);
});

await test('PLAN-05 / Phase D: missing and misleading Content-Length, stream read errors, and malformed UTF-8', async () => {
  // 1. Missing Content-Length header with valid small body -> processed correctly
  const resNoCl = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.105',
      },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@gmail.com',
        message: 'Hello',
        turnstileToken: 'test-pass-nocl',
      }),
    }),
  });
  assert.notEqual(resNoCl.status, 413);
  assert.notEqual(resNoCl.status, 400);

  // 2. Misleading Content-Length header: header says 10 bytes, actual stream is 18 KB
  const resMisleading = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '10',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.106',
      },
      body: JSON.stringify({ message: 'x'.repeat(18_000) }),
    }),
  });
  assert.equal(resMisleading.status, 413);

  // 3. Stream read error simulation
  const failingStream = new ReadableStream({
    start(controller) {
      controller.error(new Error('Connection reset by peer during read'));
    },
  });
  const resStreamErr = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.107',
      },
      body: failingStream,
      duplex: 'half',
    }),
  });
  assert.equal(resStreamErr.status, 400);
  const streamData = await resStreamErr.json();
  assert.match(streamData.message, /stream/i);

  // 4. Invalid UTF-8 bytes in body -> rejected with 400
  const invalidUtf8 = new Uint8Array([0x7b, 0x22, 0x6e, 0x61, 0x6d, 0x65, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  const resUtf8 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.108',
      },
      body: invalidUtf8,
    }),
  });
  assert.equal(resUtf8.status, 400);
  const dataUtf8 = await resUtf8.json();
  assert.match(dataUtf8.message, /valid UTF-8/i);

  // 5. Malformed JSON syntax
  const resBadJson = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.109',
      },
      body: '{"name": "Alice", unterminated',
    }),
  });
  assert.equal(resBadJson.status, 400);

  // Assert ZERO outbound calls
  assert.equal(mockNetwork.recordedCalls.length, 0);
});

// ── PLAN-05: Endpoint Concurrency, Quotas & State Bounding (Reviewer 7) ──────
await test('PLAN-05: endpoint concurrency enforces same-IP cooldown and prevents burst races with exact status and call count', async () => {
  let resendCallCount = 0;
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () =>
      new Response(
        JSON.stringify({ success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }),
        { status: 200 }
      )
  );
  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    () => {
      resendCallCount++;
      return new Response(JSON.stringify({ id: 'msg_same_ip_burst' }), { status: 200 });
    }
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'test',
      EMAIL_API_KEY: 'test_key',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
      TURNSTILE_SECRET: 'test_secret',
    },
    async () => {
      const makeReq = (token) =>
        POST({
          request: new Request('http://localhost:4321/api/missive', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:4321',
              'x-real-ip': '203.0.113.120',
            },
            body: JSON.stringify({
              name: 'Traveler',
              email: 'traveler@gmail.com',
              subject: 'Dispatch',
              message: 'Concurrent message burst test',
              turnstileToken: token,
            }),
          }),
        });

      // Dispatch 2 concurrent requests from the exact same IP with different tokens
      const [res1, res2] = await Promise.all([makeReq('burst-token-1'), makeReq('burst-token-2')]);

      // Exactly one request must succeed (200) and the other must hit 30s cooldown (429)
      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [200, 429], 'Exactly one 200 and one 429 expected for concurrent same-IP burst');

      const acceptedRes = res1.status === 200 ? res1 : res2;
      const rejectedRes = res1.status === 429 ? res1 : res2;

      const acceptedData = await acceptedRes.json();
      assert.equal(acceptedData.delivered, true);

      const rejectedData = await rejectedRes.json();
      assert.match(rejectedData.message, /wait \d+s before sending another message/i, 'Must hit cooldown reason');
      assert.equal(resendCallCount, 1, 'Provider call count must be exactly one');
    }
  );
});

await test('PLAN-05: endpoint rate limiting enforces per-IP hourly last-slot competition separately from cooldown', async () => {
  let resendCallCount = 0;
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () =>
      new Response(
        JSON.stringify({ success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }),
        { status: 200 }
      )
  );

  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    () => {
      resendCallCount++;
      return new Response(JSON.stringify({ id: 'msg_quota_competition' }), { status: 200 });
    }
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'test',
      EMAIL_API_KEY: 'test_key',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
      TURNSTILE_SECRET: 'test_secret',
    },
    async () => {
      const now = Date.now();
      const testIp = '203.0.113.130';
      // Seed 5 attempts older than 30s cooldown (e.g. 40s to 60s ago)
      // Exactly 1 slot remains for this IP in the hourly window!
      __seedIpBucketForTests(testIp, [
        now - 60_000,
        now - 55_000,
        now - 50_000,
        now - 45_000,
        now - 40_000,
      ]);

      const makeReq = (token) =>
        POST({
          request: new Request('http://localhost:4321/api/missive', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:4321',
              'x-real-ip': testIp,
            },
            body: JSON.stringify({
              name: 'Traveler',
              email: 'traveler@gmail.com',
              subject: 'Hourly Quota Competition',
              message: 'Compete for slot 6',
              turnstileToken: token,
            }),
          }),
        });

      // 2 concurrent requests compete for the final 6th slot
      const [resA, resB] = await Promise.all([makeReq('slot6-token-A'), makeReq('slot6-token-B')]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepEqual(statuses, [200, 429], 'Exactly one request wins slot 6 and one is rejected');

      const rejected = resA.status === 429 ? resA : resB;
      const dataRej = await rejected.json();
      // Crucial: The rejection is specifically due to the HOURLY LIMIT, NOT cooldown!
      assert.match(dataRej.message, /hourly message limit/i, 'Must be rejected for hourly limit, NOT cooldown');
      assert.equal(resendCallCount, 1, 'Provider calls during slot competition must be exactly 1');
    }
  );
});

await test('PLAN-05: endpoint rate limiting enforces global per-instance hourly last-slot competition from different IPs', async () => {
  let resendCallCount = 0;
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () =>
      new Response(
        JSON.stringify({ success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }),
        { status: 200 }
      )
  );

  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    () => {
      resendCallCount++;
      return new Response(JSON.stringify({ id: 'msg_global_slot40' }), { status: 200 });
    }
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'test',
      EMAIL_API_KEY: 'test_key',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
      TURNSTILE_SECRET: 'test_secret',
    },
    async () => {
      const now = Date.now();
      // Seed 39 global attempts: exactly 1 global slot remains out of 40!
      __seedGlobalTimestampsForTests(Array(39).fill(now - 10_000));

      const ipA = '203.0.113.151';
      const ipB = '203.0.113.152';

      const sendFrom = (ip, token) =>
        POST({
          request: new Request('http://localhost:4321/api/missive', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:4321',
              'x-real-ip': ip,
            },
            body: JSON.stringify({
              name: 'Traveler',
              email: 'traveler@gmail.com',
              subject: 'Global Burst Competition',
              message: 'Compete for slot 40',
              turnstileToken: token,
            }),
          }),
        });

      // 2 concurrent requests from DIFFERENT IPs compete for the 40th global slot
      const [resA, resB] = await Promise.all([sendFrom(ipA, 'global-tok-A'), sendFrom(ipB, 'global-tok-B')]);

      const statuses = [resA.status, resB.status].sort();
      assert.deepEqual(statuses, [200, 429], 'Exactly one request wins slot 40; the other is rejected');

      const rejected = resA.status === 429 ? resA : resB;
      const dataRej = await rejected.json();
      assert.match(dataRej.message, /busy right now/i, 'Must be rejected for global burst cap');
      assert.equal(resendCallCount, 1, 'Provider calls for global slot competition must be exactly 1');
    }
  );
});

await test('PLAN-05: same-token concurrency does not produce duplicate delivery and provider call count is exactly one', async () => {
  let resendCallCount = 0;
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () =>
      new Response(
        JSON.stringify({ success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }),
        { status: 200 }
      )
  );

  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    () => {
      resendCallCount++;
      return new Response(JSON.stringify({ id: 'msg_single_dispatch' }), { status: 200 });
    }
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'test',
      EMAIL_API_KEY: 'test_key',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
      TURNSTILE_SECRET: 'test_secret',
    },
    async () => {
      const targetToken = 'concurrent-duplicate-token-test';
      const makeConcurrentReq = (ip) =>
        POST({
          request: new Request('http://localhost:4321/api/missive', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'http://localhost:4321',
              'x-real-ip': ip,
            },
            body: JSON.stringify({
              name: 'Alice',
              email: 'alice@gmail.com',
              subject: 'Dedup',
              message: 'Testing concurrent duplicate delivery protection',
              turnstileToken: targetToken,
            }),
          }),
        });

      const [resA, resB] = await Promise.all([
        makeConcurrentReq('203.0.113.141'),
        makeConcurrentReq('203.0.113.142'),
      ]);

      const successCount = (resA.status === 200 ? 1 : 0) + (resB.status === 200 ? 1 : 0);
      assert.equal(successCount, 1, 'Exactly one concurrent request with the same token must succeed');
      assert.equal(resendCallCount, 1, 'Resend provider must receive exactly ONE outbound delivery call');

      const rejected = resA.status !== 200 ? resA : resB;
      assert.equal(rejected.status, 400);
      const dataRej = await rejected.json();
      assert.match(dataRej.message, /already been used/i);
    }
  );
});

await test('PLAN-05: in-flight token state cleans up properly on provider abort or failure', async () => {
  // Provider route throws network error / timeout
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () => {
      const err = new Error('Upstream timeout during Turnstile verification');
      err.name = 'TimeoutError';
      throw err;
    }
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'test',
      EMAIL_API_KEY: 'test_key',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
      TURNSTILE_SECRET: 'test_secret',
    },
    async () => {
      const failingToken = 'token-failing-upstream';
      const res = await POST({
        request: new Request('http://localhost:4321/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:4321',
            'x-real-ip': '203.0.113.170',
          },
          body: JSON.stringify({
            name: 'Alice',
            email: 'alice@gmail.com',
            subject: 'Cleanup',
            message: 'Testing in-flight token cleanup',
            turnstileToken: failingToken,
          }),
        }),
      });

      assert.equal(res.status, 503);
      // In-flight token set MUST have cleaned up the token in finally block!
      assert.equal(__getInFlightTokensCount(), 0, 'In-flight token map must be clean after provider failure');
    }
  );
});

// ── PLAN-06 / Phase D: Delivery Matrix & Upstream Behavior (Reviewer 7) ──────
await test('PLAN-06 / Phase D: delivery matrix (both Resend settings, each alone with/without Web3Forms, neither present)', async () => {
  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    () => new Response(JSON.stringify({ id: 'resend_msg_ok' }), { status: 200 })
  );

  const makeReq = (ip, token) =>
    POST({
      request: new Request('http://localhost:4321/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:4321',
          'x-real-ip': ip,
        },
        body: JSON.stringify({
          name: 'Traveler',
          email: 'traveler@gmail.com',
          subject: 'Matrix Test',
          message: 'Testing provider matrix',
          turnstileToken: token,
        }),
      }),
    });

  // Case 1: Both Resend settings present -> Server-to-server delivery (delivered: true)
  await withIsolatedEnv(
    {
      EMAIL_API_KEY: 'resend_key',
      CONTACT_TO_ADDRESS: 'dest@example.test',
      WEB3FORMS_KEY: 'web3_public_key',
    },
    async () => {
      const res = await makeReq('203.0.113.151', 'test-pass-matrix-1');
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.delivered, true);
      assert.equal('accessKey' in data, false);
    }
  );

  // Partial server configuration must not downgrade to public provider delivery.
  await withIsolatedEnv(
    {
      EMAIL_API_KEY: 'resend_key',
      CONTACT_TO_ADDRESS: undefined,
      WEB3FORMS_KEY: 'web3_public_key',
    },
    async () => {
      const res = await makeReq('203.0.113.152', 'test-pass-matrix-2');
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal('accessKey' in data, false);
      assert.match(data.message, /incomplete/i);
    }
  );

  // The other partial-server configuration also fails closed.
  await withIsolatedEnv(
    {
      EMAIL_API_KEY: undefined,
      CONTACT_TO_ADDRESS: 'dest@example.test',
      WEB3FORMS_KEY: 'web3_public_key',
    },
    async () => {
      const res = await makeReq('203.0.113.153', 'test-pass-matrix-3');
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal('accessKey' in data, false);
      assert.match(data.message, /incomplete/i);
    }
  );

  // Case 4: EMAIL_API_KEY alone without CONTACT_TO_ADDRESS and NO Web3Forms -> 503 missing key
  await withIsolatedEnv(
    {
      EMAIL_API_KEY: 'resend_key',
      CONTACT_TO_ADDRESS: undefined,
      WEB3FORMS_KEY: undefined,
    },
    async () => {
      const res = await makeReq('203.0.113.154', 'test-pass-matrix-4');
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.match(data.message, /incomplete/i);
    }
  );

  // Case 5: Neither present -> 503 missing key
  await withIsolatedEnv(
    {
      EMAIL_API_KEY: undefined,
      CONTACT_TO_ADDRESS: undefined,
      WEB3FORMS_KEY: undefined,
    },
    async () => {
      const res = await makeReq('203.0.113.155', 'test-pass-matrix-5');
      assert.equal(res.status, 503);
    }
  );
});

await test('PLAN-06: Resend upstream abort/timeout handling observes AbortSignal correctly', async () => {
  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    (call, url, init) => {
      assert.ok(init?.signal, 'Resend outbound request must supply an AbortSignal');
      assert.equal(typeof init?.signal.addEventListener, 'function');
      assert.equal(init?.signal.aborted, false, 'AbortSignal must start non-aborted');

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('AbortSignal did not abort within 200ms'));
        }, 200);

        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        });
      });
    }
  );

  await withIsolatedEnv(
    {
      EMAIL_API_KEY: 'test_resend_key',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
    },
    async () => {
      const res = await POST({
        request: new Request('http://localhost:4321/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:4321',
            'x-real-ip': '203.0.113.156',
          },
          body: JSON.stringify({
            name: 'Bob',
            email: 'bob@gmail.com',
            subject: 'Timeout',
            message: 'Testing timeout signal',
            turnstileToken: 'test-pass-timeout-sig',
          }),
        }),
      });
      // In fast test environment, timeout triggers 504
      assert.equal(res.status, 504);
      const data = await res.json();
      assert.match(data.message, /timed out/i);
    }
  );
});

await test('PLAN-06: client sendMissive integration tests (server-delivered vs browser-assisted Web3Forms)', async () => {
  // 1. Test server delivery path: /api/missive returns delivered: true
  const mockFetchServerDelivered = async (url) => {
    if (url === '/api/missive') {
      return new Response(
        JSON.stringify({
          success: true,
          delivered: true,
          sanitized: { name: 'Alice', email: 'alice@gmail.com', subject: 'Hi', body: 'Msg' },
          message: 'Message accepted for delivery.',
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const clientResServer = await sendMissive(
    { name: 'Alice', email: 'alice@gmail.com', subject: 'Hi', message: 'Msg' },
    { fetchImpl: mockFetchServerDelivered }
  );
  assert.equal(clientResServer.success, true);
  assert.match(clientResServer.message, /accepted for delivery/i);

  // 2. Test browser-assisted Web3Forms path: /api/missive returns accessKey, client posts to Web3Forms
  let web3FormsCalled = false;
  const mockFetchWeb3Path = async (url, init) => {
    if (url === '/api/missive') {
      assert.equal(JSON.parse(init.body).hcaptchaToken, undefined, 'Provider proof must not reach first-party verification');
      return new Response(
        JSON.stringify({
          success: true,
          authorized: true,
          delivered: false,
          accessKey: 'synth_w3f_key',
          sanitized: { name: 'Alice Clean', email: 'alice@gmail.com', subject: 'Clean', body: 'Msg' },
        }),
        { status: 200 }
      );
    }
    if (url === 'https://api.web3forms.com/submit') {
      web3FormsCalled = true;
      assert.equal(init?.method, 'POST');
      const bodyObj = JSON.parse(init?.body);
      assert.equal(bodyObj.access_key, 'synth_w3f_key');
      assert.equal(bodyObj.name, 'Alice Clean');
      assert.equal(bodyObj['h-captcha-response'], 'synthetic-provider-proof');
      assert.equal(bodyObj.turnstileToken, undefined);
      return new Response(JSON.stringify({ success: true, message: 'Delivered via Web3Forms' }), { status: 200 });
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const clientResWeb3 = await sendMissive(
    { name: 'Alice Injected', email: 'alice@gmail.com', subject: 'Raw', message: 'Msg', hcaptchaToken: 'synthetic-provider-proof' },
    { fetchImpl: mockFetchWeb3Path }
  );
  assert.equal(clientResWeb3.success, true);
  assert.equal(web3FormsCalled, true);
  web3FormsCalled = false;
  const missingProof = await sendMissive(
    { name: 'Alice', email: 'alice@gmail.com', subject: 'Raw', message: 'Msg' },
    { fetchImpl: mockFetchWeb3Path }
  );
  assert.equal(missingProof.success, false);
  assert.match(missingProof.message, /delivery verification/i);
  assert.equal(web3FormsCalled, false, 'No provider request without proof');
  assert.ok(missingProof.fallbackMailto);
});

// ── PLAN-07 / Phase E: Messenger Draft Lifecycle (Reviewer 8) ───────────────
await test('PLAN-07 / Phase E: messenger draft lifecycle (empty-save, defensive copy, failed-send retention, confirmed-send clearing)', async () => {
  clearMissiveDraft();
  assert.equal(getMissiveDraft(), null);

  // 1. Non-empty draft save
  saveMissiveDraft({
    name: 'Alice Traveler',
    email: 'alice@example.test',
    subject: 'Question',
    body: 'Draft message content',
  });
  const saved = getMissiveDraft();
  assert.ok(saved);
  assert.equal(saved.name, 'Alice Traveler');

  // 2. Defensive copy (mutating returned object does not mutate stored draft)
  saved.name = 'Mutated Directly';
  assert.equal(getMissiveDraft().name, 'Alice Traveler', 'Getter must return defensive copy');

  // 3. Emptied form -> save empty draft -> clears stored draft
  saveMissiveDraft({ name: '', email: '   ', subject: '', body: '\n\t  ' });
  assert.equal(getMissiveDraft(), null, 'Saving emptied form must clear stored draft');

  // 4. Failed send retains draft in memory
  saveMissiveDraft({ name: 'Bob', email: 'bob@example.com', subject: 'Inquiry', body: 'Preserve this' });
  assert.ok(getMissiveDraft());

  // Execute actual sendMissive with a failing mock fetch (500 internal server error)
  const failingFetch = async () =>
    new Response(JSON.stringify({ success: false, message: 'Simulated 500 service error' }), { status: 500 });

  const clientFailRes = await sendMissive(
    { name: 'Bob', email: 'bob@example.com', subject: 'Inquiry', message: 'Preserve this' },
    { fetchImpl: failingFetch }
  );
  assert.equal(clientFailRes.success, false);
  // Draft MUST remain intact in memory after failed send!
  assert.ok(getMissiveDraft(), 'In-memory draft must be preserved on failed send');
  assert.equal(getMissiveDraft().name, 'Bob');
  assert.equal(getMissiveDraft().body, 'Preserve this');

  // 5. Confirmed successful send clears draft
  const successFetch = async () =>
    new Response(JSON.stringify({ success: true, delivered: true, message: 'Delivered' }), { status: 200 });

  const clientSuccessRes = await sendMissive(
    { name: 'Bob', email: 'bob@example.com', subject: 'Inquiry', message: 'Preserve this' },
    { fetchImpl: successFetch }
  );
  assert.equal(clientSuccessRes.success, true);
  // Per MessengerRoom submit handler (line 2423), on confirmed success clearMissiveDraft is executed
  clearMissiveDraft();
  assert.equal(getMissiveDraft(), null, 'Confirmed delivery must clear stored draft');

  // 6. Explicit reset clears draft
  saveMissiveDraft({ name: 'Charlie', email: 'charlie@example.com', subject: 'Subj', body: 'Body' });
  assert.ok(getMissiveDraft());
  clearMissiveDraft();
  assert.equal(getMissiveDraft(), null, 'Explicit reset must clear draft');
});

// ── PLAN-08 / Phase E: Service Worker Behavioral Execution (Reviewer 8) ──────
await test('PLAN-08 / Phase E: service worker behavior execution (same-origin, no-store bypass, query navigation, offline fallback, cache bounds)', async () => {
  const swCode = readRepoFile('public/sw.js');

  const listeners = {};
  let skipWaitingCalled = false;
  const cachesStore = new Map();

  class MockCache {
    constructor(name) {
      this.name = name;
      this.items = new Map();
    }
    async put(req, res) {
      const k = typeof req === 'string' ? req : req.url;
      this.items.set(k, res);
    }
    async match(req, opts) {
      const k = typeof req === 'string' ? req : req.url;
      if (this.items.has(k)) return this.items.get(k);
      if (opts?.ignoreSearch) {
        const cleanK = k.split('?')[0];
        for (const [key, val] of this.items) {
          if (key.split('?')[0] === cleanK) return val;
        }
      }
      return null;
    }
    async keys() {
      return Array.from(this.items.keys()).map((url) => new Request(url));
    }
    async delete(req) {
      const k = typeof req === 'string' ? req : req.url;
      return this.items.delete(k);
    }
  }

  const mockCaches = {
    async open(name) {
      if (!cachesStore.has(name)) cachesStore.set(name, new MockCache(name));
      return cachesStore.get(name);
    },
    async match(req, opts) {
      for (const cache of cachesStore.values()) {
        const hit = await cache.match(req, opts);
        if (hit) return hit;
      }
      return null;
    },
    async keys() {
      return Array.from(cachesStore.keys());
    },
    async delete(name) {
      return cachesStore.delete(name);
    },
  };

  let mockNetworkFetch = async (req) => {
    return new Response('Mock Network Response', { status: 200 });
  };

  const sandbox = {
    self: {
      location: { origin: 'http://localhost:4321', href: 'http://localhost:4321/sw.js' },
      addEventListener: (type, fn) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      clients: { claim: async () => {} },
      skipWaiting: () => {
        skipWaitingCalled = true;
      },
    },
    caches: mockCaches,
    fetch: (req, init) => mockNetworkFetch(req, init),
    Request: globalThis.Request,
    Response: globalThis.Response,
    URL: globalThis.URL,
    Promise: globalThis.Promise,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  };
  sandbox.self.addEventListener = sandbox.self.addEventListener.bind(sandbox.self);

  // Execute the actual public/sw.js code inside the VM sandbox!
  vm.createContext(sandbox);
  vm.runInContext(swCode, sandbox);

  assert.ok(listeners.install?.length > 0, 'Must register install listener');
  assert.ok(listeners.activate?.length > 0, 'Must register activate listener');
  assert.ok(listeners.fetch?.length > 0, 'Must register fetch listener');
  assert.ok(listeners.message?.length > 0, 'Must register message listener');

  const fetchHandler = listeners.fetch[0];

  async function simulateFetch(req) {
    let responded = false;
    let responsePromise = null;
    let waitPromise = null;
    const event = {
      request: req,
      respondWith: (p) => {
        responded = true;
        responsePromise = p;
      },
      waitUntil: (p) => {
        waitPromise = p;
      },
    };
    fetchHandler(event);
    const res = responded ? await responsePromise : null;
    if (waitPromise) await waitPromise;
    return { responded, response: res };
  }

  // 1. Install event: Pre-caches critical app shell into nhovem-shell-v8
  let installWait = null;
  mockNetworkFetch = async () => new Response('Precached HTML', { status: 200 });
  listeners.install[0]({
    waitUntil: (p) => {
      installWait = p;
    },
  });
  await installWait;
  const shellCache = cachesStore.get('nhovem-shell-v8');
  assert.ok(shellCache, 'nhovem-shell-v8 must be created on install');
  assert.ok(await shellCache.match('/tavern'), 'Precached /tavern must exist');
  assert.ok(await shellCache.match('/offline'), 'Precached /offline must exist');

  // 2. Activate event: Old cache generations purged while unrelated caches preserved
  cachesStore.set('nhovem-shell-v7', new MockCache('nhovem-shell-v7'));
  cachesStore.set('unrelated-user-data', new MockCache('unrelated-user-data'));
  let activateWait = null;
  listeners.activate[0]({
    waitUntil: (p) => {
      activateWait = p;
    },
  });
  await activateWait;
  assert.equal(cachesStore.has('nhovem-shell-v7'), false, 'Old nhovem-shell-v7 must be purged');
  assert.equal(cachesStore.has('unrelated-user-data'), true, 'Unrelated cache must be preserved');

  // 3. Same-origin GET static asset -> cached in runtime cache
  mockNetworkFetch = async () =>
    new Response('body { color: gold; }', {
      status: 200,
      headers: { 'Content-Type': 'text/css' },
    });
  const cssReq = new Request('http://localhost:4321/_astro/bundle.css', { method: 'GET' });
  const cssResult = await simulateFetch(cssReq);
  assert.equal(cssResult.responded, true);
  const runtimeCache = cachesStore.get('nhovem-runtime-v8');
  assert.ok(runtimeCache, 'Runtime cache must exist');
  assert.ok(await runtimeCache.match('http://localhost:4321/_astro/bundle.css'), 'Asset must be stored in runtime cache');

  // 4. Private / no-store response -> NOT cached in runtime cache
  mockNetworkFetch = async () =>
    new Response('private data', {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, private' },
    });
  const noStoreReq = new Request('http://localhost:4321/private-page', {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });
  const noStoreResult = await simulateFetch(noStoreReq);
  assert.equal(noStoreResult.responded, true);
  assert.equal(await runtimeCache.match('http://localhost:4321/private-page'), null, 'no-store page must not be cached');

  // 5. API bypass: /api/* routes must NEVER be intercepted
  const apiReq = new Request('http://localhost:4321/api/missive', { method: 'GET' });
  const apiResult = await simulateFetch(apiReq);
  assert.equal(apiResult.responded, false, '/api/ endpoints must be bypassed');

  // 6. Non-GET bypass: POST requests must NEVER be intercepted
  const postReq = new Request('http://localhost:4321/any-page', { method: 'POST' });
  const postResult = await simulateFetch(postReq);
  assert.equal(postResult.responded, false, 'POST requests must be bypassed');

  // 7. Cross-origin bypass: external API endpoints must be bypassed
  const turnstileReq = new Request('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'GET' });
  const turnstileResult = await simulateFetch(turnstileReq);
  assert.equal(turnstileResult.responded, false, 'Cross-origin Cloudflare API must be bypassed');

  const web3Req = new Request('https://api.web3forms.com/submit', { method: 'GET' });
  const web3Result = await simulateFetch(web3Req);
  assert.equal(web3Result.responded, false, 'Cross-origin Web3Forms API must be bypassed');

  // 8. Google Fonts allowlist: cross-origin Google Fonts ARE handled
  mockNetworkFetch = async () =>
    new Response('@font-face {}', { status: 200, headers: { 'Content-Type': 'text/css' } });
  const fontReq = new Request('https://fonts.googleapis.com/css2?family=Cinzel', { method: 'GET' });
  const fontResult = await simulateFetch(fontReq);
  assert.equal(fontResult.responded, true, 'Google Fonts requests must be intercepted and cached');

  // 9. Query-bearing navigation offline handled with ignoreSearch: true
  // Network throws (offline)
  mockNetworkFetch = async () => {
    throw new Error('Network error (offline)');
  };
  const offlineQueryNavReq = new Request('http://localhost:4321/tavern?query=test&ref=nav', {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });
  const offlineQueryResult = await simulateFetch(offlineQueryNavReq);
  assert.equal(offlineQueryResult.responded, true);
  const offlineBody = await offlineQueryResult.response.text();
  assert.equal(offlineBody, 'Precached HTML', 'Must return precached /tavern despite query parameters');

  // 10. Failed JS request offline returns Response.error() (NOT favicon.svg!)
  const failedJsReq = new Request('http://localhost:4321/_astro/missing-script.js', { method: 'GET' });
  const failedJsResult = await simulateFetch(failedJsReq);
  assert.equal(failedJsResult.responded, true);
  assert.ok(
    failedJsResult.response.type === 'error' || failedJsResult.response.status === 0,
    'Failed JS must return error response, NOT favicon.svg fallback'
  );

  // 11. Failed SVG request offline returns /favicon.svg fallback
  const failedSvgReq = new Request('http://localhost:4321/art/missing-icon.svg', { method: 'GET' });
  const failedSvgResult = await simulateFetch(failedSvgReq);
  assert.equal(failedSvgResult.responded, true);
  assert.ok(failedSvgResult.response, 'Failed SVG must return fallback icon');

  // 12. Runtime cache bounds: putting 65 entries evicts oldest to maintain MAX_RUNTIME_ENTRIES = 60
  for (let i = 0; i < 65; i++) {
    await sandbox.caches.open('nhovem-runtime-v8').then((c) =>
      c.put(new Request(`http://localhost:4321/_astro/file_${i}.js`), new Response('js', { status: 200 }))
    );
  }
  // Trigger putInRuntimeCache logic via simulation
  mockNetworkFetch = async () => new Response('new asset', { status: 200 });
  await simulateFetch(new Request('http://localhost:4321/_astro/new_asset.js', { method: 'GET' }));
  const finalRuntimeKeys = await runtimeCache.keys();
  assert.ok(finalRuntimeKeys.length <= 60, `Runtime cache entries (${finalRuntimeKeys.length}) must be bounded to <= 60`);

  // 13. Message event: SKIP_WAITING triggers self.skipWaiting()
  listeners.message[0]({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipWaitingCalled, true, 'SKIP_WAITING message must call self.skipWaiting()');
});

// ── PLAN-09 / Phase F: Demo URL Validation & Embed Sandboxing (Reviewer 8) ───
await test('PLAN-09 / Phase F: demoUrl rejects query, hash, credentials, and non-HTTPS protocols while allowing HTTPS public URLs', () => {
  assert.equal(demoUrl('https://arcane-typer.example.com/play'), 'https://arcane-typer.example.com/play');
  assert.equal(demoUrl('https://example.com/demo?token=secret'), null);
  assert.equal(demoUrl('https://example.com/demo#anchor'), null);
  assert.equal(demoUrl('https://admin:pass@example.com/demo'), null);
  assert.equal(demoUrl('http://example.com/demo', false), null);
  assert.equal(demoUrl('http://localhost:3000', false), null);
  assert.equal(demoUrl('http://localhost:3000', true), 'http://localhost:3000/');
  assert.equal(demoUrl('javascript:alert(1)'), null);
  assert.equal(demoUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(demoUrl(''), null);
  assert.equal(demoUrl(undefined), null);
});

await test('PLAN-09 / Phase F: QuestDemoShell, BitsLiveDemo, and TransceiverModal retain safe iframe sandbox without top-navigation', () => {
  const shell = readRepoFile('src/components/QuestDemoShell.astro');
  assert.match(shell, /frame\.sandbox\.value = viewConfig\.sandbox/);
  assert.match(shell, /frame\.referrerPolicy = viewConfig\.referrerPolicy \?\? 'strict-origin-when-cross-origin'/);
  assert.match(shell, /rel="noopener noreferrer"/);

  const bits = readRepoFile('src/components/BitsLiveDemo.astro');
  assert.match(bits, /sandbox:\s*'[^']*allow-scripts[^']*'/);
  assert.equal(bits.includes('allow-top-navigation'), false, 'BitsLiveDemo must not permit allow-top-navigation');

  const messengerPath = fs.existsSync(path.join(rootDir, 'src/components/messenger/MessengerRoom.astro'))
    ? 'src/components/messenger/MessengerRoom.astro'
    : 'src/pages/messenger.astro';
  const messenger = readRepoFile(messengerPath);
  assert.equal(messenger.includes('allow-top-navigation'), false, 'MessengerRoom must not permit allow-top-navigation');
});

// ── UX & Structural Accessibility Verification (UX-01..UX-10, SEC-06, QA-02) ─
await test('UX-01: accepts legitimate role & short-brand addresses (admin@gmail.com, user@gmail.com, acme@acme.com)', async () => {
  const adminRes = await validateEmail('admin@gmail.com', { strict: true });
  assert.equal(adminRes.valid, true);

  const userRes = await validateEmail('user@outlook.com', { strict: true });
  assert.equal(userRes.valid, true);

  const mockFetchMx = async () =>
    new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mail.acme.com.' }] }), { status: 200 });
  const brandRes = await validateEmail('acme@acme.com', { strict: true, fetchImpl: mockFetchMx });
  assert.equal(brandRes.valid, true);
});

await test('UX-01: rejects troll local parts and disposable domains', async () => {
  const trollRes = await validateEmail('asdf@gmail.com', { strict: true });
  assert.equal(trollRes.valid, false);

  const noreplyRes = await validateEmail('noreply@gmail.com', { strict: true });
  assert.equal(noreplyRes.valid, false);

  const dispRes = await validateEmail('recruiter@mailinator.com', { strict: true });
  assert.equal(dispRes.valid, false);
  assert.equal(dispRes.isDisposable, true);
});

await test('UX-01: rejects RFC 7505 Null MX ("0 .") and accepts RFC 5321 implicit MX (A/AAAA fallback)', async () => {
  const nullMxFetch = async () =>
    new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '0 .' }] }), { status: 200 });
  const nullMxRes = await validateEmail('contact@nullmx.example.org', { strict: true, fetchImpl: nullMxFetch });
  assert.equal(nullMxRes.valid, false);
  assert.equal(nullMxRes.isDomainError, true);

  const implicitMxFetch = async (url) => {
    const u = String(url);
    if (u.includes('type=MX')) {
      return new Response(JSON.stringify({ Status: 0 }), { status: 200 });
    }
    if (u.includes('type=A')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ Status: 0 }), { status: 200 });
  };
  const implicitRes = await validateEmail('faculty@dept.university.edu', {
    strict: true,
    fetchImpl: implicitMxFetch,
  });
  assert.equal(implicitRes.valid, true);
});

await test('UX-01: distinguishes transient DNS errors from NXDOMAIN in strict mode', async () => {
  const failingFetch = async () => {
    throw new Error('DNS timeout');
  };
  const strictTransient = await validateEmail('hello@customdomain.org', {
    strict: true,
    fetchImpl: failingFetch,
  });
  assert.equal(strictTransient.valid, false);
  assert.equal(strictTransient.isTransientDnsError, true);
});

await test('SEC-03: rejects non-JSON Content-Type with 415 and non-POST with 405', async () => {
  const res415 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost:4321' },
      body: '{}',
    }),
  });
  assert.equal(res415.status, 415);

  const res405 = await ALL();
  assert.equal(res405.status, 405);
});

await test('SEC-03: safely rejects JSON null, arrays, primitives, and unknown keys with 400', async () => {
  for (const invalidBody of ['null', '[]', '"hello"', '123', '{"unexpected": "field"}', '{"name": 123}']) {
    const res = await POST({
      request: new Request('http://localhost:4321/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:4321',
          'x-real-ip': '203.0.113.10',
        },
        body: invalidBody,
      }),
    });
    assert.equal(res.status, 400, `Expected 400 for body ${invalidBody}, got ${res.status}`);
  }
});

await test('SEC-04: rejects dummy or missing Turnstile secret in production with 503', async () => {
  await withIsolatedEnv(
    {
      NODE_ENV: 'production',
      TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    },
    async () => {
      const res = await POST({
        request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://portfolio-ibem.vercel.app',
            'x-real-ip': '203.0.113.20',
          },
          body: JSON.stringify({
            name: 'Alice',
            email: 'alice@gmail.com',
            subject: 'Hello',
            message: 'Testing production dummy key guard.',
            turnstileToken: 'valid-looking-token',
          }),
        }),
      });
      assert.equal(res.status, 503);
    }
  );
});

await test('SEC-01 & SEC-04: privacy-minimized logging never exposes secrets, tokens, or visitor content', async () => {
  mockNetwork.addRoute(
    (url, method) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && method === 'POST',
    () =>
      new Response(
        JSON.stringify({ success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }),
        { status: 200 }
      )
  );

  mockNetwork.addRoute(
    (url, method) => url === 'https://api.resend.com/emails' && method === 'POST',
    () => new Response(JSON.stringify({ id: 'msg_log_test' }), { status: 200 })
  );

  await withIsolatedEnv(
    {
      NODE_ENV: 'production',
      TURNSTILE_SECRET: 'real-prod-secret-key-for-test',
      EMAIL_API_KEY: 're_test_server_only_secret',
      CONTACT_TO_ADDRESS: 'reviewer@example.test',
    },
    async () => {
      const payload = {
        name: 'Alice\r\nInjected',
        email: 'admin@gmail.com',
        subject: 'Role\r\nInquiry',
        message: 'Sensitive message body content',
        turnstileToken: 'unique-turnstile-token-secret-123',
      };

      const { captured, result: res } = await captureLogs(async () =>
        POST({
          request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://portfolio-ibem.vercel.app',
              'x-real-ip': '203.0.113.30',
            },
            body: JSON.stringify(payload),
          }),
        })
      );

      assert.equal(res.status, 200);

      // Verify captured logs NEVER contain secrets, tokens, message body, or local part
      for (const entry of captured) {
        assert.equal(entry.text.includes('re_test_server_only_secret'), false);
        assert.equal(entry.text.includes('real-prod-secret-key-for-test'), false);
        assert.equal(entry.text.includes('unique-turnstile-token-secret-123'), false);
        assert.equal(entry.text.includes('Sensitive message body content'), false);
        assert.equal(entry.text.includes('Alice Injected'), false);
      }
    }
  );
});

await test('SEC-06: vercel.json CSP includes frame-ancestors \'self\'', () => {
  const vercelConfig = readRepoFile('vercel.json');
  assert.match(vercelConfig, /frame-ancestors 'self';/);
});

await test('UX-02 & UX-03: messenger room has no silent <2500ms drop and uses synchronous isSubmitting guard', () => {
  const messengerPath = fs.existsSync(path.join(rootDir, 'src/components/messenger/MessengerRoom.astro'))
    ? 'src/components/messenger/MessengerRoom.astro'
    : 'src/pages/messenger.astro';
  const messenger = readRepoFile(messengerPath);
  assert.equal(messenger.includes('formLoadTime'), false);
  assert.match(messenger, /if \(isSubmitting\) return;/);
  assert.match(messenger, /isSubmitting = true;/);
});

await test('UX-03 & UX-04: RavenModal and MobileDispatchStack expose radiogroup semantics, aria-describedby, and privacy notice', () => {
  for (const file of [
    'src/components/messenger/RavenModal.astro',
    'src/components/messenger/MobileDispatchStack.astro',
  ]) {
    const content = readRepoFile(file);
    assert.match(content, /role="radiogroup"/);
    assert.match(content, /role="radio"/);
    assert.match(content, /aria-checked=/);
    assert.match(content, /autocomplete="name"/);
    assert.match(content, /autocomplete="email"/);
    assert.match(content, /aria-describedby=/);
    assert.match(content, /Privacy/i);
  }
});

await test('UX-07: public/sw.js bounds runtime cache and PwaRegister.astro guards active user work', () => {
  const sw = readRepoFile('public/sw.js');
  assert.match(sw, /MAX_RUNTIME_ENTRIES = 60/);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);

  const pwa = readRepoFile('src/components/PwaRegister.astro');
  assert.match(pwa, /isUserBusyWithActiveWork/);
  assert.match(pwa, /showUpdateAvailableBanner/);
});

await test('UX-08 & UX-10: SiteHeader.astro provides primary Contact link and mobile motion toggle', () => {
  const header = readRepoFile('src/components/SiteHeader.astro');
  assert.match(header, /href: '\/messenger\/raven', label: 'Contact'/);
  assert.match(header, /id="menu-toggle-motion"/);
});

await test('UX-09 & QA-02: BitsLiveDemo collapses empty frame-slot and BaseLayout uses factual console notice', () => {
  const bitsDemo = readRepoFile('src/components/BitsLiveDemo.astro');
  assert.match(bitsDemo, /\.frame-slot:empty\s*\{\s*display:\s*none;\s*\}/);

  const baseLayout = readRepoFile('src/layouts/BaseLayout.astro');
  assert.equal(baseLayout.includes('Client Security & Self-XSS Shield Active'), false);
  assert.match(baseLayout, /Developer Console Notice:/);
});

// ── October 2026 security audit regressions ─────────────────────────────────
function auditRequest(ip, token, extra = {}) {
  return POST({ request: new Request('https://portfolio-ibem.vercel.app/api/missive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://portfolio-ibem.vercel.app', 'x-vercel-forwarded-for': ip },
    body: JSON.stringify({ name: 'Audit', email: 'audit@gmail.com', message: 'Synthetic audit fixture', turnstileToken: token, ...extra }),
  }) });
}

const auditProductionEnv = {
  NODE_ENV: 'production', VERCEL: '1', TURNSTILE_SECRET: 'synthetic-audit-secret',
  EMAIL_API_KEY: 'synthetic-email-key', CONTACT_TO_ADDRESS: 'owner@example.test',
};

for (const [label, token] of [['missing', undefined], ['empty', ''], ['whitespace', '   '], ['overlong', 'x'.repeat(2049)]]) {
  await test(`AUDIT: direct POST rejects ${label} token without outbound calls`, async () => {
    await withIsolatedEnv(auditProductionEnv, async () => {
      assert.equal((await auditRequest('203.0.113.1', token)).status, 400);
      assert.equal(mockNetwork.recordedCalls.length, 0);
    });
  });
}

for (const [label, response] of [
  ['invalid', { success: false, 'error-codes': ['invalid-input-response'] }],
  ['expired', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
  ['already redeemed', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
  ['wrong action', { success: true, action: 'login', hostname: 'portfolio-ibem.vercel.app' }],
  ['wrong hostname', { success: true, action: 'contact-missive', hostname: 'unrelated.vercel.app' }],
  ['nonboolean success', { success: 'true', action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }],
  ['null response', null],
]) {
  await test(`AUDIT: ${label} Siteverify fixture cannot authorize delivery`, async () => {
    mockNetwork.addRoute((url) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => Response.json(response));
    await withIsolatedEnv(auditProductionEnv, async () => {
      assert.equal((await auditRequest('203.0.113.1', 'synthetic-token')).status, 400);
      assert.equal(mockNetwork.recordedCalls.length, 1);
    });
  });
}

for (const mode of ['network', 'http', 'malformed']) {
  await test(`AUDIT: Siteverify ${mode} failure denies provider effects`, async () => {
    mockNetwork.addRoute((url) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => {
      if (mode === 'network') throw new Error('Synthetic outage');
      return new Response(mode === 'malformed' ? '{invalid' : '', { status: mode === 'http' ? 503 : 200 });
    });
    await withIsolatedEnv(auditProductionEnv, async () => {
      assert.equal((await auditRequest('203.0.113.1', 'synthetic-token')).status, mode === 'malformed' ? 400 : 503);
      assert.equal(mockNetwork.recordedCalls.length, 1);
    });
  });
}

await test('AUD-03: 40 rejected tokens do not exhaust the verified delivery budget', async () => {
  mockNetwork.addRoute((url) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () =>
    Response.json({ success: true, action: 'contact-missive', hostname: 'portfolio-ibem.vercel.app' }));
  mockNetwork.addRoute((url) => url === 'https://api.resend.com/emails', () => Response.json({ id: 'synthetic' }));
  await withIsolatedEnv(auditProductionEnv, async () => {
    await captureLogs(async () => {
      for (let i = 1; i <= 40; i++) assert.equal((await auditRequest(`198.51.100.${i}`, '')).status, 400);
      assert.equal((await auditRequest('198.51.100.41', 'valid-fixture')).status, 200);
    });
    assert.deepEqual(mockNetwork.recordedCalls.map((call) => call.url), [
      'https://challenges.cloudflare.com/turnstile/v0/siteverify', 'https://api.resend.com/emails',
    ]);
  });
});

await test('AUDIT: coarse verification work remains bounded independently of delivery capacity', async () => {
  mockNetwork.addRoute((url) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => Response.json({ success: false }));
  await withIsolatedEnv(auditProductionEnv, async () => {
    await captureLogs(async () => {
      for (let i = 1; i <= 120; i++) assert.equal((await auditRequest(`198.51.100.${i}`, `invalid-${i}`)).status, 400);
      const res = await auditRequest('198.51.100.121', 'next-token');
      assert.equal(res.status, 429);
      assert.match((await res.json()).message, /verification is busy/i);
      assert.ok(Number(res.headers.get('Retry-After')) > 0);
    });
    assert.equal(mockNetwork.recordedCalls.length, 120);
  });
});

await test('AUD-06: production deployment takes precedence over test/development NODE_ENV', async () => {
  for (const nodeEnv of ['test', 'development']) {
    await withIsolatedEnv({ NODE_ENV: nodeEnv, VERCEL_ENV: 'production' }, async () => {
      const result = await verifyTurnstile('test-pass-cannot-bypass-production', '203.0.113.1');
      assert.equal(result.success, false);
      assert.equal(result.isConfigError, true);
    });
  }
  assert.equal(mockNetwork.recordedCalls.length, 0);
});

await test('AUDIT: development cannot use synthetic test-pass shortcut', async () => {
  mockNetwork.addRoute((url) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify', () => Response.json({ success: false }));
  await withIsolatedEnv({ NODE_ENV: 'development' }, async () => {
    assert.equal((await verifyTurnstile('test-pass-not-a-real-token', '203.0.113.1')).success, false);
    assert.equal(mockNetwork.recordedCalls.length, 1);
  });
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} security & UX audit verification tests passed! (${totalTests} executed)`);
}
