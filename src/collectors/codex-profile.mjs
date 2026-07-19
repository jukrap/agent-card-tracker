export const CODEX_PROFILE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/profiles/me';
export const DEFAULT_PROFILE_TIMEOUT_MS = 15_000;
export const MAX_PROFILE_RESPONSE_BYTES = 1024 * 1024;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COLLECTED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RFC3339_PATTERN = /^(?<date>\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
const MAX_BEARER_BYTES = 16 * 1024;

const ERROR_MESSAGES = Object.freeze({
  AUTH_FAILED: 'Codex profile authentication failed',
  HTTP_ERROR: 'Codex profile request failed',
  INVALID_ARGUMENT: 'Codex profile collector received an invalid argument',
  INVALID_CONTENT_TYPE: 'Codex profile response was not JSON',
  INVALID_JSON: 'Codex profile response was not valid JSON',
  INVALID_SCHEMA: 'Codex profile response did not match the expected schema',
  NETWORK_ERROR: 'Codex profile request could not be completed',
  REDIRECT_REJECTED: 'Codex profile endpoint redirect was rejected',
  RESPONSE_TOO_LARGE: 'Codex profile response exceeded the safe limit',
  TIMEOUT: 'Codex profile request timed out',
  TOKEN_INVALID: 'Codex profile bearer token was invalid',
  TOKEN_REQUIRED: 'Codex profile bearer token is required',
});

export class CodexProfileError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Codex profile collection failed');
    this.name = 'CodexProfileError';
    this.code = code;
  }
}

function profileError(code) {
  return new CodexProfileError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw profileError('INVALID_SCHEMA');
  }
  return value;
}

function assertCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw profileError('INVALID_SCHEMA');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw profileError('INVALID_SCHEMA');
  }
  return value;
}

function normalizeProviderCalendarDate(value) {
  if (typeof value !== 'string') {
    throw profileError('INVALID_SCHEMA');
  }
  if (DATE_PATTERN.test(value)) {
    return assertCalendarDate(value);
  }

  const match = RFC3339_PATTERN.exec(value);
  if (!match) {
    throw profileError('INVALID_SCHEMA');
  }
  const calendarDate = assertCalendarDate(match.groups.date);
  if (Number.isNaN(new Date(value).getTime())) {
    throw profileError('INVALID_SCHEMA');
  }
  return calendarDate;
}

function normalizeCollectedAt(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw profileError('INVALID_ARGUMENT');
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !COLLECTED_AT_PATTERN.test(value)) {
    throw profileError('INVALID_ARGUMENT');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw profileError('INVALID_ARGUMENT');
  }
  return value;
}

function maximumProviderDate(collectedAt) {
  const collectedDate = collectedAt.slice(0, 10);
  const nextDay = new Date(`${collectedDate}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return nextDay.toISOString().slice(0, 10);
}

export function normalizeCodexProfile(payload, { collectedAt } = {}) {
  const safeCollectedAt = normalizeCollectedAt(collectedAt);
  if (!isPlainObject(payload) || !isPlainObject(payload.stats)) {
    throw profileError('INVALID_SCHEMA');
  }

  const buckets = payload.stats.daily_usage_buckets;
  if (!Array.isArray(buckets)) {
    throw profileError('INVALID_SCHEMA');
  }

  const daily = [];
  let previousDate;
  const maximumDate = maximumProviderDate(safeCollectedAt);
  for (const bucket of buckets) {
    if (!isPlainObject(bucket)
      || !Object.hasOwn(bucket, 'start_date')
      || !Object.hasOwn(bucket, 'tokens')) {
      throw profileError('INVALID_SCHEMA');
    }
    const date = normalizeProviderCalendarDate(bucket.start_date);
    const totalTokens = assertSafeCount(bucket.tokens);
    if ((previousDate !== undefined && date <= previousDate) || date > maximumDate) {
      throw profileError('INVALID_SCHEMA');
    }
    previousDate = date;
    daily.push({ date, totalTokens });
  }

  const normalized = {
    dateBasis: 'provider-calendar-date',
    daily,
    coverage: daily.length === 0
      ? { startDate: null, endDate: null, bucketCount: 0 }
      : {
          startDate: daily[0].date,
          endDate: daily.at(-1).date,
          bucketCount: daily.length,
        },
  };

  if (Object.hasOwn(payload.stats, 'lifetime_tokens')
    && payload.stats.lifetime_tokens !== null) {
    normalized.lifetimeTotalTokens = assertSafeCount(payload.stats.lifetime_tokens);
  }
  return normalized;
}

function normalizeBearer(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw profileError('TOKEN_REQUIRED');
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw profileError('TOKEN_INVALID');
  }
  let token = value.trim();
  if (/^Bearer(?:\s+|$)/i.test(token)) {
    token = token.replace(/^Bearer(?:\s+|$)/i, '').trim();
  }
  if (token.length === 0) {
    throw profileError('TOKEN_REQUIRED');
  }
  if (Buffer.byteLength(token, 'utf8') > MAX_BEARER_BYTES || /\s/u.test(token)) {
    throw profileError('TOKEN_INVALID');
  }
  return token;
}

function classifyRequestError(error) {
  if (error instanceof CodexProfileError) {
    return error;
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return profileError('TIMEOUT');
  }
  return profileError('NETWORK_ERROR');
}

async function readLimitedBody(response) {
  const rawLength = response.headers.get('content-length');
  if (rawLength !== null && /^\d+$/.test(rawLength)) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength > MAX_PROFILE_RESPONSE_BYTES) {
      throw profileError('RESPONSE_TOO_LARGE');
    }
  }

  if (response.body === null) {
    return '';
  }
  if (typeof response.body?.getReader !== 'function') {
    throw profileError('NETWORK_ERROR');
  }

  const chunks = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw profileError('NETWORK_ERROR');
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROFILE_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best-effort and its raw failure is intentionally discarded.
        }
        throw profileError('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw profileError('INVALID_JSON');
  }
}

function assertResponse(response) {
  if (response === null
    || typeof response !== 'object'
    || !Number.isInteger(response.status)) {
    throw profileError('NETWORK_ERROR');
  }
  if (response.redirected === true || (response.status >= 300 && response.status < 400)) {
    throw profileError('REDIRECT_REJECTED');
  }
  if (response.status === 401 || response.status === 403) {
    throw profileError('AUTH_FAILED');
  }
  if (response.status < 200 || response.status >= 300) {
    throw profileError('HTTP_ERROR');
  }
  if (typeof response.headers?.get !== 'function') {
    throw profileError('NETWORK_ERROR');
  }
  const mediaType = response.headers.get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw profileError('INVALID_CONTENT_TYPE');
  }
}

export async function collectCodexProfile({
  bearerToken,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PROFILE_TIMEOUT_MS,
  collectedAt = new Date().toISOString(),
} = {}) {
  if (typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0) {
    throw profileError('INVALID_ARGUMENT');
  }
  const safeCollectedAt = normalizeCollectedAt(collectedAt);
  const token = normalizeBearer(
    bearerToken === undefined ? env?.CODEX_BEARER_TOKEN : bearerToken,
  );

  let response;
  try {
    response = await fetchImpl(CODEX_PROFILE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        originator: 'Codex Desktop',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertResponse(response);
  } catch (error) {
    throw classifyRequestError(error);
  }

  let text;
  try {
    text = await readLimitedBody(response);
  } catch (error) {
    throw classifyRequestError(error);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw profileError('INVALID_JSON');
  }
  return normalizeCodexProfile(payload, { collectedAt: safeCollectedAt });
}
