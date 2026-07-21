import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
const COLLECTED_AT = '2026-07-21T12:34:56.000Z';

function localConfig() {
  return {
    schemaVersion: 1,
    deviceId: DEVICE_ID,
    writerKey: WRITER_KEY,
    timezone: 'Asia/Seoul',
  };
}

function usageDay(date = '2026-07-21', overrides = {}) {
  return {
    date,
    inputTokens: 200,
    outputTokens: 201,
    cacheReadTokens: 202,
    cacheWriteTokens: 203,
    totalTokens: 210,
    sessions: 1,
    ...overrides,
  };
}

function dailyOutput() {
  return JSON.stringify({
    daily: [{
      date: '2026-07-21',
      inputTokens: 200,
      outputTokens: 201,
      cacheCreationTokens: 203,
      cacheReadTokens: 202,
      totalTokens: 210,
    }],
    totals: {
      inputTokens: 200,
      outputTokens: 201,
      cacheCreationTokens: 203,
      cacheReadTokens: 202,
      totalTokens: 210,
    },
  });
}

function sessionOutput() {
  return JSON.stringify({
    sessions: [{
      sessionId: 'private-session',
      lastActivity: '2026-07-21T03:00:00.000Z',
      projectPath: 'C:\\Users\\private\\secret-project',
    }],
    totals: {},
  });
}

function existingSnapshot(overrides = {}) {
  return {
    schemaVersion: 2,
    deviceId: DEVICE_ID,
    writerKeyHash: WRITER_KEY_HASH,
    generatedAt: '2026-07-20T01:02:03.000Z',
    timezone: 'Asia/Seoul',
    collectorVersion: '0.1.0',
    sources: {
      codex: {
        status: 'ok',
        lastSuccessfulAt: '2026-07-20T01:02:03.000Z',
        days: [usageDay('2026-07-20', { totalTokens: 110 })],
        coverage: {
          totals: { startDate: '2026-07-20', endDate: '2026-07-20' },
          sessions: { startDate: '2026-07-20', endDate: '2026-07-20' },
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

async function snapshotPath(root) {
  const directory = path.join(root, 'data', 'devices');
  await mkdir(directory, { recursive: true });
  return path.join(directory, `${DEVICE_ID}.json`);
}

test('collect runs ccusage codex only and writes one schema v2 source', async (t) => {
  const root = await fixtureDirectory(t);
  const calls = [];

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args) => {
      calls.push(args);
      return args[1] === 'session' ? sessionOutput() : dailyOutput();
    },
  });

  assert.equal(validateDeviceSnapshot(snapshot), snapshot);
  assert.equal(snapshot.schemaVersion, 2);
  assert.deepEqual(Object.keys(snapshot.sources), ['codex']);
  assert.deepEqual(snapshot.sources.codex.days, [usageDay()]);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [
    ['codex', 'daily'],
    ['codex', 'session'],
  ]);
  assert.equal(JSON.stringify(snapshot).includes('claude'), false);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|Users|secret-project|sessionId/);
});

test('failed collection preserves the previous valid Codex candidate', async (t) => {
  const root = await fixtureDirectory(t);
  const target = await snapshotPath(root);
  const previous = existingSnapshot();
  await writeFile(target, `${JSON.stringify(previous)}\n`, 'utf8');

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    collectUsage: async () => {
      const error = new Error('C:\\Users\\private\\raw.jsonl Bearer secret');
      error.code = 'CCUSAGE_COMMAND_FAILED';
      throw error;
    },
  });

  assert.deepEqual(snapshot.sources.codex, {
    status: 'error',
    errorCode: 'CCUSAGE_COMMAND_FAILED',
    lastSuccessfulAt: previous.sources.codex.lastSuccessfulAt,
    days: previous.sources.codex.days,
    coverage: previous.sources.codex.coverage,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /private|raw|Bearer|Users/);
});

test('session failure keeps daily totals and marks sessions unknown', async (t) => {
  const root = await fixtureDirectory(t);

  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args) => {
      if (args[1] === 'session') {
        throw new Error('private session path');
      }
      return dailyOutput();
    },
  });

  assert.equal(snapshot.sources.codex.status, 'ok');
  assert.equal(snapshot.sources.codex.days[0].sessions, null);
  assert.deepEqual(snapshot.sources.codex.coverage, {
    totals: { startDate: '2026-07-21', endDate: '2026-07-21' },
    sessions: null,
  });
});

test('first-run failure writes a valid empty sanitized source atomically', async (t) => {
  const root = await fixtureDirectory(t);
  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async () => {
      throw new Error('/home/private/raw-log');
    },
  });

  assert.equal(validateDeviceSnapshot(snapshot), snapshot);
  assert.deepEqual(snapshot.sources.codex, {
    status: 'error',
    errorCode: 'CCUSAGE_COMMAND_FAILED',
    lastSuccessfulAt: null,
    days: [],
    coverage: { totals: null, sessions: null },
  });
});

test('writer ownership, timezone drift, and v1 snapshots fail before collection', async (t) => {
  for (const [snapshot, code] of [
    [existingSnapshot({ writerKeyHash: 'f'.repeat(64) }), 'WRITER_KEY_CONFLICT'],
    [existingSnapshot({ timezone: 'UTC' }), 'SNAPSHOT_TIMEZONE_CONFLICT'],
    [existingSnapshot({ schemaVersion: 1 }), 'EXISTING_SNAPSHOT_INVALID'],
  ]) {
    const root = await fixtureDirectory(t);
    const target = await snapshotPath(root);
    await writeFile(target, `${JSON.stringify(snapshot)}\n`, 'utf8');
    let calls = 0;

    await assert.rejects(
      collectDeviceUsage({
        cwd: root,
        runner: async () => {
          calls += 1;
        },
      }),
      (error) => error instanceof CollectCommandError && error.code === code,
    );
    assert.equal(calls, 0);
  }
});

test('empty successful collection covers the local collection date', async (t) => {
  const root = await fixtureDirectory(t);
  const snapshot = await collectDeviceUsage({
    cwd: root,
    now: () => new Date('2026-07-21T16:00:00.000Z'),
    collectUsage: async () => ({ days: [], sessionStatus: 'ok' }),
  });

  assert.deepEqual(snapshot.sources.codex.coverage, {
    totals: { startDate: '2026-07-22', endDate: '2026-07-22' },
    sessions: { startDate: '2026-07-22', endDate: '2026-07-22' },
  });
});

test('collect CLI prints only anonymous id and Codex status', async (t) => {
  const root = await fixtureDirectory(t);
  const output = captureIo();

  const status = await runCollect([], output.io, {
    cwd: root,
    now: () => new Date(COLLECTED_AT),
    runner: async (args) => (args[1] === 'session' ? sessionOutput() : dailyOutput()),
  });

  assert.equal(status, 0);
  assert.match(output.stdout(), new RegExp(DEVICE_ID));
  assert.match(output.stdout(), /codex=ok days=1/);
  assert.doesNotMatch(output.stdout(), /claude|private|secret|Users|writer|\.json|Asia\/Seoul/i);
  assert.equal(output.stderr(), '');
});
