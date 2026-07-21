export const TOKEN_RANKS = Object.freeze([
  { rank: 1, roman: 'I', title: 'Novice', threshold: 0, glyphId: 'first-spark' },
  { rank: 2, roman: 'II', title: 'Initiate', threshold: 10_000, glyphId: 'rising-chevron' },
  { rank: 3, roman: 'III', title: 'Apprentice', threshold: 50_000, glyphId: 'open-codex' },
  { rank: 4, roman: 'IV', title: 'Adept', threshold: 100_000, glyphId: 'wayfinder' },
  { rank: 5, roman: 'V', title: 'Scout', threshold: 500_000, glyphId: 'signal-pennant' },
  { rank: 6, roman: 'VI', title: 'Adventurer', threshold: 1_000_000, glyphId: 'expedition-mark' },
  { rank: 7, roman: 'VII', title: 'Knight', threshold: 5_000_000, glyphId: 'code-helm' },
  { rank: 8, roman: 'VIII', title: 'Veteran', threshold: 10_000_000, glyphId: 'veteran-shield' },
  { rank: 9, roman: 'IX', title: 'Elite', threshold: 50_000_000, glyphId: 'elite-gem' },
  { rank: 10, roman: 'X', title: 'Champion', threshold: 100_000_000, glyphId: 'champion-laurel' },
  { rank: 11, roman: 'XI', title: 'Hero', threshold: 500_000_000, glyphId: 'hero-star' },
  { rank: 12, roman: 'XII', title: 'Warlord', threshold: 1_000_000_000, glyphId: 'crossed-blades' },
  { rank: 13, roman: 'XIII', title: 'Overlord', threshold: 2_500_000_000, glyphId: 'overlord-tower' },
  { rank: 14, roman: 'XIV', title: 'Paragon', threshold: 5_000_000_000, glyphId: 'paragon-prism' },
  { rank: 15, roman: 'XV', title: 'Mythic', threshold: 10_000_000_000, glyphId: 'mythic-eye' },
  { rank: 16, roman: 'XVI', title: 'Ascendant', threshold: 25_000_000_000, glyphId: 'winged-star' },
  { rank: 17, roman: 'XVII', title: 'Immortal', threshold: 50_000_000_000, glyphId: 'immortal-halo' },
  { rank: 18, roman: 'XVIII', title: 'Sovereign', threshold: 100_000_000_000, glyphId: 'sovereign-crown' },
  { rank: 19, roman: 'XIX', title: 'Eternal', threshold: 250_000_000_000, glyphId: 'eternal-loop' },
  { rank: 20, roman: 'XX', title: 'Transcendent', threshold: 1_000_000_000_000, glyphId: 'transcendent-sun' },
].map((entry) => Object.freeze(entry)));

const COVERAGE_STATES = new Set(['complete', 'partial', 'unknown']);

export function rarityForRank(rank) {
  if (!Number.isInteger(rank) || rank < 1 || rank > TOKEN_RANKS.length) {
    throw new TypeError('rank must be 1 through 20');
  }
  if (rank <= 4) {
    return 'common';
  }
  if (rank <= 8) {
    return 'uncommon';
  }
  if (rank <= 12) {
    return 'rare';
  }
  if (rank <= 16) {
    return 'epic';
  }
  return 'legendary';
}

function assertMetric(metric) {
  if (metric === null || typeof metric !== 'object' || Array.isArray(metric)) {
    throw new TypeError('rank metric must be an object');
  }
  if (!COVERAGE_STATES.has(metric.coverage)) {
    throw new TypeError('rank metric coverage is invalid');
  }
  if (metric.value !== null
    && (!Number.isSafeInteger(metric.value) || metric.value < 0)) {
    throw new TypeError('rank metric value must be a non-negative safe integer or null');
  }
}

export function computeTokenRank(metric) {
  assertMetric(metric);
  if (metric.value === null) {
    return Object.freeze({
      status: 'unranked',
      current: null,
      previous: null,
      next: TOKEN_RANKS[0],
      progressPercentage: null,
      unlockedCount: 0,
      maxRank: false,
      lowerBound: false,
    });
  }

  const currentIndex = TOKEN_RANKS.findLastIndex(
    ({ threshold }) => metric.value >= threshold,
  );
  const current = TOKEN_RANKS[currentIndex];
  const previous = currentIndex === 0 ? null : TOKEN_RANKS[currentIndex - 1];
  const next = TOKEN_RANKS[currentIndex + 1] ?? null;
  const progressPercentage = next === null
    ? 100
    : ((metric.value - current.threshold) / (next.threshold - current.threshold)) * 100;

  return Object.freeze({
    status: 'ranked',
    current: Object.freeze({ ...current, rarity: rarityForRank(current.rank) }),
    previous,
    next,
    progressPercentage: Math.max(0, Math.min(100, progressPercentage)),
    unlockedCount: currentIndex + 1,
    maxRank: next === null,
    lowerBound: metric.coverage === 'partial' || metric.lowerBound === true,
  });
}

export function milestoneState(metric, threshold) {
  assertMetric(metric);
  if (!Number.isSafeInteger(threshold) || threshold < 0) {
    throw new TypeError('milestone threshold must be a non-negative safe integer');
  }
  if (metric.value !== null && metric.value >= threshold) {
    return 'unlocked';
  }
  return metric.coverage === 'complete' ? 'locked' : 'unknown';
}
