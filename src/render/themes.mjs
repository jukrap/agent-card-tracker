function tokens({
  bg,
  surface,
  border,
  text,
  muted,
  accent,
  accentStrong,
  accentSoft,
  zero,
  unknown,
  heat1,
  heat2,
  heat3,
  heat4,
}) {
  const red = Number.parseInt(bg.slice(1, 3), 16);
  const green = Number.parseInt(bg.slice(3, 5), 16);
  const blue = Number.parseInt(bg.slice(5, 7), 16);
  const dark = ((red * 299) + (green * 587) + (blue * 114)) < 128_000;
  const rarity = dark
    ? {
      common: '#8c959f', uncommon: '#3fb950', rare: '#58a6ff',
      epic: '#bc8cff', legendary: '#d29922', onRarity: '#0d1117',
    }
    : {
      common: '#57606a', uncommon: '#1a7f37', rare: '#0969da',
      epic: '#8250df', legendary: '#9a6700', onRarity: '#ffffff',
    };
  return Object.freeze({
    bg,
    surface,
    border,
    text,
    muted,
    accent,
    accentStrong,
    accentSoft,
    zero,
    unknown,
    heat1,
    heat2,
    heat3,
    heat4,
    ...rarity,
  });
}

function theme(light, dark) {
  return Object.freeze({ light: tokens(light), dark: tokens(dark) });
}

export const CARD_THEMES = Object.freeze({
  github: theme(
    {
      bg: '#ffffff', surface: '#f6f8fa', border: '#d0d7de', text: '#1f2328',
      muted: '#57606a', accent: '#0969da', accentStrong: '#0550ae',
      accentSoft: '#ddf4ff', zero: '#eaeef2', unknown: '#57606a',
      heat1: '#b6e3ff', heat2: '#54aeff', heat3: '#218bff', heat4: '#0969da',
    },
    {
      bg: '#0d1117', surface: '#161b22', border: '#30363d', text: '#e6edf3',
      muted: '#8c959f', accent: '#58a6ff', accentStrong: '#79c0ff',
      accentSoft: '#1f3b57', zero: '#21262d', unknown: '#8c959f',
      heat1: '#0e4429', heat2: '#006d32', heat3: '#26a641', heat4: '#39d353',
    },
  ),
  midnight: theme(
    {
      bg: '#f8faff', surface: '#eef2ff', border: '#c7d2fe', text: '#172554',
      muted: '#475569', accent: '#4338ca', accentStrong: '#3730a3',
      accentSoft: '#e0e7ff', zero: '#e2e8f0', unknown: '#475569',
      heat1: '#c7d2fe', heat2: '#a5b4fc', heat3: '#6366f1', heat4: '#4338ca',
    },
    {
      bg: '#0b1020', surface: '#111827', border: '#334155', text: '#f8fafc',
      muted: '#cbd5e1', accent: '#818cf8', accentStrong: '#a5b4fc',
      accentSoft: '#27345f', zero: '#1e293b', unknown: '#cbd5e1',
      heat1: '#1e3a5f', heat2: '#274c77', heat3: '#4f46e5', heat4: '#818cf8',
    },
  ),
  aurora: theme(
    {
      bg: '#f7fffd', surface: '#ecfdf5', border: '#a7f3d0', text: '#0f2f2a',
      muted: '#45635d', accent: '#047857', accentStrong: '#065f46',
      accentSoft: '#d1fae5', zero: '#dff7ef', unknown: '#45635d',
      heat1: '#99f6e4', heat2: '#5eead4', heat3: '#14b8a6', heat4: '#047857',
    },
    {
      bg: '#071a18', surface: '#0d2522', border: '#285e57', text: '#eafff9',
      muted: '#a7d4cc', accent: '#5eead4', accentStrong: '#99f6e4',
      accentSoft: '#123e39', zero: '#16332f', unknown: '#a7d4cc',
      heat1: '#134e4a', heat2: '#0f766e', heat3: '#14b8a6', heat4: '#5eead4',
    },
  ),
  ember: theme(
    {
      bg: '#fffaf5', surface: '#fff1e6', border: '#fed7aa', text: '#3b1d0f',
      muted: '#6b4b3e', accent: '#c2410c', accentStrong: '#9a3412',
      accentSoft: '#ffedd5', zero: '#f5e7dc', unknown: '#6b4b3e',
      heat1: '#fed7aa', heat2: '#fdba74', heat3: '#f97316', heat4: '#c2410c',
    },
    {
      bg: '#1c0f0a', surface: '#2a1710', border: '#6b3a24', text: '#fff7ed',
      muted: '#d6b7a7', accent: '#fb923c', accentStrong: '#fdba74',
      accentSoft: '#4a2415', zero: '#352019', unknown: '#d6b7a7',
      heat1: '#7c2d12', heat2: '#9a3412', heat3: '#ea580c', heat4: '#fb923c',
    },
  ),
  monochrome: theme(
    {
      bg: '#ffffff', surface: '#f4f4f5', border: '#d4d4d8', text: '#18181b',
      muted: '#52525b', accent: '#3f3f46', accentStrong: '#27272a',
      accentSoft: '#e4e4e7', zero: '#eeeeef', unknown: '#52525b',
      heat1: '#d4d4d8', heat2: '#a1a1aa', heat3: '#71717a', heat4: '#3f3f46',
    },
    {
      bg: '#09090b', surface: '#18181b', border: '#3f3f46', text: '#fafafa',
      muted: '#a1a1aa', accent: '#d4d4d8', accentStrong: '#f4f4f5',
      accentSoft: '#27272a', zero: '#202023', unknown: '#a1a1aa',
      heat1: '#3f3f46', heat2: '#52525b', heat3: '#a1a1aa', heat4: '#d4d4d8',
    },
  ),
});
