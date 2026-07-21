import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATEGORIES,
  evaluateAchievements,
  selectRepresentativeAchievements,
} from '../src/domain/achievements.mjs';

function metric(value, coverage = 'complete') {
  return {
    value,
    coverage,
    lowerBound: coverage === 'partial',
  };
}

function input(overrides = {}) {
  return {
    lifetime: metric(0),
    peakDay: metric(0),
    best7: metric(0),
    bestMonth: metric(0),
    longestStreak: metric(0),
    activeDays: metric(0),
    ...overrides,
  };
}

test('achievement catalog contains four immutable milestones in each category', () => {
  assert.deepEqual(ACHIEVEMENT_CATEGORIES, [
    'renown',
    'momentum',
    'consistency',
    'journey',
  ]);
  assert.equal(ACHIEVEMENT_CATALOG.length, 16);
  assert.equal(new Set(ACHIEVEMENT_CATALOG.map(({ id }) => id)).size, 16);
  assert.equal(new Set(ACHIEVEMENT_CATALOG.map(({ iconId }) => iconId)).size, 16);
  assert.deepEqual(
    ACHIEVEMENT_CATEGORIES.map((category) => (
      ACHIEVEMENT_CATALOG.filter((entry) => entry.category === category).length
    )),
    [4, 4, 4, 4],
  );
  assert.ok(Object.isFrozen(ACHIEVEMENT_CATALOG));
  assert.ok(ACHIEVEMENT_CATALOG.every(Object.isFrozen));
  assert.deepEqual(
    ACHIEVEMENT_CATALOG.map(({ label, target }) => [label, target]),
    [
      ['Billion Club', 1_000_000_000],
      ['Mythic Realm', 10_000_000_000],
      ['Sovereign Scale', 100_000_000_000],
      ['Transcendent Trillion', 1_000_000_000_000],
      ['Heavy Day', 250_000_000],
      ['Billion Day', 1_000_000_000],
      ['Seven-Day Siege', 5_000_000_000],
      ['Ten-Billion Month', 10_000_000_000],
      ['Weekwalker', 7],
      ['Monthbound', 30],
      ['Iron Century', 100],
      ['Yearlong Signal', 365],
      ['First Expedition', 10],
      ['Trailblazer', 50],
      ['Active Centurion', 100],
      ['Year of Code', 365],
    ],
  );
});

test('achievement boundaries distinguish locked, unknown, and lower-bound unlocks', () => {
  const definition = ACHIEVEMENT_CATALOG[0];
  for (const [lifetime, expected] of [
    [metric(definition.target - 1), 'locked'],
    [metric(definition.target - 1, 'partial'), 'unknown'],
    [metric(null, 'unknown'), 'unknown'],
    [metric(definition.target), 'unlocked'],
    [metric(definition.target, 'partial'), 'unlocked'],
  ]) {
    const [evaluated] = evaluateAchievements(input({ lifetime }));
    assert.equal(evaluated.state, expected);
  }
});

test('every catalog source evaluates against its matching metric', () => {
  const thresholds = {};
  for (const { metricKey, target } of ACHIEVEMENT_CATALOG) {
    thresholds[metricKey] = Math.max(target, thresholds[metricKey] ?? 0);
  }
  const evaluated = evaluateAchievements(input(Object.fromEntries(
    Object.entries(thresholds).map(([key, value]) => [key, metric(value)]),
  )));
  assert.ok(evaluated.every(({ state }) => state === 'unlocked'));
});

test('representatives are the highest unlocked achievement in each category', () => {
  const evaluated = evaluateAchievements(input({
    lifetime: metric(19_300_000_000),
    peakDay: metric(1_200_000_000),
    best7: metric(6_000_000_000),
    bestMonth: metric(8_000_000_000),
    longestStreak: metric(45),
    activeDays: metric(120),
  }));
  assert.deepEqual(
    selectRepresentativeAchievements(evaluated).map(({ label }) => label),
    ['Mythic Realm', 'Seven-Day Siege', 'Monthbound', 'Active Centurion'],
  );
});

test('a category without an unlock selects its first visible locked or unknown milestone', () => {
  const evaluated = evaluateAchievements(input({
    lifetime: metric(null, 'unknown'),
    peakDay: metric(null, 'unknown'),
    best7: metric(null, 'unknown'),
    bestMonth: metric(null, 'unknown'),
    longestStreak: metric(null, 'unknown'),
    activeDays: metric(null, 'unknown'),
  }));
  assert.deepEqual(
    selectRepresentativeAchievements(evaluated).map(({ label, state }) => [label, state]),
    [
      ['Billion Club', 'unknown'],
      ['Heavy Day', 'unknown'],
      ['Weekwalker', 'unknown'],
      ['First Expedition', 'unknown'],
    ],
  );
});
