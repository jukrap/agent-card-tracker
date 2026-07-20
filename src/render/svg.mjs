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
:root{--bg:#ffffff;--surface:#f6f8fa;--border:#d0d7de;--text:#1f2328;--muted:#57606a;--accent:#0969da;--accent-soft:#ddf4ff;--claude:#9a6700;--codex:#0969da;--mixed:#8250df;--unknown:#57606a;--zero:#eaeef2;--on-accent:#ffffff;--on-partial:#ffffff;--on-mixed:#ffffff;--on-unknown:#ffffff;--heat-1:#b6e3ff;--heat-2:#54aeff;--heat-3:#218bff;--heat-4:#0969da}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8c959f;--accent:#58a6ff;--accent-soft:#1f3b57;--claude:#d29922;--codex:#58a6ff;--mixed:#bc8cff;--unknown:#8c959f;--zero:#21262d;--on-accent:#0d1117;--on-partial:#0d1117;--on-mixed:#0d1117;--on-unknown:#0d1117;--heat-1:#0e4429;--heat-2:#006d32;--heat-3:#26a641;--heat-4:#39d353}}
.card-bg{fill:var(--bg);stroke:var(--border);stroke-width:1}
.heading{fill:var(--text);font-family:system-ui,sans-serif;font-size:14px;font-weight:600}
.subheading{fill:var(--muted);font-family:system-ui,sans-serif;font-size:9px}
.label{fill:var(--muted);font-family:system-ui,sans-serif;font-size:9px;font-weight:600}
.value{fill:var(--text);font-family:system-ui,sans-serif;font-size:17px;font-weight:600}
.small-value{fill:var(--text);font-family:system-ui,sans-serif;font-size:11px;font-weight:600}
.meta{fill:var(--muted);font-family:system-ui,sans-serif;font-size:8px}
.divider{stroke:var(--border);stroke-width:1}
.bar-track{fill:var(--surface);stroke:var(--border);stroke-width:1}
.source-claude{fill:var(--claude)}
.source-codex{fill:var(--codex)}
.mix-input{fill:#1a7f37}
.mix-output{fill:#cf222e}
.mix-cache-read{fill:#bf8700}
.mix-cache-write{fill:#8250df}
.mix-unknown{fill:var(--unknown)}
.trend-bar{fill:var(--accent)}
.state-zero{fill:var(--zero)}
.state-partial{fill:var(--accent);stroke:var(--claude);stroke-width:1;stroke-dasharray:2 2}
.state-mixed{fill:var(--accent);stroke:var(--mixed);stroke-width:1;stroke-dasharray:4 2}
.state-unknown{fill:none;stroke:var(--unknown);stroke-width:1;stroke-dasharray:2 2}
.state-future{fill:none;stroke:var(--border);stroke-width:1}
.heat-cell{stroke:var(--border);stroke-width:0.5}
.level-1{fill:var(--heat-1)}
.level-2{fill:var(--heat-2)}
.level-3{fill:var(--heat-3)}
.level-4{fill:var(--heat-4)}
.coverage-partial{stroke:var(--claude);stroke-width:1;stroke-dasharray:1 1}
.coverage-mixed{stroke:var(--mixed);stroke-width:1;stroke-dasharray:3 1}
.coverage-unknown{fill:none;stroke:var(--unknown);stroke-width:1;stroke-dasharray:2 2}
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

export function comparisonText(comparison) {
  if (comparison?.kind === 'mixed') {
    return '≈ no comparison';
  }
  if (comparison?.kind === 'flat') {
    return 'No change';
  }
  if (comparison?.kind === 'new') {
    return 'New vs prior';
  }
  if (comparison?.kind === 'percent' && Number.isFinite(comparison.percentage)) {
    const rounded = Math.round(comparison.percentage * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${trimFixed(rounded.toFixed(1))}% vs prior`;
  }
  return '— comparison';
}

export function proportionalWidths(values, totalWidth) {
  if (!Array.isArray(values)
    || values.some((value) => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(totalWidth)
    || totalWidth < 0) {
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descriptionId}">`,
    `<title id="${titleId}">${escapeXml(title)}</title>`,
    `<desc id="${descriptionId}">${escapeXml(description)}</desc>`,
    `<style>${CARD_STYLE}</style>`,
    `<rect class="card-bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6"/>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
