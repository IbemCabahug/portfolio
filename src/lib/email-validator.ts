/**
 * Client & Server Email Validation Engine (Approach B)
 * Protects the Messenger Roost from fake, disposable, and burner email spam.
 *
 * Layers of Defense:
 * 1. Syntax & RFC Format Verification
 * 2. Troll & Placeholder Pattern Heuristics
 * 3. Disposable & Burner Domain Blocklist (150+ known temporary mail providers)
 * 4. Live DNS-over-HTTPS (DoH) MX Record Lookup via Google DNS (with Cloudflare fallback)
 *
 * Usage:
 * - Client-side pre-flight (UX only): `validateEmail(email)` — fails open if the
 *   visitor's browser cannot reach the DoH resolvers, so nobody is falsely blocked;
 *   the server re-validates strictly before any message is dispatched.
 * - Server-side authoritative gate (`src/pages/api/missive.ts`):
 *   `validateEmail(email, { strict: true })` — DNS verification failures REJECT the
 *   address so the MX check can never be silently skipped.
 */

export interface EmailValidationOptions {
  /**
   * When true, live DNS verification failures reject the email instead of failing open.
   * Mandatory for the server-side dispatch endpoint, where DoH is always reachable.
   */
  strict?: boolean;
}

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
  isDisposable?: boolean;
  isSyntaxError?: boolean;
  isDomainError?: boolean;
}

// Curated blocklist of disposable, temporary, and burner email domains
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  // Popular burner mail services
  'mailinator.com',
  'mailinator.net',
  'mailinator2.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.biz',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempmailo.com',
  'tempmailaddress.com',
  '10minutemail.com',
  '10minutemail.net',
  '10minutemail.org',
  '10minmail.com',
  'throwawaymail.com',
  'throwaway.email',
  'trashmail.com',
  'trashmail.net',
  'trashmail.me',
  'trashmail.io',
  'trashmail.at',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'cool.fr.nf',
  'jetable.fr.nf',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
  'dispostable.com',
  'getairmail.com',
  'fakeinbox.com',
  'meltmail.com',
  'mohmal.com',
  'mohmal.in',
  'crazymailing.com',
  'getnada.com',
  'nada.ltd',
  'nada.email',
  'abyssmail.com',
  'burnermail.io',
  'burnermail.com',
  'inboxkitten.com',
  'dropmail.me',
  'emailondeck.com',
  'minuteinbox.com',
  'generator.email',
  'tempail.com',
  'mytemp.email',
  'mytempemail.com',
  'maildrop.cc',
  'harakirimail.com',
  'discard.email',
  'discardedmail.com',
  'spambog.com',
  'jetable.org',
  'kasmail.com',
  'deadaddress.com',
  'incognitomail.org',
  'trashymail.com',
  'spamgourmet.com',
  'mytrashmail.com',
  'mailcatch.com',
  'trash-mail.at',
  'binkmail.com',
  'safetymail.info',
  'filzmail.com',
  'guerillamail.com',
  'tempinbox.com',
  'armyspy.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fckv.com',
  'fleeing.cc',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'vypmail.com',
  'fakeemailgenerator.com',
  'mailexpire.com',
  'mailnesia.com',
  'emailfake.com',
  'fakemail.net',
  'mintemail.com',
  'trashemail.in',
  'mail-temporaire.fr',
  'crazymail.com',
  'mail-temp.com',
  'mailtothis.com',
  'trashmail.net',
  'zoemail.org',
  'zillamail.com',
  'yapped.net',
  'whyspam.me',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'uggsrock.com',
  'trbvm.com',
  'tradermail.info',
  'tempr.email',
  'tempinbox.com',
  'suremail.info',
  'spamhole.com',
  'spambox.us',
  'sogetthis.com',
  'sofort-mail.de',
  'sneakemail.com',
  'sharklasers.com',
  'sharedmailbox.org',
  'safersignup.de',
  'pookmail.com',
  'owlymail.com',
  'oneoffmail.com',
  'nospam4.us',
  'nobulk.com',
  'nervmich.net',
  'mytempemail.com',
  'mycleaninbox.net',
  'mailsac.com',
  'mailnull.com',
  'mailnes.net',
  'maildrop.cc',
  'mailcatch.com',
  'mailbog.com',
  'instantemailaddress.com',
  'incognitomail.org',
  'hidemail.de',
  'greensloth.com',
  'getairmail.com',
  'filzmail.com',
  'eyepaste.com',
  'emailthe.net',
  'emailproxsy.com',
  'emailmiser.com',
  'emaildienst.de',
  'dumpmail.de',
  'disposableinbox.com',
  'deadfake.com',
  'bouncr.com',
  'binkmail.com',
  'anonymbox.com',
  'anonaddy.me',
  '0-mail.com',
  '10mail.org',
  '20minutemail.com',
  '33mail.com',
  'guerrillamail.de',
  'guerrillamail.info',
]);

// Known placeholder / troll usernames that indicate fake or low-effort submissions
const TROLL_LOCAL_PARTS: ReadonlySet<string> = new Set([
  'test',
  'asdf',
  'fake',
  'troll',
  'admin',
  'administrator',
  'root',
  'user',
  'guest',
  'nobody',
  'null',
  'none',
  'noemail',
  'spam',
  'burner',
  'anon',
  'anonymous',
  'temp',
  'dummy',
  'sample',
  'xyz',
  'qwerty',
  '123456',
  '12345',
  'abc',
]);

/**
 * Checks if a domain or its parent domain belongs to the disposable email registry.
 */
export function isDisposableDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().trim();
  if (DISPOSABLE_DOMAINS.has(normalized)) return true;

  // Check subdomains (e.g. user@any.mailinator.com)
  for (const disposable of DISPOSABLE_DOMAINS) {
    if (normalized.endsWith('.' + disposable)) {
      return true;
    }
  }
  return false;
}

/**
 * Performs DNS-over-HTTPS (DoH) MX lookup to verify if the domain has active mail servers.
 * Resolves with Google Public DNS, with graceful fallback to Cloudflare DNS.
 * Returns true if valid or if DoH is unreachable (fail-open for network resilience).
 */
async function verifyDomainHasMailServers(domain: string, strict = false): Promise<{ active: boolean; reason?: string }> {
  // Common trusted domains skip live DNS query for speed and zero latency
  const TRUSTED_PROVIDER_SUFFIXES = [
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'ymail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'proton.me',
    'protonmail.com',
    'zoho.com',
    'aol.com',
    'edu',
    'gov',
    'mil',
  ];

  const lowerDomain = domain.toLowerCase();
  for (const trusted of TRUSTED_PROVIDER_SUFFIXES) {
    if (lowerDomain === trusted || lowerDomain.endsWith('.' + trusted)) {
      return { active: true };
    }
  }

  // 3.5s timeout abort controller so UI never hangs
  const createTimeoutSignal = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };

  // 1. Try Google Public DNS DoH
  try {
    const googleRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { Accept: 'application/dns-json' },
      signal: createTimeoutSignal(3000),
    });

    if (googleRes.ok) {
      const data = await googleRes.json();
      // Status 3 = NXDOMAIN (Domain does not exist at all)
      if (data.Status === 3) {
        return {
          active: false,
          reason: `The domain "${domain}" does not exist. Please check your return address.`,
        };
      }

      // If Status 0 (NOERROR), check if MX records exist
      if (data.Status === 0) {
        const hasMx = Array.isArray(data.Answer) && data.Answer.some((a: { type: number }) => a.type === 15);
        if (hasMx) return { active: true };

        // NO MX ACCEPTANCE PATH: A/AAAA records no longer count as a deliverable
        // fallback. Parked domains (e.g. `asasdasd.com` — a real NameBright
        // parking page with A records and no MX) sailed through the old
        // "RFC 5321 implicit-MX" fallback and reached the inbox as spam. A
        // domain that cannot answer for its own MX is not known to receive
        // mail, so reject with an explicit, actionable message.
        return {
          active: false,
          reason: `The domain "${domain}" has no mail exchanger (MX) configured. It appears parked or unable to receive email. Please double-check your return address.`,
        };
      }
    }
  } catch {
    // Fallback to Cloudflare DNS
  }

  // 2. Fallback to Cloudflare DoH
  try {
    const cfRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { Accept: 'application/dns-json' },
      signal: createTimeoutSignal(2500),
    });

    if (cfRes.ok) {
      const cfData = await cfRes.json();
      if (cfData.Status === 3) {
        return {
          active: false,
          reason: `The domain "${domain}" does not exist. Please check your return address.`,
        };
      }
      if (cfData.Status === 0) {
        const hasMx = Array.isArray(cfData.Answer) && cfData.Answer.some((a: { type: number }) => a.type === 15);
        if (hasMx) return { active: true };
      }
    }
  } catch {
    // Both DNS queries failed (e.g. offline or a strictly blocked resolver).
  }

  if (strict) {
    // Server-side authoritative call: an unverifiable domain must NOT be let through.
    return {
      active: false,
      reason: 'We could not verify this email domain right now. Please try again in a moment.',
    };
  }

  // Client-side pre-flight only: fail open so a browser-side DoH hiccup
  // never blocks a legitimate visitor (the server re-validates strictly).
  return { active: true };
}

/**
 * Validates an email address against syntax, troll heuristics, disposable domain lists,
 * and live DNS MX records.
 */
export async function validateEmail(rawEmail: string, options: EmailValidationOptions = {}): Promise<EmailValidationResult> {
  const email = (rawEmail || '').trim();

  // 1. Empty Check
  if (!email) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please enter your email address.',
    };
  }

  // 2. Length Constraints (RFC 5321)
  if (email.length > 254) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Email address exceeds maximum length of 254 characters.',
    };
  }

  // 3. Syntax Verification
  const parts = email.split('@');
  if (parts.length !== 2) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please enter a valid email format (e.g. traveler@guild.com).',
    };
  }

  const [localPart, domainPart] = parts;
  const normalizedLocal = localPart.toLowerCase().trim();
  const normalizedDomain = domainPart.toLowerCase().trim();

  if (!normalizedLocal || !normalizedDomain) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please enter a complete email address with username and domain.',
    };
  }

  if (normalizedLocal.length > 64) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Email username cannot exceed 64 characters.',
    };
  }

  // Standard email regex check
  const EMAIL_FORMAT_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!EMAIL_FORMAT_REGEX.test(email)) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'The email format is invalid. Please check for typos.',
    };
  }

  // Top-Level Domain (TLD) validation: must have dot, TLD at least 2 chars, all letters
  const domainSegments = normalizedDomain.split('.');
  const tld = domainSegments[domainSegments.length - 1];
  if (!tld || tld.length < 2 || !/^[a-z]+$/i.test(tld)) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please provide a valid top-level domain (e.g. .com, .org, .ph).',
    };
  }

  // 4. Troll / Placeholder Heuristics
  // Any troll/placeholder username (e.g. troll, test, asdf, fake, admin, 12345)
  // is rejected regardless of domain, so `troll@gmail.com` can no longer slip through.
  if (
    TROLL_LOCAL_PARTS.has(normalizedLocal) ||
    (normalizedLocal === domainSegments[0] && normalizedLocal.length <= 4) ||
    normalizedDomain === 'example.com' ||
    normalizedDomain === 'test.com' ||
    normalizedDomain === 'fake.com' ||
    normalizedDomain === 'domain.com' ||
    normalizedDomain === 'asdf.com' ||
    normalizedDomain === 'troll.com'
  ) {
    return {
      valid: false,
      reason: 'Please provide an authentic, personal email address where you can be reached.',
    };
  }

  // 5. Disposable / Burner Domain Blocklist Check
  if (isDisposableDomain(normalizedDomain)) {
    return {
      valid: false,
      isDisposable: true,
      reason: 'Temporary or disposable burner email addresses are not accepted. Please use a permanent email address.',
    };
  }

  // 6. Live DNS MX Verification (DNS-over-HTTPS)
  // Server-side (strict) calls fail closed when DoH is unreachable, so a troll
  // cannot skirt the MX check by blocking the resolver (which the old client-only
  // path did due to `connect-src` and the previous fail-open behaviour).
  const dnsResult = await verifyDomainHasMailServers(normalizedDomain, options.strict === true);
  if (!dnsResult.active) {
    return {
      valid: false,
      isDomainError: true,
      reason: dnsResult.reason || `The domain "${normalizedDomain}" does not appear to have an active mail server.`,
    };
  }

  return { valid: true };
}
