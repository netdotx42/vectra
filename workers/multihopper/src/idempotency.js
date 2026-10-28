const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readActionId(request) {
  const header = request.headers.get('x-vectra-action') || request.headers.get('idempotency-key') || '';
  const value = header.trim();
  if (!UUID.test(value)) return '';
  return value.toLowerCase();
}

export async function bodyHash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {{ bodyHash?: string, state?: string, response?: { status: number, body: unknown }, idempotencyKey?: string, startedAt?: number } | null} stored
 * @param {string} hash
 * @param {number} now
 */
export function decideReplay(stored, hash, now) {
  if (!stored) return { kind: 'fresh' };
  if (stored.bodyHash !== hash) return { kind: 'mismatch' };
  if (stored.state === 'done' && stored.response) return { kind: 'replay', response: stored.response };
  if (stored.state === 'inflight' && now - Number(stored.startedAt || 0) < 30000) return { kind: 'inflight' };
  return { kind: 'retry' };
}
