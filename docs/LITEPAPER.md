# VECTRA Treasury

Treasury, in motion.  
Litepaper · Working draft v0.1

VECTRA is building a non-custodial treasury operations workspace for Solana-native organizations. Its initial focus is practical: plan USDC distributions, coordinate approvals, fund operational wallets, and review devnet USDC payouts. It does not take custody of funds.

The principle is simple: **automate preparation while preserving control over execution.**

## The problem

Moving tokens is only one part of running a treasury. Teams must also maintain recipient lists, coordinate signers, track upcoming obligations, understand transfer costs, and reconcile completed payments.

When these tasks sit across wallets, spreadsheets, messaging channels, and routing tools, the coordination burden grows with every payment cycle.

VECTRA's thesis is that treasury software should organize the entire operational workflow, from payment intent to settlement evidence.

## The product

The proposed MVP connects four functions:

- **Treasury visibility:** balances, available funds, scheduled obligations, and transaction history.
- **USDC distributions:** one-time and recurring payment proposals for multiple recipients.
- **Approval coordination:** clear proposal states and authorized wallet-controlled execution, with Squads integration planned.
- **Routing:** not in this build. A later devnet route would stay on Solana, show costs before signing, and leave the key in the operator's wallet.

Each movement should answer four questions: **What is being sent? Who authorized it? What did it cost? Did it settle?**

## Automation without surrendering authority

A schedule records an intention to pay; it should not silently become permission to spend.

VECTRA's backend is intended to prepare proposals, notify operators, and monitor transactions. Treasury private keys remain under user control. Execution requires authorized signatures unless an organization explicitly approves on-chain delegation with enforceable limits.

Recurring workflows must also handle missed approvals, insufficient balances, failed transactions, and duplicate execution. Reliable automation depends as much on these exceptions as on the successful path.

## Market focus

VECTRA's proposed entry point is a specific recurring job: helping a Solana treasury team complete its USDC payment cycle with less manual coordination.

The product aims to complement established wallet, multisig, and routing infrastructure. Its differentiation must come from workflow clarity and reliable execution, not simply placing more features on one dashboard.

The initial priority is therefore narrow: **scheduled USDC distributions and one verified routing workflow.**

## Business model and validation

Potential revenue sources include workspace subscriptions and routing revenue under agreed partnership terms. Pricing, partner economics, and customer demand remain to be validated.

Early success should be measured through proposal preparation time, approval turnaround, payment errors, settlement outcomes, and repeat use. Treasury volume alone does not demonstrate product value.

## Current status and next milestones

VECTRA Lite can connect Phantom, Solflare, or Backpack, read devnet SOL and devnet USDC, and ask that wallet to sign a simulated-then-sent USDC payout. Mainnet is locked. Schedules, Squads approvals, and MultiHopper routing are still local previews. Devnet tokens have no cash value. See `docs/DEVNET.md`.

The next milestones are durable scheduling and audit records, an approval-to-settlement workflow, and a verified devnet route that stays on Solana.

**VECTRA's ambition is to make treasury movement easier to coordinate, authorize, and verify, while keeping authority with the team responsible for the funds.**
