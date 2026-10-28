import { DurableObject } from 'cloudflare:workers';
import { take } from './limits.js';

export class SchedulerDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS wallets (
        wallet TEXT PRIMARY KEY,
        next_due_at INTEGER,
        updated_at INTEGER NOT NULL
      )`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS gate (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      )`);
    });
  }

  async register(wallet, nextDueAt) {
    if (!wallet) return { ok: false };
    if (nextDueAt == null) {
      this.ctx.storage.sql.exec('DELETE FROM wallets WHERE wallet = ?', wallet);
      return { ok: true };
    }
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO wallets (wallet, next_due_at, updated_at) VALUES (?, ?, ?)',
      wallet,
      Math.trunc(nextDueAt),
      Date.now(),
    );
    return { ok: true };
  }

  async listDue(now) {
    const rows = this.ctx.storage.sql.exec(
      'SELECT wallet FROM wallets WHERE next_due_at IS NOT NULL AND next_due_at <= ? ORDER BY next_due_at LIMIT 40',
      Math.trunc(now),
    ).toArray();
    return rows.map((row) => row.wallet);
  }

  async allow(key, limit, windowMs, now) {
    const rows = this.ctx.storage.sql.exec(
      'SELECT count, window_start FROM gate WHERE key = ?',
      key,
    ).toArray();
    const current = rows[0] ? { start: Number(rows[0].window_start), count: Number(rows[0].count) } : null;
    const result = take(current, now, limit, windowMs);
    const bucket = result.bucket;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO gate (key, count, window_start) VALUES (?, ?, ?)',
      key,
      bucket.count,
      bucket.start,
    );
    return { ok: result.ok };
  }
}
