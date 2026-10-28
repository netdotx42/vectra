const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isIanaTimeZone(timeZone) {
  const name = String(timeZone || '').trim();
  if (!name || name.length > 80 || /[\s\u0000-\u001f]/.test(name)) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: name }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

function offsetAt(utcMs, timeZone) {
  const parts = zonedParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - utcMs;
}

function sameWall(parts, year, month, day, hour, minute) {
  return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
}

export function localToUtc(year, month, day, hour, minute, timeZone) {
  if (!isIanaTimeZone(timeZone)) throw new Error('Choose an IANA timezone, such as America/New_York.');
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired - offsetAt(desired, timeZone);
  utc = desired - offsetAt(utc, timeZone);
  const parts = zonedParts(new Date(utc), timeZone);
  if (sameWall(parts, year, month, day, hour, minute)) {
    const earlier = utc - 60 * 60 * 1000;
    const earlierParts = zonedParts(new Date(earlier), timeZone);
    if (sameWall(earlierParts, year, month, day, hour, minute)) return earlier;
    return utc;
  }
  const scanFrom = utc - 2 * 60 * 60 * 1000;
  for (let t = scanFrom; t < scanFrom + 6 * 60 * 60 * 1000; t += 60 * 1000) {
    const scanned = zonedParts(new Date(t), timeZone);
    const reached = scanned.year === year && scanned.month === month && scanned.day === day
      && (scanned.hour > hour || (scanned.hour === hour && scanned.minute >= minute));
    if (reached) return t;
  }
  throw new Error('That local time cannot be resolved in ' + timeZone + '.');
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampMonthDay(year, month, dayOfMonth) {
  const last = daysInMonth(year, month);
  if (dayOfMonth === 'last') return last;
  return Math.min(Number(dayOfMonth), last);
}

function addDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function nextWeekly(schedule, afterMs) {
  const after = zonedParts(new Date(afterMs), schedule.timezone);
  let cursor = { year: after.year, month: after.month, day: after.day };
  for (let i = 0; i < 21; i++) {
    const dow = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day)).getUTCDay();
    if (dow === schedule.weekday) {
      const utc = localToUtc(cursor.year, cursor.month, cursor.day, schedule.hour, schedule.minute, schedule.timezone);
      if (utc > afterMs) return utc;
    }
    cursor = addDays(cursor, 1);
  }
  throw new Error('No weekly occurrence was found.');
}

export function nextMonthly(schedule, afterMs) {
  const after = zonedParts(new Date(afterMs), schedule.timezone);
  let year = after.year;
  let month = after.month;
  for (let i = 0; i < 18; i++) {
    const day = clampMonthDay(year, month, schedule.dayOfMonth);
    const utc = localToUtc(year, month, day, schedule.hour, schedule.minute, schedule.timezone);
    if (utc > afterMs) return utc;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  throw new Error('No monthly occurrence was found.');
}

export function nextOccurrenceAfter(schedule, afterMs) {
  if (schedule.frequency === 'once') return null;
  if (schedule.frequency === 'weekly') return nextWeekly(schedule, afterMs);
  if (schedule.frequency === 'monthly') return nextMonthly(schedule, afterMs);
  throw new Error('Frequency must be once, weekly, or monthly.');
}

export function firstDueMs(schedule, nowMs) {
  if (schedule.frequency === 'once') return Date.parse(schedule.runAt);
  return nextOccurrenceAfter(schedule, nowMs - 1);
}

export function weekdayName(weekday) {
  return WEEKDAYS[weekday] || 'Day';
}
