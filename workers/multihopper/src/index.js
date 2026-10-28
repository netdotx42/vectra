import { allowedOrigin } from './cors.js';
import { fail, friendlyCode, redact } from './errors.js';
import { resolveMode, resolveUpstream, webhookSecret } from './env.js';
import { HopperState } from './hopper-state.js';
import { bodyHash, readActionId } from './idempotency.js';
import { applyWebhookToRecord, blankWebhookState, buildEstimate, confirmRecord, createRecord, hopLibrary, prepareView } from './mock.js';
import { mergeHops, normalizeEstimate, normalizePrepare, normalizeTransfer } from './shapes.js';
import { validateConfirm, validateCreate, validateEstimate, validateTransferId } from './validate.js';
import { parseWebhook, verifyWebhookSignature } from './webhook.js';

export { HopperState };

const WINDOW_MS = 60_000;
const LIMITS = {
  estimate: 30,
  create: 10,
  prepare: 10,
  confirm: 10,
  status: 60,
  library: 30,
  webhook: 60,
};

const LIBRARY_CATEGORIES = new Set(['cex', 'dex', 'famous', 'kol', 'contracts', 'other']);
const LIBRARY_BUNDLES = new Set(['cex', 'dex', 'exchanges', 'kol', 'contracts', 'mix']);

function json(status, body, extra) {
  const headers = { 'content-type': 'application/json; charset=utf-8', ...(extra || {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

function stamp(body, mode) {
  return { ...body, mode, environment: 'devnet', productionLocked: true };
}

function canonicalJson(value) {
  return JSON.stringify(value, (key, item) => (item == null ? undefined : item));
}

function errorBody(error, mode) {
  const code = error && error.code ? error.code : 'MH_090';
  const mapped = fail(code);
  return stamp({
    error: {
      code,
      message: error && error.message ? error.message : mapped.message,
      detail: redact(error && error.detail),
    },
  }, mode || 'mock');
}

async function readJson(request) {
  const reader = request.body && request.body.getReader();
  if (!reader) return {};
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 32768) throw fail('BAD_REQUEST', 'Request body is too large.');
    chunks.push(value);
  }
  if (!total) return {};
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const text = new TextDecoder().decode(bytes);
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    throw fail('BAD_REQUEST', 'Request body is not JSON.');
  }
}

function clientAddress(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}

async function limit(env, request, bucket) {
  const stub = env.HOPPER.get(env.HOPPER.idFromName('rate:' + clientAddress(request)));
  const result = await stub.rateLimit({ bucket, limit: LIMITS[bucket], windowMs: WINDOW_MS });
  if (!result.ok) {
    const error = fail('MH_004');
    error.retryAfter = String(result.retryAfter || 1);
    throw error;
  }
}

async function idempotent(env, request, canonical, run) {
  const actionId = readActionId(request);
  if (!actionId) throw fail('MH_070');
  const hash = await bodyHash(canonical);
  const stub = env.HOPPER.get(env.HOPPER.idFromName('action:' + actionId));
  const begun = await stub.beginAction({ bodyHash: hash });
  if (begun.conflict === 'mismatch') throw fail('MH_071');
  if (begun.conflict === 'inflight') throw fail('MH_072');
  if (begun.replay) return { replay: true, status: begun.replay.status, body: begun.replay.body };
  try {
    const result = await run(begun.idempotencyKey);
    const ok = result.status >= 200 && result.status < 300;
    await stub.finishAction({ ok, status: result.status, body: result.body });
    return { replay: false, status: result.status, body: result.body };
  } catch (error) {
    try { await stub.finishAction({ ok: false }); } catch { /* The original error is the one to return. */ }
    throw error;
  }
}

async function upstream(env, mode, path, { method, body, idempotencyKey }) {
  const base = resolveUpstream(env);
  const headers = { accept: 'application/json', 'x-api-key': mode.key };
  if (body != null) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: body == null ? undefined : body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.log(JSON.stringify({ event: 'upstream_unreachable', path, message: String(error && error.name || 'fetch') }));
    throw fail('MH_091');
  }
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw fail('MH_090', 'MultiHopper returned a response that was not JSON.');
    }
  }
  if (!response.ok) {
    const code = friendlyCode(payload.error && payload.error.code) || (response.status === 429 ? 'MH_004' : 'MH_090');
    const error = fail(code, redact(payload.error && payload.error.message));
    error.status = STATUS_FROM_UPSTREAM(response.status, error.status);
    const retry = response.headers.get('retry-after');
    if (retry) error.retryAfter = retry;
    throw error;
  }
  console.log(JSON.stringify({ event: 'upstream_ok', path, status: response.status }));
  return payload;
}

function STATUS_FROM_UPSTREAM(upstreamStatus, fallback) {
  if (upstreamStatus >= 400 && upstreamStatus <= 599) return upstreamStatus;
  return fallback;
}

function transferStub(env, id) {
  return env.HOPPER.get(env.HOPPER.idFromName('transfer:' + id));
}

async function rememberMock(env, id, record) {
  const stub = transferStub(env, id);
  const existing = await stub.readRecord();
  let next = record;
  if (existing && Array.isArray(existing.pendingEvents)) {
    existing.pendingEvents.forEach((event) => {
      next = applyWebhookToRecord(next, event);
    });
  }
  await stub.writeRecord(next);
  return next;
}

function libraryQuery(url) {
  const allowed = new Set(['category', 'bundle', 'canEndRoute']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw fail('BAD_REQUEST', 'Unknown hop library filter.');
  }
  const category = url.searchParams.get('category');
  const bundle = url.searchParams.get('bundle');
  const canEndRoute = url.searchParams.get('canEndRoute');
  if (category && !LIBRARY_CATEGORIES.has(category)) throw fail('BAD_REQUEST', 'Unknown hop library category.');
  if (bundle && !LIBRARY_BUNDLES.has(bundle)) throw fail('BAD_REQUEST', 'Unknown hop library bundle.');
  if (canEndRoute && canEndRoute !== 'true' && canEndRoute !== 'false') throw fail('BAD_REQUEST', 'canEndRoute must be true or false.');
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (bundle) params.set('bundle', bundle);
  if (canEndRoute) params.set('canEndRoute', canEndRoute);
  const query = params.toString();
  return query ? '?' + query : '';
}

async function handleEstimate(request, env, mode) {
  await limit(env, request, 'estimate');
  const input = validateEstimate(await readJson(request));
  const canonical = canonicalJson(input);
  return idempotent(env, request, canonical, async (idempotencyKey) => {
    if (mode.mode === 'mock') {
      return { status: 200, body: stamp(normalizeEstimate(buildEstimate(input)), 'mock') };
    }
    const payload = await upstream(env, mode, '/transfers/estimate', {
      method: 'POST',
      body: canonical,
      idempotencyKey,
    });
    return { status: 200, body: stamp(normalizeEstimate(payload), 'live') };
  });
}

async function handleCreate(request, env, mode) {
  await limit(env, request, 'create');
  const actionId = readActionId(request);
  if (!actionId) throw fail('MH_070');
  const input = validateCreate(await readJson(request));
  if (!input.externalId) input.externalId = ('vectra-' + actionId).slice(0, 64);
  const canonical = canonicalJson(input);
  return idempotent(env, request, canonical, async (idempotencyKey) => {
    if (mode.mode === 'mock') {
      const seq = env.HOPPER.get(env.HOPPER.idFromName('mock-seq'));
      const allocated = await seq.allocateTransfer({ externalId: input.externalId, hash: await bodyHash(canonical) });
      if (allocated.conflict) throw fail('MH_033');
      if (allocated.existing) {
        const existing = await transferStub(env, allocated.id).readRecord();
        if (existing && existing.created) return { status: 200, body: stamp(normalizeTransfer(existing.transfer), 'mock') };
      }
      const record = createRecord(allocated.id, input, Date.now());
      await rememberMock(env, allocated.id, record);
      return { status: 200, body: stamp(normalizeTransfer(record.transfer), 'mock') };
    }
    const payload = await upstream(env, mode, '/transfers', {
      method: 'POST',
      body: canonical,
      idempotencyKey,
    });
    return { status: 200, body: stamp(normalizeTransfer(payload), 'live') };
  });
}

async function handlePrepare(request, env, mode, id) {
  await limit(env, request, 'prepare');
  const canonical = canonicalJson({ transferId: id });
  return idempotent(env, request, canonical, async (idempotencyKey) => {
    if (mode.mode === 'mock') {
      const stub = transferStub(env, id);
      const record = await stub.readRecord();
      let prepared;
      try {
        prepared = prepareView(record);
      } catch (error) {
        throw fail(error.code || 'MH_030');
      }
      record.transfer = prepared.transfer;
      await stub.writeRecord(record);
      return { status: 200, body: stamp(normalizePrepare(prepared), 'mock') };
    }
    const payload = await upstream(env, mode, '/transfers/' + id + '/prepare', {
      method: 'POST',
      idempotencyKey,
    });
    return { status: 200, body: stamp(normalizePrepare(payload), 'live') };
  });
}

async function handleConfirm(request, env, mode, id) {
  await limit(env, request, 'confirm');
  const input = validateConfirm(await readJson(request));
  const canonical = canonicalJson({ transferId: id, ...input });
  return idempotent(env, request, canonical, async (idempotencyKey) => {
    if (mode.mode === 'mock') {
      const stub = transferStub(env, id);
      const record = await stub.readRecord();
      let next;
      try {
        next = confirmRecord(record, input);
      } catch (error) {
        throw fail(error.code || 'MH_030');
      }
      await stub.writeRecord(next);
      return { status: 200, body: stamp({ transfer: normalizeTransfer(next.transfer) }, 'mock') };
    }
    const payload = await upstream(env, mode, '/transfers/' + id + '/confirm-broadcast', {
      method: 'POST',
      body: JSON.stringify(input),
      idempotencyKey,
    });
    const transfer = payload.transfer ? normalizeTransfer(payload.transfer) : normalizeTransfer(payload);
    return { status: 200, body: stamp({ transfer }, 'live') };
  });
}

async function handleStatus(request, env, mode, id) {
  await limit(env, request, 'status');
  const stub = transferStub(env, id);
  const record = await stub.readRecord();
  if (mode.mode === 'mock') {
    if (!record || !record.created) throw fail('MH_030');
    return { status: 200, body: stamp(normalizeTransfer(record.transfer), 'mock') };
  }
  const payload = await upstream(env, mode, '/transfers/' + id, { method: 'GET' });
  const transfer = normalizeTransfer(payload);
  if (record && Array.isArray(record.overlayHops) && record.overlayHops.length) {
    const base = transfer.route && transfer.route.hops ? transfer.route.hops : [];
    transfer.route = { hops: mergeHops(base, record.overlayHops) };
  }
  if (record && record.overlayStatus) transfer.status = record.overlayStatus;
  if (record && record.overlayPhase) transfer.phase = record.overlayPhase;
  if (record && record.lastEvent) transfer.webhook = record.lastEvent;
  return { status: 200, body: stamp(transfer, 'live') };
}

async function handleLibrary(request, env, mode, url) {
  await limit(env, request, 'library');
  const query = libraryQuery(url);
  if (mode.mode === 'mock') return { status: 200, body: stamp(hopLibrary(), 'mock') };
  try {
    const payload = await upstream(env, mode, '/hop-library' + query, { method: 'GET' });
    return { status: 200, body: stamp(payload, 'live') };
  } catch (error) {
    if (error.code === 'MH_019') throw error;
    throw error;
  }
}

async function handleWebhook(request, env, mode) {
  await limit(env, request, 'webhook');
  const secret = webhookSecret(env);
  if (!secret) throw fail('MH_091', 'The webhook secret is not configured.');
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > 32768) throw fail('BAD_REQUEST', 'Webhook body is too large.');
  const ok = await verifyWebhookSignature(secret, raw, request.headers.get('x-multihopper-signature'));
  if (!ok) throw fail('WEBHOOK_SIGNATURE');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw fail('BAD_REQUEST', 'Webhook body is not JSON.');
  }
  const event = parseWebhook(payload);
  if (!event) throw fail('BAD_REQUEST', 'Webhook event type or transfer id was not recognized.');
  const stub = transferStub(env, event.transferId);
  const existing = await stub.readRecord() || blankWebhookState();
  const next = applyWebhookToRecord(existing, event);
  await stub.writeRecord(next);
  console.log(JSON.stringify({ event: 'webhook', type: event.type, transferId: event.transferId }));
  return { status: 200, body: { received: true } };
}

async function route(request, env, url) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  const mode = resolveMode(env);
  if (path === '/health' && request.method === 'GET') {
    return { status: 200, body: stamp({ ok: true, service: 'vectra-multihopper' }, mode.mode) };
  }
  if (path === '/v1/webhooks/multihopper' && request.method === 'POST') return handleWebhook(request, env, mode);
  if (path === '/v1/transfers/estimate' && request.method === 'POST') return handleEstimate(request, env, mode);
  if (path === '/v1/transfers' && request.method === 'POST') return handleCreate(request, env, mode);
  if (path === '/v1/hop-library' && request.method === 'GET') return handleLibrary(request, env, mode, url);
  const transfer = path.match(/^\/v1\/transfers\/([0-9]+)(?:\/(prepare|confirm-broadcast))?$/);
  if (transfer) {
    const id = validateTransferId(transfer[1]);
    const action = transfer[2] || '';
    if (!action && request.method === 'GET') return handleStatus(request, env, mode, id);
    if (action === 'prepare' && request.method === 'POST') return handlePrepare(request, env, mode, id);
    if (action === 'confirm-broadcast' && request.method === 'POST') return handleConfirm(request, env, mode, id);
  }
  const missing = fail('MH_030');
  missing.message = 'That routing endpoint is not available.';
  throw missing;
}

function withCors(request, response) {
  const headers = new Headers(response.headers);
  const origin = allowedOrigin(request.headers.get('origin'));
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'origin');
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    headers.set('access-control-allow-headers', 'content-type, x-vectra-action, idempotency-key');
    headers.set('access-control-expose-headers', 'retry-after, x-vectra-idempotent');
    headers.set('access-control-max-age', '600');
  }
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const originHeader = request.headers.get('origin');
    if (originHeader && !allowedOrigin(originHeader)) {
      return json(403, { error: { code: 'MH_003', message: 'This origin is not allowed to call the routing proxy.' } });
    }
    if (request.method === 'OPTIONS') {
      return withCors(request, new Response(null, { status: 204 }));
    }
    let mode = 'mock';
    try {
      mode = resolveMode(env).mode;
      const result = await route(request, env, new URL(request.url));
      const headers = {};
      if (result.replay) headers['x-vectra-idempotent'] = 'replay';
      return withCors(request, json(result.status, result.body, headers));
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      const headers = {};
      if (error && error.retryAfter) headers['retry-after'] = String(error.retryAfter);
      if (!(error instanceof Error) || !error.code) {
        console.log(JSON.stringify({ event: 'proxy_error', message: String(error && error.message || 'error') }));
      }
      return withCors(request, json(status, errorBody(error && error.code ? error : fail('MH_090'), mode), headers));
    }
  },
};
