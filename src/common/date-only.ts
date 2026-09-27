/**
 * Calendar dates: loan borrow/due/return dates, a book's published date, a
 * member's date of birth.
 *
 * These live in MySQL DATE columns, and TypeORM reads them back as
 * 'YYYY-MM-DD' strings, so they are kept as those strings end to end. Turning
 * one into a Date is what used to go wrong: `new Date('2026-09-02')` is UTC
 * midnight, and TypeORM writes a Date's *local* calendar day, which west of UTC
 * is the day before (UTC-7: 2026-09-01 17:00). Only real moments in time
 * (createdAt, approvedAt, ...) should be Dates.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * A 'YYYY-MM-DD' string from a date string (its first ten characters, so a full
 * ISO timestamp keeps the day it was written with) or from a Date (its local
 * calendar day, the way TypeORM writes it).
 */
export function toDateOnly(value: string | Date): string {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new Error('Invalid date');
    }
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = DATE_ONLY.exec(value);
  if (!match) {
    throw new Error(`Not a calendar date: "${value}"`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Today's local calendar date. */
export function todayDateOnly(): string {
  return toDateOnly(new Date());
}

/** Calendar arithmetic on a 'YYYY-MM-DD' string, free of time zones and DST. */
export function addDays(dateOnly: string, days: number): string {
  const [year, month, day] = toDateOnly(dateOnly).split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}
