import { stableStringify } from '../lib/atomic-file.mjs';

export const SCHEMA_VERSION = 1;

const DEVICE_ID_PATTERN = /^device-[0-9a-f]{32}$/;
const WRITER_KEY_HASH_PATTERN = /^[0-9a-f]{64}$/;
const COLLECTOR_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SOURCE_STATUSES = new Set(['ok', 'error', 'unavailable']);

const FORBIDDEN_FIELD_NAMES = new Set([
  'hostname',
  'username',
  'path',
  'project',
  'model',
  'prompt',
  'response',
  'sessionid',
  'email',
  'authorization',
  'bearer',
  'secret',
  'apikey',
  'accesstoken',
  'refreshtoken',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+\S+/i,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:^|[\s"'])(?:[A-Za-z]:\\Users\\|\/(?:home|Users)\/)[^\s"']+/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\s*[:=]\s*\S+/i,
];

function normalizeFieldName(fieldName) {
  return fieldName.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

export class PublicSchemaError extends TypeError {
  constructor(code, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'PublicSchemaError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, path) {
  throw new PublicSchemaError(code, path);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPublicSafe(value, path = '$', ancestors = new WeakSet(), depth = 0) {
  if (depth > 64) {
    fail('MAX_DEPTH', path);
  }

  if (typeof value === 'string') {
    if (/[^\P{C}\t\n\r]/u.test(value)) {
      fail('CONTROL_CHARACTER', path);
    }
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        fail('SENSITIVE_VALUE', path);
      }
    }
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }
  if (ancestors.has(value)) {
    fail('CYCLIC_VALUE', path);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      for (const entry of value) {
        assertPublicSafe(entry, `${path}[]`, ancestors, depth + 1);
      }
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_FIELD_NAMES.has(normalizeFieldName(key))) {
        fail('FORBIDDEN_FIELD', path);
      }
      assertPublicSafe(entry, `${path}.${key}`, ancestors, depth + 1);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertObject(value, path) {
  if (!isPlainObject(value)) {
    fail('OBJECT', path);
  }
}

function assertExactKeys(value, required, optional, path) {
  assertObject(value, path);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('MISSING_FIELD', path);
    }
  }

  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('UNKNOWN_FIELD', path);
    }
  }
}

function assertSafeCount(value, path, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('COUNT', path);
  }
}

function assertDate(value, path) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    fail('DATE', path);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    fail('DATE', path);
  }
}

function assertInstant(value, path, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    fail('TIMESTAMP', path);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    fail('TIMESTAMP', path);
  }
}

function assertDeviceIdentity(value, path) {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) {
    fail('DEVICE_ID', path);
  }
}

function assertWriterKeyHash(value, path) {
  if (typeof value !== 'string' || !WRITER_KEY_HASH_PATTERN.test(value)) {
    fail('WRITER_KEY_HASH', path);
  }
}

function assertSchemaVersion(value, path) {
  if (value !== SCHEMA_VERSION) {
    fail('SCHEMA_VERSION', path);
  }
}

function assertSortedUniqueDays(days, path, validator) {
  if (!Array.isArray(days)) {
    fail('ARRAY', path);
  }
  let previousDate;
  for (const day of days) {
    validator(day, `${path}[]`);
    if (previousDate !== undefined && day.date <= previousDate) {
      fail('DAY_ORDER', path);
    }
    previousDate = day.date;
  }
}

function validateUsageDay(day, path) {
  assertExactKeys(
    day,
    [
      'date',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'sessions',
    ],
    [],
    path,
  );
  assertDate(day.date, `${path}.date`);
  assertSafeCount(day.inputTokens, `${path}.inputTokens`);
  assertSafeCount(day.outputTokens, `${path}.outputTokens`);
  assertSafeCount(day.cacheReadTokens, `${path}.cacheReadTokens`);
  assertSafeCount(day.cacheWriteTokens, `${path}.cacheWriteTokens`);
  assertSafeCount(day.totalTokens, `${path}.totalTokens`);
  assertSafeCount(day.sessions, `${path}.sessions`, { nullable: true });
}

function validateSource(source, path) {
  assertExactKeys(source, ['status', 'lastSuccessfulAt', 'days'], ['errorCode'], path);
  if (!SOURCE_STATUSES.has(source.status)) {
    fail('SOURCE_STATUS', `${path}.status`);
  }
  assertInstant(source.lastSuccessfulAt, `${path}.lastSuccessfulAt`, { nullable: true });
  assertSortedUniqueDays(source.days, `${path}.days`, validateUsageDay);

  if (source.status === 'ok') {
    if (source.lastSuccessfulAt === null || Object.hasOwn(source, 'errorCode')) {
      fail('SOURCE_STATE', path);
    }
  } else if (Object.hasOwn(source, 'errorCode')) {
    if (typeof source.errorCode !== 'string' || !ERROR_CODE_PATTERN.test(source.errorCode)) {
      fail('ERROR_CODE', `${path}.errorCode`);
    }
  }

  if (source.days.length > 0 && source.lastSuccessfulAt === null) {
    fail('SOURCE_STATE', path);
  }
}

function validateProfileDay(day, path) {
  assertExactKeys(day, ['date', 'totalTokens'], [], path);
  assertDate(day.date, `${path}.date`);
  assertSafeCount(day.totalTokens, `${path}.totalTokens`);
}

export function validateIanaTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone.length === 0) {
    fail('TIMEZONE', '$.timezone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0);
  } catch {
    fail('TIMEZONE', '$.timezone');
  }

  if (timezone === 'local' || /^[+-]\d{2}:\d{2}$/.test(timezone)) {
    fail('TIMEZONE', '$.timezone');
  }
  return timezone;
}

export function validateDeviceSnapshot(snapshot) {
  assertPublicSafe(snapshot);
  assertExactKeys(
    snapshot,
    [
      'schemaVersion',
      'deviceId',
      'writerKeyHash',
      'generatedAt',
      'timezone',
      'collectorVersion',
      'sources',
    ],
    [],
    '$',
  );
  assertSchemaVersion(snapshot.schemaVersion, '$.schemaVersion');
  assertDeviceIdentity(snapshot.deviceId, '$.deviceId');
  assertWriterKeyHash(snapshot.writerKeyHash, '$.writerKeyHash');
  assertInstant(snapshot.generatedAt, '$.generatedAt');
  validateIanaTimezone(snapshot.timezone);
  if (
    typeof snapshot.collectorVersion !== 'string' ||
    !COLLECTOR_VERSION_PATTERN.test(snapshot.collectorVersion)
  ) {
    fail('COLLECTOR_VERSION', '$.collectorVersion');
  }

  assertExactKeys(snapshot.sources, ['claude', 'codex'], [], '$.sources');
  validateSource(snapshot.sources.claude, '$.sources.claude');
  validateSource(snapshot.sources.codex, '$.sources.codex');
  return snapshot;
}

export function validateProfileCandidate(candidate) {
  assertPublicSafe(candidate);
  assertExactKeys(
    candidate,
    [
      'schemaVersion',
      'kind',
      'deviceId',
      'writerKeyHash',
      'collectedAt',
      'dateBasis',
      'daily',
      'coverage',
    ],
    ['lifetimeTotalTokens'],
    '$',
  );
  assertSchemaVersion(candidate.schemaVersion, '$.schemaVersion');
  if (candidate.kind !== 'codex-profile') {
    fail('PROFILE_KIND', '$.kind');
  }
  assertDeviceIdentity(candidate.deviceId, '$.deviceId');
  assertWriterKeyHash(candidate.writerKeyHash, '$.writerKeyHash');
  assertInstant(candidate.collectedAt, '$.collectedAt');
  if (candidate.dateBasis !== 'provider-calendar-date') {
    fail('DATE_BASIS', '$.dateBasis');
  }
  assertSortedUniqueDays(candidate.daily, '$.daily', validateProfileDay);
  if (Object.hasOwn(candidate, 'lifetimeTotalTokens')) {
    assertSafeCount(candidate.lifetimeTotalTokens, '$.lifetimeTotalTokens');
  }

  assertExactKeys(
    candidate.coverage,
    ['startDate', 'endDate', 'bucketCount'],
    [],
    '$.coverage',
  );
  assertSafeCount(candidate.coverage.bucketCount, '$.coverage.bucketCount');
  if (candidate.daily.length === 0) {
    if (
      candidate.coverage.startDate !== null ||
      candidate.coverage.endDate !== null ||
      candidate.coverage.bucketCount !== 0
    ) {
      fail('COVERAGE', '$.coverage');
    }
  } else {
    assertDate(candidate.coverage.startDate, '$.coverage.startDate');
    assertDate(candidate.coverage.endDate, '$.coverage.endDate');
    if (
      candidate.coverage.startDate !== candidate.daily[0].date ||
      candidate.coverage.endDate !== candidate.daily.at(-1).date ||
      candidate.coverage.bucketCount !== candidate.daily.length
    ) {
      fail('COVERAGE', '$.coverage');
    }
  }
  return candidate;
}

export function serializeDeviceSnapshot(snapshot) {
  validateDeviceSnapshot(snapshot);
  return stableStringify(snapshot);
}

export function serializeProfileCandidate(candidate) {
  validateProfileCandidate(candidate);
  return stableStringify(candidate);
}
