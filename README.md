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

### Contact security and delivery

Set **both** `EMAIL_API_KEY` (Resend) and `CONTACT_TO_ADDRESS` for server-to-server delivery via `/api/missive`. If either variable is missing, `/api/missive` fails closed with HTTP 503 while keeping drafts and direct-email options available. No provider key is ever exposed to the browser. The current Resend sender is `onboarding@resend.dev`; confirm account recipient restrictions (`CONTACT_TO_ADDRESS` must match your Resend account email unless a custom sender domain is verified).

Turnstile is checked on the server before email validation or delivery. Production deployments reject dummy secrets; `VERCEL_ENV=production` takes precedence over contradictory development/test flags. Synthetic `test-pass-*` tokens work only in the isolated `NODE_ENV=test` harness, never ordinary development. Missing browser proof stops automated submission; direct-email options and drafts remain available. The Turnstile widget is removed on Astro navigation and reset after each send attempt.

Local, **per-instance** safeguards are 6 attempts/IP/hour, a 30-second same-IP cooldown, 120 verification attempts/5 minutes, and 40 verified action reservations/hour. Invalid proof does not spend the verified-action budget. The shorter verification budget can still be exhausted by distributed traffic. State resets on cold starts and is not shared between serverless instances: these controls are not deployment-wide quotas or DDoS protection. Tune edge rules using measured staging traffic and confirmed hosting settings, not unbounded public tests.

Regression checks: `npm run test:audit`. Widget lifecycle browser checks: build with a synthetic non-dummy public site-key marker in a secret-free disposable workspace, then run `node scripts/test-turnstile-recovery.mjs` with `SECURITY_BUILD_ROOT` pointing to its `dist/client` directory. The browser suite mocks/blocks external requests; it never validates live Turnstile tokens or sends email. It requires the existing local Edge executable configured by the browser harness.

## Documentation

Project documentation lives in a separate private repository.
