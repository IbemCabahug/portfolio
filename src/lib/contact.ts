/**
 * Client-side email dispatch utility.
 * Sends automated transactional dispatches directly to cabahugnhovem@gmail.com
 * via Web3Forms API, with graceful fallbacks.
 */

export interface MissivePayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  botcheck?: string;
}

export interface MissiveResult {
  success: boolean;
  message?: string;
  fallbackMailto?: string;
  fallbackGmailUrl?: string;
}

export const RECIPIENT_EMAIL = 'cabahugnhovem@gmail.com';

export async function sendMissive(payload: MissivePayload): Promise<MissiveResult> {
  const formattedBody = `Sender: ${payload.name}\nReturn Address: ${payload.email}\n\n--------------------------------------------------\n${payload.message}\n--------------------------------------------------\n(Dispatched via Ibem's Tavern Messenger Roost)`;
  
  const fallbackMailto = `mailto:${RECIPIENT_EMAIL}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(formattedBody)}`;
  const fallbackGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${RECIPIENT_EMAIL}&su=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(formattedBody)}`;

  // If spam bot caught by honeypot
  if (payload.botcheck) {
    return { success: true, message: 'Message sent successfully.' };
  }

  // Check for configured access key or use direct dispatch
  const accessKey = import.meta.env.PUBLIC_WEB3FORMS_KEY || '';

  // Client-side rate limiting (60s cooldown to prevent API exhaustion)
  const RATE_LIMIT_KEY = 'wayfarer_last_missive_ts';
  const COOLDOWN_SECONDS = 60;

  if (typeof window !== 'undefined' && window.localStorage) {
    const lastSent = Number(localStorage.getItem(RATE_LIMIT_KEY) || 0);
    const elapsedSeconds = Math.floor((Date.now() - lastSent) / 1000);
    if (elapsedSeconds < COOLDOWN_SECONDS) {
      const waitTime = COOLDOWN_SECONDS - elapsedSeconds;
      return {
        success: false,
        message: `The messenger raven is resting. Please wait ${waitTime}s before sending another missive.`,
        fallbackMailto,
        fallbackGmailUrl,
      };
    }
  }

  if (!accessKey) {
    // If no API key configured yet, return fallback instructions
    return {
      success: false,
      message: 'Email service key not yet configured. Please use Gmail Web or your email client.',
      fallbackMailto,
      fallbackGmailUrl,
    };
  }

  try {
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        access_key: accessKey,
        name: payload.name,
        email: payload.email,
        subject: payload.subject,
        message: formattedBody,
      }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          localStorage.setItem(RATE_LIMIT_KEY, String(Date.now()));
        } catch {}
      }
      return {
        success: true,
        message: 'Your missive has successfully reached Nhovem’s console.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    } else {
      return {
        success: false,
        message: data.message || 'Transmission failed. You can send directly via Gmail Web.',
        fallbackMailto,
        fallbackGmailUrl,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Network error encountered during transmission.',
      fallbackMailto,
      fallbackGmailUrl,
    };
  }
}
