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
- [ ] **⚠️ REQUIRED — set provider creds in Render before launch:** `TWILIO_SID/TOKEN/PHONE`
  (real SMS) + `EMAIL_HOST/USER/PASS` + `EMAIL_FROM` (real mail). **Because of the OTP
  gate above, phone signup and email verification now return 503 in production until
  these are set.** Email+password login still works. Confirm `JWT_SECRET` is strong,
  `NODE_ENV=production`, `CORS_ORIGINS` locked to real origins.

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
- [ ] **Upload content-sniffing.** Filter is mimetype/extension only (upload.js);
  re-encode via `sharp` (already a dep) before storing to the public bucket. *(Deferred:
  lower risk — images go to a public read-only bucket, not executed.)*
- [ ] **Error tracking + structured logging (owner: needs a Sentry account).** Add
  Sentry (free) + pino/morgan with request IDs — prod 500s are otherwise invisible.
- [ ] **Prisma migrations baseline.** Only `schema.prisma` exists (schema applied via MCP
  SQL) → drift risk. `prisma migrate diff` to baseline, adopt `prisma migrate deploy`.
- [ ] **Backups (owner: plan decision).** Supabase free tier has limited backup/no PITR —
  schedule `pg_dump` (GH Action/Render cron) or upgrade the plan.

## P1 — Client / mobile

- [ ] **Capacitor loads a remote URL** (`capacitor.config.json:6` → Render). Cold start =
  long white splash; offline = blank; Play policy gray area ("webview of a website").
  **Fix:** ship the local `build/` bundle in `webDir`; point only API calls at the server.
- [ ] **Remove ngrok fetch/XHR monkey-patch** (client index.js:12-31) — adds
  `ngrok-skip-browser-warning` to *every* request incl. third-party → needless CORS
  preflights. Dev residue.
- [ ] **Bundle Leaflet + qrcodejs** instead of CDN loads (TeamManager.js:16, MapView) —
  they're not in the Capacitor `allowNavigation` allowlist, so they break in the native
  shell / offline. `qrcode` is already an npm dep.
- [ ] **Real SW or accept no-PWA.** Client index.js:35 unregisters all SWs + nukes caches
  every load → no offline, re-downloads bundle on metered data each visit. Ship a
  network-first-html / cache-first-hashed-assets SW, or drop the PWA claim.

## P1 — CI / process

- [x] **DONE (79dd54f)** GitHub Actions CI (`.github/workflows/ci.yml`) runs all test
  suites + a client build on every push/PR to main.
- [ ] **Build client in Render** (`buildCommand`) or CI-verify `build/` matches `src/` —
  committed `client/build` can silently drift from source.

---

## P2 — Fast-follow (polish, not blocking)

- [ ] Remove dev-only error copy shown to users: "use localhost:3001…" (JobBoard.js:953,
  1024) and "Jason will patch it" (client index.js:209).
- [ ] Replace `alert()` calls with the existing toast (JobBoard.js ×3, PostJobModal.js).
- [ ] Purge remaining `gshop`/`Ge-Shop` residue + `console.log` noise (12 in JobBoard.js).
- [ ] iOS `apple-touch-icon` is an SVG (index.html:15) → iOS ignores it; add a 192px PNG;
  add a maskable PNG to the manifest.
- [ ] Self-host Inter font (render-blocking Google Fonts, fails offline/native).
- [ ] Shared `formatRand()` helper (thousands separators; currently ad-hoc `R{amount}`).
- [ ] 30-day JWT with no revocation — consider shorter TTL + refresh, or a token-version
  claim so locked/removed users lose access before expiry.
- [ ] Move `sweepExpiredJobs` off in-process cron (misses while free instance sleeps;
  double-notifies if scaled >1 instance) → Supabase scheduled function / Render cron.
- [ ] Consider Render Starter (no cold starts) once there's traffic.
- [ ] Split the 4,761-line `JobBoard.js` monolith (maintenance/chunk-size hazard).
- [ ] Report-user flow + admin review screen to actually set the scam/complaint flags the
  community-star engine reads (currently only dispute tracking feeds them).

---

## Already solid (no action)
Guarded escrow in jobs.js · JWT fail-fast in prod · private vs public storage buckets ·
helmet + rate limiting on auth · JSON 404 fallback · lazy-loaded routes + Suspense ·
root error boundary · chunk-load self-heal · 44px header buttons · labelled inputs ·
no committed secrets (`.env` git-ignored, render `sync:false`) · complete PWA manifest ·
34 automated tests green.
