import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const { Keypair } = require('@solana/web3.js');
const core = require('../dist/core.js');

const payer = Keypair.generate();
const address = payer.publicKey.toBase58();
const publicKey = Array.from(payer.publicKey.toBytes());
const signature = core.base58Encode(Uint8Array.from({ length: 64 }, (_, index) => index + 1));
const donation = core.DONATION_ADDRESS;
const port = 8765;

const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', 'dist'], {
  stdio: 'ignore',
});

const routing = spawn('npx', [
  'wrangler', 'dev',
  '--config', 'workers/multihopper/wrangler.jsonc',
  '--port', '8787',
  '--ip', '127.0.0.1',
  '--inspector-port', '9241',
  '--local',
  '--persist-to', '.wrangler/browser-routing',
  '--show-interactive-dev-session', 'false',
  '--log-level', 'error',
  '--var', 'MOCK_MULTIHOPPER:1',
], {
  env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let routingLog = '';
routing.stdout.on('data', (chunk) => { routingLog += chunk; });
routing.stderr.on('data', (chunk) => { routingLog += chunk; });

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/');
        if (response.ok) {
          resolve();
          return;
        }
      } catch { /* The server is still starting. */ }
      if (Date.now() - started > 8000) reject(new Error('preview server did not start'));
      else setTimeout(tick, 150);
    };
    tick();
  });
}

function waitForRouting() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8787/health');
        if (response.ok) {
          const body = await response.json();
          if (body.mode === 'mock') {
            resolve();
            return;
          }
        }
      } catch { /* Wrangler is still booting. */ }
      if (Date.now() - started > 90000) reject(new Error('routing proxy did not start\n' + routingLog.slice(-1500)));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

const errors = [];
function note(text) {
  const ignored = /fonts\.googleapis|fonts\.gstatic|favicon/i.test(text);
  if (!ignored) errors.push(text);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  await waitForServer();
  await waitForRouting();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (error) => note('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') note('console: ' + message.text());
  });
  await page.evaluateOnNewDocument((walletAddress, walletBytes) => {
    const account = {
      address: walletAddress,
      publicKey: Uint8Array.from(walletBytes),
      chains: ['solana:devnet'],
      features: ['solana:signTransaction'],
    };
    const wallet = {
      name: 'Phantom',
      version: 'test',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      chains: ['solana:devnet'],
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => ({ accounts: [account] }),
        },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: async (input) => [{ signedTransaction: input.transaction }],
        },
      },
      accounts: [account],
    };
    window.addEventListener('wallet-standard:app-ready', (event) => {
      event.detail.register(wallet);
    });
  }, address, publicKey);

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('h1');

  const smoke = await page.evaluate(() => {
    const ix = VectraCore.memoInstruction({ memo: 'hi', signer: '11111111111111111111111111111111' });
    const tx = new solanaWeb3.Transaction();
    tx.feePayer = new solanaWeb3.PublicKey('11111111111111111111111111111111');
    tx.recentBlockhash = '11111111111111111111111111111111';
    tx.add(new solanaWeb3.TransactionInstruction({
      programId: new solanaWeb3.PublicKey(ix.programId),
      keys: ix.keys.map((key) => ({
        pubkey: new solanaWeb3.PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      data: ix.data,
    }));
    const ata = VectraCore.associatedTokenAddress(
      '11111111111111111111111111111111',
      VectraCore.DEVNET_USDC_MINT,
      solanaWeb3,
    );
    return {
      size: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length,
      ata,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    };
  });
  if (smoke.size < 64 || smoke.size > 1232) throw new Error('unexpected transaction size ' + smoke.size);
  if (!/^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(smoke.ata)) throw new Error('ATA did not derive');
  if (!smoke.csp.includes("script-src 'self'") || smoke.csp.includes('unsafe-eval')) throw new Error('CSP missing');

  const heading = await page.$eval('h1', (node) => node.textContent);
  if (!heading.includes('Treasury overview')) throw new Error('overview did not render');

  await page.click('[data-action="network"]');
  await page.waitForSelector('.modal');
  const mainnetDisabled = await page.$eval('.modal button[disabled]', (node) => node.textContent);
  if (!mainnetDisabled.includes('Mainnet') || !mainnetDisabled.includes('Coming soon')) {
    throw new Error('mainnet is not locked: ' + mainnetDisabled);
  }
  await page.click('[data-action="close"]');

  await page.evaluate(() => {
    const visible = [...document.querySelectorAll('[data-action="donate"]')].find((node) => node.getClientRects().length);
    visible.click();
  });
  await page.waitForSelector('#donation-amount');
  await page.type('#donation-amount', '1000');
  await page.click('#donation-form button[type="submit"]');
  const tooSmall = await page.$eval('#donation-error', (node) => node.textContent);
  if (!tooSmall.includes('$1,999')) throw new Error('minimum donation was not enforced: ' + tooSmall);
  await page.click('#donation-amount', { clickCount: 3 });
  await page.type('#donation-amount', '1999');
  await page.click('#donation-form button[type="submit"]');
  await page.waitForSelector('#donation-address');
  const donationText = await page.$eval('.modal', (node) => node.innerText);
  const donationValue = await page.$eval('#donation-address', (node) => node.value);
  if (donationValue !== donation) throw new Error('donation address missing: ' + donationValue);
  if (!donationText.toLowerCase().includes('no cash value')) throw new Error('donation value disclaimer missing');
  const mintValue = await page.$eval('#donation-mint', (node) => node.value);
  const linkValue = await page.$eval('#donation-link', (node) => node.value);
  if (mintValue !== '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') throw new Error('devnet mint missing: ' + mintValue);
  if (!linkValue.includes(mintValue) || !linkValue.includes('cluster=devnet')) throw new Error('solana pay link is not devnet: ' + linkValue);
  if (linkValue.includes('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')) throw new Error('mainnet mint was offered');
  await page.click('[data-action="close"]');

  await page.click('[data-action="connect"]');
  await page.waitForSelector('#wallet-list button');
  const walletNames = await page.$$eval('#wallet-list button', (nodes) => nodes.map((node) => node.textContent));
  if (!walletNames.some((name) => name.includes('Phantom'))) throw new Error('mock Phantom was not listed: ' + walletNames.join('|'));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#wallet-list button')].find((node) => node.textContent.includes('Phantom'));
    button.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('…'), { timeout: 15000 });
  const header = await page.$eval('header', (node) => node.innerText);
  if (header.includes('Demo wallet')) throw new Error('live connect was labeled as the demo');
  if (!header.includes(address.slice(0, 4))) throw new Error('connected address missing from header: ' + header);

  await page.click('[data-action="send"]');
  await page.waitForSelector('#payment-form');
  await page.type('#payment-name', '<img src=x onerror="window.__xss=1">');
  await page.type('.recipient input[aria-label="Recipient wallet address"]', 'not-an-address');
  await page.type('.recipient input[aria-label="Amount in USDC"]', '1.0000001');
  await page.click('#payment-submit');
  const invalid = await page.$eval('#form-error', (node) => node.textContent);
  if (!/address|decimal/i.test(invalid)) throw new Error('validation did not run: ' + invalid);

  await page.evaluate((recipient) => {
    document.querySelector('#payment-name').value = 'Browser test';
    document.querySelector('.recipient input[aria-label="Recipient wallet address"]').value = recipient;
    document.querySelector('.recipient input[aria-label="Amount in USDC"]').value = '1';
    document.querySelector('#form-error').textContent = '';
  }, donation);
  await page.click('#payment-submit');
  await page.waitForFunction(() => {
    const title = document.querySelector('.modal h2')?.textContent || '';
    if (/Review devnet payout/.test(title)) return true;
    const button = document.querySelector('#payment-submit');
    const formError = document.querySelector('#form-error')?.textContent || '';
    return !!(button && !button.disabled && formError);
  }, { timeout: 40000 });
  const outcome = await page.evaluate(() => ({
    form: document.querySelector('#form-error')?.textContent || '',
    title: document.querySelector('.modal h2')?.textContent || '',
    body: document.querySelector('.modal')?.innerText || '',
  }));
  const detail = /Review devnet payout/.test(outcome.title) ? outcome.body : outcome.form;
  if (!/enough devnet USDC|enough devnet SOL|rate-limit|could not be reached|Simulation failed|Network fee/i.test(detail)) {
    throw new Error('unexpected payout result: ' + detail.slice(0, 500));
  }
  if (/Review devnet payout/.test(outcome.title) && !outcome.body.includes(donation)) {
    throw new Error('review omitted the recipient');
  }
  if (await page.evaluate(() => window.__xss)) throw new Error('xss payload executed from the reference');
  console.log('payout detail:', detail.slice(0, 220));
  await page.evaluate(() => document.querySelector('[data-action="close"]')?.click());

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-page="Solana routing"]')].find((node) => node.getClientRects().length);
    if (!button) throw new Error('Solana routing nav was not visible');
    button.click();
  });
  await page.waitForSelector('#routing-root');
  await page.waitForFunction(() => /Mock/.test(document.getElementById('routing-mode-pill')?.textContent || ''), { timeout: 20000 });
  const routingCopy = await page.$eval('#routing-root', (node) => node.innerText);
  if (!/does not make a transfer untraceable/i.test(routingCopy)) throw new Error('routing honesty copy missing');
  if (/cross-chain/i.test(routingCopy)) throw new Error('routing still says cross-chain');
  await page.evaluate((address) => {
    document.querySelector('#route-recipient').value = address;
    document.querySelector('#route-amount').value = '1';
  }, donation);
  await page.click('#route-estimate');
  await page.waitForFunction(() => /50 basis points/.test(document.body.innerText), { timeout: 15000 });
  await page.click('#route-create');
  await page.waitForFunction(() => /Transfer \d+/.test(document.getElementById('routing-status')?.innerText || ''), { timeout: 15000 });
  await page.click('#route-prepare');
  await page.waitForFunction(() => /Transactions are ready/.test(document.body.innerText), { timeout: 15000 });
  const preparedText = await page.$eval('#routing-root', (node) => node.innerText);
  if (!/not_provided|No sanctions screen/i.test(preparedText)) throw new Error('screening result missing');
  await page.waitForSelector('#route-broadcast:not([disabled])');
  await page.click('#route-broadcast');
  await page.waitForFunction(() => {
    const text = document.getElementById('routing-root')?.innerText || '';
    if (/processing/i.test(text)) return true;
    const error = document.getElementById('routing-error')?.textContent || '';
    if (error) throw new Error(error);
    return false;
  }, { timeout: 20000 });
  const transferLabel = await page.$eval('#routing-status', (node) => node.innerText.match(/Transfer \d+/)[0]);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-page="Solana routing"]')].find((node) => node.getClientRects().length);
    button.click();
  });
  await page.waitForFunction((label) => document.body.innerText.includes(label), { timeout: 20000 }, transferLabel);

  await page.click('[data-action="connect"]');
  await page.waitForSelector('[data-action="demo-connect"]');
  await page.click('[data-action="demo-connect"]');
  const demoHeader = await page.$eval('header', (node) => node.innerText);
  if (!demoHeader.includes('Demo wallet')) throw new Error('simulated wallet was not labeled: ' + demoHeader);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-page="Overview"]')].find((node) => node.getClientRects().length);
    button.click();
  });
  await page.waitForFunction(() => /Treasury overview/.test(document.querySelector('h1')?.textContent || ''));
  await page.click('[data-action="send"]');
  await page.waitForSelector('#payment-form');
  await page.type('#payment-name', 'Demo payroll');
  await page.type('.recipient input[aria-label="Recipient wallet address"]', donation);
  await page.type('.recipient input[aria-label="Amount in USDC"]', '2');
  await page.click('#payment-submit');
  await page.waitForFunction(() => document.body.innerText.includes('Demo payroll'), { timeout: 5000 });

  await page.evaluate((storedSignature, storedAddress) => {
    localStorage.setItem('vectra-payouts', JSON.stringify([{
      id: 'stored',
      createdAt: '2026-10-28T00:00:00.000Z',
      network: 'devnet',
      reference: '<img src=x onerror="window.__xss=1">',
      memo: '<script>window.__xss=1</script>',
      totalDisplay: '1',
      batches: [{
        signature: storedSignature,
        status: 'confirmed',
        amountDisplay: '1',
        recipients: [{ address: storedAddress, amount: '1' }],
        explorerUrl: 'javascript:alert(1)',
      }],
    }]));
  }, signature, donation);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('[data-page="Activity log"]');
  await page.waitForSelector('table');
  const activity = await page.$eval('#content', (node) => node.innerHTML);
  if (activity.includes('<img src=x') || activity.includes('<script>')) throw new Error('history HTML was not escaped');
  if (!activity.includes('&lt;img')) throw new Error('escaped history text missing');
  if (activity.includes('javascript:')) throw new Error('stored explorer URL was trusted');
  if (!activity.includes('cluster=devnet')) throw new Error('explorer link missing');
  if (await page.evaluate(() => window.__xss)) throw new Error('history payload executed');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('browser checks passed');
} finally {
  await browser.close();
  server.kill();
  try { process.kill(-routing.pid, 'SIGKILL'); } catch { routing.kill('SIGKILL'); }
}
