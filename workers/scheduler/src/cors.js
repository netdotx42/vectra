const PAGES_ORIGIN = 'https://netdotx42.github.io';

export function allowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return '';
  if (origin === PAGES_ORIGIN) return origin;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:') return '';
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return '';
  if (url.username || url.password) return '';
  return origin;
}

export function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
