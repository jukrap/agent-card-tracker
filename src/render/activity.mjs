import {
  badge,
  cardDocument,
  escapeXml,
  formatCompactNumber,
  metricText,
} from './svg.mjs';

const WEEKDAY_LABELS = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S']);

function statBlock(label, metric, x) {
  return [
    `<text class="label" x="${x}" y="205">${label}</text>`,
    `<text class="value" x="${x}" y="232">${escapeXml(metricText(metric))}</text>`,
    badge(x, 241, metric.coverage),
  ].join('\n');
}
function peakBlock(peak) {
  const metric = {
    value: peak.totalTokens,
    coverage: peak.coverage,
    lowerBound: peak.lowerBound,
  };
  return [
    '<text class="label" x="24" y="292">Peak day</text>',
    `<text class="small-value" x="24" y="315">${escapeXml(peak.date ?? 'Unknown date')}</text>`,
    `<text class="value" x="476" y="315" text-anchor="end">${escapeXml(metricText(metric))}</text>`,
  ].join('\n');
}

export function renderActivity(statistics) {
  if (!Array.isArray(statistics.heatmap.cells) || statistics.heatmap.cells.length !== 371) {
    throw new TypeError('activity heatmap must contain exactly 371 cells');
  }
  const cellSize = 6;
  const gap = 2;
  const originX = 54;
  const originY = 78;
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
    const coverage = cell.coverage === 'partial' ? 'partial' : cell.coverage === 'complete' ? 'complete' : 'unknown';
    return `<rect class="heat-cell state-${state} level-${level} coverage-${coverage}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="1"/>`;
  });
  const weekdayLabels = WEEKDAY_LABELS.map((label, index) => (
    `<text class="meta" x="43" y="${originY + index * (cellSize + gap) + 6}" text-anchor="end">${label}</text>`
  ));
  const empty = statistics.heatmap.cells.every((cell) => cell.state !== 'active');
  const body = [
    '<text class="heading" x="24" y="31">AI activity</text>',
    `<text class="subheading" x="24" y="51">53 weeks · Monday start · through ${escapeXml(statistics.asOf)}</text>`,
    ...weekdayLabels,
    ...cells,
    `<text class="meta" x="54" y="151">${escapeXml(statistics.heatmap.startDate)}</text>`,
    `<text class="meta" x="476" y="151" text-anchor="end">${escapeXml(statistics.heatmap.endDate)}</text>`,
    ...(empty ? ['<text class="small-value" x="250" y="177" text-anchor="middle">No observed usage yet</text>'] : []),
    statBlock('Active days', statistics.activity.activeDays, 24),
    statBlock('Current streak', statistics.activity.currentStreak, 184),
    statBlock('Longest streak', statistics.activity.longestStreak, 344),
    '<line class="axis" x1="24" y1="276" x2="476" y2="276"/>',
    peakBlock(statistics.activity.peak),
    `<text class="meta" x="476" y="333" text-anchor="end">Quantiles ${statistics.heatmap.thresholds.map(formatCompactNumber).join(' · ') || 'unavailable'}</text>`,
  ].join('\n');

  return cardDocument({
    id: 'usage-activity',
    width: 500,
    height: 340,
    title: 'AI usage activity',
    description: `A 53-week activity heatmap with streak and peak statistics through ${statistics.asOf}. Empty, unknown, and future days are distinct.`,
    body,
  });
}
