import assert from 'node:assert/strict';
import test from 'node:test';

import { THEME_NAMES as CARD_THEME_NAMES } from '../src/card-catalog.mjs';
import { ACHIEVEMENT_CATALOG } from '../src/domain/achievements.mjs';
import { TOKEN_RANKS } from '../src/domain/rank.mjs';
import {
  ACHIEVEMENT_ICONS,
  RANK_GLYPHS,
  renderAchievementIcon,
  renderRankGlyph,
} from '../src/render/icons.mjs';
import { crestModel, renderCrest } from '../src/render/crest.mjs';
import { renderContainedPrestige } from '../src/render/prestige.mjs';
import { CARD_THEMES } from '../src/render/themes.mjs';
import { cardDocument } from '../src/render/svg.mjs';
import { validateSvgDocument } from '../src/render/svg-validator.mjs';

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/giu)
    .map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left, right) {
  const luminances = [relativeLuminance(left), relativeLuminance(right)]
    .toSorted((first, second) => second - first);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

test('all 20 ranks have a unique deterministic 24px glyph', () => {
  assert.equal(RANK_GLYPHS.length, 20);
  assert.equal(new Set(RANK_GLYPHS.map(({ id }) => id)).size, 20);
  assert.deepEqual(
    RANK_GLYPHS.map(({ id }) => id),
    TOKEN_RANKS.map(({ glyphId }) => glyphId),
  );

  for (const rank of TOKEN_RANKS) {
    const first = renderRankGlyph(rank.rank, { x: 3, y: 4, size: 24 });
    assert.equal(first, renderRankGlyph(rank.rank, { x: 3, y: 4, size: 24 }));
    assert.match(first, new RegExp(`rank-glyph-${rank.glyphId}`, 'u'));
    assert.equal(validateSvgDocument(cardDocument({
      id: `rank-glyph-${rank.rank}`,
      width: 32,
      height: 32,
      title: `Rank ${rank.rank} glyph`,
      description: `Validated ${rank.glyphId} vector geometry.`,
      body: first,
    })), true);
  }
});

test('crest combines five rarity frames with cyclic one-to-four pips', () => {
  const frames = new Set();
  for (const rank of TOKEN_RANKS) {
    const model = crestModel(rank.rank);
    frames.add(model.frameId);
    assert.equal(model.pipCount, ((rank.rank - 1) % 4) + 1);
  }
  assert.equal(frames.size, 5);

  assert.deepEqual(crestModel(15), {
    rank: 15,
    rarity: 'epic',
    frameId: 'epic-diamond',
    glyphId: 'mythic-eye',
    pipCount: 3,
  });
  const crest = renderCrest(15, { x: 8, y: 10, size: 72 });
  assert.match(crest, /crest-frame crest-frame-epic/);
  assert.equal((crest.match(/class="crest-pip"/gu) ?? []).length, 3);
});

test('all 16 achievements have unique safe inline icons', () => {
  assert.equal(Object.keys(ACHIEVEMENT_ICONS).length, 16);
  assert.deepEqual(
    Object.keys(ACHIEVEMENT_ICONS).toSorted(),
    ACHIEVEMENT_CATALOG.map(({ iconId }) => iconId).toSorted(),
  );
  for (const { iconId } of ACHIEVEMENT_CATALOG) {
    const icon = renderAchievementIcon(iconId, { x: 1, y: 2, size: 18 });
    assert.match(icon, new RegExp(`achievement-icon-${iconId}`, 'u'));
    assert.doesNotMatch(icon, /<image|<use|href=|url\s*\(/iu);
  }
});

test('contained prestige stays inside its declared canvas', () => {
  const prestige = renderContainedPrestige({ width: 416, height: 190 });
  assert.equal((prestige.match(/class="prestige-corner"/gu) ?? []).length, 4);
  assert.doesNotMatch(prestige, /(?:x|y)[12]?="-/u);
  assert.match(prestige, /M8 28V8H28/);
  assert.match(prestige, /M388 182H408V162/);
});

test('every theme emits accessible valid SVG with contrast-safe text and icons', () => {
  assert.deepEqual(Object.keys(CARD_THEMES), CARD_THEME_NAMES);
  for (const themeName of CARD_THEME_NAMES) {
    const theme = CARD_THEMES[themeName];
    for (const scheme of ['light', 'dark']) {
      const tokens = theme[scheme];
      assert.ok(contrastRatio(tokens.text, tokens.bg) >= 4.5, `${themeName}/${scheme}/text`);
      assert.ok(contrastRatio(tokens.muted, tokens.bg) >= 4.5, `${themeName}/${scheme}/muted`);
      for (const token of ['accent', 'common', 'uncommon', 'rare', 'epic', 'legendary']) {
        assert.ok(
          contrastRatio(tokens[token], tokens.bg) >= 3,
          `${themeName}/${scheme}/${token}`,
        );
      }
    }

    const svg = cardDocument({
      id: `icon-test-${themeName}`,
      width: 120,
      height: 96,
      theme: themeName,
      title: `Theme ${themeName}`,
      description: 'Deterministic crest and achievement icon.',
      body: [
        renderContainedPrestige({ width: 120, height: 96 }),
        renderCrest(15, { x: 12, y: 12, size: 64 }),
        renderAchievementIcon('mythic-star', { x: 88, y: 36, size: 20 }),
      ].join('\n'),
    });
    assert.equal(validateSvgDocument(svg), true);
    assert.equal(svg, cardDocument({
      id: `icon-test-${themeName}`,
      width: 120,
      height: 96,
      theme: themeName,
      title: `Theme ${themeName}`,
      description: 'Deterministic crest and achievement icon.',
      body: [
        renderContainedPrestige({ width: 120, height: 96 }),
        renderCrest(15, { x: 12, y: 12, size: 64 }),
        renderAchievementIcon('mythic-star', { x: 88, y: 36, size: 20 }),
      ].join('\n'),
    }));
  }
});

test('icon primitives reject unsafe and non-finite inputs', () => {
  assert.throws(() => renderRankGlyph(21));
  assert.throws(() => renderAchievementIcon('not-an-icon'));
  assert.throws(() => renderAchievementIcon('crown', { className: 'bad class' }));
  assert.throws(() => renderCrest(15, { x: Number.NaN }));
  assert.throws(() => renderContainedPrestige({ width: 10, height: 10 }));
  assert.throws(() => cardDocument({
    id: 'unsafe-theme', width: 20, height: 20, theme: 'not-a-theme',
    title: 'x', description: 'x', body: '',
  }));
});
