# Scheduled devnet payouts

Vectra can prepare a USDC payout on a schedule. The Cloudflare Worker stores the plan and, when it is due, a run record. It does not hold a treasury key, and it does not send a transaction. The browser rebuilds the unsigned batch with the existing devnet payout builder, simulates it, and asks the connected wallet to sign.

Devnet tokens have no cash value. Mainnet is locked.

Leave `SCHEDULER_API_URL` empty in `dist/scheduler-config.js` and the Distributions page stays a **local-only fallback**: those rows live in `localStorage` and never fire.

## Architecture

```text
dist/scheduler-config.js    SCHEDULER_API_URL origin, or empty
dist/schedule.js            Sign-in, schedules, due runs, wallet signing
dist/schedule.css           Run and inbox layout
workers/scheduler/          Worker + Durable Objects
```

One `WalletScheduler` Durable Object is addressed by wallet (`idFromName(wallet)`). It stores that wallet's schedules, runs, inbox, and audit log in SQLite. A `SchedulerDirectory` Durable Object only remembers which wallets have an upcoming alarm so the cron trigger can catch up. Schedule rows are not copied into the directory.

A cron trigger runs every minute. Each wallet object also sets a Durable Object alarm for the next due time or the grace deadline, whichever is sooner. Both paths call the same `prepareDue` function.

### Run identity

A run id is the first 32 hex characters of SHA-256 over `scheduleId + "\n" + dueAt`. `dueAt` is a UTC ISO timestamp. Preparing the same schedule and due time again returns the existing run.

### States

```text
prepared -> awaiting_signature -> signed
                               -> sent
                               -> skipped
                               -> expired
signed -> sent
```

`prepared` is recorded in the audit log in the same step that moves a fresh run to `awaiting_signature` or `expired`. The Worker never moves a run to `sent` by itself.

### Catch-up

If the Worker was down, the next alarm or cron walks missed due times, at most 24 per pass.

- Still inside the grace period: one `awaiting_signature` run, plus an inbox notice and an optional webhook.
- Past the grace period: one `expired` run. Nothing is sent.

The default grace period is 24 hours (`GRACE_PERIOD_MS` in `workers/scheduler/wrangler.jsonc`). The allowed range is 1 second to 7 days so a mis-set value cannot be zero. Use 24 hours unless you have a reason not to.

Pausing a schedule does not backfill the gap. Resume computes the next future slot and writes an audit note. Deleting a schedule stops future runs. A run that is already waiting can still be signed or skipped, and it expires if the grace period ends.

### Time zones

Each schedule stores an IANA timezone plus the local hour and minute (and weekday, day of month, or a calendar date). Due times are stored in UTC.

- Weekly and monthly repeats use that wall clock, so a New York Sunday 01:30 stays 01:30 after a daylight-saving change. The UTC gap between those weeks is 167 or 169 hours, not always 168.
- A local time that does not exist on a spring-forward day (02:30 in America/New_York) is prepared at the next valid minute (03:00).
- A repeated local time on a fall-back day uses the first occurrence.
- Monthly day 31 is clamped to the last day of shorter months. `last` always means the last day. February 29 is used in leap years.

### Auth

`POST /v1/auth/nonce` stores a single-use challenge on that wallet's object. The wallet signs this exact message with Wallet Standard `solana:signMessage` (ed25519 over the raw bytes):

```text
Vectra Scheduler
Sign in to prepare devnet payouts.
This does not authorize a transfer.

Wallet: <address>
Nonce: <uuid>
Issued at: <iso>
Expires at: <iso>
```

`POST /v1/auth/verify` checks the signature with WebCrypto Ed25519 and returns an HMAC token. The token lasts 15 minutes. It is kept in `sessionStorage` only. Every later request is routed to `idFromName` of the token's wallet, and the object rejects a different wallet. No treasury key is accepted or stored.

`TOKEN_SECRET` is a Worker secret. It is not in the frontend, `wrangler.jsonc`, or git.

### Notifications

The in-app inbox is a list on the wallet object. The bell opens it when the scheduler URL is set. There is no email.

An optional https webhook receives one JSON POST when a run becomes `awaiting_signature`. Redirects are not followed. IP addresses, localhost, and URLs with a username or password are rejected. A failed webhook does not change the run into `sent`.

### API

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/v1/health` | no |
| POST | `/v1/auth/nonce` | no |
| POST | `/v1/auth/verify` | no |
| GET, POST | `/v1/schedules` | yes |
| POST | `/v1/schedules/:id/pause` and `/resume` | yes |
| DELETE | `/v1/schedules/:id` | yes |
| GET | `/v1/runs` and `/v1/runs/:id` | yes |
| POST | `/v1/runs/:id/signature` | yes |
| POST | `/v1/runs/:id/skip` | yes |
| GET | `/v1/inbox` | yes |
| POST | `/v1/inbox/:id/read` | yes |
| GET | `/v1/audit` | yes |

CORS allows `https://netdotx42.github.io` and `http://localhost` or `http://127.0.0.1` on any port. Other origins get 403 with no allow-origin header.

Limits, per wallet object unless noted:

| Limit | Value |
| --- | --- |
| Schedules | 50 not deleted |
| Recipients | 20, unique, not a program id |
| Memo | 280 characters |
| Name | 70 characters |
| Body | 12,000 bytes |
| Sign-in challenges | 8 per wallet and 30 per IP each 10 minutes |
| Writes | 30 per minute |
| Reads | 120 per minute |
| Inbox kept | 100 |
| Audit kept | 1,000 |
| Catch-up per pass | 24 due times |
| Cron fan-out | 40 wallets per minute |

Amounts use at most 6 decimal places, matching devnet USDC. The only network value is `devnet`.

## What the browser does

When `SCHEDULER_API_URL` is an `https` origin (or `http://127.0.0.1` / `http://localhost` for Wrangler), Distributions lists remote schedules and due runs.

Review loads recipients and the memo into `VectraChain.preparePayout`, which simulates on `https://api.devnet.solana.com`. If simulation fails, the wallet is not asked to sign. After each batch is signed and submitted, the page POSTs the signature and `signed` or `sent`. The Worker records that report. It does not look at the chain itself.

Add the Worker origin to `connect-src` in `dist/index.html` before the page can call it. Local Wrangler on port 8787 is already listed. The pages origin is not.

## Deploy

From `workers/scheduler`, with Wrangler 4:

```bash
npm install
cp .dev.vars.example .dev.vars
# Put a random 32+ character TOKEN_SECRET in .dev.vars. Do not commit that file.
npx wrangler dev --port 8787 --ip 127.0.0.1 --test-scheduled
```

Trigger the cron handler locally:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"
```

Production:

```bash
npx wrangler secret put TOKEN_SECRET
npx wrangler deploy
```

`TOKEN_SECRET` must be at least 32 characters. `GRACE_PERIOD_MS` is a plain var, not a secret. The Worker name in config is `vectra-scheduler`.

GitHub Actions does not deploy on push. Run the **Deploy scheduler** workflow by hand (`.github/workflows/deploy-scheduler.yml`). Repository secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with Workers Scripts edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Account id Wrangler uses with an API token |

The token should be allowed to deploy Workers and Durable Objects for that account. Do not put the token in the repo or the frontend.

After deploy:

1. Set `globalThis.SCHEDULER_API_URL` in `dist/scheduler-config.js` to the `https://….workers.dev` origin (or a custom domain).
2. Add that origin to `connect-src` in `dist/index.html`.
3. Publish `dist/` the way this repo already publishes GitHub Pages. The scheduler workflow does not publish the static site.

## Tests

```bash
npm test
```

That includes schedule maths (DST and month-end), deterministic run ids, grace expiry, the run state machine, ed25519 login, token tampering, and CORS.

`node tests/scheduler-dev.mjs` boots `wrangler dev` and checks nonce, verify, a due run, idempotent cron, signature recording, and origin rejection.

`node tests/scheduler-browser.mjs` loads the page in headless Chrome with a mock Wallet Standard wallet, signs in, saves a one-time schedule, rebuilds the payout against a mocked devnet RPC, and records the signature.

## What this does not do

- It does not send USDC without a signature from the owner's wallet.
- It does not support mainnet, Squads, or email.
- It does not prove a webhook endpoint is safe beyond the URL checks above.
- A recorded `sent` status is the browser's report after submit. Confirm the explorer link before paying again.
