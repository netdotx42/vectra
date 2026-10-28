const ESTIMATE_KEYS = [
  'tier', 'tierIndex', 'percentFeeBps', 'percentFeeRaw', 'flatFeeLamportsPerHop',
  'flatFeeLamportsPerRoute', 'totalFlatFeeLamports', 'integratorPercentShare',
  'integratorFlatShare', 'usdEquivalent', 'usdValueMicros', 'priceSource',
  'hopAmountRaw', 'cappedAtTierBoundary', 'destinationCount', 'isTestMode',
];

const SOL_KEYS = ['requiredSolUpFrontLamports', 'minTransferAmountLamports', 'refundableLamports', 'netCostLamports'];
const BREAKDOWN_KEYS = [
  'routeInitRentLamports', 'orchestratorRentLamports', 'ataRentLamports',
  'transactionFeesLamports', 'priorityFeesLamports', 'protocolFlatFeeLamports',
  'screeningFeeLamports', 'dispersionRentLamports',
];

function pick(source, keys) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  keys.forEach((key) => {
    if (source[key] !== undefined) out[key] = source[key];
  });
  return out;
}

export function screeningOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = typeof value.status === 'string' ? value.status.slice(0, 80) : '';
  const message = typeof (value.message || value.summary) === 'string' ? String(value.message || value.summary).slice(0, 400) : '';
  if (!status && !message) return null;
  return { status, message };
}

export function normalizeHop(hop, index) {
  if (!hop || typeof hop !== 'object') return null;
  const screening = screeningOf(hop.screening);
  return {
    index: Number.isInteger(hop.index) ? hop.index : index,
    address: typeof hop.address === 'string' ? hop.address : null,
    label: hop.label == null ? null : String(hop.label).slice(0, 120),
    category: hop.category == null ? null : String(hop.category).slice(0, 40),
    waitSeconds: Number.isInteger(hop.waitSeconds) ? hop.waitSeconds : null,
    scheduledAt: hop.scheduledAt || null,
    executedAt: hop.executedAt || null,
    txSignature: hop.txSignature || null,
    screening,
  };
}

export function normalizeEstimate(payload) {
  const source = payload || {};
  const out = pick(source, ESTIMATE_KEYS);
  if (source.tokens && typeof source.tokens === 'object') {
    out.tokens = pick(source.tokens, ['amountRaw', 'feeRaw', 'netDeliveredRaw', 'decimals']);
  }
  if (source.sol && typeof source.sol === 'object') {
    out.sol = pick(source.sol, SOL_KEYS);
    if (source.sol.breakdown) out.sol.breakdown = pick(source.sol.breakdown, BREAKDOWN_KEYS);
  }
  if (source.route && typeof source.route === 'object') {
    out.route = pick(source.route, ['hopCount', 'arrivalSeconds']);
  }
  return out;
}

export function normalizeTransfer(payload) {
  const source = payload && payload.transfer && payload.id == null ? payload.transfer : (payload || {});
  const hops = Array.isArray(source.route && source.route.hops) ? source.route.hops.map(normalizeHop).filter(Boolean) : [];
  return {
    id: source.id,
    externalId: source.externalId || null,
    supportBundleId: source.supportBundleId || null,
    tokenMint: source.tokenMint || null,
    amountRaw: source.amountRaw || null,
    amountTokens: source.amountTokens || null,
    sourceOwner: source.sourceOwner || null,
    recipientWallet: source.recipientWallet || null,
    destinationCount: source.destinationCount == null ? null : source.destinationCount,
    destinations: Array.isArray(source.destinations) ? source.destinations : null,
    recipientReceivesRaw: source.recipientReceivesRaw || null,
    hops: source.hops == null ? null : source.hops,
    arrivalSeconds: source.arrivalSeconds == null ? null : source.arrivalSeconds,
    pricingTier: source.pricingTier || source.tier || null,
    percentFeeBps: source.percentFeeBps == null ? null : source.percentFeeBps,
    totalFlatFeeLamports: source.totalFlatFeeLamports == null ? null : source.totalFlatFeeLamports,
    status: source.status || null,
    phase: source.phase || null,
    progress: source.progress || null,
    lastError: source.lastError || null,
    isTest: source.isTest == null ? null : source.isTest,
    quotedAt: source.quotedAt || null,
    expiresAt: source.expiresAt || null,
    createdAt: source.createdAt || null,
    signatures: source.signatures || null,
    route: hops.length ? { hops } : (source.route || null),
    screening: screeningOf(source.screening),
  };
}

export function normalizePrepare(payload) {
  const source = payload || {};
  const txs = source.preparedTxs || {};
  return {
    transfer: source.transfer ? normalizeTransfer(source.transfer) : null,
    preparedTxs: {
      keeperFundingTx: txs.keeperFundingTx || null,
      routeInitTxs: Array.isArray(txs.routeInitTxs) ? txs.routeInitTxs : (txs.routeInitTxs == null ? [] : []),
      orchestratorInitTx: txs.orchestratorInitTx || null,
      sessionInitTxs: Array.isArray(txs.sessionInitTxs) ? txs.sessionInitTxs : [],
      dispersionInitTxs: Array.isArray(txs.dispersionInitTxs) ? txs.dispersionInitTxs : [],
      recentBlockhash: txs.recentBlockhash || null,
      lastValidBlockHeight: txs.lastValidBlockHeight || null,
      resume: txs.resume || null,
    },
  };
}

export function mergeHops(baseHops, overlayHops) {
  const map = new Map();
  (baseHops || []).forEach((hop, index) => {
    const normalized = normalizeHop(hop, index);
    if (normalized) map.set(normalized.index, normalized);
  });
  (overlayHops || []).forEach((hop) => {
    if (!hop || !Number.isInteger(hop.index)) return;
    const prev = map.get(hop.index) || { index: hop.index, address: null, label: null, category: null, waitSeconds: null, scheduledAt: null, executedAt: null, txSignature: null, screening: null };
    const next = { ...prev };
    ['address', 'txSignature', 'executedAt', 'scheduledAt', 'label', 'category'].forEach((key) => {
      if (hop[key]) next[key] = hop[key];
    });
    if (hop.screening) next.screening = hop.screening;
    map.set(hop.index, next);
  });
  return [...map.values()].sort((left, right) => left.index - right.index);
}
