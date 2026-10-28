/** Unsigned legacy transfer used only as a mock signing payload. It is not broadcast. */
export const MOCK_TX = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAECyxI0Sfd8aS+vbvUNHOEcQyiR3EcDUBBBktGxEH2Y7OYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQECAAAMAgAAAAAAAAAAAAAA';

const FILLERS = [
  '3yjTdRnCA8WBJGQtQH92RBzRjK4gHLxX28uijvGhdG1T',
  'DpHcmgT4WBN4E2kJhWe9WNbGxEgTM8U1rstSumS85YTy',
  'BTbiZrtQyDwUUXQ56rcC8TjbTZ6X6L9t3dLFGPHj4jUL',
];

export function mockScreening() {
  return {
    status: 'not_provided',
    message: 'Mock fixture. No sanctions screen ran. A live response shows a per-hop result only when MultiHopper includes one. A flag reason is not disclosed.',
  };
}

function feeRaw(amountRaw) {
  return (BigInt(amountRaw) * 50n) / 10000n;
}

function hopCountOf(input) {
  if (input.route) {
    const several = input.destinationCount || (input.destinations && input.destinations.length);
    if (several) return input.route.hops.length;
    return input.route.hops.length + 1;
  }
  return input.hops;
}

function arrivalOf(input) {
  if (input.route) return input.route.hops.reduce((sum, hop) => sum + hop.waitSeconds, 0);
  return input.arrivalSeconds;
}

function buildRoute(input, now) {
  const reserved = new Set([input.sourceOwner, input.recipientWallet, ...(input.destinations || []).map((item) => item.wallet)].filter(Boolean));
  const hops = [];
  let elapsed = 0;
  if (input.route) {
    input.route.hops.forEach((hop) => {
      hops.push({
        index: hops.length,
        address: hop.wallet,
        label: 'Custom hop',
        category: null,
        waitSeconds: hop.waitSeconds,
        scheduledAt: new Date(now + elapsed * 1000).toISOString(),
        executedAt: null,
        txSignature: null,
        screening: mockScreening(),
      });
      elapsed += hop.waitSeconds;
    });
    if (input.recipientWallet) {
      hops.push({
        index: hops.length,
        address: input.recipientWallet,
        label: 'Recipient',
        category: null,
        waitSeconds: 0,
        scheduledAt: new Date(now + elapsed * 1000).toISOString(),
        executedAt: null,
        txSignature: null,
        screening: mockScreening(),
      });
    }
    return { hops, arrivalSeconds: elapsed, hopCount: hops.length };
  }
  const count = input.hops;
  const arrival = input.arrivalSeconds;
  const fillers = [];
  for (let i = 0; i < FILLERS.length && fillers.length < count - 1; i++) {
    if (!reserved.has(FILLERS[i])) fillers.push(FILLERS[i]);
  }
  const slot = Math.max(1, Math.floor(arrival / count));
  for (let index = 0; index < count; index++) {
    const last = index === count - 1;
    hops.push({
      index,
      address: last ? (input.recipientWallet || (input.destinations && input.destinations[0] && input.destinations[0].wallet) || null) : (fillers[index] || null),
      label: last ? 'Recipient' : 'Mock hop wallet',
      category: null,
      waitSeconds: last ? arrival - slot * index : slot,
      scheduledAt: new Date(now + (last ? arrival : slot * index) * 1000).toISOString(),
      executedAt: null,
      txSignature: null,
      screening: mockScreening(),
    });
  }
  return { hops, arrivalSeconds: arrival, hopCount: count };
}

export function buildEstimate(input) {
  const count = hopCountOf(input);
  const arrivalSeconds = arrivalOf(input);
  const fee = feeRaw(input.amountRaw);
  const net = BigInt(input.amountRaw) - fee;
  const flat = 5000 * count;
  const rent = 2_039_280 * count;
  return {
    tier: 'mock',
    tierIndex: 0,
    percentFeeBps: 50,
    percentFeeRaw: fee.toString(),
    flatFeeLamportsPerHop: 5000,
    flatFeeLamportsPerRoute: 0,
    totalFlatFeeLamports: flat,
    integratorPercentShare: (fee / 2n).toString(),
    integratorFlatShare: 0,
    usdEquivalent: null,
    usdValueMicros: null,
    priceSource: 'mock',
    hopAmountRaw: net.toString(),
    cappedAtTierBoundary: false,
    destinationCount: input.destinationCount || (input.destinations ? input.destinations.length : null),
    isTestMode: true,
    tokens: {
      amountRaw: input.amountRaw,
      feeRaw: fee.toString(),
      netDeliveredRaw: net.toString(),
      decimals: 6,
    },
    sol: {
      requiredSolUpFrontLamports: 15_000_000 + rent + flat,
      minTransferAmountLamports: 2_039_280,
      breakdown: {
        routeInitRentLamports: rent,
        orchestratorRentLamports: 1_000_000,
        ataRentLamports: 2_039_280,
        transactionFeesLamports: 50000,
        priorityFeesLamports: 0,
        protocolFlatFeeLamports: flat,
        screeningFeeLamports: 0,
        dispersionRentLamports: input.destinationCount || (input.destinations && input.destinations.length) ? 2_039_280 : 0,
      },
      refundableLamports: 1_000_000,
      netCostLamports: 14_000_000 + flat,
    },
    route: input.route ? { hopCount: count, arrivalSeconds } : { hopCount: count, arrivalSeconds },
  };
}

export function createRecord(id, input, now) {
  const route = buildRoute(input, now);
  const fee = feeRaw(input.amountRaw);
  const transfer = {
    id,
    externalId: input.externalId || null,
    supportBundleId: 'MH-mock-' + id,
    tokenMint: input.tokenMint,
    amountRaw: input.amountRaw,
    amountTokens: input.amountTokens,
    sourceOwner: input.sourceOwner,
    recipientWallet: input.recipientWallet || null,
    destinationCount: input.destinations ? input.destinations.length : null,
    destinations: input.destinations ? input.destinations.map((item) => ({
      wallet: item.wallet,
      amountRaw: item.amountRaw,
      status: 'pending',
      payoutSignature: null,
      paidAt: null,
    })) : null,
    recipientReceivesRaw: (BigInt(input.amountRaw) - fee).toString(),
    hops: route.hopCount,
    arrivalSeconds: route.arrivalSeconds,
    pricingTier: 'mock',
    percentFeeBps: 50,
    totalFlatFeeLamports: 5000 * route.hopCount,
    status: 'quote',
    phase: 'quoted',
    isTest: true,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    createdAt: new Date(now).toISOString(),
    route: { hops: route.hops },
    screening: mockScreening(),
    signatures: { routeInit: [], sessionInit: [], hops: [] },
    lastError: null,
    progress: { hopsCompleted: 0, hopsTotal: route.hopCount },
  };
  return {
    created: true,
    transfer,
    keeperFundingSignature: '',
    routeInitSignatures: [],
    orchestratorInitSignature: '',
    sessionInitSignatures: [],
    dispersionInitSignatures: [],
    events: [],
    lastEvent: null,
  };
}

function finished(status) {
  return status === 'completed' || status === 'refunded' || status === 'expired' || status === 'failed';
}

export function prepareView(record) {
  if (!record || !record.created) {
    const error = new Error('missing');
    error.code = 'MH_030';
    throw error;
  }
  if (finished(record.transfer.status)) {
    const error = new Error('finished');
    error.code = 'MH_035';
    throw error;
  }
  const keeperDone = Boolean(record.keeperFundingSignature);
  const routeDone = record.routeInitSignatures.length > 0;
  const orchestratorDone = Boolean(record.orchestratorInitSignature);
  const sessionDone = record.sessionInitSignatures.length > 0;
  const dispersionDone = record.dispersionInitSignatures.length > 0;
  const several = Array.isArray(record.transfer.destinations) && record.transfer.destinations.length > 0;
  const preparedTxs = {
    keeperFundingTx: keeperDone ? null : MOCK_TX,
    routeInitTxs: routeDone ? [] : [{ base64: MOCK_TX }],
    orchestratorInitTx: orchestratorDone ? null : MOCK_TX,
    sessionInitTxs: sessionDone ? [] : [MOCK_TX],
    dispersionInitTxs: !several || dispersionDone ? [] : [MOCK_TX],
    recentBlockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 999_999_999,
    resume: {
      routeAlreadyDeployed: routeDone,
      existingHopCount: 0,
      totalHops: record.transfer.hops,
      orchestratorAlreadyInitialized: orchestratorDone,
      completedStepIndices: [],
      totalSteps: record.transfer.hops,
      keeperAlreadyFunded: keeperDone,
      dispersion: several ? { totalDestinations: record.transfer.destinations.length, orchestratorInitialized: dispersionDone, stepsInitialized: dispersionDone ? record.transfer.destinations.length : 0, routeExitBound: dispersionDone } : null,
      nothingToDo: keeperDone && routeDone && orchestratorDone && sessionDone && (!several || dispersionDone),
    },
  };
  record.transfer.status = record.transfer.status === 'processing' ? 'processing' : 'awaiting_signature';
  return { transfer: record.transfer, preparedTxs };
}

export function confirmRecord(record, body) {
  if (!record || !record.created) {
    const error = new Error('missing');
    error.code = 'MH_030';
    throw error;
  }
  if (finished(record.transfer.status)) {
    const error = new Error('finished');
    error.code = 'MH_035';
    throw error;
  }
  const needsKeeper = !record.keeperFundingSignature;
  if (needsKeeper && !body.keeperFundingSignature) {
    const error = new Error('keeper');
    error.code = 'MH_039';
    throw error;
  }
  if (body.keeperFundingSignature) record.keeperFundingSignature = body.keeperFundingSignature;
  if (body.routeInitSignatures.length) record.routeInitSignatures = body.routeInitSignatures;
  if (body.orchestratorInitSignature) record.orchestratorInitSignature = body.orchestratorInitSignature;
  if (body.sessionInitSignatures && body.sessionInitSignatures.length) record.sessionInitSignatures = body.sessionInitSignatures;
  if (body.dispersionInitSignatures && body.dispersionInitSignatures.length) record.dispersionInitSignatures = body.dispersionInitSignatures;
  const rest = record.routeInitSignatures.length || record.orchestratorInitSignature || record.sessionInitSignatures.length || record.dispersionInitSignatures.length;
  if (rest) {
    record.transfer.status = 'processing';
    record.transfer.phase = 'deploying';
  } else {
    record.transfer.status = 'awaiting_signature';
    record.transfer.phase = 'quoted';
  }
  record.transfer.signatures = {
    routeInit: record.routeInitSignatures,
    sessionInit: record.sessionInitSignatures,
    hops: (record.transfer.route.hops || []).map((hop) => hop.txSignature).filter(Boolean),
    keeperFunding: record.keeperFundingSignature || null,
  };
  return record;
}

export function applyWebhookToRecord(record, event) {
  const state = record && typeof record === 'object' ? record : { created: false, events: [], lastEvent: null };
  state.events = Array.isArray(state.events) ? state.events : [];
  state.overlayHops = Array.isArray(state.overlayHops) ? state.overlayHops : [];
  if (event.id && state.events.some((item) => item.id === event.id)) return state;
  state.events.push({ id: event.id, type: event.type, at: event.at });
  state.events = state.events.slice(-40);
  state.lastEvent = { type: event.type, at: event.at, transferId: event.transferId };
  if (event.status) state.overlayStatus = event.status;
  if (event.phase) state.overlayPhase = event.phase;
  if (event.hop) {
    const index = state.overlayHops.findIndex((hop) => hop.index === event.hop.index);
    if (index >= 0) state.overlayHops[index] = { ...state.overlayHops[index], ...event.hop, screening: event.hop.screening || state.overlayHops[index].screening };
    else state.overlayHops.push(event.hop);
    state.overlayHops.sort((left, right) => left.index - right.index);
  }
  if (state.transfer) {
    if (event.status) state.transfer.status = event.status;
    if (event.phase) state.transfer.phase = event.phase;
    if (state.overlayHops.length) {
      const hops = state.transfer.route && Array.isArray(state.transfer.route.hops) ? state.transfer.route.hops : [];
      state.overlayHops.forEach((hop) => {
        const index = hops.findIndex((item) => item.index === hop.index);
        if (index >= 0) hops[index] = { ...hops[index], ...hop, screening: hop.screening || hops[index].screening };
        else hops.push(hop);
      });
      hops.sort((left, right) => left.index - right.index);
      state.transfer.route = { hops };
      const done = hops.filter((hop) => hop.executedAt || hop.txSignature).length;
      state.transfer.progress = { hopsCompleted: done, hopsTotal: Math.max(hops.length, state.transfer.hops || hops.length) };
    }
  } else {
    state.pendingEvents = state.pendingEvents || [];
    state.pendingEvents.push(event);
  }
  return state;
}

export function hopLibrary() {
  return {
    devnetNote: 'Live devnet returns MH_019 for this endpoint. The wallets below are mock fixtures, not a vetted hop library, and devnet routes must use wallets you enter.',
    wallets: [
      {
        address: FILLERS[0],
        label: 'Mock hop wallet A',
        category: 'other',
        canEndRoute: true,
      },
    ],
    bundles: [
      { id: 'mix', categories: ['other'], available: 1 },
    ],
    categories: ['other'],
  };
}

export function blankWebhookState() {
  return { created: false, events: [], lastEvent: null, pendingEvents: [] };
}
