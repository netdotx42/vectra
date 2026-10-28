# Solana routing

Vectra can prepare a devnet USDC hop route through MultiHopper. The route stays on Solana. It is not a bridge, and it does not make a transfer untraceable. Every hop is an ordinary Solana transfer that anyone can follow on an explorer. Library wallets, when a network serves them, are public addresses. The hop list is public.

Devnet tokens have no cash value. The production API (`https://multihopper.com/api/v1`) is rejected by the Worker. Mainnet stays locked.

## Architecture

```text
Browser (dist/routing.js)
  Wallet Standard sign, then devnet RPC broadcast
        |
        |  no API key, no private key
        v
Cloudflare Worker  workers/multihopper
  allowlisted routes, validation, CORS, rate limit
  Idempotency-Key generated here and reused for the same action
        |
        |  x-api-key from the Worker secret
        v
https://devnet.multihopper.com/api/v1

MultiHopper webhook
  HMAC SHA-256 in x-multihopper-signature
        |
        v
Durable Object HopperState
  hop status, idempotency records, rate-limit windows
```

The page signs with Phantom, Solflare, or Backpack. The Worker never asks for a seed or a secret key. Broadcast order matches the MultiHopper quickstart:

1. `keeperFundingTx` first. Record `keeperFundingSignature` with `confirm-broadcast` immediately (`routeInitSignatures: []`).
2. `routeInitTxs`, in order, after each one confirms.
3. `orchestratorInitTx`.
4. `sessionInitTxs`.
5. `dispersionInitTxs` when several destinations are paid.
6. `confirm-broadcast` again with the remaining signatures.

A reload stores the transfer id in `localStorage` under `vectra-routing`. Choose Prepare again after a blockhash expires. That click uses a new idempotency key. A dropped response retries the same key.

## Allowlisted API

The browser can call only these paths on the Worker:

| Browser | Upstream |
| --- | --- |
| `POST /v1/transfers/estimate` | `POST /transfers/estimate` |
| `POST /v1/transfers` | `POST /transfers` |
| `POST /v1/transfers/:id/prepare` | `POST /transfers/:id/prepare` |
| `POST /v1/transfers/:id/confirm-broadcast` | `POST /transfers/:id/confirm-broadcast` |
| `GET /v1/transfers/:id` | `GET /transfers/:id` |
| `GET /v1/hop-library` | `GET /hop-library` |
| `GET /health` | none |
| `POST /v1/webhooks/multihopper` | MultiHopper calls this. The browser does not. |

Saved route templates, reward claims, and any other path are not proxied. The token is devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` only.

## Mock and live

| Condition | Mode |
| --- | --- |
| `MOCK_MULTIHOPPER=1` | Mock, even if a key is also present. The key is not sent. |
| No `MULTIHOPPER_API_KEY` | Mock. |
| `mh_test_…` key from the devnet dashboard, and mock is not forced | Live devnet. |
| `mh_live_…` or a base URL other than `https://devnet.multihopper.com/api/v1` | Rejected. |

Mock responses are labeled `"mode": "mock"`. They are fixtures. They are not sanctions decisions and they are not broadcast. The well-known mock webhook secret, used only when no real secret is set and the Worker is in mock mode, is `whsec_mock_vectra_devnet`.

Live devnet does not serve the hop library (`MH_019`). Custom routes on devnet use wallets you enter. The mock library response says that.

## Validation

Checked before a request is forwarded:

- Solana addresses are 32-byte base58.
- Amounts are positive devnet USDC base units, at most 6 decimal places in `amountTokens`.
- One recipient, default route: `hops` 3–10 and `arrivalSeconds` 60–2,592,000.
- One recipient, custom route: 2–9 hops. The recipient is the last on-chain hop.
- Several destinations (2–20): custom routes need 3–10 hops. Shares must add up to `amountRaw`.
- `waitSeconds` is a whole number from 20 to 2,592,000. The waits together stay within 30 days.
- The sender, recipient, and destinations cannot also be hops. Hop wallets cannot repeat.
- A `bundle` hop is rejected on this devnet proxy (`MH_019`).
- `route` cannot be combined with `hops` or `arrivalSeconds`.

MultiHopper can still return `MH_018` for a rule this proxy cannot see, such as an off-curve last hop.

## Idempotency

Every POST mutation requires `X-Vectra-Action` (or `Idempotency-Key`) as a UUID for that click. The Worker generates its own UUID, stores it in the Durable Object, and sends that value as `Idempotency-Key` to MultiHopper. The same action and the same payload replay the stored response (`x-vectra-idempotent: replay`). A different payload returns `MH_071`. A duplicate still in flight returns `MH_072` for 30 seconds, then the same key can be used again.

The browser key is not the upstream key. The API key is not in the response.

## Webhooks

Register the Worker URL `https://<your-worker>/v1/webhooks/multihopper` in the devnet dashboard. MultiHopper signs the raw body with HMAC-SHA256 and sends hex in `x-multihopper-signature` (a `sha256=` prefix is also accepted). The Worker compares it with Web Crypto and stores hop index, signature, time, status, phase, and any screening object in the Durable Object for that transfer id. `GET /v1/transfers/:id` merges those hop updates.

Unknown event types are rejected. A bad signature returns 401 and is not stored. Delivery retries follow MultiHopper's schedule if the Worker does not return 2xx. The flag reason for a screened wallet is not disclosed, and this proxy does not invent one.

## CORS and limits

Origins:

- `https://netdotx42.github.io`
- `http://localhost` and `http://127.0.0.1` with any port
- the same hosts over `https`

Other origins get 403 and no `Access-Control-Allow-Origin` header.

Per client IP, per 60 seconds, matching the published MultiHopper buckets this proxy uses:

| Bucket | Limit |
| --- | --- |
| estimate | 30 |
| create, prepare, confirm | 10 each |
| transfer status | 60 |
| hop library | 30 |
| webhook | 60 |

`MH_004` includes `Retry-After`. The limit uses Cloudflare's `cf-connecting-ip` on the edge.

## Deploy

This Worker deploys only from **Actions → Deploy MultiHopper proxy → Run workflow**, and only if you type `deploy`. A push does not deploy it. The workflow does not deploy the static site and does not touch `main` by itself.

GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — edit access for Workers and Durable Objects on the account you intend.
- `CLOUDFLARE_ACCOUNT_ID` — the account that should own `vectra-multihopper`.

Worker secrets, set once in that account. Do not put them in git, in GitHub variables that print in logs, or in the browser:

```bash
cd workers/multihopper
npx wrangler secret put MULTIHOPPER_API_KEY
npx wrangler secret put MULTIHOPPER_WEBHOOK_SECRET
```

The API key must be an `mh_test_…` key created in the [devnet dashboard](https://devnet.multihopper.com/developer/dashboard). A key from the production dashboard will not work on devnet, and an `mh_live_…` key is refused.

After the first deploy, set the page to call the Worker:

1. Put the Worker origin in the `vectra-routing-proxy` meta tag in `dist/index.html`.
2. Add that exact `https` origin to `connect-src` in the same file.
3. GitHub Pages is `https`, so the Worker URL must be `https` too.

Local mock mode does not need a key:

```bash
npm run routing:dev
python3 -m http.server 8080 --directory dist
```

Open http://127.0.0.1:8080. The header pill should say **Mock**.

To try live devnet locally, copy `workers/multihopper/.dev.vars.example` to `.dev.vars`, set `MOCK_MULTIHOPPER=0` and the devnet key, and run `npx wrangler dev --config workers/multihopper/wrangler.jsonc --port 8787 --ip 127.0.0.1 --local`. `.dev.vars` is gitignored.

## Compliance

On mainnet, MultiHopper screens the sender and the route before funds move. The fee is quoted as `sol.breakdown.screeningFeeLamports`. It is not refunded, including when a wallet is flagged. A flagged route ends as `refunded`: principal comes back, the fee stays, and the reason is not disclosed. The keeper does the screen. This app does not offer a way around it.

Devnet may or may not screen. The UI shows a per-hop screening object only when a response includes one. Mock text that says `not_provided` is a fixture, not a clearance.

There is no user login on the Worker. CORS and rate limits are the current gates. Anyone who can call the Worker can spend API quota. They still cannot move funds without a wallet signature.

## Before mainnet

Do not point this Worker at production, and do not ship an `mh_live_` key, until all of these exist:

- Written partner terms with MultiHopper, including fees, the integrator share, support, and prohibited use.
- A decision to unlock mainnet in the product, separate from this devnet branch.
- Authentication in front of the proxy, so quota is not anonymous.
- A review of the signing flow, webhook secret storage, and CSP allowlist.
- Budget for the screening fee and for devnet-versus-mainnet behavior, read from `/estimate` rather than hard-coded.
- A registered production webhook, only after the host above is allowed by an explicit code change. That change is not in this branch.

## What this branch does not do

- It does not schedule payouts. That work is separate. This branch does not change a scheduler.
- It does not hold treasury keys or sign on the user's behalf.
- It does not claim a transfer is private or untraceable.
- It was not run against a live MultiHopper key. No key was available in this environment.
