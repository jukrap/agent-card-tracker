import {
  assertIsoDate,
  assertTimeZone,
  dateAtInstant,
  eachDay,
  heatmapRange,
  periodRanges,
  trendBuckets,
} from './calendar.mjs';

const SOURCES = Object.freeze(['claude', 'codex']);
const BREAKDOWN_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite']);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export class StatisticsError extends TypeError {
  constructor(code, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'StatisticsError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, path) {
  throw new StatisticsError(code, path);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeAdd(left, right, path) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail('SAFE_INTEGER_OVERFLOW', path);
  }
  return result;
}

function assertNonNegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('NON_NEGATIVE_SAFE_INTEGER', path);
  }
  return value;
}

function validateDate(value, path) {
  try {
    return assertIsoDate(value);
  } catch {
    fail('DATE', path);
  }
}

function validateTimezone(value) {
  try {
    return assertTimeZone(value);
  } catch {
    fail('TIMEZONE', '$.timezone');
  }
}

function resolveAsOf(value, timezone) {
  if (typeof value === 'string' && ISO_DATE_PATTERN.test(value)) {
    return validateDate(value, '$.asOf');
  }

  const epochMs = value instanceof Date
    ? value.valueOf()
    : typeof value === 'number'
      ? value
      : Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    fail('AS_OF', '$.asOf');
  }
  try {
    return dateAtInstant(epochMs, timezone);
  } catch {
    fail('AS_OF', '$.asOf');
  }
}

function normalizeRange(value, path) {
  if (value === null) {
    return null;
  }
  if (!isObject(value)) {
    fail('COVERAGE_RANGE', path);
  }
  const startDate = validateDate(value.startDate, `${path}.startDate`);
  const endDate = validateDate(value.endDate, `${path}.endDate`);
  if (startDate > endDate) {
    fail('COVERAGE_RANGE', path);
  }
  return { startDate, endDate };
}

function normalizeCoverage(value, source) {
  const path = `$.coverage.${source}`;
  if (!isObject(value) || typeof value.dateBasis !== 'string' || value.dateBasis.length === 0) {
    fail('COVERAGE', path);
  }
  return {
    dateBasis: value.dateBasis,
    totals: normalizeRange(value.totals, `${path}.totals`),
    breakdown: normalizeRange(value.breakdown, `${path}.breakdown`),
    sessions: normalizeRange(value.sessions, `${path}.sessions`),
  };
}

function normalizeMetric(value, path) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isObject(value)) {
    fail('METRIC', path);
  }

  const result = {};
  for (const field of BREAKDOWN_FIELDS) {
    const fieldValue = value[field];
    result[field] = fieldValue === null
      ? null
      : assertNonNegativeSafeInteger(fieldValue, `${path}.${field}`);
  }
  result.total = assertNonNegativeSafeInteger(value.total, `${path}.total`);
  result.sessions = value.sessions === null
    ? null
    : assertNonNegativeSafeInteger(value.sessions, `${path}.sessions`);

  const knownBreakdown = BREAKDOWN_FIELDS.reduce(
    (sum, field) => result[field] === null
      ? sum
      : safeAdd(sum, result[field], `${path}.${field}`),
    0,
  );
  if (knownBreakdown > result.total) {
    fail('BREAKDOWN_EXCEEDS_TOTAL', path);
  }
  return result;
}

function normalizeInput(merged) {
  if (!isObject(merged)) {
    fail('MERGED_USAGE', '$');
  }
  const timezone = validateTimezone(merged.timezone);
  if (!Array.isArray(merged.days)) {
    fail('DAYS', '$.days');
  }
  if (!isObject(merged.coverage)) {
    fail('COVERAGE', '$.coverage');
  }
  if (merged.codexSource !== 'devices' && merged.codexSource !== 'profile') {
    fail('CODEX_SOURCE', '$.codexSource');
  }

  const days = new Map();
  for (const [index, value] of merged.days.entries()) {
    const path = `$.days[${index}]`;
    if (!isObject(value)) {
      fail('DAY', path);
    }
    const date = validateDate(value.date, `${path}.date`);
    if (days.has(date)) {
      fail('DUPLICATE_DATE', `${path}.date`);
    }
    days.set(date, {
      date,
      claude: normalizeMetric(value.claude, `${path}.claude`),
      codex: normalizeMetric(value.codex, `${path}.codex`),
    });
  }

  const codexLifetimeTotalTokens = Object.hasOwn(merged, 'codexLifetimeTotalTokens')
    ? assertNonNegativeSafeInteger(
        merged.codexLifetimeTotalTokens,
        '$.codexLifetimeTotalTokens',
      )
    : null;
  if (codexLifetimeTotalTokens !== null && merged.codexSource !== 'profile') {
    fail('LIFETIME_PROVENANCE', '$.codexLifetimeTotalTokens');
  }

  return {
    timezone,
    codexSource: merged.codexSource,
    days,
    coverage: {
      claude: normalizeCoverage(merged.coverage.claude, 'claude'),
      codex: normalizeCoverage(merged.coverage.codex, 'codex'),
    },
    codexLifetimeTotalTokens,
  };
}

function inRange(date, range) {
  return range !== null && range.startDate <= date && date <= range.endDate;
}

function observedMetric(value, coverage) {
  if (coverage === 'unknown') {
    return { value: null, coverage, lowerBound: false };
  }
  return {
    value,
    coverage,
    lowerBound: coverage === 'partial',
  };
}

function completeMetric(value) {
  return observedMetric(value, 'complete');
}

function partialMetric(value) {
  return observedMetric(value, 'partial');
}

function mixedMetric(value) {
  return observedMetric(value, 'mixed');
}

function unknownMetric() {
  return observedMetric(null, 'unknown');
}

function unobservedSourceMetric(input, source) {
  return input.coverage[source].dateBasis === input.timezone
    ? unknownMetric()
    : mixedMetric(null);
}

function hasKnownSignal(metric) {
  if (metric === null) {
    return false;
  }
  if (metric.total > 0 || (metric.sessions !== null && metric.sessions > 0)) {
    return true;
  }
  return BREAKDOWN_FIELDS.some((field) => metric[field] !== null && metric[field] > 0);
}

function sourceTotalForDate(input, date, source) {
  const raw = input.days.get(date)?.[source] ?? null;
  if (inRange(date, input.coverage[source].totals)) {
    const value = raw?.total ?? 0;
    return input.coverage[source].dateBasis === input.timezone
      ? completeMetric(value)
      : mixedMetric(value);
  }
  if (raw !== null && raw.total > 0) {
    return input.coverage[source].dateBasis === input.timezone
      ? partialMetric(raw.total)
      : mixedMetric(raw.total);
  }
  return unobservedSourceMetric(input, source);
}

function sourceSessionsForDate(input, date, source) {
  const raw = input.days.get(date)?.[source] ?? null;
  if (inRange(date, input.coverage[source].sessions)) {
    if (raw?.sessions === null) {
      return unobservedSourceMetric(input, source);
    }
    const value = raw === null || raw.sessions === undefined ? 0 : raw.sessions;
    return input.coverage[source].dateBasis === input.timezone
      ? completeMetric(value)
      : mixedMetric(value);
  }
  if (raw?.sessions !== null && raw?.sessions !== undefined && hasKnownSignal(raw)) {
    return input.coverage[source].dateBasis === input.timezone
      ? partialMetric(raw.sessions)
      : mixedMetric(raw.sessions);
  }
  return unobservedSourceMetric(input, source);
}

function combineMetrics(metrics, path) {
  const known = metrics.filter((metric) => metric.value !== null);
  if (known.length === 0) {
    return unknownMetric();
  }
  const value = known.reduce(
    (sum, metric) => safeAdd(sum, metric.value, path),
    0,
  );
  if (metrics.some((metric) => metric.coverage === 'mixed')) {
    return mixedMetric(value);
  }
  return metrics.every((metric) => metric.coverage === 'complete')
    ? completeMetric(value)
    : partialMetric(value);
}

function totalForDate(input, date) {
  return combineMetrics(
    SOURCES.map((source) => sourceTotalForDate(input, date, source)),
    `$.statistics.days.${date}.totalTokens`,
  );
}

function sessionsForDate(input, date) {
  return combineMetrics(
    SOURCES.map((source) => sourceSessionsForDate(input, date, source)),
    `$.statistics.days.${date}.sessions`,
  );
}

function aggregateMetrics(metrics, path) {
  const known = metrics.filter((metric) => metric.value !== null);
  if (known.length === 0) {
    return metrics.some((metric) => metric.coverage === 'mixed')
      ? mixedMetric(null)
      : unknownMetric();
  }
  const value = known.reduce(
    (sum, metric) => safeAdd(sum, metric.value, path),
    0,
  );
  if (metrics.some((metric) => metric.coverage === 'mixed')) {
    return mixedMetric(value);
  }
  return metrics.every((metric) => metric.coverage === 'complete')
    ? completeMetric(value)
    : partialMetric(value);
}

function publicRange(value) {
  return { startDate: value.start, endDate: value.end };
}

function summarizeRange(input, range) {
  const dates = eachDay(range.startDate, range.endDate);
  return {
    range: { ...range },
    totalTokens: aggregateMetrics(
      dates.map((date) => totalForDate(input, date)),
      `$.statistics.ranges.${range.startDate}.${range.endDate}.totalTokens`,
    ),
    sessions: aggregateMetrics(
      dates.map((date) => sessionsForDate(input, date)),
      `$.statistics.ranges.${range.startDate}.${range.endDate}.sessions`,
    ),
  };
}

function sourceRangeTotal(input, range, source) {
  return aggregateMetrics(
    eachDay(range.startDate, range.endDate)
      .map((date) => sourceTotalForDate(input, date, source)),
    `$.statistics.ranges.${range.startDate}.${range.endDate}.${source}`,
  );
}

function comparison(current, previous) {
  if (current.coverage === 'mixed' || previous.coverage === 'mixed') {
    return { kind: 'mixed', percentage: null };
  }
  if (current.coverage !== 'complete' || previous.coverage !== 'complete') {
    return { kind: 'unknown', percentage: null };
  }
  if (current.value === previous.value) {
    return { kind: 'flat', percentage: 0 };
  }
  if (previous.value === 0) {
    return { kind: 'new', percentage: null };
  }
  return {
    kind: 'percent',
    percentage: ((current.value - previous.value) / previous.value) * 100,
  };
}

function periodStatistics(input, ranges) {
  return Object.fromEntries(Object.entries(ranges).map(([name, value]) => {
    const current = summarizeRange(input, publicRange(value.current));
    const previous = summarizeRange(input, publicRange(value.previous));
    return [name, {
      current,
      previous,
      comparison: comparison(current.totalTokens, previous.totalTokens),
    }];
  }));
}

function trackedStartDate(input, asOf) {
  const candidates = [];
  for (const { date } of input.days.values()) {
    if (date <= asOf) {
      candidates.push(date);
    }
  }
  for (const source of SOURCES) {
    const startDate = input.coverage[source].totals?.startDate;
    if (startDate !== undefined && startDate <= asOf) {
      candidates.push(startDate);
    }
  }
  return candidates.length === 0 ? null : candidates.toSorted()[0];
}

function lifetimeStatistics(input, asOf) {
  const startDate = trackedStartDate(input, asOf);
  const range = startDate === null ? null : { startDate, endDate: asOf };
  const tracked = range === null
    ? { totalTokens: unknownMetric(), sessions: unknownMetric() }
    : summarizeRange(input, range);
  const claudeTracked = range === null
    ? unknownMetric()
    : sourceRangeTotal(input, range, 'claude');
  const codexTracked = range === null
    ? unknownMetric()
    : sourceRangeTotal(input, range, 'codex');
  const providerReported = input.codexLifetimeTotalTokens === null
    ? null
    : completeMetric(input.codexLifetimeTotalTokens);
  const codexTotal = providerReported ?? codexTracked;
  const totalTokens = combineMetrics(
    [claudeTracked, codexTotal],
    '$.statistics.lifetime.totalTokens',
  );

  return {
    range,
    trackedTotalTokens: tracked.totalTokens,
    totalTokens,
    sessions: tracked.sessions,
    provenance: {
      claude: 'tracked-daily',
      codex: providerReported === null ? 'tracked-daily' : 'provider-reported',
    },
    sources: {
      claude: {
        provenance: 'tracked-daily',
        totalTokens: claudeTracked,
      },
      codex: {
        provenance: providerReported === null ? 'tracked-daily' : 'provider-reported',
        totalTokens: codexTotal,
        trackedTotalTokens: codexTracked,
      },
    },
  };
}

function sourceShare(input, range) {
  const claude = sourceRangeTotal(input, range, 'claude');
  const codex = sourceRangeTotal(input, range, 'codex');
  const totalTokens = combineMetrics(
    [claude, codex],
    '$.statistics.sourceShare.totalTokens',
  );
  const canComputeShare = ['complete', 'mixed'].includes(claude.coverage)
    && ['complete', 'mixed'].includes(codex.coverage)
    && claude.value !== null
    && codex.value !== null
    && totalTokens.value > 0;

  return {
    range: { ...range },
    totalTokens,
    sources: {
      claude: {
        totalTokens: claude,
        percentage: canComputeShare ? (claude.value / totalTokens.value) * 100 : null,
      },
      codex: {
        totalTokens: codex,
        percentage: canComputeShare ? (codex.value / totalTokens.value) * 100 : null,
      },
    },
  };
}

function tokenMix(input, range) {
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    unknownTokens: 0,
  };
  let sawKnown = false;
  let allComplete = true;
  let sawMixed = false;

  for (const date of eachDay(range.startDate, range.endDate)) {
    for (const source of SOURCES) {
      const total = sourceTotalForDate(input, date, source);
      if (total.coverage === 'mixed') {
        sawMixed = true;
      }
      if (total.value === null) {
        allComplete = false;
        continue;
      }
      sawKnown = true;
      if (total.coverage !== 'complete' && total.coverage !== 'mixed') {
        allComplete = false;
      }

      const raw = input.days.get(date)?.[source] ?? null;
      const completeBreakdown = inRange(date, input.coverage[source].breakdown)
        && (raw === null || BREAKDOWN_FIELDS.every((field) => raw[field] !== null));
      if (!completeBreakdown) {
        allComplete = false;
      }

      let classified = 0;
      for (const field of BREAKDOWN_FIELDS) {
        const value = raw?.[field] ?? 0;
        if (value !== null) {
          totals[field] = safeAdd(
            totals[field],
            value,
            `$.statistics.tokenMix.${field}`,
          );
          classified = safeAdd(classified, value, `$.statistics.tokenMix.${date}.${source}`);
        }
      }
      if (classified > total.value) {
        fail('BREAKDOWN_EXCEEDS_TOTAL', `$.statistics.tokenMix.${date}.${source}`);
      }
      totals.unknownTokens = safeAdd(
        totals.unknownTokens,
        total.value - classified,
        '$.statistics.tokenMix.unknownTokens',
      );
    }
  }

  return {
    range: { ...range },
    ...totals,
    totalTokens: aggregateMetrics(
      eachDay(range.startDate, range.endDate).map((date) => totalForDate(input, date)),
      '$.statistics.tokenMix.totalTokens',
    ),
    coverage: !sawKnown
      ? 'unknown'
      : sawMixed
        ? 'mixed'
        : allComplete
          ? 'complete'
          : 'partial',
  };
}

function stateForMetric(metric) {
  if (metric.value === null || (metric.coverage === 'partial' && metric.value === 0)) {
    return 'unknown';
  }
  return metric.value === 0 ? 'zero' : 'active';
}

function activityStatistics(input, asOf, lifetimeRange) {
  if (lifetimeRange === null) {
    return {
      activeDays: unknownMetric(),
      currentStreak: unknownMetric(),
      longestStreak: unknownMetric(),
      peak: { date: null, totalTokens: null, coverage: 'unknown', lowerBound: false },
    };
  }

  const dates = eachDay(lifetimeRange.startDate, lifetimeRange.endDate);
  let activeDays = 0;
  let currentRun = 0;
  let longestRun = 0;
  let sawKnown = false;
  let sawUnknown = false;
  let sawMixed = false;
  let leftBoundaryActive = false;
  let peak = null;
  let peakIncomplete = false;
  let peakMixed = false;

  for (const [index, date] of dates.entries()) {
    const totalTokens = totalForDate(input, date);
    const state = stateForMetric(totalTokens);
    if (totalTokens.coverage === 'mixed') {
      sawMixed = true;
    }
    if (state === 'unknown') {
      sawUnknown = true;
      currentRun = 0;
      peakIncomplete = true;
      continue;
    }

    sawKnown = true;
    if (state === 'active') {
      if (index === 0) {
        leftBoundaryActive = true;
      }
      activeDays += 1;
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
      if (
        peak === null
        || totalTokens.value > peak.totalTokens
        || (totalTokens.value === peak.totalTokens && date < peak.date)
      ) {
        peak = { date, totalTokens: totalTokens.value };
      }
      if (totalTokens.coverage === 'mixed') {
        peakMixed = true;
      } else if (totalTokens.coverage !== 'complete') {
        peakIncomplete = true;
      }
    } else {
      currentRun = 0;
    }
  }

  const binaryCoverage = !sawKnown
    ? 'unknown'
    : sawMixed
      ? 'mixed'
      : sawUnknown
        ? 'partial'
        : 'complete';
  const activeDaysMetric = binaryCoverage === 'unknown'
    ? unknownMetric()
    : observedMetric(activeDays, binaryCoverage);
  const longestCoverage = binaryCoverage === 'complete' && leftBoundaryActive
    ? 'partial'
    : binaryCoverage;
  const longestStreakMetric = sawMixed
    ? mixedMetric(null)
    : longestCoverage === 'unknown'
      ? unknownMetric()
      : observedMetric(longestRun, longestCoverage);

  let currentStreak = 0;
  let currentCoverage = 'partial';
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const state = stateForMetric(totalForDate(input, dates[index]));
    if (state === 'active') {
      currentStreak += 1;
      continue;
    }
    if (state === 'zero') {
      currentCoverage = 'complete';
    } else if (currentStreak === 0) {
      currentCoverage = 'unknown';
    }
    break;
  }
  const currentStreakMetric = sawMixed
    ? mixedMetric(null)
    : currentCoverage === 'unknown'
      ? unknownMetric()
      : observedMetric(currentStreak, currentCoverage);

  const peakCoverage = peak === null
    ? (sawMixed ? 'mixed' : sawUnknown ? 'unknown' : 'complete')
    : (peakMixed ? 'mixed' : peakIncomplete ? 'partial' : 'complete');
  return {
    activeDays: activeDaysMetric,
    currentStreak: currentStreakMetric,
    longestStreak: longestStreakMetric,
    peak: {
      date: peak?.date ?? null,
      totalTokens: peak?.totalTokens ?? (peakCoverage === 'complete' ? 0 : null),
      coverage: peakCoverage,
      lowerBound: peakCoverage === 'partial',
    },
  };
}

function trendStatistics(input, ranges) {
  return Object.fromEntries(Object.entries(ranges).map(([name, buckets]) => [
    name,
    buckets.map((bucket) => summarizeRange(input, publicRange(bucket))),
  ]));
}

function nearestRank(values, fraction) {
  return values[Math.ceil(values.length * fraction) - 1];
}

function heatmapStatistics(input, asOf) {
  const range = heatmapRange(asOf);
  const entries = range.dates.map((date) => {
    if (date > asOf) {
      return {
        date,
        state: 'future',
        totalTokens: null,
        coverage: 'unknown',
        level: 0,
      };
    }
    const totalTokens = totalForDate(input, date);
    const state = stateForMetric(totalTokens);
    return {
      date,
      state,
      totalTokens: state === 'active' || state === 'zero' ? totalTokens.value : null,
      coverage: totalTokens.coverage,
      level: 0,
    };
  });

  const positive = entries
    .filter((entry) => entry.state === 'active')
    .map((entry) => entry.totalTokens)
    .toSorted((left, right) => left - right);
  const thresholds = positive.length === 0
    ? []
    : [
        nearestRank(positive, 0.25),
        nearestRank(positive, 0.5),
        nearestRank(positive, 0.75),
      ];

  for (const entry of entries) {
    if (entry.state === 'active') {
      entry.level = 1 + thresholds.filter((threshold) => entry.totalTokens > threshold).length;
    }
  }

  return {
    startDate: range.start,
    endDate: range.end,
    thresholds,
    cells: entries,
  };
}

/**
 * Computes deterministic, coverage-aware card statistics from mergeUsage output.
 * Unknown observations are never silently zero-filled outside their coverage.
 */
export function computeStatistics(merged, { asOf } = {}) {
  const input = normalizeInput(merged);
  if (asOf === undefined) {
    fail('AS_OF', '$.asOf');
  }
  const asOfDate = resolveAsOf(asOf, input.timezone);
  const ranges = periodRanges(asOfDate);
  const periods = periodStatistics(input, ranges);
  const rolling30Range = publicRange(ranges.rolling30.current);
  const lifetime = lifetimeStatistics(input, asOfDate);

  return {
    asOf: asOfDate,
    timezone: input.timezone,
    periods,
    lifetime,
    sourceShare: sourceShare(input, rolling30Range),
    tokenMix: tokenMix(input, rolling30Range),
    activity: activityStatistics(input, asOfDate, lifetime.range),
    trends: trendStatistics(input, trendBuckets(asOfDate)),
    heatmap: heatmapStatistics(input, asOfDate),
  };
}
