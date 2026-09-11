import test from 'node:test';
import assert from 'node:assert/strict';
import { readingAgeText, readingDayCount, readingDurationText } from '../../src/ui/format.js';

test('readingDayCount uses calendar-day difference and never goes negative', () => {
  assert.equal(readingDayCount('2026-09-01', null, new Date('2026-09-11T12:00:00Z')), 10);
  assert.equal(readingDayCount('2026-09-11', null, new Date('2026-09-11T23:59:00Z')), 0);
  assert.equal(readingDayCount('2026-09-12', null, new Date('2026-09-11T12:00:00Z')), 0);
});

test('readingAgeText stays compact for current-reading cards', () => {
  assert.equal(readingAgeText('2026-09-11', new Date('2026-09-11T12:00:00Z')), 'Started today');
  assert.equal(readingAgeText('2026-09-10', new Date('2026-09-11T12:00:00Z')), '1 day reading');
  assert.equal(readingAgeText('2026-09-01', new Date('2026-09-11T12:00:00Z')), '10 days reading');
  assert.equal(readingAgeText(null, new Date('2026-09-11T12:00:00Z')), '');
});

test('readingDurationText describes completed books without using the current date', () => {
  assert.equal(readingDurationText('2026-09-01', '2026-09-05', new Date('2030-01-01T12:00:00Z')), 'Read in 4 days');
  assert.equal(readingDurationText('2026-09-11', '2026-09-11', new Date('2030-01-01T12:00:00Z')), 'Read in < 1 day');
});
