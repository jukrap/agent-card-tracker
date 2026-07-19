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

function makeDay(overrides = {}) {
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

function makeSource(overrides = {}) {
  return {
    status: 'ok',
    lastSuccessfulAt: '2026-07-19T12:34:56.000Z',
    days: [makeDay()],
    ...overrides,
  };
}

function makeDeviceSnapshot(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    deviceId: 'device-00112233445566778899aabbccddeeff',
    writerKeyHash: WRITER_KEY_HASH,
    generatedAt: '2026-07-19T12:34:56.000Z',
    timezone: 'Asia/Seoul',
    collectorVersion: '1.0.0',
    sources: {
      claude: makeSource(),
      codex: makeSource({
        status: 'unavailable',
        errorCode: 'NO_LOCAL_DATA',
        lastSuccessfulAt: null,
        days: [],
      }),
    },
    ...overrides,
  };
}

function makeProfileCandidate(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'codex-profile',
    deviceId: 'device-00112233445566778899aabbccddeeff',
    writerKeyHash: WRITER_KEY_HASH,
    collectedAt: '2026-07-19T12:34:56.000Z',
    dateBasis: 'provider-calendar-date',
    daily: [
      { date: '2026-07-18', totalTokens: 90 },
      { date: '2026-07-19', totalTokens: 110 },
    ],
    lifetimeTotalTokens: 1_234,
    coverage: {
      startDate: '2026-07-18',
      endDate: '2026-07-19',
      bucketCount: 2,
    },
    ...overrides,
  };
}

function expectSchemaError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PublicSchemaError);
    assert.equal(error.code, code);
    return true;
  });
}

test('device snapshot accepts only the public daily aggregate contract', () => {
  const snapshot = makeDeviceSnapshot();

  assert.equal(validateDeviceSnapshot(snapshot), snapshot);
  const serialized = serializeDeviceSnapshot(snapshot);
  assert.ok(serialized.endsWith('\n'));
  assert.deepEqual(JSON.parse(serialized), snapshot);
});

test('profile candidate accepts provider calendar dates and sanitized coverage', () => {
  const candidate = makeProfileCandidate();

  assert.equal(validateProfileCandidate(candidate), candidate);
  const serialized = serializeProfileCandidate(candidate);
  assert.ok(serialized.endsWith('\n'));
  assert.deepEqual(JSON.parse(serialized), candidate);
});

test('sessions may be null only when the collector could not observe them', () => {
  const snapshot = makeDeviceSnapshot();
  snapshot.sources.claude.days[0].sessions = null;

  assert.doesNotThrow(() => validateDeviceSnapshot(snapshot));
});

test('schema version, device id, writer hash, timestamp, and collector version fail closed', () => {
  const cases = [
    ['SCHEMA_VERSION', { schemaVersion: 2 }],
    ['DEVICE_ID', { deviceId: 'office-laptop' }],
    ['WRITER_KEY_HASH', { writerKeyHash: 'abc123' }],
    ['TIMESTAMP', { generatedAt: '2026-07-19 12:34:56' }],
    ['COLLECTOR_VERSION', { collectorVersion: 'latest' }],
  ];

  for (const [code, overrides] of cases) {
    expectSchemaError(() => validateDeviceSnapshot(makeDeviceSnapshot(overrides)), code);
  }
});

test('timezone must be an IANA timezone understood by the runtime', () => {
  assert.equal(validateIanaTimezone('Asia/Seoul'), 'Asia/Seoul');
  assert.equal(validateIanaTimezone('America/New_York'), 'America/New_York');

  for (const timezone of ['', 'local', '+09:00', 'Mars/Olympus_Mons']) {
    expectSchemaError(() => validateIanaTimezone(timezone), 'TIMEZONE');
  }
});

test('dates must exist on the calendar and daily records must be unique and sorted', () => {
  const invalidDate = makeDeviceSnapshot();
  invalidDate.sources.claude.days[0].date = '2026-02-30';
  expectSchemaError(() => validateDeviceSnapshot(invalidDate), 'DATE');

  const duplicate = makeDeviceSnapshot();
  duplicate.sources.claude.days.push(makeDay());
  expectSchemaError(() => validateDeviceSnapshot(duplicate), 'DAY_ORDER');

  const descending = makeDeviceSnapshot();
  descending.sources.claude.days = [makeDay(), makeDay({ date: '2026-07-18' })];
  expectSchemaError(() => validateDeviceSnapshot(descending), 'DAY_ORDER');
});

test('all numeric usage values must be non-negative safe integers', () => {
  for (const value of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const snapshot = makeDeviceSnapshot();
    snapshot.sources.claude.days[0].inputTokens = value;
    expectSchemaError(() => validateDeviceSnapshot(snapshot), 'COUNT');
  }

  const invalidSessions = makeDeviceSnapshot();
  invalidSessions.sources.claude.days[0].sessions = -1;
  expectSchemaError(() => validateDeviceSnapshot(invalidSessions), 'COUNT');
});

test('all objects use exact allowlists, including nested source and day records', () => {
  const rootUnknown = makeDeviceSnapshot({ displayName: 'work' });
  expectSchemaError(() => validateDeviceSnapshot(rootUnknown), 'UNKNOWN_FIELD');

  const sourceUnknown = makeDeviceSnapshot();
  sourceUnknown.sources.claude.costUSD = 1.25;
  expectSchemaError(() => validateDeviceSnapshot(sourceUnknown), 'UNKNOWN_FIELD');

  const dayUnknown = makeDeviceSnapshot();
  dayUnknown.sources.claude.days[0].model = 'private-model';
  expectSchemaError(() => validateDeviceSnapshot(dayUnknown), 'FORBIDDEN_FIELD');

  const unknownSource = makeDeviceSnapshot();
  unknownSource.sources.other = makeSource();
  expectSchemaError(() => validateDeviceSnapshot(unknownSource), 'UNKNOWN_FIELD');
});

test('privacy preflight rejects identity, raw-content, path, email, and secret material anywhere', () => {
  const forbiddenFields = [
    ['hostname', 'workstation'],
    ['username', 'alice'],
    ['path', String.raw`C:\Users\alice\.codex`],
    ['project', 'private-project'],
    ['prompt', 'private prompt'],
    ['response', 'private response'],
    ['sessionId', 'session-123'],
    ['email', 'alice@example.com'],
  ];

  for (const [field, value] of forbiddenFields) {
    const snapshot = makeDeviceSnapshot();
    snapshot.sources.claude.days[0][field] = value;
    expectSchemaError(() => validateDeviceSnapshot(snapshot), 'FORBIDDEN_FIELD');
  }

  const sensitiveValues = [
    'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz',
    'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
    'alice@example.com',
    String.raw`C:\Users\alice\.codex\sessions`,
    '/home/alice/.claude/projects',
  ];

  for (const value of sensitiveValues) {
    const snapshot = makeDeviceSnapshot();
    snapshot.sources.claude.note = value;
    expectSchemaError(() => validateDeviceSnapshot(snapshot), 'SENSITIVE_VALUE');
  }
});

test('validation errors never echo a secret-shaped value', () => {
  const secret = 'Bearer this-must-never-appear-in-an-error-message';
  const snapshot = makeDeviceSnapshot();
  snapshot.sources.claude.note = secret;

  assert.throws(() => validateDeviceSnapshot(snapshot), (error) => {
    assert.equal(error.code, 'SENSITIVE_VALUE');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('source status and lastSuccessfulAt preserve safe failure state', () => {
  const missingTimestamp = makeDeviceSnapshot();
  delete missingTimestamp.sources.claude.lastSuccessfulAt;
  expectSchemaError(() => validateDeviceSnapshot(missingTimestamp), 'MISSING_FIELD');

  const badStatus = makeDeviceSnapshot();
  badStatus.sources.claude.status = 'broken';
  expectSchemaError(() => validateDeviceSnapshot(badStatus), 'SOURCE_STATUS');

  const badErrorCode = makeDeviceSnapshot();
  badErrorCode.sources.codex.errorCode = 'failed: /home/alice';
  expectSchemaError(() => validateDeviceSnapshot(badErrorCode), 'SENSITIVE_VALUE');

  const healthyWithError = makeDeviceSnapshot();
  healthyWithError.sources.claude.errorCode = 'TIMEOUT';
  expectSchemaError(() => validateDeviceSnapshot(healthyWithError), 'SOURCE_STATE');
});

test('profile coverage and daily contract are internally consistent', () => {
  const mismatch = makeProfileCandidate();
  mismatch.coverage.bucketCount = 1;
  expectSchemaError(() => validateProfileCandidate(mismatch), 'COVERAGE');

  const wrongStart = makeProfileCandidate();
  wrongStart.coverage.startDate = '2026-07-17';
  expectSchemaError(() => validateProfileCandidate(wrongStart), 'COVERAGE');

  const empty = makeProfileCandidate({
    daily: [],
    coverage: { startDate: null, endDate: null, bucketCount: 0 },
  });
  assert.doesNotThrow(() => validateProfileCandidate(empty));

  const unknown = makeProfileCandidate({ coverage: { startDate: null, endDate: null, bucketCount: 0, note: 'x' } });
  expectSchemaError(() => validateProfileCandidate(unknown), 'UNKNOWN_FIELD');
});

test('profile kind, date basis, lifetime, and daily values fail closed', () => {
  expectSchemaError(
    () => validateProfileCandidate(makeProfileCandidate({ kind: 'profile' })),
    'PROFILE_KIND',
  );
  expectSchemaError(
    () => validateProfileCandidate(makeProfileCandidate({ dateBasis: 'local-timezone' })),
    'DATE_BASIS',
  );
  expectSchemaError(
    () => validateProfileCandidate(makeProfileCandidate({ lifetimeTotalTokens: -1 })),
    'COUNT',
  );

  const invalidDaily = makeProfileCandidate();
  invalidDaily.daily[0].inputTokens = 12;
  expectSchemaError(() => validateProfileCandidate(invalidDaily), 'UNKNOWN_FIELD');
});
