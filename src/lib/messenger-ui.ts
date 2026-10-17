/**
 * Focused UI & accessibility helpers for Messenger modals, template radio groups,
 * and persistent field-associated form validation (UX-03, UX-04, UX-05, QA-02).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Checks whether an element and all of its ancestors up to `root` are visible,
 * connected, not hidden, and not inert (UX-05).
 */
export function isElementVisibleAndFocusable(el: HTMLElement, root?: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if ((el as HTMLButtonElement | HTMLInputElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;

  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    if (
      current.hidden ||
      current.hasAttribute('hidden') ||
      current.hasAttribute('inert') ||
      current.classList.contains('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    }
    if (root && current === root) break;
    current = current.parentElement;
  }

  return true;
}

/**
 * Returns ordered focusable elements inside `container`, excluding hidden,
 * inactive, disabled, or inert subtrees (UX-05).
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => isElementVisibleAndFocusable(el, container));
}

const BACKGROUND_SELECTORS = [
  '#site-header',
  '.roost-header',
  '.scene-container',
  '.narrow-dispatch-stack',
  '.tavern-header',
  '.tavern-footer',
];

/**
 * Marks background siblings inert while a modal dialog is open and restores
 * them when the dialog closes (UX-05).
 */
export function setBackgroundInert(
  dialogOrIsOpen: HTMLElement | null | boolean,
  maybeIsOpen?: boolean
): void {
  const activeDialog = typeof dialogOrIsOpen === 'boolean' ? null : dialogOrIsOpen;
  const isOpen = typeof dialogOrIsOpen === 'boolean' ? dialogOrIsOpen : Boolean(maybeIsOpen);

  for (const selector of BACKGROUND_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (activeDialog && (el === activeDialog || el.contains(activeDialog))) {
        return;
      }
      if (isOpen) {
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
    });
  }
}

/**
 * Implements the W3C APG Radio Group pattern for template selector pills (UX-04).
 * Supports roving tabindex, `aria-checked`, arrow keys, Home/End, Space/Enter, and click.
 */
export function setupTemplateRadioGroup(
  selector: string,
  subjectInputId: string,
  bodyInputId: string,
  signal?: AbortSignal
): void {
  const pills = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
  if (pills.length === 0) return;

  const subjectInput = document.getElementById(subjectInputId) as HTMLInputElement | null;
  const bodyInput = document.getElementById(bodyInputId) as HTMLTextAreaElement | null;

  function applySelection(selectedPill: HTMLButtonElement, focusPill = false) {
    pills.forEach((p) => {
      const isSelected = p === selectedPill;
      p.classList.toggle('active', isSelected);
      p.setAttribute('role', 'radio');
      p.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      p.tabIndex = isSelected ? 0 : -1;
    });

    if (focusPill) {
      selectedPill.focus();
    }

    const prefix = selectedPill.getAttribute('data-prefix') || '';
    const subject = selectedPill.getAttribute('data-subject') || '';
    const placeholder = selectedPill.getAttribute('data-placeholder') || '';

    if (subjectInput && prefix && subject) {
      subjectInput.value = `${prefix} ${subject}`;
      subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (bodyInput && placeholder) {
      bodyInput.placeholder = placeholder;
    }
  }

  // Ensure initial state is consistent
  const initialActive = pills.find((p) => p.classList.contains('active')) || pills[0];
  if (initialActive) {
    pills.forEach((p) => {
      const isSelected = p === initialActive;
      p.setAttribute('role', 'radio');
      p.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      p.tabIndex = isSelected ? 0 : -1;
    });
  }

  const listenerOpts = signal ? { signal } : undefined;

  pills.forEach((pill, index) => {
    pill.addEventListener(
      'click',
      () => {
        applySelection(pill, false);
      },
      listenerOpts
    );

    pill.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        let nextIndex = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIndex = (index + 1) % pills.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          nextIndex = (index - 1 + pills.length) % pills.length;
        } else if (e.key === 'Home') {
          nextIndex = 0;
        } else if (e.key === 'End') {
          nextIndex = pills.length - 1;
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          applySelection(pill, true);
          return;
        }

        if (nextIndex !== -1) {
          e.preventDefault();
          e.stopPropagation();
          applySelection(pills[nextIndex], true);
        }
      },
      listenerOpts
    );
  });
}

/**
 * Displays a persistent form-level error message (UX-03: never auto-hides on a timer).
 */
export function showFormError(errorId: string, message: string): void {
  const el = document.getElementById(errorId);
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

/**
 * Clears a form-level error banner.
 */
export function clearFormError(errorId: string): void {
  const el = document.getElementById(errorId);
  if (el) {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

/**
 * Updates a form-level polite status banner (e.g., "Checking your message…").
 */
export function setFormStatus(statusId: string, message: string | null): void {
  const el = document.getElementById(statusId);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

/**
 * Associates a persistent validation error directly with a specific input field
 * via `aria-invalid="true"` and its `aria-describedby` error node (UX-03).
 */
export function setFieldError(
  inputId: string,
  message: string,
  bannerErrorId?: string
): void {
  const input = document.getElementById(inputId) as HTMLInputElement | HTMLTextAreaElement | null;
  const fieldErr = document.getElementById(`${inputId}-error`);

  if (input) {
    input.setAttribute('aria-invalid', 'true');
  }
  if (fieldErr) {
    fieldErr.textContent = message;
    fieldErr.classList.remove('hidden');
  }
  if (bannerErrorId) {
    showFormError(bannerErrorId, message);
  }
}

/**
 * Clears field-level error state when the user edits the field (UX-03).
 */
export function clearFieldError(inputId: string, bannerErrorId?: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | HTMLTextAreaElement | null;
  const fieldErr = document.getElementById(`${inputId}-error`);

  if (input) {
    input.setAttribute('aria-invalid', 'false');
  }
  if (fieldErr) {
    fieldErr.textContent = '';
    fieldErr.classList.add('hidden');
  }
  if (bannerErrorId) {
    // Only clear banner if no other field in the form still has an active error
    const form = input?.closest('form');
    const remainingErrors = form
      ? Array.from(form.querySelectorAll('.field-error')).some(
          (node) => !node.classList.contains('hidden') && (node.textContent || '').trim().length > 0
        )
      : false;
    if (!remainingErrors) {
      clearFormError(bannerErrorId);
    }
  }
}
