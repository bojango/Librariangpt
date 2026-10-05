import test from 'node:test';
import assert from 'node:assert/strict';
import { bookReadingTime, durationCompact, durationHms, profileReadingTime } from '../../src/utils/reading-time.js';

const session = (start, end, extra = {}) => ({ book_id: 'book-1', session_kind: 'reading', started_at: start, ended_at: end, ...extra });
const local = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
const now = new Date(2026, 9, 5, 12);

test('book totals use completed reading sessions for that book and the existing days denominator', () => {
  const rows = [
    session(local(2026, 10, 1, 10), local(2026, 10, 1, 11)),
    session(local(2026, 10, 1, 14), local(2026, 10, 1, 14, 30)),
    session(local(2026, 10, 2, 10), local(2026, 10, 2, 12)),
    session(local(2026, 10, 2, 10), local(2026, 10, 2, 18), { session_kind: 'test' }),
    session(local(2026, 10, 2, 10), null),
    session(local(2026, 10, 2, 10), local(2026, 10, 2, 18), { book_id: 'other' })
  ];
  const result = bookReadingTime(rows, { id: 'book-1', started_at: '2026-10-01', completed_at: '2026-10-05' }, now);
  assert.deepEqual(result, { totalSeconds: 12600, perDaySeconds: 3150 });
  assert.equal(durationHms(result.totalSeconds), '03:30:00');
  assert.equal(durationHms(result.perDaySeconds), '00:52:30');
  assert.equal(bookReadingTime(rows, { id: 'book-1', started_at: '2026-10-05' }, now).perDaySeconds, 12600);
  assert.equal(bookReadingTime(rows, { id: 'book-1' }, now).perDaySeconds, 0);
});

test('no sessions and invalid timestamps safely contribute zero', () => {
  assert.equal(durationHms(bookReadingTime([], { id: 'book-1' }, now).totalSeconds), '00:00:00');
  const rows = [session('invalid', local(2026, 10, 1)), session(null, local(2026, 10, 1)), session(local(2026, 10, 2), local(2026, 10, 1)), session(local(2026, 10, 1), local(2026, 10, 2), { session_kind: null })];
  assert.deepEqual(profileReadingTime(rows, now), { totalSeconds: 0, yearSeconds: 0, averageDaySeconds: 0, averageSessionSeconds: 0 });
  assert.equal(durationCompact(0), '0m');
});

test('profile averages group same-day sessions and ignore inactive calendar days', () => {
  const result = profileReadingTime([
    session(local(2026, 10, 1, 10), local(2026, 10, 1, 10, 30)),
    session(local(2026, 10, 1, 14), local(2026, 10, 1, 15)),
    session(local(2026, 10, 5, 12), local(2026, 10, 5, 12, 30)),
    session(local(2026, 10, 3, 10), local(2026, 10, 3, 12), { session_kind: 'test' }),
    session(local(2026, 10, 4, 10), null)
  ], now);
  assert.deepEqual(result, { totalSeconds: 7200, yearSeconds: 7200, averageDaySeconds: 3600, averageSessionSeconds: 2400 });
});

test('sessions across local midnight contribute to each reading day without counting an end at midnight twice', () => {
  const result = profileReadingTime([
    session(local(2026, 10, 1, 23, 30), local(2026, 10, 2, 0, 30)),
    session(local(2026, 10, 2, 23, 30), local(2026, 10, 3))
  ], now);
  assert.equal(result.totalSeconds, 5400);
  assert.equal(result.averageDaySeconds, 2700);
});

test('current local year includes only the overlap at either year boundary', () => {
  const result = profileReadingTime([
    session(local(2025, 12, 31, 23, 30), local(2026, 1, 1, 0, 30)),
    session(local(2026, 12, 31, 23, 30), local(2027, 1, 1, 0, 30)),
    session(local(2025, 6, 1, 10), local(2025, 6, 1, 11)),
    session(local(2027, 6, 1, 10), local(2027, 6, 1, 11))
  ], now);
  assert.equal(result.yearSeconds, 3600);
  assert.equal(result.totalSeconds, 14400);
});

test('local grouping and year filtering differ correctly from raw UTC in a non-UTC timezone', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(new Date('2026-01-01T00:00:00Z').getFullYear(), 2025);
    const result = profileReadingTime([
      session('2026-01-01T01:00:00Z', '2026-01-01T02:00:00Z'),
      session('2026-01-01T04:30:00Z', '2026-01-01T05:30:00Z')
    ], new Date(2026, 9, 5));
    assert.equal(result.yearSeconds, 1800);
    assert.equal(result.averageDaySeconds, 3600);
    const dst = profileReadingTime([session('2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z')], now);
    assert.equal(dst.totalSeconds, 23 * 3600);
    assert.equal(dst.averageDaySeconds, 23 * 3600);
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test('formatting truncates only after summing and averaging and allows hours beyond 24', () => {
  assert.equal(durationCompact(38 * 60 + 59), '38m');
  assert.equal(durationCompact(65 * 60), '1h 05m');
  assert.equal(durationCompact(12 * 3600 + 34 * 60), '12h 34m');
  assert.equal(durationHms(100 * 3600 + 2), '100:00:02');
  const result = profileReadingTime([session('2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.600Z'), session('2026-01-01T11:00:00.000Z', '2026-01-01T11:00:00.600Z')], now);
  assert.equal(durationHms(result.totalSeconds), '00:00:01');
});
