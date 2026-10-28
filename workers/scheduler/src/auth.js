import { LIMITS } from './limits.js';
import { base58Decode, base64UrlToBytes, bytesToBase64Url, isSolanaAddress } from './codec.js';

const encoder = new TextEncoder();

export function loginMessage(fields) {
  return [
    'Vectra Scheduler',
    'Sign in to prepare devnet payouts.',
    'This does not authorize a transfer.',
    '',
    'Wallet: ' + fields.wallet,
    'Nonce: ' + fields.nonce,
    'Issued at: ' + fields.issuedAt,
    'Expires at: ' + fields.expiresAt,
  ].join('\n');
}

export async function verifyEd25519(publicKey, signature, message) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) return false;
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return false;
  const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
}

export async function verifyWalletSignature(wallet, signatureText, message) {
  if (!isSolanaAddress(wallet)) return false;
  const publicKey = base58Decode(wallet);
  const signature = base58Decode(signatureText);
  if (!publicKey || !signature) return false;
  const bytes = typeof message === 'string' ? encoder.encode(message) : message;
  return verifyEd25519(publicKey, signature, bytes);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function issueToken(secret, wallet, nowMs, ttlMs = LIMITS.tokenTtlMs) {
  if (!secret || String(secret).length < 32) throw new Error('TOKEN_SECRET is not configured.');
  const payload = {
    v: 1,
    sub: wallet,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + ttlMs) / 1000),
  };
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
  return { token: body + '.' + bytesToBase64Url(mac), expiresAt: new Date(payload.exp * 1000).toISOString(), wallet };
}

export async function readToken(secret, token, nowMs) {
  if (!secret || String(secret).length < 32) return { ok: false, error: 'Scheduler auth is not configured.' };
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'Sign in again.' };
  let mac;
  let payloadBytes;
  try {
    mac = base64UrlToBytes(parts[1]);
    payloadBytes = base64UrlToBytes(parts[0]);
  } catch {
    return { ok: false, error: 'Sign in again.' };
  }
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, mac, encoder.encode(parts[0]));
  if (!valid) return { ok: false, error: 'Sign in again.' };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, error: 'Sign in again.' };
  }
  if (!payload || payload.v !== 1 || !isSolanaAddress(payload.sub)) return { ok: false, error: 'Sign in again.' };
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= nowMs) return { ok: false, error: 'Your sign-in expired. Sign in again.' };
  return { ok: true, wallet: payload.sub, exp: payload.exp };
}
