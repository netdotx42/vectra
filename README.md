<p align="center"><img src="dist/vectra-logo.svg" alt="VECTRA Treasury" width="320"></p>

# Treasury, in motion.

Running a treasury should feel calmer than the market around it.

VECTRA is building a non-custodial operations workspace for Solana treasury teams: a place to plan USDC payouts, coordinate approvals, and review treasury movement from intent to settlement. The idea is straightforward: automate the preparation, keep the authority with the people responsible for the funds.

**[Explore the demo](https://vectra-treasury.vxidos119.workers.dev/) · [GitHub Pages](https://netdotx42.github.io/vectra/) · [Brand and market plan](https://vectra-treasury.vxidos119.workers.dev/brand.html) · [Litepaper](docs/LITEPAPER.md)**

## The short version

VECTRA is building the operations layer for Solana treasuries. Plan USDC payouts, coordinate approvals, and explore cross-chain routing in a clear workspace. Our non-custodial approach keeps signing authority with treasury teams. This interactive demo previews the workflow; live wallet, Squads, and MultiHopper integrations are on the roadmap.

*Description above: exactly 344 characters, including spaces and punctuation.*

## Why this is worth building

A payment starts well before someone signs a transaction. Teams need to maintain recipients, plan obligations, chase approvals, check costs, and reconcile what landed. Those steps often spill into spreadsheets and chat threads.

Our thesis: the recurring payment cycle is a useful place to earn a treasury team's trust. Start with scheduled USDC distributions and one reliable cross-chain routing workflow. Make the handoffs clear, then expand when repeat use supports it.

The potential advantage is operational: less coordination per payment cycle, a clearer view of obligations, and evidence that connects each proposal to its authorization and settlement. That remains a product thesis to validate with operators.

## Take it for a spin

1. Connect the simulated wallet to explore illustrative balances.
2. Create a USDC payment proposal with multiple recipients.
3. Add a one-time, weekly, or monthly demo schedule.
4. Preview a cross-chain route and save a draft proposal.
5. Review proposals and export a CSV report.
6. Open Donate, choose an amount, and copy the USDC payment link.

**This repository contains an interactive prototype.** Balances, historical transactions, and volume are fictional. Wallet connection is simulated. Proposals and schedules are stored in browser localStorage; no scheduler executes them. Local reviews are not signatures. Route previews are not live MultiHopper quotes or completed transfers. Activity records are not a verifiable on-chain audit trail. The donation screen does not spend that illustrative balance.

## Donate

**Donate** is in the header and the sidebar. **Support Vectra** is on the overview. Amounts run from $1,999 to $100,000.

The recipient address is `Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR`. The confirm step shows that address with a copy button and a Solana Pay link (`solana:…?amount=…&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&label=Vectra`). You send USDC (SPL) on Solana from your own wallet. The site never signs, never moves funds, and cannot confirm receipt.

If `DONATION_ADDRESS` in `dist/app.js` is empty, or it is not a 32–44 character base58 address, the same screen stays in demo mode. You can confirm an amount and see a simulated success note that says no funds moved. Real donations are enabled once a Solana address is configured. The simulated treasury wallet, balances, and proposals stay labeled as a prototype either way.

## What works today and what comes next

| Workflow | Current demo | Planned implementation |
| --- | --- | --- |
| Treasury overview | Illustrative assets, obligations, and activity | Wallet Standard connection and Solana RPC balances |
| Distributions | Multiple recipients and local proposals | Signed Devnet USDC transfers and settlement tracking |
| Scheduling | Browser-local schedule records | Durable jobs that prepare proposals, with duplicate prevention |
| Approvals | Local proposal review | Squads proposals and authorized wallet signatures |
| Routing | Simulated route review | Verified MultiHopper quotes, costs, execution, and status |
| Records | Sample history and CSV export | Durable audit records, signatures, and Explorer links |

## Built to preserve control

The intended backend prepares proposals and monitors execution. It must never hold treasury private keys. A schedule records payment intent; execution requires authorized signatures unless the team explicitly approves on-chain delegation with enforceable limits.

Before real funds are supported, the implementation needs authentication, enforceable policies, durable records, idempotent jobs, transaction simulation, and end-to-end security review. MultiHopper availability, supported routes, fees, and partnership terms must be verified before live routing is promised.

## The business case

VECTRA's first audience is Solana-native teams with recurring USDC obligations: contributor payments, operational funding, and grants. The initial product should complement wallet, multisig, and routing infrastructure while owning the coordination between them.

Workspace subscriptions and routing revenue under agreed partner terms are potential business models. Pricing, demand, and partner economics are unvalidated. Early proof should come from preparation time, approval turnaround, payment errors, settlement outcomes, and repeat payment cycles. Volume alone won't tell us whether the product is useful.

## Run locally

The current app is plain HTML, CSS, and JavaScript. There is no build step or backend dependency. With Python 3 installed:

```bash
git clone https://github.com/netdotx42/vectra.git
cd vectra
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080. The interface uses Google Fonts when available and falls back to local fonts. Reset local proposals and schedules from Settings.

GitHub Pages publishes `dist/` from `.github/workflows/pages.yml` on every push to `main`. Links to CSS, scripts, and icons are relative, so the same files load at `https://netdotx42.github.io/vectra/` and at a domain root.

## Project layout

```text
dist/                 Editable static app and brand assets
dist/.nojekyll        Skips Jekyll so Pages serves the files as they are
dist/404.html         Sends unknown Pages paths back to the demo
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
