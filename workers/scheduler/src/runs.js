import { assertTransition } from './state-machine.js';
import { LIMITS } from './limits.js';
import { nextOccurrenceAfter } from './schedule-math.js';

export async function deterministicRunId(scheduleId, dueAtIso) {
  const data = new TextEncoder().encode(String(scheduleId) + '\n' + String(dueAtIso));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex.slice(0, 32);
}

function makeRun(schedule, id, dueAt) {
  const now = new Date().toISOString();
  return {
    id,
    scheduleId: schedule.id,
    name: schedule.name,
    dueAt,
    status: 'prepared',
    network: 'devnet',
    recipients: schedule.recipients,
    memo: schedule.memo || '',
    frequency: schedule.frequency,
    graceMs: schedule.graceMs,
    signatures: [],
    webhookUrl: schedule.webhookUrl || '',
    webhookDelivered: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function advanceSchedule(schedule, nowMs, hooks) {
  const grace = Number(schedule.graceMs);
  let cursor = Date.parse(schedule.nextDueAt);
  const created = [];
  const next = { ...schedule };
  let steps = 0;
  if (schedule.status !== 'active' || !Number.isFinite(cursor)) return { schedule: next, created };
  while (cursor <= nowMs && steps < LIMITS.maxCatchup) {
    const dueAt = new Date(cursor).toISOString();
    const id = await deterministicRunId(schedule.id, dueAt);
    let run = await hooks.getRun(id);
    if (!run) {
      run = makeRun(schedule, id, dueAt);
      await hooks.audit({
        runId: id,
        scheduleId: schedule.id,
        fromStatus: '',
        toStatus: 'prepared',
        actor: 'scheduler',
        note: 'prepared for wallet signature',
      });
    }
    if (run.status === 'prepared') {
      const expired = nowMs > cursor + grace;
      const to = expired ? 'expired' : 'awaiting_signature';
      const moved = assertTransition('prepared', to);
      if (!moved.ok) throw new Error(moved.error);
      run = { ...run, status: to, updatedAt: new Date().toISOString() };
      await hooks.putRun(run);
      await hooks.audit({
        runId: id,
        scheduleId: schedule.id,
        fromStatus: 'prepared',
        toStatus: to,
        actor: 'scheduler',
        note: expired ? 'grace elapsed; not sent' : 'waiting for the wallet',
      });
      await hooks.inbox({
        kind: expired ? 'run_expired' : 'run_due',
        scheduleId: schedule.id,
        runId: id,
        title: expired ? schedule.name + ' expired' : schedule.name + ' is ready to sign',
        body: expired
          ? 'The grace period passed before a signature. Nothing was sent.'
          : 'Review the devnet USDC payout and sign it in your wallet. Nothing is sent until you sign.',
      });
      if (!expired && hooks.onAwaiting) await hooks.onAwaiting(run);
      created.push(run);
    }
    const following = nextOccurrenceAfter(schedule, cursor);
    if (following == null) {
      next.status = 'completed';
      next.nextDueAt = null;
      break;
    }
    cursor = following;
    next.nextDueAt = new Date(following).toISOString();
    steps += 1;
  }
  return { schedule: next, created };
}

export function expireRun(run, nowMs) {
  if (!run || (run.status !== 'prepared' && run.status !== 'awaiting_signature')) return null;
  const due = Date.parse(run.dueAt);
  if (!Number.isFinite(due) || nowMs <= due + Number(run.graceMs)) return null;
  const moved = assertTransition(run.status, 'expired');
  if (!moved.ok) return null;
  return { ...run, status: 'expired', updatedAt: new Date().toISOString() };
}

export function applyRunTransition(run, to, extra = {}) {
  const moved = assertTransition(run.status, to);
  if (!moved.ok) return moved;
  return {
    ok: true,
    run: {
      ...run,
      ...extra,
      status: to,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function nextAlarmMs(schedules, runs, nowMs) {
  let soonest = null;
  const consider = (value) => {
    if (!Number.isFinite(value)) return;
    soonest = soonest == null ? value : Math.min(soonest, value);
  };
  for (const schedule of schedules || []) {
    if (schedule.status === 'active' && schedule.nextDueAt) consider(Date.parse(schedule.nextDueAt));
  }
  for (const run of runs || []) {
    if (run.status === 'prepared' || run.status === 'awaiting_signature') {
      consider(Date.parse(run.dueAt) + Number(run.graceMs || 0));
    }
  }
  if (soonest == null) return null;
  return Math.max(soonest, nowMs + 500);
}
