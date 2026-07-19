import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeUsage, UsageMergeError } from '../src/domain/merge.mjs';
import { PublicSchemaError, SCHEMA_VERSION } from '../src/domain/schema.mjs';

const NOW = '2026-07-19T12:00:00.000Z';
const WRITER_KEY_HASH = 'a'.repeat(64);

function deviceId(hexCharacter) {
  return `device-${hexCharacter.repeat(32)}`;
}

function usageDay(date, overrides = {}) {
  return {
    date,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
    totalTokens: 100,
    sessions: 1,
    ...overrides,
  };
}

function source(days = [], overrides = {}) {
  const totals = {
    startDate: days[0]?.date ?? '2026-07-19',
    endDate: '2026-07-19',
  };
  return {
    status: 'ok',
    lastSuccessfulAt: '2026-07-19T11:00:00.000Z',
    days,
    coverage: {
      totals,
      sessions: days.some((day) => day.sessions === null) ? null : { ...totals },
    },
    ...overrides,
  };
}

function deviceSnapshot(hexCharacter, overrides = {}) {
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    deviceId: deviceId(hexCharacter),
    writerKeyHash: WRITER_KEY_HASH,
    generatedAt: '2026-07-19T11:00:00.000Z',
    timezone: 'Asia/Seoul',
    collectorVersion: '1.0.0',
    sources: {
      claude: source(),
      codex: source(),
    },
  };

  return {
    ...snapshot,
    ...overrides,
    sources: {
      ...snapshot.sources,
      ...overrides.sources,
    },
  };
}

function profileCandidate(hexCharacter, overrides = {}) {
  const daily = overrides.daily ?? [
    { date: '2026-07-19', totalTokens: 700 },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-profile',
    deviceId: deviceId(hexCharacter),
    writerKeyHash: WRITER_KEY_HASH,
    collectedAt: '2026-07-19T11:00:00.000Z',
    dateBasis: 'provider-calendar-date',
    daily,
    coverage: daily.length === 0
      ? { startDate: null, endDate: null, bucketCount: 0 }
      : {
          startDate: daily[0].date,
          endDate: daily.at(-1).date,
          bucketCount: daily.length,
        },
    ...overrides,
    daily,
  };
}

function metric(overrides = {}) {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    sessions: 0,
    ...overrides,
  };
}

test('merges every device for Claude and local Codex by sorted calendar day', () => {
  const first = deviceSnapshot('1', {
    sources: {
      claude: source([
        usageDay('2026-07-18', { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10, sessions: 1 }),
      ]),
      codex: source([
        usageDay('2026-07-19', { inputTokens: 2, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5, totalTokens: 14, sessions: 2 }),
      ]),
    },
  });
  const second = deviceSnapshot('2', {
    sources: {
      claude: source([
        usageDay('2026-07-18', { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, totalTokens: 100, sessions: 3 }),
        usageDay('2026-07-19', { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8, totalTokens: 26, sessions: 4 }),
      ]),
      codex: source([
        usageDay('2026-07-18', { inputTokens: 7, outputTokens: 8, cacheReadTokens: 9, cacheWriteTokens: 10, totalTokens: 34, sessions: 5 }),
      ]),
    },
  });

  const result = mergeUsage({
    deviceSnapshots: [second, first],
    profileCandidates: [],
    asOf: NOW,
  });

  assert.equal(result.codexSource, 'devices');
  assert.equal(result.timezone, 'Asia/Seoul');
  assert.deepEqual(result.days, [
    {
      date: '2026-07-18',
      claude: metric({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, total: 110, sessions: 4 }),
      codex: metric({ input: 7, output: 8, cacheRead: 9, cacheWrite: 10, total: 34, sessions: 5 }),
    },
    {
      date: '2026-07-19',
      claude: metric({ input: 5, output: 6, cacheRead: 7, cacheWrite: 8, total: 26, sessions: 4 }),
      codex: metric({ input: 2, output: 3, cacheRead: 4, cacheWrite: 5, total: 14, sessions: 2 }),
    },
  ]);
  assert.equal(result.diagnostics.deviceCount, 2);
  assert.equal(result.diagnostics.profileCandidateCount, 0);
  assert.equal(result.diagnostics.selectedProfileAgeHours, null);
  assert.deepEqual(
    mergeUsage({ deviceSnapshots: [first, second], profileCandidates: [], asOf: NOW }),
    result,
  );
});

test('selects only the newest fresh Codex profile and ignores every local Codex day', () => {
  const device = deviceSnapshot('1', {
    sources: {
      claude: source([usageDay('2026-07-18', { totalTokens: 100 })]),
      codex: source([
        usageDay('2026-07-16', { totalTokens: 9_999 }),
        usageDay('2026-07-19', { totalTokens: 8_888 }),
      ]),
    },
  });
  const older = profileCandidate('2', {
    collectedAt: '2026-07-19T09:00:00.000Z',
    daily: [{ date: '2026-07-17', totalTokens: 500 }],
    lifetimeTotalTokens: 5_000,
  });
  const newest = profileCandidate('3', {
    collectedAt: '2026-07-19T11:00:00.000Z',
    daily: [{ date: '2026-07-19', totalTokens: 700 }],
    lifetimeTotalTokens: 7_000,
  });

  const result = mergeUsage({
    deviceSnapshots: [device],
    profileCandidates: [older, newest],
    asOf: NOW,
  });

  assert.equal(result.codexSource, 'profile');
  assert.equal(result.codexLifetimeTotalTokens, 7_000);
  assert.deepEqual(result.days, [
    {
      date: '2026-07-18',
      claude: metric({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100, sessions: 1 }),
      codex: metric({ input: null, output: null, cacheRead: null, cacheWrite: null, total: 0, sessions: null }),
    },
    {
      date: '2026-07-19',
      claude: metric(),
      codex: metric({ input: null, output: null, cacheRead: null, cacheWrite: null, total: 700, sessions: null }),
    },
  ]);
  assert.equal(result.days.some((day) => day.date === '2026-07-16'), false);
  assert.equal(result.diagnostics.profileCandidateCount, 2);
  assert.equal(result.diagnostics.validProfileCandidateCount, 2);
  assert.equal(result.diagnostics.freshProfileCandidateCount, 2);
  assert.equal(result.diagnostics.selectedProfileAgeHours, 1);
  assert.deepEqual(result.diagnostics.selectedProfileCoverage, newest.coverage);
  assert.deepEqual(result.diagnostics.breakdownCoverage, {
    claude: { tokens: 'complete', sessions: 'complete' },
    codex: { tokens: 'unavailable', sessions: 'unavailable' },
    combinedTokenMix: 'partial',
  });
  assert.equal(result.diagnostics.codexLifetimeCoverage, 'provider-reported');
});

test('breaks equal profile timestamps by ascending lexical deviceId regardless of input order', () => {
  const lexicalFirst = profileCandidate('1', {
    daily: [{ date: '2026-07-19', totalTokens: 111 }],
  });
  const lexicalSecond = profileCandidate('f', {
    daily: [{ date: '2026-07-19', totalTokens: 999 }],
  });
  const device = deviceSnapshot('a');

  const left = mergeUsage({
    deviceSnapshots: [device],
    profileCandidates: [lexicalSecond, lexicalFirst],
    asOf: NOW,
  });
  const right = mergeUsage({
    deviceSnapshots: [device],
    profileCandidates: [lexicalFirst, lexicalSecond],
    asOf: NOW,
  });

  assert.deepEqual(left, right);
  assert.equal(left.days[0].codex.total, 111);
});

test('falls back to all local Codex data when profiles are stale, malformed, or too far in the future', () => {
  const device = deviceSnapshot('1', {
    sources: {
      codex: source([usageDay('2026-07-19', { totalTokens: 321 })]),
    },
  });
  const stale = profileCandidate('2', {
    collectedAt: '2026-07-17T11:59:59.999Z',
  });
  const malformed = profileCandidate('3');
  malformed.daily[0].totalTokens = -1;
  const future = profileCandidate('4', {
    collectedAt: '2026-07-19T12:05:00.001Z',
  });

  const result = mergeUsage({
    deviceSnapshots: [device],
    profileCandidates: [future, malformed, stale],
    asOf: NOW,
  });

  assert.equal(result.codexSource, 'devices');
  assert.equal(result.days[0].codex.total, 321);
  assert.equal(result.diagnostics.profileCandidateCount, 3);
  assert.equal(result.diagnostics.validProfileCandidateCount, 2);
  assert.equal(result.diagnostics.invalidProfileCandidateCount, 1);
  assert.equal(result.diagnostics.freshProfileCandidateCount, 0);
  assert.equal(result.diagnostics.selectedProfileAgeHours, null);
});

test('accepts a profile within the default five-minute future clock skew and clamps age to zero', () => {
  const result = mergeUsage({
    deviceSnapshots: [deviceSnapshot('1')],
    profileCandidates: [profileCandidate('2', { collectedAt: '2026-07-19T12:05:00.000Z' })],
    asOf: NOW,
  });

  assert.equal(result.codexSource, 'profile');
  assert.equal(result.diagnostics.selectedProfileAgeHours, 0);
});

test('rejects duplicate device snapshots and timezone disagreement', () => {
  const duplicateA = deviceSnapshot('1');
  const duplicateB = deviceSnapshot('1', { generatedAt: '2026-07-19T10:00:00.000Z' });

  assert.throws(
    () => mergeUsage({ deviceSnapshots: [duplicateA, duplicateB], asOf: NOW }),
    (error) => error instanceof UsageMergeError && error.code === 'DUPLICATE_DEVICE',
  );

  const anotherTimezone = deviceSnapshot('2', { timezone: 'UTC' });
  assert.throws(
    () => mergeUsage({ deviceSnapshots: [duplicateA, anotherTimezone], asOf: NOW }),
    (error) => error instanceof UsageMergeError && error.code === 'TIMEZONE_MISMATCH',
  );
});

test('reuses the public schema validator for malformed device days', () => {
  const malformed = deviceSnapshot('1', {
    sources: {
      claude: source([
        usageDay('2026-07-19'),
        usageDay('2026-07-19'),
      ]),
    },
  });

  assert.throws(
    () => mergeUsage({ deviceSnapshots: [malformed], asOf: NOW }),
    (error) => error instanceof PublicSchemaError && error.code === 'DAY_ORDER',
  );
});

test('retains stale device history while reporting devices older than 72 hours', () => {
  const stale = deviceSnapshot('1', {
    generatedAt: '2026-07-16T11:59:59.999Z',
    sources: {
      claude: source([usageDay('2026-07-16', { totalTokens: 123 })]),
    },
  });
  const boundary = deviceSnapshot('2', {
    generatedAt: '2026-07-16T12:00:00.000Z',
  });

  const result = mergeUsage({
    deviceSnapshots: [stale, boundary],
    asOf: NOW,
  });

  assert.equal(result.diagnostics.staleDeviceCount, 1);
  assert.equal(result.days[0].claude.total, 123);
});

test('propagates an observed null session count but treats a missing local date as zero', () => {
  const first = deviceSnapshot('1', {
    sources: {
      claude: source([usageDay('2026-07-18', { sessions: null })]),
      codex: source([usageDay('2026-07-19', { sessions: null })]),
    },
  });
  const second = deviceSnapshot('2', {
    sources: {
      claude: source([
        usageDay('2026-07-18', { sessions: 4 }),
        usageDay('2026-07-19', { sessions: 3 }),
      ]),
      codex: source([usageDay('2026-07-18', { sessions: 2 })]),
    },
  });

  const result = mergeUsage({ deviceSnapshots: [first, second], asOf: NOW });

  assert.equal(result.days[0].claude.sessions, null);
  assert.equal(result.days[0].codex.sessions, 2);
  assert.equal(result.days[1].claude.sessions, 3);
  assert.equal(result.days[1].codex.sessions, null);
  assert.deepEqual(result.diagnostics.breakdownCoverage, {
    claude: { tokens: 'complete', sessions: 'partial' },
    codex: { tokens: 'complete', sessions: 'partial' },
    combinedTokenMix: 'complete',
  });
});

test('rejects safe-integer overflow instead of emitting rounded totals', () => {
  const first = deviceSnapshot('1', {
    sources: {
      claude: source([usageDay('2026-07-19', { totalTokens: Number.MAX_SAFE_INTEGER })]),
    },
  });
  const second = deviceSnapshot('2', {
    sources: {
      claude: source([usageDay('2026-07-19', { totalTokens: 1 })]),
    },
  });

  assert.throws(
    () => mergeUsage({ deviceSnapshots: [first, second], asOf: NOW }),
    (error) => error instanceof UsageMergeError && error.code === 'SAFE_INTEGER_OVERFLOW',
  );
});

test('does not infer full lifetime usage when the provider omits lifetimeTotalTokens', () => {
  const candidate = profileCandidate('2', {
    daily: [{ date: '2026-07-19', totalTokens: 700 }],
  });
  const result = mergeUsage({
    deviceSnapshots: [deviceSnapshot('1')],
    profileCandidates: [candidate],
    asOf: NOW,
  });

  assert.equal(Object.hasOwn(result, 'codexLifetimeTotalTokens'), false);
  assert.equal(result.diagnostics.codexLifetimeCoverage, 'unavailable');
});

test('uses an explicit timezone for an empty device set and otherwise defaults to UTC', () => {
  const explicit = mergeUsage({
    deviceSnapshots: [],
    profileCandidates: [],
    timezone: 'Asia/Seoul',
    asOf: NOW,
  });
  const fallback = mergeUsage({ deviceSnapshots: [], profileCandidates: [], asOf: NOW });

  assert.equal(explicit.timezone, 'Asia/Seoul');
  assert.equal(fallback.timezone, 'UTC');
  assert.deepEqual(explicit.days, []);
});

test('reports local and provider calendar coverage without converting profile dates', () => {
  const first = deviceSnapshot('1', {
    sources: {
      claude: source(
        [usageDay('2026-03-01', { sessions: null })],
        {
          coverage: {
            totals: { startDate: '2026-03-01', endDate: '2026-03-07' },
            sessions: null,
          },
        },
      ),
      codex: source([], {
        coverage: {
          totals: { startDate: '2026-03-01', endDate: '2026-03-07' },
          sessions: { startDate: '2026-03-01', endDate: '2026-03-07' },
        },
      }),
    },
  });
  const second = deviceSnapshot('2', {
    sources: {
      claude: source(
        [usageDay('2026-03-03', {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          sessions: 0,
        })],
        {
          coverage: {
            totals: { startDate: '2026-03-03', endDate: '2026-03-07' },
            sessions: { startDate: '2026-03-03', endDate: '2026-03-07' },
          },
        },
      ),
      codex: source([], {
        coverage: {
          totals: { startDate: '2026-03-03', endDate: '2026-03-07' },
          sessions: { startDate: '2026-03-03', endDate: '2026-03-07' },
        },
      }),
    },
  });

  const local = mergeUsage({ deviceSnapshots: [first, second], asOf: NOW });

  assert.deepEqual(local.coverage, {
    claude: {
      dateBasis: 'Asia/Seoul',
      totals: { startDate: '2026-03-03', endDate: '2026-03-07' },
      breakdown: { startDate: '2026-03-03', endDate: '2026-03-07' },
      sessions: null,
    },
    codex: {
      dateBasis: 'Asia/Seoul',
      totals: { startDate: '2026-03-03', endDate: '2026-03-07' },
      breakdown: { startDate: '2026-03-03', endDate: '2026-03-07' },
      sessions: { startDate: '2026-03-03', endDate: '2026-03-07' },
    },
  });
  assert.deepEqual(local.diagnostics.dateBasis, {
    claude: 'Asia/Seoul',
    codex: 'Asia/Seoul',
    profileDatesPreserved: false,
  });

  const candidate = profileCandidate('3', {
    daily: [
      { date: '2026-07-18', totalTokens: 300 },
      { date: '2026-07-19', totalTokens: 400 },
    ],
  });
  const profile = mergeUsage({
    deviceSnapshots: [first, second],
    profileCandidates: [candidate],
    asOf: NOW,
  });

  assert.deepEqual(profile.coverage.codex, {
    dateBasis: 'provider-calendar-date',
    totals: { startDate: '2026-07-18', endDate: '2026-07-19' },
    breakdown: null,
    sessions: null,
  });
  assert.deepEqual(profile.diagnostics.dateBasis, {
    claude: 'Asia/Seoul',
    codex: 'provider-calendar-date',
    profileDatesPreserved: true,
  });
});

test('shrinks complete local coverage when one device stops updating', () => {
  const current = deviceSnapshot('1', {
    sources: {
      claude: source([], {
        coverage: {
          totals: { startDate: '2026-03-01', endDate: '2026-03-07' },
          sessions: { startDate: '2026-03-01', endDate: '2026-03-07' },
        },
      }),
    },
  });
  const stale = deviceSnapshot('2', {
    sources: {
      claude: source([], {
        coverage: {
          totals: { startDate: '2026-03-03', endDate: '2026-03-05' },
          sessions: { startDate: '2026-03-03', endDate: '2026-03-05' },
        },
      }),
    },
  });

  const result = mergeUsage({ deviceSnapshots: [current, stale], asOf: NOW });

  assert.deepEqual(result.coverage.claude, {
    dateBasis: 'Asia/Seoul',
    totals: { startDate: '2026-03-03', endDate: '2026-03-05' },
    breakdown: { startDate: '2026-03-03', endDate: '2026-03-05' },
    sessions: { startDate: '2026-03-03', endDate: '2026-03-05' },
  });
  assert.equal('2026-03-06' > result.coverage.claude.totals.endDate, true);
});

test('reports unknown local coverage when any device is unknown or ranges do not overlap', () => {
  const known = deviceSnapshot('1', {
    sources: {
      claude: source([], {
        coverage: {
          totals: { startDate: '2026-03-01', endDate: '2026-03-02' },
          sessions: { startDate: '2026-03-01', endDate: '2026-03-02' },
        },
      }),
    },
  });
  const unknown = deviceSnapshot('2', {
    sources: {
      claude: source([], {
        status: 'error',
        errorCode: 'CCUSAGE_COMMAND_FAILED',
        lastSuccessfulAt: null,
        coverage: { totals: null, sessions: null },
      }),
    },
  });
  const disjoint = deviceSnapshot('3', {
    sources: {
      claude: source([], {
        coverage: {
          totals: { startDate: '2026-03-03', endDate: '2026-03-04' },
          sessions: { startDate: '2026-03-03', endDate: '2026-03-04' },
        },
      }),
    },
  });

  assert.deepEqual(
    mergeUsage({ deviceSnapshots: [known, unknown], asOf: NOW }).coverage.claude,
    { dateBasis: 'Asia/Seoul', totals: null, breakdown: null, sessions: null },
  );
  assert.deepEqual(
    mergeUsage({ deviceSnapshots: [known, disjoint], asOf: NOW }).coverage.claude,
    { dateBasis: 'Asia/Seoul', totals: null, breakdown: null, sessions: null },
  );
});
