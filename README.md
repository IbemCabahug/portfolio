# Portfolio

A developer portfolio with two layers: a plain, fast, accessible Simple Mode, and a decorative tavern-themed layer.

## Prerequisites

- Node.js 24.19.0 (see `.nvmrc`)
- npm 10.8.2+

## Commands

- `npm install` - Install project dependencies
- `npm run dev` - Start local development server
- `npm run build` - Build for production
- `npm run preview` - Preview the production build locally

## Environment Variables

See `.env.example` for required environment variables:
- `EMAIL_API_KEY`
- `CONTACT_TO_ADDRESS`
- `TURNSTILE_SECRET`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `PUBLIC_SITE_URL`
- `WEB3FORMS_KEY` (public Web3Forms delivery key; the browser receives it in browser-assisted mode, so it is not a secret)

### Contact security and delivery

Set **both** `EMAIL_API_KEY` (Resend) and `CONTACT_TO_ADDRESS` for server delivery. Setting only one returns HTTP 503; it no longer silently falls back to Web3Forms. When both are absent, the existing Web3Forms-only mode remains available if `WEB3FORMS_KEY` is configured. That browser-provider path is not bound to first-party clearance; provider-side abuse controls still require verification before treating it as authoritative. Never place privileged provider API credentials in the Web3Forms setting. The current Resend sender is `onboarding@resend.dev`; confirm account recipient restrictions and sender-domain requirements before switching production delivery.

Turnstile is checked on the server before email validation or delivery. Production deployments reject dummy secrets; `VERCEL_ENV=production` takes precedence over contradictory development/test flags. Synthetic `test-pass-*` tokens work only in the isolated `NODE_ENV=test` harness, never ordinary development. Missing browser proof stops automated submission; direct-email options and drafts remain available.

Web3Forms Free delivery additionally requires hCaptcha enabled and saved for the matching access key in its dashboard. The browser uses Web3Forms' documented shared public hCaptcha site key (no new secret or hCaptcha account required). Complete both the first-party Turnstile check and the separately labeled delivery check. hCaptcha proof is submitted only to Web3Forms as `h-captcha-response`; it is never verified or reused by `/api/missive`. The hCaptcha SDK and resource origins are allowed explicitly in `vercel.json`. Loading failures, expiry and retries retain the draft and direct-email options. Both widgets are removed on Astro navigation, and delivery proof is reset after a send attempt.

Keep provider enforcement enabled. A deployment of this integration and one coordinated live positive/negative provider check are still required: local mocked tests cannot establish the saved dashboard setting, production SHA, CSP behavior or actual email delivery. Until the compatible application is deployed, mandatory provider hCaptcha may reject the old production form. The initial integration deliberately preserves Turnstile; removing duplicate CAPTCHA UX requires a separate server-enforcement design. The client-side missing-proof guard is UX only, not the security boundary—Web3Forms must reject invalid/missing proof independently.

Local, **per-instance** safeguards are 6 attempts/IP/hour, a 30-second same-IP cooldown, 120 verification attempts/5 minutes, and 40 verified action reservations/hour. Invalid proof does not spend the verified-action budget. The shorter verification budget can still be exhausted by distributed traffic. State resets on cold starts and is not shared between serverless instances: these controls are not deployment-wide quotas or DDoS protection. Tune edge rules using measured staging traffic and confirmed hosting settings, not unbounded public tests.

Regression checks: `npm run test:audit`. Widget lifecycle browser checks: build with a synthetic non-dummy public site-key marker in a secret-free disposable workspace, then run `node scripts/test-turnstile-recovery.mjs` with `SECURITY_BUILD_ROOT` pointing to its `dist/client` directory. The browser suite mocks/blocks external requests; it never validates live Turnstile tokens or sends email. It requires the existing local Edge executable configured by the browser harness.

## Documentation

Project documentation lives in a separate private repository.
