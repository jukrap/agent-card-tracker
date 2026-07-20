import {
  cardDocument,
  coverageLabel,
  escapeXml,
  metricText,
} from './svg.mjs';

const WEEKDAY_LABELS = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
const STAT_X = Object.freeze([16, 112, 208, 304]);

function metricBlock(label, metric, x, detail = '') {
  const status = metric.coverage === 'complete' ? detail : coverageLabel(metric.coverage);
  return [
    `<text class="label" x="${x}" y="145">${escapeXml(label)}</text>`,
    `<text class="value" x="${x}" y="166">${escapeXml(metricText(metric))}</text>`,
    ...(status
      ? [`<text class="meta" x="${x}" y="180">${escapeXml(status)}</text>`]
      : []),
  ].join('\n');
}

export function renderActivity(statistics) {
  if (!Array.isArray(statistics.heatmap.cells) || statistics.heatmap.cells.length !== 371) {
    throw new TypeError('activity heatmap must contain exactly 371 cells');
  }

  const cellSize = 5;
  const gap = 2;
  const originX = 31;
  const originY = 55;
  const cells = statistics.heatmap.cells.map((cell, index) => {
    const week = Math.floor(index / 7);
    const weekday = index % 7;
    const x = originX + week * (cellSize + gap);
    const y = originY + weekday * (cellSize + gap);
    const state = ['active', 'zero', 'unknown', 'future'].includes(cell.state)
      ? cell.state
      : 'unknown';
    const level = Number.isInteger(cell.level) && cell.level >= 0 && cell.level <= 4
      ? cell.level
      : 0;
    const coverage = ['complete', 'partial', 'mixed'].includes(cell.coverage)
      ? cell.coverage
      : 'unknown';
    return `<rect class="heat-cell state-${state} level-${level} coverage-${coverage}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="1"/>`;
  });
  const weekdayLabels = WEEKDAY_LABELS.map((label, index) => (
    `<text class="meta" x="25" y="${originY + index * (cellSize + gap) + 5}" text-anchor="end">${label}</text>`
  ));
  const empty = statistics.heatmap.cells.every((cell) => cell.state !== 'active');
  const hasMixedCalendars = statistics.heatmap.cells.some((cell) => cell.coverage === 'mixed')
    || [
      statistics.activity.activeDays,
      statistics.activity.currentStreak,
      statistics.activity.longestStreak,
    ].some((metric) => metric.coverage === 'mixed')
    || statistics.activity.peak.coverage === 'mixed';
  const peakMetric = {
    value: statistics.activity.peak.totalTokens,
    coverage: statistics.activity.peak.coverage,
    lowerBound: statistics.activity.peak.lowerBound,
  };
  const peakDate = statistics.activity.peak.date === null
    ? ''
    : statistics.activity.peak.date.slice(5);

  const body = [
    '<text class="heading" x="16" y="27">AI activity</text>',
    `<text class="subheading" x="16" y="43">53 weeks · through ${escapeXml(statistics.asOf)}${empty ? ' · No observed usage yet' : hasMixedCalendars ? ' · ≈ mixed calendars' : ' · Monday start'}</text>`,
    ...weekdayLabels,
    ...cells,
    `<text class="meta" x="31" y="117">${escapeXml(statistics.heatmap.startDate)}</text>`,
    `<text class="meta" x="400" y="117" text-anchor="end">${escapeXml(statistics.heatmap.endDate)}</text>`,
    '<line class="divider" x1="16" y1="127" x2="400" y2="127"/>',
    metricBlock('Active days', statistics.activity.activeDays, STAT_X[0]),
    metricBlock('Current streak', statistics.activity.currentStreak, STAT_X[1]),
    metricBlock('Longest streak', statistics.activity.longestStreak, STAT_X[2]),
    metricBlock('Peak', peakMetric, STAT_X[3], peakDate),
  ].join('\n');

  return cardDocument({
    id: 'usage-activity',
    width: 416,
    height: 190,
    title: 'AI usage activity',
    description: `A 53 by 7 activity heatmap with active days, current and longest streaks, and peak usage through ${statistics.asOf}. Unknown days are outlined; partial and mixed observations use dashed borders and text markers.`,
    body,
  });
}
