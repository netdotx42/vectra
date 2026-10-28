import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { allowedOrigin } from '../workers/multihopper/src/cors.js';
import { MESSAGES, fail } from '../workers/multihopper/src/errors.js';
import { DEVNET_API_BASE, resolveMode, resolveUpstream } from '../workers/multihopper/src/env.js';
import { decideReplay } from '../workers/multihopper/src/idempotency.js';
import { buildEstimate } from '../workers/multihopper/src/mock.js';
import { normalizeEstimate, normalizePrepare } from '../workers/multihopper/src/shapes.js';
import { validateConfirm, validateCreate, validateEstimate } from '../workers/multihopper/src/validate.js';
import { parseWebhook, signWebhook, verifyWebhookSignature } from '../workers/multihopper/src/webhook.js';

const require = createRequire(import.meta.url);
const { Keypair } = require('@solana/web3.js');
const core = require('../dist/core.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const sender = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();
const hopA = Keypair.generate().publicKey.toBase58();
const hopB = Keypair.generate().publicKey.toBase58();
const hopC = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();

function signature() {
  return core.base58Encode(Uint8Array.from({ length: 64 }, (_, index) => (index * 7 + 3) % 256));
}

test('route rules reject bad hops, waits, amounts, and mints', () => {
  assert.throws(() => validateEstimate({ amountRaw: '1000000', hops: 2, arrivalSeconds: 300 }), (error) => error.code === 'MH_013');
  assert.throws(() => validateEstimate({ amountRaw: '1000000', hops: 11, arrivalSeconds: 300 }), (error) => error.code === 'MH_013');
  const three = validateEstimate({ amountRaw: '1000000', hops: 3, arrivalSeconds: 60 });
  assert.equal(three.hops, 3);
  assert.throws(() => validateEstimate({ amountRaw: '1000000', hops: 3, arrivalSeconds: 59 }), (error) => error.code === 'MH_014');
  assert.throws(() => validateEstimate({ amountRaw: '1000000', hops: 3, arrivalSeconds: 2592001 }), (error) => error.code === 'MH_014');
  assert.throws(() => validateEstimate({ tokenMint: core.MAINNET_USDC_MINT, amountRaw: '1', hops: 3, arrivalSeconds: 60 }), (error) => error.code === 'MH_010');
  assert.throws(() => validateEstimate({ amountRaw: '0', hops: 3, arrivalSeconds: 60 }), (error) => error.code === 'MH_012');

  assert.throws(() => validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    route: { hops: [{ wallet: hopA, waitSeconds: 20 }] },
  }), (error) => error.code === 'MH_013');

  const single = validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    route: { hops: [{ wallet: hopA, waitSeconds: 20 }, { wallet: hopB, waitSeconds: 2591980 }] },
  });
  assert.equal(single.route.hops.length, 2);
  assert.equal(single.tokenMint, core.DEVNET_USDC_MINT);

  assert.throws(() => validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    route: { hops: [{ wallet: hopA, waitSeconds: 19 }, { wallet: hopB, waitSeconds: 20 }] },
  }), (error) => error.code === 'MH_018');

  assert.throws(() => validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    route: { hops: [{ wallet: hopA, waitSeconds: 1296001 }, { wallet: hopB, waitSeconds: 1296001 }] },
  }), (error) => error.code === 'MH_018');

  assert.throws(() => validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    route: { hops: [{ wallet: sender, waitSeconds: 30 }, { wallet: hopB, waitSeconds: 30 }] },
  }), (error) => error.code === 'MH_018');

  assert.throws(() => validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    route: { hops: [{ wallet: hopA, waitSeconds: 30 }, { bundle: 'cex', waitSeconds: 30 }] },
  }), (error) => error.code === 'MH_019');

  assert.throws(() => validateCreate({
    amountRaw: '1000000',
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
    hops: 3,
    arrivalSeconds: 120,
    route: { hops: [{ wallet: hopA, waitSeconds: 30 }, { wallet: hopB, waitSeconds: 30 }] },
  }), (error) => error.code === 'MH_018');

  const many = validateCreate({
    amountRaw: '2000000',
    amountTokens: '2',
    sourceOwner: sender,
    destinations: [
      { wallet: recipient, amountRaw: '1500000' },
      { wallet: other, amountRaw: '500000' },
    ],
    route: {
      hops: [
        { wallet: hopA, waitSeconds: 20 },
        { wallet: hopB, waitSeconds: 20 },
        { wallet: hopC, waitSeconds: 20 },
      ],
    },
  });
  assert.equal(many.destinations.length, 2);
  assert.equal(many.recipientWallet, undefined);

  assert.throws(() => validateCreate({
    amountRaw: '2000000',
    amountTokens: '2',
    sourceOwner: sender,
    destinations: [
      { wallet: recipient, amountRaw: '1000000' },
      { wallet: other, amountRaw: '1000000' },
    ],
    route: { hops: [{ wallet: hopA, waitSeconds: 30 }, { wallet: hopB, waitSeconds: 30 }] },
  }), (error) => error.code === 'MH_013');

  assert.throws(() => validateCreate({
    amountRaw: '2000000',
    amountTokens: '2',
    sourceOwner: sender,
    destinations: [
      { wallet: recipient, amountRaw: '1000000' },
      { wallet: other, amountRaw: '500000' },
    ],
    hops: 3,
    arrivalSeconds: 120,
  }), (error) => error.code === 'MH_012');

  const badSig = signature().slice(0, 8);
  assert.throws(() => validateConfirm({ routeInitSignatures: [], keeperFundingSignature: badSig }), (error) => error.code === 'MH_039');
  const ok = validateConfirm({ routeInitSignatures: [signature()], keeperFundingSignature: signature() });
  assert.equal(ok.routeInitSignatures.length, 1);
});

test('idempotency replays the same body and rejects a different one', () => {
  assert.equal(decideReplay(null, 'abc', 1_000).kind, 'fresh');
  assert.equal(decideReplay({ bodyHash: 'abc', state: 'inflight', startedAt: 900 }, 'abc', 1_000).kind, 'inflight');
  assert.equal(decideReplay({ bodyHash: 'abc', state: 'inflight', startedAt: 1 }, 'abc', 40_000).kind, 'retry');
  assert.equal(decideReplay({ bodyHash: 'abc', state: 'done', response: { status: 200, body: { id: 1 } } }, 'abc', 1).kind, 'replay');
  assert.equal(decideReplay({ bodyHash: 'abc', state: 'done', response: { status: 200, body: {} } }, 'zzz', 1).kind, 'mismatch');
});

test('webhook signatures use the raw body', async () => {
  const secret = 'whsec_test_secret';
  const body = new TextEncoder().encode('{"type":"transfer.hop_complete"}');
  const signatureHex = await signWebhook(secret, body);
  assert.equal(await verifyWebhookSignature(secret, body, signatureHex), true);
  assert.equal(await verifyWebhookSignature(secret, body, 'sha256=' + signatureHex), true);
  assert.equal(await verifyWebhookSignature('whsec_other', body, signatureHex), false);
  assert.equal(await verifyWebhookSignature(secret, new TextEncoder().encode('{"type":"transfer.hop_complete"} '), signatureHex), false);
  const fixture = JSON.parse(await readFile(path.join(root, 'workers/multihopper/fixtures/webhook-hop.json'), 'utf8'));
  const parsed = parseWebhook(fixture);
  assert.equal(parsed.transferId, 9001);
  assert.equal(parsed.hop.index, 0);
  assert.equal(parsed.hop.screening.status, 'not_provided');
  assert.equal(parseWebhook({ type: 'nope', data: { transferId: 1 } }), null);
});

test('error codes map to friendly text and production stays locked', () => {
  assert.match(fail('MH_018').message, /custom route/i);
  assert.match(fail('MH_004').message, /Too many requests/);
  assert.equal(fail('MH_019').status, 400);
  assert.equal(MESSAGES.MH_039.includes('keeper'), true);
  assert.equal(resolveMode({ MOCK_MULTIHOPPER: '1', MULTIHOPPER_API_KEY: 'mh_test_example' }).mode, 'mock');
  assert.equal(resolveMode({}).mode, 'mock');
  assert.equal(resolveMode({ MULTIHOPPER_API_KEY: 'mh_test_example' }).mode, 'live');
  assert.throws(() => resolveMode({ MULTIHOPPER_API_KEY: 'mh_live_example' }), (error) => error.code === 'MH_003');
  assert.throws(() => resolveMode({ MULTIHOPPER_API_KEY: 'MH_LIVE_example' }), (error) => error.code === 'MH_003');
  assert.throws(() => validateEstimate({ amountRaw: 1000000, hops: 3, arrivalSeconds: 300 }), (error) => error.code === 'MH_012');
  assert.equal(resolveUpstream({}), DEVNET_API_BASE);
  assert.throws(() => resolveUpstream({ MULTIHOPPER_BASE_URL: 'https://multihopper.com/api/v1' }), (error) => error.code === 'MH_003');
  assert.throws(() => resolveUpstream({ MULTIHOPPER_BASE_URL: 'http://devnet.multihopper.com/api/v1' }), (error) => error.code === 'MH_003');
  assert.equal(allowedOrigin('https://netdotx42.github.io'), 'https://netdotx42.github.io');
  assert.equal(allowedOrigin('http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
  assert.equal(allowedOrigin('https://evil.example'), '');
});

test('fixtures match the normalized estimate and prepare shapes', async () => {
  const estimate = JSON.parse(await readFile(path.join(root, 'workers/multihopper/fixtures/estimate.json'), 'utf8'));
  const normalized = normalizeEstimate(estimate);
  assert.equal(normalized.percentFeeBps, 50);
  assert.equal(normalized.sol.breakdown.screeningFeeLamports, 0);
  const prepared = normalizePrepare(JSON.parse(await readFile(path.join(root, 'workers/multihopper/fixtures/prepare.json'), 'utf8')));
  assert.equal(typeof prepared.preparedTxs.keeperFundingTx, 'string');
  assert.equal(prepared.preparedTxs.routeInitTxs[0].base64.length > 20, true);
  const quote = buildEstimate({ amountRaw: '1000000', hops: 3, arrivalSeconds: 300, route: null });
  assert.equal(quote.priceSource, 'mock');
  assert.equal(quote.route.hopCount, 3);
});

test('public copy does not call routing cross-chain', async () => {
  const files = ['README.md', 'DESCRIPTION.txt', 'docs/DEVNET.md', 'docs/LITEPAPER.md', 'dist/app.js', 'dist/brand.html', 'dist/routing.js', 'dist/index.html'];
  for (const file of files) {
    const text = await readFile(path.join(root, file), 'utf8');
    assert.equal(/cross-chain/i.test(text), false, file);
    assert.equal(/across chains/i.test(text), false, file);
  }
  const routing = await readFile(path.join(root, 'dist/routing.js'), 'utf8');
  assert.match(routing, /does not make a transfer untraceable/);
  const worker = await readFile(path.join(root, 'workers/multihopper/src/index.js'), 'utf8');
  assert.equal(worker.includes('mh_live_'), false);
  assert.equal(worker.includes('https://multihopper.com/api/v1'), false);
});

test('mock proxy covers estimate, idempotency, signing flow, webhook, and rate limit', { timeout: 120000 }, async (t) => {
  const persist = await mkdtemp(path.join(tmpdir(), 'vectra-mh-'));
  const child = spawn('npx', [
    'wrangler', 'dev',
    '--config', 'workers/multihopper/wrangler.jsonc',
    '--port', '8791',
    '--ip', '127.0.0.1',
    '--inspector-port', '9239',
    '--local',
    '--persist-to', persist,
    '--show-interactive-dev-session', 'false',
    '--log-level', 'error',
    '--var', 'MOCK_MULTIHOPPER:1',
    '--var', 'MULTIHOPPER_API_KEY:mh_test_not_a_real_key',
    '--var', 'MULTIHOPPER_WEBHOOK_SECRET:whsec_test_only',
  ], {
    cwd: root,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  });
  const base = 'http://127.0.0.1:8791';
  const started = Date.now();
  let healthy = false;
  while (Date.now() - started < 90000) {
    try {
      const response = await fetch(base + '/health');
      if (response.ok) {
        healthy = true;
        const body = await response.json();
        assert.equal(body.mode, 'mock');
        assert.equal(body.productionLocked, true);
        assert.equal(body.environment, 'devnet');
        break;
      }
    } catch { /* Wrangler is still booting. */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!healthy) throw new Error('wrangler dev did not become ready\n' + logs.slice(-2000));

  const blocked = await fetch(base + '/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);

  const open = await fetch(base + '/health', { headers: { origin: 'https://netdotx42.github.io' } });
  assert.equal(open.headers.get('access-control-allow-origin'), 'https://netdotx42.github.io');

  async function post(urlPath, body, action) {
    const response = await fetch(base + urlPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:8765',
        'x-vectra-action': action,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  const missingKey = await post('/v1/transfers/estimate', { amountRaw: '1000000', hops: 3, arrivalSeconds: 120 }, '');
  assert.equal(missingKey.response.status, 400);
  assert.equal(missingKey.data.error.code, 'MH_070');

  const action = crypto.randomUUID();
  const estimateBody = { amountRaw: '1000000', hops: 3, arrivalSeconds: 300, tokenMint: core.DEVNET_USDC_MINT };
  const first = await post('/v1/transfers/estimate', estimateBody, action);
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.mode, 'mock');
  assert.equal(first.data.priceSource, 'mock');
  assert.equal(first.response.headers.get('x-vectra-idempotent'), null);
  const second = await post('/v1/transfers/estimate', estimateBody, action);
  assert.equal(second.response.headers.get('x-vectra-idempotent'), 'replay');
  assert.equal(second.data.percentFeeRaw, first.data.percentFeeRaw);
  const clash = await post('/v1/transfers/estimate', { ...estimateBody, amountRaw: '2000000' }, action);
  assert.equal(clash.response.status, 409);
  assert.equal(clash.data.error.code, 'MH_071');

  const created = await post('/v1/transfers', {
    ...estimateBody,
    amountTokens: '1',
    sourceOwner: sender,
    recipientWallet: recipient,
  }, crypto.randomUUID());
  assert.equal(created.response.status, 200, JSON.stringify(created.data));
  const transferId = created.data.id;
  assert.ok(transferId >= 9001);
  assert.equal(created.data.route.hops.at(-1).address, recipient);
  assert.equal(created.data.route.hops[0].screening.status, 'not_provided');

  const prepared = await post('/v1/transfers/' + transferId + '/prepare', {}, crypto.randomUUID());
  assert.equal(typeof prepared.data.preparedTxs.keeperFundingTx, 'string');
  assert.equal(prepared.data.preparedTxs.routeInitTxs.length, 1);
  const keeper = signature();
  const keeperConfirm = await post('/v1/transfers/' + transferId + '/confirm-broadcast', {
    routeInitSignatures: [],
    keeperFundingSignature: keeper,
  }, crypto.randomUUID());
  assert.equal(keeperConfirm.response.status, 200, JSON.stringify(keeperConfirm.data));
  assert.equal(keeperConfirm.data.transfer.status, 'awaiting_signature');

  const routeSig = signature();
  const sessionSig = signature();
  const orchestratorSig = signature();
  const finalConfirm = await post('/v1/transfers/' + transferId + '/confirm-broadcast', {
    routeInitSignatures: [routeSig],
    keeperFundingSignature: keeper,
    orchestratorInitSignature: orchestratorSig,
    sessionInitSignatures: [sessionSig],
  }, crypto.randomUUID());
  assert.equal(finalConfirm.data.transfer.status, 'processing');

  const secret = 'whsec_test_only';
  const event = {
    id: 'evt-test-1',
    type: 'transfer.hop_complete',
    created: '2026-10-28T19:00:00.000Z',
    data: {
      transferId,
      status: 'active',
      phase: 'executing',
      hop: {
        index: 0,
        txSignature: signature(),
        executedAt: '2026-10-28T19:02:00.000Z',
        screening: { status: 'not_provided', message: 'Webhook fixture. No flag reason is disclosed.' },
      },
    },
  };
  const raw = JSON.stringify(event);
  const bad = await fetch(base + '/v1/webhooks/multihopper', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-multihopper-signature': 'ab' },
    body: raw,
  });
  assert.equal(bad.status, 401);
  const goodSig = await signWebhook(secret, raw);
  const good = await fetch(base + '/v1/webhooks/multihopper', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-multihopper-signature': goodSig },
    body: raw,
  });
  assert.equal(good.status, 200);
  const status = await fetch(base + '/v1/transfers/' + transferId, { headers: { origin: 'http://localhost:8080' } });
  const statusBody = await status.json();
  assert.equal(status.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  assert.equal(statusBody.status, 'active');
  assert.equal(statusBody.route.hops[0].txSignature, event.data.hop.txSignature);
  assert.equal(statusBody.progress.hopsCompleted >= 1, true);

  const library = await fetch(base + '/v1/hop-library');
  const libraryBody = await library.json();
  assert.match(libraryBody.devnetNote, /MH_019/);

  let limited = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await post('/v1/transfers/estimate', estimateBody, crypto.randomUUID());
    if (result.response.status === 429) {
      limited = true;
      assert.equal(result.data.error.code, 'MH_004');
      assert.ok(result.response.headers.get('retry-after'));
      break;
    }
  }
  assert.equal(limited, true);
});
