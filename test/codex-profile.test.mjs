import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CODEX_PROFILE_ENDPOINT,
  CodexProfileError,
  MAX_PROFILE_RESPONSE_BYTES,
  collectCodexProfile,
  normalizeCodexProfile,
} from '../src/collectors/codex-profile.mjs';
import { run as runProfileCommand } from '../src/commands/profile.mjs';

const FIXED_NOW = '2026-07-19T12:34:56.000Z';
const DEVICE_ID = 'device-00112233445566778899aabbccddeeff';
const WRITER_KEY = '11'.repeat(32);
const TEST_TOKEN = 'test-only-profile-token';

async function readFixture(name) {
  return JSON.parse(
    await readFile(new URL(`./fixtures/profile/${name}`, import.meta.url), 'utf8'),
  );
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

function expectProfileError(error, code) {
  assert.ok(error instanceof CodexProfileError);
  assert.equal(error.code, code);
  assert.equal(error.message.includes(TEST_TOKEN), false);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  return true;
}

function makeIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

function makeExistingCandidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'codex-profile',
    deviceId: DEVICE_ID,
    writerKeyHash: createHash('sha256').update(WRITER_KEY, 'utf8').digest('hex'),
    collectedAt: '2026-07-18T10:00:00.000Z',
    dateBasis: 'provider-calendar-date',
    daily: [{ date: '2026-07-18', totalTokens: 50 }],
    lifetimeTotalTokens: 500,
    coverage: {
      startDate: '2026-07-18',
      endDate: '2026-07-18',
      bucketCount: 1,
    },
    ...overrides,
  };
}

async function makeTempDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('sanitizer keeps only strict daily totals and optional lifetime total', async () => {
  const payload = await readFixture('success.json');
  payload.profile = {
    display_name: 'discard this identity',
    username: 'discard-this-too',
  };
  payload.stats.unknown_raw_field = { nested: true };
  payload.stats.daily_usage_buckets[0].unknown_bucket_field = 'discarded';

  assert.deepEqual(normalizeCodexProfile(payload, { collectedAt: FIXED_NOW }), {
    dateBasis: 'provider-calendar-date',
    daily: [
      { date: '2026-07-17', totalTokens: 100 },
      { date: '2026-07-18', totalTokens: 250 },
    ],
    lifetimeTotalTokens: 987654321,
    coverage: {
      startDate: '2026-07-17',
      endDate: '2026-07-18',
      bucketCount: 2,
    },
  });
});

test('missing lifetime stays unknown and is never replaced by the daily sum', () => {
  for (const lifetime of ['missing', null]) {
    const stats = {
      daily_usage_buckets: [
        { start_date: '2026-07-18', tokens: 30 },
        { start_date: '2026-07-19', tokens: 40 },
      ],
      ...(lifetime === 'missing' ? {} : { lifetime_tokens: lifetime }),
    };
    const result = normalizeCodexProfile({ stats }, { collectedAt: FIXED_NOW });

    assert.equal(Object.hasOwn(result, 'lifetimeTotalTokens'), false);
    assert.equal(result.daily.reduce((sum, day) => sum + day.totalTokens, 0), 70);
  }
});

test('a partial bucket invalidates the complete response', async () => {
  const payload = await readFixture('partial.json');

  assert.throws(
    () => normalizeCodexProfile(payload, { collectedAt: FIXED_NOW }),
    (error) => expectProfileError(error, 'INVALID_SCHEMA'),
  );
});

test('dates are exact date or RFC3339 values, unique, ascending, and provider-calendar based', () => {
  const invalidDates = [
    '2026-02-30',
    '2026-07-18 trailing',
    '2026-07-18T00:00:00',
    '2026-07-18T24:00:00Z',
    '2026-07-18T00:00:00+15:00',
  ];

  for (const startDate of invalidDates) {
    assert.throws(
      () => normalizeCodexProfile({
        stats: { daily_usage_buckets: [{ start_date: startDate, tokens: 1 }] },
      }, { collectedAt: FIXED_NOW }),
      (error) => expectProfileError(error, 'INVALID_SCHEMA'),
    );
  }

  for (const dailyUsageBuckets of [
    [
      { start_date: '2026-07-18', tokens: 1 },
      { start_date: '2026-07-18T12:00:00Z', tokens: 2 },
    ],
    [
      { start_date: '2026-07-19', tokens: 1 },
      { start_date: '2026-07-18', tokens: 2 },
    ],
  ]) {
    assert.throws(
      () => normalizeCodexProfile({
        stats: { daily_usage_buckets: dailyUsageBuckets },
      }, { collectedAt: FIXED_NOW }),
      (error) => expectProfileError(error, 'INVALID_SCHEMA'),
    );
  }

  const preserved = normalizeCodexProfile({
    stats: {
      daily_usage_buckets: [
        { start_date: '2026-07-19T23:30:00-10:00', tokens: 12 },
      ],
    },
  }, { collectedAt: FIXED_NOW });
  assert.equal(preserved.daily[0].date, '2026-07-19');
});

test('a bucket more than one UTC calendar day after collectedAt is invalid', () => {
  assert.doesNotThrow(() => normalizeCodexProfile({
    stats: { daily_usage_buckets: [{ start_date: '2026-07-20', tokens: 1 }] },
  }, { collectedAt: FIXED_NOW }));

  assert.throws(
    () => normalizeCodexProfile({
      stats: { daily_usage_buckets: [{ start_date: '2026-07-21', tokens: 1 }] },
    }, { collectedAt: FIXED_NOW }),
    (error) => expectProfileError(error, 'INVALID_SCHEMA'),
  );
});

test('all published counts are non-negative safe integers', () => {
  for (const tokens of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => normalizeCodexProfile({
        stats: { daily_usage_buckets: [{ start_date: '2026-07-19', tokens }] },
      }, { collectedAt: FIXED_NOW }),
      (error) => expectProfileError(error, 'INVALID_SCHEMA'),
    );
  }

  for (const lifetimeTokens of [-1, 1.5, '10', Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizeCodexProfile({
        stats: { lifetime_tokens: lifetimeTokens, daily_usage_buckets: [] },
      }, { collectedAt: FIXED_NOW }),
      (error) => expectProfileError(error, 'INVALID_SCHEMA'),
    );
  }
});

test('collector uses only the fixed endpoint and safe request headers', async () => {
  const payload = await readFixture('success.json');
  let observed;
  const fetchImpl = async (url, init) => {
    observed = { url, init };
    return jsonResponse(payload);
  };

  const result = await collectCodexProfile({
    bearerToken: TEST_TOKEN,
    fetchImpl,
    collectedAt: FIXED_NOW,
  });

  assert.equal(observed.url, CODEX_PROFILE_ENDPOINT);
  assert.equal(observed.init.method, 'GET');
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.headers.Authorization, `Bearer ${TEST_TOKEN}`);
  assert.equal(observed.init.headers.Accept, 'application/json');
  assert.equal(observed.init.headers.originator, 'Codex Desktop');
  assert.ok(observed.init.signal instanceof AbortSignal);
  assert.equal(result.daily.length, 2);
});

test('production token comes from CODEX_BEARER_TOKEN and is required', async () => {
  let authorization;
  await collectCodexProfile({
    env: { CODEX_BEARER_TOKEN: TEST_TOKEN },
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return jsonResponse({ stats: { daily_usage_buckets: [] } });
    },
    collectedAt: FIXED_NOW,
  });
  assert.equal(authorization, `Bearer ${TEST_TOKEN}`);

  await assert.rejects(
    collectCodexProfile({
      env: {},
      fetchImpl: async () => assert.fail('fetch must not run without a token'),
      collectedAt: FIXED_NOW,
    }),
    (error) => expectProfileError(error, 'TOKEN_REQUIRED'),
  );
});

test('bearer prefix is normalized once while blank and control-character tokens are rejected', async () => {
  let authorization;
  await collectCodexProfile({
    bearerToken: `Bearer ${TEST_TOKEN}`,
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return jsonResponse({ stats: { daily_usage_buckets: [] } });
    },
    collectedAt: FIXED_NOW,
  });
  assert.equal(authorization, `Bearer ${TEST_TOKEN}`);

  for (const bearerToken of ['', '   ', 'Bearer ', ' bearer    ']) {
    await assert.rejects(
      collectCodexProfile({
        bearerToken,
        fetchImpl: async () => assert.fail('fetch must not run for a blank token'),
        collectedAt: FIXED_NOW,
      }),
      (error) => expectProfileError(error, 'TOKEN_REQUIRED'),
    );
  }

  for (const bearerToken of [
    `${TEST_TOKEN}\r\n`,
    `prefix\n${TEST_TOKEN}`,
    `prefix\u0000${TEST_TOKEN}`,
    `prefix\u007f${TEST_TOKEN}`,
  ]) {
    await assert.rejects(
      collectCodexProfile({
        bearerToken,
        fetchImpl: async () => assert.fail('fetch must not run for a control character'),
        collectedAt: FIXED_NOW,
      }),
      (error) => expectProfileError(error, 'TOKEN_INVALID'),
    );
  }
});

test('redirects, auth failures, other HTTP errors, and HTML are fixed safe errors', async () => {
  const cases = [
    [
      { redirected: true, status: 200 },
      'REDIRECT_REJECTED',
    ],
    [
      new Response(`private body ${TEST_TOKEN}`, { status: 401 }),
      'AUTH_FAILED',
    ],
    [
      new Response(`private body ${TEST_TOKEN}`, { status: 503 }),
      'HTTP_ERROR',
    ],
    [
      new Response('<html>private</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
      'INVALID_CONTENT_TYPE',
    ],
  ];

  for (const [response, code] of cases) {
    await assert.rejects(
      collectCodexProfile({
        bearerToken: TEST_TOKEN,
        fetchImpl: async () => response,
        collectedAt: FIXED_NOW,
      }),
      (error) => expectProfileError(error, code),
    );
  }
});

test('timeout, invalid JSON, network causes, and schema drift never leak raw details', async () => {
  const privateDetails = `${TEST_TOKEN} C:\\Users\\private\\profile.json response-body`;
  const cases = [
    [async () => { throw new DOMException(privateDetails, 'TimeoutError'); }, 'TIMEOUT'],
    [async () => { throw new Error(privateDetails); }, 'NETWORK_ERROR'],
    [async () => new Response('{bad json', {
      headers: { 'content-type': 'application/json' },
    }), 'INVALID_JSON'],
    [async () => jsonResponse({ stats: { daily_usage_buckets: 'changed' } }), 'INVALID_SCHEMA'],
  ];

  for (const [fetchImpl, code] of cases) {
    await assert.rejects(
      collectCodexProfile({
        bearerToken: TEST_TOKEN,
        fetchImpl,
        collectedAt: FIXED_NOW,
      }),
      (error) => {
        expectProfileError(error, code);
        assert.equal(error.message.includes(privateDetails), false);
        assert.equal(error.stack.includes(privateDetails), false);
        return true;
      },
    );
  }
});

test('response body is streamed with a hard one MiB byte limit', async () => {
  const oversized = `{"padding":"${'x'.repeat(MAX_PROFILE_RESPONSE_BYTES)}"}`;
  assert.ok(Buffer.byteLength(oversized) > MAX_PROFILE_RESPONSE_BYTES);

  await assert.rejects(
    collectCodexProfile({
      bearerToken: TEST_TOKEN,
      fetchImpl: async () => new Response(oversized, {
        headers: { 'content-type': 'application/json' },
      }),
      collectedAt: FIXED_NOW,
    }),
    (error) => expectProfileError(error, 'RESPONSE_TOO_LARGE'),
  );

  await assert.rejects(
    collectCodexProfile({
      bearerToken: TEST_TOKEN,
      fetchImpl: async () => new Response(null, {
        headers: {
          'content-type': 'application/json',
          'content-length': String(MAX_PROFILE_RESPONSE_BYTES + 1),
        },
      }),
      collectedAt: FIXED_NOW,
    }),
    (error) => expectProfileError(error, 'RESPONSE_TOO_LARGE'),
  );
});

test('profile command writes one validated candidate with a hashed writer key', async (t) => {
  const cwd = await makeTempDirectory(t, 'agent-card-profile-success-');
  const payload = await readFixture('success.json');
  const output = makeIo();

  const status = await runProfileCommand([], output.io, {
    cwd,
    env: { CODEX_BEARER_TOKEN: TEST_TOKEN },
    now: () => new Date(FIXED_NOW),
    loadConfig: async () => ({
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      writerKey: WRITER_KEY,
      timezone: 'Asia/Seoul',
    }),
    fetchImpl: async () => jsonResponse(payload),
  });

  assert.equal(status, 0);
  const candidate = JSON.parse(await readFile(
    path.join(cwd, 'data', 'profiles', `${DEVICE_ID}.json`),
    'utf8',
  ));
  assert.deepEqual(candidate, {
    schemaVersion: 1,
    kind: 'codex-profile',
    deviceId: DEVICE_ID,
    writerKeyHash: createHash('sha256').update(WRITER_KEY, 'utf8').digest('hex'),
    collectedAt: FIXED_NOW,
    dateBasis: 'provider-calendar-date',
    daily: [
      { date: '2026-07-17', totalTokens: 100 },
      { date: '2026-07-18', totalTokens: 250 },
    ],
    lifetimeTotalTokens: 987654321,
    coverage: {
      startDate: '2026-07-17',
      endDate: '2026-07-18',
      bucketCount: 2,
    },
  });
  assert.match(output.output().stdout, /2 daily buckets/);
  assert.equal(output.output().stdout.includes(DEVICE_ID), false);
  assert.equal(output.output().stderr, '');
});

test('profile command preserves an existing candidate on every collection failure', async (t) => {
  const cwd = await makeTempDirectory(t, 'agent-card-profile-failure-');
  const destination = path.join(cwd, 'data', 'profiles', `${DEVICE_ID}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  const previous = `${JSON.stringify(makeExistingCandidate(), null, 2)}\n`;
  await writeFile(destination, previous, 'utf8');
  const output = makeIo();
  const privateDetails = `${TEST_TOKEN} C:\\Users\\private\\profile.json`;

  const status = await runProfileCommand([], output.io, {
    cwd,
    env: { CODEX_BEARER_TOKEN: TEST_TOKEN },
    now: () => new Date(FIXED_NOW),
    loadConfig: async () => ({
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      writerKey: WRITER_KEY,
      timezone: 'Asia/Seoul',
    }),
    fetchImpl: async () => { throw new Error(privateDetails); },
  });

  assert.equal(status, 1);
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.match(output.output().stderr, /NETWORK_ERROR/);
  assert.equal(output.output().stderr.includes(TEST_TOKEN), false);
  assert.equal(output.output().stderr.includes(cwd), false);
  assert.equal(output.output().stderr.includes(privateDetails), false);
});

test('writer ownership conflict aborts before request and preserves exact bytes', async (t) => {
  const cwd = await makeTempDirectory(t, 'agent-card-profile-conflict-');
  const destination = path.join(cwd, 'data', 'profiles', `${DEVICE_ID}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  const previous = `${JSON.stringify(makeExistingCandidate({
    writerKeyHash: 'ff'.repeat(32),
  }), null, 2)}\n`;
  await writeFile(destination, previous, 'utf8');
  const output = makeIo();
  let fetchCalls = 0;

  const status = await runProfileCommand([], output.io, {
    cwd,
    env: { CODEX_BEARER_TOKEN: TEST_TOKEN },
    loadConfig: async () => ({
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      writerKey: WRITER_KEY,
      timezone: 'Asia/Seoul',
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ stats: { daily_usage_buckets: [] } });
    },
  });

  assert.equal(status, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.equal(output.output().stderr, 'Codex profile collection failed: WRITER_KEY_CONFLICT\n');
});

test('candidate device identity mismatch also fails as a writer ownership conflict', async (t) => {
  const cwd = await makeTempDirectory(t, 'agent-card-profile-device-conflict-');
  const destination = path.join(cwd, 'data', 'profiles', `${DEVICE_ID}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  const previous = `${JSON.stringify(makeExistingCandidate({
    deviceId: `device-${'ff'.repeat(16)}`,
  }), null, 2)}\n`;
  await writeFile(destination, previous, 'utf8');
  const output = makeIo();
  let fetchCalls = 0;

  const status = await runProfileCommand([], output.io, {
    cwd,
    env: { CODEX_BEARER_TOKEN: TEST_TOKEN },
    loadConfig: async () => ({
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      writerKey: WRITER_KEY,
      timezone: 'Asia/Seoul',
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ stats: { daily_usage_buckets: [] } });
    },
  });

  assert.equal(status, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.equal(output.output().stderr, 'Codex profile collection failed: WRITER_KEY_CONFLICT\n');
});

test('a malformed existing candidate fails closed before request and preserves exact bytes', async (t) => {
  const cwd = await makeTempDirectory(t, 'agent-card-profile-malformed-');
  const destination = path.join(cwd, 'data', 'profiles', `${DEVICE_ID}.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  const previous = '{"malformed":"candidate"}\n';
  await writeFile(destination, previous, 'utf8');
  const output = makeIo();
  let fetchCalls = 0;

  const status = await runProfileCommand([], output.io, {
    cwd,
    env: { CODEX_BEARER_TOKEN: TEST_TOKEN },
    loadConfig: async () => ({
      schemaVersion: 1,
      deviceId: DEVICE_ID,
      writerKey: WRITER_KEY,
      timezone: 'Asia/Seoul',
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ stats: { daily_usage_buckets: [] } });
    },
  });

  assert.equal(status, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.equal(output.output().stderr, 'Codex profile collection failed: EXISTING_PROFILE_INVALID\n');
});

test('profile command help warns that the fixed endpoint is unofficial', async () => {
  const output = makeIo();
  const status = await runProfileCommand(['--help'], output.io);

  assert.equal(status, 0);
  assert.match(output.output().stdout, /experimental/i);
  assert.match(output.output().stdout, /unofficial/i);
  assert.match(output.output().stdout, /CODEX_BEARER_TOKEN/);
  assert.equal(output.output().stdout.includes('--endpoint'), false);
});
