# Sebenza — Production Launch Checklist

Compiled 2026-07-09 from a 3-track audit (backend security, client/UX, infra/ops)
plus direct code verification. Items are ordered by launch risk.

Legend: **P0** = do not launch without · **P1** = before real money / any scale ·
**P2** = fast-follow after launch.

---

## P0 — Launch blockers (security & correctness)

- [ ] **OTP/verification codes are returned in API responses.** `/api/phone/start`
  (index.js:424), `routes/sms.js:88`, `routes/users.js` email-code, `utils/email.js:64/70`
  all return `code` when provider creds are missing — gated on `!TWILIO_SID`, **NOT**
  on `NODE_ENV`. Anyone can request a code for any number/email and read it → full
  account takeover. **Fix:** gate every `demo/code` return behind
  `NODE_ENV !== 'production'`, and refuse to boot in prod without SMS + mail creds.
  (Also set the real Twilio + SMTP env vars — see P0 "Env".)
- [ ] **Public profile leaks wallet + exact location.** `GET /api/users/:id` (index.js:528,
  no auth) returns `randBalance`, `escrowRand`, `credits`, `totalEarnedRand`, `flags`,
  `referralCode`, `paidProfileViews`, and **exact** lat/lng. **Fix:** whitelist public
  fields only; coarsen location to ~1km (as `/nearby` already does).
- [ ] **Double-refund race in legacy transactions flow.** `POST /transactions/cancel/:id`
  (transactions.js:562) reads then credits `randBalance` with no `escrowStatus:'held'`
  guard → two concurrent cancels refund twice, minting rand. **Fix:** route through the
  guarded `refundEscrow()` in utils/escrow.js.
- [ ] **Double-pay race in legacy complete flow.** `POST /transactions/complete/:id`
  (transactions.js:291) hand-rolls the release with no atomic guard. **Fix:** route
  through guarded `releaseEscrow()`.
- [ ] **TOCTOU overdraw in `/transactions/request` and `/accept-quote`.** Balance check
  then separate decrement (transactions.js:72, 219) → concurrent requests drive
  `randBalance` negative. **Fix:** atomic `updateMany({where:{randBalance:{gte:amount}}})`,
  branch on `count`.
  > Note: the newer `jobs.js` escrow paths are already guarded and safe. All four money
  > bugs are in the older `routes/transactions.js` service-request flow. If that flow is
  > not used at launch, disabling its routes is an acceptable interim fix.
- [ ] **Socket `join_chat` + `send_message` have no membership check.** (index.js:785, 789)
  Any authed user joins any transaction's chat room and injects messages to any
  `receiverId`. **Fix:** verify the socket user is a party to the transaction; derive
  `receiverId` server-side.
- [ ] **Revoke the test admin.** `poster.sebenza.test1@example.com` currently has
  `role='admin'` in the prod DB (set during a KYC-approval test). **Fix:** `UPDATE users
  SET role='client' WHERE email='poster.sebenza.test1@example.com';` and remove all seed
  test accounts from prod.
- [ ] **Client: global 401 handler.** No axios interceptor exists (0 matches for `401`
  in src); an expired 30-day JWT silently breaks screens while the user still "looks"
  logged in. **Fix:** one axios response interceptor that clears storage → `/login` on 401.
- [ ] **Client: crash on boot from bad localStorage.** `App.js:96` and `Chat.js:17`
  `JSON.parse(storedUser)` with no try/catch → corrupt storage white-screens the app
  every launch. **Fix:** wrap in try/catch, clear the key on failure.
- [ ] **Env / secrets set in Render (prod):** `TWILIO_SID/TOKEN/PHONE` (real SMS),
  `EMAIL_HOST/USER/PASS` + `EMAIL_FROM` (real mail), confirm `JWT_SECRET` is a strong
  random value, `NODE_ENV=production`, `CORS_ORIGINS` locked to real origins.
- [ ] **`npm audit fix`** — 5 high (ws DoS via socket.io-adapter). Re-run to confirm 0 high.

## P0 — Legal / store (cannot ship without)

- [ ] **Privacy policy + terms** hosted at a public URL. The app collects **ID documents,
  selfies, and location** → POPIA (SA) + Play Data Safety both require it.
- [ ] **Consent capture at registration** — checkbox + stored `termsAcceptedAt`. Neither
  Register.js nor `POST /register` records consent today.
- [ ] **Play Store target SDK 35.** `client/android/variables.gradle:4` is 34; Google
  rejects new submissions below 35 (since Aug 2025). Also bump `versionCode`/`versionName`.

---

## P1 — Before real money / any real traffic

- [ ] **Graceful shutdown.** No SIGTERM handler → every Render deploy kills in-flight
  requests/DB writes. Add `SIGTERM` → `httpServer.close()` + `io.close()` +
  `prisma.$disconnect()`.
- [ ] **Process safety nets.** Add `unhandledRejection` / `uncaughtException` handlers
  (log + clean exit so Render restarts).
- [ ] **KYC signed-URL lifetime.** ID/selfie URLs are signed for **1 year** and persisted
  (upload.js:110). Store the object *path*; mint short-lived (minutes) signed URLs per
  authenticated read (verification.js).
- [ ] **Enable a restrictive CSP** (helmet CSP is `false`, index.js:57). JWT is in
  localStorage → any stored-XSS = token theft.
- [ ] **Upload content-sniffing.** Filter is mimetype/extension only (upload.js:54);
  re-encode via `sharp` (already a dep; `middleware/processImages.js` exists but is
  unwired) before storing to the public bucket.
- [ ] **Per-phone-number SMS limiter + captcha** on `/api/phone/start` (currently
  10/IP/15min, and it auto-creates accounts) → SMS-cost abuse + account spam.
- [ ] **Rate-limit** `trust-docs`, `apply`, `endorse`, `work-experience`, `send-email-code`.
- [ ] **Strip `issueReports` + `workProofPhotos` for non-parties** in `GET /jobs/:id`
  (jobs.js `toPublicJob`) — geo-tagged photos + reporter notes currently public.
- [ ] **Validate `PUT /users/location`** lat/lng bounds (index.js:597, currently unbounded).
- [ ] **Error tracking + structured logging.** Add Sentry (free) + pino/morgan with request
  IDs — prod 500s are otherwise invisible.
- [ ] **Cheap health check.** `/api/health` runs 3 COUNT queries per hit (index.js:612);
  make it `SELECT 1`, move stats to a separate admin route.
- [ ] **Prisma migrations baseline.** Only `schema.prisma` exists (schema applied via MCP
  SQL) → drift risk. `prisma migrate diff` to baseline, adopt `prisma migrate deploy`.
- [ ] **Backups.** Supabase free tier has limited backup/no PITR — schedule `pg_dump`
  (GH Action/Render cron) or upgrade the plan. KYC + transaction data has no restore story.
- [ ] **Guard `scripts/seed.js`** with `NODE_ENV !== 'production'` (creates known-password
  accounts against whatever DATABASE_URL is set).
- [ ] **Fix `.env.example`** — still lists MongoDB/Cloudinary; missing DATABASE_URL,
  DIRECT_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGINS.

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

- [ ] **CI on push to main** — `main` auto-deploys via render.yaml but nothing runs the
  tests first. Add a GitHub Action: `npm test` + client build check.
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
