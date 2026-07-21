import { milestoneState } from './rank.mjs';

export const ACHIEVEMENT_CATEGORIES = Object.freeze([
  'renown',
  'momentum',
  'consistency',
  'journey',
]);

export const ACHIEVEMENT_CATALOG = Object.freeze([
  {
    id: 'billion-club', category: 'renown', label: 'Billion Club',
    target: 1_000_000_000, metricKey: 'lifetime', iconId: 'token-stack',
  },
  {
    id: 'mythic-realm', category: 'renown', label: 'Mythic Realm',
    target: 10_000_000_000, metricKey: 'lifetime', iconId: 'mythic-star',
  },
  {
    id: 'sovereign-scale', category: 'renown', label: 'Sovereign Scale',
    target: 100_000_000_000, metricKey: 'lifetime', iconId: 'crown',
  },
  {
    id: 'transcendent-trillion', category: 'renown', label: 'Transcendent Trillion',
    target: 1_000_000_000_000, metricKey: 'lifetime', iconId: 'transcendent-sun',
  },
  {
    id: 'heavy-day', category: 'momentum', label: 'Heavy Day',
    target: 250_000_000, metricKey: 'peakDay', iconId: 'bolt',
  },
  {
    id: 'billion-day', category: 'momentum', label: 'Billion Day',
    target: 1_000_000_000, metricKey: 'peakDay', iconId: 'radiant-token',
  },
  {
    id: 'seven-day-siege', category: 'momentum', label: 'Seven-Day Siege',
    target: 5_000_000_000, metricKey: 'best7', iconId: 'calendar-shield',
  },
  {
    id: 'ten-billion-month', category: 'momentum', label: 'Ten-Billion Month',
    target: 10_000_000_000, metricKey: 'bestMonth', iconId: 'crowned-calendar',
  },
  {
    id: 'weekwalker', category: 'consistency', label: 'Weekwalker',
    target: 7, metricKey: 'longestStreak', iconId: 'flame',
  },
  {
    id: 'monthbound', category: 'consistency', label: 'Monthbound',
    target: 30, metricKey: 'longestStreak', iconId: 'chain',
  },
  {
    id: 'iron-century', category: 'consistency', label: 'Iron Century',
    target: 100, metricKey: 'longestStreak', iconId: 'shield-clock',
  },
  {
    id: 'yearlong-signal', category: 'consistency', label: 'Yearlong Signal',
    target: 365, metricKey: 'longestStreak', iconId: 'infinity-signal',
  },
  {
    id: 'first-expedition', category: 'journey', label: 'First Expedition',
    target: 10, metricKey: 'activeDays', iconId: 'footsteps',
  },
  {
    id: 'trailblazer', category: 'journey', label: 'Trailblazer',
    target: 50, metricKey: 'activeDays', iconId: 'route',
  },
  {
    id: 'active-centurion', category: 'journey', label: 'Active Centurion',
    target: 100, metricKey: 'activeDays', iconId: 'calendar-check',
  },
  {
    id: 'year-of-code', category: 'journey', label: 'Year of Code',
    target: 365, metricKey: 'activeDays', iconId: 'orbit-calendar',
  },
].map((entry) => Object.freeze(entry)));

const ACHIEVEMENT_STATES = new Set(['unlocked', 'locked', 'unknown']);

export function evaluateAchievements(metrics) {
  if (metrics === null || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new TypeError('achievement metrics must be an object');
  }
  return Object.freeze(ACHIEVEMENT_CATALOG.map((definition) => Object.freeze({
    ...definition,
    state: milestoneState(metrics[definition.metricKey], definition.target),
  })));
}

export function selectRepresentativeAchievements(achievements) {
  if (!Array.isArray(achievements)
    || achievements.length !== ACHIEVEMENT_CATALOG.length
    || achievements.some((entry) => (
      entry === null
      || typeof entry !== 'object'
      || !ACHIEVEMENT_STATES.has(entry.state)
    ))) {
    throw new TypeError('evaluated achievements are invalid');
  }

  return Object.freeze(ACHIEVEMENT_CATEGORIES.map((category) => {
    const entries = achievements.filter((entry) => entry.category === category);
    const unlocked = entries.filter((entry) => entry.state === 'unlocked');
    return unlocked.at(-1) ?? entries[0];
  }));
}
