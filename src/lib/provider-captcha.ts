/** Web3Forms Free-plan proof. Only Web3Forms verifies this single-use token. */
export const WEB3FORMS_HCAPTCHA_SITEKEY = '50b2fe65-b00b-4b9e-ad62-3ba471098be2';

interface CaptchaSDK {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  getResponse(id: string): string;
  reset(id: string): void;
  remove(id: string): void;
}

type CaptchaWindow = Window & {
  hcaptcha?: CaptchaSDK;
  portfolioHCaptchaReady?: () => void;
};

export function setupProviderCaptcha(signal: AbortSignal) {
  const host = window as CaptchaWindow;
  const widgets = new Map<string, string>();
  const slots = ['desktop-hcaptcha-slot', 'mobile-hcaptcha-slot'];
  let ready = false;
  let loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function status(slot: string, message: string) {
    const node = document.getElementById(`${slot}-status`);
    if (node && !signal.aborted) node.textContent = message;
  }

  function render() {
    if (signal.aborted || !host.hcaptcha || !ready) return;
    for (const slot of slots) {
      const container = document.getElementById(slot);
      if (!container || widgets.has(slot)) continue;
      try {
        const id = host.hcaptcha.render(container, {
          sitekey: WEB3FORMS_HCAPTCHA_SITEKEY,
          theme: 'dark',
          size: 'compact',
          callback: () => status(slot, 'Delivery verification complete.'),
          'expired-callback': () => status(slot, 'Delivery verification expired. Complete the challenge again.'),
          'chalexpired-callback': () => status(slot, 'Delivery challenge timed out. Please retry.'),
          'error-callback': () => status(slot, 'Delivery verification unavailable. Retry or use direct email.'),
        });
        widgets.set(slot, id);
        status(slot, 'Complete delivery verification for Web3Forms.');
      } catch {
        status(slot, 'Delivery verification could not start. Retry or use direct email.');
      }
    }
  }

  // Load through the documented SDK onload callback, not a race-prone render poll.
  function load() {
    if (signal.aborted || loading) return;
    if (ready) { render(); return; }
    loading = true;
    for (const slot of slots) status(slot, 'Loading delivery verification…');
    const complete = () => {
      clearTimeout(timer);
      loading = false;
      ready = true;
      render();
    };
    // An existing SDK from an earlier Astro page has already completed setup.
    if (host.hcaptcha && document.getElementById('portfolio-hcaptcha-sdk')?.dataset.ready === 'true') {
      complete();
      return;
    }
    host.portfolioHCaptchaReady = () => {
      const script = document.getElementById('portfolio-hcaptcha-sdk');
      if (script) script.dataset.ready = 'true';
      complete();
    };
    const fail = () => {
      clearTimeout(timer);
      loading = false;
      for (const slot of slots) status(slot, 'Delivery verification unavailable. Retry or use direct email.');
    };
    document.getElementById('portfolio-hcaptcha-sdk')?.remove();
    const script = document.createElement('script');
    script.id = 'portfolio-hcaptcha-sdk';
    script.src = 'https://js.hcaptcha.com/1/api.js?onload=portfolioHCaptchaReady&render=explicit&recaptchacompat=off';
    script.async = true;
    script.addEventListener('error', fail, { once: true, signal });
    timer = setTimeout(fail, 8000);
    document.head.append(script);
  }

  for (const slot of slots) {
    document.getElementById(`${slot}-retry`)?.addEventListener('click', () => {
      const id = widgets.get(slot);
      if (id !== undefined && host.hcaptcha) {
        try {
          host.hcaptcha.reset(id);
          status(slot, 'Complete delivery verification again.');
        } catch { status(slot, 'Please reload the page or use direct email.'); }
      } else load();
    }, { signal });
  }
  load();
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    host.portfolioHCaptchaReady = undefined;
    for (const id of widgets.values()) {
      try { host.hcaptcha?.remove(id); } catch { /* SDK may already be gone. */ }
    }
    widgets.clear();
  }, { once: true });

  return {
    getToken(desktop: boolean) {
      const id = widgets.get(desktop ? slots[0] : slots[1]);
      try { return id !== undefined ? host.hcaptcha?.getResponse(id) || '' : ''; }
      catch { return ''; }
    },
    reset(desktop: boolean) {
      const slot = desktop ? slots[0] : slots[1];
      const id = widgets.get(slot);
      if (id !== undefined) {
        try { host.hcaptcha?.reset(id); } catch { /* Keep direct email available. */ }
        status(slot, 'Complete delivery verification again before another attempt.');
      }
    },
  };
}