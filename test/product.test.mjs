import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLI_ALIASES,
  CLI_NAME,
  PRODUCT_DISCLAIMER,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  PUBLIC_HANDLE,
  TARGET_REPOSITORY,
  repositoryOwner,
} from '../src/product.mjs';
import {
  CARD_ARTIFACT_PATHS,
  CARD_NAMES,
  CARD_VIEW_BOXES,
  DEFAULT_THEME,
  THEME_NAMES,
  cardFilename,
} from '../src/card-catalog.mjs';
import { CARD_THEMES } from '../src/render/themes.mjs';

test('Codex Renown product identity is fixed and repository-derived', () => {
  assert.equal(PRODUCT_NAME, 'Codex Renown');
  assert.equal(PRODUCT_TAGLINE, 'Your Codex usage, told through milestones.');
  assert.equal(
    PRODUCT_DISCLAIMER,
    'Codex Renown is an unofficial community project. It is not affiliated with or endorsed by OpenAI.',
  );
  assert.equal(TARGET_REPOSITORY, 'jukrap/codex-renown');
  assert.equal(repositoryOwner(TARGET_REPOSITORY), 'jukrap');
  assert.equal(PUBLIC_HANDLE, '@jukrap');
  assert.equal(CLI_NAME, 'codex-renown');
  assert.deepEqual(CLI_ALIASES, ['agent-card']);
  assert.throws(() => repositoryOwner('jukrap/codex-renown/extra'), TypeError);
  assert.throws(() => repositoryOwner('https://github.com/jukrap/codex-renown'), TypeError);
});

test('seven card types and five themes produce 35 flat deterministic artifacts', () => {
  assert.deepEqual(CARD_NAMES, [
    'overview',
    'achievements',
    'trophy-case',
    'records',
    'trends',
    'activity',
    'compact',
  ]);
  assert.deepEqual(CARD_VIEW_BOXES, {
    overview: '0 0 846 210',
    achievements: '0 0 416 190',
    'trophy-case': '0 0 846 276',
    records: '0 0 416 190',
    trends: '0 0 416 190',
    activity: '0 0 416 190',
    compact: '0 0 416 96',
  });
  assert.equal(DEFAULT_THEME, 'github');
  assert.deepEqual(THEME_NAMES, [
    'github',
    'midnight',
    'aurora',
    'ember',
    'monochrome',
  ]);
  assert.equal(CARD_ARTIFACT_PATHS.length, 35);
  assert.equal(new Set(CARD_ARTIFACT_PATHS).size, 35);
  assert.ok(CARD_ARTIFACT_PATHS.every((value) => /^cards\/[a-z0-9-]+\.svg$/u.test(value)));
  assert.equal(cardFilename('overview', 'github'), 'overview.svg');
  assert.equal(cardFilename('overview', 'midnight'), 'overview-midnight.svg');
  assert.equal(cardFilename('trophy-case', 'monochrome'), 'trophy-case-monochrome.svg');
  assert.throws(() => cardFilename('unknown', 'github'), TypeError);
  assert.throws(() => cardFilename('overview', 'unknown'), TypeError);
});

test('every theme defines immutable light and dark token sets', () => {
  const required = [
    'bg', 'surface', 'border', 'text', 'muted', 'accent', 'accentStrong',
    'accentSoft', 'zero', 'unknown', 'heat1', 'heat2', 'heat3', 'heat4',
  ];
  assert.deepEqual(Object.keys(CARD_THEMES), THEME_NAMES);
  for (const theme of Object.values(CARD_THEMES)) {
    assert.ok(Object.isFrozen(theme));
    for (const scheme of ['light', 'dark']) {
      assert.ok(Object.isFrozen(theme[scheme]));
      assert.deepEqual(Object.keys(theme[scheme]), required);
      assert.ok(Object.values(theme[scheme]).every((value) => /^#[0-9a-f]{6}$/u.test(value)));
    }
  }
});
