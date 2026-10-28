/** Friendly text for MultiHopper MH_xxx codes and a few proxy-local codes. */

export const MESSAGES = {
  MH_001: 'The devnet API key was rejected. Check the Worker secret.',
  MH_002: 'That API key was revoked. Create a new key in the devnet dashboard.',
  MH_003: 'This MultiHopper integration is suspended, or production was requested. Production stays locked.',
  MH_004: 'Too many requests. Wait and try again.',
  MH_010: 'That token is not supported. This proxy routes devnet USDC only.',
  MH_011: 'That wallet address is not a valid Solana address.',
  MH_012: 'That amount is below the minimum this route can move.',
  MH_013: 'Hop count is outside the allowed range.',
  MH_014: 'Arrival time is too short for this hop count.',
  MH_015: 'The reference id has unsupported characters.',
  MH_016: 'The amount does not cover the route fee.',
  MH_017: 'A destination would receive too little after fees. Increase the amount.',
  MH_018: 'This custom route breaks a rule. Check each hop and the total wait.',
  MH_019: 'The hop library is not available on devnet. Enter hop wallets yourself.',
  MH_020: 'The hop library could not fill this route.',
  MH_021: 'That saved route was not found.',
  MH_022: 'A route with that name already exists.',
  MH_023: 'The saved-route limit was reached.',
  MH_030: 'That transfer was not found.',
  MH_031: 'MultiHopper could not create the route.',
  MH_032: 'Funding was not confirmed in time. Prepare again and finish the signatures.',
  MH_033: 'A transfer with this reference already exists and does not match this request.',
  MH_034: 'This quote expired. Create a new transfer.',
  MH_035: 'This transfer can no longer be prepared or confirmed.',
  MH_036: 'That signature is not on devnet yet. Wait for confirmation and retry.',
  MH_037: 'A broadcast transaction failed on devnet. Open the explorer link before retrying.',
  MH_038: 'That transaction did not call the MultiHopper program.',
  MH_039: 'Sign the keeper funding transaction first, then record that signature.',
  MH_040: 'The quote is stale. Create a new transfer.',
  MH_041: 'Destination setup is not on chain yet. Broadcast the remaining transactions, then confirm again.',
  MH_050: 'MultiHopper could not reach the webhook URL.',
  MH_051: 'The webhook limit was reached.',
  MH_060: 'The reward balance is below the claim minimum.',
  MH_061: 'No rewards wallet is set on the MultiHopper integration.',
  MH_070: 'This action needs an idempotency key. Retry it from the routing screen.',
  MH_071: 'This action was already sent with a different request. Start the action again.',
  MH_072: 'That action is still in progress. Wait a moment and retry the same action.',
  MH_080: 'Recovery is not available for this transfer right now.',
  MH_081: 'There is nothing to rescue on this transfer.',
  MH_082: 'There is no rent to reclaim on this transfer.',
  MH_083: 'Those rescue signatures do not match the prepared transactions.',
  MH_090: 'MultiHopper had an internal error. Retry shortly.',
  MH_091: 'MultiHopper is temporarily unavailable. Retry shortly.',
  BAD_REQUEST: 'That request is missing a field or has the wrong shape.',
  WEBHOOK_SIGNATURE: 'The webhook signature did not match.',
};

const STATUS = {
  MH_001: 401,
  MH_002: 401,
  MH_003: 403,
  MH_004: 429,
  MH_021: 404,
  MH_030: 404,
  MH_031: 500,
  MH_032: 408,
  MH_033: 409,
  MH_034: 410,
  MH_035: 409,
  MH_036: 404,
  MH_037: 422,
  MH_038: 422,
  MH_040: 409,
  MH_041: 409,
  MH_071: 409,
  MH_072: 409,
  MH_080: 409,
  MH_081: 409,
  MH_082: 409,
  MH_090: 500,
  MH_091: 503,
  WEBHOOK_SIGNATURE: 401,
};

export class HopperError extends Error {
  constructor(code, status, message, detail) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail || '';
  }
}

export function fail(code, detail) {
  const message = MESSAGES[code] || 'Something went wrong with Solana routing. Retry shortly.';
  const status = STATUS[code] || 400;
  return new HopperError(code, status, message, detail || '');
}

export function redact(value) {
  return String(value || '')
    .replace(/mh_(test|live)_[A-Za-z0-9._-]+/gi, '[redacted]')
    .replace(/whsec_[A-Za-z0-9._-]+/gi, '[redacted]')
    .slice(0, 500);
}

export function friendlyCode(code) {
  const key = String(code || '');
  if (MESSAGES[key]) return key;
  if (/^MH_\d{3}$/.test(key)) return key;
  return '';
}
