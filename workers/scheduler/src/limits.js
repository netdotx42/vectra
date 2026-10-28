export const LIMITS = {
  maxSchedules: 50,
  maxRecipients: 20,
  memoMax: 280,
  nameMax: 70,
  webhookMax: 300,
  bodyMax: 12000,
  reasonMax: 200,
  tokenTtlMs: 15 * 60 * 1000,
  nonceTtlMs: 5 * 60 * 1000,
  maxCatchup: 24,
  maxInbox: 100,
  maxAudit: 1000,
  maxRunsListed: 50,
  maxSignatures: 20,
  noncePerWallet: 8,
  nonceWindowMs: 10 * 60 * 1000,
  noncePerIp: 30,
  writesPerMinute: 30,
  readsPerMinute: 120,
  defaultGraceMs: 24 * 60 * 60 * 1000,
  minGraceMs: 1000,
  maxGraceMs: 7 * 24 * 60 * 60 * 1000,
  maxClockSkewMs: 60 * 1000,
  maxHorizonMs: 366 * 24 * 60 * 60 * 1000,
};

export function clampGrace(value, fallback) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : Number(fallback);
  if (!Number.isFinite(base)) return LIMITS.defaultGraceMs;
  return Math.min(LIMITS.maxGraceMs, Math.max(LIMITS.minGraceMs, Math.trunc(base)));
}

export function take(bucket, now, limit, windowMs) {
  const current = bucket && now - bucket.start < windowMs ? bucket : { start: now, count: 0 };
  if (current.count >= limit) return { ok: false, bucket: current };
  current.count += 1;
  return { ok: true, bucket: current };
}
