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
  // If the user cleared all fields, clear the stored draft so the empty form state is preserved
  const hasContent = Boolean(
    (draft.name && draft.name.trim()) ||
    (draft.email && draft.email.trim()) ||
    (draft.subject && draft.subject.trim()) ||
    (draft.body && draft.body.trim())
  );

  if (hasContent) {
    activeDraft = {
      name: draft.name,
      email: draft.email,
      subject: draft.subject,
      body: draft.body,
    };
  } else {
    activeDraft = null;
  }
}

export function getMissiveDraft(): MissiveDraft | null {
  return activeDraft ? { ...activeDraft } : null;
}

export function clearMissiveDraft(): void {
  activeDraft = null;
}
