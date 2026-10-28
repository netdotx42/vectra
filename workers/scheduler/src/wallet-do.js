import { DurableObject } from 'cloudflare:workers';
import { loginMessage, issueToken, verifyWalletSignature } from './auth.js';
import { LIMITS, clampGrace, take } from './limits.js';
import { validateSchedule, validateSignatures, webhookUrl } from './validate.js';
import { advanceSchedule, applyRunTransition, expireRun, nextAlarmMs } from './runs.js';
import { firstDueMs } from './schedule-math.js';

function publicRun(run) {
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    name: run.name,
    dueAt: run.dueAt,
    status: run.status,
    network: 'devnet',
    recipients: run.recipients,
    memo: run.memo,
    frequency: run.frequency,
    graceMs: run.graceMs,
    signatures: run.signatures || [],
    webhookDelivered: !!run.webhookDelivered,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export class WalletScheduler extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, status TEXT NOT NULL, due_at TEXT NOT NULL, payload TEXT NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, read INTEGER NOT NULL, payload TEXT NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id TEXT, schedule_id TEXT, payload TEXT NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, message TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rate (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)`);
    });
  }

  graceMs() {
    return clampGrace(this.env.GRACE_PERIOD_MS, LIMITS.defaultGraceMs);
  }

  meta(key) {
    const rows = this.ctx.storage.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray();
    return rows[0] ? rows[0].value : '';
  }

  setMeta(key, value) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
  }

  bind(wallet) {
    const current = this.meta('wallet');
    if (!current) this.setMeta('wallet', wallet);
    else if (current !== wallet) return { ok: false, status: 403, error: 'This scheduler belongs to a different wallet.' };
    return { ok: true };
  }

  allow(bucket, limit, windowMs) {
    const now = Date.now();
    const rows = this.ctx.storage.sql.exec('SELECT count, window_start FROM rate WHERE bucket = ?', bucket).toArray();
    const current = rows[0] ? { start: Number(rows[0].window_start), count: Number(rows[0].count) } : null;
    const result = take(current, now, limit, windowMs);
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO rate (bucket, count, window_start) VALUES (?, ?, ?)',
      bucket,
      result.bucket.count,
      result.bucket.start,
    );
    return result.ok;
  }

  schedules() {
    return this.ctx.storage.sql.exec('SELECT payload FROM schedules').toArray().map((row) => JSON.parse(row.payload));
  }

  saveSchedule(schedule) {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO schedules (id, status, payload) VALUES (?, ?, ?)',
      schedule.id,
      schedule.status,
      JSON.stringify(schedule),
    );
  }

  getRun(id) {
    const rows = this.ctx.storage.sql.exec('SELECT payload FROM runs WHERE id = ?', id).toArray();
    return rows[0] ? JSON.parse(rows[0].payload) : null;
  }

  putRun(run) {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO runs (id, schedule_id, status, due_at, payload) VALUES (?, ?, ?, ?, ?)',
      run.id,
      run.scheduleId,
      run.status,
      run.dueAt,
      JSON.stringify(run),
    );
  }

  openRuns() {
    return this.ctx.storage.sql.exec(
      "SELECT payload FROM runs WHERE status IN ('prepared', 'awaiting_signature')",
    ).toArray().map((row) => JSON.parse(row.payload));
  }

  audit(entry) {
    const row = {
      at: new Date().toISOString(),
      runId: entry.runId || '',
      scheduleId: entry.scheduleId || '',
      fromStatus: entry.fromStatus || '',
      toStatus: entry.toStatus || '',
      actor: entry.actor || 'scheduler',
      note: entry.note || '',
    };
    this.ctx.storage.sql.exec(
      'INSERT INTO audit (at, run_id, schedule_id, payload) VALUES (?, ?, ?, ?)',
      row.at,
      row.runId,
      row.scheduleId,
      JSON.stringify(row),
    );
    const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM audit').one().n;
    if (Number(count) > LIMITS.maxAudit) {
      this.ctx.storage.sql.exec(
        'DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY id ASC LIMIT ?)',
        Number(count) - LIMITS.maxAudit,
      );
    }
  }

  inbox(item) {
    const row = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      read: false,
      kind: item.kind,
      scheduleId: item.scheduleId,
      runId: item.runId,
      title: item.title,
      body: item.body,
    };
    this.ctx.storage.sql.exec(
      'INSERT INTO inbox (id, created_at, read, payload) VALUES (?, ?, 0, ?)',
      row.id,
      row.createdAt,
      JSON.stringify(row),
    );
    const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM inbox').one().n;
    if (Number(count) > LIMITS.maxInbox) {
      this.ctx.storage.sql.exec(
        'DELETE FROM inbox WHERE id IN (SELECT id FROM inbox ORDER BY created_at ASC LIMIT ?)',
        Number(count) - LIMITS.maxInbox,
      );
    }
    return row;
  }

  async arm() {
    const when = nextAlarmMs(this.schedules(), this.openRuns(), Date.now());
    const wallet = this.meta('wallet');
    if (wallet) {
      const directory = this.env.SCHEDULER_DIRECTORY.get(this.env.SCHEDULER_DIRECTORY.idFromName('global'));
      await directory.register(wallet, when);
    }
    if (when == null) {
      try { await this.ctx.storage.deleteAlarm(); } catch { /* No alarm was set. */ }
      return null;
    }
    await this.ctx.storage.setAlarm(when);
    return when;
  }

  async postWebhook(run) {
    const checked = webhookUrl(run.webhookUrl);
    if (!checked.ok || !checked.url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let delivered = false;
    try {
      const response = await fetch(checked.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
        body: JSON.stringify({
          type: 'vectra.scheduler.run_due',
          runId: run.id,
          scheduleId: run.scheduleId,
          name: run.name,
          dueAt: run.dueAt,
          status: run.status,
          network: 'devnet',
          memo: run.memo,
          recipients: run.recipients,
          note: 'Nothing is sent until the wallet signs in Vectra.',
        }),
      });
      delivered = response.status >= 200 && response.status < 300;
    } catch {
      delivered = false;
    } finally {
      clearTimeout(timer);
    }
    const current = this.getRun(run.id);
    if (!current) return;
    this.putRun({ ...current, webhookDelivered: delivered });
    console.log(JSON.stringify({ event: 'webhook', runId: run.id, delivered }));
  }

  async nonce(wallet) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('nonce', LIMITS.noncePerWallet, LIMITS.nonceWindowMs)) {
      return { ok: false, status: 429, error: 'Too many sign-in attempts. Wait a few minutes.' };
    }
    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM nonces WHERE expires_at <= ?', now);
    const nonce = crypto.randomUUID();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + LIMITS.nonceTtlMs).toISOString();
    const message = loginMessage({ wallet, nonce, issuedAt, expiresAt });
    this.ctx.storage.sql.exec(
      'INSERT INTO nonces (nonce, message, expires_at) VALUES (?, ?, ?)',
      nonce,
      message,
      now + LIMITS.nonceTtlMs,
    );
    return { ok: true, nonce, message, expiresAt };
  }

  async verify(wallet, nonce, signature) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    const rows = this.ctx.storage.sql.exec('SELECT message, expires_at FROM nonces WHERE nonce = ?', String(nonce || '')).toArray();
    this.ctx.storage.sql.exec('DELETE FROM nonces WHERE nonce = ?', String(nonce || ''));
    const row = rows[0];
    if (!row || Number(row.expires_at) <= Date.now()) {
      return { ok: false, status: 401, error: 'That sign-in challenge expired. Request a new one.' };
    }
    const valid = await verifyWalletSignature(wallet, signature, row.message);
    if (!valid) return { ok: false, status: 401, error: 'The wallet signature did not match this challenge.' };
    try {
      const token = await issueToken(this.env.TOKEN_SECRET, wallet, Date.now());
      return { ok: true, ...token };
    } catch {
      return { ok: false, status: 503, error: 'Scheduler auth is not configured.' };
    }
  }

  async listSchedules(wallet) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('read', LIMITS.readsPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const schedules = this.schedules().filter((item) => item.status !== 'deleted');
    schedules.sort((a, b) => String(a.nextDueAt || '').localeCompare(String(b.nextDueAt || '')));
    return { ok: true, schedules };
  }

  async createSchedule(wallet, input) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('write', LIMITS.writesPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const kept = this.schedules().filter((item) => item.status !== 'deleted');
    if (kept.length >= LIMITS.maxSchedules) return { ok: false, status: 409, error: 'This wallet already has 50 schedules. Delete one first.' };
    const validated = validateSchedule(input, Date.now(), this.graceMs());
    if (!validated.ok) return { ok: false, status: 400, error: validated.error };
    const schedule = { ...validated.schedule, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.saveSchedule(schedule);
    this.audit({ scheduleId: schedule.id, fromStatus: '', toStatus: 'active', actor: 'wallet', note: 'schedule created' });
    let prepared = [];
    if (Date.parse(schedule.nextDueAt) <= Date.now()) {
      const result = await this.prepareDue(Date.now());
      prepared = result.created || [];
    } else {
      await this.arm();
    }
    const stored = this.schedules().find((item) => item.id === schedule.id) || schedule;
    return { ok: true, schedule: stored, prepared };
  }

  async setScheduleStatus(wallet, id, status) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('write', LIMITS.writesPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const schedule = this.schedules().find((item) => item.id === id);
    if (!schedule || schedule.status === 'deleted') return { ok: false, status: 404, error: 'Schedule not found.' };
    if (schedule.status === 'completed') return { ok: false, status: 409, error: 'That one-time schedule has already been prepared.' };
    if (status === 'paused' && schedule.status !== 'active') return { ok: false, status: 409, error: 'Only an active schedule can be paused.' };
    if (status === 'active' && schedule.status !== 'paused') return { ok: false, status: 409, error: 'Only a paused schedule can be resumed.' };
    const next = { ...schedule, status };
    if (status === 'active') {
      const due = firstDueMs(next, Date.now());
      next.nextDueAt = Number.isFinite(due) ? new Date(due).toISOString() : null;
      this.audit({ scheduleId: id, fromStatus: 'paused', toStatus: 'active', actor: 'wallet', note: 'resumed; intervals while paused were not prepared' });
    } else if (status === 'paused') {
      this.audit({ scheduleId: id, fromStatus: 'active', toStatus: 'paused', actor: 'wallet', note: 'paused' });
    } else if (status === 'deleted') {
      next.nextDueAt = null;
      this.audit({ scheduleId: id, fromStatus: schedule.status, toStatus: 'deleted', actor: 'wallet', note: 'deleted; future runs will not be prepared' });
    }
    this.saveSchedule(next);
    await this.arm();
    return { ok: true, schedule: next };
  }

  async listRuns(wallet, status) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('read', LIMITS.readsPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const rows = status
      ? this.ctx.storage.sql.exec('SELECT payload FROM runs WHERE status = ? ORDER BY due_at DESC LIMIT ?', status, LIMITS.maxRunsListed).toArray()
      : this.ctx.storage.sql.exec('SELECT payload FROM runs ORDER BY due_at DESC LIMIT ?', LIMITS.maxRunsListed).toArray();
    return { ok: true, runs: rows.map((row) => publicRun(JSON.parse(row.payload))) };
  }

  async readRun(wallet, id) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('read', LIMITS.readsPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const run = this.getRun(id);
    if (!run) return { ok: false, status: 404, error: 'Run not found.' };
    return { ok: true, run: publicRun(run) };
  }

  async signRun(wallet, id, input) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('write', LIMITS.writesPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const checked = validateSignatures(input);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    const run = this.getRun(id);
    if (!run) return { ok: false, status: 404, error: 'Run not found.' };
    const moved = applyRunTransition(run, checked.status, { signatures: checked.signatures });
    if (!moved.ok) return { ok: false, status: 409, error: moved.error };
    this.putRun(moved.run);
    this.audit({
      runId: id,
      scheduleId: run.scheduleId,
      fromStatus: run.status,
      toStatus: checked.status,
      actor: 'wallet',
      note: 'wallet recorded ' + checked.signatures.length + ' signature(s)',
    });
    await this.arm();
    console.log(JSON.stringify({ event: 'run', id, to: checked.status }));
    return { ok: true, run: publicRun(moved.run) };
  }

  async skipRun(wallet, id, reason) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('write', LIMITS.writesPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const note = String(reason || '').trim();
    if (note.length > LIMITS.reasonMax) return { ok: false, status: 400, error: 'Skip reason must be 200 characters or fewer.' };
    const run = this.getRun(id);
    if (!run) return { ok: false, status: 404, error: 'Run not found.' };
    const moved = applyRunTransition(run, 'skipped', { skipReason: note });
    if (!moved.ok) return { ok: false, status: 409, error: moved.error };
    this.putRun(moved.run);
    this.audit({ runId: id, scheduleId: run.scheduleId, fromStatus: run.status, toStatus: 'skipped', actor: 'wallet', note: note || 'skipped by wallet' });
    await this.arm();
    return { ok: true, run: publicRun(moved.run) };
  }

  async listInbox(wallet) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('read', LIMITS.readsPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const rows = this.ctx.storage.sql.exec('SELECT payload FROM inbox ORDER BY created_at DESC LIMIT ?', LIMITS.maxInbox).toArray();
    return { ok: true, inbox: rows.map((row) => JSON.parse(row.payload)) };
  }

  async markRead(wallet, id) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('write', LIMITS.writesPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const rows = this.ctx.storage.sql.exec('SELECT payload FROM inbox WHERE id = ?', id).toArray();
    if (!rows[0]) return { ok: false, status: 404, error: 'Notice not found.' };
    const item = JSON.parse(rows[0].payload);
    item.read = true;
    this.ctx.storage.sql.exec('UPDATE inbox SET read = 1, payload = ? WHERE id = ?', JSON.stringify(item), id);
    return { ok: true, item };
  }

  async listAudit(wallet, runId) {
    const bound = this.bind(wallet);
    if (!bound.ok) return bound;
    if (!this.allow('read', LIMITS.readsPerMinute, 60 * 1000)) return { ok: false, status: 429, error: 'Too many requests.' };
    const rows = runId
      ? this.ctx.storage.sql.exec('SELECT payload FROM audit WHERE run_id = ? ORDER BY id DESC LIMIT 200', runId).toArray()
      : this.ctx.storage.sql.exec('SELECT payload FROM audit ORDER BY id DESC LIMIT 200').toArray();
    return { ok: true, audit: rows.map((row) => JSON.parse(row.payload)) };
  }

  async prepareDue(now) {
    const created = [];
    const active = this.schedules().filter((item) => item.status === 'active');
    for (const schedule of active) {
      const result = await advanceSchedule(schedule, now, {
        getRun: (id) => this.getRun(id),
        putRun: (run) => this.putRun(run),
        audit: (entry) => this.audit(entry),
        inbox: (item) => this.inbox(item),
        onAwaiting: (run) => {
          if (run.webhookUrl) this.ctx.waitUntil(this.postWebhook(run));
        },
      });
      this.saveSchedule(result.schedule);
      created.push(...result.created);
    }
    for (const run of this.openRuns()) {
      const expired = expireRun(run, now);
      if (!expired) continue;
      this.putRun(expired);
      this.audit({
        runId: run.id,
        scheduleId: run.scheduleId,
        fromStatus: run.status,
        toStatus: 'expired',
        actor: 'scheduler',
        note: 'grace elapsed; not sent',
      });
      this.inbox({
        kind: 'run_expired',
        scheduleId: run.scheduleId,
        runId: run.id,
        title: run.name + ' expired',
        body: 'The grace period passed before a signature. Nothing was sent.',
      });
    }
    const nextDueAt = await this.arm();
    console.log(JSON.stringify({ event: 'prepare', created: created.length, nextDueAt }));
    return { ok: true, created: created.map(publicRun), nextDueAt };
  }

  async alarm() {
    await this.prepareDue(Date.now());
  }
}
