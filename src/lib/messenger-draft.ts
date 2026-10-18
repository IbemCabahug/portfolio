/**
 * Short-lived module-memory helper for missive draft preservation across
 * client-side route transitions (e.g. between /messenger/raven and /messenger).
 *
 * Privacy & Security Guarantee:
 * - Persisted ONLY in ephemeral JS heap memory during the active session.
 * - NEVER stored in localStorage, sessionStorage, history.state, URLs, or cookies.
 * - NEVER logs or persists CAPTCHA tokens or provider credentials.
 * - Cleared automatically upon confirmed delivery or explicit user reset.
 */

export interface MissiveDraft {
  name: string;
  email: string;
  subject: string;
  body: string;
}

let activeDraft: MissiveDraft | null = null;

export function saveMissiveDraft(draft: MissiveDraft): void {
  // Only store if there is actual user-entered content
  if (
    draft.name.trim() ||
    draft.email.trim() ||
    draft.subject.trim() ||
    draft.body.trim()
  ) {
    activeDraft = {
      name: draft.name,
      email: draft.email,
      subject: draft.subject,
      body: draft.body,
    };
  }
}

export function getMissiveDraft(): MissiveDraft | null {
  return activeDraft;
}

export function clearMissiveDraft(): void {
  activeDraft = null;
}
