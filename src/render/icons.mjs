import { ACHIEVEMENT_CATALOG } from '../domain/achievements.mjs';
import { TOKEN_RANKS } from '../domain/rank.mjs';

const RANK_ICON_BODIES = Object.freeze({
  'first-spark': '<polygon class="glyph-fill" points="12,3 14,10 21,12 14,14 12,21 10,14 3,12 10,10"/>',
  'rising-chevron': '<polyline class="glyph-line" points="5,15 12,8 19,15"/><polyline class="glyph-line glyph-faint" points="7,20 12,15 17,20"/>',
  'open-codex': '<path class="glyph-line" d="M3 6H9C11 6 12 8 12 10V20C12 18 10 17 8 17H3ZM21 6H15C13 6 12 8 12 10V20C12 18 14 17 16 17H21Z"/>',
  wayfinder: '<circle class="glyph-line" cx="12" cy="12" r="8"/><polygon class="glyph-fill" points="15,7 13,13 7,17 11,11"/>',
  'signal-pennant': '<path class="glyph-line" d="M6 21V4H18L15 9 18 14H6"/><circle class="glyph-fill" cx="6" cy="4" r="2"/>',
  'expedition-mark': '<path class="glyph-line" d="M8 5C11 6 12 9 11 12L9 18C8 21 4 20 4 17L5 9C5 6 6 5 8 5ZM17 4C19 5 20 8 19 11L17 16C16 19 13 18 13 15L14 8C14 5 15 4 17 4Z"/>',
  'code-helm': '<path class="glyph-line" d="M4 14V10C4 5 8 3 12 3S20 5 20 10V14L17 20H7Z"/><polyline class="glyph-line" points="8,11 11,14 8,17"/><line class="glyph-line" x1="13" y1="17" x2="17" y2="17"/>',
  'veteran-shield': '<path class="glyph-line" d="M12 3L20 6V11C20 16 17 20 12 22 7 20 4 16 4 11V6Z"/><polyline class="glyph-line" points="8,12 11,15 16,9"/>',
  'elite-gem': '<polygon class="glyph-line" points="7,4 17,4 21,10 12,21 3,10"/><polyline class="glyph-line" points="3,10 8,10 12,21 16,10 21,10"/><line class="glyph-line" x1="7" y1="4" x2="8" y2="10"/><line class="glyph-line" x1="17" y1="4" x2="16" y2="10"/>',
  'champion-laurel': '<path class="glyph-line" d="M9 20C4 17 3 10 6 5M15 20C20 17 21 10 18 5"/><path class="glyph-line" d="M7 8 3 7M6 12 2 12M8 16 4 18M17 8 21 7M18 12 22 12M16 16 20 18"/><circle class="glyph-fill" cx="12" cy="9" r="3"/>',
  'hero-star': '<polygon class="glyph-line" points="12,2 15,8 22,9 17,14 18,21 12,18 6,21 7,14 2,9 9,8"/><circle class="glyph-fill" cx="12" cy="12" r="2"/>',
  'crossed-blades': '<path class="glyph-line" d="M5 3 11 10 8 13 3 5ZM19 3 13 10 16 13 21 5ZM8 13 4 19M16 13 20 19"/><line class="glyph-line" x1="3" y1="17" x2="7" y2="21"/><line class="glyph-line" x1="17" y1="21" x2="21" y2="17"/>',
  'overlord-tower': '<path class="glyph-line" d="M5 21H19M7 21V9H17V21M6 9V4H10V7H14V4H18V9ZM10 21V16H14V21"/>',
  'paragon-prism': '<polygon class="glyph-line" points="12,2 21,8 18,20 6,20 3,8"/><polyline class="glyph-line" points="3,8 12,12 21,8M12,2 12,12 18,20M12,12 6,20"/>',
  'mythic-eye': '<path class="glyph-line" d="M2 12C5 7 8 5 12 5S19 7 22 12C19 17 16 19 12 19S5 17 2 12Z"/><circle class="glyph-fill" cx="12" cy="12" r="4"/><circle class="glyph-cut" cx="12" cy="12" r="1.5"/>',
  'winged-star': '<polygon class="glyph-fill" points="12,5 14,10 19,10 15,13 17,18 12,15 7,18 9,13 5,10 10,10"/><path class="glyph-line" d="M8 9 3 5 5 12 2 16 8 15M16 9 21 5 19 12 22 16 16 15"/>',
  'immortal-halo': '<ellipse class="glyph-line" cx="12" cy="6" rx="7" ry="3"/><path class="glyph-line" d="M12 9 18 15 12 22 6 15Z"/><circle class="glyph-fill" cx="12" cy="15" r="2"/>',
  'sovereign-crown': '<path class="glyph-line" d="M3 7 8 12 12 4 16 12 21 7 19 19H5ZM5 16H19"/><circle class="glyph-fill" cx="12" cy="4" r="1.5"/>',
  'eternal-loop': '<path class="glyph-line" d="M12 12C9 7 7 5 4 5 1 5 1 11 4 12 7 13 9 8 12 5 15 2 20 4 21 8 22 12 18 15 15 14 12 13 10 18 7 20 4 22 1 19 2 16"/>',
  'transcendent-sun': '<circle class="glyph-line" cx="12" cy="12" r="5"/><circle class="glyph-fill" cx="12" cy="12" r="2"/><path class="glyph-line" d="M12 1V4M12 20V23M1 12H4M20 12H23M4 4 6 6M18 18 20 20M20 4 18 6M6 18 4 20"/>',
});

export const ACHIEVEMENT_ICONS = Object.freeze({
  'token-stack': '<ellipse class="icon-line" cx="12" cy="6" rx="7" ry="3"/><path class="icon-line" d="M5 6V12C5 14 8 15 12 15S19 14 19 12V6M5 12V18C5 20 8 21 12 21S19 20 19 18V12"/>',
  'mythic-star': '<polygon class="icon-line" points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/><circle class="icon-fill" cx="12" cy="12" r="3"/>',
  crown: '<path class="icon-line" d="M3 7 8 12 12 4 16 12 21 7 19 19H5ZM5 16H19"/>',
  'transcendent-sun': '<circle class="icon-line" cx="12" cy="12" r="5"/><path class="icon-line" d="M12 1V4M12 20V23M1 12H4M20 12H23M4 4 6 6M18 18 20 20M20 4 18 6M6 18 4 20"/>',
  bolt: '<polygon class="icon-fill" points="13,2 4,14 11,14 10,22 20,10 13,10"/>',
  'radiant-token': '<circle class="icon-line" cx="12" cy="12" r="7"/><path class="icon-line" d="M12 1V4M12 20V23M1 12H4M20 12H23"/><path class="icon-line" d="M10 7H14L11 12H15L9 18 11 13H8Z"/>',
  'calendar-shield': '<rect class="icon-line" x="3" y="4" width="18" height="16" rx="2"/><path class="icon-line" d="M3 9H21M7 2V6M17 2V6M12 11 17 13V16C17 18 15 20 12 21 9 20 7 18 7 16V13Z"/>',
  'crowned-calendar': '<rect class="icon-line" x="4" y="7" width="16" height="14" rx="2"/><path class="icon-line" d="M4 11H20M8 5V9M16 5V9M7 2 10 5 12 1 14 5 17 2"/>',
  flame: '<path class="icon-line" d="M12 22C6 22 4 18 5 14 6 10 10 8 10 3 15 6 19 11 18 16 18 20 15 22 12 22Z"/><path class="icon-line" d="M12 19C9 19 9 16 10 14L13 10C13 14 16 15 15 17 15 19 13 19 12 19Z"/>',
  chain: '<path class="icon-line" d="M9 15 7 17C4 20 0 16 3 13L7 9C10 6 14 10 11 13L10 14M15 9 17 7C20 4 24 8 21 11L17 15C14 18 10 14 13 11L14 10"/>',
  'shield-clock': '<path class="icon-line" d="M10 3 18 6V11C18 16 15 20 10 22 5 20 2 16 2 11V6Z"/><circle class="icon-line" cx="15" cy="15" r="6"/><path class="icon-line" d="M15 11V15L18 17"/>',
  'infinity-signal': '<path class="icon-line" d="M12 12C9 7 7 6 4 6 0 6 0 13 4 14 8 15 10 9 13 7 17 4 22 7 21 12 20 16 16 17 13 14L12 12Z"/><path class="icon-line" d="M4 19H20"/>',
  footsteps: '<path class="icon-line" d="M8 4C11 5 12 8 11 12L9 17C8 20 4 19 4 16L5 8C5 5 6 4 8 4ZM17 3C19 4 20 7 19 10L17 15C16 18 13 17 13 14L14 7C14 4 15 3 17 3Z"/>',
  route: '<circle class="icon-fill" cx="5" cy="18" r="3"/><circle class="icon-fill" cx="19" cy="5" r="3"/><path class="icon-line" d="M7 16C9 13 15 14 15 10 15 7 11 8 9 6"/><polyline class="icon-line" points="6,8 9,5 12,7"/>',
  'calendar-check': '<rect class="icon-line" x="3" y="4" width="18" height="17" rx="2"/><path class="icon-line" d="M3 9H21M7 2V6M17 2V6M7 15 10 18 17 12"/>',
  'orbit-calendar': '<rect class="icon-line" x="6" y="6" width="12" height="12" rx="2"/><path class="icon-line" d="M6 10H18M9 4V8M15 4V8M2 12C2 6 6 2 12 2M22 12C22 18 18 22 12 22"/><circle class="icon-fill" cx="3" cy="16" r="2"/><circle class="icon-fill" cx="21" cy="8" r="2"/>',
});

const rankBodies = TOKEN_RANKS.map(({ rank, glyphId }) => {
  const body = RANK_ICON_BODIES[glyphId];
  if (body === undefined) {
    throw new TypeError(`missing rank glyph for rank ${rank}`);
  }
  return Object.freeze({ rank, id: glyphId, body });
});

export const RANK_GLYPHS = Object.freeze(rankBodies);

if (new Set(TOKEN_RANKS.map(({ glyphId }) => glyphId)).size !== TOKEN_RANKS.length
  || ACHIEVEMENT_CATALOG.some(({ iconId }) => ACHIEVEMENT_ICONS[iconId] === undefined)
  || Object.keys(ACHIEVEMENT_ICONS).length !== ACHIEVEMENT_CATALOG.length) {
  throw new TypeError('icon catalogs do not match domain definitions');
}

function fixedNumber(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError('icon geometry must be finite');
  }
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function renderIcon(body, variantClass, { x = 0, y = 0, size = 24, className } = {}) {
  if (![x, y].every((value) => Number.isFinite(value) && value >= 0)
    || !Number.isFinite(size)
    || size <= 0) {
    throw new TypeError('icon geometry is invalid');
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(className)) {
    throw new TypeError('icon class name is invalid');
  }
  const scale = size / 24;
  return `<g class="${className} ${variantClass}" transform="translate(${fixedNumber(x)} ${fixedNumber(y)}) scale(${fixedNumber(scale)})">${body}</g>`;
}

export function renderRankGlyph(rank, options = {}) {
  if (!Number.isInteger(rank) || rank < 1 || rank > RANK_GLYPHS.length) {
    throw new TypeError('rank glyph must reference rank 1 through 20');
  }
  const glyph = RANK_GLYPHS[rank - 1];
  return renderIcon(glyph.body, `rank-glyph-${glyph.id}`, {
    className: 'rank-glyph',
    ...options,
  });
}

export function renderAchievementIcon(iconId, options = {}) {
  const body = ACHIEVEMENT_ICONS[iconId];
  if (body === undefined) {
    throw new TypeError('achievement icon is unknown');
  }
  return renderIcon(body, `achievement-icon-${iconId}`, {
    className: 'achievement-icon',
    ...options,
  });
}
