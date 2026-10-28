const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.js');

const DONATION = 'Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('accepts real Solana addresses and rejects lookalikes', () => {
  assert.equal(core.isSolanaAddress(DONATION), true);
  assert.equal(core.isSolanaAddress('  ' + DEVNET_USDC + '  '), true);
  assert.equal(core.isSolanaAddress(MAINNET_USDC), true);
  assert.equal(core.isSolanaAddress('11111111111111111111111111111111'), true);
  assert.equal(core.isSolanaAddress(''), false);
  assert.equal(core.isSolanaAddress('0x' + 'ab'.repeat(20)), false);
  assert.equal(core.isSolanaAddress(DONATION.slice(0, -1) + '0'), false);
  assert.equal(core.isSolanaAddress(DONATION.slice(0, 20)), false);
  assert.equal(core.isSolanaAddress(DONATION + 'a'), false);
  assert.equal(core.base58Decode(DONATION).length, 32);
  assert.equal(core.base58Decode(DEVNET_USDC).length, 32);
});

test('parses USDC amounts in 6-decimal base units without float error', () => {
  assert.deepEqual(core.parseTokenAmount('1', 6), { ok: true, amount: 1000000n });
  assert.deepEqual(core.parseTokenAmount('0.1', 6), { ok: true, amount: 100000n });
  assert.deepEqual(core.parseTokenAmount('0.000001', 6), { ok: true, amount: 1n });
  assert.deepEqual(core.parseTokenAmount('1.000001', 6), { ok: true, amount: 1000001n });
  assert.deepEqual(core.parseTokenAmount('1,000.50', 6), { ok: true, amount: 1000500000n });
  assert.equal(core.parseTokenAmount('1.0000001', 6).ok, false);
  assert.match(core.parseTokenAmount('1.0000001', 6).error, /6 decimal/);
  assert.equal(core.parseTokenAmount('0', 6).ok, false);
  assert.equal(core.parseTokenAmount('-1', 6).ok, false);
  assert.equal(core.parseTokenAmount('1e6', 6).ok, false);
  assert.equal(core.parseTokenAmount('', 6).ok, false);
  assert.equal(core.parseTokenAmount('  ', 6).ok, false);
  assert.equal(core.formatBaseUnits(1000001n, 6), '1.000001');
  assert.equal(core.formatBaseUnits(1000500000n, 6), '1000.5');
  assert.equal(core.formatBaseUnits(1n, 6), '0.000001');
  assert.equal(core.formatBaseUnits(5000n, 9), '0.000005');
});

test('validates a multi-recipient payout', () => {
  const ok = core.validatePayout({
    recipients: [
      { address: DONATION, amount: '1.5' },
      { address: DEVNET_USDC, amount: '0.000001' },
    ],
    memo: 'April grants',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.total, 1500001n);
  assert.equal(ok.memo, 'April grants');
  assert.equal(ok.recipients[0].display, '1.5');

  assert.equal(core.validatePayout({ recipients: [{ address: 'nope', amount: '1' }] }).ok, false);
  assert.match(core.validatePayout({
    recipients: [
      { address: DONATION, amount: '1' },
      { address: DONATION, amount: '2' },
    ],
  }).error, /unique/i);
  assert.match(core.validatePayout({
    recipients: [{ address: DONATION, amount: '1' }],
    memo: 'x'.repeat(281),
  }).error, /memo/i);
  assert.match(core.validatePayout({
    recipients: [{ address: core.TOKEN_PROGRAM_ID, amount: '1' }],
  }).error, /program/i);
  assert.equal(core.validatePayout({ recipients: [] }).ok, false);
});

test('splits payouts so each batch respects count and byte limits', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const packed = core.planBatches(items, {
    limit: 250,
    maxItems: 10,
    measure: (group) => 50 + group.length * 100,
  });
  assert.equal(packed.ok, true);
  assert.deepEqual(packed.batches, [['a', 'b'], ['c', 'd'], ['e']]);

  const capped = core.planBatches(items, {
    limit: 10_000,
    maxItems: 2,
    measure: () => 10,
  });
  assert.deepEqual(capped.batches.map((batch) => batch.length), [2, 2, 1]);

  const tooBig = core.planBatches(['only'], {
    limit: 50,
    maxItems: 4,
    measure: () => 80,
  });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error, /does not fit/i);

  assert.equal(core.planBatches([], { limit: 100, measure: () => 1 }).ok, false);
});

test('builds a CSV with signatures and explorer URLs and neutralises formulas', () => {
  const signature = core.base58Encode(new Uint8Array(64).fill(7));
  const csv = core.buildReportCsv({
    payouts: [{
      createdAt: '2026-10-28T00:00:00.000Z',
      reference: '=cmd',
      memo: 'hello "team"',
      batches: [{
        signature,
        status: 'confirmed',
        recipients: [{ address: DONATION, amount: '1.5' }],
      }],
    }],
    demoRows: [{ name: 'Sample', sub: 'Demo', amount: '− $1.00', status: 'Completed' }],
  });
  assert.match(csv, /Signature/);
  assert.match(csv, /Explorer URL/);
  assert.match(csv, /https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet/);
  assert.match(csv, /"'=cmd"/);
  assert.match(csv, /"hello ""team"""/);
  assert.match(csv, /Fictional demo data/);
  assert.match(csv, /no cash value/);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('maps wallet, funds, expiry, rate limit, and simulation failures', () => {
  assert.match(core.friendlyTxError({ message: 'User rejected the request.', code: 4001 }), /declined/i);
  assert.match(core.friendlyTxError({ message: 'Transfer: insufficient lamports' }), /devnet SOL/i);
  assert.match(core.friendlyTxError({ message: 'simulation failed', logs: ['Error: insufficient funds'], err: { Custom: 1 } }), /devnet USDC/i);
  assert.match(core.friendlyTxError({ message: 'Blockhash not found' }), /expired/i);
  assert.match(core.friendlyTxError({ message: '429 Too Many Requests' }), /rate-limit/i);
  assert.match(core.friendlyTxError({ message: 'simulation failed', logs: ['Error processing Instruction 1'], err: { InstructionError: [1, 'Custom'] } }), /Simulation failed/i);
  assert.match(core.friendlyTxError(new TypeError('Failed to fetch')), /could not be reached/i);
});

test('keeps donation bounds and points Solana Pay at devnet USDC', () => {
  assert.equal(core.DONATION_MIN, 1999);
  assert.equal(core.DONATION_MAX, 100000);
  assert.equal(core.DONATION_ADDRESS, DONATION);
  assert.equal(core.parseDonation('1,998').ok, false);
  assert.equal(core.parseDonation('1999').ok, true);
  assert.equal(core.parseDonation('100000').ok, true);
  assert.equal(core.parseDonation('100000.01').ok, false);
  assert.match(core.parseDonation('10.999').error, /2 decimal/);
  assert.equal(core.parseDonation('-5').ok, false);
  assert.equal(core.parseDonation('').ok, false);
  const link = core.solanaPayLink(DONATION, 1999);
  assert.match(link, new RegExp('^solana:' + DONATION + '\\?'));
  assert.match(link, new RegExp('spl-token=' + DEVNET_USDC));
  assert.match(link, /cluster=devnet/);
  assert.doesNotMatch(link, new RegExp(MAINNET_USDC));
  assert.equal(core.solanaPayLink('not-an-address', 1999), '');
  assert.equal(core.escapeHtml(`<img src=x onerror=alert(1)>"'`), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
});

test('explorer links are devnet-only and reject malformed signatures', () => {
  const signature = core.base58Encode(new Uint8Array(64).fill(3));
  assert.equal(
    core.explorerTxUrl(signature),
    'https://explorer.solana.com/tx/' + signature + '?cluster=devnet',
  );
  assert.equal(core.explorerTxUrl(signature, 'mainnet-beta'), '');
  assert.equal(core.explorerTxUrl('javascript:alert(1)'), '');
  assert.equal(core.explorerTxUrl(DONATION), '');
});
