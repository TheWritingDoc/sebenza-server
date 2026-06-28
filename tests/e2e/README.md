# Sebenza E2E Tests

## Prerequisites

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Run

```bash
# Against the live Render deployment
BASE_URL=https://sebenza-server.onrender.com node tests/e2e/sebenza-e2e.js

# Against local dev server
BASE_URL=http://localhost:3000 node tests/e2e/sebenza-e2e.js

# With visible browser (not headless)
HEADLESS=false SLOWMO=500 BASE_URL=https://sebenza-server.onrender.com node tests/e2e/sebenza-e2e.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Server URL |
| `HEADLESS` | `true` | Run browser headlessly |
| `SLOWMO` | `0` | Slow down actions by N ms |
| `ACTION_TIMEOUT` | `15000` | Max wait for UI actions |

## What it tests

1. **Register** poster and helper accounts (via UI)
2. **Login** poster (via UI)
3. **Post a job** end-to-end (via UI)
4. **Helper applies** to the job (via UI)
5. **Poster approves** the helper (via UI)
6. **Helper confirms** the approval — the previously-stuck step

The regression check is step 6: before the fix, `job.myApplication` was never
sent by the API, so the helper never saw a **Confirm** button and the poster
sat forever on "Waiting for applicant confirmation".

## Screenshots

Saved to `tests/e2e/screenshots/` (gitignored).
