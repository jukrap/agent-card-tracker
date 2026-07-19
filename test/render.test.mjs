import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SaxesParser } from 'saxes';

import { renderCards, run as runRenderCommand } from '../src/commands/render.mjs';
import { renderActivity } from '../src/render/activity.mjs';
import { renderOverview } from '../src/render/overview.mjs';
import { renderTrends } from '../src/render/trends.mjs';
import { CARD_STYLE, formatCompactNumber } from '../src/render/svg.mjs';

const AS_OF = '2026-07-19';
const FIXTURE_PATH = new URL('./fixtures/public/multi-device.json', import.meta.url);

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/giu).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left, right) {
  const luminances = [relativeLuminance(left), relativeLuminance(right)]
    .toSorted((first, second) => second - first);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function cssVariables(declarations) {
  return Object.fromEntries(declarations.split(';').filter(Boolean).map((declaration) => {
    const separator = declaration.indexOf(':');
    return [declaration.slice(0, separator), declaration.slice(separator + 1)];
  }));
}

function observed(value, coverage = 'complete') {
  return {
    value,
    coverage,
    lowerBound: coverage === 'partial',
  };
}

function range(startDate, endDate) {
  return { startDate, endDate };
}

function trendBucket(index, { value = index * 1_000, coverage = 'complete' } = {}) {
  const day = String(index + 1).padStart(2, '0');
  return {
    range: range(`2026-06-${day}`, `2026-06-${day}`),
    totalTokens: observed(value, coverage),
    sessions: observed(index, coverage),
  };
}

function sampleStatistics(overrides = {}) {
  const daily = Array.from({ length: 30 }, (_, index) => trendBucket(index));
  daily[2] = trendBucket(2, { value: null, coverage: 'unknown' });
  daily[3] = trendBucket(3, { value: 4_000, coverage: 'partial' });
  const weekly = Array.from({ length: 12 }, (_, index) => trendBucket(index));
  const monthly = Array.from({ length: 12 }, (_, index) => trendBucket(index));
  const cells = Array.from({ length: 371 }, (_, index) => ({
    date: `cell-${String(index).padStart(3, '0')}`,
    state: index === 370 ? 'future' : index % 19 === 0 ? 'unknown' : index % 5 === 0 ? 'active' : 'zero',
    totalTokens: index % 5 === 0 ? index * 1_000 : index % 19 === 0 ? null : 0,
    coverage: index % 23 === 0 ? 'partial' : index % 19 === 0 ? 'unknown' : 'complete',
    level: index % 5 === 0 ? (index % 4) + 1 : 0,
  }));

  return {
    asOf: AS_OF,
    timezone: 'UTC',
    periods: {
      today: {
        current: { range: range(AS_OF, AS_OF), totalTokens: observed(0), sessions: observed(0) },
        previous: { range: range('2026-07-18', '2026-07-18'), totalTokens: observed(0), sessions: observed(0) },
        comparison: { kind: 'flat', percentage: 0 },
      },
      rolling7: {
        current: { range: range('2026-07-13', AS_OF), totalTokens: observed(12_345, 'partial'), sessions: observed(6, 'partial') },
        previous: { range: range('2026-07-06', '2026-07-12'), totalTokens: observed(10_000), sessions: observed(5) },
        comparison: { kind: 'unknown', percentage: null },
      },
      rolling30: {
        current: { range: range('2026-06-20', AS_OF), totalTokens: observed(345_678), sessions: observed(42) },
        previous: { range: range('2026-05-21', '2026-06-19'), totalTokens: observed(300_000), sessions: observed(35) },
        comparison: { kind: 'percent', percentage: 15.226 },
      },
      monthToDate: {
        current: { range: range('2026-07-01', AS_OF), totalTokens: observed(null, 'unknown'), sessions: observed(null, 'unknown') },
        previous: { range: range('2026-06-01', '2026-06-19'), totalTokens: observed(null, 'unknown'), sessions: observed(null, 'unknown') },
        comparison: { kind: 'unknown', percentage: null },
      },
    },
    lifetime: {
      range: range('2026-01-01', AS_OF),
      trackedTotalTokens: observed(1_234_567),
      totalTokens: observed(9_007_199_254_740_991),
      sessions: observed(123, 'partial'),
      provenance: { claude: 'tracked-daily', codex: 'provider-reported' },
      sources: {
        claude: { provenance: 'tracked-daily', totalTokens: observed(300_000) },
        codex: { provenance: 'provider-reported', totalTokens: observed(900_000), trackedTotalTokens: observed(400_000) },
      },
    },
    sourceShare: {
      range: range('2026-06-20', AS_OF),
      totalTokens: observed(400),
      sources: {
        claude: { totalTokens: observed(100), percentage: 25 },
        codex: { totalTokens: observed(300), percentage: 75 },
      },
    },
    tokenMix: {
      range: range('2026-06-20', AS_OF),
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      unknownTokens: 300,
      totalTokens: observed(400),
      coverage: 'partial',
    },
    activity: {
      activeDays: observed(84, 'partial'),
      currentStreak: observed(3),
      longestStreak: observed(12),
      peak: {
        date: '2026-07-11',
        totalTokens: 88_000,
        coverage: 'complete',
        lowerBound: false,
      },
    },
    trends: { daily, weekly, monthly },
    heatmap: {
      startDate: '2025-07-14',
      endDate: AS_OF,
      thresholds: [1_000, 10_000, 100_000],
      cells,
    },
    ...overrides,
  };
}

function assertXml(svg) {
  const parser = new SaxesParser({ xmlns: true });
  let error = null;
  parser.onerror = (value) => {
    error = value;
  };
  parser.write(svg).close();
  assert.equal(error, null);
}

function assertSafeCard(svg, viewBox) {
  assertXml(svg);
  assert.match(svg, /<title id="[^"]+">/);
  assert.match(svg, /<desc id="[^"]+">/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-labelledby="[^"]+ [^"]+"/);
  assert.match(svg, new RegExp(`viewBox="${viewBox}"`));
  assert.match(svg, /prefers-color-scheme:\s*dark/);
  assert.doesNotMatch(svg, /<script|<foreignObject|<image|<a\b|<use\b/i);
  assert.doesNotMatch(svg, /\son[a-z]+\s*=|\s(?:href|xlink:href)\s*=|data:|@import|url\s*\(/i);
  assert.equal(svg.includes('\r'), false);
  assert.equal(svg.endsWith('\n'), true);
}

function captureStream() {
  const chunks = [];
  return {
    write(value) {
      chunks.push(value);
    },
    text() {
      return chunks.join('');
    },
  };
}

test('세 카드가 접근 가능한 고정 viewBox의 self-contained XML을 생성한다', () => {
  const statistics = sampleStatistics({ timezone: 'UTC & <safe>' });
  const overview = renderOverview(statistics, {
    codexSource: 'profile',
    staleDeviceCount: 2,
  });
  const trends = renderTrends(statistics);
  const activity = renderActivity(statistics);

  assertSafeCard(overview, '0 0 500 420');
  assertSafeCard(trends, '0 0 500 460');
  assertSafeCard(activity, '0 0 500 340');
  assert.match(overview, /UTC &amp; &lt;safe&gt;/);
  assert.match(overview, /2 stale sources/);
});

test('light와 dark theme의 badge 텍스트 대비가 WCAG AA 기준을 충족한다', () => {
  const themes = Array.from(CARD_STYLE.matchAll(/:root\{([^}]+)\}/gu), (match) => (
    cssVariables(match[1])
  ));

  assert.equal(themes.length, 2);
  for (const theme of themes) {
    assert.ok(contrastRatio(theme['--accent'], theme['--on-accent']) >= 4.5);
    assert.ok(contrastRatio(theme['--claude'], theme['--on-partial']) >= 4.5);
    assert.ok(contrastRatio(theme['--unknown'], theme['--on-unknown']) >= 4.5);
  }

  const overview = renderOverview(sampleStatistics(), { codexSource: 'profile' });
  assert.match(overview, /class="badge-text badge-text-complete"/);
  assert.match(overview, /class="badge-text badge-text-partial"/);
  assert.match(overview, /class="badge-text badge-text-unknown"/);
});

test('관측 0, unknown, partial과 profile total-only unknown token mix를 구분한다', () => {
  const overview = renderOverview(sampleStatistics(), { codexSource: 'profile' });

  assert.match(overview, />0</);
  assert.match(overview, />Unknown</);
  assert.match(overview, />Partial</);
  assert.match(overview, />Unknown mix 300</);
  assert.match(overview, /class="mix-unknown"/);
  assert.match(overview, />Profile total</);
});

test('source share의 관측된 0과 unknown을 서로 다른 문구로 표시한다', () => {
  const zeroShare = {
    range: range('2026-06-20', AS_OF),
    totalTokens: observed(0),
    sources: {
      claude: { totalTokens: observed(0), percentage: null },
      codex: { totalTokens: observed(0), percentage: null },
    },
  };
  const unknownShare = {
    ...zeroShare,
    totalTokens: observed(null, 'unknown'),
    sources: {
      claude: { totalTokens: observed(null, 'unknown'), percentage: null },
      codex: { totalTokens: observed(null, 'unknown'), percentage: null },
    },
  };

  assert.match(renderOverview(sampleStatistics({ sourceShare: zeroShare })), /No tokens observed/);
  assert.match(renderOverview(sampleStatistics({ sourceShare: unknownShare })), /Source share unavailable/);
});

test('trend는 unknown outline과 partial dashed 상태를 값 0과 구분한다', () => {
  const svg = renderTrends(sampleStatistics());

  assert.match(svg, /class="trend-bar state-unknown"/);
  assert.match(svg, /class="trend-bar state-partial"/);
  assert.match(svg, /class="trend-bar state-zero"/);
  assert.match(svg, /stroke-dasharray/);
});

test('activity는 Monday 기반 53x7 셀과 future/unknown/partial 상태를 보존한다', () => {
  const svg = renderActivity(sampleStatistics());
  const cells = svg.match(/class="heat-cell [^"]+"/g) ?? [];

  assert.equal(cells.length, 371);
  assert.match(svg, /heat-cell state-future/);
  assert.match(svg, /heat-cell state-unknown/);
  assert.match(svg, /coverage-partial/);
});

test('compact formatter가 extreme safe integer를 짧고 결정론적으로 표시한다', () => {
  assert.equal(formatCompactNumber(null), '—');
  assert.equal(formatCompactNumber(0), '0');
  assert.equal(formatCompactNumber(999), '999');
  assert.equal(formatCompactNumber(1_200), '1.2K');
  assert.equal(formatCompactNumber(12_345_678), '12.3M');
  assert.equal(formatCompactNumber(Number.MAX_SAFE_INTEGER), '9.01Q');
  assert.throws(() => formatCompactNumber(Number.MAX_SAFE_INTEGER + 1), /safe integer/);

  const overview = renderOverview(sampleStatistics());
  assert.doesNotMatch(overview, /9007199254740991/);
  assert.match(overview, /9\.01Q/);
});

test('같은 statistics와 context는 byte-for-byte 같은 SVG를 만든다', () => {
  const statistics = sampleStatistics();
  assert.equal(renderOverview(statistics), renderOverview(structuredClone(statistics)));
  assert.equal(renderTrends(statistics), renderTrends(structuredClone(statistics)));
  assert.equal(renderActivity(statistics), renderActivity(structuredClone(statistics)));
});

test('renderCards는 정렬된 strict 공개 JSON을 읽어 세 카드를 원자적으로 교체한다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  await mkdir(path.join(cwd, 'data', 'devices'), { recursive: true });
  await mkdir(path.join(cwd, 'data', 'profiles'), { recursive: true });

  for (const snapshot of fixture.deviceSnapshots.toReversed()) {
    await writeFile(
      path.join(cwd, 'data', 'devices', `${snapshot.deviceId}.json`),
      `${JSON.stringify(snapshot)}\n`,
      'utf8',
    );
  }
  for (const candidate of fixture.profileCandidates) {
    await writeFile(
      path.join(cwd, 'data', 'profiles', `${candidate.deviceId}.json`),
      `${JSON.stringify(candidate)}\n`,
      'utf8',
    );
  }

  const result = await renderCards({ cwd, asOf: AS_OF });
  assert.equal(result.asOf, AS_OF);
  assert.deepEqual(Object.keys(result.cardPaths), ['overview', 'trends', 'activity']);
  for (const [name, viewBox] of [
    ['overview', '0 0 500 420'],
    ['trends', '0 0 500 460'],
    ['activity', '0 0 500 340'],
  ]) {
    const contents = await readFile(path.join(cwd, 'cards', `${name}.svg`), 'utf8');
    assertSafeCard(contents, viewBox);
  }

  const first = await Promise.all(
    ['overview', 'trends', 'activity'].map((name) => readFile(path.join(cwd, 'cards', `${name}.svg`), 'utf8')),
  );
  await renderCards({ cwd, asOf: AS_OF });
  const second = await Promise.all(
    ['overview', 'trends', 'activity'].map((name) => readFile(path.join(cwd, 'cards', `${name}.svg`), 'utf8')),
  );
  assert.deepEqual(second, first);
});

test('모든 SVG 검증이 끝나기 전 실패하면 기존 카드 bytes를 보존한다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-atomic-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'cards'), { recursive: true });
  const names = ['overview', 'trends', 'activity'];
  await Promise.all(names.map((name) => writeFile(path.join(cwd, 'cards', `${name}.svg`), `old-${name}\n`, 'utf8')));

  let calls = 0;
  await assert.rejects(
    () => renderCards({
      cwd,
      asOf: AS_OF,
      validateSvg() {
        calls += 1;
        if (calls === 2) {
          throw new Error('fixture validator rejection');
        }
      },
    }),
    /fixture validator rejection/,
  );

  assert.equal(calls, 2);
  for (const name of names) {
    assert.equal(await readFile(path.join(cwd, 'cards', `${name}.svg`), 'utf8'), `old-${name}\n`);
  }
});

test('빈 data 디렉터리도 unknown empty state의 유효한 카드를 만든다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-empty-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await renderCards({ cwd, asOf: AS_OF });
  const overview = await readFile(path.join(cwd, 'cards', 'overview.svg'), 'utf8');
  const trends = await readFile(path.join(cwd, 'cards', 'trends.svg'), 'utf8');
  assert.match(overview, /No observed usage yet/);
  assert.match(trends, /No observed usage yet/);
  assertSafeCard(overview, '0 0 500 420');
});

test('malformed 공개 JSON은 기존 카드 교체 전에 fail closed 처리한다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-invalid-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'data', 'devices'), { recursive: true });
  await mkdir(path.join(cwd, 'cards'), { recursive: true });
  await writeFile(path.join(cwd, 'data', 'devices', 'invalid.json'), '{"unexpected":true}\n', 'utf8');
  await writeFile(path.join(cwd, 'cards', 'overview.svg'), 'old-overview\n', 'utf8');

  await assert.rejects(() => renderCards({ cwd, asOf: AS_OF }));
  assert.equal(await readFile(path.join(cwd, 'cards', 'overview.svg'), 'utf8'), 'old-overview\n');
});

test('render CLI는 명시적 --as-of 날짜를 요구하고 안전한 결과만 출력한다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const stdout = captureStream();
  const stderr = captureStream();

  assert.equal(await runRenderCommand([], { stdout, stderr }, { cwd }), 2);
  assert.match(stderr.text(), /--as-of YYYY-MM-DD/);
  assert.equal(
    await runRenderCommand(['--as-of', AS_OF], { stdout, stderr }, { cwd }),
    0,
  );
  assert.match(stdout.text(), /Rendered 3 cards as of 2026-07-19/);
});

test('determinism 검사는 --as-of flag를 요구하고 두 출력의 bytes를 비교한다', () => {
  const missing = spawnSync(
    process.execPath,
    ['scripts/check-render-determinism.mjs'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--as-of YYYY-MM-DD/);

  const valid = spawnSync(
    process.execPath,
    ['scripts/check-render-determinism.mjs', '--as-of', AS_OF],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Deterministic SVG OK \(3 cards, as-of 2026-07-19\)/);
});
