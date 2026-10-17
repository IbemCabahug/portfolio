/**
 * Client & Server Email Validation Utility
 * Helps catch typos, disposable burner domains, and unroutable domains on contact forms.
 * Note: Syntax and DNS checks verify domain mail routing, not sender identity or mailbox ownership.
 */

export interface EmailValidationOptions {
  /**
   * When true, transient DNS resolver failures return a temporary verification error
   * instead of failing open.
   */
  strict?: boolean;
  /**
   * Optional custom fetch implementation for deterministic unit testing.
   */
  fetchImpl?: typeof fetch;
}

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
  isDisposable?: boolean;
  isSyntaxError?: boolean;
  isDomainError?: boolean;
  isTransientDnsError?: boolean;
}

// Curated blocklist of disposable, temporary, and burner email domains
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  'mailinator.net',
  'mailinator2.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.biz',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerillamail.com',
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
  'trash-mail.at',
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
  'binkmail.com',
  'safetymail.info',
  'filzmail.com',
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
  'suremail.info',
  'spamhole.com',
  'spambox.us',
  'sogetthis.com',
  'sofort-mail.de',
  'sneakemail.com',
  'sharedmailbox.org',
  'safersignup.de',
  'pookmail.com',
  'owlymail.com',
  'oneoffmail.com',
  'nospam4.us',
  'nobulk.com',
  'nervmich.net',
  'mycleaninbox.net',
  'mailsac.com',
  'mailnull.com',
  'mailnes.net',
  'mailbog.com',
  'instantemailaddress.com',
  'hidemail.de',
  'greensloth.com',
  'eyepaste.com',
  'emailthe.net',
  'emailproxsy.com',
  'emailmiser.com',
  'emaildienst.de',
  'dumpmail.de',
  'disposableinbox.com',
  'deadfake.com',
  'bouncr.com',
  'anonymbox.com',
  'anonaddy.me',
  '0-mail.com',
  '10mail.org',
  '20minutemail.com',
  '33mail.com',
]);

// Obvious keyboard-mash / non-routable placeholder local parts.
// Legitimate role addresses (admin, user, info, contact, hr, careers, support, office, etc.)
// are intentionally permitted so recruiters and organizations are never blocked.
const PLACEHOLDER_LOCAL_PARTS: ReadonlySet<string> = new Set([
  'asdf',
  'qwerty',
  '123456',
  '12345',
  'noemail',
  'noreply',
  'no-reply',
  'dontreply',
  'fake',
  'troll',
  'burner',
  'throwaway',
]);

// RFC 2606 / RFC 6761 reserved & unroutable placeholder domains
const PLACEHOLDER_DOMAINS: ReadonlySet<string> = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'fake.com',
  'domain.com',
  'asdf.com',
  'troll.com',
  'invalid',
  'localhost',
  'test',
  'example',
]);

// Exact-match major consumer/business mail providers with known active MX infrastructure
const KNOWN_MAIL_PROVIDERS: ReadonlySet<string> = new Set([
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
]);

/**
 * Checks if a domain or its parent domain belongs to the disposable email registry.
 */
export function isDisposableDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().trim();
  if (DISPOSABLE_DOMAINS.has(normalized)) return true;

  for (const disposable of DISPOSABLE_DOMAINS) {
    if (normalized.endsWith('.' + disposable)) {
      return true;
    }
  }
  return false;
}

interface DnsJsonAnswer {
  type: number;
  data?: string;
}

interface DnsJsonResponse {
  Status?: number;
  Answer?: DnsJsonAnswer[];
}

function inspectMxRecords(answers: DnsJsonAnswer[] | undefined): 'valid_mx' | 'null_mx' | 'no_mx' {
  if (!Array.isArray(answers) || answers.length === 0) return 'no_mx';
  const mxRecords = answers.filter((a) => a.type === 15);
  if (mxRecords.length === 0) return 'no_mx';

  // RFC 7505 Null MX: single MX record of "0 ." or "." indicates domain accepts no mail
  const hasNullMx = mxRecords.some((a) => {
    const raw = (a.data || '').trim();
    return raw === '.' || raw === '0 .' || /^0\s+\.$/.test(raw);
  });
  const hasRealMx = mxRecords.some((a) => {
    const raw = (a.data || '').trim();
    return raw.length > 0 && raw !== '.' && !/^0\s+\.$/.test(raw);
  });

  if (hasNullMx && !hasRealMx) return 'null_mx';
  if (hasRealMx) return 'valid_mx';
  return 'no_mx';
}

/**
 * Performs DNS-over-HTTPS (DoH) lookup to verify if the domain can receive mail.
 * Checks MX records first (honoring RFC 7505 Null MX), then falls back to A/AAAA
 * implicit MX per RFC 5321 Section 5.1.
 */
async function verifyDomainHasMailServers(
  domain: string,
  strict = false,
  fetchFn: typeof fetch = fetch
): Promise<{ active: boolean; reason?: string; transientError?: boolean }> {
  const lowerDomain = domain.toLowerCase();
  if (KNOWN_MAIL_PROVIDERS.has(lowerDomain)) {
    return { active: true };
  }

  const createTimeoutSignal = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };

  const resolvers = [
    {
      mxUrl: `https://dns.google/resolve?name=${encodeURIComponent(lowerDomain)}&type=MX`,
      aUrl: `https://dns.google/resolve?name=${encodeURIComponent(lowerDomain)}&type=A`,
      aaaaUrl: `https://dns.google/resolve?name=${encodeURIComponent(lowerDomain)}&type=AAAA`,
      timeoutMs: 3000,
    },
    {
      mxUrl: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(lowerDomain)}&type=MX`,
      aUrl: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(lowerDomain)}&type=A`,
      aaaaUrl: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(lowerDomain)}&type=AAAA`,
      timeoutMs: 2500,
    },
  ];

  for (const resolver of resolvers) {
    try {
      const mxRes = await fetchFn(resolver.mxUrl, {
        headers: { Accept: 'application/dns-json' },
        signal: createTimeoutSignal(resolver.timeoutMs),
      });

      if (!mxRes.ok) continue;
      const data = (await mxRes.json()) as DnsJsonResponse;

      // Status 3 = NXDOMAIN (Domain does not exist)
      if (data.Status === 3) {
        return {
          active: false,
          reason: `The domain "${domain}" does not exist. Please check your email address for typos.`,
        };
      }

      if (data.Status === 0) {
        const mxStatus = inspectMxRecords(data.Answer);
        if (mxStatus === 'valid_mx') {
          return { active: true };
        }
        if (mxStatus === 'null_mx') {
          return {
            active: false,
            reason: `The domain "${domain}" is configured not to accept incoming email (Null MX). Please provide another email address.`,
          };
        }

        // RFC 5321 Section 5.1 Implicit MX: when no MX records exist, check A/AAAA address records
        const hasInlineAddress =
          Array.isArray(data.Answer) && data.Answer.some((a) => a.type === 1 || a.type === 28);
        if (hasInlineAddress) {
          return { active: true };
        }

        try {
          const aRes = await fetchFn(resolver.aUrl, {
            headers: { Accept: 'application/dns-json' },
            signal: createTimeoutSignal(resolver.timeoutMs),
          });
          if (aRes.ok) {
            const aData = (await aRes.json()) as DnsJsonResponse;
            if (Array.isArray(aData.Answer) && aData.Answer.some((a) => a.type === 1)) {
              return { active: true };
            }
          }
          const aaaaRes = await fetchFn(resolver.aaaaUrl, {
            headers: { Accept: 'application/dns-json' },
            signal: createTimeoutSignal(resolver.timeoutMs),
          });
          if (aaaaRes.ok) {
            const aaaaData = (await aaaaRes.json()) as DnsJsonResponse;
            if (Array.isArray(aaaaData.Answer) && aaaaData.Answer.some((a) => a.type === 28)) {
              return { active: true };
            }
          }
        } catch {
          // If secondary A/AAAA lookup fails transiently, try next resolver
          continue;
        }

        return {
          active: false,
          reason: `The domain "${domain}" has no mail server (MX or address) records configured. Please double-check your email address.`,
        };
      }
    } catch {
      // Try next DoH resolver
    }
  }

  if (strict) {
    return {
      active: false,
      transientError: true,
      reason: 'We could not reach DNS to verify your email domain right now. Please try again in a moment, or send directly via your email client.',
    };
  }

  return { active: true, transientError: true };
}

/**
 * Normalizes a domain name, converting internationalized domain labels (IDN)
 * to ASCII punycode where supported by the standard URL parser.
 */
function normalizeDomain(rawDomain: string): string | null {
  const trimmed = rawDomain.trim().toLowerCase();
  if (!trimmed || trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    return null;
  }
  try {
    const url = new URL(`http://${trimmed}`);
    if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validates an email address against syntax, placeholder heuristics, disposable domain lists,
 * and live DNS mail routing records.
 */
export async function validateEmail(
  rawEmail: string,
  options: EmailValidationOptions = {}
): Promise<EmailValidationResult> {
  if (typeof rawEmail !== 'string') {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please enter your email address.',
    };
  }

  const email = rawEmail.trim();

  // 1. Empty Check
  if (!email) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please enter your email address.',
    };
  }

  // Reject control characters or whitespace
  if (/[\r\n\t\s]/.test(email)) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'The email format is invalid. Please remove any spaces.',
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
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0 || atIndex !== email.indexOf('@') || atIndex === email.length - 1) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please enter a valid email format (e.g. name@company.com).',
    };
  }

  const localPart = email.slice(0, atIndex);
  const rawDomainPart = email.slice(atIndex + 1);
  const normalizedLocal = localPart.toLowerCase();

  if (localPart.length > 64) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Email username cannot exceed 64 characters.',
    };
  }

  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'The email username cannot start, end, or contain consecutive dots.',
    };
  }

  // Standard RFC 5322 dot-atom local-part characters (supports +tag, role names, etc.)
  const LOCAL_PART_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
  if (!LOCAL_PART_REGEX.test(localPart)) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'The email username contains invalid characters. Please check for typos.',
    };
  }

  const normalizedDomain = normalizeDomain(rawDomainPart);
  if (!normalizedDomain || normalizedDomain.length > 253) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'The email domain format is invalid. Please check for typos.',
    };
  }

  const domainSegments = normalizedDomain.split('.');
  if (domainSegments.length < 2) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please include a full domain name (e.g. company.com).',
    };
  }

  const DOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  for (const segment of domainSegments) {
    if (!DOMAIN_LABEL_REGEX.test(segment)) {
      return {
        valid: false,
        isSyntaxError: true,
        reason: 'The email domain contains invalid characters. Please check for typos.',
      };
    }
  }

  const tld = domainSegments[domainSegments.length - 1];
  if (!tld || tld.length < 2 || (!/^[a-z]{2,}$/i.test(tld) && !/^xn--[a-z0-9]{2,}$/i.test(tld))) {
    return {
      valid: false,
      isSyntaxError: true,
      reason: 'Please provide a valid top-level domain (e.g. .com, .org, .ph).',
    };
  }

  // 4. Placeholder / Reserved Domain Heuristics
  // Check base local part before '+' tag for obvious keyboard-mash placeholders
  const baseLocal = normalizedLocal.split('+')[0];
  if (
    PLACEHOLDER_LOCAL_PARTS.has(baseLocal) ||
    PLACEHOLDER_DOMAINS.has(normalizedDomain) ||
    PLACEHOLDER_DOMAINS.has(tld)
  ) {
    return {
      valid: false,
      reason: 'Please enter a reachable personal or business email address so Nhovem can reply.',
    };
  }

  // 5. Disposable / Burner Domain Blocklist Check
  if (isDisposableDomain(normalizedDomain)) {
    return {
      valid: false,
      isDisposable: true,
      reason: 'Temporary or disposable email addresses are not accepted. Please use a permanent personal or work address.',
    };
  }

  // 6. Live DNS Mail Server Verification (DNS-over-HTTPS)
  const dnsResult = await verifyDomainHasMailServers(
    normalizedDomain,
    options.strict === true,
    options.fetchImpl ?? fetch
  );
  if (!dnsResult.active) {
    return {
      valid: false,
      isDomainError: dnsResult.transientError ? undefined : true,
      isTransientDnsError: dnsResult.transientError === true,
      reason:
        dnsResult.reason ||
        `The domain "${normalizedDomain}" does not appear to have an active mail server.`,
    };
  }

  return {
    valid: true,
    isTransientDnsError: dnsResult.transientError === true ? true : undefined,
  };
}
