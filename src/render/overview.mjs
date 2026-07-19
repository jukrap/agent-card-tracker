import {
  badge,
  cardDocument,
  comparisonText,
  coverageLabel,
  escapeXml,
  formatCompactNumber,
  metricText,
  proportionalWidths,
} from './svg.mjs';

const PERIODS = Object.freeze([
  ['today', 'Today'],
  ['rolling7', 'Rolling 7 days'],
  ['rolling30', 'Rolling 30 days'],
  ['monthToDate', 'Month to date'],
]);

function periodBox(statistics, key, label, x, y) {
  const period = statistics.periods[key];
  const metric = period.current.totalTokens;
  return [
    `<rect class="surface" x="${x}" y="${y}" width="218" height="62" rx="7"/>`,
    `<text class="label" x="${x + 12}" y="${y + 17}">${label}</text>`,
    `<text class="value" x="${x + 12}" y="${y + 43}">${escapeXml(metricText(metric))}</text>`,
    badge(x + 158, y + 8, metric.coverage),
    `<text class="meta" x="${x + 12}" y="${y + 56}">${escapeXml(comparisonText(period.comparison))}</text>`,
  ].join('\n');
}

function sourceShare(statistics) {
  const share = statistics.sourceShare;
  const claudePercentage = share.sources.claude.percentage;
  const codexPercentage = share.sources.codex.percentage;
  if (claudePercentage === null || codexPercentage === null) {
    const message = share.totalTokens.coverage === 'complete' && share.totalTokens.value === 0
      ? 'No tokens observed'
      : share.totalTokens.coverage === 'partial'
        ? 'Partial total · source share unavailable'
        : share.totalTokens.coverage === 'mixed'
          ? 'Mixed calendars · source share unavailable'
        : 'Source share unavailable';
    return [
      '<rect class="surface" x="24" y="314" width="452" height="12" rx="6"/>',
      `<text class="meta" x="24" y="341">${message}</text>`,
    ].join('\n');
  }
  const widths = proportionalWidths([claudePercentage, codexPercentage], 452);
  const prefix = share.totalTokens.coverage === 'mixed' ? '≈' : '';
  return [
    `<rect class="source-claude" x="24" y="314" width="${widths[0]}" height="12" rx="6"/>`,
    `<rect class="source-codex" x="${24 + widths[0]}" y="314" width="${widths[1]}" height="12" rx="6"/>`,
    `<text class="meta" x="24" y="341">Claude ${prefix}${Math.round(claudePercentage)}%</text>`,
    `<text class="meta" x="476" y="341" text-anchor="end">Codex ${prefix}${Math.round(codexPercentage)}%</text>`,
  ].join('\n');
}

function tokenMix(statistics) {
  const mix = statistics.tokenMix;
  const values = [mix.input, mix.output, mix.cacheRead, mix.cacheWrite, mix.unknownTokens];
  const classes = ['mix-input', 'mix-output', 'mix-cache-read', 'mix-cache-write', 'mix-unknown'];
  const widths = proportionalWidths(values, 452);
  const formatMixValue = (value) => {
    const formatted = formatCompactNumber(value);
    return mix.coverage === 'mixed' ? `≈${formatted}` : formatted;
  };
  let x = 24;
  const segments = widths.map((width, index) => {
    const segment = width === 0
      ? ''
      : `<rect class="${classes[index]}" x="${x}" y="370" width="${width}" height="10"/>`;
    x += width;
    return segment;
  }).filter(Boolean);
  return [
    ...segments,
    `<text class="meta" x="24" y="401">Input ${escapeXml(formatMixValue(mix.input))}</text>`,
    `<text class="meta" x="112" y="401">Output ${escapeXml(formatMixValue(mix.output))}</text>`,
    `<text class="meta" x="205" y="401">Cache ${escapeXml(formatMixValue(mix.cacheRead + mix.cacheWrite))}</text>`,
    `<text class="meta" x="476" y="401" text-anchor="end">Unknown mix ${escapeXml(formatMixValue(mix.unknownTokens))}</text>`,
  ].join('\n');
}

export function renderOverview(statistics, {
  codexSource = 'devices',
  staleDeviceCount = 0,
} = {}) {
  const lifetime = statistics.lifetime.totalTokens;
  const empty = lifetime.value === null
    && PERIODS.every(([key]) => statistics.periods[key].current.totalTokens.value === null);
  const staleLabel = staleDeviceCount === 1 ? '1 stale source' : `${staleDeviceCount} stale sources`;
  const sourceLabel = codexSource === 'profile' ? 'Profile total' : 'Device totals';
  const body = [
    '<text class="heading" x="24" y="31">AI usage overview</text>',
    `<text class="subheading" x="24" y="51">As of ${escapeXml(statistics.asOf)} · ${escapeXml(statistics.timezone)}</text>`,
    `<text class="meta" x="476" y="32" text-anchor="end">${sourceLabel}</text>`,
    ...(staleDeviceCount > 0
      ? [`<text class="meta" x="476" y="50" text-anchor="end">${escapeXml(staleLabel)}</text>`]
      : []),
    periodBox(statistics, 'today', 'Today', 24, 70),
    periodBox(statistics, 'rolling7', 'Rolling 7 days', 258, 70),
    periodBox(statistics, 'rolling30', 'Rolling 30 days', 24, 143),
    periodBox(statistics, 'monthToDate', 'Month to date', 258, 143),
    '<rect class="surface" x="24" y="216" width="452" height="70" rx="7"/>',
    '<text class="label" x="36" y="235">Lifetime</text>',
    `<text class="value" x="36" y="265">${escapeXml(metricText(lifetime))}</text>`,
    badge(416, 226, lifetime.coverage),
    `<text class="meta" x="476" y="272" text-anchor="end">Sessions ${escapeXml(metricText(statistics.lifetime.sessions))}</text>`,
    ...(empty ? ['<text class="small-value" x="250" y="205" text-anchor="middle">No observed usage yet</text>'] : []),
    '<text class="label" x="24" y="305">Source share · rolling 30 days</text>',
    sourceShare(statistics),
    `<text class="label" x="24" y="361">Token mix · ${escapeXml(coverageLabel(statistics.tokenMix.coverage))}</text>`,
    tokenMix(statistics),
  ].join('\n');

  return cardDocument({
    id: 'usage-overview',
    width: 500,
    height: 420,
    title: 'AI usage overview',
    description: `Usage totals and token mix as of ${statistics.asOf}. Unknown and partial observations are marked explicitly. Mixed calendar observations use ≈ and do not claim configured-timezone alignment.`,
    body,
  });
}
