import type { GameEvent, IconKey, LandmarkState, NewsItem, Rival } from '../contract';
import { ECON, nice, scale } from './economy';
import { pick, rand, randInt, type Rng } from './rng';
import type { CoreState } from './index';

const ROSTER: [string, IconKey][] = [
  ['Duchess Dimes', 'avatar_cat'],
  ['Captain Cashflow', 'avatar_fox'],
  ['Baron Goldbeard', 'avatar_bear'],
  ['Lady Lucre', 'avatar_unicorn'],
  ['Mogul Max', 'avatar_lion'],
  ['Penny Pockets', 'avatar_panda'],
  ['Tycoon Tad', 'avatar_frog'],
  ['Boss Banana', 'avatar_monkey'],
];

const emptyLandmarks = (): LandmarkState[] => Array.from({ length: 5 }, () => ({ stage: 0, damaged: false }));

/** Spread `n` stages (0..20) randomly over 5 landmarks. */
function randomLandmarks(s: Rng, n: number): LandmarkState[] {
  const lm = emptyLandmarks();
  for (let k = 0; k < Math.min(n, 20); k++) {
    const open = lm.filter((l) => l.stage < 4);
    pick(s, open).stage++;
  }
  return lm;
}

export function makeRivals(s: Rng, city: number): Rival[] {
  return ROSTER.map(([name, avatar], i) => {
    const c = Math.max(0, city + randInt(s, -1, 1));
    return {
      id: `rival-${i + 1}`,
      name,
      avatar,
      city: c,
      landmarks: randomLandmarks(s, randInt(s, 3, 15)),
      shields: randInt(s, 0, 2),
      coins: nice(scale(c) * randInt(s, 20, 80)),
    };
  });
}

/** Silent background progress after each roll. */
export function stepRivals(s: CoreState): void {
  if (rand(s) < ECON.rivalShieldChance) {
    const r = pick(s, s.rivals);
    r.shields = Math.min(3, r.shields + 1);
  }
  if (rand(s) >= ECON.rivalBuildChance) return;
  const r = pick(s, s.rivals);
  r.coins += nice(scale(r.city) * randInt(s, 1, 5));
  const damaged = r.landmarks.find((l) => l.damaged);
  const open = r.landmarks.filter((l) => l.stage < 4);
  if (damaged) damaged.damaged = false;
  else if (open.length) pick(s, open).stage++;
  if (r.landmarks.every((l) => l.stage === 4 && !l.damaged)) {
    r.city++;
    r.landmarks = randomLandmarks(s, 1);
    r.coins += nice(scale(r.city) * 20);
  }
}

/** On the player's new city, rivals that fell behind catch up to around the player's city. */
export function nudgeRivals(s: CoreState): void {
  for (const r of s.rivals) {
    if (r.city < s.city - 1) {
      r.city = s.city - 1 + randInt(s, 0, 1);
      r.landmarks = randomLandmarks(s, randInt(s, 3, 15));
    }
  }
}

/** ~4% per roll: a rival raids (shield blocks, else damages a built landmark) or heists coins. */
export function inboundAttack(s: CoreState, now: number): GameEvent[] {
  if (rand(s) >= ECON.attackChance) return [];
  const r = pick(s, s.rivals);
  const built = s.landmarks.map((l, i) => (l.stage > 0 && !l.damaged ? i : -1)).filter((i) => i >= 0);
  const raid = rand(s) < 0.5 && (s.shields > 0 || built.length > 0);
  const base = { id: `news-${s.stats.rolls}`, at: now, rivalId: r.id, seen: false };
  const ev: GameEvent[] = [];
  let news: NewsItem;
  if (raid && s.shields > 0) {
    s.shields--;
    news = { ...base, kind: 'raid', blocked: true, coinsLost: 0 };
    ev.push({ t: 'attacked', news }, { t: 'shield', amount: -1, total: s.shields, reason: 'blocked' });
  } else if (raid) {
    const i = pick(s, built);
    s.landmarks[i].damaged = true;
    news = { ...base, kind: 'raid', blocked: false, coinsLost: 0, landmark: i };
    ev.push({ t: 'attacked', news });
  } else {
    const [lo, hi] = ECON.attackHeistLoss;
    const lost = Math.min(s.coins, nice(scale(s.city) * ECON.attackHeistCap), nice(s.coins * (lo + rand(s) * (hi - lo))));
    s.coins -= lost;
    r.coins += lost;
    news = { ...base, kind: 'heist', blocked: false, coinsLost: lost };
    ev.push({ t: 'attacked', news });
    if (lost > 0) ev.push({ t: 'coins', amount: -lost, reason: 'robbed' });
  }
  s.news = [news, ...s.news].slice(0, 30);
  return ev;
}
