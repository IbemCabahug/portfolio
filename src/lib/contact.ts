/**
 * Client-side email dispatch utility (`src/lib/contact.ts`).
 *
 * Architecture & Trust Boundary (SEC-01):
 * 1. Sends the contact payload to `/api/missive` for server-side request validation,
 *    rate limiting, Turnstile verification, and DNS email routing checks.
 * 2. If the server performed server-to-server delivery (`data.delivered === true`),
 *    returns immediately without any browser-to-provider call.
 * 3. Otherwise, when using Web3Forms (`data.accessKey` returned), submits the
 *    server-sanitized fields (`data.sanitized`) from the visitor's browser to
 *    `https://api.web3forms.com/submit` with bounded timeouts. Gmail Web and
 *    `mailto:` links are always returned as user-controlled fallbacks.
 */

export interface MissivePayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  botcheck?: string;
  turnstileToken?: string;
}

export interface MissiveOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  preflightTimeoutMs?: number;
  providerTimeoutMs?: number;
  overallTimeoutMs?: number;
}

export interface MissiveResult {
  success: boolean;
  message?: string;
  fallbackMailto?: string;
  fallbackGmailUrl?: string;
  isValidationError?: boolean;
  field?: 'name' | 'email' | 'subject' | 'message' | 'turnstile';
}

export const RECIPIENT_EMAIL = 'cabahugnhovem@gmail.com';

function createBoundedSignal(
  timeoutMs: number,
  parentSignals: (AbortSignal | undefined)[]
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  const onAbort = (e: Event) => {
    const target = e.target as AbortSignal | null;
    controller.abort(target?.reason ?? new DOMException('Aborted', 'AbortError'));
  };

  for (const sig of parentSignals) {
    if (!sig) continue;
    if (sig.aborted) {
      clearTimeout(timer);
      controller.abort(sig.reason ?? new DOMException('Aborted', 'AbortError'));
      return { signal: controller.signal, cleanup: () => {} };
    }
    sig.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      for (const sig of parentSignals) {
        sig?.removeEventListener('abort', onAbort);
      }
    },
  };
}

export async function sendMissive(
  payload: MissivePayload,
  options: MissiveOptions = {}
): Promise<MissiveResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const preflightTimeoutMs = options.preflightTimeoutMs ?? 8_000;
  const providerTimeoutMs = options.providerTimeoutMs ?? 10_000;
  const overallTimeoutMs = options.overallTimeoutMs ?? 15_000;

  const initialName = (payload.name || '').replace(/[\r\n]+/g, ' ').trim() || 'Traveler';
  const initialEmail = (payload.email || '').replace(/[\r\n]+/g, '').trim();
  const initialSubject = (payload.subject || '').replace(/[\r\n]+/g, ' ').trim() || 'Tavern Dispatch';
  const initialMessage = (payload.message || '').trim();

  const buildFallbacks = (name: string, email: string, subject: string, body: string) => {
    const formattedBody = `Sender: ${name}\nReturn Address: ${email}\n\n--------------------------------------------------\n${body}\n--------------------------------------------------\n(Dispatched via Ibem's Tavern Messenger Roost)`;
    const fallbackMailto = `mailto:${RECIPIENT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedBody)}`;
    const fallbackGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${RECIPIENT_EMAIL}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedBody)}`;
    return { formattedBody, fallbackMailto, fallbackGmailUrl };
  };

  let { formattedBody, fallbackMailto, fallbackGmailUrl } = buildFallbacks(
    initialName,
    initialEmail,
    initialSubject,
    initialMessage
  );

  const overallBound = createBoundedSignal(overallTimeoutMs, [options.signal]);

  try {
    // 1. Server preflight validation & rate-limit gate (/api/missive)
    const preflightBound = createBoundedSignal(preflightTimeoutMs, [overallBound.signal]);
    let response: Response;
    try {
      response = await fetchFn('/api/missive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: payload.name,
          email: payload.email,
          subject: payload.subject,
          message: payload.message,
          botcheck: payload.botcheck || '',
          turnstileToken: payload.turnstileToken || '',
        }),
        signal: preflightBound.signal,
      });
    } finally {
      preflightBound.cleanup();
    }

    const data = (await response.json().catch(() => null)) as {
      success?: boolean;
      authorized?: boolean;
      delivered?: boolean;
      accessKey?: string;
      sanitized?: {
        name: string;
        email: string;
        subject: string;
        body: string;
      };
      message?: string;
      isValidationError?: boolean;
      field?: 'name' | 'email' | 'subject' | 'message' | 'turnstile';
    } | null;

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        message: 'Validation service returned an invalid response. Your draft is preserved—you can retry or send via Gmail Web.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    if (data.isValidationError) {
      return {
        success: false,
        isValidationError: true,
        field: data.field,
        message: data.message || 'Please check the highlighted field and try again.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        message: data.message || 'Too many messages sent recently. Please wait a moment or email directly.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    // Use server-sanitized values for all downstream formatting and delivery (SEC-01)
    if (data.sanitized) {
      ({ formattedBody, fallbackMailto, fallbackGmailUrl } = buildFallbacks(
        data.sanitized.name || initialName,
        data.sanitized.email || initialEmail,
        data.sanitized.subject || initialSubject,
        data.sanitized.body || initialMessage
      ));
    }

    // Server-to-server delivery path (including honeypot silent completion)
    if (response.ok && data.success && data.delivered === true) {
      return {
        success: true,
        message: data.message || 'Message submitted — your missive has been accepted for delivery.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    if (!response.ok || !data.success || !data.accessKey || !data.sanitized) {
      return {
        success: false,
        message:
          data.message ||
          'Validation or delivery service is temporarily unavailable. You can send directly via Gmail Web or your email app.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    // 2. Browser-assisted submission to Web3Forms using server-sanitized fields (SEC-01 & SEC-07)
    const providerBound = createBoundedSignal(providerTimeoutMs, [overallBound.signal]);
    let upstreamRes: Response;
    try {
      upstreamRes = await fetchFn('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          access_key: data.accessKey,
          name: data.sanitized.name,
          email: data.sanitized.email,
          subject: data.sanitized.subject,
          message: formattedBody,
          botcheck: '',
        }),
        signal: providerBound.signal,
      });
    } finally {
      providerBound.cleanup();
    }

    const upstreamData = (await upstreamRes.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
    } | null;

    if (upstreamRes.ok && upstreamData && upstreamData.success === true) {
      return {
        success: true,
        message: 'Message submitted — your missive has been accepted for delivery.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    return {
      success: false,
      message:
        upstreamData?.message ||
        'Delivery encountered an upstream delay. Your draft is preserved—you can retry or send directly via Gmail Web.',
      fallbackMailto,
      fallbackGmailUrl,
    };
  } catch (err: unknown) {
    const errorObj = err as { name?: string; message?: string } | null;
    const isTimeout =
      errorObj?.name === 'TimeoutError' ||
      errorObj?.name === 'AbortError' ||
      overallBound.signal.aborted;

    return {
      success: false,
      message: isTimeout
        ? 'The request timed out before delivery could be confirmed. Your draft is preserved—you can retry or send via Gmail Web.'
        : 'Network error encountered during transmission. Your draft is preserved—you can retry or send via Gmail Web.',
      fallbackMailto,
      fallbackGmailUrl,
    };
  } finally {
    overallBound.cleanup();
  }
}
