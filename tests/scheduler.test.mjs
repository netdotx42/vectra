import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { advanceSchedule, applyRunTransition, deterministicRunId, expireRun, nextAlarmMs } from '../workers/scheduler/src/runs.js';
import { localToUtc, nextMonthly, nextWeekly, zonedParts } from '../workers/scheduler/src/schedule-math.js';
import { assertTransition } from '../workers/scheduler/src/state-machine.js';
import { issueToken, loginMessage, readToken, verifyWalletSignature } from '../workers/scheduler/src/auth.js';
import { allowedOrigin } from '../workers/scheduler/src/cors.js';
import { take } from '../workers/scheduler/src/limits.js';
import { validateSchedule, webhookUrl } from '../workers/scheduler/src/validate.js';
import { base58Encode } from '../workers/scheduler/src/codec.js';

const DONATION = 'Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SECRET = 'test-secret-test-secret-test-secret-32';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
    sign(message) {
      return new Uint8Array(cryptoSign(null, Buffer.from(message), privateKey));
    },
  };
}

function memory() {
  const runs = new Map();
  const auditLog = [];
  const inboxItems = [];
  return {
    runs,
    auditLog,
    inboxItems,
    getRun: async (id) => runs.get(id) || null,
    putRun: async (run) => { runs.set(run.id, run); },
    audit: async (entry) => { auditLog.push(entry); },
    inbox: async (item) => { inboxItems.push(item); },
  };
}

test('weekly maths stays on the wall clock across the New York spring-forward', () => {
  const schedule = { timezone: 'America/New_York', weekday: 0, hour: 1, minute: 30 };
  const march1 = nextWeekly(schedule, Date.parse('2026-02-28T12:00:00.000Z'));
  const march8 = nextWeekly(schedule, march1);
  const march15 = nextWeekly(schedule, march8);
  assert.equal(new Date(march1).toISOString(), '2026-03-01T06:30:00.000Z');
  assert.equal(new Date(march8).toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(new Date(march15).toISOString(), '2026-03-15T05:30:00.000Z');
  assert.equal(march15 - march8, 7 * DAY - HOUR);
  for (const instant of [march1, march8, march15]) {
    const parts = zonedParts(new Date(instant), 'America/New_York');
    assert.equal(parts.hour, 1);
    assert.equal(parts.minute, 30);
    assert.equal(parts.weekday, 'Sun');
  }
});

test('a missing spring-forward minute moves to the next valid local minute', () => {
  const utc = localToUtc(2026, 3, 8, 2, 30, 'America/New_York');
  assert.equal(new Date(utc).toISOString(), '2026-03-08T07:00:00.000Z');
  const parts = zonedParts(new Date(utc), 'America/New_York');
  assert.equal(parts.hour, 3);
  assert.equal(parts.minute, 0);
  assert.equal(parts.day, 8);
});

test('a fall-back hour uses the first local occurrence', () => {
  const first = localToUtc(2026, 11, 1, 1, 30, 'America/New_York');
  assert.equal(new Date(first).toISOString(), '2026-11-01T05:30:00.000Z');
  const second = zonedParts(new Date(first + HOUR), 'America/New_York');
  assert.equal(second.hour, 1);
  assert.equal(second.minute, 30);
  assert.ok(first < first + HOUR);
});

test('monthly day 31 clamps to month end, including a leap day', () => {
  const schedule = { timezone: 'America/New_York', dayOfMonth: 31, hour: 9, minute: 0 };
  const january = nextMonthly(schedule, Date.parse('2026-01-01T00:00:00.000Z'));
  const february = nextMonthly(schedule, january);
  const march = nextMonthly(schedule, february);
  assert.equal(zonedParts(new Date(january), 'America/New_York').day, 31);
  assert.equal(zonedParts(new Date(february), 'America/New_York').day, 28);
  assert.equal(new Date(february).toISOString(), '2026-02-28T14:00:00.000Z');
  assert.equal(zonedParts(new Date(march), 'America/New_York').day, 31);
  const leap = nextMonthly(schedule, Date.parse('2028-01-31T20:00:00.000Z'));
  assert.equal(new Date(leap).toISOString(), '2028-02-29T14:00:00.000Z');
  const last = nextMonthly({ timezone: 'UTC', dayOfMonth: 'last', hour: 15, minute: 0 }, Date.parse('2026-01-31T15:00:00.000Z'));
  assert.equal(new Date(last).toISOString(), '2026-02-28T15:00:00.000Z');
});

test('run ids are deterministic for a schedule and due time', async () => {
  const due = '2026-03-01T06:30:00.000Z';
  const first = await deterministicRunId('sched-1', due);
  const second = await deterministicRunId('sched-1', due);
  const other = await deterministicRunId('sched-1', '2026-03-08T06:30:00.000Z');
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(first.length, 32);
  const expected = createHash('sha256').update('sched-1\n' + due).digest('hex').slice(0, 32);
  assert.equal(first, expected);
});

test('preparing the same due time twice keeps one run', async () => {
  const now = Date.parse('2026-04-06T12:00:00.000Z');
  const schedule = {
    id: 'sched-1',
    name: 'Payroll',
    frequency: 'weekly',
    timezone: 'UTC',
    weekday: 1,
    hour: 12,
    minute: 0,
    recipients: [{ address: DONATION, amount: '1.5' }],
    memo: 'April',
    status: 'active',
    graceMs: DAY,
    nextDueAt: '2026-04-06T12:00:00.000Z',
  };
  const store = memory();
  const first = await advanceSchedule(schedule, now, store);
  const second = await advanceSchedule(schedule, now, store);
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].status, 'awaiting_signature');
  assert.equal(second.created.length, 0);
  assert.equal(store.runs.size, 1);
  assert.deepEqual(store.auditLog.map((entry) => entry.toStatus), ['prepared', 'awaiting_signature']);
  const saved = await advanceSchedule(first.schedule, now, store);
  assert.equal(saved.created.length, 0);
});

test('a prepared row left behind is finished once and not duplicated', async () => {
  const now = Date.parse('2026-04-06T12:00:00.000Z');
  const due = '2026-04-06T12:00:00.000Z';
  const schedule = {
    id: 'sched-stuck',
    name: 'Payroll',
    frequency: 'weekly',
    timezone: 'UTC',
    weekday: 1,
    hour: 12,
    minute: 0,
    recipients: [{ address: DONATION, amount: '1' }],
    memo: '',
    status: 'active',
    graceMs: DAY,
    nextDueAt: due,
  };
  const store = memory();
  const id = await deterministicRunId('sched-stuck', due);
  store.runs.set(id, {
    id,
    scheduleId: 'sched-stuck',
    name: 'Payroll',
    dueAt: due,
    status: 'prepared',
    recipients: schedule.recipients,
    graceMs: DAY,
  });
  const first = await advanceSchedule(schedule, now, store);
  const second = await advanceSchedule(first.schedule, now, store);
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].status, 'awaiting_signature');
  assert.equal(second.created.length, 0);
  assert.equal(store.runs.size, 1);
  assert.equal([...store.runs.values()][0].status, 'awaiting_signature');
});

test('a due time outside the grace period expires and is not sent', async () => {
  const now = Date.parse('2026-04-10T12:00:00.000Z');
  const schedule = {
    id: 'sched-late',
    name: 'Late',
    frequency: 'once',
    timezone: 'UTC',
    hour: 12,
    minute: 0,
    recipients: [{ address: DONATION, amount: '2' }],
    memo: '',
    status: 'active',
    graceMs: HOUR,
    runAt: '2026-04-08T12:00:00.000Z',
    nextDueAt: '2026-04-08T12:00:00.000Z',
  };
  let webhooks = 0;
  const store = memory();
  store.onAwaiting = async () => { webhooks += 1; };
  const result = await advanceSchedule(schedule, now, store);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].status, 'expired');
  assert.equal(result.schedule.status, 'completed');
  assert.equal(webhooks, 0);
  assert.equal(store.inboxItems[0].kind, 'run_expired');
  const again = await advanceSchedule(schedule, now, store);
  assert.equal(again.created.length, 0);
  assert.equal(store.runs.size, 1);
  assert.equal(expireRun(result.created[0], now), null);
});

test('run transitions follow the signature state machine', () => {
  assert.equal(assertTransition('prepared', 'awaiting_signature').ok, true);
  assert.equal(assertTransition('awaiting_signature', 'signed').ok, true);
  assert.equal(assertTransition('awaiting_signature', 'sent').ok, true);
  assert.equal(assertTransition('awaiting_signature', 'skipped').ok, true);
  assert.equal(assertTransition('awaiting_signature', 'expired').ok, true);
  assert.equal(assertTransition('signed', 'sent').ok, true);
  assert.equal(assertTransition('sent', 'skipped').ok, false);
  assert.equal(assertTransition('expired', 'sent').ok, false);
  assert.equal(assertTransition('skipped', 'signed').ok, false);
  const signed = applyRunTransition({ status: 'awaiting_signature', id: 'run' }, 'signed', { signatures: ['sig'] });
  assert.equal(signed.ok, true);
  assert.equal(signed.run.status, 'signed');
  assert.equal(applyRunTransition(signed.run, 'skipped').ok, false);
  const open = { status: 'awaiting_signature', dueAt: '2026-04-01T00:00:00.000Z', graceMs: HOUR };
  assert.equal(expireRun(open, Date.parse('2026-04-01T00:30:00.000Z')), null);
  assert.equal(expireRun(open, Date.parse('2026-04-01T02:00:00.000Z')).status, 'expired');
});

test('wallet signatures and session tokens are checked', async () => {
  const keys = pair();
  const wallet = base58Encode(keys.publicKey);
  const message = loginMessage({
    wallet,
    nonce: 'nonce-1',
    issuedAt: '2026-04-01T00:00:00.000Z',
    expiresAt: '2026-04-01T00:05:00.000Z',
  });
  const encoded = base58Encode(keys.sign(new TextEncoder().encode(message)));
  assert.equal(await verifyWalletSignature(wallet, encoded, message), true);
  assert.equal(await verifyWalletSignature(wallet, encoded, message + '\n'), false);
  const other = base58Encode(pair().publicKey);
  assert.equal(await verifyWalletSignature(other, encoded, message), false);

  const now = Date.parse('2026-04-01T00:00:00.000Z');
  const issued = await issueToken(SECRET, wallet, now, 15 * 60 * 1000);
  const read = await readToken(SECRET, issued.token, now + 1000);
  assert.equal(read.ok, true);
  assert.equal(read.wallet, wallet);
  assert.equal((await readToken(SECRET, issued.token, now + 16 * 60 * 1000)).ok, false);
  assert.equal((await readToken('another-secret-another-secret-xxxx', issued.token, now)).ok, false);
  const [body, mac] = issued.token.split('.');
  const tampered = (body.slice(0, -1) === body ? body + 'A' : body.slice(0, -1) + (body.endsWith('A') ? 'B' : 'A')) + '.' + mac;
  assert.equal((await readToken(SECRET, tampered, now)).ok, false);
  assert.equal((await readToken('', issued.token, now)).error.includes('not configured'), true);
});

test('cors allows the pages origin and localhost only', () => {
  assert.equal(allowedOrigin('https://netdotx42.github.io'), 'https://netdotx42.github.io');
  assert.equal(allowedOrigin('http://localhost:8080'), 'http://localhost:8080');
  assert.equal(allowedOrigin('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(allowedOrigin('https://localhost:8080'), '');
  assert.equal(allowedOrigin('https://evil.example'), '');
  assert.equal(allowedOrigin('http://netdotx42.github.io'), '');
  assert.equal(allowedOrigin('https://netdotx42.github.io.evil.com'), '');
});

test('schedule input rejects mainnet, bad amounts, and private webhooks', () => {
  const now = Date.parse('2026-04-01T00:00:00.000Z');
  const base = {
    name: 'Payroll',
    frequency: 'weekly',
    timezone: 'UTC',
    weekday: 3,
    hour: 9,
    minute: 15,
    recipients: [{ address: DONATION, amount: '1.250000' }],
    memo: 'ok',
    network: 'devnet',
  };
  const ok = validateSchedule(base, now, DAY);
  assert.equal(ok.ok, true);
  assert.equal(ok.schedule.recipients[0].amount, '1.25');
  assert.equal(validateSchedule({ ...base, recipients: [{ address: DONATION, amount: '1.0' }] }, now, DAY).schedule.recipients[0].amount, '1');
  assert.equal(validateSchedule({ ...base, recipients: [{ address: DONATION, amount: '10.000' }] }, now, DAY).schedule.recipients[0].amount, '10');
  assert.equal(webhookUrl('https://127.1/hook').ok, false);
  assert.equal(webhookUrl('https://0x7f000001/hook').ok, false);
  assert.equal(ok.schedule.network, 'devnet');
  assert.equal(validateSchedule({ ...base, network: 'mainnet' }, now, DAY).ok, false);
  assert.equal(validateSchedule({ ...base, recipients: [{ address: DONATION, amount: '1.0000001' }] }, now, DAY).ok, false);
  assert.equal(validateSchedule({
    ...base,
    recipients: [{ address: DONATION, amount: '1' }, { address: DONATION, amount: '2' }],
  }, now, DAY).ok, false);
  assert.match(validateSchedule({ ...base, recipients: [{ address: TOKEN_PROGRAM, amount: '1' }] }, now, DAY).error, /program/i);
  assert.equal(webhookUrl('http://example.com/hook').ok, false);
  assert.equal(webhookUrl('https://127.0.0.1/hook').ok, false);
  assert.equal(webhookUrl('https://user:pass@example.com/hook').ok, false);
  assert.equal(webhookUrl('https://example.com/hooks/vectra').ok, true);
  const limited = take({ start: now, count: 2 }, now + 10, 2, 1000);
  assert.equal(limited.ok, false);
  assert.equal(take({ start: now, count: 2 }, now + 1001, 2, 1000).ok, true);
});

test('the next alarm is the sooner of the next due time and an open grace deadline', () => {
  const now = Date.parse('2026-04-01T00:00:00.000Z');
  const alarm = nextAlarmMs(
    [{ status: 'active', nextDueAt: '2026-04-03T00:00:00.000Z' }],
    [{ status: 'awaiting_signature', dueAt: '2026-04-01T00:00:00.000Z', graceMs: HOUR }],
    now,
  );
  assert.equal(alarm, now + HOUR);
  assert.equal(nextAlarmMs([{ status: 'paused', nextDueAt: '2026-04-01T00:00:00.000Z' }], [], now), null);
});
