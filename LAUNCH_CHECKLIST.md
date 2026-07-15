# Sebenza — Production Launch Checklist

Compiled 2026-07-09 from a 3-track audit (backend security, client/UX, infra/ops)
plus direct code verification. Items are ordered by launch risk.

Legend: **P0** = do not launch without · **P1** = before real money / any scale ·
**P2** = fast-follow after launch.

---

## P0 — Launch blockers (security & correctness)

- [x] **DONE (ec850af)** OTP/verification codes no longer returned in production —
  phone/start, sms, email-code all gated on NODE_ENV; endpoints return 503 in prod
  when SMS/mail unconfigured. Verified live.
- [x] **DONE (ec850af)** Public profile `GET /api/users/:id` is now an explicit
  allowlist — no balances/flags/referralCode/contact; location coarsened to ~1km.
  Verified live (no leaked fields).
- [x] **DONE (ec850af)** `/transactions/cancel` refund now runs in a guarded
  `$transaction` (escrowStatus:'held' condition) — no double-refund.
- [x] **DONE (ec850af)** `/transactions/complete` release now guarded — no double-pay.
- [x] **DONE (ec850af)** `/transactions/request` + `/accept-quote` use atomic balance
  guards — no overdraw.
- [x] **DONE (ec850af)** Socket `join_chat`/`send_message` verify transaction
  membership; receiverId derived server-side; text length-capped.
- [x] **DONE** Test admin revoked — 0 admin accounts in prod DB. Verified.
- [x] **DONE (ec850af)** Client global axios interceptor: attaches JWT + on 401 clears
  session → /login. Verified in build.
- [x] **DONE (ec850af)** Safe localStorage parse on boot (App.js `safeParse`, Chat.js).
- [x] **DONE** `npm audit fix` → 0 vulnerabilities (was 5 high). Verified.
- [x] **SMS DONE (2026-07-15)** — Twilio live: +19206206684 (pay-as-you-go, SA geo
  enabled), creds in Render, verified END-TO-END (real OTP delivered to a ZA number,
  code verified, phoneVerified granted). Phone login works in production.
- [ ] **⚠️ REQUIRED — email creds still pending** (code side is DONE:
  SA numbers auto-convert to E.164 for Twilio; `/api/health` now reports
  `providers: {sms, email}` so you can confirm the config took). Steps:
  1. **SMS**: twilio.com → get SID + Auth Token + buy a number → set
     `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_PHONE` (e.g. `+27...`) in Render → Environment.
  2. **Email** (pick one): SendGrid → `SENDGRID_API_KEY` + `EMAIL_FROM`;
     or Gmail → enable 2FA, create an App Password, set `EMAIL_HOST=smtp.gmail.com`,
     `EMAIL_USER=<gmail>`, `EMAIL_PASS=<app password>`, `EMAIL_FROM`.
  3. Redeploy, then check `https://sebenza-server.onrender.com/api/health` shows
     `"providers":{"sms":true,"email":true}`.
  Until set, phone signup + email codes return 503 in prod (by design — the OTP gate).
  Email+password login still works. Confirm `JWT_SECRET` strong, `NODE_ENV=production`,
  `CORS_ORIGINS` locked.

## P0 — Legal / store (cannot ship without)

- [x] **DONE (18d3552)** Privacy Policy + Terms hosted at `/privacy` and `/terms`
  (POPIA-aware; cover KYC docs, location, flags, user rights). Verified live (200).
- [x] **DONE (18d3552)** Consent capture at registration — checkbox on Register step 3
  and phone signup; server records `termsAcceptedAt` + `termsVersion` and rejects
  signup without it. Verified live (rejects without, records with).
- [x] **DONE (18d3552)** Android targetSdk/compileSdk → 35, versionCode 1→2,
  versionName 1.0.1.
- [ ] **Play Console setup (owner, in the console — not code):** enter the privacy
  policy URL `https://<your-domain>/privacy`, fill the **Data Safety** form (ID docs,
  location, contact info collected), complete content rating, and generate a signed
  release (needs your keystore). App icons/screenshots for the listing.

---

## P1 — Before real money / any real traffic

- [x] **DONE (79dd54f)** Graceful shutdown on SIGTERM/SIGINT (drain HTTP, close io,
  disconnect Prisma) + server timeouts. Verified live (crash handler caught an
  EADDRINUSE during local boot and shut down cleanly).
- [x] **DONE (79dd54f)** `unhandledRejection` / `uncaughtException` handlers.
- [x] **DONE (79dd54f)** KYC docs stored as object refs; short-lived (5-min) signed
  URL minted per authenticated read (upload.js `signSecureUrl`, verification.js).
- [x] **DONE (79dd54f)** CSP enabled. Verified live: map (Leaflet CDN + OSM tiles +
  markers) renders with **zero CSP violations**; login/dashboard unaffected.
- [x] **DONE (79dd54f)** Per-phone SMS limiter on `/api/phone/start`; rate limits on
  `apply`, `trust-docs`, `endorse`, `work-experience`, `send-email-code`.
- [x] **DONE (79dd54f)** `GET /jobs/:id` strips issueReports/workProofPhotos/
  completionRequest/confirmedBy for non-parties.
- [x] **DONE (79dd54f)** `PUT /users/location` lat/lng bounds-checked. Verified live.
- [x] **DONE (79dd54f)** `/api/health` is now a single `SELECT 1`; stats moved to a
  cached `/api/stats/public`. Verified live.
- [x] **DONE (79dd54f)** `scripts/seed.js` refuses to run in production.
- [x] **DONE (79dd54f)** `.env.example` rewritten for Supabase/Twilio/SMTP.
- [x] **DONE** Upload content-sniffing: every upload (Supabase AND local-disk dev
  fallback) is re-encoded through `sharp` before persisting — must decode as a real
  image (renamed HTML/exe → 400), output is clean JPEG, EXIF/GPS stripped, auto-rotated,
  capped 2000px. Polyglot payloads destroyed (verified: appended `<script>` gone).
  Dead disk-based `processImages.js` removed.
- [x] **DONE (code)** Error tracking + structured logging. Sentry wired
  (instrument.js, express error handler, crash handlers) — activates when
  `SENTRY_DSN` is set, no code change; boot log prints "Sentry error tracking: ON".
  Pino JSON request logs with request IDs (honours incoming `X-Request-Id`),
  auth headers redacted, health/static noise filtered, 4xx→warn 5xx→error.
  **Owner: create a free project at sentry.io (Node/Express) and set `SENTRY_DSN`
  in Render.** Optional: `LOG_LEVEL` (default info).
- [x] **DONE** Prisma migrations baseline. `prisma/migrations/0_init` captures the live
  DB exactly (15 tables, 29 indexes, 29 FKs), marked applied via `migrate resolve`.
  `schema.prisma` aligned to the DB (index/FK names, `onUpdate: NoAction`, DECIMAL types,
  JSON defaults) → **zero drift** (`migrate diff` = empty migration). Render build now runs
  `prisma migrate deploy`; CI has a drift guard (migrations must reproduce the schema).
- [x] **DONE** Backups: daily `pg_dump` GitHub Action (02:30 UTC + manual dispatch),
  PG17-client custom-format dump with a table-count sanity check, stored as workflow
  artifacts (30-day retention). `SUPABASE_DB_URL` repo secret set. **First run verified
  green.** Restore: `pg_restore --clean --if-exists -d "$DIRECT_URL" <dump>`. For
  point-in-time recovery later, upgrade the Supabase plan.

## P1 — Client / mobile

- [x] **DONE** Capacitor ships the local `build/` bundle (`server.url` removed) —
  instant cold start, no white splash, no "webview of a website" policy risk. API +
  socket calls repointed at the server in native via `shared/apiBase.js` (axios
  interceptor rewrites relative `/api` URLs; sockets use `SOCKET_ORIGIN`).
- [x] **DONE** ngrok fetch/XHR monkey-patch removed (client index.js). Verified:
  `window.fetch` unpatched in build.
- [x] **DONE** Leaflet bundled from npm (MapView + NavigationMap) and team QR switched
  to the already-bundled `qrcode` package — no CDN scripts at runtime. Verified: map
  renders tiles + markers with zero external scripts. Server CSP tightened (unpkg/cdnjs
  removed from scriptSrc/styleSrc).
- [x] **DONE** Real service worker (`public/service-worker.js`): network-first HTML
  (deploys picked up next load — no stale shell), cache-first hashed `/static/` assets,
  old caches dropped on activate. Skipped in the native shell. Verified: registered +
  activated in browser.

## P1 — CI / process

- [x] **DONE (79dd54f)** GitHub Actions CI (`.github/workflows/ci.yml`) runs all test
  suites + a client build on every push/PR to main.
- [ ] **Build client in Render** (`buildCommand`) or CI-verify `build/` matches `src/` —
  committed `client/build` can silently drift from source.

---

## P2 — Fast-follow (polish, not blocking)

- [x] **DONE** Dev-only error copy removed (JobBoard "wrong port" messages, "Jason will
  patch it" boundary copy).
- [x] **DONE** `alert()` → in-app toast (JobBoard ×3 `showMsg`, PostJobModal `setError`).
- [x] **DONE** `gshop`/Ge-Shop residue purged (storage keys, QR prefix) + all 12
  `console.log`s stripped from JobBoard.
- [x] **DONE** `apple-touch-icon` → 192px PNG; manifest icons carry proper `purpose`
  (512px marked maskable).
- [x] **DONE** Inter self-hosted (variable woff2 in `/fonts`, preloaded, SW-cached) —
  Google Fonts removed from index.html **and** from the CSP.
- [x] **DONE** Shared `formatRand()` (en-US grouping) adopted across JobBoard amount
  displays.
- [x] **DONE** JWT revocation via `tv` (token-version) claim — shared
  `middleware/authToken.js` (replaces 12 duplicated auth copies), 60s cached DB check,
  socket auth included, `POST /api/admin/users/:id/revoke-sessions`. Verified: revoked
  token → 401 "Session revoked". Migration `add_token_version`.
- [x] **DONE** External sweep trigger: `POST /api/internal/sweep` (CRON_SECRET-guarded)
  + GH Actions cron every 15 min (also wakes the sleeping free instance). **Owner: set
  `CRON_SECRET` on Render + as a GitHub repo secret** — until then the workflow no-ops
  and the in-process 15-min interval still covers awake time.
- [ ] Consider Render Starter (no cold starts) once there's traffic.
- [ ] Split the 4,761-line `JobBoard.js` monolith (maintenance/chunk-size hazard).
- [x] **DONE** Report-user flow + admin review screen. `POST /users/:id/report`
  (6 reason categories, 5/day limit, one open report per pair), admin queue at `/admin`
  (role-gated): dismiss / dismiss-frivolous (reporter complainerScore +15) / warn /
  flag-suspicious (−1★ FLAGGED) / flag-scammer (+ all sessions revoked), plus
  `clear-flags` redemption (restores stars, shows "redeemed"). Verified end-to-end.
  **Owner: promote your real account with SQL** `update users set role='admin' where email='<you>'`.

---

## Already solid (no action)
Guarded escrow in jobs.js · JWT fail-fast in prod · private vs public storage buckets ·
helmet + rate limiting on auth · JSON 404 fallback · lazy-loaded routes + Suspense ·
root error boundary · chunk-load self-heal · 44px header buttons · labelled inputs ·
no committed secrets (`.env` git-ignored, render `sync:false`) · complete PWA manifest ·
34 automated tests green.
