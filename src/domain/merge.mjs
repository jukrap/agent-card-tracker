import {
  PublicSchemaError,
  validateDeviceSnapshot,
  validateIanaTimezone,
  validateProfileCandidate,
} from './schema.mjs';

const HOUR_MS = 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;
const DEFAULT_PROFILE_FRESHNESS_HOURS = 48;
const DEFAULT_DEVICE_STALE_HOURS = 72;
const DEFAULT_FUTURE_CLOCK_SKEW_MINUTES = 5;

const LOCAL_METRIC_FIELDS = Object.freeze([
  ['inputTokens', 'input'],
  ['outputTokens', 'output'],
  ['cacheReadTokens', 'cacheRead'],
  ['cacheWriteTokens', 'cacheWrite'],
  ['totalTokens', 'total'],
]);

export class UsageMergeError extends TypeError {
  constructor(code, path = '$') {
    super(`${code} at ${path}`);
    this.name = 'UsageMergeError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, path) {
  throw new UsageMergeError(code, path);
}

function assertArray(value, path) {
  if (!Array.isArray(value)) {
    fail('ARRAY', path);
  }
}

function durationToMilliseconds(value, unitMilliseconds, path) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER / unitMilliseconds
  ) {
    fail('DURATION', path);
  }
  return value * unitMilliseconds;
}

function parseAsOf(value) {
  const parsed = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    fail('AS_OF', '$.asOf');
  }
  return parsed.valueOf();
}

function safeAdd(left, right, path) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    fail('SAFE_INTEGER_OVERFLOW', path);
  }
  return value;
}

function emptyLocalAccumulator() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    sessionTotal: 0,
    sessionUnknown: false,
  };
}

function localMetric(accumulator) {
  if (accumulator === undefined) {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      sessions: 0,
    };
  }
  return {
    input: accumulator.input,
    output: accumulator.output,
    cacheRead: accumulator.cacheRead,
    cacheWrite: accumulator.cacheWrite,
    total: accumulator.total,
    sessions: accumulator.sessionUnknown ? null : accumulator.sessionTotal,
  };
}

function profileMetric(total) {
  return {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    total,
    sessions: null,
  };
}

function aggregateLocalSource(deviceSnapshots, sourceName) {
  const byDate = new Map();
  let dayRecordCount = 0;
  let knownSessionRecordCount = 0;
  let unknownSessionRecordCount = 0;

  for (const snapshot of deviceSnapshots) {
    for (const day of snapshot.sources[sourceName].days) {
      dayRecordCount += 1;
      const current = byDate.get(day.date) ?? emptyLocalAccumulator();
      for (const [inputField, outputField] of LOCAL_METRIC_FIELDS) {
        current[outputField] = safeAdd(
          current[outputField],
          day[inputField],
          `$.days.${day.date}.${sourceName}.${outputField}`,
        );
      }

      if (day.sessions === null) {
        current.sessionUnknown = true;
        unknownSessionRecordCount += 1;
      } else {
        current.sessionTotal = safeAdd(
          current.sessionTotal,
          day.sessions,
          `$.days.${day.date}.${sourceName}.sessions`,
        );
        knownSessionRecordCount += 1;
      }
      byDate.set(day.date, current);
    }
  }

  return {
    byDate,
    dayRecordCount,
    knownSessionRecordCount,
    unknownSessionRecordCount,
  };
}

function sessionCoverage(aggregate) {
  if (aggregate.dayRecordCount === 0) {
    return 'none';
  }
  if (aggregate.unknownSessionRecordCount === 0) {
    return 'complete';
  }
  if (aggregate.knownSessionRecordCount === 0) {
    return 'unavailable';
  }
  return 'partial';
}

function publicSessionCoverage(aggregate) {
  const coverage = sessionCoverage(aggregate);
  if (coverage === 'complete') {
    return 'full';
  }
  if (coverage === 'partial') {
    return 'partial';
  }
  return 'unknown';
}

function instantDateInTimezone(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localSourceCoverage(devices, sourceName, timezone, aggregate) {
  const dayDates = devices.flatMap((snapshot) =>
    snapshot.sources[sourceName].days.map((day) => day.date));
  const successfulDates = devices.flatMap((snapshot) => {
    const lastSuccessfulAt = snapshot.sources[sourceName].lastSuccessfulAt;
    return lastSuccessfulAt === null
      ? []
      : [instantDateInTimezone(lastSuccessfulAt, timezone)];
  });
  const endDates = [...dayDates, ...successfulDates];

  return {
    dateBasis: timezone,
    startDate: dayDates.length === 0 ? null : dayDates.toSorted()[0],
    endDate: endDates.length === 0 ? null : endDates.toSorted().at(-1),
    breakdown: 'full',
    sessions: publicSessionCoverage(aggregate),
  };
}

function profileCoverage(candidate) {
  return {
    dateBasis: candidate.dateBasis,
    startDate: candidate.coverage.startDate,
    endDate: candidate.coverage.endDate,
    breakdown: 'total-only',
    sessions: 'unknown',
  };
}

function profileFingerprint(candidate) {
  return JSON.stringify([
    candidate.deviceId,
    candidate.writerKeyHash,
    candidate.collectedAt,
    candidate.daily.map((day) => [day.date, day.totalTokens]),
    Object.hasOwn(candidate, 'lifetimeTotalTokens') ? candidate.lifetimeTotalTokens : null,
    candidate.coverage.startDate,
    candidate.coverage.endDate,
    candidate.coverage.bucketCount,
  ]);
}

function compareStrings(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareProfiles(left, right) {
  const timeDifference = Date.parse(right.collectedAt) - Date.parse(left.collectedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  const deviceDifference = compareStrings(left.deviceId, right.deviceId);
  if (deviceDifference !== 0) {
    return deviceDifference;
  }
  return compareStrings(profileFingerprint(left), profileFingerprint(right));
}

function validateAndSortDevices(deviceSnapshots, configuredTimezone) {
  const sorted = deviceSnapshots
    .map((snapshot) => validateDeviceSnapshot(snapshot))
    .toSorted((left, right) => compareStrings(left.deviceId, right.deviceId));

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].deviceId === sorted[index].deviceId) {
      fail('DUPLICATE_DEVICE', `$.deviceSnapshots[${index}].deviceId`);
    }
  }

  const timezone = sorted.length > 0
    ? sorted[0].timezone
    : validateIanaTimezone(configuredTimezone ?? 'UTC');
  if (configuredTimezone !== undefined) {
    const validatedTimezone = validateIanaTimezone(configuredTimezone);
    if (validatedTimezone !== timezone) {
      fail('TIMEZONE_MISMATCH', '$.timezone');
    }
  }
  for (const snapshot of sorted) {
    if (snapshot.timezone !== timezone) {
      fail('TIMEZONE_MISMATCH', '$.deviceSnapshots');
    }
  }

  return { sorted, timezone };
}

function selectProfileCandidates(profileCandidates, asOfMs, freshnessMs, futureClockSkewMs) {
  const valid = [];
  let invalidProfileCandidateCount = 0;

  for (const candidate of profileCandidates) {
    try {
      valid.push(validateProfileCandidate(candidate));
    } catch (error) {
      if (!(error instanceof PublicSchemaError)) {
        throw error;
      }
      invalidProfileCandidateCount += 1;
    }
  }

  const fresh = valid.filter((candidate) => {
    const ageMs = asOfMs - Date.parse(candidate.collectedAt);
    return ageMs >= -futureClockSkewMs && ageMs <= freshnessMs;
  }).toSorted(compareProfiles);

  return {
    selected: fresh[0] ?? null,
    validProfileCandidateCount: valid.length,
    invalidProfileCandidateCount,
    freshProfileCandidateCount: fresh.length,
  };
}

function combinedTokenMixCoverage(claudeAggregate, codexAggregate, selectedProfile) {
  const hasClaude = claudeAggregate.dayRecordCount > 0;
  const hasCodex = selectedProfile === null
    ? codexAggregate.dayRecordCount > 0
    : selectedProfile.daily.length > 0;

  if (!hasClaude && !hasCodex) {
    return 'none';
  }
  if (selectedProfile !== null && hasCodex) {
    return hasClaude ? 'partial' : 'unavailable';
  }
  return 'complete';
}

/**
 * Deterministically merges sanitized, public usage snapshots.
 *
 * A fresh Codex profile candidate is authoritative for all Codex dates. Local
 * Codex records are used only when no valid, fresh profile candidate exists.
 */
export function mergeUsage({
  deviceSnapshots = [],
  profileCandidates = [],
  asOf = new Date(),
  timezone,
  profileFreshnessHours = DEFAULT_PROFILE_FRESHNESS_HOURS,
  deviceStaleHours = DEFAULT_DEVICE_STALE_HOURS,
  futureClockSkewMinutes = DEFAULT_FUTURE_CLOCK_SKEW_MINUTES,
} = {}) {
  assertArray(deviceSnapshots, '$.deviceSnapshots');
  assertArray(profileCandidates, '$.profileCandidates');

  const asOfMs = parseAsOf(asOf);
  const profileFreshnessMs = durationToMilliseconds(
    profileFreshnessHours,
    HOUR_MS,
    '$.profileFreshnessHours',
  );
  const deviceStaleMs = durationToMilliseconds(
    deviceStaleHours,
    HOUR_MS,
    '$.deviceStaleHours',
  );
  const futureClockSkewMs = durationToMilliseconds(
    futureClockSkewMinutes,
    MINUTE_MS,
    '$.futureClockSkewMinutes',
  );

  const { sorted: devices, timezone: mergedTimezone } = validateAndSortDevices(
    deviceSnapshots,
    timezone,
  );
  const profileSelection = selectProfileCandidates(
    profileCandidates,
    asOfMs,
    profileFreshnessMs,
    futureClockSkewMs,
  );
  const selectedProfile = profileSelection.selected;

  const claudeAggregate = aggregateLocalSource(devices, 'claude');
  const localCodexAggregate = aggregateLocalSource(devices, 'codex');
  const profileByDate = new Map(
    selectedProfile?.daily.map((day) => [day.date, day.totalTokens]) ?? [],
  );

  const dates = new Set(claudeAggregate.byDate.keys());
  if (selectedProfile === null) {
    for (const date of localCodexAggregate.byDate.keys()) {
      dates.add(date);
    }
  } else {
    for (const date of profileByDate.keys()) {
      dates.add(date);
    }
  }

  const days = [...dates].toSorted().map((date) => ({
    date,
    claude: localMetric(claudeAggregate.byDate.get(date)),
    codex: selectedProfile === null
      ? localMetric(localCodexAggregate.byDate.get(date))
      : profileMetric(profileByDate.get(date) ?? 0),
  }));

  const staleDeviceCount = devices.reduce((count, snapshot) => {
    const ageMs = asOfMs - Date.parse(snapshot.generatedAt);
    return count + (ageMs > deviceStaleMs ? 1 : 0);
  }, 0);
  const selectedProfileAgeHours = selectedProfile === null
    ? null
    : Math.max(0, asOfMs - Date.parse(selectedProfile.collectedAt)) / HOUR_MS;
  const codexSource = selectedProfile === null ? 'devices' : 'profile';

  const claudeCoverage = localSourceCoverage(
    devices,
    'claude',
    mergedTimezone,
    claudeAggregate,
  );
  const codexCoverage = selectedProfile === null
    ? localSourceCoverage(devices, 'codex', mergedTimezone, localCodexAggregate)
    : profileCoverage(selectedProfile);

  const result = {
    codexSource,
    timezone: mergedTimezone,
    days,
    coverage: {
      claude: claudeCoverage,
      codex: codexCoverage,
    },
    diagnostics: {
      deviceCount: devices.length,
      staleDeviceCount,
      profileCandidateCount: profileCandidates.length,
      validProfileCandidateCount: profileSelection.validProfileCandidateCount,
      invalidProfileCandidateCount: profileSelection.invalidProfileCandidateCount,
      freshProfileCandidateCount: profileSelection.freshProfileCandidateCount,
      selectedProfileAgeHours,
      selectedProfileCoverage: selectedProfile === null
        ? null
        : { ...selectedProfile.coverage },
      codexLifetimeCoverage:
        selectedProfile !== null && Object.hasOwn(selectedProfile, 'lifetimeTotalTokens')
          ? 'provider-reported'
          : 'unavailable',
      dateBasis: {
        claude: claudeCoverage.dateBasis,
        codex: codexCoverage.dateBasis,
        profileDatesPreserved: selectedProfile !== null,
      },
      breakdownCoverage: {
        claude: {
          tokens: claudeAggregate.dayRecordCount === 0 ? 'none' : 'complete',
          sessions: sessionCoverage(claudeAggregate),
        },
        codex: selectedProfile === null
          ? {
              tokens: localCodexAggregate.dayRecordCount === 0 ? 'none' : 'complete',
              sessions: sessionCoverage(localCodexAggregate),
            }
          : {
              tokens: selectedProfile.daily.length === 0 ? 'none' : 'unavailable',
              sessions: selectedProfile.daily.length === 0 ? 'none' : 'unavailable',
            },
        combinedTokenMix: combinedTokenMixCoverage(
          claudeAggregate,
          localCodexAggregate,
          selectedProfile,
        ),
      },
    },
  };

  if (selectedProfile !== null && Object.hasOwn(selectedProfile, 'lifetimeTotalTokens')) {
    result.codexLifetimeTotalTokens = selectedProfile.lifetimeTotalTokens;
  }

  return result;
}
