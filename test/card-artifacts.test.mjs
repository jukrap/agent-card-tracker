import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import {
  CARD_ARTIFACT_PATHS,
  CARD_NAMES,
  THEME_NAMES,
  cardFilename,
} from '../src/card-catalog.mjs';

test('artifact catalog contains 35 unique allowlisted flat SVG paths', () => {
  assert.equal(CARD_ARTIFACT_PATHS.length, 35);
  assert.equal(new Set(CARD_ARTIFACT_PATHS).size, 35);
  assert.deepEqual(
    CARD_ARTIFACT_PATHS,
    THEME_NAMES.flatMap((theme) => CARD_NAMES.map(
      (cardName) => `cards/${cardFilename(cardName, theme)}`,
    )),
  );
  for (const artifactPath of CARD_ARTIFACT_PATHS) {
    assert.match(artifactPath, /^cards\/[a-z]+(?:-[a-z]+)*\.svg$/u);
    assert.equal(path.posix.dirname(artifactPath), 'cards');
  }
});

test('path listing script emits the exact catalog in deterministic order', () => {
  const result = spawnSync(process.execPath, ['scripts/list-card-paths.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split('\n'), CARD_ARTIFACT_PATHS);
  assert.equal(result.stderr, '');
});
