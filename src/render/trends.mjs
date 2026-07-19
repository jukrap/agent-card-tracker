import {
  cardDocument,
  escapeXml,
  formatCompactNumber,
} from './svg.mjs';

function metricState(metric) {
  if (metric?.value === null || metric?.value === undefined) {
    return 'unknown';
  }
  if (metric.coverage === 'partial') {
    return 'partial';
  }
  return metric.value === 0 ? 'zero' : 'active';
}
function chart(statistics, name, label, y) {
  const buckets = statistics.trends[name];
  const knownValues = buckets
    .map((bucket) => bucket.totalTokens.value)
    .filter((value) => value !== null);
  const maximum = Math.max(0, ...knownValues);
  const plotX = 25;
  const plotWidth = 450;
  const plotHeight = 54;
  const baseline = y + 72;
  const slot = plotWidth / buckets.length;
  const barWidth = Math.max(2, Math.floor(slot - 2));
  const bars = buckets.map((bucket, index) => {
    const metric = bucket.totalTokens;
    const state = metricState(metric);
    const height = state === 'unknown'
      ? 8
      : metric.value === 0 || maximum === 0
        ? 1
        : Math.max(2, Math.round((metric.value / maximum) * plotHeight));
    const x = Math.round((plotX + index * slot) * 100) / 100;
    return `<rect class="trend-bar state-${state}" x="${x}" y="${baseline - height}" width="${barWidth}" height="${height}" rx="1"/>`;
  });
  return [
    `<text class="label" x="24" y="${y + 12}">${escapeXml(label)}</text>`,
    `<text class="meta" x="476" y="${y + 12}" text-anchor="end">Peak ${escapeXml(formatCompactNumber(maximum))}</text>`,
    `<line class="axis" x1="24" y1="${baseline}" x2="476" y2="${baseline}"/>`,
    ...bars,
    `<text class="meta" x="24" y="${baseline + 15}">${escapeXml(buckets[0]?.range.startDate ?? '—')}</text>`,
    `<text class="meta" x="476" y="${baseline + 15}" text-anchor="end">${escapeXml(buckets.at(-1)?.range.endDate ?? '—')}</text>`,
  ].join('\n');
}

export function renderTrends(statistics) {
  const allBuckets = [
    ...statistics.trends.daily,
    ...statistics.trends.weekly,
    ...statistics.trends.monthly,
  ];
  const empty = allBuckets.every((bucket) => bucket.totalTokens.value === null);
  const body = [
    '<text class="heading" x="24" y="31">Usage trends</text>',
    `<text class="subheading" x="24" y="51">As of ${escapeXml(statistics.asOf)} · observed values only</text>`,
    chart(statistics, 'daily', 'Daily · 30 days', 68),
    chart(statistics, 'weekly', 'Weekly · 12 Monday-based weeks', 194),
    chart(statistics, 'monthly', 'Monthly · 12 months', 320),
    ...(empty ? ['<text class="small-value" x="250" y="225" text-anchor="middle">No observed usage yet</text>'] : []),
  ].join('\n');

  return cardDocument({
    id: 'usage-trends',
    width: 500,
    height: 460,
    title: 'AI usage trends',
    description: `Daily, weekly, and monthly token trends as of ${statistics.asOf}. Dashed bars indicate partial or unknown observations.`,
    body,
  });
}
