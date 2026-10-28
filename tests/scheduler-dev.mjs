import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { base58Encode } from '../workers/scheduler/src/codec.js';

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
const DONATION = 'Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR';
const root = path.join(import.meta.dirname, '..', 'workers', 'scheduler');
const port = 8787;
const base = 'http://127.0.0.1:' + port;
const secret = 'dev-secret-dev-secret-dev-secret-32';

const persist = await mkdtemp(path.join(tmpdir(), 'vectra-scheduler-'));
await writeFile(path.join(root, '.dev.vars'), 'TOKEN_SECRET=' + secret + '\n');

const child = spawn('npx', [
  'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1',
  '--show-interactive-dev-session', 'false',
  '--test-scheduled', '--persist-to', persist, '--var', 'GRACE_PERIOD_MS:86400000',
], {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CI: 'true' },
});

let log = '';
child.stdout.on('data', (chunk) => { log += chunk; });
child.stderr.on('data', (chunk) => { log += chunk; });

function waitForReady() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      if (log.includes('Ready on') || log.includes('127.0.0.1:' + port)) {
        try {
          const response = await fetch(base + '/v1/health');
          if (response.ok) {
            resolve();
            return;
          }
        } catch { /* Wrangler is still booting. */ }
      }
      if (Date.now() - started > 90000) reject(new Error('wrangler dev did not become ready\n' + log.slice(-2000)));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

async function send(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(base + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: response.status, json, headers: response.headers };
}

try {
  await waitForReady();
  const health = await send('/v1/health');
  if (health.status !== 200 || health.json.network !== 'devnet') {
    throw new Error('health failed ' + JSON.stringify(health.json));
  }

  const blocked = await send('/v1/health', { headers: { origin: 'https://evil.example' } });
  if (blocked.status !== 403) throw new Error('evil origin was allowed ' + blocked.status);

  const keys = pair();
  const wallet = base58Encode(keys.publicKey);
  const nonce = await send('/v1/auth/nonce', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:8080' },
    body: { wallet },
  });
  if (nonce.status !== 200 || !nonce.json.message) throw new Error('nonce failed ' + JSON.stringify(nonce.json));
  if (!nonce.headers.get('access-control-allow-origin')) throw new Error('localhost CORS missing');

  const bad = await send('/v1/auth/verify', {
    method: 'POST',
    body: { wallet, nonce: nonce.json.nonce, signature: base58Encode(new Uint8Array(64).fill(3)) },
  });
  if (bad.status !== 401) throw new Error('bad signature was accepted ' + bad.status);

  const challenge = await send('/v1/auth/nonce', { method: 'POST', body: { wallet } });
  const signature = base58Encode(keys.sign(new TextEncoder().encode(challenge.json.message)));
  const session = await send('/v1/auth/verify', {
    method: 'POST',
    body: { wallet, nonce: challenge.json.nonce, signature },
  });
  if (session.status !== 200 || !session.json.token) throw new Error('verify failed ' + JSON.stringify(session.json));
  const auth = { authorization: 'Bearer ' + session.json.token };

  const denied = await send('/v1/schedules');
  if (denied.status !== 401) throw new Error('missing token was allowed ' + denied.status);

  const past = new Date(Date.now() - 2 * 60 * 1000);
  const created = await send('/v1/schedules', {
    method: 'POST',
    headers: auth,
    body: {
      name: 'Devnet due run',
      frequency: 'once',
      timezone: 'UTC',
      date: past.toISOString().slice(0, 10),
      hour: past.getUTCHours(),
      minute: past.getUTCMinutes(),
      recipients: [{ address: DONATION, amount: '1.5' }],
      memo: 'scheduler dev',
      network: 'devnet',
    },
  });
  if (created.status !== 200 || !created.json.prepared?.length) {
    throw new Error('create did not prepare a run ' + JSON.stringify(created.json));
  }
  const runId = created.json.prepared[0].id;
  if (created.json.prepared[0].status !== 'awaiting_signature') {
    throw new Error('run was not awaiting a signature ' + created.json.prepared[0].status);
  }

  const cron = await fetch(base + '/__scheduled?cron=*+*+*+*+*');
  if (!cron.ok) throw new Error('scheduled handler failed ' + cron.status + ' ' + await cron.text());
  const runs = await send('/v1/runs?status=awaiting_signature', { headers: auth });
  const matches = (runs.json.runs || []).filter((run) => run.id === runId);
  if (matches.length !== 1) throw new Error('cron duplicated or dropped the run ' + JSON.stringify(runs.json));

  const inbox = await send('/v1/inbox', { headers: auth });
  if (!(inbox.json.inbox || []).some((item) => item.runId === runId)) throw new Error('inbox notice missing');
  const audit = await send('/v1/audit?runId=' + runId, { headers: auth });
  const states = (audit.json.audit || []).map((entry) => entry.toStatus);
  if (!states.includes('prepared') || !states.includes('awaiting_signature')) {
    throw new Error('audit missing prepare transition ' + states.join(','));
  }

  const tx = base58Encode(Uint8Array.from({ length: 64 }, (_, index) => index + 1));
  const signed = await send('/v1/runs/' + runId + '/signature', {
    method: 'POST',
    headers: auth,
    body: { signatures: [tx], status: 'sent' },
  });
  if (signed.status !== 200 || signed.json.run.status !== 'sent') {
    throw new Error('signature was not recorded ' + JSON.stringify(signed.json));
  }
  const again = await send('/v1/runs/' + runId + '/signature', {
    method: 'POST',
    headers: auth,
    body: { signatures: [tx], status: 'sent' },
  });
  if (again.status !== 409) throw new Error('second signature was accepted ' + again.status);

  const otherKeys = pair();
  const other = base58Encode(otherKeys.publicKey);
  const foreign = await send('/v1/auth/nonce', { method: 'POST', body: { wallet: other } });
  const foreignSig = base58Encode(pair().sign(new TextEncoder().encode(foreign.json.message)));
  if (foreign.status !== 200) throw new Error('second nonce failed');
  const foreignVerify = await send('/v1/auth/verify', {
    method: 'POST',
    body: { wallet: other, nonce: foreign.json.nonce, signature: foreignSig },
  });
  if (foreignVerify.status !== 401) throw new Error('unrelated key was accepted');

  const weekly = await send('/v1/schedules', {
    method: 'POST',
    headers: auth,
    body: {
      name: 'Weekly payroll',
      frequency: 'weekly',
      timezone: 'America/New_York',
      weekday: 1,
      hour: 9,
      minute: 30,
      recipients: [{ address: DONATION, amount: '2' }],
      memo: 'weekly',
      network: 'devnet',
    },
  });
  if (weekly.status !== 200 || weekly.json.schedule?.status !== 'active') {
    throw new Error('weekly schedule was not saved ' + JSON.stringify(weekly.json));
  }
  const scheduleId = weekly.json.schedule.id;
  const paused = await send('/v1/schedules/' + scheduleId + '/pause', { method: 'POST', headers: auth, body: {} });
  if (paused.status !== 200 || paused.json.schedule.status !== 'paused') throw new Error('pause failed ' + JSON.stringify(paused.json));
  const resumed = await send('/v1/schedules/' + scheduleId + '/resume', { method: 'POST', headers: auth, body: {} });
  if (resumed.status !== 200 || resumed.json.schedule.status !== 'active' || !resumed.json.schedule.nextDueAt) {
    throw new Error('resume failed ' + JSON.stringify(resumed.json));
  }
  const removed = await send('/v1/schedules/' + scheduleId, { method: 'DELETE', headers: auth });
  if (removed.status !== 200 || removed.json.schedule.status !== 'deleted') throw new Error('delete failed ' + JSON.stringify(removed.json));
  const remaining = await send('/v1/schedules', { headers: auth });
  if ((remaining.json.schedules || []).some((item) => item.id === scheduleId)) throw new Error('deleted schedule was still listed');

  console.log('scheduler dev checks passed');
} finally {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The process group has already exited. */ }
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await rm(persist, { recursive: true, force: true });
  await rm(path.join(root, '.dev.vars'), { force: true });
}
