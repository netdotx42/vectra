# Vectra Lite on Solana devnet

Vectra Lite is a static page. It connects a wallet, reads devnet balances, and asks that wallet to sign USDC transfers. There is no backend, no custodial key, and no custom on-chain program.

Devnet tokens have no cash value. Mainnet is locked.

## What you need

- A current desktop browser.
- Phantom, Solflare, or Backpack, with the wallet network set to **Devnet**.
- Devnet SOL for fees and for any new token-account rent.
- Devnet USDC for the mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals).

The page loads `@solana/web3.js` 1.98.4 from `dist/vendor/`. The hash is in `dist/vendor/INTEGRITY.txt` and on the script tag. Wallet discovery uses the Wallet Standard events directly. No other chain library is loaded.

## Run it

GitHub Pages serves `dist/` at <https://netdotx42.github.io/vectra/>.

Locally, from the repo root:

```bash
python3 -m http.server 8080 --directory dist
```

Open <http://localhost:8080>. Wallets inject on localhost and on HTTPS. A plain `file://` page will not connect a wallet.

Node tests cover address checks, 6-decimal amounts, CSV export, batching, and the SPL instruction bytes:

```bash
npm test
```

`npm run test:browser` drives the page in headless Chrome with a mock wallet. It does not sign a funded devnet transaction.

## RPC

Balances, simulation, and sending use one endpoint:

`https://api.devnet.solana.com`

That address is a constant in `dist/core.js`. The page does not call mainnet. The public endpoint rate-limits. When it does, the screen says so and waits for you to retry. It does not hammer the endpoint in a loop.

## Get test SOL and test USDC

1. Switch the wallet to Devnet.
2. Request SOL from <https://faucet.solana.com/>. You need enough for the signature fee (typically 0.000005 SOL per transaction) plus rent for each new recipient token account (about 0.002 SOL).
3. Request devnet USDC from <https://faucet.circle.com/> to the same wallet. The mint must be `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

The assets page shows both faucets. A zero USDC balance is normal until the Circle faucet lands.

## Send a payout

1. Choose **Connect wallet** and pick Phantom, Solflare, or Backpack. **Use simulated demo wallet** stays available. It is labeled as a demo and cannot sign.
2. Confirm the header says **Solana Devnet**. The network dialog lists Mainnet as **Coming soon** and does not select it.
3. Open **Send USDC**. Add up to 20 recipient addresses and amounts. Amounts allow at most 6 decimal places. Duplicate addresses and program ids are rejected. An optional memo is capped at 280 characters.
4. Choose **Review devnet payout**. The page checks the devnet USDC balance, finds missing associated token accounts, builds one or more transactions, and simulates each one. Your wallet is not asked to sign if simulation fails.
5. The review lists recipients, the total, the network fee, and ATA rent for accounts that do not exist yet. Creating an account uses the idempotent associated-token instruction, so a retry is safe if the account appeared in between.
6. Choose **Sign and send**. Approve each transaction in the wallet. The page refreshes the blockhash, simulates again, then signs. It confirms at `confirmed` and links to Solana Explorer with `cluster=devnet`.
7. Signatures are stored in `localStorage` under `vectra-payouts`. **Export CSV** includes the signature and the explorer URL. Demo rows are in the same file and are marked `Fictional demo data`.

Payouts that do not fit in Solana's 1232-byte packet, or that would pass four recipients, are split. Each batch has its own signature. A memo is included on each batch. If a later batch fails, earlier signatures stay in the history so you can see what landed.

## Donations

**Donate** still accepts $1,999 to $100,000 and shows `Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR`. On this build the Solana Pay link uses the **devnet** USDC mint and is labeled test mode. The dollar bounds are product limits. They are not a claim that devnet tokens are worth that many dollars. The site does not sign the donation and cannot see whether it arrived. Mainnet USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) is not used while mainnet is locked.

## Errors you can hit

| What happened | What the page says |
| --- | --- |
| You rejected the wallet prompt | Nothing was sent. |
| Not enough devnet SOL | Use the Solana faucet. The message states the SOL has no cash value. |
| Not enough devnet USDC | Use the Circle faucet. The wallet is not asked to sign. |
| Simulation failed | The wallet is not asked to sign. Check addresses and balances. |
| Blockhash expired while the prompt was open | Review the payout and try again. Earlier batches that already confirmed stay in history. |
| RPC HTTP 429 | Wait and retry. |
| RPC unreachable | Check the connection. Demo mode still works. |

## Known limitations

- Mainnet sends, mainnet balances, and mainnet donations are not implemented.
- One connected wallet signs. Squads and other multisig policies are not connected. The approvals screen is still a local demo.
- Schedules are stored in this browser and never fire.
- Solana routing is a devnet MultiHopper proxy. It is not a bridge and it does not make a transfer untraceable. Without an API key the Worker answers with mock fixtures. Production `https://multihopper.com/api/v1` stays locked. See `docs/ROUTING.md`.
- History is `localStorage` on one browser, capped at 100 payouts. Clearing it does not cancel a transaction.
- The public devnet RPC can be slow, stale, or rate-limited. There is no private RPC and no API key.
- Only Phantom, Solflare, and Backpack are offered. The wallet must be willing to sign `solana:devnet`.
- Token-2022, address lookup tables, and priority fees are not used.
- A batch holds at most four recipients so the compute budget (400,000 units) and packet size stay comfortable. A 280-character memo is included in that size check.
- Donation confirmation is a copied address and Solana Pay link, not an in-app transfer.
- This page cannot prove that a counterparty received funds beyond the explorer link for the signature you signed.
- The Content-Security-Policy is a meta tag. `frame-ancestors` is not included because browsers ignore that directive in a meta tag and log an error. Script execution stays limited to same-origin files, with no `unsafe-eval`.
