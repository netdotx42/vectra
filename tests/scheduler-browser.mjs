import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { base58Encode } from '../workers/scheduler/src/codec.js';

const require = createRequire(import.meta.url);
const core = require('../dist/core.js');
const DONATION = core.DONATION_ADDRESS;
const { publicKey: loginPublic, privateKey: loginPrivate } = generateKeyPairSync('ed25519');
const loginSpki = loginPublic.export({ format: 'der', type: 'spki' });
const keys = { publicKey: new Uint8Array(loginSpki.subarray(loginSpki.length - 32)) };
const wallet = base58Encode(keys.publicKey);
const publicKey = Array.from(keys.publicKey);
const txSignature = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => index + 3));
const pagePort = 8766;
const workerPort = 8787;

function tokenAccount(amount) {
  const data = Buffer.alloc(165);
  Buffer.from(core.base58Decode(core.DEVNET_USDC_MINT)).copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 64);
  return data.toString('base64');
}
const richAccount = tokenAccount(50_000000n);

function rpcResult(method, params) {
  if (method === 'getBalance') return { value: 2_000_000_000 };
  if (method === 'getMultipleAccounts') {
    const count = Array.isArray(params?.[0]) ? params[0].length : 1;
    return { value: Array.from({ length: count }, () => ({
      data: [richAccount, 'base64'],
      owner: core.TOKEN_PROGRAM_ID,
      executable: false,
      lamports: 2_000_000,
    })) };
  }
  if (method === 'getLatestBlockhash') {
    return { value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9_999_999 } };
  }
  if (method === 'getMinimumBalanceForRentExemption') return 890880;
  if (method === 'getFeeForMessage') return { value: 5000 };
  if (method === 'simulateTransaction') return { value: { err: null, logs: [] } };
  if (method === 'sendTransaction') return txSignature;
  if (method === 'getSignatureStatuses') return { value: [{ confirmationStatus: 'confirmed', err: null }] };
  if (method === 'getBlockHeight') return 1;
  return { value: null };
}

const root = path.join(import.meta.dirname, '..', 'workers', 'scheduler');
const persist = await mkdtemp(path.join(tmpdir(), 'vectra-scheduler-browser-'));
await writeFile(path.join(root, '.dev.vars'), 'TOKEN_SECRET=browser-secret-browser-secret-32b\n');
const worker = spawn('npx', [
  'wrangler', 'dev', '--port', String(workerPort), '--ip', '127.0.0.1',
  '--show-interactive-dev-session', 'false',
  '--persist-to', persist,
], {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CI: 'true' },
});
let workerLog = '';
worker.stdout.on('data', (chunk) => { workerLog += chunk; });
worker.stderr.on('data', (chunk) => { workerLog += chunk; });

const server = spawn('python3', ['-m', 'http.server', String(pagePort), '--directory', 'dist'], { stdio: 'ignore' });

async function waitFor(url, readyText) {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    if (!readyText || workerLog.includes(readyText)) {
      try {
        const response = await fetch(url);
        if (response.ok) return;
      } catch { /* Still starting. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('service did not start ' + url + '\n' + workerLog.slice(-2000));
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  await waitFor('http://127.0.0.1:' + pagePort + '/', '');
  await waitFor('http://127.0.0.1:' + workerPort + '/v1/health', 'Ready on');

  const plain = await browser.newPage();
  await plain.goto('http://127.0.0.1:' + pagePort + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await plain.click('[data-page="Distributions"]');
  await plain.waitForFunction(() => document.body.innerText.includes('Scheduler mode'));
  await plain.close();

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/fonts\.googleapis|fonts\.gstatic|favicon/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (!request.url().startsWith('https://api.devnet.solana.com')) {
      request.continue();
      return;
    }
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };
    if (request.method() === 'OPTIONS') {
      request.respond({ status: 204, headers: cors });
      return;
    }
    const body = JSON.parse(request.postData() || '{}');
    request.respond({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, result: rpcResult(body.method, body.params) }),
    });
  });
  await page.exposeFunction('__signScheduler', async (bytes) => {
    return Array.from(cryptoSign(null, Buffer.from(bytes), loginPrivate));
  });
  await page.evaluateOnNewDocument((address, bytes, api) => {
    globalThis.SCHEDULER_API_URL = api;
    const account = {
      address,
      publicKey: Uint8Array.from(bytes),
      chains: ['solana:devnet'],
      features: ['solana:signTransaction', 'solana:signMessage'],
    };
    const wallet = {
      name: 'Phantom',
      version: 'test',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      chains: ['solana:devnet'],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: async (input) => [{ signedTransaction: input.transaction }],
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async ({ message }) => {
            const signature = Uint8Array.from(await window.__signScheduler(Array.from(message)));
            return [{ signature, signedMessage: message }];
          },
        },
      },
      accounts: [account],
    };
    window.addEventListener('wallet-standard:app-ready', (event) => event.detail.register(wallet));
  }, wallet, publicKey, 'http://127.0.0.1:' + workerPort);

  await page.goto('http://127.0.0.1:' + pagePort + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.click('[data-action="connect"]');
  await page.waitForSelector('#wallet-list button');
  await page.evaluate(() => {
    [...document.querySelectorAll('#wallet-list button')].find((node) => node.textContent.includes('Phantom')).click();
  });
  await page.waitForFunction((prefix) => document.body.innerText.includes(prefix), {}, wallet.slice(0, 4));
  await page.click('[data-page="Distributions"]');
  const remoteState = await page.evaluate(() => ({
    url: globalThis.SCHEDULER_API_URL,
    remote: !!(globalThis.VectraSchedule && VectraSchedule.isRemote()),
    text: document.getElementById('content')?.innerText?.slice(0, 700) || '',
  }));
  if (!remoteState.remote) {
    throw new Error('scheduler mode did not turn on ' + JSON.stringify(remoteState) + '\n' + errors.join('\n'));
  }
  await page.waitForSelector('[data-schedule-action="login"]');
  await page.click('[data-schedule-action="login"]');
  await page.waitForFunction((address) => document.body.innerText.includes(address), {}, wallet);

  await page.click('[data-action="schedule"]');
  await page.waitForSelector('#scheduler-form');
  const past = new Date(Date.now() - 2 * 60 * 1000);
  await page.evaluate((date, hour, minute, recipient) => {
    document.getElementById('sched-name').value = 'Browser payroll';
    document.getElementById('sched-zone').value = 'UTC';
    document.getElementById('sched-date').value = date;
    document.getElementById('sched-hour').value = String(hour);
    document.getElementById('sched-minute').value = String(minute);
    document.querySelector('.scheduler-recipient input[aria-label="Recipient wallet address"]').value = recipient;
    document.querySelector('.scheduler-recipient input[aria-label="Amount in USDC"]').value = '1.5';
  }, past.toISOString().slice(0, 10), past.getUTCHours(), past.getUTCMinutes(), DONATION);
  await page.click('#scheduler-form button[type="submit"]');
  await page.waitForSelector('[data-schedule-action="review-run"]', { timeout: 20000 });
  const listed = await page.$eval('#content', (node) => node.innerText);
  if (!listed.includes('Browser payroll') || !listed.includes('awaiting_signature')) {
    throw new Error('due run was not listed: ' + listed.slice(0, 500));
  }
  await page.click('[data-schedule-action="review-run"]');
  await page.waitForFunction(() => {
    const text = document.querySelector('.modal')?.innerText || '';
    return /simulation succeeded|was not asked to sign|Simulation failed|enough devnet/i.test(text);
  }, { timeout: 20000 });
  const review = await page.$eval('.modal', (node) => node.innerText);
  if (!review.includes(DONATION) || !review.toLowerCase().includes('simulation succeeded')) {
    throw new Error('unsigned payout was not reviewed: ' + review.slice(0, 800) + '\n' + errors.join('\n'));
  }
  await page.click('[data-schedule-action="confirm-sign"]');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Payout submitted') || text.includes('sent');
  }, { timeout: 20000 });
  await page.click('[data-page="Distributions"]');
  await page.waitForFunction(() => document.body.innerText.includes('sent'), { timeout: 15000 });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('scheduler browser checks passed');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  try { process.kill(-worker.pid, 'SIGTERM'); } catch { worker.kill('SIGTERM'); }
  await Promise.all([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* The process group has already exited. */ }
        resolve();
      }, 4000);
      worker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    }),
  ]);
  await rm(persist, { recursive: true, force: true });
  await rm(path.join(root, '.dev.vars'), { force: true });
}
