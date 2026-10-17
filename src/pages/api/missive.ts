/**
 * Server-side missive preflight & dispatch endpoint (`/api/missive`).
 *
 * Architecture & Trust Boundary (SEC-01):
 * - When a server-to-server transactional email credential (`EMAIL_API_KEY` +
 *   `CONTACT_TO_ADDRESS`) is configured, this endpoint is the final delivery
 *   authority: it validates, rate-limits, verifies Turnstile, and delivers the
 *   message server-to-server without releasing any provider key to the browser.
 * - When operating with Web3Forms (`WEB3FORMS_KEY` only), final submission must
 *   originate from the visitor's browser because Web3Forms places Cloudflare Bot
 *   Management in front of `api.web3forms.com/submit` and blocks serverless
 *   datacenter IPs on the free plan. In that mode, this endpoint acts as the
 *   portfolio's preflight validation, rate-limit, and Turnstile gate and returns
 *   sanitized fields (`sanitized`) plus the Web3Forms public delivery key, while
 *   Web3Forms' own spam/botcheck/domain controls govern the final provider call.
 */

import type { APIRoute } from 'astro';
import { validateEmail } from '../../lib/email-validator';

export const prerender = false;

export interface MissivePayload {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  botcheck?: string;
  turnstileToken?: string;
}

export const MAX_REQUEST_BYTES = 16_384; // 16 KB hard cap before JSON parsing
export const MAX_NAME = 120;
export const MAX_EMAIL = 254;
export const MAX_SUBJECT = 200;
export const MAX_BODY = 5_000;
export const MAX_TOKEN = 2_048;

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'name',
  'email',
  'subject',
  'message',
  'botcheck',
  'turnstileToken',
]);

// Cloudflare documented dummy testing secrets (must NEVER be used in production)
const DUMMY_TURNSTILE_SECRETS: ReadonlySet<string> = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

// ── Server-side rate limiting (in-memory per instance, bounded) ─────────────
const RATE_WINDOW_MS = 3_600_000; // 1 hour
const MAX_ATTEMPTS_PER_HOUR = 6;
const COOLDOWN_MS = 30_000; // 30s between dispatch attempts
const GLOBAL_MAX_PER_HOUR = 40; // hard cap on dispatches/hour per instance
const MAX_IP_BUCKETS = 5_000; // strict upper bound on tracked IP keys
const MAX_REPLAY_TOKENS = 2_000;
const TOKEN_REPLAY_TTL_MS = 600_000; // 10 minutes

const ipBuckets = new Map<string, number[]>();
let globalTimestamps: number[] = [];
const usedTurnstileTokens = new Map<string, number>();

export function __resetRateLimitsForTests(): void {
  ipBuckets.clear();
  globalTimestamps = [];
  usedTurnstileTokens.clear();
}

export function __getIpBucketCount(): number {
  return ipBuckets.size;
}

function isProductionEnv(): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
    return false;
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    return true;
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (import.meta.env.DEV) return false;
      if (import.meta.env.PROD) return true;
    }
  } catch {}
  return false;
}

/**
 * Resolves the client IP using only platform-authenticated headers on Vercel,
 * avoiding caller-spoofable forwarding headers in deployed environments (SEC-05).
 */
export function getClientIp(request: Request): string {
  const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  let candidate = '';

  if (isVercel) {
    candidate =
      request.headers.get('x-vercel-ip') ||
      request.headers.get('x-real-ip') ||
      'unknown';
  } else {
    candidate =
      request.headers.get('x-vercel-ip') ||
      request.headers.get('x-real-ip') ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0] ||
      '127.0.0.1';
  }

  const trimmed = candidate.trim().slice(0, 64);
  if (!trimmed || !/^[a-fA-F0-9:.]+$/.test(trimmed)) {
    return 'unknown';
  }
  return trimmed;
}

function redactIpForLog(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::`;
  }
  return 'redacted';
}

function pruneBucket(ip: string): number[] {
  const now = Date.now();
  const existing = (ipBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);

  // Refresh insertion order or evict expired entries
  if (ipBuckets.has(ip)) {
    ipBuckets.delete(ip);
  }

  if (ipBuckets.size >= MAX_IP_BUCKETS) {
    for (const [key, bucket] of ipBuckets) {
      const alive = bucket.filter((t) => now - t < RATE_WINDOW_MS);
      if (alive.length === 0) ipBuckets.delete(key);
      else ipBuckets.set(key, alive);
    }
    // Hard cap: if all buckets are still active, evict the oldest key (FIFO)
    while (ipBuckets.size >= MAX_IP_BUCKETS) {
      const oldestKey = ipBuckets.keys().next().value;
      if (oldestKey === undefined) break;
      ipBuckets.delete(oldestKey);
    }
  }

  if (existing.length > 0) {
    ipBuckets.set(ip, existing);
  }
  return existing;
}

function checkRateLimit(
  ip: string
): { allowed: true } | { allowed: false; reason: string; retryAfterSeconds: number } {
  const stamps = pruneBucket(ip);

  if (stamps.length >= MAX_ATTEMPTS_PER_HOUR) {
    const oldest = stamps[0] || Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - Date.now()) / 1000));
    return {
      allowed: false,
      reason: 'You have reached the hourly message limit. Please try again later or email directly.',
      retryAfterSeconds,
    };
  }

  const last = stamps[stamps.length - 1];
  if (last && Date.now() - last < COOLDOWN_MS) {
    const wait = Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000));
    return {
      allowed: false,
      reason: `Please wait ${wait}s before sending another message.`,
      retryAfterSeconds: wait,
    };
  }

  return { allowed: true };
}

function recordAttempt(ip: string): void {
  const stamps = pruneBucket(ip);
  stamps.push(Date.now());
  ipBuckets.set(ip, stamps);
}

function checkGlobalLimit(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  globalTimestamps = globalTimestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (globalTimestamps.length >= GLOBAL_MAX_PER_HOUR) {
    const oldest = globalTimestamps[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function recordGlobalAttempt(): void {
  globalTimestamps.push(Date.now());
}

function rateLimitHeaders(limit: number, remaining: number, resetEpochSeconds: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetEpochSeconds),
  };
}

type LogCategory = 'abuse' | 'validation' | 'service_error' | 'authorized';

// Privacy-minimized structured log line (SEC-08):
// Logs redacted IP subnet and email domain only — never local-part characters, tokens, or message bodies.
function logMissive(
  ip: string,
  category: LogCategory,
  outcome: string,
  email = '',
  detail = ''
): void {
  const at = email.lastIndexOf('@');
  const emailDomain = at > 0 ? email.slice(at + 1).toLowerCase().slice(0, 128) : '';
  console.log(
    JSON.stringify({
      event: 'missive',
      category,
      outcome,
      ipSubnet: redactIpForLog(ip),
      emailDomain,
      detail: detail.slice(0, 160),
    })
  );
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

function createTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function isTokenReplayed(token: string): boolean {
  const now = Date.now();
  if (usedTurnstileTokens.size >= MAX_REPLAY_TOKENS) {
    for (const [key, timestamp] of usedTurnstileTokens) {
      if (now - timestamp > TOKEN_REPLAY_TTL_MS) {
        usedTurnstileTokens.delete(key);
      }
    }
    while (usedTurnstileTokens.size >= MAX_REPLAY_TOKENS) {
      const oldest = usedTurnstileTokens.keys().next().value;
      if (oldest === undefined) break;
      usedTurnstileTokens.delete(oldest);
    }
  }
  const seenAt = usedTurnstileTokens.get(token);
  if (seenAt && now - seenAt <= TOKEN_REPLAY_TTL_MS) {
    return true;
  }
  return false;
}

function markTokenUsed(token: string): void {
  usedTurnstileTokens.set(token, Date.now());
}

function getExpectedHostnames(): Set<string> {
  const hosts = new Set<string>(['portfolio-ibem.vercel.app']);
  const siteUrl = process.env.PUBLIC_SITE_URL || '';
  if (siteUrl) {
    try {
      const parsed = new URL(siteUrl);
      if (parsed.hostname) hosts.add(parsed.hostname.toLowerCase());
    } catch {}
  }
  if (!isProductionEnv()) {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
    hosts.add('example.com');
  }
  return hosts;
}

export async function verifyTurnstile(
  token: string,
  ip: string,
  fetchFn: typeof fetch = fetch
): Promise<{ success: boolean; error?: string; isConfigError?: boolean; isServiceError?: boolean }> {
  const isProd = isProductionEnv();
  const configuredSecret = (process.env.TURNSTILE_SECRET || '').trim();

  // SEC-04: Production must NEVER fall back to dummy keys or accept missing configuration
  if (isProd) {
    if (!configuredSecret || DUMMY_TURNSTILE_SECRETS.has(configuredSecret)) {
      return {
        success: false,
        isConfigError: true,
        error: 'Security challenge is not configured on this deployment. Please use Gmail Web or your email client.',
      };
    }
  }

  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return {
      success: false,
      error: 'Anti-bot verification token is required. Please complete the security challenge.',
    };
  }

  if (trimmedToken.length > MAX_TOKEN) {
    return {
      success: false,
      error: 'Invalid security challenge token.',
    };
  }

  if (isTokenReplayed(trimmedToken)) {
    return {
      success: false,
      error: 'This security challenge token has already been used. Please complete a fresh challenge.',
    };
  }

  // Explicit non-production test shortcut when no real secret is provided
  if (!isProd && (!configuredSecret || DUMMY_TURNSTILE_SECRETS.has(configuredSecret))) {
    if (trimmedToken === 'TEST_INVALID_TOKEN') {
      return {
        success: false,
        error: 'Cloudflare security challenge verification failed. Please try again.',
      };
    }
    if (trimmedToken === 'XXXX.DUMMY.TOKEN.XXXX' || trimmedToken.startsWith('test-pass-')) {
      markTokenUsed(trimmedToken);
      return { success: true };
    }
  }

  const secretToUse = configuredSecret || '1x0000000000000000000000000000000AA';

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretToUse);
    formData.append('response', trimmedToken);
    if (ip && ip !== 'unknown') {
      formData.append('remoteip', ip);
    }

    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      signal: createTimeoutSignal(5_000),
    });

    if (!res.ok) {
      return {
        success: false,
        isServiceError: true,
        error: 'Security verification service returned an unexpected status. Please try again or use your email client.',
      };
    }

    const outcome = (await res.json().catch(() => null)) as {
      success?: boolean;
      hostname?: string;
      action?: string;
      'error-codes'?: string[];
    } | null;

    if (!outcome || outcome.success !== true) {
      return {
        success: false,
        error: 'Cloudflare security challenge verification failed. Please try again.',
      };
    }

    if (outcome.action && outcome.action !== 'contact-missive') {
      return {
        success: false,
        error: 'Security challenge action mismatch. Please reload and try again.',
      };
    }

    if (outcome.hostname) {
      const normalizedHost = outcome.hostname.toLowerCase();
      const expectedHosts = getExpectedHostnames();
      if (!expectedHosts.has(normalizedHost) && !(isProd && normalizedHost.endsWith('.vercel.app'))) {
        return {
          success: false,
          error: 'Security challenge hostname mismatch.',
        };
      }
    }

    markTokenUsed(trimmedToken);
    return { success: true };
  } catch {
    return {
      success: false,
      isServiceError: true,
      error: 'Security verification service timed out or is temporarily unreachable. Please try again or use your email client.',
    };
  }
}

/**
 * Reads request body with a strict byte cap before JSON parsing (SEC-03).
 */
async function readBoundedJsonBody(
  request: Request
): Promise<
  | { ok: true; payload: MissivePayload }
  | { ok: false; status: number; message: string; isValidationError?: boolean }
> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return {
      ok: false,
      status: 415,
      message: 'Unsupported media type. Expected application/json.',
    };
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) {
      return { ok: false, status: 400, message: 'Invalid Content-Length header.' };
    }
    if (declaredLength > MAX_REQUEST_BYTES) {
      return {
        ok: false,
        status: 413,
        isValidationError: true,
        message: 'Request payload is too large (maximum 16 KB).',
      };
    }
  }

  let rawBytes: Uint8Array;
  try {
    if (request.body && typeof request.body.getReader === 'function') {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_REQUEST_BYTES) {
            await reader.cancel().catch(() => {});
            return {
              ok: false,
              status: 413,
              isValidationError: true,
              message: 'Request payload is too large (maximum 16 KB).',
            };
          }
          chunks.push(value);
        }
      }

      rawBytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        rawBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > MAX_REQUEST_BYTES) {
        return {
          ok: false,
          status: 413,
          isValidationError: true,
          message: 'Request payload is too large (maximum 16 KB).',
        };
      }
      rawBytes = new Uint8Array(buffer);
    }
  } catch {
    return { ok: false, status: 400, message: 'Malformed request body stream.' };
  }

  if (rawBytes.byteLength === 0) {
    return { ok: false, status: 400, message: 'Empty request body.' };
  }

  let rawText: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    rawText = decoder.decode(rawBytes);
  } catch {
    return { ok: false, status: 400, message: 'Request body must be valid UTF-8.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, status: 400, message: 'Malformed JSON payload.' };
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return {
      ok: false,
      status: 400,
      isValidationError: true,
      message: 'Payload must be a JSON object.',
    };
  }

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > ALLOWED_KEYS.size) {
    return {
      ok: false,
      status: 400,
      isValidationError: true,
      message: 'Payload contains unexpected fields.',
    };
  }

  for (const key of keys) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        status: 400,
        isValidationError: true,
        message: `Unexpected field "${key}" in payload.`,
      };
    }
    const val = record[key];
    if (val !== undefined && typeof val !== 'string') {
      return {
        ok: false,
        status: 400,
        isValidationError: true,
        message: `Field "${key}" must be a string.`,
      };
    }
  }

  return { ok: true, payload: record as MissivePayload };
}

export const POST: APIRoute = async ({ request }) => {
  // 1a. Validate Origin / Cross-Site requests early.
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') {
    return json({ success: false, message: 'Cross-origin missive dispatches are rejected.' }, 403);
  }
  const origin = request.headers.get('origin');
  if (origin) {
    const siteUrl = process.env.PUBLIC_SITE_URL || '';
    const allowed = new Set([
      siteUrl.replace(/\/$/, ''),
      'https://portfolio-ibem.vercel.app',
      'http://localhost:4321',
      'http://127.0.0.1:4321',
      'http://localhost:3000',
    ]);
    const norm = origin.replace(/\/$/, '');
    if (!allowed.has(norm) && !norm.startsWith('http://localhost:')) {
      return json({ success: false, message: 'Cross-origin missive dispatches are rejected.' }, 403);
    }
  }

  // 1b. Enforce Content-Type, byte limits, and strict JSON object schema (SEC-03).
  const bodyCheck = await readBoundedJsonBody(request);
  if (!bodyCheck.ok) {
    return json(
      {
        success: false,
        isValidationError: bodyCheck.isValidationError === true,
        message: bodyCheck.message,
      },
      bodyCheck.status
    );
  }
  const payload = bodyCheck.payload;

  const ip = getClientIp(request);

  // 2. Honeypot: bots that filled the hidden checkbox get a silent fake success.
  if (payload.botcheck && payload.botcheck.trim().length > 0) {
    logMissive(ip, 'abuse', 'honeypot_triggered');
    return json({ success: true, delivered: true, message: 'Message submitted.' });
  }

  // 3. Per-IP rate limiting.
  const stamps = pruneBucket(ip);
  const resetEpochSeconds = Math.floor(
    (stamps[0] ? stamps[0] + RATE_WINDOW_MS : Date.now() + RATE_WINDOW_MS) / 1000
  );
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    logMissive(ip, 'abuse', 'rate_limited_ip', payload.email || '');
    return json({ success: false, message: limit.reason }, 429, {
      'Retry-After': String(limit.retryAfterSeconds),
      ...rateLimitHeaders(
        MAX_ATTEMPTS_PER_HOUR,
        Math.max(0, MAX_ATTEMPTS_PER_HOUR - stamps.length),
        resetEpochSeconds
      ),
    });
  }
  recordAttempt(ip);

  const rlHeaders = rateLimitHeaders(
    MAX_ATTEMPTS_PER_HOUR,
    Math.max(0, MAX_ATTEMPTS_PER_HOUR - (stamps.length + 1)),
    resetEpochSeconds
  );

  // 3b. Global burst cap per instance.
  const global = checkGlobalLimit();
  if (!global.allowed) {
    logMissive(ip, 'abuse', 'rate_limited_global', payload.email || '');
    return json(
      {
        success: false,
        message: 'The contact service is busy right now. Please try again later or email directly.',
      },
      429,
      { 'Retry-After': String(global.retryAfterSeconds), ...rlHeaders }
    );
  }
  recordGlobalAttempt();

  // 4. Normalize and validate field boundaries BEFORE external network calls (SEC-03).
  // Strip CRLF sequences (\r, \n) from header-like fields (CWE-93) and reject oversized
  // inputs rather than silently truncating a visitor's message.
  const rawName = (payload.name ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const rawEmail = (payload.email ?? '').replace(/[\r\n]+/g, '').trim();
  const rawSubject = (payload.subject ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const rawBody = (payload.message ?? '').trim();

  if (rawName.length > MAX_NAME) {
    return json(
      {
        success: false,
        isValidationError: true,
        field: 'name',
        message: `Your name cannot exceed ${MAX_NAME} characters.`,
      },
      400,
      rlHeaders
    );
  }

  if (rawEmail.length > MAX_EMAIL) {
    return json(
      {
        success: false,
        isValidationError: true,
        field: 'email',
        message: `Email address cannot exceed ${MAX_EMAIL} characters.`,
      },
      400,
      rlHeaders
    );
  }

  if (rawSubject.length > MAX_SUBJECT) {
    return json(
      {
        success: false,
        isValidationError: true,
        field: 'subject',
        message: `Subject cannot exceed ${MAX_SUBJECT} characters.`,
      },
      400,
      rlHeaders
    );
  }

  if (!rawBody) {
    return json(
      {
        success: false,
        isValidationError: true,
        field: 'message',
        message: 'Please write a message before sending.',
      },
      400,
      rlHeaders
    );
  }

  if (rawBody.length > MAX_BODY) {
    return json(
      {
        success: false,
        isValidationError: true,
        field: 'message',
        message: `Message cannot exceed ${MAX_BODY} characters (currently ${rawBody.length}).`,
      },
      400,
      rlHeaders
    );
  }

  const name = rawName || 'Traveler';
  const email = rawEmail;
  const subject = rawSubject || 'Tavern Dispatch';
  const body = rawBody;

  // 5. Cloudflare Turnstile challenge verification (SEC-04).
  const turnstileCheck = await verifyTurnstile(payload.turnstileToken || '', ip);
  if (!turnstileCheck.success) {
    const category: LogCategory =
      turnstileCheck.isConfigError || turnstileCheck.isServiceError ? 'service_error' : 'abuse';
    logMissive(ip, category, 'rejected_turnstile', email, turnstileCheck.error || '');
    const status = turnstileCheck.isConfigError || turnstileCheck.isServiceError ? 503 : 400;
    return json(
      {
        success: false,
        isValidationError: !turnstileCheck.isConfigError && !turnstileCheck.isServiceError,
        field: 'turnstile',
        message:
          turnstileCheck.error ||
          'Anti-bot verification failed. Please complete the security challenge.',
      },
      status,
      rlHeaders
    );
  }

  // 6. Email syntax, disposable-domain, and DNS mail server verification (UX-01).
  const validation = await validateEmail(email, { strict: true });
  if (!validation.valid) {
    const isTransient = validation.isTransientDnsError === true;
    logMissive(
      ip,
      isTransient ? 'service_error' : 'validation',
      isTransient ? 'dns_unavailable' : 'rejected_validation',
      email,
      validation.reason || ''
    );
    return json(
      {
        success: false,
        isValidationError: !isTransient,
        field: 'email',
        message:
          validation.reason ||
          'Please provide a valid, reachable email address.',
      },
      isTransient ? 503 : 400,
      rlHeaders
    );
  }

  // 7. Server-to-server delivery when EMAIL_API_KEY + CONTACT_TO_ADDRESS are configured (SEC-01 Option 1).
  const emailApiKey = (process.env.EMAIL_API_KEY || '').trim();
  const contactTo = (process.env.CONTACT_TO_ADDRESS || '').trim();
  if (emailApiKey && contactTo) {
    try {
      const formattedBody = `Sender: ${name}\nReturn Address: ${email}\n\n--------------------------------------------------\n${body}\n--------------------------------------------------\n(Dispatched via Ibem's Tavern Messenger Roost)`;
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${emailApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Portfolio Contact <onboarding@resend.dev>',
          to: [contactTo],
          reply_to: email,
          subject,
          text: formattedBody,
        }),
        signal: createTimeoutSignal(8_000),
      });

      if (resendRes.ok) {
        logMissive(ip, 'authorized', 'delivered_server', email);
        return json(
          {
            success: true,
            delivered: true,
            sanitized: { name, email, subject, body },
            message: 'Message submitted — your missive has been accepted for delivery.',
          },
          200,
          rlHeaders
        );
      }
      logMissive(ip, 'service_error', 'server_delivery_failed', email, `HTTP ${resendRes.status}`);
      return json(
        {
          success: false,
          message: 'Email delivery service encountered an upstream error. Please use Gmail Web or your email client.',
        },
        502,
        rlHeaders
      );
    } catch {
      logMissive(ip, 'service_error', 'server_delivery_timeout', email);
      return json(
        {
          success: false,
          message: 'Email delivery service timed out. Please use Gmail Web or your email client.',
        },
        504,
        rlHeaders
      );
    }
  }

  // 8. Browser-assisted Web3Forms delivery clearance (SEC-01 Option 2).
  // Web3Forms free tier blocks serverless datacenter IPs via Cloudflare Bot Management
  // and uses a public delivery key in the browser. We return the sanitized payload
  // so `src/lib/contact.ts` submits the server-normalized values.
  const accessKey = (process.env.WEB3FORMS_KEY || '').trim();
  if (!accessKey) {
    logMissive(ip, 'service_error', 'missing_provider_key', email);
    return json(
      {
        success: false,
        message: 'Email service key not yet configured. Please use Gmail Web or your email client.',
      },
      503,
      rlHeaders
    );
  }

  logMissive(ip, 'authorized', 'validation_cleared', email);
  return json(
    {
      success: true,
      authorized: true,
      delivered: false,
      accessKey,
      sanitized: { name, email, subject, body },
      message: 'Validation cleared. Ready for provider submission.',
    },
    200,
    rlHeaders
  );
};

export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ success: false, message: 'Method not allowed.' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Allow: 'POST',
      'Cache-Control': 'no-store',
    },
  });
};