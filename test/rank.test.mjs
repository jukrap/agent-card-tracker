import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOKEN_RANKS,
  computeTokenRank,
  milestoneState,
} from '../src/domain/rank.mjs';

function observed(value, coverage = 'complete') {
  return {
    value,
    coverage,
    lowerBound: coverage === 'partial',
  };
}

test('the 20 token thresholds are ordered and exact', () => {
  assert.equal(TOKEN_RANKS.length, 20);
  assert.deepEqual(
    TOKEN_RANKS.map(({ roman, title, threshold }) => [roman, title, threshold]),
    [
      ['I', 'Novice', 0],
      ['II', 'Initiate', 10_000],
      ['III', 'Apprentice', 50_000],
      ['IV', 'Adept', 100_000],
      ['V', 'Scout', 500_000],
      ['VI', 'Adventurer', 1_000_000],
      ['VII', 'Knight', 5_000_000],
      ['VIII', 'Veteran', 10_000_000],
      ['IX', 'Elite', 50_000_000],
      ['X', 'Champion', 100_000_000],
      ['XI', 'Hero', 500_000_000],
      ['XII', 'Warlord', 1_000_000_000],
      ['XIII', 'Overlord', 2_500_000_000],
      ['XIV', 'Paragon', 5_000_000_000],
      ['XV', 'Mythic', 10_000_000_000],
      ['XVI', 'Ascendant', 25_000_000_000],
      ['XVII', 'Immortal', 50_000_000_000],
      ['XVIII', 'Sovereign', 100_000_000_000],
      ['XIX', 'Eternal', 250_000_000_000],
      ['XX', 'Transcendent', 1_000_000_000_000],
    ],
  );
});

test('every threshold boundary selects the expected previous, exact, and next value rank', () => {
  const zero = computeTokenRank(observed(0));
  assert.equal(zero.current.rank, 1);
  assert.equal(computeTokenRank(observed(1)).current.rank, 1);
  assert.throws(() => computeTokenRank(observed(-1)));

  for (let index = 1; index < TOKEN_RANKS.length; index += 1) {
    const current = TOKEN_RANKS[index];
    assert.equal(
      computeTokenRank(observed(current.threshold - 1)).current.rank,
      current.rank - 1,
      `before ${current.title}`,
    );
    const exact = computeTokenRank(observed(current.threshold));
    assert.equal(exact.current.rank, current.rank, `at ${current.title}`);
    assert.equal(
      computeTokenRank(observed(current.threshold + 1)).current.rank,
      current.rank,
      `after ${current.title}`,
    );
    assert.equal(exact.progressPercentage, current.rank === 20 ? 100 : 0);
  }
});

test('19.3B is exact Rank XV Mythic and 62% toward Ascendant', () => {
  const rank = computeTokenRank(observed(19_300_000_000));

  assert.equal(rank.current.roman, 'XV');
  assert.equal(rank.current.title, 'Mythic');
  assert.equal(rank.current.rarity, 'epic');
  assert.equal(rank.next.title, 'Ascendant');
  assert.ok(Math.abs(rank.progressPercentage - 62) < 1e-9);
  assert.equal(rank.unlockedCount, 15);
  assert.equal(rank.lowerBound, false);
});

test('partial lifetime is an at-least rank while unknown is unranked', () => {
  const partial = computeTokenRank(observed(19_300_000_000, 'partial'));
  assert.equal(partial.current.title, 'Mythic');
  assert.equal(partial.lowerBound, true);
  assert.ok(Math.abs(partial.progressPercentage - 62) < 1e-9);

  const unknown = computeTokenRank(observed(null, 'unknown'));
  assert.equal(unknown.status, 'unranked');
  assert.equal(unknown.current, null);
  assert.equal(unknown.unlockedCount, 0);
});

test('1T and above is max rank with Legendary rarity', () => {
  for (const value of [1_000_000_000_000, Number.MAX_SAFE_INTEGER]) {
    const rank = computeTokenRank(observed(value));
    assert.equal(rank.current.title, 'Transcendent');
    assert.equal(rank.current.rarity, 'legendary');
    assert.equal(rank.maxRank, true);
    assert.equal(rank.progressPercentage, 100);
  }
});

test('rarity bands and milestone uncertainty have non-color semantics', () => {
  const expected = [
    [1, 'common'],
    [4, 'common'],
    [5, 'uncommon'],
    [8, 'uncommon'],
    [9, 'rare'],
    [12, 'rare'],
    [13, 'epic'],
    [16, 'epic'],
    [17, 'legendary'],
    [20, 'legendary'],
  ];
  for (const [rankNumber, rarity] of expected) {
    const threshold = TOKEN_RANKS[rankNumber - 1].threshold;
    assert.equal(computeTokenRank(observed(threshold)).current.rarity, rarity);
  }

  assert.equal(milestoneState(observed(1_000), 1_000), 'unlocked');
  assert.equal(milestoneState(observed(999), 1_000), 'locked');
  assert.equal(milestoneState(observed(999, 'partial'), 1_000), 'unknown');
  assert.equal(milestoneState(observed(null, 'unknown'), 1_000), 'unknown');
});
