<p align="center"><img src="dist/vectra-logo.svg" alt="VECTRA Treasury" width="320"></p>

# Treasury, in motion.

Running a treasury should feel calmer than the market around it.

VECTRA is building a non-custodial operations workspace for Solana treasury teams: a place to plan USDC payouts, coordinate approvals, and review treasury movement from intent to settlement. The idea is straightforward: automate the preparation, keep the authority with the people responsible for the funds.

**[Explore the demo](https://vectra-treasury.vxidos119.workers.dev/) · [GitHub Pages](https://netdotx42.github.io/vectra/) · [Brand and market plan](https://vectra-treasury.vxidos119.workers.dev/brand.html) · [Litepaper](docs/LITEPAPER.md)**

## The short version

VECTRA is building the operations layer for Solana treasuries. Plan USDC payouts, coordinate approvals, and explore Solana-only routing in a clear workspace. Our non-custodial approach keeps signing authority with treasury teams. This interactive demo previews the workflow; live wallet, Squads, and MultiHopper integrations are on the roadmap.

*Description above: exactly 344 characters, including spaces and punctuation.*

## Why this is worth building

A payment starts well before someone signs a transaction. Teams need to maintain recipients, plan obligations, chase approvals, check costs, and reconcile what landed. Those steps often spill into spreadsheets and chat threads.

Our thesis: the recurring payment cycle is a useful place to earn a treasury team's trust. Start with scheduled USDC distributions and one reliable Solana routing workflow. Make the handoffs clear, then expand when repeat use supports it.

The potential advantage is operational: less coordination per payment cycle, a clearer view of obligations, and evidence that connects each proposal to its authorization and settlement. That remains a product thesis to validate with operators.

## Take it for a spin

1. Connect Phantom, Solflare, or Backpack on Solana devnet, or use the simulated demo wallet. The demo is labeled and cannot sign.
2. Read devnet SOL and devnet USDC. Those balances have no cash value. Mainnet stays locked.
3. Review a multi-recipient devnet USDC payout. The page simulates it before your wallet asks for a signature.
4. Add a one-time, weekly, or monthly demo schedule. Schedules stay in this browser and do not send.
5. Open Solana routing, estimate a devnet USDC hop route, and sign it in your own wallet when the proxy is running. Hops stay on Solana. They do not make a transfer untraceable. Production routing stays locked.
6. Export a CSV. Devnet rows include the signature and a Solana Explorer link. Demo rows are marked fictional.
7. Open Donate, choose an amount from $1,999 to $100,000, and copy the devnet USDC payment link.

**This repository is a devnet lite client, not a mainnet treasury.** Devnet tokens have no cash value. The static page holds no private key and no custom program. Solana routing calls a Cloudflare Worker that keeps the MultiHopper API key off the page. Without that key the Worker is in mock mode. The public devnet RPC can rate-limit. Proposals, schedules, and payout history live in browser localStorage; no scheduler executes them. Local reviews are not signatures. Squads is not connected. The donation screen does not sign; on devnet it is a test-mode link. Details are in [docs/DEVNET.md](docs/DEVNET.md) and [docs/ROUTING.md](docs/ROUTING.md).

## Donate

**Donate** is in the header and the sidebar. **Support Vectra** is on the overview. Amounts run from $1,999 to $100,000.

The recipient address is `Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR`. The confirm step shows that address with a copy button and a Solana Pay link. While mainnet is locked, the link uses the devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` and is labeled devnet-only test mode. Devnet tokens have no cash value. The dollar bounds are the product limits, not a price for those tokens. The site never signs, never moves funds, and cannot confirm receipt.

If `DONATION_ADDRESS` in `dist/core.js` is empty, or it is not a 32-byte base58 address, the same screen stays in demo mode. You can confirm an amount and see a simulated success note that says no funds moved. The simulated treasury wallet and illustrative balances stay labeled either way.

## What works today and what comes next

| Workflow | This devnet lite build | Still not in this build |
| --- | --- | --- |
| Treasury overview | Devnet SOL and devnet USDC when a wallet is connected. Illustrative charts stay labeled. | Mainnet balances |
| Distributions | Signed devnet USDC payouts: validation, ATA creation, simulation, batching, explorer links | Mainnet sends and scheduled execution |
| Scheduling | Browser-local schedule records | Durable jobs that prepare proposals, with duplicate prevention |
| Approvals | Local proposal review | Squads proposals |
| Routing | Devnet MultiHopper proxy: estimate, sign in your wallet, hop status. Mock fixtures when no API key is set. | Production MultiHopper, which stays locked |
| Records | localStorage signatures, CSV export, devnet Explorer links | Durable audit records |

## Built to preserve control

The intended backend prepares proposals and monitors execution. It must never hold treasury private keys. A schedule records payment intent; execution requires authorized signatures unless the team explicitly approves on-chain delegation with enforceable limits.

Before real funds are supported, the implementation needs authentication, enforceable policies, durable records, idempotent jobs, transaction simulation, and end-to-end security review. MultiHopper production access needs written partner terms. The devnet proxy must not be pointed at `https://multihopper.com/api/v1`. Hop routes are public Solana transfers.

## The business case

VECTRA's first audience is Solana-native teams with recurring USDC obligations: contributor payments, operational funding, and grants. The initial product should complement wallet, multisig, and routing infrastructure while owning the coordination between them.

Workspace subscriptions and routing revenue under agreed partner terms are potential business models. Pricing, demand, and partner economics are unvalidated. Early proof should come from preparation time, approval turnaround, payment errors, settlement outcomes, and repeat payment cycles. Volume alone won't tell us whether the product is useful.

## Run locally

The current app is plain HTML, CSS, and JavaScript. GitHub Pages does not build it. `@solana/web3.js` 1.98.4 is vendored in `dist/vendor/` with a pinned subresource hash. With Python 3 installed:

```bash
git clone https://github.com/netdotx42/vectra.git
cd vectra
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. The interface uses Google Fonts when available and falls back to local fonts. Reset local proposals and schedules from Settings. Payout signatures are cleared separately.

Solana routing also needs the devnet proxy. From the repo root, in another terminal:

```bash
npm run routing:dev
```

That serves mock fixtures at http://127.0.0.1:8787. The page meta tag points there. A real devnet key never belongs in the browser. See [docs/ROUTING.md](docs/ROUTING.md).

GitHub Pages publishes `dist/` from `.github/workflows/pages.yml` on every push to `main`. Links to CSS, scripts, and icons are relative, so the same files load at `https://netdotx42.github.io/vectra/` and at a domain root.

```bash
npm test
```

That runs the Node checks for addresses, amounts, CSV rows, batching, and instruction bytes. It does not need a wallet.

## Project layout

```text
dist/                 Editable static app and brand assets
dist/vendor/          Pinned @solana/web3.js browser build and its license
dist/.nojekyll        Skips Jekyll so Pages serves the files as they are
dist/404.html         Sends unknown Pages paths back to the demo
docs/DEVNET.md        Devnet setup, faucets, and limitations
docs/ROUTING.md       Solana routing proxy, mock mode, and deploy steps
docs/LITEPAPER.md     Product thesis and proposed architecture
DESCRIPTION.txt       Copy-ready 344-character description
wrangler.jsonc        Cloudflare Workers static asset configuration
.github/workflows/pages.yml  Publishes dist/ to GitHub Pages
```

The existing demo is hosted on Cloudflare Workers. To deploy from this source using an authenticated Wrangler installation:

```bash
npx wrangler deploy
```

The configuration targets `vectra-treasury`; select the intended Cloudflare account before deploying. The proposed production stack is Next.js and TypeScript, Solana tooling, PostgreSQL, and a durable job worker. Those components are not implemented in this static prototype.

## Brand

Forest green, mint accents, and a directional V mark. **Plan. Approve. Move.** is the workflow; **Treasury, in motion.** is the promise we aim to earn through reliable execution.

Have experience running a Solana treasury? Feedback on the payment cycle, approval friction, and reconciliation gaps will help shape the next build.
