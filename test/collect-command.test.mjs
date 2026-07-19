import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CollectCommandError,
  collectDeviceUsage,
  run as runCollect,
} from '../src/commands/collect.mjs';
import { validateDeviceSnapshot } from '../src/domain/schema.mjs';

const DEVICE_ID = `device-${'01'.repeat(16)}`;
const WRITER_KEY = '23'.repeat(32);
const WRITER_KEY_HASH = crypto.createHash('sha256').update(WRITER_KEY, 'utf8').digest('hex');
const COLLECTED_AT = '2026-07-19T12:34:56.000Z';

function localConfig() {
  return {
    schemaVersion: 1,
    deviceId: DEVICE_ID,
    writerKey: WRITER_KEY,
    timezone: 'Asia/Seoul',
  };
}

function usageDay(date, seed, overrides = {}) {
  return {
    date,
    inputTokens: seed,
    outputTokens: seed + 1,
    cacheReadTokens: seed + 2,
    cacheWriteTokens: seed + 3,
    totalTokens: seed + 10,
    sessions: 1,
    ...overrides,
  };
}

function dailyOutput(date, seed) {
  return JSON.stringify({
    daily: [{
      date,
      inputTokens: seed,
      outputTokens: seed + 1,
      cacheCreationTokens: seed + 3,
      cacheReadTokens: seed + 2,
      totalTokens: seed + 10,
    }],
    totals: {
      inputTokens: seed,
      outputTokens: seed + 1,
      cacheCreationTokens: seed + 3,
      cacheReadTokens: seed + 2,
      totalTokens: seed + 10,
    },
  });
}

function sessionOutput(date) {
  return JSON.stringify({
    sessions: [{
      sessionId: `private-${date}`,
      lastActivity: `${date}T03:00:00.000Z`,
      projectPath: 'C:\\Users\\private\\secret-project',
    }],
    totals: {},
  });
}

function successfulRunner() {
  return async (args) => {
    const [agent, report] = args;
    if (report === 'session') {
      return sessionOutput('2026-07-19');
    }
    return dailyOutput('2026-07-19', agent === 'claude' ? 100 : 200);
  };
}

function existingSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    deviceId: DEVICE_ID,
    writerKeyHash: WRITER_KEY_HASH,
    generatedAt: '2026-07-18T01:02:03.000Z',
    timezone: 'Asia/Seoul',
    collectorVersion: '0.1.0',
    sources: {
      claude: {
        status: 'ok',
        lastSuccessfulAt: '2026-07-18T01:02:03.000Z',
        days: [usageDay('2026-07-18', 10)],
        coverage: {
          totals: { startDate: '2026-07-18', endDate: '2026-07-18' },
          sessions: { startDate: '2026-07-18', endDate: '2026-07-18' },
        },
      },
      codex: {
        status: 'ok',
        lastSuccessfulAt: '2026-07-18T01:02:03.000Z',
        days: [usageDay('2026-07-18', 20)],
        coverage: {
          totals: { startDate: '2026-07-18', endDate: '2026-07-18' },
          sessions: { startDate: '2026-07-18', endDate: '2026-07-18' },
        },
      },
    },
    ...overrides,
  };
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function fixtureDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-card-collect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, '.agent-card.local.json'),
    `${JSON.stringify(localConfig(), null, 2)}\n`,
    'utf8',
  );
  return root;
}

async function readSnapshot(root) {
  return JSON.parse(await readFile(
    path.join(root, 'data', 'devices', `${DEVICE_ID}.json`),
    'utf8',
  ));
}

test('collect writes one exact, public-safe device snapshot with sha256 writer ownership', async (t) => {
  const root = await fixtureDirectory(t);
  const calls = [];
  const runner = successfulRunner();

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args, options) => {
      calls.push({ args, options });
      return runner(args, options);
    },
  });

  assert.equal(validateDeviceSnapshot(snapshot), snapshot);
  assert.deepEqual(await readSnapshot(root), snapshot);
  assert.equal(snapshot.writerKeyHash, WRITER_KEY_HASH);
  assert.equal(snapshot.generatedAt, COLLECTED_AT);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'collectorVersion',
    'deviceId',
    'generatedAt',
    'schemaVersion',
    'sources',
    'timezone',
    'writerKeyHash',
  ]);
  assert.deepEqual(snapshot.sources.claude.days, [usageDay('2026-07-19', 100)]);
  assert.deepEqual(snapshot.sources.codex.days, [usageDay('2026-07-19', 200)]);
  assert.deepEqual(snapshot.sources.claude.coverage, {
    totals: { startDate: '2026-07-19', endDate: '2026-07-19' },
    sessions: { startDate: '2026-07-19', endDate: '2026-07-19' },
  });
  assert.deepEqual(snapshot.sources.codex.coverage, snapshot.sources.claude.coverage);
  assert.deepEqual(calls.map(({ args }) => args.slice(0, 2)), [
    ['claude', 'daily'],
    ['claude', 'session'],
    ['codex', 'daily'],
    ['codex', 'session'],
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|Users|secret-project|sessionId/);
});

test('writer hash mismatch aborts before collection and leaves the snapshot untouched', async (t) => {
  const root = await fixtureDirectory(t);
  const snapshotPath = path.join(root, 'data', 'devices', `${DEVICE_ID}.json`);
  const collided = existingSnapshot({ writerKeyHash: 'ff'.repeat(32) });
  await writeFile(snapshotPath, `${JSON.stringify(collided, null, 2)}\n`, 'utf8').catch(async (error) => {
    if (error.code !== 'ENOENT') throw error;
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify(collided, null, 2)}\n`, 'utf8');
  });
  const original = await readFile(snapshotPath, 'utf8');
  let calls = 0;

  await assert.rejects(
    collectDeviceUsage({
      cwd: root,
      runner: async () => { calls += 1; },
    }),
    (error) => error instanceof CollectCommandError && error.code === 'WRITER_KEY_CONFLICT',
  );

  assert.equal(calls, 0);
  assert.equal(await readFile(snapshotPath, 'utf8'), original);
});

test('timezone changes fail closed before old daily buckets can be relabeled', async (t) => {
  const root = await fixtureDirectory(t);
  const snapshotPath = path.join(root, 'data', 'devices', `${DEVICE_ID}.json`);
  const previous = existingSnapshot({ timezone: 'UTC' });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
  const original = await readFile(snapshotPath, 'utf8');
  let calls = 0;

  await assert.rejects(
    collectDeviceUsage({
      cwd: root,
      runner: async () => { calls += 1; },
    }),
    (error) => error instanceof CollectCommandError
      && error.code === 'SNAPSHOT_TIMEZONE_CONFLICT',
  );

  assert.equal(calls, 0);
  assert.equal(await readFile(snapshotPath, 'utf8'), original);
});

test('a failed source preserves its previous valid days and timestamp with a sanitized code', async (t) => {
  const root = await fixtureDirectory(t);
  const snapshotPath = path.join(root, 'data', 'devices', `${DEVICE_ID}.json`);
  const previous = existingSnapshot();
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args) => {
      const [agent, report] = args;
      if (agent === 'claude') {
        throw new Error('C:\\Users\\private\\raw.jsonl Bearer private-token');
      }
      return report === 'daily'
        ? dailyOutput('2026-07-19', 300)
        : sessionOutput('2026-07-19');
    },
  });

  assert.deepEqual(snapshot.sources.claude, {
    status: 'error',
    errorCode: 'CCUSAGE_COMMAND_FAILED',
    lastSuccessfulAt: previous.sources.claude.lastSuccessfulAt,
    days: previous.sources.claude.days,
    coverage: previous.sources.claude.coverage,
  });
  assert.equal(snapshot.sources.codex.status, 'ok');
  assert.equal(snapshot.sources.codex.lastSuccessfulAt, COLLECTED_AT);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|raw|Bearer|Users/);
});

test('daily success with session failure remains ok and marks session counts unknown', async (t) => {
  const root = await fixtureDirectory(t);

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args) => {
      const [agent, report] = args;
      if (report === 'session') {
        throw new Error('C:\\Users\\private\\session-log.jsonl');
      }
      return dailyOutput('2026-07-19', agent === 'claude' ? 150 : 250);
    },
  });

  assert.equal(snapshot.sources.claude.status, 'ok');
  assert.equal(snapshot.sources.codex.status, 'ok');
  assert.equal(snapshot.sources.claude.days[0].sessions, null);
  assert.equal(snapshot.sources.codex.days[0].sessions, null);
  assert.deepEqual(snapshot.sources.claude.coverage, {
    totals: { startDate: '2026-07-19', endDate: '2026-07-19' },
    sessions: null,
  });
  assert.deepEqual(snapshot.sources.codex.coverage, snapshot.sources.claude.coverage);
  assert.equal('errorCode' in snapshot.sources.claude, false);
  assert.equal('errorCode' in snapshot.sources.codex, false);
});

test('empty successful collection covers the local collection date and preserves session observability', async (t) => {
  const root = await fixtureDirectory(t);

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date('2026-07-19T16:00:00.000Z'),
    collectUsage: async () => ({ days: [], sessionStatus: 'ok' }),
  });

  for (const source of Object.values(snapshot.sources)) {
    assert.deepEqual(source.coverage, {
      totals: { startDate: '2026-07-20', endDate: '2026-07-20' },
      sessions: { startDate: '2026-07-20', endDate: '2026-07-20' },
    });
  }
});

test('successful collection starts totals coverage at the first active date', async (t) => {
  const root = await fixtureDirectory(t);

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date('2026-07-19T16:00:00.000Z'),
    collectUsage: async ({ agent }) => ({
      days: agent === 'claude'
        ? [usageDay('2026-07-18', 50, { sessions: null })]
        : [],
      sessionStatus: 'unavailable',
    }),
  });

  assert.deepEqual(snapshot.sources.claude.coverage, {
    totals: { startDate: '2026-07-18', endDate: '2026-07-20' },
    sessions: null,
  });
  assert.deepEqual(snapshot.sources.codex.coverage, {
    totals: { startDate: '2026-07-20', endDate: '2026-07-20' },
    sessions: null,
  });
});

test('first-run failure of both sources still atomically writes a valid empty snapshot', async (t) => {
  const root = await fixtureDirectory(t);
  const renames = [];
  const fileSystem = await import('node:fs/promises');
  const spyingFileSystem = {
    ...fileSystem,
    async rename(from, to) {
      renames.push({ from, to });
      return fileSystem.rename(from, to);
    },
  };

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    fileSystem: spyingFileSystem,
    runner: async () => {
      const error = new Error('/home/private/raw-log');
      error.code = 'NOT_A_SAFE_PUBLIC_CODE:/home/private';
      throw error;
    },
  });

  assert.equal(validateDeviceSnapshot(snapshot), snapshot);
  for (const source of Object.values(snapshot.sources)) {
    assert.deepEqual(source, {
      status: 'error',
      errorCode: 'CCUSAGE_COMMAND_FAILED',
      lastSuccessfulAt: null,
      days: [],
      coverage: { totals: null, sessions: null },
    });
  }
  assert.equal(renames.length, 1);
  assert.match(path.basename(renames[0].from), /^\.device-[0-9a-f]{32}\.json\..+\.tmp$/);
  assert.equal(renames[0].to, path.join(root, 'data', 'devices', `${DEVICE_ID}.json`));
  assert.deepEqual(await readSnapshot(root), snapshot);
});

test('collect command output is limited to anonymous id, source status, and day counts', async (t) => {
  const root = await fixtureDirectory(t);
  const output = captureIo();

  const status = await runCollect([], output.io, {
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args) => {
      const [agent, report] = args;
      if (agent === 'claude') {
        throw new Error('C:\\Users\\private\\secret.jsonl');
      }
      return report === 'daily'
        ? dailyOutput('2026-07-19', 400)
        : sessionOutput('2026-07-19');
    },
  });

  assert.equal(status, 0);
  assert.match(output.stdout(), new RegExp(DEVICE_ID));
  assert.match(output.stdout(), /claude=error days=0/);
  assert.match(output.stdout(), /codex=ok days=1/);
  assert.doesNotMatch(output.stdout(), /private|secret|Users|writer|\.json|Asia\/Seoul/i);
  assert.equal(output.stderr(), '');
});
