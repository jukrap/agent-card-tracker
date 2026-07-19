const DAY_MILLISECONDS = 86_400_000;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const OFFSET_TIMEZONE_PATTERN = /^[+-]\d{2}:\d{2}$/u;
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

function dateParts(value) {
  if (typeof value !== 'string') {
    throw new TypeError('date must be a string');
  }

  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new RangeError('date must use YYYY-MM-DD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) {
    throw new RangeError('date is outside the supported Gregorian range');
  }

  // setUTCFullYear avoids Date.UTC's special 1900 offset for years 0 through 99.
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    throw new RangeError('date is not a real Gregorian calendar day');
  }

  return { year, month, day, epochDay: candidate.valueOf() / DAY_MILLISECONDS };
}

function formatDate(year, month, day) {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return assertIsoDate(value);
}

function dateFromEpochDay(epochDay) {
  if (!Number.isSafeInteger(epochDay)) {
    throw new RangeError('epoch day must be a safe integer');
  }

  const candidate = new Date(epochDay * DAY_MILLISECONDS);
  if (Number.isNaN(candidate.valueOf())) {
    throw new RangeError('epoch day is outside the supported Date range');
  }

  const year = candidate.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError('date is outside the supported Gregorian range');
  }
  return formatDate(year, candidate.getUTCMonth() + 1, candidate.getUTCDate());
}

function assertIntegerAmount(amount, name) {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
  return amount;
}

function range(start, end) {
  return { start, end };
}

export function assertIsoDate(value) {
  dateParts(value);
  return value;
}

export function assertTimeZone(timeZone) {
  if (typeof timeZone !== 'string') {
    throw new TypeError('timeZone must be a string');
  }
  if (
    timeZone.length === 0
    || timeZone === 'local'
    || OFFSET_TIMEZONE_PATTERN.test(timeZone)
  ) {
    throw new RangeError('timeZone must be a named IANA timezone');
  }

  try {
    new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone }).format(0);
  } catch {
    throw new RangeError('timeZone must be a valid IANA timezone');
  }
  return timeZone;
}

export function dateAtInstant(epochMs, timeZone) {
  if (typeof epochMs !== 'number') {
    throw new TypeError('epochMs must be a number');
  }
  if (!Number.isFinite(epochMs)) {
    throw new RangeError('epochMs must be finite');
  }
  assertTimeZone(timeZone);

  const instant = new Date(epochMs);
  if (Number.isNaN(instant.valueOf())) {
    throw new RangeError('epochMs is outside the supported Date range');
  }

  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return formatDate(Number(values.year), Number(values.month), Number(values.day));
}

export function addDays(date, amount) {
  const { epochDay } = dateParts(date);
  assertIntegerAmount(amount, 'amount');
  const result = epochDay + amount;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('resulting date is outside the supported range');
  }
  return dateFromEpochDay(result);
}

export function daysBetween(start, end) {
  return dateParts(end).epochDay - dateParts(start).epochDay;
}

export function eachDay(start, end) {
  const startEpochDay = dateParts(start).epochDay;
  const endEpochDay = dateParts(end).epochDay;
  if (endEpochDay < startEpochDay) {
    throw new RangeError('end must not precede start');
  }

  return Array.from(
    { length: endEpochDay - startEpochDay + 1 },
    (_, offset) => dateFromEpochDay(startEpochDay + offset),
  );
}

export function mondayOf(date) {
  const { epochDay } = dateParts(date);
  const weekday = new Date(epochDay * DAY_MILLISECONDS).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return dateFromEpochDay(epochDay - daysSinceMonday);
}

export function monthStart(date) {
  const { year, month } = dateParts(date);
  return formatDate(year, month, 1);
}

export function shiftMonthStart(date, amount) {
  const { year, month } = dateParts(date);
  assertIntegerAmount(amount, 'amount');

  const currentMonthIndex = (year - 1) * 12 + month - 1;
  const shiftedMonthIndex = currentMonthIndex + amount;
  const maximumMonthIndex = (MAX_YEAR - MIN_YEAR + 1) * 12 - 1;
  if (
    !Number.isSafeInteger(shiftedMonthIndex)
    || shiftedMonthIndex < 0
    || shiftedMonthIndex > maximumMonthIndex
  ) {
    throw new RangeError('resulting month is outside the supported Gregorian range');
  }

  const shiftedYear = Math.floor(shiftedMonthIndex / 12) + 1;
  const shiftedMonth = (shiftedMonthIndex % 12) + 1;
  return formatDate(shiftedYear, shiftedMonth, 1);
}

export function daysInMonth(date) {
  const { year, month } = dateParts(date);
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function periodRanges(asOf) {
  const { day } = dateParts(asOf);
  const currentMonthStart = monthStart(asOf);
  const previousMonthStart = shiftMonthStart(currentMonthStart, -1);
  const matchingPreviousDay = Math.min(day, daysInMonth(previousMonthStart));

  return {
    today: {
      current: range(asOf, asOf),
      previous: range(addDays(asOf, -1), addDays(asOf, -1)),
    },
    rolling7: {
      current: range(addDays(asOf, -6), asOf),
      previous: range(addDays(asOf, -13), addDays(asOf, -7)),
    },
    rolling30: {
      current: range(addDays(asOf, -29), asOf),
      previous: range(addDays(asOf, -59), addDays(asOf, -30)),
    },
    monthToDate: {
      current: range(currentMonthStart, asOf),
      previous: range(
        previousMonthStart,
        addDays(previousMonthStart, matchingPreviousDay - 1),
      ),
    },
  };
}

export function trendBuckets(asOf) {
  assertIsoDate(asOf);
  const currentWeekStart = mondayOf(asOf);
  const currentMonthStart = monthStart(asOf);

  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = addDays(asOf, index - 29);
    return range(date, date);
  });

  const weekly = Array.from({ length: 12 }, (_, index) => {
    const start = addDays(currentWeekStart, (index - 11) * 7);
    return range(start, index === 11 ? asOf : addDays(start, 6));
  });

  const monthly = Array.from({ length: 12 }, (_, index) => {
    const start = shiftMonthStart(currentMonthStart, index - 11);
    const end = index === 11
      ? asOf
      : addDays(shiftMonthStart(start, 1), -1);
    return range(start, end);
  });

  return { daily, weekly, monthly };
}

export function heatmapRange(asOf) {
  assertIsoDate(asOf);
  const currentWeekStart = mondayOf(asOf);
  const start = addDays(currentWeekStart, -(52 * 7));
  const end = addDays(currentWeekStart, 6);
  return { start, end, dates: eachDay(start, end) };
}
