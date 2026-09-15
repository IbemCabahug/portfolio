/**
 * Server-side missive dispatch endpoint — the authoritative gate for the
 * Messenger Roost's Raven forms.
 *
 * The visitor's browser may pre-validate (UX only), but NO message ever reaches
 * Web3Forms without passing this endpoint. It enforces:
 *
 *   1. Honeypot (silent fake success for bots)
 *   2. Per-IP rate limiting (cooldown + hourly cap)
 *   3. Payload size caps
 *   4. Strict email validation — syntax, troll/placeholder usernames,
 *      disposable-domain blocklist, and LIVE DNS MX check. DNS failures
 *      reject (fail-closed), so the previous production bypass is closed.
 *   5. Web3Forms forwarding using the server-only `WEB3FORMS_KEY` — the access
 *      key is NEVER shipped in the client bundle anymore.
 */

import type { APIRoute } from 'astro';
import { validateEmail } from '../../lib/email-validator';

export const prerender = false;

interface MissivePayload {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  botcheck?: string;
}

// ── Server-side rate limiting (in-memory, best-effort on serverless) ────────
// NOTE: serverless platforms can run several instances concurrently, so these
// Maps/arrays are PER-INSTANCE. They act as a best-effort application-layer
// gate; distributed enforcement comes from the platform edge (a Vercel WAF rate
// limiting rule on `/api/missive` is free on Hobby) and from the provider side
// (Web3Forms dashboard: honeypot + spam tools + locking the access key to this
// domain). If a strict cross-instance guarantee is ever needed, these helpers
// can be swapped for Vercel KV + `@upstash/ratelimit` without touching the flow.
const RATE_WINDOW_MS = 3_600_000; // 1 hour
const MAX_ATTEMPTS_PER_HOUR = 6;
const COOLDOWN_MS = 30_000; // 30s between dispatch attempts
const GLOBAL_MAX_PER_HOUR = 40; // hard cap on dispatches/hour regardless of IP count
const ipBuckets = new Map<string, number[]>();
let globalTimestamps: number[] = [];

function getClientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  const forwarded = fwd ? fwd.split(',')[0].trim() : '';
  const ip = forwarded || request.headers.get('true-client-ip') || 'unknown';
  return ip.slice(0, 64);
}

function pruneBucket(ip: string): number[] {
  const now = Date.now();
  const stamps = (ipBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  ipBuckets.set(ip, stamps);

  // Keep the map bounded on long-lived instances.
  if (ipBuckets.size > 10_000) {
    for (const [key, bucket] of ipBuckets) {
      const alive = bucket.filter((t) => now - t < RATE_WINDOW_MS);
      if (alive.length === 0) ipBuckets.delete(key);
      else ipBuckets.set(key, alive);
    }
  }
  return stamps;
}

function checkRateLimit(
  ip: string
): { allowed: true } | { allowed: false; reason: string; retryAfterSeconds: number } {
  const stamps = pruneBucket(ip);

  if (stamps.length >= MAX_ATTEMPTS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'You have reached the hourly dispatch limit. Please try again later.',
      retryAfterSeconds: 3600,
    };
  }

  const last = stamps[stamps.length - 1];
  if (last && Date.now() - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    return {
      allowed: false,
      reason: `Please wait ${wait}s before dispatching another raven.`,
      retryAfterSeconds: wait,
    };
  }

  return { allowed: true };
}

function recordAttempt(ip: string): void {
  pruneBucket(ip).push(Date.now());
}

// Hard cap on total dispatch attempts per rolling hour (all IPs combined).
// A distributed botnet rotating residential IPs defeats per-IP limits; this
// bounds the damage to the mail provider quota instead of allowing a flood.
function checkGlobalLimit(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  globalTimestamps = globalTimestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (globalTimestamps.length >= GLOBAL_MAX_PER_HOUR) {
    const oldest = globalTimestamps[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((now - oldest + 1) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function recordGlobalAttempt(): void {
  globalTimestamps.push(Date.now());
}

// Standard quota headers: let clients and monitoring tooling see the exact
// per-IP limit, remaining budget, and when the window resets.
function rateLimitHeaders(limit: number, remaining: number, resetEpochSeconds: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetEpochSeconds),
  };
}

// Structured, privacy-friendly log line for abuse monitoring. The sender's
// email is masked (never logged in full) per OWASP Logging guidance.
function logMissive(ip: string, outcome: string, email = '', detail = ''): void {
  const at = email.lastIndexOf('@');
  let masked = '';
  if (at > 0) {
    const local = email.slice(0, at);
    const maskedLocal = local.length <= 2 ? '***' : `${local.slice(0, 2)}***`;
    masked = `${maskedLocal}@${email.slice(at + 1)}`;
  }
  console.log(JSON.stringify({ event: 'missive', ip, outcome, email: masked, detail }));
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

const MAX_NAME = 120;
const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

export const POST: APIRoute = async ({ request }) => {
  // 1. Parse JSON payload defensively.
  let payload: MissivePayload;
  try {
    payload = (await request.json()) as MissivePayload;
  } catch {
    return json({ success: false, message: 'Malformed missive transmission.' }, 400);
  }

  const ip = getClientIp(request);

  // 2. Honeypot: bots that filled the hidden checkbox get a fake success and
  //    nothing is ever forwarded to Web3Forms.
  if (payload.botcheck) {
    return json({ success: true, message: 'Message sent successfully.' });
  }

  // 3. Per-IP rate limiting (honeypot-passing attempts count too, so a troll
  //    cannot probe endlessly with different burner addresses).
  const stamps = pruneBucket(ip);
  const resetEpochSeconds = Math.floor((stamps[0] ? stamps[0] + RATE_WINDOW_MS : Date.now() + RATE_WINDOW_MS) / 1000);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return json({ success: false, message: limit.reason }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
      ...rateLimitHeaders(MAX_ATTEMPTS_PER_HOUR, Math.max(0, MAX_ATTEMPTS_PER_HOUR - stamps.length), resetEpochSeconds),
    });
  }
  recordAttempt(ip);

  // Headers for downstream responses reflect the attempt just counted.
  const rlHeaders = rateLimitHeaders(
    MAX_ATTEMPTS_PER_HOUR,
    Math.max(0, MAX_ATTEMPTS_PER_HOUR - (stamps.length + 1)),
    resetEpochSeconds
  );

  // 3b. Global burst cap — protects the email-provider quota when an attacker
  //     rotates many source IPs to dodge the per-IP limiter above.
  const global = checkGlobalLimit();
  if (!global.allowed) {
    return json(
      { success: false, message: 'The messenger roost is overwhelmed right now. Please try again later.' },
      429,
      { 'Retry-After': String(global.retryAfterSeconds) }
    );
  }
  recordGlobalAttempt();

  // 4. Normalize + cap payload fields.
  const name = String(payload.name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  const email = String(payload.email ?? '').trim().slice(0, 254);
  const subject = String(payload.subject ?? '').trim().slice(0, MAX_SUBJECT);
  const body = String(payload.message ?? '').trim().slice(0, MAX_BODY);

  if (!body) {
    return json({ success: false, message: 'Please write a message before dispatching.' }, 200);
  }

  // 5. AUTHORITATIVE email validation (strict DNS → fail closed).
  const validation = await validateEmail(email, { strict: true });
  if (!validation.valid) {
    logMissive(ip, 'rejected_validation', email, validation.reason || '');
    return json(
      {
        success: false,
        isValidationError: true,
        message: validation.reason || 'Please provide a valid, permanent email address.',
      },
      200,
      rlHeaders
    );
  }

  // 6. Forward to Web3Forms using the SERVER-ONLY secret key.
  const accessKey = process.env.WEB3FORMS_KEY || '';
  if (!accessKey) {
    return json(
      {
        success: false,
        message: 'Email service key not yet configured. Please use Gmail Web or your email client.',
      },
      200,
      rlHeaders
    );
  }

  const formattedBody = `Sender: ${name}\nReturn Address: ${email}\n\n--------------------------------------------------\n${body}\n--------------------------------------------------\n(Dispatched via Ibem's Tavern Messenger Roost)`;

  try {
    const upstream = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        access_key: accessKey,
        name,
        email,
        subject: subject || 'Tavern Dispatch',
        message: formattedBody,
      }),
    });

    const data = (await upstream.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
    } | null;

    if (upstream.ok && data?.success) {
      logMissive(ip, 'sent', email);
      return json(
        { success: true, message: 'Your missive has successfully reached Nhovem’s console.' },
        200,
        rlHeaders
      );
    }
    logMissive(ip, 'send_failed', email, data?.message || '');
    return json(
      {
        success: false,
        message: data?.message || 'Transmission failed. You can send directly via Gmail Web.',
      },
      200,
      rlHeaders
    );
  } catch {
    return json({ success: false, message: 'Network error encountered during transmission.' });
  }
};