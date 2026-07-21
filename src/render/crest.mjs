import { TOKEN_RANKS, rarityForRank } from '../domain/rank.mjs';
import { renderRankGlyph } from './icons.mjs';

const FRAME_IDS = Object.freeze({
  common: 'common-roundel',
  uncommon: 'uncommon-shield',
  rare: 'rare-hex',
  epic: 'epic-diamond',
  legendary: 'legendary-crown',
});

const FRAME_BODIES = Object.freeze({
  common: '<circle class="crest-frame crest-frame-common crest-frame-common-roundel" cx="36" cy="34" r="27"/>',
  uncommon: '<path class="crest-frame crest-frame-uncommon crest-frame-uncommon-shield" d="M36 4 63 13V34C63 50 52 61 36 66 20 61 9 50 9 34V13Z"/>',
  rare: '<polygon class="crest-frame crest-frame-rare crest-frame-rare-hex" points="36,3 62,18 62,48 36,66 10,48 10,18"/>',
  epic: '<path class="crest-frame crest-frame-epic crest-frame-epic-diamond" d="M36 2 64 20 57 55 36 68 15 55 8 20Z"/>',
  legendary: '<path class="crest-frame crest-frame-legendary crest-frame-legendary-crown" d="M8 21 21 31 36 5 51 31 64 21 58 58 36 68 14 58ZM14 16 20 9 26 17M46 17 52 9 58 16"/>',
});

function fixedNumber(value) {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function assertGeometry({ x, y, size }) {
  if (![x, y].every((value) => Number.isFinite(value) && value >= 0)
    || !Number.isFinite(size)
    || size <= 0) {
    throw new TypeError('crest geometry is invalid');
  }
}

export function crestModel(rank) {
  if (!Number.isInteger(rank) || rank < 1 || rank > TOKEN_RANKS.length) {
    throw new TypeError('crest rank must be 1 through 20');
  }
  const definition = TOKEN_RANKS[rank - 1];
  const rarity = rarityForRank(rank);
  return Object.freeze({
    rank,
    rarity,
    frameId: FRAME_IDS[rarity],
    glyphId: definition.glyphId,
    pipCount: ((rank - 1) % 4) + 1,
  });
}

export function renderCrest(rank, { x = 0, y = 0, size = 72 } = {}) {
  assertGeometry({ x, y, size });
  const model = crestModel(rank);
  const pipStart = 36 - ((model.pipCount - 1) * 4);
  const pips = Array.from({ length: model.pipCount }, (_, index) => (
    `<circle class="crest-pip" cx="${pipStart + (index * 8)}" cy="64" r="2.5"/>`
  )).join('');
  return [
    `<g class="crest crest-rarity-${model.rarity}" transform="translate(${fixedNumber(x)} ${fixedNumber(y)}) scale(${fixedNumber(size / 72)})">`,
    FRAME_BODIES[model.rarity],
    renderRankGlyph(rank, { x: 22, y: 18, size: 28 }),
    pips,
    '</g>',
  ].join('');
}
