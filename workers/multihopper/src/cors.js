const ORIGINS = [
  /^https:\/\/netdotx42\.github\.io$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https:\/\/localhost(?::\d+)?$/,
  /^https:\/\/127\.0\.0\.1(?::\d+)?$/,
];

export function allowedOrigin(origin) {
  const value = String(origin || '');
  if (!value || value === 'null') return '';
  return ORIGINS.some((pattern) => pattern.test(value)) ? value : '';
}
