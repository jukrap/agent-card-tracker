import { CARD_THEMES } from './themes.mjs';

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

const CSS_THEME_KEYS = Object.freeze([
  ['bg', '--bg'], ['surface', '--surface'], ['border', '--border'],
  ['text', '--text'], ['muted', '--muted'], ['accent', '--accent'],
  ['accentStrong', '--accent-strong'], ['accentSoft', '--accent-soft'],
  ['common', '--common'], ['uncommon', '--uncommon'], ['rare', '--rare'],
  ['epic', '--epic'], ['legendary', '--legendary'], ['onRarity', '--on-rarity'],
  ['zero', '--zero'], ['unknown', '--unknown'], ['heat1', '--heat-1'],
  ['heat2', '--heat-2'], ['heat3', '--heat-3'], ['heat4', '--heat-4'],
]);

const BASE_CARD_STYLE = `
.card-bg{fill:var(--bg);stroke:var(--border);stroke-width:1}
.heading{fill:var(--text);font-family:system-ui,sans-serif;font-size:14px;font-weight:700}
.subheading{fill:var(--muted);font-family:system-ui,sans-serif;font-size:9px}
.label{fill:var(--muted);font-family:system-ui,sans-serif;font-size:9px;font-weight:700;letter-spacing:.3px}
.value{fill:var(--text);font-family:system-ui,sans-serif;font-size:17px;font-weight:700}
.small-value{fill:var(--text);font-family:system-ui,sans-serif;font-size:11px;font-weight:700}
.hero{fill:var(--text);font-family:system-ui,sans-serif;font-size:38px;font-weight:800;letter-spacing:-1.2px}
.rank-title{fill:var(--text);font-family:system-ui,sans-serif;font-size:22px;font-weight:800;letter-spacing:.4px}
.rank-roman{fill:var(--on-rarity);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:22px;font-weight:800}
.rarity-label{fill:var(--on-rarity);font-family:system-ui,sans-serif;font-size:8px;font-weight:700}
.exact{fill:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:9px}
.meta{fill:var(--muted);font-family:system-ui,sans-serif;font-size:8px}
.divider{stroke:var(--border);stroke-width:1}
.panel{fill:var(--surface);stroke:var(--border);stroke-width:1}
.progress-track{fill:var(--surface);stroke:var(--border);stroke-width:1}
.progress-fill{fill:var(--accent)}
.trend-bar{fill:var(--accent)}
.state-zero{fill:var(--zero)}
.state-partial{fill:var(--accent);stroke:var(--legendary);stroke-width:1;stroke-dasharray:2 2}
.state-unknown{fill:none;stroke:var(--unknown);stroke-width:1;stroke-dasharray:2 2}
.state-future{fill:none;stroke:var(--border);stroke-width:1}
.heat-cell{stroke:var(--border);stroke-width:.5}
.level-1{fill:var(--heat-1)}
.level-2{fill:var(--heat-2)}
.level-3{fill:var(--heat-3)}
.level-4{fill:var(--heat-4)}
.coverage-partial{stroke:var(--legendary);stroke-width:1;stroke-dasharray:1 1}
.coverage-unknown{fill:none;stroke:var(--unknown);stroke-width:1;stroke-dasharray:2 2}
.rarity-common{fill:var(--common)}
.rarity-uncommon{fill:var(--uncommon)}
.rarity-rare{fill:var(--rare)}
.rarity-epic{fill:var(--epic)}
.rarity-legendary{fill:var(--legendary)}
.rank-node{fill:var(--surface);stroke:var(--border);stroke-width:1}
.rank-node-unlocked{fill:var(--accent);stroke:var(--accent);stroke-width:1}
.rank-node-current{fill:var(--bg);stroke:var(--epic);stroke-width:2}
.seal-unlocked{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1}
.seal-locked{fill:none;stroke:var(--border);stroke-width:1}
.seal-unknown{fill:none;stroke:var(--unknown);stroke-width:1;stroke-dasharray:2 2}
.crest-rarity-common{--rarity:var(--common)}
.crest-rarity-uncommon{--rarity:var(--uncommon)}
.crest-rarity-rare{--rarity:var(--rare)}
.crest-rarity-epic{--rarity:var(--epic)}
.crest-rarity-legendary{--rarity:var(--legendary)}
.crest-frame{fill:var(--surface);stroke:var(--rarity);stroke-width:2;stroke-linejoin:round}
.crest-pip{fill:var(--rarity);stroke:var(--bg);stroke-width:1}
.glyph-line{fill:none;stroke:var(--rarity);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.glyph-fill{fill:var(--rarity)}
.glyph-cut{fill:var(--surface)}
.glyph-faint{opacity:.6}
.icon-line{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.icon-fill{fill:var(--accent)}
.prestige-corner{fill:none;stroke:var(--border);stroke-width:1;stroke-linecap:round;stroke-linejoin:round}
`.trim();

function themeDeclarations(tokens) {
  return CSS_THEME_KEYS.map(([key, variable]) => `${variable}:${tokens[key]}`).join(';');
}

export function cardStyle(themeName = 'github') {
  if (typeof themeName !== 'string' || !Object.hasOwn(CARD_THEMES, themeName)) {
    throw new TypeError('card theme is unknown');
  }
  const theme = CARD_THEMES[themeName];
  return [
    `:root{${themeDeclarations(theme.light)}}`,
    `@media (prefers-color-scheme: dark){:root{${themeDeclarations(theme.dark)}}}`,
    BASE_CARD_STYLE,
  ].join('\n');
}

export const CARD_STYLE = cardStyle();

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

export function formatExactNumber(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('value must be a non-negative safe integer');
  }
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatExpandedNumber(value) {
  if (value === null || value === undefined) {
    return 'unknown';
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('value must be a non-negative safe integer');
  }
  const units = [
    { threshold: 1_000_000_000_000, name: 'trillion' },
    { threshold: 1_000_000_000, name: 'billion' },
    { threshold: 1_000_000, name: 'million' },
    { threshold: 1_000, name: 'thousand' },
  ];
  const unit = units.find(({ threshold }) => value >= threshold);
  if (unit === undefined) {
    return String(value);
  }
  const scaled = value / unit.threshold;
  const precision = scaled < 100 ? 1 : 0;
  return `${trimFixed(scaled.toFixed(precision))} ${unit.name}`;
}

export function metricText(metric) {
  if (metric?.value === null || metric?.value === undefined) {
    return '—';
  }
  const formatted = formatCompactNumber(metric.value);
  return metric.coverage === 'partial' ? `≥${formatted}` : formatted;
}

export function coverageLabel(coverage) {
  if (coverage === 'partial') {
    return 'Partial';
  }
  if (coverage === 'unknown') {
    return 'Unknown';
  }
  return '';
}

export function comparisonText(comparison) {
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
  theme = 'github',
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
    `<style>${cardStyle(theme)}</style>`,
    `<rect class="card-bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6"/>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
