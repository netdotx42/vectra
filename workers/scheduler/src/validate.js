import { isSignature, isSolanaAddress } from './codec.js';
import { LIMITS } from './limits.js';
import { firstDueMs, isIanaTimeZone, localToUtc } from './schedule-math.js';

const BLOCKED = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  '11111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
]);

function cleanText(value, max, label) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, error: label + ' is required.' };
  if (text.length > max) return { ok: false, error: label + ' must be ' + max + ' characters or fewer.' };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false, error: label + ' cannot include control characters.' };
  return { ok: true, text };
}

function parseAmount(raw) {
  const trimmed = String(raw ?? '').trim().replace(/\$/g, '').replace(/,/g, '');
  if (!trimmed) return { ok: false, error: 'Enter an amount.' };
  if (trimmed.startsWith('-')) return { ok: false, error: 'Amount must be greater than zero.' };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, error: 'Enter a positive amount, like 12.5.' };
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > 6) return { ok: false, error: 'Use at most 6 decimal places.' };
  const padded = (fraction + '000000').slice(0, 6);
  let amount;
  try {
    amount = BigInt(whole) * 1000000n + BigInt(padded || '0');
  } catch {
    return { ok: false, error: 'Enter a positive amount, like 12.5.' };
  }
  if (amount <= 0n) return { ok: false, error: 'Enter an amount greater than zero.' };
  if (amount > 18446744073709551615n) return { ok: false, error: 'That amount is too large for one transfer.' };
  const fracText = padded.replace(/0+$/, '');
  const display = fracText ? String(BigInt(whole)) + '.' + fracText : String(BigInt(whole));
  return { ok: true, amount: display };
}

function clock(input) {
  const hour = Number(input.hour);
  const minute = Number(input.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: 'Hour must be from 0 to 23.' };
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { ok: false, error: 'Minute must be from 0 to 59.' };
  return { ok: true, hour, minute };
}

export function webhookUrl(value) {
  if (value == null || String(value).trim() === '') return { ok: true, url: '' };
  const text = String(value).trim();
  if (text.length > LIMITS.webhookMax) return { ok: false, error: 'Webhook URL must be 300 characters or fewer.' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'Webhook URL must be a public https address.' };
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { ok: false, error: 'Webhook URL must be https, without a username or password.' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'Webhook URL must be a public https address.' };
  }
  if (/^\d+$/.test(host) || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { ok: false, error: 'Webhook URL must use a hostname, not an IP address.' };
  }
  return { ok: true, url: url.toString() };
}

export function validateSchedule(input, nowMs, graceMs) {
  const source = input || {};
  const name = cleanText(source.name, LIMITS.nameMax, 'Schedule name');
  if (!name.ok) return name;
  const frequency = String(source.frequency || '').trim();
  if (!['once', 'weekly', 'monthly'].includes(frequency)) {
    return { ok: false, error: 'Frequency must be once, weekly, or monthly.' };
  }
  if (source.network && source.network !== 'devnet') {
    return { ok: false, error: 'Only devnet schedules can be stored. Mainnet is locked.' };
  }
  const timezone = String(source.timezone || '').trim();
  if (!isIanaTimeZone(timezone)) return { ok: false, error: 'Choose an IANA timezone, such as America/New_York.' };
  const time = clock(source);
  if (!time.ok) return time;
  const memoRaw = source.memo == null ? '' : String(source.memo).trim();
  if (memoRaw.length > LIMITS.memoMax) return { ok: false, error: 'Memo must be 280 characters or fewer.' };
  if (/[\u0000-\u001f\u007f]/.test(memoRaw)) return { ok: false, error: 'Memo cannot include line breaks or control characters.' };
  const rows = Array.isArray(source.recipients) ? source.recipients : [];
  if (!rows.length) return { ok: false, error: 'Add at least one recipient.' };
  if (rows.length > LIMITS.maxRecipients) return { ok: false, error: 'You can add up to 20 recipients per payout.' };
  const recipients = [];
  const seen = new Set();
  for (const row of rows) {
    const address = String(row?.address ?? '').trim();
    if (!isSolanaAddress(address)) return { ok: false, error: 'Enter a Solana address for each recipient (32-byte base58).' };
    if (BLOCKED.has(address)) return { ok: false, error: 'That address is a Solana program, not a recipient wallet.' };
    if (seen.has(address)) return { ok: false, error: 'Each recipient address must be unique.' };
    seen.add(address);
    const amount = parseAmount(row?.amount);
    if (!amount.ok) return amount;
    recipients.push({ address, amount: amount.amount });
  }
  const hook = webhookUrl(source.webhookUrl);
  if (!hook.ok) return hook;
  const schedule = {
    name: name.text,
    frequency,
    timezone,
    hour: time.hour,
    minute: time.minute,
    recipients,
    memo: memoRaw,
    network: 'devnet',
    webhookUrl: hook.url,
    status: 'active',
    graceMs,
  };
  if (frequency === 'weekly') {
    const weekday = Number(source.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: 'Weekday must be 0 (Sunday) through 6 (Saturday).' };
    schedule.weekday = weekday;
  }
  if (frequency === 'monthly') {
    if (source.dayOfMonth === 'last') schedule.dayOfMonth = 'last';
    else {
      const day = Number(source.dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) return { ok: false, error: 'Monthly day must be 1 to 31, or last.' };
      schedule.dayOfMonth = day;
    }
  }
  if (frequency === 'once') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(source.date || ''));
    if (!match) return { ok: false, error: 'Choose a date for the one-time payout.' };
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
      return { ok: false, error: 'Choose a real calendar date.' };
    }
    let resolved;
    try {
      resolved = localToUtc(year, month, day, time.hour, time.minute, timezone);
    } catch {
      return { ok: false, error: 'That local time cannot be resolved in this timezone.' };
    }
    if (resolved < nowMs - graceMs) return { ok: false, error: 'That time is outside the grace period. Pick a later time.' };
    if (resolved > nowMs + LIMITS.maxHorizonMs) return { ok: false, error: 'One-time payouts must be within a year.' };
    schedule.runAt = new Date(resolved).toISOString();
  }
  const due = firstDueMs(schedule, nowMs);
  if (!Number.isFinite(due)) return { ok: false, error: 'That schedule does not have a due time.' };
  schedule.nextDueAt = new Date(due).toISOString();
  return { ok: true, schedule };
}

export function validateSignatures(input) {
  const source = input || {};
  const status = source.status === 'sent' ? 'sent' : source.status === 'signed' ? 'signed' : '';
  if (!status) return { ok: false, error: 'Status must be signed or sent.' };
  const list = Array.isArray(source.signatures) ? source.signatures : [];
  if (!list.length || list.length > LIMITS.maxSignatures) return { ok: false, error: 'Include the transaction signature from your wallet.' };
  const signatures = [];
  for (const value of list) {
    const text = String(value || '').trim();
    if (!isSignature(text)) return { ok: false, error: 'That is not a Solana transaction signature.' };
    signatures.push(text);
  }
  return { ok: true, status, signatures };
}
