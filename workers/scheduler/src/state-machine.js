const EDGES = {
  prepared: new Set(['awaiting_signature', 'expired', 'skipped']),
  awaiting_signature: new Set(['signed', 'sent', 'skipped', 'expired']),
  signed: new Set(['sent']),
  sent: new Set(),
  skipped: new Set(),
  expired: new Set(),
};

export const RUN_STATUSES = Object.keys(EDGES);

export function assertTransition(from, to) {
  const allowed = EDGES[from];
  if (!allowed || !allowed.has(to)) {
    return { ok: false, error: 'A run cannot move from ' + from + ' to ' + to + '.' };
  }
  return { ok: true };
}
