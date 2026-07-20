import {
  cardDocument,
  comparisonText,
  coverageLabel,
  escapeXml,
  formatCompactNumber,
  metricText,
  proportionalWidths,
} from './svg.mjs';

const METRICS = Object.freeze([
  { label: 'Lifetime', value: (statistics) => statistics.lifetime.totalTokens },
  { label: 'Sessions', value: (statistics) => statistics.lifetime.sessions },
  {
    label: 'Today',
    value: (statistics) => statistics.periods.today.current.totalTokens,
    comparison: (statistics) => statistics.periods.today.comparison,
  },
  {
    label: '7 days',
    value: (statistics) => statistics.periods.rolling7.current.totalTokens,
    comparison: (statistics) => statistics.periods.rolling7.comparison,
  },
  {
    label: '30 days',
    value: (statistics) => statistics.periods.rolling30.current.totalTokens,
    comparison: (statistics) => statistics.periods.rolling30.comparison,
  },
  {
    label: 'MTD',
    value: (statistics) => statistics.periods.monthToDate.current.totalTokens,
    comparison: (statistics) => statistics.periods.monthToDate.comparison,
  },
]);

const METRIC_X = Object.freeze([16, 152, 288, 424, 560, 696]);
const METRIC_DIVIDERS = Object.freeze([140, 276, 412, 548, 684]);

function metricColumn(statistics, definition, x) {
  const metric = definition.value(statistics);
  const meta = metric.coverage === 'complete'
    ? definition.comparison
      ? comparisonText(definition.comparison(statistics))
      : 'Observed total'
    : coverageLabel(metric.coverage);
  return [
    `<text class="label" x="${x}" y="70">${definition.label}</text>`,
    `<text class="value" x="${x}" y="94">${escapeXml(metricText(metric))}</text>`,
    `<text class="meta" x="${x}" y="109">${escapeXml(meta)}</text>`,
  ].join('\n');
}

function sourceShare(statistics) {
  const share = statistics.sourceShare;
  const claudePercentage = share.sources.claude.percentage;
  const codexPercentage = share.sources.codex.percentage;
  const track = '<rect class="bar-track" x="16" y="149" width="397" height="7" rx="3"/>';
  if (claudePercentage === null || codexPercentage === null) {
    const message = share.totalTokens.coverage === 'complete' && share.totalTokens.value === 0
      ? 'No tokens observed'
      : share.totalTokens.coverage === 'partial'
        ? '≥ Partial total · share unavailable'
        : share.totalTokens.coverage === 'mixed'
          ? '≈ Mixed calendars · share unavailable'
          : '— Source share unavailable';
    const state = ['partial', 'mixed'].includes(share.totalTokens.coverage)
      ? share.totalTokens.coverage
      : 'unknown';
    return [
      `<rect class="bar-track state-${state}" x="16" y="149" width="397" height="7" rx="3"/>`,
      `<text class="meta" x="16" y="171">${escapeXml(message)}</text>`,
    ].join('\n');
  }

  const widths = proportionalWidths([claudePercentage, codexPercentage], 397);
  const prefix = share.totalTokens.coverage === 'mixed' ? '≈' : '';
  return [
    track,
    `<rect class="source-claude" x="16" y="149" width="${widths[0]}" height="7" rx="3"/>`,
    `<rect class="source-codex" x="${16 + widths[0]}" y="149" width="${widths[1]}" height="7" rx="3"/>`,
    `<text class="meta" x="16" y="171">Claude ${prefix}${Math.round(claudePercentage)}%</text>`,
    `<text class="meta" x="413" y="171" text-anchor="end">Codex ${prefix}${Math.round(codexPercentage)}%</text>`,
  ].join('\n');
}

function tokenMix(statistics) {
  const mix = statistics.tokenMix;
  const values = [mix.input, mix.output, mix.cacheRead, mix.cacheWrite, mix.unknownTokens];
  const classes = ['mix-input', 'mix-output', 'mix-cache-read', 'mix-cache-write', 'mix-unknown'];
  const widths = proportionalWidths(values, 405);
  const prefix = mix.coverage === 'partial' ? '≥' : mix.coverage === 'mixed' ? '≈' : '';
  let x = 425;
  const segments = widths.map((width, index) => {
    const segment = width === 0
      ? ''
      : `<rect class="${classes[index]}" x="${x}" y="149" width="${width}" height="7"/>`;
    x += width;
    return segment;
  }).filter(Boolean);
  return [
    '<rect class="bar-track" x="425" y="149" width="405" height="7" rx="3"/>',
    ...segments,
    `<text class="meta" x="425" y="171">Input ${prefix}${escapeXml(formatCompactNumber(mix.input))} · Output ${prefix}${escapeXml(formatCompactNumber(mix.output))} · Cache ${prefix}${escapeXml(formatCompactNumber(mix.cacheRead + mix.cacheWrite))}</text>`,
    `<text class="meta" x="830" y="171" text-anchor="end">Unknown ${prefix}${escapeXml(formatCompactNumber(mix.unknownTokens))}</text>`,
  ].join('\n');
}

export function renderOverview(statistics, {
  codexSource = 'devices',
  staleDeviceCount = 0,
} = {}) {
  const empty = statistics.lifetime.totalTokens.value === null
    && METRICS.slice(2).every(({ value }) => value(statistics).value === null);
  const sourceLabel = codexSource === 'profile'
    ? 'Account-wide Codex · device Claude'
    : 'Device totals';
  const staleLabel = staleDeviceCount === 1 ? '1 stale source' : `${staleDeviceCount} stale sources`;
  const tokenMixLabel = statistics.tokenMix.coverage === 'complete'
    ? 'Token mix · 30 days'
    : `Token mix · ${coverageLabel(statistics.tokenMix.coverage)}`;

  const body = [
    '<text class="heading" x="16" y="27">AI usage overview</text>',
    `<text class="subheading" x="16" y="44">As of ${escapeXml(statistics.asOf)} · ${escapeXml(statistics.timezone)}${empty ? ' · No observed usage yet' : ''}</text>`,
    `<text class="label" x="830" y="27" text-anchor="end">${sourceLabel}</text>`,
    ...(staleDeviceCount > 0
      ? [`<text class="meta" x="830" y="44" text-anchor="end">${escapeXml(staleLabel)}</text>`]
      : []),
    '<line class="divider" x1="16" y1="54" x2="830" y2="54"/>',
    ...METRIC_DIVIDERS.map((x) => (
      `<line class="divider" x1="${x}" y1="63" x2="${x}" y2="112"/>`
    )),
    ...METRICS.map((definition, index) => (
      metricColumn(statistics, definition, METRIC_X[index])
    )),
    '<line class="divider" x1="16" y1="121" x2="830" y2="121"/>',
    '<text class="label" x="16" y="140">Source share · 30 days</text>',
    sourceShare(statistics),
    `<text class="label" x="425" y="140">${escapeXml(tokenMixLabel)}</text>`,
    tokenMix(statistics),
    '<line class="divider" x1="16" y1="184" x2="830" y2="184"/>',
    '<text class="meta" x="16" y="198">≥ partial · ≈ mixed calendars · — unknown</text>',
    '<text class="meta" x="830" y="198" text-anchor="end">Tokens are sanitized aggregates</text>',
  ].join('\n');

  return cardDocument({
    id: 'usage-overview',
    width: 846,
    height: 210,
    title: 'AI usage overview',
    description: `Usage totals, source share, and token mix as of ${statistics.asOf}. Partial values use greater-than-or-equal, mixed calendar values use approximately, and unknown values use an em dash.`,
    body,
  });
}
