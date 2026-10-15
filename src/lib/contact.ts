/**
 * Client-side email dispatch utility.
 *
 * Dispatches a missive to the server-side endpoint `/api/missive`, which performs
 * the authoritative email validation (syntax, troll heuristics, disposable-domain
 * blocklist, live DNS MX) and enforces honeypot + per-IP rate limiting before
 * forwarding to Web3Forms with a server-only access key. The client never holds
 * or sends the Web3Forms key, so the validation gate cannot be bypassed by calling
 * Web3Forms directly (mailto / Gmail Web compose remain as graceful fallbacks).
 */

export interface MissivePayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  botcheck?: string;
  turnstileToken?: string;
}

export interface MissiveResult {
  success: boolean;
  message?: string;
  fallbackMailto?: string;
  fallbackGmailUrl?: string;
  isValidationError?: boolean;
}

export const RECIPIENT_EMAIL = 'cabahugnhovem@gmail.com';

export async function sendMissive(payload: MissivePayload): Promise<MissiveResult> {
  const resultName = payload.name.trim() || 'Traveler';
  const resultSubject = payload.subject.trim() || 'Tavern Dispatch';

  const formattedBody = `Sender: ${resultName}\nReturn Address: ${payload.email}\n\n--------------------------------------------------\n${payload.message}\n--------------------------------------------------\n(Dispatched via Ibem's Tavern Messenger Roost)`;

  const fallbackMailto = `mailto:${RECIPIENT_EMAIL}?subject=${encodeURIComponent(resultSubject)}&body=${encodeURIComponent(formattedBody)}`;
  const fallbackGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${RECIPIENT_EMAIL}&su=${encodeURIComponent(resultSubject)}&body=${encodeURIComponent(formattedBody)}`;

  try {
    const response = await fetch('/api/missive', {
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
    });

    const data = (await response.json().catch(() => null)) as {
      success?: boolean;
      authorized?: boolean;
      accessKey?: string;
      message?: string;
      isValidationError?: boolean;
    } | null;

    if (!data) {
      return {
        success: false,
        message: 'Validation service temporarily unavailable. You can send directly via Gmail Web.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    // The server alone decides whether the return address is authentic.
    if (data.isValidationError) {
      return {
        success: false,
        isValidationError: true,
        message: data.message || 'Please provide a valid permanent email address.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        message: data.message || 'Too many dispatches. Please wait a moment and try again.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    if (!response.ok || !data.success || !data.accessKey) {
      return {
        success: false,
        message: data.message || 'Transmission validation failed. You can send directly via Gmail Web.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    // 2. Dispatch directly to Web3Forms from the visitor's genuine browser context.
    // Client-side fetch carries browser TLS fingerprints and origin headers
    // that bypass Cloudflare Bot Management (which blocks serverless IP ranges).
    const upstreamRes = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        access_key: data.accessKey,
        name: resultName,
        email: payload.email,
        subject: resultSubject,
        message: formattedBody,
      }),
    });

    const upstreamData = (await upstreamRes.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
    } | null;

    if (upstreamRes.ok && upstreamData?.success) {
      return {
        success: true,
        message: 'Your missive has successfully reached Nhovem’s console.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }

    return {
      success: false,
      message: upstreamData?.message || 'Transmission encountered an upstream delay. You can send directly via Gmail Web.',
      fallbackMailto,
      fallbackGmailUrl,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Network error encountered during transmission.',
      fallbackMailto,
      fallbackGmailUrl,
    };
  }
}
