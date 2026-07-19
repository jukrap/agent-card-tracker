import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';

import {
  CcusageCollectorError,
  assertIanaTimezone,
  buildCcusageArgs,
  collectCcusage,
  createCcusageRunner,
  normalizeCcusageDaily,
  normalizeCcusageSessions,
} from '../src/collectors/ccusage.mjs';

const fixtures = new URL('./fixtures/ccusage/', import.meta.url);

async function fixture(name) {
  return readFile(new URL(name, fixtures), 'utf8');
}

test('Claude daily 결과를 공개 day record로만 정규화한다', async () => {
  const days = normalizeCcusageDaily(await fixture('claude-daily.json'), {
    timezone: 'Asia/Seoul',
  });

  assert.deepEqual(days, [
    {
      date: '2026-07-18',
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 900,
      cacheWriteTokens: 500,
      totalTokens: 2947,
      sessions: null,
    },
    {
      date: '2026-07-19',
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 120,
      cacheWriteTokens: 0,
      totalTokens: 400,
      sessions: null,
    },
  ]);
  assert.equal('modelsUsed' in days[0], false);
  assert.equal('totalCost' in days[0], false);
  assert.equal(days[0].totalTokens, 2947, '구성요소 합으로 totalTokens를 재계산하지 않는다');
});

test('Codex reasoning token이 공개 breakdown에 없어도 upstream totalTokens를 신뢰한다', async () => {
  const days = normalizeCcusageDaily(await fixture('codex-daily.json'), {
    timezone: 'UTC',
  });

  assert.equal(days[1].inputTokens, 100);
  assert.equal(days[1].outputTokens, 50);
  assert.equal(days[1].cacheReadTokens, 25);
  assert.equal(days[1].totalTokens, 215);
  assert.equal('reasoningOutputTokens' in days[1], false);
  assert.equal('models' in days[1], false);
});

test('빈 daily 결과는 정상적인 빈 배열이다', async () => {
  assert.deepEqual(
    normalizeCcusageDaily(await fixture('empty-daily.json'), { timezone: 'UTC' }),
    [],
  );
});

test('session은 최신 lastActivity의 설정 timezone 날짜에 unique ID당 한 번만 센다', async () => {
  const rawSessions = {
    sessions: [
      {
        sessionId: 'private-session-alpha',
        lastActivity: '2026-07-18T14:00:00.000Z',
        projectPath: 'C:\\Users\\private\\secret-project',
      },
      {
        sessionId: 'private-session-alpha',
        lastActivity: '2026-07-18T15:30:00.000Z',
        projectPath: 'C:\\Users\\private\\secret-project',
      },
      {
        sessionId: 'private-session-beta',
        lastActivity: '2026-07-18T14:30:00.000Z',
        directory: '/home/private/repository',
      },
      {
        sessionId: 'private-session-gamma',
        lastActivity: '2026-07-19T01:00:00.000Z',
        sessionFile: 'private.jsonl',
      },
      {
        sessionId: 'private-session-alpha',
        lastActivity: '2026-07-19T02:00:00.000Z',
        projectPath: 'D:\\different-private-project',
      },
    ],
    totals: {},
  };

  const counts = normalizeCcusageSessions(rawSessions, { timezone: 'Asia/Seoul' });
  assert.deepEqual(counts, new Map([
    ['2026-07-18', 1],
    ['2026-07-19', 3],
  ]));

  const days = normalizeCcusageDaily(await fixture('claude-daily.json'), {
    timezone: 'Asia/Seoul',
    sessionOutput: rawSessions,
  });
  assert.deepEqual(days.map((day) => day.sessions), [1, 3]);
  assert.doesNotMatch(JSON.stringify(days), /private|Users|home|jsonl/);
});

test('session 수집 실패는 daily 수집을 버리지 않고 sessions를 unknown으로 둔다', async () => {
  const calls = [];
  const result = await collectCcusage({
    agent: 'claude',
    timezone: 'Asia/Seoul',
    runner: async (args) => {
      calls.push(args);
      if (args[1] === 'session') {
        throw new Error('C:\\Users\\private\\secret.jsonl: bearer-secret');
      }
      return fixture('claude-daily.json');
    },
  });

  assert.equal(result.sessionStatus, 'unavailable');
  assert.deepEqual(result.days.map((day) => day.sessions), [null, null]);
  assert.deepEqual(calls, [
    buildCcusageArgs('claude', 'daily', 'Asia/Seoul'),
    buildCcusageArgs('claude', 'session', 'Asia/Seoul'),
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|Users/);
});

test('유효하지 않거나 IANA 형식이 아닌 timezone을 ccusage 실행 전에 거절한다', () => {
  assert.equal(assertIanaTimezone('Asia/Seoul'), 'Asia/Seoul');
  assert.equal(assertIanaTimezone('UTC'), 'UTC');

  for (const timezone of ['', 'GMT+09:00', 'Invalid/Timezone']) {
    assert.throws(
      () => assertIanaTimezone(timezone),
      (error) => error instanceof CcusageCollectorError
        && error.code === 'CCUSAGE_INVALID_TIMEZONE',
    );
  }
});

test('daily JSON drift, 비정상 값, 중복 날짜를 fail closed로 거절한다', () => {
  const invalidInputs = [
    '{not-json',
    { data: [], summary: {} },
    { daily: [], totals: null },
    {
      daily: [{
        date: '2026-02-30',
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationTokens: 1,
        cacheReadTokens: 1,
        totalTokens: 4,
      }],
      totals: {},
    },
    {
      daily: [{
        date: '2026-07-19',
        inputTokens: 1.5,
        outputTokens: 1,
        cacheCreationTokens: 1,
        cacheReadTokens: 1,
        totalTokens: 4,
      }],
      totals: {},
    },
    {
      daily: [
        {
          date: '2026-07-19',
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationTokens: 1,
          cacheReadTokens: 1,
          totalTokens: 4,
        },
        {
          date: '2026-07-19',
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationTokens: 1,
          cacheReadTokens: 1,
          totalTokens: 4,
        },
      ],
      totals: {},
    },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => normalizeCcusageDaily(input, { timezone: 'UTC' }),
      (error) => error instanceof CcusageCollectorError
        && error.code.startsWith('CCUSAGE_'),
    );
  }
});

test('고정된 안전 옵션만 agent별 argv로 만든다', () => {
  assert.deepEqual(buildCcusageArgs('claude', 'daily', 'Asia/Seoul'), [
    'claude',
    'daily',
    '--json',
    '--offline',
    '--no-cost',
    '--timezone',
    'Asia/Seoul',
  ]);
  assert.deepEqual(buildCcusageArgs('codex', 'session', 'UTC'), [
    'codex',
    'session',
    '--json',
    '--offline',
    '--no-cost',
    '--timezone',
    'UTC',
    '--speed',
    'auto',
  ]);
  assert.throws(() => buildCcusageArgs('other', 'daily', 'UTC'));
  assert.throws(() => buildCcusageArgs('claude', 'weekly', 'UTC'));
});

test('runner는 process.execPath와 로컬 ccusage JS를 shell 없이 제한 실행한다', async () => {
  let observed;
  const runner = createCcusageRunner({
    entryPath: 'D:\\safe-project\\node_modules\\ccusage\\src\\cli.js',
    timeoutMs: 4321,
    maxOutputBytes: 12345,
    execFileImpl(command, args, options, callback) {
      observed = { command, args, options };
      callback(null, '{"daily":[],"totals":{}}', 'ignored warning');
    },
  });

  const stdout = await runner(['claude', 'daily', '--json'], {
    env: {
      CODEX_BEARER_TOKEN: 'uppercase-secret',
      codex_bearer_token: 'lowercase-secret',
      CoDeX_BeArEr_ToKeN: 'mixed-case-secret',
      CCUSAGE_SAFE_ENV: 'preserved',
    },
  });
  assert.equal(stdout, '{"daily":[],"totals":{}}');
  assert.equal(observed.command, process.execPath);
  assert.deepEqual(observed.args, [
    'D:\\safe-project\\node_modules\\ccusage\\src\\cli.js',
    'claude',
    'daily',
    '--json',
  ]);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.windowsHide, true);
  assert.equal(observed.options.timeout, 4321);
  assert.equal(observed.options.maxBuffer, 12345);
  assert.equal(observed.options.env.CCUSAGE_SAFE_ENV, 'preserved');
  assert.equal(
    Object.keys(observed.options.env)
      .some((key) => key.toLowerCase() === 'codex_bearer_token'),
    false,
  );
});

test('명령 실패와 과대 출력 오류는 stderr, path, cause를 노출하지 않는다', async () => {
  const failingRunner = createCcusageRunner({
    entryPath: 'C:\\Users\\private\\node_modules\\ccusage\\src\\cli.js',
    execFileImpl(_command, _args, _options, callback) {
      const error = new Error('C:\\Users\\private\\raw.jsonl bearer-secret');
      error.code = 1;
      callback(error, '', 'C:\\Users\\private\\raw.jsonl bearer-secret');
    },
  });

  await assert.rejects(
    failingRunner(['claude', 'daily']),
    (error) => {
      assert.equal(error.code, 'CCUSAGE_COMMAND_FAILED');
      assert.equal('cause' in error, false);
      assert.doesNotMatch(String(error), /private|raw|bearer|Users/);
      return true;
    },
  );

  const oversizedRunner = createCcusageRunner({
    entryPath: 'safe-entry.js',
    maxOutputBytes: 4,
    execFileImpl(_command, _args, _options, callback) {
      callback(null, '12345', '');
    },
  });
  await assert.rejects(
    oversizedRunner(['codex', 'daily']),
    (error) => error.code === 'CCUSAGE_OUTPUT_TOO_LARGE',
  );
});
