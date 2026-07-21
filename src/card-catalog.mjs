export const CARD_NAMES = Object.freeze([
  'overview',
  'achievements',
  'trophy-case',
  'records',
  'trends',
  'activity',
  'compact',
]);

export const CARD_VIEW_BOXES = Object.freeze({
  overview: '0 0 846 210',
  achievements: '0 0 416 190',
  'trophy-case': '0 0 846 276',
  records: '0 0 416 190',
  trends: '0 0 416 190',
  activity: '0 0 416 190',
  compact: '0 0 416 96',
});

export const DEFAULT_THEME = 'github';
export const THEME_NAMES = Object.freeze([
  DEFAULT_THEME,
  'midnight',
  'aurora',
  'ember',
  'monochrome',
]);
export const THEME_VARIANTS = Object.freeze(
  THEME_NAMES.filter((theme) => theme !== DEFAULT_THEME),
);

const CARD_NAME_SET = new Set(CARD_NAMES);
const THEME_NAME_SET = new Set(THEME_NAMES);

export function cardFilename(cardName, theme = DEFAULT_THEME) {
  if (!CARD_NAME_SET.has(cardName) || !THEME_NAME_SET.has(theme)) {
    throw new TypeError('card name and theme must belong to the public catalog');
  }
  return theme === DEFAULT_THEME
    ? `${cardName}.svg`
    : `${cardName}-${theme}.svg`;
}

export const CARD_ARTIFACT_PATHS = Object.freeze(
  THEME_NAMES.flatMap((theme) => (
    CARD_NAMES.map((cardName) => `cards/${cardFilename(cardName, theme)}`)
  )),
);
