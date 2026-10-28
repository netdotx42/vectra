import { DurableObject } from 'cloudflare:workers';
import { decideReplay } from './idempotency.js';

export class HopperState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS records (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    });
  }

  read(key) {
    const rows = this.ctx.storage.sql.exec('SELECT value FROM records WHERE key = ?', key).toArray();
    if (!rows.length) return null;
    try {
      return JSON.parse(rows[0].value);
    } catch {
      return null;
    }
  }

  write(key, value) {
    this.ctx.storage.sql.exec(
      'INSERT INTO records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }

  async rateLimit({ bucket, limit, windowMs }) {
    const now = Date.now();
    const stamps = (this.read('rate:' + bucket) || []).filter((stamp) => now - stamp < windowMs);
    if (stamps.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - stamps[0])) / 1000));
      return { ok: false, retryAfter };
    }
    stamps.push(now);
    this.write('rate:' + bucket, stamps.slice(-limit));
    return { ok: true, retryAfter: 0 };
  }

  async beginAction({ bodyHash }) {
    const stored = this.read('action');
    const decision = decideReplay(stored, bodyHash, Date.now());
    if (decision.kind === 'mismatch') return { conflict: 'mismatch', idempotencyKey: stored.idempotencyKey };
    if (decision.kind === 'inflight') return { conflict: 'inflight', idempotencyKey: stored.idempotencyKey };
    if (decision.kind === 'replay') return { replay: decision.response, idempotencyKey: stored.idempotencyKey };
    const idempotencyKey = stored && stored.idempotencyKey ? stored.idempotencyKey : crypto.randomUUID();
    this.write('action', {
      idempotencyKey,
      bodyHash,
      state: 'inflight',
      startedAt: Date.now(),
      response: null,
    });
    return { idempotencyKey, replay: null };
  }

  async finishAction({ ok, status, body }) {
    const current = this.read('action');
    if (!current) return { stored: false };
    if (!ok) {
      current.state = 'open';
      current.response = null;
      this.write('action', current);
      return { stored: false };
    }
    current.state = 'done';
    current.response = { status, body };
    this.write('action', current);
    return { stored: true };
  }

  async readRecord() {
    return this.read('record');
  }

  async writeRecord(record) {
    this.write('record', record);
    return record;
  }

  async allocateTransfer({ externalId, hash }) {
    const key = 'ext:' + externalId;
    const current = this.read(key);
    if (current && current.hash !== hash) return { conflict: true, id: current.id };
    if (current) return { id: current.id, existing: true };
    const seq = this.read('seq') || { n: 9000 };
    seq.n += 1;
    this.write('seq', seq);
    this.write(key, { id: seq.n, hash });
    return { id: seq.n, existing: false };
  }
}
