import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicSchemaError,
  SCHEMA_VERSION,
  serializeDeviceSnapshot,
  serializeProfileCandidate,
  validateDeviceSnapshot,
  validateIanaTimezone,
  validateProfileCandidate,
} from '../src/domain/schema.mjs';

const WRITER_KEY_HASH = 'a'.repeat(64);

function day(overrides = {}) {
  return {
    date: '2026-07-19',
    inputTokens: 120,
    outputTokens: 30,
    cacheReadTokens: 50,
    cacheWriteTokens: 10,
    totalTokens: 210,
    sessions: 2,
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    status: 'ok',
    lastSuccessfulAt: '2026-07-19T12:34:56.000Z',
    days: [day()],
    coverage: {
      totals: { startDate: '2026-07-19', endDate: '2026-07-19' },
      sessions: { startDate: '2026-07-19', endDate: '2026-07-19' },
    },
    ...overrides,
  };
}

function device(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    deviceId: 'device-00112233445566778899aabbccddeeff',
    writerKeyHash: WRITER_KEY_HASH,
    generatedAt: '2026-07-19T12:34:56.000Z',
    timezone: 'Asia/Seoul',
    collectorVersion: '1.0.0',
    sources: { codex: source() },
    ...overrides,
  };
}

function profile(overrides = {}) {
  const daily = overrides.daily ?? [
    { date: '2026-07-18', totalTokens: 90 },
    { date: '2026-07-19', totalTokens: 110 },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-profile',
    deviceId: 'device-00112233445566778899aabbccddeeff',
    writerKeyHash: WRITER_KEY_HASH,
    collectedAt: '2026-07-19T12:34:56.000Z',
    dateBasis: 'provider-calendar-date',
    daily,
    lifetimeTotalTokens: 19_300_000_000,
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

function expectSchemaError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PublicSchemaError);
    assert.equal(error.code, code);
    return true;
  });
}

test('schema v2 device snapshot accepts only one Codex source', () => {
  assert.equal(SCHEMA_VERSION, 2);
  const snapshot = device();
  assert.equal(validateDeviceSnapshot(snapshot), snapshot);
  assert.deepEqual(Object.keys(snapshot.sources), ['codex']);
  assert.deepEqual(JSON.parse(serializeDeviceSnapshot(snapshot)), snapshot);
});

test('schema v1 and every Claude field fail closed', () => {
  expectSchemaError(
    () => validateDeviceSnapshot(device({ schemaVersion: 1 })),
    'SCHEMA_VERSION',
  );

  const withClaude = device();
  withClaude.sources.claude = source();
  expectSchemaError(() => validateDeviceSnapshot(withClaude), 'UNKNOWN_FIELD');

  const dayWithClaude = device();
  dayWithClaude.sources.codex.days[0].claudeTokens = 1;
  expectSchemaError(() => validateDeviceSnapshot(dayWithClaude), 'UNKNOWN_FIELD');
});

test('Codex coverage is inclusive and session nullability follows coverage', () => {
  const unknownSessions = device();
  unknownSessions.sources.codex.days[0].sessions = null;
  unknownSessions.sources.codex.coverage.sessions = null;
  assert.doesNotThrow(() => validateDeviceSnapshot(unknownSessions));

  const outside = device();
  outside.sources.codex.coverage.totals = {
    startDate: '2026-07-18',
    endDate: '2026-07-18',
  };
  expectSchemaError(() => validateDeviceSnapshot(outside), 'COVERAGE');

  const uncoveredCount = device();
  uncoveredCount.sources.codex.coverage.sessions = null;
  expectSchemaError(() => validateDeviceSnapshot(uncoveredCount), 'COVERAGE');

  const reversed = device();
  reversed.sources.codex.coverage.totals = {
    startDate: '2026-07-20',
    endDate: '2026-07-19',
  };
  expectSchemaError(() => validateDeviceSnapshot(reversed), 'COVERAGE');
});

test('dates, counts, identity, timestamp, and timezone reject malformed values', () => {
  const invalidCases = [
    ['DEVICE_ID', device({ deviceId: 'laptop' })],
    ['WRITER_KEY_HASH', device({ writerKeyHash: 'abc' })],
    ['TIMESTAMP', device({ generatedAt: '2026-07-19 12:34:56' })],
    ['COLLECTOR_VERSION', device({ collectorVersion: 'latest' })],
  ];
  for (const [code, value] of invalidCases) {
    expectSchemaError(() => validateDeviceSnapshot(value), code);
  }

  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const snapshot = device();
    snapshot.sources.codex.days[0].totalTokens = value;
    expectSchemaError(() => validateDeviceSnapshot(snapshot), 'COUNT');
  }

  const invalidDate = device();
  invalidDate.sources.codex.days[0].date = '2026-02-30';
  expectSchemaError(() => validateDeviceSnapshot(invalidDate), 'DATE');

  assert.equal(validateIanaTimezone('Asia/Seoul'), 'Asia/Seoul');
  for (const timezone of ['', 'local', '+09:00', 'Mars/Olympus_Mons']) {
    expectSchemaError(() => validateIanaTimezone(timezone), 'TIMEZONE');
  }
});

test('profile candidate uses schema v2 provider calendar totals only', () => {
  const candidate = profile();
  assert.equal(validateProfileCandidate(candidate), candidate);
  assert.deepEqual(JSON.parse(serializeProfileCandidate(candidate)), candidate);

  expectSchemaError(
    () => validateProfileCandidate(profile({ schemaVersion: 1 })),
    'SCHEMA_VERSION',
  );
  expectSchemaError(
    () => validateProfileCandidate(profile({ dateBasis: 'Asia/Seoul' })),
    'DATE_BASIS',
  );
  expectSchemaError(
    () => validateProfileCandidate(profile({ lifetimeTotalTokens: -1 })),
    'COUNT',
  );

  const extra = profile();
  extra.daily[0].sessions = 3;
  expectSchemaError(() => validateProfileCandidate(extra), 'UNKNOWN_FIELD');
});

test('profile coverage supports empty history and rejects boundary drift', () => {
  const empty = profile({
    daily: [],
    coverage: { startDate: null, endDate: null, bucketCount: 0 },
  });
  assert.doesNotThrow(() => validateProfileCandidate(empty));

  const wrongCount = profile();
  wrongCount.coverage.bucketCount = 1;
  expectSchemaError(() => validateProfileCandidate(wrongCount), 'COVERAGE');

  const wrongStart = profile();
  wrongStart.coverage.startDate = '2026-07-17';
  expectSchemaError(() => validateProfileCandidate(wrongStart), 'COVERAGE');
});

test('public privacy preflight rejects raw identity, path, and secret material', () => {
  const forbidden = device();
  forbidden.sources.codex.days[0].prompt = 'private prompt';
  expectSchemaError(() => validateDeviceSnapshot(forbidden), 'FORBIDDEN_FIELD');

  const secret = 'Bearer this-must-never-appear-in-an-error-message';
  const sensitive = device();
  sensitive.sources.codex.note = secret;
  assert.throws(() => validateDeviceSnapshot(sensitive), (error) => {
    assert.equal(error.code, 'SENSITIVE_VALUE');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
