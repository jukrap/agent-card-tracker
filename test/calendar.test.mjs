import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays,
  assertIsoDate,
  assertTimeZone,
  dateAtInstant,
  endOfDayInstant,
  daysBetween,
  daysInMonth,
  eachDay,
  heatmapRange,
  mondayOf,
  monthStart,
  periodRanges,
  shiftMonthStart,
  trendBuckets,
} from '../src/domain/calendar.mjs';

test('accepts only zero-padded, real proleptic Gregorian dates', () => {
  assert.equal(assertIsoDate('0001-01-01'), '0001-01-01');
  assert.equal(assertIsoDate('2000-02-29'), '2000-02-29');
  assert.equal(assertIsoDate('2024-02-29'), '2024-02-29');
  assert.equal(assertIsoDate('9999-12-31'), '9999-12-31');

  for (const invalid of [
    '0000-01-01',
    '1900-02-29',
    '2023-02-29',
    '2024-02-30',
    '2024-04-31',
    '2024-13-01',
    '2024-00-01',
    '2024-01-00',
    '2024-1-01',
    '24-01-01',
    '2024-01-01T00:00:00Z',
    '',
  ]) {
    assert.throws(() => assertIsoDate(invalid), { name: /^(?:TypeError|RangeError)$/ });
  }
  assert.throws(() => assertIsoDate(null), TypeError);
});

test('validates named timezones and rejects local or fixed-offset pseudo zones', () => {
  assert.equal(assertTimeZone('UTC'), 'UTC');
  assert.equal(assertTimeZone('Asia/Seoul'), 'Asia/Seoul');
  assert.equal(assertTimeZone('America/New_York'), 'America/New_York');

  for (const invalid of ['local', '+09:00', '-05:00', 'Mars/Olympus', '']) {
    assert.throws(() => assertTimeZone(invalid), { name: /^(?:TypeError|RangeError)$/ });
  }
  assert.throws(() => assertTimeZone(undefined), TypeError);
});

test('derives the Seoul calendar date exactly at local midnight', () => {
  assert.equal(
    dateAtInstant(Date.parse('2024-03-30T14:59:59.999Z'), 'Asia/Seoul'),
    '2024-03-30',
  );
  assert.equal(
    dateAtInstant(Date.parse('2024-03-30T15:00:00.000Z'), 'Asia/Seoul'),
    '2024-03-31',
  );
});

test('uses timezone calendar parts across New York DST spring and fall transitions', () => {
  assert.equal(
    dateAtInstant(Date.parse('2024-03-10T04:59:59.999Z'), 'America/New_York'),
    '2024-03-09',
  );
  assert.equal(
    dateAtInstant(Date.parse('2024-03-10T05:00:00.000Z'), 'America/New_York'),
    '2024-03-10',
  );
  assert.equal(
    dateAtInstant(Date.parse('2024-03-10T07:30:00.000Z'), 'America/New_York'),
    '2024-03-10',
  );
  assert.equal(
    dateAtInstant(Date.parse('2024-11-03T05:30:00.000Z'), 'America/New_York'),
    '2024-11-03',
  );
  assert.equal(
    dateAtInstant(Date.parse('2024-11-03T06:30:00.000Z'), 'America/New_York'),
    '2024-11-03',
  );

  assert.throws(() => dateAtInstant(Number.NaN, 'UTC'), RangeError);
  assert.throws(() => dateAtInstant('2024-01-01T00:00:00Z', 'UTC'), TypeError);
});

test('resolves deterministic timezone day-end instants across DST boundaries', () => {
  assert.equal(
    endOfDayInstant('2024-03-10', 'America/New_York'),
    '2024-03-11T03:59:59.999Z',
  );
  assert.equal(
    endOfDayInstant('2024-11-03', 'America/New_York'),
    '2024-11-04T04:59:59.999Z',
  );
  assert.equal(
    endOfDayInstant('2026-07-20', 'Asia/Seoul'),
    '2026-07-20T14:59:59.999Z',
  );
});

test('performs date arithmetic by epoch-day across leap days and year boundaries', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addDays('2023-03-01', -1), '2023-02-28');
  assert.equal(addDays('2023-12-31', 1), '2024-01-01');
  assert.equal(addDays('2024-03-09', 2), '2024-03-11');
  assert.equal(addDays('2024-11-02', 2), '2024-11-04');

  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2024-03-01', '2024-02-28'), -2);
  assert.equal(daysBetween('2023-12-31', '2024-01-01'), 1);
  assert.deepEqual(eachDay('2024-02-28', '2024-03-01'), [
    '2024-02-28',
    '2024-02-29',
    '2024-03-01',
  ]);

  assert.throws(() => addDays('2024-01-01', 0.5), TypeError);
  assert.throws(() => addDays('9999-12-31', 1), RangeError);
  assert.throws(() => eachDay('2024-01-02', '2024-01-01'), RangeError);
});

test('finds Monday and month boundaries without host locale dependence', () => {
  assert.equal(mondayOf('2023-12-31'), '2023-12-25');
  assert.equal(mondayOf('2024-01-01'), '2024-01-01');
  assert.equal(mondayOf('2024-01-03'), '2024-01-01');
  assert.equal(mondayOf('2025-01-01'), '2024-12-30');

  assert.equal(monthStart('2024-02-29'), '2024-02-01');
  assert.equal(shiftMonthStart('2024-01-31', 1), '2024-02-01');
  assert.equal(shiftMonthStart('2023-12-15', 1), '2024-01-01');
  assert.equal(shiftMonthStart('2024-01-15', -1), '2023-12-01');
  assert.equal(daysInMonth('2024-02-01'), 29);
  assert.equal(daysInMonth('2023-02-15'), 28);
  assert.equal(daysInMonth('1900-02-01'), 28);
  assert.equal(daysInMonth('2000-02-01'), 29);
  assert.equal(daysInMonth('2024-04-30'), 30);
  assert.equal(daysInMonth('2024-12-31'), 31);

  assert.throws(() => shiftMonthStart('2024-01-01', 1.5), TypeError);
  assert.throws(() => shiftMonthStart('0001-01-01', -1), RangeError);
});

test('builds matching today, rolling, and month-to-date comparison ranges', () => {
  assert.deepEqual(periodRanges('2024-03-31'), {
    today: {
      current: { start: '2024-03-31', end: '2024-03-31' },
      previous: { start: '2024-03-30', end: '2024-03-30' },
    },
    rolling7: {
      current: { start: '2024-03-25', end: '2024-03-31' },
      previous: { start: '2024-03-18', end: '2024-03-24' },
    },
    rolling30: {
      current: { start: '2024-03-02', end: '2024-03-31' },
      previous: { start: '2024-02-01', end: '2024-03-01' },
    },
    monthToDate: {
      current: { start: '2024-03-01', end: '2024-03-31' },
      previous: { start: '2024-02-01', end: '2024-02-29' },
    },
  });

  assert.deepEqual(periodRanges('2024-01-03').monthToDate, {
    current: { start: '2024-01-01', end: '2024-01-03' },
    previous: { start: '2023-12-01', end: '2023-12-03' },
  });
});

test('builds oldest-to-newest daily, Monday weekly, and monthly trend buckets', () => {
  const buckets = trendBuckets('2024-01-03');

  assert.equal(buckets.daily.length, 30);
  assert.deepEqual(buckets.daily[0], { start: '2023-12-05', end: '2023-12-05' });
  assert.deepEqual(buckets.daily.at(-1), { start: '2024-01-03', end: '2024-01-03' });

  assert.equal(buckets.weekly.length, 12);
  assert.deepEqual(buckets.weekly[0], { start: '2023-10-16', end: '2023-10-22' });
  assert.deepEqual(buckets.weekly.at(-2), { start: '2023-12-25', end: '2023-12-31' });
  assert.deepEqual(buckets.weekly.at(-1), { start: '2024-01-01', end: '2024-01-03' });

  assert.equal(buckets.monthly.length, 12);
  assert.deepEqual(buckets.monthly[0], { start: '2023-02-01', end: '2023-02-28' });
  assert.deepEqual(buckets.monthly.at(-2), { start: '2023-12-01', end: '2023-12-31' });
  assert.deepEqual(buckets.monthly.at(-1), { start: '2024-01-01', end: '2024-01-03' });
});

test('returns a Monday-based 53-week heatmap with 371 calendar cells', () => {
  const range = heatmapRange('2024-01-03');

  assert.equal(range.start, '2023-01-02');
  assert.equal(range.end, '2024-01-07');
  assert.equal(range.dates.length, 371);
  assert.equal(range.dates[0], range.start);
  assert.equal(range.dates.at(-1), range.end);
  assert.equal(range.dates[364], '2024-01-01');
  assert.equal(range.dates[366], '2024-01-03');
  assert.deepEqual(range.dates.slice(-4), [
    '2024-01-04',
    '2024-01-05',
    '2024-01-06',
    '2024-01-07',
  ]);
  assert.equal(daysBetween(range.start, range.end) + 1, 371);
});
