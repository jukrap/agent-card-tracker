import assert from 'node:assert/strict';
import test from 'node:test';

import { computeStatistics, StatisticsError } from '../src/domain/statistics.mjs';

const ZERO_METRIC = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  sessions: 0,
});

function range(startDate, endDate) {
  return { startDate, endDate };
}

function metric(overrides = {}) {
  return { ...ZERO_METRIC, ...overrides };
}

function coverage(dateBasis, overrides = {}) {
  return {
    dateBasis,
    totals: null,
    breakdown: null,
    sessions: null,
    ...overrides,
  };
}

function merged(overrides = {}) {
  return {
    timezone: 'UTC',
    codexSource: 'devices',
    days: [],
    coverage: {
      claude: coverage('UTC'),
      codex: coverage('UTC'),
    },
    ...overrides,
    coverage: {
      claude: coverage('UTC', overrides.coverage?.claude),
      codex: coverage(
        overrides.codexSource === 'profile' ? 'provider-calendar-date' : 'UTC',
        overrides.coverage?.codex,
      ),
    },
  };
}

function day(date, claude = metric(), codex = metric()) {
  return { date, claude, codex };
}

function completeMetric(value) {
  return { value, coverage: 'complete', lowerBound: false };
}

function partialMetric(value) {
  return { value, coverage: 'partial', lowerBound: true };
}

function unknownMetric() {
  return { value: null, coverage: 'unknown', lowerBound: false };
}

test('coverage 내부 누락 row는 관측된 0이고 coverage 밖은 unknown이다', () => {
  const observed = range('2026-03-05', '2026-03-07');
  const stats = computeStatistics(merged({
    days: [day('2026-03-06', metric({ total: 9 }), metric({ total: 1 }))],
    coverage: {
      claude: { totals: observed, breakdown: observed, sessions: observed },
      codex: { totals: observed, breakdown: observed, sessions: observed },
    },
  }), { asOf: '2026-03-07' });

  assert.deepEqual(stats.periods.today.current.totalTokens, completeMetric(0));
  assert.deepEqual(stats.periods.today.current.sessions, completeMetric(0));

  const byDate = new Map(stats.heatmap.cells.map((cell) => [cell.date, cell]));
  assert.deepEqual(byDate.get('2026-03-04'), {
    date: '2026-03-04',
    state: 'unknown',
    totalTokens: null,
    coverage: 'unknown',
    level: 0,
  });
  assert.deepEqual(byDate.get('2026-03-05'), {
    date: '2026-03-05',
    state: 'zero',
    totalTokens: 0,
    coverage: 'complete',
    level: 0,
  });
  assert.equal(byDate.get('2026-03-06').state, 'active');
  assert.equal(byDate.get('2026-03-06').totalTokens, 10);
  assert.equal(byDate.get('2026-03-07').state, 'zero');

  assert.deepEqual(stats.activity.activeDays, completeMetric(1));
  assert.deepEqual(stats.activity.currentStreak, completeMetric(0));
  assert.deepEqual(stats.activity.longestStreak, completeMetric(1));
  assert.deepEqual(stats.activity.peak, {
    date: '2026-03-06',
    totalTokens: 10,
    coverage: 'complete',
    lowerBound: false,
  });
});

test('known source와 미관측 source를 합치면 값은 lower bound로 보존한다', () => {
  const claudeRange = range('2026-07-19', '2026-07-19');
  const stats = computeStatistics(merged({
    days: [day('2026-07-19', metric({ total: 100 }), metric())],
    coverage: {
      claude: { totals: claudeRange, breakdown: claudeRange, sessions: claudeRange },
      codex: { totals: null, breakdown: null, sessions: null },
    },
  }), { asOf: '2026-07-19' });

  assert.deepEqual(stats.periods.today.current.totalTokens, partialMetric(100));
  assert.deepEqual(stats.periods.today.current.sessions, partialMetric(0));
  assert.equal(stats.heatmap.cells.find((cell) => cell.date === '2026-07-19').state, 'active');
});

test('profile total-only 토큰은 전부 unknownTokens이며 local breakdown만 분류한다', () => {
  const rolling = range('2026-06-20', '2026-07-19');
  const stats = computeStatistics(merged({
    codexSource: 'profile',
    codexLifetimeTotalTokens: 1_000,
    days: [day(
      '2026-07-19',
      metric({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100, sessions: 2 }),
      metric({ input: null, output: null, cacheRead: null, cacheWrite: null, total: 300, sessions: null }),
    )],
    coverage: {
      claude: { totals: rolling, breakdown: rolling, sessions: rolling },
      codex: { totals: rolling, breakdown: null, sessions: null },
    },
  }), { asOf: '2026-07-19' });

  assert.deepEqual(stats.sourceShare, {
    range: rolling,
    totalTokens: completeMetric(400),
    sources: {
      claude: { totalTokens: completeMetric(100), percentage: 25 },
      codex: { totalTokens: completeMetric(300), percentage: 75 },
    },
  });
  assert.deepEqual(stats.tokenMix, {
    range: rolling,
    input: 10,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
    unknownTokens: 300,
    totalTokens: completeMetric(400),
    coverage: 'partial',
  });
  assert.deepEqual(stats.lifetime.trackedTotalTokens, completeMetric(400));
  assert.deepEqual(stats.lifetime.totalTokens, completeMetric(1_100));
  assert.deepEqual(stats.lifetime.provenance, {
    claude: 'tracked-daily',
    codex: 'provider-reported',
  });
  assert.deepEqual(stats.lifetime.sources.codex.totalTokens, completeMetric(1_000));
  assert.deepEqual(stats.lifetime.sessions, partialMetric(2));
});

test('unknown 날짜는 서로 떨어진 active 날짜의 streak를 연결하지 않는다', () => {
  const observed = range('2026-03-07', '2026-03-07');
  const stats = computeStatistics(merged({
    days: [
      day('2026-03-05', metric({ total: 5 }), metric({ total: 5 })),
      day('2026-03-07', metric({ total: 7 }), metric({ total: 3 })),
    ],
    coverage: {
      claude: { totals: observed, breakdown: observed, sessions: observed },
      codex: { totals: observed, breakdown: observed, sessions: observed },
    },
  }), { asOf: '2026-03-07' });

  assert.deepEqual(stats.activity.currentStreak, partialMetric(1));
  assert.deepEqual(stats.activity.longestStreak, partialMetric(1));
  assert.equal(stats.heatmap.cells.find((cell) => cell.date === '2026-03-06').state, 'unknown');
});

test('관측 시작일에 걸친 longest streak는 좌측 연장 가능성을 lower bound로 남긴다', () => {
  const observed = range('2026-03-05', '2026-03-06');
  const stats = computeStatistics(merged({
    days: [day('2026-03-05', metric({ total: 4 }), metric({ total: 6 }))],
    coverage: {
      claude: { totals: observed },
      codex: { totals: observed },
    },
  }), { asOf: '2026-03-06' });

  assert.deepEqual(stats.activity.longestStreak, partialMetric(1));
  assert.deepEqual(stats.activity.currentStreak, completeMetric(0));
});

test('비교는 양쪽 기간이 complete일 때만 flat/new/percent를 계산한다', () => {
  const observed = range('2026-07-01', '2026-07-19');
  const stats = computeStatistics(merged({
    days: [
      day('2026-07-12', metric({ total: 50 }), metric({ total: 25 })),
      day('2026-07-17', metric({ total: 25 }), metric({ total: 25 })),
      day('2026-07-18'),
      day('2026-07-19', metric({ total: 75 }), metric({ total: 25 })),
    ],
    coverage: {
      claude: { totals: observed, breakdown: observed, sessions: observed },
      codex: { totals: observed, breakdown: observed, sessions: observed },
    },
  }), { asOf: '2026-07-19' });

  assert.deepEqual(stats.periods.today.comparison, { kind: 'new', percentage: null });
  assert.deepEqual(stats.periods.rolling7.comparison, { kind: 'percent', percentage: 100 });

  const flat = computeStatistics(merged({
    coverage: {
      claude: { totals: observed, breakdown: observed, sessions: observed },
      codex: { totals: observed, breakdown: observed, sessions: observed },
    },
  }), { asOf: '2026-07-19' });
  assert.deepEqual(flat.periods.today.comparison, { kind: 'flat', percentage: 0 });

  const incomplete = computeStatistics(merged({
    days: [day('2026-07-19', metric({ total: 1 }), metric({ total: 1 }))],
    coverage: {
      claude: { totals: range('2026-07-19', '2026-07-19') },
      codex: { totals: range('2026-07-19', '2026-07-19') },
    },
  }), { asOf: '2026-07-19' });
  assert.deepEqual(incomplete.periods.today.comparison, { kind: 'unknown', percentage: null });
});

test('daily/weekly/monthly trend와 윤년 MTD 경계가 oldest-to-newest로 고정된다', () => {
  const observed = range('2023-01-01', '2024-03-31');
  const stats = computeStatistics(merged({
    coverage: {
      claude: { totals: observed, breakdown: observed, sessions: observed },
      codex: { totals: observed, breakdown: observed, sessions: observed },
    },
  }), { asOf: '2024-03-31' });

  assert.equal(stats.trends.daily.length, 30);
  assert.deepEqual(stats.trends.daily[0].range, range('2024-03-02', '2024-03-02'));
  assert.deepEqual(stats.trends.daily.at(-1).range, range('2024-03-31', '2024-03-31'));
  assert.equal(stats.trends.weekly.length, 12);
  assert.deepEqual(stats.trends.weekly.at(-1).range, range('2024-03-25', '2024-03-31'));
  assert.equal(stats.trends.monthly.length, 12);
  assert.deepEqual(stats.trends.monthly[0].range, range('2023-04-01', '2023-04-30'));
  assert.deepEqual(stats.trends.monthly.at(-1).range, range('2024-03-01', '2024-03-31'));

  assert.deepEqual(stats.periods.monthToDate.current.range, range('2024-03-01', '2024-03-31'));
  assert.deepEqual(stats.periods.monthToDate.previous.range, range('2024-02-01', '2024-02-29'));
});

test('heatmap은 Monday 기준 53주 371셀이고 positive nearest-rank 분위수의 tie level을 공유한다', () => {
  const observed = range('2025-07-14', '2026-07-19');
  const stats = computeStatistics(merged({
    days: [
      day('2026-07-13', metric({ total: 1 })),
      day('2026-07-14', metric({ total: 2 })),
      day('2026-07-15', metric({ total: 2 })),
      day('2026-07-16', metric({ total: 3 })),
      day('2026-07-17', metric({ total: 4 })),
    ],
    coverage: {
      claude: { totals: observed, breakdown: observed, sessions: observed },
      codex: { totals: observed, breakdown: observed, sessions: observed },
    },
  }), { asOf: '2026-07-19' });

  assert.equal(stats.heatmap.cells.length, 371);
  assert.equal(stats.heatmap.cells[0].date, '2025-07-14');
  assert.equal(stats.heatmap.cells.at(-1).date, '2026-07-19');
  assert.deepEqual(stats.heatmap.thresholds, [2, 2, 3]);

  const levels = Object.fromEntries(
    stats.heatmap.cells
      .filter((cell) => cell.state === 'active')
      .map((cell) => [cell.date, cell.level]),
  );
  assert.deepEqual(levels, {
    '2026-07-13': 1,
    '2026-07-14': 1,
    '2026-07-15': 1,
    '2026-07-16': 3,
    '2026-07-17': 4,
  });
});

test('현재 주의 asOf 이후 heatmap 셀은 future이며 quantile에서 제외한다', () => {
  const observed = range('2025-07-14', '2026-07-15');
  const stats = computeStatistics(merged({
    days: [day('2026-07-16', metric({ total: 10 }), metric({ total: 10 }))],
    coverage: {
      claude: { totals: observed },
      codex: { totals: observed },
    },
  }), { asOf: '2026-07-15' });

  const future = stats.heatmap.cells.filter((cell) => cell.state === 'future');
  assert.deepEqual(future.map((cell) => cell.date), [
    '2026-07-16',
    '2026-07-17',
    '2026-07-18',
    '2026-07-19',
  ]);
  assert.deepEqual(stats.heatmap.thresholds, []);
});

test('peak는 같은 토큰이면 가장 이른 날짜를 고르고 0/unknown은 제외한다', () => {
  const observed = range('2026-07-17', '2026-07-19');
  const stats = computeStatistics(merged({
    days: [
      day('2026-07-17', metric({ total: 5 }), metric({ total: 5 })),
      day('2026-07-19', metric({ total: 4 }), metric({ total: 6 })),
    ],
    coverage: {
      claude: { totals: observed },
      codex: { totals: observed },
    },
  }), { asOf: '2026-07-19' });

  assert.equal(stats.activity.peak.date, '2026-07-17');
  assert.equal(stats.activity.peak.totalTokens, 10);
});

test('timezone instant를 지정 timezone 날짜로 고정하고 입력을 변경하지 않는다', () => {
  const input = merged({
    timezone: 'Asia/Seoul',
    coverage: {
      claude: { dateBasis: 'Asia/Seoul', totals: range('2026-07-20', '2026-07-20') },
      codex: { dateBasis: 'Asia/Seoul', totals: range('2026-07-20', '2026-07-20') },
    },
  });
  const before = structuredClone(input);
  const stats = computeStatistics(input, { asOf: '2026-07-19T16:00:00.000Z' });

  assert.equal(stats.asOf, '2026-07-20');
  assert.deepEqual(input, before);
  assert.throws(
    () => computeStatistics(input),
    (error) => error instanceof StatisticsError && error.code === 'AS_OF',
  );
});

test('safe integer overflow와 malformed coverage를 fail closed로 거절한다', () => {
  const observed = range('2026-07-19', '2026-07-19');
  assert.throws(
    () => computeStatistics(merged({
      days: [day(
        '2026-07-19',
        metric({ total: Number.MAX_SAFE_INTEGER }),
        metric({ total: 1 }),
      )],
      coverage: {
        claude: { totals: observed },
        codex: { totals: observed },
      },
    }), { asOf: '2026-07-19' }),
    (error) => error instanceof StatisticsError && error.code === 'SAFE_INTEGER_OVERFLOW',
  );

  assert.throws(
    () => computeStatistics(merged({
      coverage: { claude: { totals: range('2026-07-20', '2026-07-19') } },
    }), { asOf: '2026-07-19' }),
    (error) => error instanceof StatisticsError && error.code === 'COVERAGE_RANGE',
  );

  assert.throws(
    () => computeStatistics({
      ...merged(),
      codexSource: 'device',
    }, { asOf: '2026-07-19' }),
    (error) => error instanceof StatisticsError && error.code === 'CODEX_SOURCE',
  );

  assert.throws(
    () => computeStatistics({
      ...merged(),
      codexLifetimeTotalTokens: 123,
    }, { asOf: '2026-07-19' }),
    (error) => error instanceof StatisticsError && error.code === 'LIFETIME_PROVENANCE',
  );
});
