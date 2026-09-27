import { addDays, toDateOnly, todayDateOnly } from './date-only';

describe('toDateOnly', () => {
  it('keeps a calendar date exactly, whatever the time zone', () => {
    expect(toDateOnly('2026-09-02')).toBe('2026-09-02');
  });

  it('keeps the written day of a full timestamp', () => {
    expect(toDateOnly('2026-09-02T23:30:00-07:00')).toBe('2026-09-02');
  });

  it('uses the local calendar day of a Date, as TypeORM does', () => {
    expect(toDateOnly(new Date(2026, 8, 2, 23, 59))).toBe('2026-09-02');
    expect(toDateOnly(new Date(2026, 8, 2, 0, 0))).toBe('2026-09-02');
  });

  it('rejects anything that is not a date', () => {
    expect(() => toDateOnly('02/09/2026')).toThrow();
    expect(() => toDateOnly(new Date('nope'))).toThrow();
  });
});

describe('todayDateOnly', () => {
  it('is the local calendar day', () => {
    const now = new Date();
    expect(todayDateOnly()).toBe(toDateOnly(now));
  });
});

describe('addDays', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-09-27', 14)).toBe('2026-10-11');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is not thrown off by daylight saving changes', () => {
    // US clocks change on 2026-03-08 and 2026-11-01.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
