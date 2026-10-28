export const WEBHOOK_EVENTS = new Set([
  'transfer.quote_created',
  'transfer.deposit_confirmed',
  'transfer.processing',
  'transfer.phase_changed',
  'transfer.hop_complete',
  'transfer.completed',
  'transfer.failed',
  'transfer.expired',
  'transfer.refunded',
  'transfer.recoverable',
  'transfer.rescued',
  'transfer.rent_reclaimed',
  'payout.completed',
]);

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signWebhook(secret, body) {
  const key = await hmacKey(secret, 'sign');
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
  const signature = await crypto.subtle.sign('HMAC', key, bytes);
  return bytesToHex(signature);
}

export async function verifyWebhookSignature(secret, body, header) {
  const provided = String(header || '').trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const signature = hexToBytes(provided);
  if (!signature || signature.length !== 32) return false;
  const key = await hmacKey(secret, 'verify');
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
  return crypto.subtle.verify('HMAC', key, signature, bytes);
}

function asInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value)) return Number(value);
  return 0;
}

function screeningOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = typeof value.status === 'string' ? value.status.slice(0, 80) : '';
  const message = typeof value.message === 'string' ? value.message.slice(0, 400) : (typeof value.summary === 'string' ? value.summary.slice(0, 400) : '');
  if (!status && !message) return null;
  return { status, message };
}

function hopOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const index = asInteger(value.index) ? value.index : (Number.isInteger(value.index) ? value.index : null);
  if (index == null || index < 0 || index > 30) return null;
  const hop = { index };
  if (typeof value.address === 'string') hop.address = value.address.slice(0, 64);
  if (typeof value.txSignature === 'string') hop.txSignature = value.txSignature.slice(0, 128);
  if (typeof value.executedAt === 'string') hop.executedAt = value.executedAt.slice(0, 40);
  if (typeof value.scheduledAt === 'string') hop.scheduledAt = value.scheduledAt.slice(0, 40);
  const screening = screeningOf(value.screening);
  if (screening) hop.screening = screening;
  return hop;
}

export function parseWebhook(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const type = typeof json.type === 'string' ? json.type : (typeof json.event === 'string' ? json.event : '');
  if (!WEBHOOK_EVENTS.has(type)) return null;
  const data = json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
  const nested = data.transfer && typeof data.transfer === 'object' ? data.transfer : null;
  const transferId = asInteger(data.transferId) || asInteger(nested && nested.id) || asInteger(json.transferId) || 0;
  if (!transferId) return null;
  const hop = hopOf(data.hop) || (Array.isArray(data.hops) ? hopOf(data.hops.find((item) => item && item.executedAt || item && item.txSignature) || data.hops[0]) : null);
  return {
    id: typeof json.id === 'string' ? json.id.slice(0, 80) : '',
    type,
    at: typeof json.created === 'string' ? json.created.slice(0, 40) : new Date().toISOString(),
    transferId,
    status: typeof data.status === 'string' ? data.status.slice(0, 40) : (nested && typeof nested.status === 'string' ? nested.status.slice(0, 40) : ''),
    phase: typeof data.phase === 'string' ? data.phase.slice(0, 40) : '',
    hop,
  };
}
