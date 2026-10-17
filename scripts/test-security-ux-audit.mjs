/**
 * Automated Regression & Boundary Verification Suite
 * Covers PORTFOLIO-SECURITY-UX-AUDIT-2026-10-17 findings:
 * SEC-01..SEC-08, UX-01..UX-10, QA-01, QA-02
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('=== Portfolio Security & UX Audit Verification Suite ===\n');

// 1. Dynamic import of TypeScript modules via Vite/Node strip-types (Node 24 natively supports TS strip-types)
const validatorMod = await import('../src/lib/email-validator.ts');
const missiveMod = await import('../src/pages/api/missive.ts');

const { validateEmail } = validatorMod;
const { POST, ALL, __resetRateLimitsForTests, __getIpBucketCount } = missiveMod;

// ── UX-01: Email Validator Regressions ───────────────────────────────────────
await test('UX-01: accepts legitimate role & short-brand addresses (admin@gmail.com, user@gmail.com, acme@acme.com)', async () => {
  const adminRes = await validateEmail('admin@gmail.com', { strict: true });
  assert.equal(adminRes.valid, true, `Expected admin@gmail.com to be valid, got: ${adminRes.reason}`);

  const userRes = await validateEmail('user@outlook.com', { strict: true });
  assert.equal(userRes.valid, true, `Expected user@outlook.com to be valid, got: ${userRes.reason}`);

  const mockFetchMx = async () =>
    new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mail.acme.com.' }] }), { status: 200 });
  const brandRes = await validateEmail('acme@acme.com', { strict: true, fetchImpl: mockFetchMx });
  assert.equal(brandRes.valid, true, `Expected acme@acme.com to be valid, got: ${brandRes.reason}`);
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
  assert.equal(implicitRes.valid, true, `Expected implicit MX domain to pass, got: ${implicitRes.reason}`);
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
  assert.equal(strictTransient.isDomainError, undefined);
});

// ── SEC-03: /api/missive Input Schema, Content-Type, Byte Cap, Non-Truncation ─
await test('SEC-03: rejects non-JSON Content-Type with 415 and non-POST with 405', async () => {
  __resetRateLimitsForTests();
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

await test('SEC-03: safely rejects JSON null, arrays, primitives, and unknown keys with 400 (no 500 TypeError)', async () => {
  __resetRateLimitsForTests();
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

await test('SEC-03: rejects oversized payload (>16 KB) with 413 and oversized message (>5000 chars) with 400 instead of truncating', async () => {
  __resetRateLimitsForTests();
  const hugeBody = JSON.stringify({
    name: 'Alice',
    email: 'alice@gmail.com',
    subject: 'Hi',
    message: 'x'.repeat(20_000),
  });
  const res413 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.11',
      },
      body: hugeBody,
    }),
  });
  assert.equal(res413.status, 413);

  const msg5001 = JSON.stringify({
    name: 'Alice',
    email: 'alice@gmail.com',
    subject: 'Hi',
    message: 'a'.repeat(5001),
    turnstileToken: 'tok-1',
  });
  const res400 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4321',
        'x-real-ip': '203.0.113.12',
      },
      body: msg5001,
    }),
  });
  assert.equal(res400.status, 400);
  const data400 = await res400.json();
  assert.equal(data400.isValidationError, true);
  assert.equal(data400.field, 'message');
});

// ── SEC-04: Production Turnstile Dummy Secret Rejection, Action/Hostname, Replay ─
await test('SEC-04: rejects dummy or missing Turnstile secret in production with 503', async () => {
  __resetRateLimitsForTests();
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.TURNSTILE_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';

    const res = await POST({
      request: new Request('http://localhost:4321/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:4321',
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
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = prevSecret;
  }
});

await test('SEC-01 & SEC-04: verifies Turnstile action/hostname, blocks token replay, and supports server-side delivery without exposing keys', async () => {
  __resetRateLimitsForTests();
  const origFetch = globalThis.fetch;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.TURNSTILE_SECRET;
  const prevEmailKey = process.env.EMAIL_API_KEY;
  const prevTo = process.env.CONTACT_TO_ADDRESS;

  try {
    process.env.NODE_ENV = 'production';
    process.env.TURNSTILE_SECRET = 'real-prod-secret-key-for-test';
    process.env.EMAIL_API_KEY = 're_test_server_only_secret';
    process.env.CONTACT_TO_ADDRESS = 'cabahugnhovem@gmail.com';

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('challenges.cloudflare.com/turnstile')) {
        return new Response(
          JSON.stringify({
            success: true,
            action: 'contact-missive',
            hostname: 'portfolio-ibem.vercel.app',
          }),
          { status: 200 }
        );
      }
      if (u.includes('api.resend.com/emails')) {
        return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
      }
      return origFetch(url);
    };

    const payload = {
      name: 'Alice\r\nInjected',
      email: 'admin@gmail.com',
      subject: 'Role\r\nInquiry',
      message: 'Hello Nhovem!',
      turnstileToken: 'unique-turnstile-token-1',
    };

    const res1 = await POST({
      request: new Request('http://localhost:4321/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:4321',
          'x-real-ip': '203.0.113.30',
        },
        body: JSON.stringify(payload),
      }),
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    assert.equal(body1.delivered, true);
    assert.equal('accessKey' in body1, false, 'Server delivery must never return accessKey to client');
    assert.equal(body1.sanitized.name, 'Alice Injected');
    assert.equal(body1.sanitized.subject, 'Role Inquiry');

    // Replaying the same Turnstile token from a different IP must be rejected with 400
    const resReplay = await POST({
      request: new Request('http://localhost:4321/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:4321',
          'x-real-ip': '203.0.113.31',
        },
        body: JSON.stringify(payload),
      }),
    });
    assert.equal(resReplay.status, 400);
    const bodyReplay = await resReplay.json();
    assert.match(bodyReplay.message, /already been used/i);
  } finally {
    globalThis.fetch = origFetch;
    process.env.NODE_ENV = prevNodeEnv;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = prevSecret;
    if (prevEmailKey === undefined) delete process.env.EMAIL_API_KEY;
    else process.env.EMAIL_API_KEY = prevEmailKey;
    if (prevTo === undefined) delete process.env.CONTACT_TO_ADDRESS;
    else process.env.CONTACT_TO_ADDRESS = prevTo;
  }
});

// ── SEC-05: Trusted IP Extraction on Vercel & Cross-Origin Protection ────────
await test('SEC-05: rejects untrusted Origin with 403 and ignores spoofed X-Forwarded-For on Vercel', async () => {
  __resetRateLimitsForTests();
  const res403 = await POST({
    request: new Request('http://localhost:4321/api/missive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: '{}',
    }),
  });
  assert.equal(res403.status, 403);

  const prevVercel = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    const makeReq = (spoofedXff) =>
      POST({
        request: new Request('http://localhost:4321/api/missive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:4321',
            'x-vercel-ip': '198.51.100.77',
            'x-forwarded-for': spoofedXff,
          },
          body: JSON.stringify({
            name: 'Bob',
            email: 'bob@gmail.com',
            subject: 'Test',
            message: 'Hello',
            turnstileToken: 'tok-a',
          }),
        }),
      });

    await makeReq('1.1.1.1');
    // Second immediate request with a rotated X-Forwarded-For but same x-vercel-ip must hit cooldown (429)
    const secondRes = await makeReq('2.2.2.2');
    assert.equal(secondRes.status, 429, 'Spoofed X-Forwarded-For must not bypass per-IP cooldown on Vercel');
    assert.equal(__getIpBucketCount(), 1);
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }
});

// ── SEC-06, UX-02..UX-10, QA-02: Structural & Accessibility Assertions ──────
await test('SEC-06: vercel.json CSP includes frame-ancestors \'self\'', () => {
  const vercelConfig = readRepoFile('vercel.json');
  assert.match(vercelConfig, /frame-ancestors 'self';/);
});

await test('UX-02 & UX-03: messenger.astro has no silent <2500ms drop and uses synchronous isSubmitting guard', () => {
  const messenger = readRepoFile('src/pages/messenger.astro');
  assert.equal(messenger.includes('formLoadTime'), false, 'Silent <2.5s drop must be removed');
  assert.match(messenger, /if \(isSubmitting\) return;/);
  assert.match(messenger, /isSubmitting = true;/);
  assert.match(messenger, /DUMMY_SITE_KEYS\.has\(rawSiteKey\)/);
});

await test('UX-03 & UX-04: RavenModal.astro and MobileDispatchStack.astro expose radiogroup semantics, aria-describedby, autocomplete, and privacy notice', () => {
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
  assert.match(header, /href: '\/messenger', label: 'Contact'/);
  assert.match(header, /id="menu-toggle-motion"/);
});

await test('UX-09 & QA-02: BitsLiveDemo collapses empty frame-slot and BaseLayout uses factual console notice', () => {
  const bitsDemo = readRepoFile('src/components/BitsLiveDemo.astro');
  assert.match(bitsDemo, /\.frame-slot:empty\s*\{\s*display:\s*none;\s*\}/);

  const baseLayout = readRepoFile('src/layouts/BaseLayout.astro');
  assert.equal(baseLayout.includes('Client Security & Self-XSS Shield Active'), false);
  assert.match(baseLayout, /Developer Console Notice:/);
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} security & UX audit verification tests passed!`);
}
