import { isSignature, isSolanaAddress } from './base58.js';
import { fail } from './errors.js';

export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const LIMITS = {
  waitMin: 20,
  waitMax: 2_592_000,
  arrivalMin: 60,
  arrivalMax: 2_592_000,
  routeMaxSeconds: 2_592_000,
  customSingleMin: 2,
  customSingleMax: 9,
  customMultiMin: 3,
  customMultiMax: 10,
  defaultHopsMin: 3,
  defaultHopsMax: 10,
  destinationsMin: 2,
  destinationsMax: 20,
};

const DAY_SECONDS = 2_592_000;
const MAX_RAW = 18446744073709551615n;
const EXTERNAL_ID = /^[A-Za-z0-9._-]{1,64}$/;

const PROTOCOL = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  '3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh',
  '4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX',
  '2JEv3pD6nczEvn1xDXaEzehkJofPPjoQQpnW5nGY3r52',
]);

function objectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('BAD_REQUEST', 'JSON object required.');
  return body;
}

function rawAmount(value, label) {
  const text = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(text)) throw fail('MH_012', label + ' must be a positive whole number of base units.');
  let amount;
  try {
    amount = BigInt(text);
  } catch {
    throw fail('MH_012', label + ' is not a number.');
  }
  if (amount <= 0n) throw fail('MH_012', label + ' must be greater than zero.');
  if (amount > MAX_RAW) throw fail('MH_012', label + ' is too large.');
  return amount.toString();
}

function formatUnits(raw, decimals) {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const fracText = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracText ? whole.toString() + '.' + fracText : whole.toString();
}

function address(value, label) {
  const text = String(value ?? '').trim();
  if (!isSolanaAddress(text)) throw fail('MH_011', label + ' is not a Solana address.');
  return text;
}

function integer(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw fail('BAD_REQUEST', label + ' must be a whole number.');
  }
  return value;
}

function assertToken(body) {
  if (body.tokenMint != null && body.tokenMint !== DEVNET_USDC_MINT) {
    throw fail('MH_010', 'Only the devnet USDC mint is accepted.');
  }
  if (body.tokenDecimals != null && body.tokenDecimals !== 6) throw fail('MH_010', 'Devnet USDC uses 6 decimals.');
  if (body.tokenSymbol != null && body.tokenSymbol !== 'USDC') throw fail('MH_010', 'This proxy routes USDC.');
  if (body.routeTemplateId != null) throw fail('BAD_REQUEST', 'Saved route templates are not enabled.');
}

function readRoute(body, several) {
  const hasRoute = body.route != null;
  const hasDefault = body.hops != null || body.arrivalSeconds != null;
  if (hasRoute && hasDefault) throw fail('MH_018', 'Send a custom route or hops and arrivalSeconds, not both.');
  if (!hasRoute && !hasDefault) throw fail('MH_013', 'Choose a default hop count or a custom route.');
  if (!hasRoute) {
    const hops = integer(body.hops, 'hops');
    const arrivalSeconds = integer(body.arrivalSeconds, 'arrivalSeconds');
    if (hops < LIMITS.defaultHopsMin || hops > LIMITS.defaultHopsMax) {
      throw fail('MH_013', 'Default routes use 3 to 10 hops.');
    }
    if (arrivalSeconds < LIMITS.arrivalMin || arrivalSeconds > LIMITS.arrivalMax) {
      throw fail('MH_014', 'Arrival time must be from 60 seconds to 30 days.');
    }
    return { hops, arrivalSeconds, route: null };
  }
  const route = body.route;
  if (!route || typeof route !== 'object' || Array.isArray(route) || !Array.isArray(route.hops)) {
    throw fail('BAD_REQUEST', 'route.hops must be a list.');
  }
  const min = several ? LIMITS.customMultiMin : LIMITS.customSingleMin;
  const max = several ? LIMITS.customMultiMax : LIMITS.customSingleMax;
  if (route.hops.length < min || route.hops.length > max) {
    throw fail(
      'MH_013',
      several
        ? 'A custom route to several destinations needs 3 to 10 hops.'
        : 'A custom route to one recipient needs 2 to 9 hops. The recipient is added as the last hop.',
    );
  }
  let total = 0;
  const hops = route.hops.map((hop, index) => {
    if (!hop || typeof hop !== 'object' || Array.isArray(hop)) throw fail('BAD_REQUEST', 'route.hops[' + index + '] must be an object.');
    const keys = Object.keys(hop);
    if (keys.some((key) => key !== 'wallet' && key !== 'waitSeconds' && key !== 'bundle')) {
      throw fail('BAD_REQUEST', 'route.hops[' + index + '] has an unknown field.');
    }
    if (hop.bundle != null) throw fail('MH_019', 'route.hops[' + index + '] uses a hop-library bundle. Devnet does not serve that library.');
    if (hop.wallet == null) throw fail('BAD_REQUEST', 'route.hops[' + index + '] needs a wallet.');
    const wallet = address(hop.wallet, 'route.hops[' + index + '].wallet');
    const waitSeconds = integer(hop.waitSeconds, 'route.hops[' + index + '].waitSeconds');
    if (waitSeconds < LIMITS.waitMin || waitSeconds > LIMITS.waitMax) {
      throw fail('MH_018', 'route.hops[' + index + '].waitSeconds must be from 20 seconds to 30 days.');
    }
    total += waitSeconds;
    return { wallet, waitSeconds };
  });
  if (total > DAY_SECONDS) throw fail('MH_018', 'The waits add up to more than 30 days.');
  return { hops: null, arrivalSeconds: null, route: { hops } };
}

function partyRules(route, sourceOwner, recipientWallet, destinations) {
  if (!route) return;
  const blocked = new Set([sourceOwner, recipientWallet, ...destinations.map((item) => item.wallet)].filter(Boolean));
  const seen = new Set();
  route.hops.forEach((hop, index) => {
    if (blocked.has(hop.wallet)) {
      throw fail('MH_018', 'route.hops[' + index + '] repeats the sender, recipient, or a destination.');
    }
    if (seen.has(hop.wallet)) throw fail('MH_018', 'route.hops[' + index + '] repeats a hop wallet.');
    seen.add(hop.wallet);
  });
  if (destinations.length) {
    const last = route.hops[route.hops.length - 1];
    if (PROTOCOL.has(last.wallet)) throw fail('MH_018', 'The last hop of a multi-destination route must be a regular wallet.');
  }
}

function readDestinations(body) {
  const hasRecipient = body.recipientWallet != null && body.recipientWallet !== '';
  const hasDestinations = body.destinations != null;
  if (hasRecipient === hasDestinations) throw fail('BAD_REQUEST', 'Send recipientWallet or destinations, not both.');
  if (!hasDestinations) return { recipientWallet: null, destinations: [] };
  if (!Array.isArray(body.destinations)) throw fail('BAD_REQUEST', 'destinations must be a list.');
  if (body.destinations.length < LIMITS.destinationsMin || body.destinations.length > LIMITS.destinationsMax) {
    throw fail('MH_017', 'Send 2 to 20 destinations, or use one recipient.');
  }
  const seen = new Set();
  const destinations = body.destinations.map((item, index) => {
    if (!item || typeof item !== 'object') throw fail('BAD_REQUEST', 'destinations[' + index + '] must be an object.');
    const wallet = address(item.wallet, 'destinations[' + index + '].wallet');
    if (PROTOCOL.has(wallet)) throw fail('MH_011', 'destinations[' + index + '] is a program address.');
    if (seen.has(wallet)) throw fail('MH_011', 'Destination wallets must be distinct.');
    seen.add(wallet);
    return { wallet, amountRaw: rawAmount(item.amountRaw, 'destinations[' + index + '].amountRaw') };
  });
  return { recipientWallet: null, destinations };
}

function amountTokens(raw, supplied) {
  const expected = formatUnits(raw, 6);
  if (supplied == null || supplied === '') return expected;
  if (String(supplied).trim() !== expected) throw fail('MH_012', 'amountTokens does not match amountRaw at 6 decimals.');
  return expected;
}

export function validateEstimate(body) {
  const input = objectBody(body);
  assertToken(input);
  const amountRaw = rawAmount(input.amountRaw, 'amountRaw');
  const several = input.destinationCount != null || (Array.isArray(input.destinations) && input.destinations.length > 1);
  let destinationCount = null;
  if (input.destinationCount != null) {
    destinationCount = integer(input.destinationCount, 'destinationCount');
    if (destinationCount < LIMITS.destinationsMin || destinationCount > LIMITS.destinationsMax) {
      throw fail('MH_017', 'destinationCount must be from 2 to 20.');
    }
  }
  const timing = readRoute(input, several || (destinationCount != null && destinationCount > 1));
  return {
    tokenMint: DEVNET_USDC_MINT,
    amountRaw,
    tokenDecimals: 6,
    destinationCount,
    hops: timing.hops,
    arrivalSeconds: timing.arrivalSeconds,
    route: timing.route,
  };
}

export function validateCreate(body) {
  const input = objectBody(body);
  assertToken(input);
  const amountRaw = rawAmount(input.amountRaw, 'amountRaw');
  const sourceOwner = address(input.sourceOwner, 'sourceOwner');
  if (PROTOCOL.has(sourceOwner)) throw fail('MH_011', 'sourceOwner must be the signing wallet.');
  const parties = readDestinations(input);
  if (parties.recipientWallet == null && input.recipientWallet) {
    parties.recipientWallet = address(input.recipientWallet, 'recipientWallet');
  }
  if (!parties.destinations.length) {
    parties.recipientWallet = address(input.recipientWallet, 'recipientWallet');
    if (PROTOCOL.has(parties.recipientWallet)) throw fail('MH_018', 'The recipient must be a regular wallet.');
    if (parties.recipientWallet === sourceOwner) throw fail('MH_018', 'The recipient and the sender are the same wallet.');
  }
  let sum = 0n;
  parties.destinations.forEach((item) => {
    if (item.wallet === sourceOwner) throw fail('MH_018', 'A destination is the sending wallet.');
    sum += BigInt(item.amountRaw);
  });
  if (parties.destinations.length && sum !== BigInt(amountRaw)) {
    throw fail('MH_012', 'Destination amounts must add up to amountRaw.');
  }
  const timing = readRoute(input, parties.destinations.length > 0);
  partyRules(timing.route, sourceOwner, parties.recipientWallet, parties.destinations);
  let externalId;
  if (input.externalId != null && input.externalId !== '') {
    externalId = String(input.externalId).trim();
    if (!EXTERNAL_ID.test(externalId)) throw fail('MH_015', 'externalId may use letters, numbers, dot, underscore, and hyphen.');
  }
  return {
    tokenMint: DEVNET_USDC_MINT,
    amountRaw,
    amountTokens: amountTokens(amountRaw, input.amountTokens),
    tokenDecimals: 6,
    tokenSymbol: 'USDC',
    sourceOwner,
    recipientWallet: parties.destinations.length ? undefined : parties.recipientWallet,
    destinations: parties.destinations.length ? parties.destinations : undefined,
    hops: timing.hops ?? undefined,
    arrivalSeconds: timing.arrivalSeconds ?? undefined,
    route: timing.route || undefined,
    externalId,
  };
}

export function validateConfirm(body) {
  const input = objectBody(body);
  if (!Array.isArray(input.routeInitSignatures)) throw fail('BAD_REQUEST', 'routeInitSignatures must be a list.');
  if (input.routeInitSignatures.length > 20) throw fail('BAD_REQUEST', 'Too many route signatures.');
  const routeInitSignatures = input.routeInitSignatures.map((item, index) => {
    if (!isSignature(item)) throw fail('MH_036', 'routeInitSignatures[' + index + '] is not a Solana signature.');
    return String(item).trim();
  });
  const out = { routeInitSignatures };
  if (input.keeperFundingSignature != null && input.keeperFundingSignature !== '') {
    if (!isSignature(input.keeperFundingSignature)) throw fail('MH_039', 'keeperFundingSignature is not a Solana signature.');
    out.keeperFundingSignature = String(input.keeperFundingSignature).trim();
  }
  if (input.orchestratorInitSignature != null && input.orchestratorInitSignature !== '') {
    if (!isSignature(input.orchestratorInitSignature)) throw fail('MH_036', 'orchestratorInitSignature is not a Solana signature.');
    out.orchestratorInitSignature = String(input.orchestratorInitSignature).trim();
  }
  for (const key of ['sessionInitSignatures', 'dispersionInitSignatures']) {
    if (input[key] == null) continue;
    if (!Array.isArray(input[key]) || input[key].length > 20) throw fail('BAD_REQUEST', key + ' must be a short list.');
    out[key] = input[key].map((item, index) => {
      if (!isSignature(item)) throw fail('MH_036', key + '[' + index + '] is not a Solana signature.');
      return String(item).trim();
    });
  }
  return out;
}

export function validateTransferId(value) {
  if (!/^[1-9][0-9]{0,14}$/.test(String(value || ''))) throw fail('MH_030', 'Transfer id is not valid.');
  return String(value);
}

export function isProtocolAddress(value) {
  return PROTOCOL.has(value);
}
