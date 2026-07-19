const XML_REPLACEMENTS = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
});

const NUMBER_UNITS = Object.freeze([
  { threshold: 1_000_000_000_000_000, suffix: 'Q' },
  { threshold: 1_000_000_000_000, suffix: 'T' },
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
]);

export const CARD_STYLE = `
:root{--bg:#ffffff;--surface:#f6f8fa;--border:#d0d7de;--text:#1f2328;--muted:#59636e;--accent:#8250df;--accent-soft:#d8c7ff;--claude:#d97706;--codex:#2563eb;--mixed:#0969da;--unknown:#57606a;--zero:#eaeef2;--on-accent:#ffffff;--on-partial:#1f2328;--on-mixed:#ffffff;--on-unknown:#ffffff;--heat-1:#d8c7ff;--heat-2:#b083f0;--heat-3:#8250df;--heat-4:#5a2ca0}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#a371f7;--accent-soft:#4c2889;--claude:#f59e0b;--codex:#58a6ff;--mixed:#58a6ff;--unknown:#8b949e;--zero:#21262d;--on-accent:#0d1117;--on-partial:#0d1117;--on-mixed:#0d1117;--on-unknown:#0d1117;--heat-1:#2b1d45;--heat-2:#4c2889;--heat-3:#8250df;--heat-4:#a371f7}}
.card-bg{fill:var(--bg);stroke:var(--border);stroke-width:1}
.surface{fill:var(--surface);stroke:var(--border);stroke-width:1}
.heading{fill:var(--text);font-family:sans-serif;font-size:18px;font-weight:700}
.subheading{fill:var(--muted);font-family:sans-serif;font-size:11px}
.label{fill:var(--muted);font-family:sans-serif;font-size:10px;font-weight:600}
.value{fill:var(--text);font-family:sans-serif;font-size:20px;font-weight:700}
.small-value{fill:var(--text);font-family:sans-serif;font-size:12px;font-weight:600}
.meta{fill:var(--muted);font-family:sans-serif;font-size:9px}
.badge-complete{fill:var(--accent)}
.badge-partial{fill:var(--claude)}
.badge-mixed{fill:var(--mixed)}
.badge-unknown{fill:var(--unknown)}
.badge-text{font-family:sans-serif;font-size:8px;font-weight:700}
.badge-text-complete{fill:var(--on-accent)}
.badge-text-partial{fill:var(--on-partial)}
.badge-text-mixed{fill:var(--on-mixed)}
.badge-text-unknown{fill:var(--on-unknown)}
.axis{stroke:var(--border);stroke-width:1}
.source-claude{fill:var(--claude)}
.source-codex{fill:var(--codex)}
.mix-input{fill:#2da44e}
.mix-output{fill:#cf222e}
.mix-cache-read{fill:#bf8700}
.mix-cache-write{fill:#8250df}
.mix-unknown{fill:var(--unknown)}
.trend-bar{fill:var(--accent)}
.state-zero{fill:var(--zero)}
.state-partial{fill:var(--accent);stroke:var(--claude);stroke-width:1;stroke-dasharray:2 2}
.state-mixed{fill:var(--accent);stroke:var(--mixed);stroke-width:1;stroke-dasharray:4 2}
.state-unknown{fill:none;stroke:var(--unknown);stroke-width:1;stroke-dasharray:2 2}
.heat-cell{stroke:var(--border);stroke-width:0.5}
.state-future{fill:none;stroke:var(--border)}
.level-1{fill:var(--heat-1)}
.level-2{fill:var(--heat-2)}
.level-3{fill:var(--heat-3)}
.level-4{fill:var(--heat-4)}
.coverage-partial{stroke:var(--claude);stroke-width:1;stroke-dasharray:1 1}
.coverage-mixed{stroke:var(--mixed);stroke-width:1;stroke-dasharray:3 1}
`.trim();

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => XML_REPLACEMENTS[character]);
}

function trimFixed(value) {
  return value.replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/, '');
}

export function formatCompactNumber(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('value must be a non-negative safe integer');
  }
  if (value < 1_000) {
    return String(value);
  }

  const unit = NUMBER_UNITS.find(({ threshold }) => value >= threshold);
  const scaled = value / unit.threshold;
  const precision = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${trimFixed(scaled.toFixed(precision))}${unit.suffix}`;
}

export function metricText(metric) {
  if (metric?.value === null || metric?.value === undefined) {
    return '—';
  }
  const formatted = formatCompactNumber(metric.value);
  if (metric.coverage === 'partial') {
    return `≥${formatted}`;
  }
  return metric.coverage === 'mixed' ? `≈${formatted}` : formatted;
}

export function coverageLabel(coverage) {
  if (coverage === 'complete') {
    return 'Complete';
  }
  if (coverage === 'partial') {
    return 'Partial';
  }
  if (coverage === 'mixed') {
    return 'Mixed';
  }
  return 'Unknown';
}

export function badge(x, y, coverage) {
  const label = coverageLabel(coverage);
  const width = label === 'Complete' ? 47 : label === 'Partial' ? 38 : label === 'Mixed' ? 36 : 43;
  const safeCoverage = escapeXml(
    ['complete', 'partial', 'mixed'].includes(coverage) ? coverage : 'unknown',
  );
  return `<g><rect class="badge-${safeCoverage}" x="${x}" y="${y}" width="${width}" height="14" rx="7"/><text class="badge-text badge-text-${safeCoverage}" x="${x + width / 2}" y="${y + 10}" text-anchor="middle">${label}</text></g>`;
}

export function comparisonText(comparison) {
  if (comparison?.kind === 'mixed') {
    return 'Mixed calendars · no comparison';
  }
  if (comparison?.kind === 'flat') {
    return 'No change';
  }
  if (comparison?.kind === 'new') {
    return 'New vs prior period';
  }
  if (comparison?.kind === 'percent' && Number.isFinite(comparison.percentage)) {
    const rounded = Math.round(comparison.percentage * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${trimFixed(rounded.toFixed(1))}% vs prior period`;
  }
  return 'Comparison unavailable';
}

export function proportionalWidths(values, totalWidth) {
  if (!Array.isArray(values) || !Number.isFinite(totalWidth) || totalWidth < 0) {
    throw new TypeError('invalid proportional width input');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return values.map(() => 0);
  }
  let used = 0;
  return values.map((value, index) => {
    const width = index === values.length - 1
      ? totalWidth - used
      : Math.max(0, Math.round((value / total) * totalWidth * 100) / 100);
    used += width;
    return width;
  });
}

export function cardDocument({
  id,
  width,
  height,
  title,
  description,
  body,
}) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TypeError('card id must be a fixed lowercase identifier');
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new TypeError('card dimensions must be safe integers');
  }
  const titleId = `${id}-title`;
  const descriptionId = `${id}-desc`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descriptionId}">`,
    `<title id="${titleId}">${escapeXml(title)}</title>`,
    `<desc id="${descriptionId}">${escapeXml(description)}</desc>`,
    `<style>${CARD_STYLE}</style>`,
    `<rect class="card-bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10"/>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
