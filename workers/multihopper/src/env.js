import { fail } from './errors.js';

export const DEVNET_API_BASE = 'https://devnet.multihopper.com/api/v1';

const DENIED_HOSTS = new Set([
  'multihopper.com',
  'www.multihopper.com',
  'api.multihopper.com',
]);

export function resolveMode(env) {
  const forceMock = String(env.MOCK_MULTIHOPPER || '') === '1';
  const key = String(env.MULTIHOPPER_API_KEY || '').replace(/^\uFEFF/, '').trim();
  if (forceMock || !key) return { mode: 'mock', key: '' };
  if (/^mh_live_/i.test(key)) {
    throw fail('MH_003', 'An mh_live_ key belongs to production. This Worker will not use it.');
  }
  return { mode: 'live', key };
}

export function resolveUpstream(env) {
  const requested = String(env.MULTIHOPPER_BASE_URL || DEVNET_API_BASE).trim();
  let url;
  try {
    url = new URL(requested);
  } catch {
    throw fail('MH_003', 'The MultiHopper base URL is not a URL.');
  }
  const path = url.pathname.replace(/\/$/, '');
  if (url.protocol !== 'https:' || DENIED_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw fail('MH_003', 'Production MultiHopper is locked.');
  }
  if (url.hostname !== 'devnet.multihopper.com' || path !== '/api/v1') {
    throw fail('MH_003', 'Only https://devnet.multihopper.com/api/v1 is allowed.');
  }
  return DEVNET_API_BASE;
}

export function webhookSecret(env) {
  return String(env.MULTIHOPPER_WEBHOOK_SECRET || '').trim();
}
