import { WalletScheduler } from './wallet-do.js';
import { SchedulerDirectory } from './directory-do.js';
import { allowedOrigin, corsHeaders } from './cors.js';
import { isSolanaAddress } from './codec.js';
import { readToken } from './auth.js';
import { LIMITS } from './limits.js';

export { WalletScheduler, SchedulerDirectory };

const SCHEDULE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID = /^[0-9a-f]{32}$/;
const INBOX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(result, origin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (origin) Object.assign(headers, corsHeaders(origin));
  const status = result.status || 200;
  return new Response(JSON.stringify(result.body), { status, headers });
}

function fromDo(result) {
  if (!result || result.ok === false) {
    return { status: (result && result.status) || 400, body: { error: (result && result.error) || 'Request failed.' } };
  }
  const body = { ...result };
  delete body.ok;
  return { status: 200, body };
}

async function readBody(request) {
  const claimed = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(claimed) && claimed > LIMITS.bodyMax) {
    return { error: 'Request body is too large.', status: 413 };
  }
  const text = await request.text();
  if (text.length > LIMITS.bodyMax) return { error: 'Request body is too large.', status: 413 };
  if (!text) return { value: {} };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Send a JSON object.', status: 400 };
    return { value };
  } catch {
    return { error: 'Send JSON.', status: 400 };
  }
}

function walletStub(env, wallet) {
  return env.WALLET_SCHEDULER.get(env.WALLET_SCHEDULER.idFromName(wallet));
}

function configured(env) {
  return !!(env.TOKEN_SECRET && String(env.TOKEN_SECRET).length >= 32);
}

async function session(request, env) {
  if (!configured(env)) return { error: 'Scheduler auth is not configured.', status: 503 };
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const read = await readToken(env.TOKEN_SECRET, token, Date.now());
  if (!read.ok) return { error: read.error, status: 401 };
  return { wallet: read.wallet };
}

async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'GET' && (path === '/' || path === '/v1/health')) {
    return { status: 200, body: { ok: true, service: 'vectra-scheduler', network: 'devnet' } };
  }
  if (!configured(env)) return { status: 503, body: { error: 'Scheduler auth is not configured.' } };

  if (request.method === 'POST' && path === '/v1/auth/nonce') {
    const body = await readBody(request);
    if (body.error) return { status: body.status, body: { error: body.error } };
    const wallet = String(body.value.wallet || '').trim();
    if (!isSolanaAddress(wallet)) return { status: 400, body: { error: 'Enter the wallet address that will sign in.' } };
    const directory = env.SCHEDULER_DIRECTORY.get(env.SCHEDULER_DIRECTORY.idFromName('global'));
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const gate = await directory.allow('ip:' + ip, LIMITS.noncePerIp, LIMITS.nonceWindowMs, Date.now());
    if (!gate.ok) return { status: 429, body: { error: 'Too many sign-in attempts. Wait a few minutes.' } };
    return fromDo(await walletStub(env, wallet).nonce(wallet));
  }

  if (request.method === 'POST' && path === '/v1/auth/verify') {
    const body = await readBody(request);
    if (body.error) return { status: body.status, body: { error: body.error } };
    const wallet = String(body.value.wallet || '').trim();
    if (!isSolanaAddress(wallet)) return { status: 400, body: { error: 'Enter the wallet address that will sign in.' } };
    return fromDo(await walletStub(env, wallet).verify(wallet, body.value.nonce, body.value.signature));
  }

  if (!path.startsWith('/v1/')) return { status: 404, body: { error: 'Not found.' } };

  const auth = await session(request, env);
  if (auth.error) return { status: auth.status, body: { error: auth.error } };
  const stub = walletStub(env, auth.wallet);
  const parts = path.split('/').filter(Boolean);

  if (request.method === 'GET' && path === '/v1/schedules') return fromDo(await stub.listSchedules(auth.wallet));
  if (request.method === 'POST' && path === '/v1/schedules') {
    const body = await readBody(request);
    if (body.error) return { status: body.status, body: { error: body.error } };
    return fromDo(await stub.createSchedule(auth.wallet, body.value));
  }
  if (parts[0] === 'v1' && parts[1] === 'schedules' && SCHEDULE_ID.test(parts[2] || '') && parts.length === 4) {
    const id = parts[2];
    if (request.method === 'POST' && parts[3] === 'pause') return fromDo(await stub.setScheduleStatus(auth.wallet, id, 'paused'));
    if (request.method === 'POST' && parts[3] === 'resume') return fromDo(await stub.setScheduleStatus(auth.wallet, id, 'active'));
  }
  if (request.method === 'DELETE' && parts[0] === 'v1' && parts[1] === 'schedules' && SCHEDULE_ID.test(parts[2] || '') && parts.length === 3) {
    return fromDo(await stub.setScheduleStatus(auth.wallet, parts[2], 'deleted'));
  }
  if (request.method === 'GET' && path === '/v1/runs') {
    const status = url.searchParams.get('status') || '';
    if (status && !/^[a-z_]{3,32}$/.test(status)) return { status: 400, body: { error: 'Unknown run status.' } };
    return fromDo(await stub.listRuns(auth.wallet, status));
  }
  if (request.method === 'GET' && parts[0] === 'v1' && parts[1] === 'runs' && RUN_ID.test(parts[2] || '') && parts.length === 3) {
    return fromDo(await stub.readRun(auth.wallet, parts[2]));
  }
  if (parts[0] === 'v1' && parts[1] === 'runs' && RUN_ID.test(parts[2] || '') && parts.length === 4) {
    const body = await readBody(request);
    if (body.error) return { status: body.status, body: { error: body.error } };
    if (request.method === 'POST' && parts[3] === 'signature') return fromDo(await stub.signRun(auth.wallet, parts[2], body.value));
    if (request.method === 'POST' && parts[3] === 'skip') return fromDo(await stub.skipRun(auth.wallet, parts[2], body.value.reason));
  }
  if (request.method === 'GET' && path === '/v1/inbox') return fromDo(await stub.listInbox(auth.wallet));
  if (request.method === 'POST' && parts[0] === 'v1' && parts[1] === 'inbox' && INBOX_ID.test(parts[2] || '') && parts[3] === 'read' && parts.length === 4) {
    return fromDo(await stub.markRead(auth.wallet, parts[2]));
  }
  if (request.method === 'GET' && path === '/v1/audit') {
    const runId = url.searchParams.get('runId') || '';
    if (runId && !RUN_ID.test(runId)) return { status: 400, body: { error: 'Unknown run.' } };
    return fromDo(await stub.listAudit(auth.wallet, runId));
  }
  return { status: 404, body: { error: 'Not found.' } };
}

export default {
  async fetch(request, env) {
    const originHeader = request.headers.get('origin');
    const origin = allowedOrigin(originHeader);
    if (originHeader && !origin) {
      return new Response(JSON.stringify({ error: 'Origin is not allowed.' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    try {
      return respond(await route(request, env, new URL(request.url)), origin);
    } catch (error) {
      console.log(JSON.stringify({ event: 'error', message: String(error && error.message || error) }));
      return respond({ status: 500, body: { error: 'The scheduler could not complete that request.' } }, origin);
    }
  },

  async scheduled(controller, env) {
    const now = Date.now();
    const directory = env.SCHEDULER_DIRECTORY.get(env.SCHEDULER_DIRECTORY.idFromName('global'));
    const wallets = await directory.listDue(now);
    for (const wallet of wallets) {
      try {
        const stub = walletStub(env, wallet);
        await stub.prepareDue(now);
      } catch (error) {
        console.log(JSON.stringify({ event: 'cron_wallet_failed', message: String(error && error.message || error) }));
        try {
          await directory.register(wallet, now + 60 * 1000);
        } catch {
          /* The next cron still sees this wallet if the defer does not land. */
        }
      }
    }
    console.log(JSON.stringify({ event: 'cron', cron: controller.cron, wallets: wallets.length }));
  },
};
