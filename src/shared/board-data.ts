import type { ColorGroup, TileDef, TileKind, IconKey } from '../contract';

// Classic 40-tile loop. Index 0 = GO (bottom-right corner), moving clockwise on screen:
// bottom row right→left (0..10), left column bottom→top (10..20),
// top row left→right (20..30), right column top→bottom (30..39).
// All names are original — no Monopoly/Hasbro names.

export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: '#9a5b2e',
  sky: '#4cc3f5',
  pink: '#ec4fae',
  orange: '#ff9419',
  red: '#e8332e',
  yellow: '#ffd21f',
  green: '#16b45a',
  navy: '#2453d6',
};

export const GROUP_TIER: Record<ColorGroup, number> = {
  brown: 1, sky: 2, pink: 3, orange: 4, red: 5, yellow: 6, green: 7, navy: 8,
};

type Row = [TileKind, string, ColorGroup | IconKey | null, number?];

const ROWS: Row[] = [
  ['go', 'GO', 'go'],
  ['property', 'Cobble Lane', 'brown'],
  ['chest', 'Gift Box', 'gift'],
  ['property', 'Tinker Row', 'brown'],
  ['tax', 'City Tax', 'tax', 1],
  ['rail', 'North Station', 'rail', 3],
  ['property', 'Seabreeze Ave', 'sky'],
  ['chance', 'Chance', 'chance'],
  ['property', 'Lighthouse Rd', 'sky'],
  ['property', 'Gull Street', 'sky'],
  ['jail', 'Jail', 'jail'],
  ['property', 'Rosewood Way', 'pink'],
  ['utility', 'Power Plant', 'power', 4],
  ['property', 'Candy Court', 'pink'],
  ['property', 'Blossom Blvd', 'pink'],
  ['rail', 'East Depot', 'rail', 4],
  ['property', 'Amber Alley', 'orange'],
  ['chest', 'Gift Box', 'gift'],
  ['property', 'Sunset Strip', 'orange'],
  ['property', 'Marigold Ave', 'orange'],
  ['park', 'Lucky Park', 'park'],
  ['property', 'Ruby Road', 'red'],
  ['chance', 'Chance', 'chance'],
  ['property', 'Ember Square', 'red'],
  ['property', 'Crimson Plaza', 'red'],
  ['rail', 'South Terminal', 'rail', 5],
  ['property', 'Golden Mile', 'yellow'],
  ['property', 'Saffron Street', 'yellow'],
  ['utility', 'Water Works', 'water', 6],
  ['property', 'Honey Hill', 'yellow'],
  ['gotojail', 'Go To Jail', 'gotojail'],
  ['property', 'Emerald Park', 'green'],
  ['property', 'Jade Terrace', 'green'],
  ['chest', 'Gift Box', 'gift'],
  ['property', 'Fern Gardens', 'green'],
  ['rail', 'West Junction', 'rail', 6],
  ['chance', 'Chance', 'chance'],
  ['property', 'Sapphire Heights', 'navy'],
  ['tax', 'Luxury Tax', 'tax', 8],
  ['property', 'Royal Crown Drive', 'navy'],
];

export const BOARD: readonly TileDef[] = ROWS.map(([kind, name, x, tier], index) =>
  kind === 'property'
    ? { index, kind, name, group: x as ColorGroup, tier: GROUP_TIER[x as ColorGroup] }
    : { index, kind, name, icon: x as IconKey, ...(tier ? { tier } : {}) },
);

export const GROUP_TILES: Record<ColorGroup, number[]> = BOARD.reduce((acc, t) => {
  if (t.group) (acc[t.group] ??= []).push(t.index);
  return acc;
}, {} as Record<ColorGroup, number[]>);

export const JAIL_INDEX = 10;
