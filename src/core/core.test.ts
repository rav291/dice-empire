import { describe, expect, it } from 'vitest';
import type { GameEvent, IGame } from '../contract';
import { createGame, scale } from './index';
import { randInt } from './rng';

const T0 = 1_700_000_000_000;

function newGame(seed: number, patch: Record<string, unknown> = {}) {
  let now = T0;
  const clock = () => now;
  const base = JSON.parse(createGame(null, seed, clock).save());
  const g = createGame(JSON.stringify({ ...base, ...patch }), seed, clock);
  return { g, advance: (ms: number) => (now += ms), now: () => now };
}

/** rng state whose first two dice satisfy `ok` (roll() draws d1, d2 first). */
function rngFor(ok: (d1: number, d2: number) => boolean) {
  for (let r = 1; ; r++) {
    const o = { rng: r };
    if (ok(randInt(o, 1, 6), randInt(o, 1, 6))) return r;
  }
}

/** Random but seeded minigame player. */
function resolvePending(g: IGame, rnd: () => number): GameEvent[] {
  const out: GameEvent[] = [];
  while (g.state.pending) {
    if (g.state.pending.kind === 'heist') out.push(...g.heistPick(Math.floor(rnd() * 12)));
    else {
      const evs = g.raidShoot(Math.floor(rnd() * 6) - 1);
      expect(evs.map((e) => e.t)).toEqual(['raidResult', 'coins']);
      out.push(...evs);
    }
  }
  return out;
}

interface CityStat { city: number; rolls: number; earnedPerRoll: number; S: number }

function bot(seed: number, maxRolls: number) {
  const { g, advance, now } = newGame(seed);
  const o = { rng: seed * 7919 };
  const rnd = () => randInt(o, 0, 1e9) / 1e9;
  const cities: CityStat[] = [];
  let rollsAtCity = 0;
  let earned = 0;
  const bySource: Record<string, number> = {};
  const check = (evs: GameEvent[]) => {
    for (const e of evs) {
      if (e.t !== 'coins') continue;
      if (e.amount > 0) earned += e.amount;
      if (g.state.city === 0) bySource[e.reason] = (bySource[e.reason] ?? 0) + e.amount;
    }
    const s = g.state;
    expect(s.coins).toBeGreaterThanOrEqual(0);
    expect(s.dice).toBeGreaterThanOrEqual(0);
    expect(s.shields).toBeGreaterThanOrEqual(0);
    expect(s.shields).toBeLessThanOrEqual(3);
    expect(Number.isInteger(s.coins)).toBe(true);
  };
  while (g.state.stats.rolls < maxRolls) {
    if (now() >= g.state.giftAt) check(g.claimGift());
    if (!g.canRoll()) {
      advance(g.nextDieAt()! - now());
      check(g.tick(now()));
      continue;
    }
    g.setMultiplier(1);
    const evs = g.roll();
    check(evs);
    // ordering contract the UI director relies on
    const ts = evs.map((e) => e.t);
    expect(ts[0]).toBe('roll');
    if (ts.includes('pending')) expect(ts.indexOf('pending')).toBe(ts.length - 1);
    ts.forEach((t, i) => {
      if (t === 'passGo') expect(evs[i + 1]).toMatchObject({ t: 'coins', reason: 'passGo' });
      if (t === 'move') expect(ts.slice(i + 1).find((x) => x === 'land' || x === 'move')).toBe('land');
      if (t === 'card') expect(ts[i - 1]).toBe('land');
    });
    check(resolvePending(g, rnd));
    for (;;) {
      const costs = [0, 1, 2, 3, 4].map((i) => [i, g.landmarkCost(i)] as const).filter(([, c]) => c !== null);
      costs.sort((a, b) => a[1]! - b[1]!);
      if (!costs.length || costs[0][1]! > g.state.coins) break;
      const city = g.state.city;
      const bevs = g.buildLandmark(costs[0][0]);
      check(bevs);
      if (g.state.city !== city) {
        const rolls = g.state.stats.rolls - rollsAtCity;
        cities.push({ city, rolls, earnedPerRoll: Math.round(earned / rolls), S: scale(city) });
        rollsAtCity = g.state.stats.rolls;
        earned = 0;
      }
    }
  }
  return { g, cities, bySource };
}

describe('balance bot (x1)', () => {
  it('completes city 0 in ~150-250 rolls, invariants hold over ~3,000 rolls', () => {
    const runs = [1, 2, 3, 4, 5].map((seed) => ({ seed, ...bot(seed, 1000) }));
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    console.log(
      runs
        .map(({ seed, g, cities }) =>
          `seed ${seed}: ` +
          cities.map((c) => `c${c.city} ${c.rolls}r ${fmt(c.earnedPerRoll)}/r`).join(' | ') +
          ` | heists ${g.state.stats.heists} raids ${g.state.stats.raids} sets ${g.state.completedSets.length}`)
        .join('\n'),
    );
    const total: Record<string, number> = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.bySource)) total[k] = (total[k] ?? 0) + v;
    const rolls = runs.reduce((a, r) => a + r.cities[0].rolls, 0);
    console.log('city 0 coins/roll by source: ' + Object.entries(total).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmt(v / rolls)}`).join(', '));
    for (const { cities } of runs) {
      expect(cities.length).toBeGreaterThanOrEqual(2);
      expect(cities[0].rolls).toBeGreaterThanOrEqual(150);
      expect(cities[0].rolls).toBeLessThanOrEqual(250);
    }
  });
});

describe('save/load', () => {
  it('round-trips state exactly', () => {
    const { g } = bot(4, 300);
    const json = g.save();
    const g2 = createGame(json, undefined, () => T0); // same clock as bot start: no extra regen past lastRegenAt
    expect(JSON.parse(g2.save())).toEqual(JSON.parse(json));
    // same seed + same actions = same result
    const a = createGame(json, undefined, () => T0);
    const b = createGame(json, undefined, () => T0);
    if (a.canRoll()) expect(a.roll()).toEqual(b.roll());
  });

  it('recovers from corrupt saves and fills missing fields', () => {
    for (const bad of ['{nope', 'null', '[]', '42', '"x"', '{"coins":"lots","dice":-5}', '']) {
      const g = createGame(bad, 9, () => T0);
      expect(g.state.coins).toBe(2 * scale(0));
      expect(g.state.dice).toBe(50);
      expect(g.state.rivals).toHaveLength(8);
      expect(g.canRoll()).toBe(true);
    }
    const g = createGame(JSON.stringify({ coins: 12345, city: 2 }), 9, () => T0);
    expect(g.state.coins).toBe(12345);
    expect(g.state.city).toBe(2);
    expect(g.state.properties).toHaveLength(40);
    expect(g.state.stats.rolls).toBe(0);
  });

  it('applies offline regen on load and via tick', () => {
    const { g, advance, now } = newGame(5, { dice: 10 });
    const t = now();
    advance(90_000 * 3 + 1000);
    expect(g.tick(now())).toEqual([{ t: 'dice', amount: 3, reason: 'regen' }]);
    expect(g.nextDieAt()).toBe(t + 4 * 90_000);
    const g2 = createGame(g.save(), undefined, () => now() + 90_000 * 1000);
    expect(g2.state.dice).toBe(50);
    expect(g2.nextDieAt()).toBeNull();
  });
});

describe('heist', () => {
  it('always resolves within 7 picks; opened doors are no-ops', () => {
    let heists = 0;
    for (let seed = 1; heists < 300; seed++) {
      const { g } = newGame(seed, { dice: 100_000 });
      const o = { rng: seed };
      for (let i = 0; i < 300; i++) {
        const p = g.state.pending;
        if (p?.kind === 'raid') g.raidShoot(-1);
        else if (p?.kind === 'heist') {
          heists++;
          let evs: GameEvent[] = [];
          while (g.state.pending) {
            expect(p.doors.filter((d) => d !== null)).toHaveLength(p.picks.length);
            const door = randInt(o, 0, 11);
            const opened = p.doors[door] !== null;
            evs = g.heistPick(door);
            if (opened) expect(evs).toEqual([]);
          }
          expect(p.picks.length).toBeGreaterThanOrEqual(3);
          expect(p.picks.length).toBeLessThanOrEqual(7);
          expect(evs.map((e) => e.t)).toEqual(['heistReveal', 'heistResult', 'coins']);
        } else g.roll();
      }
    }
  });
});

describe('jail', () => {
  it('go-to-jail tile moves to 10 with 3 attempts', () => {
    const rng = rngFor((a, b) => a !== b);
    const o = { rng };
    const sum = randInt(o, 1, 6) + randInt(o, 1, 6);
    const { g } = newGame(1, { rng, position: 30 - sum });
    const evs = g.roll();
    const types = evs.map((e) => e.t);
    expect(types.slice(0, 4)).toEqual(['roll', 'dice', 'move', 'land']);
    expect(evs).toContainEqual({ t: 'jail', reason: 'gotojail' });
    expect(g.state.position).toBe(10);
    expect(g.state.jailTurns).toBe(3);
  });

  it('doubles escape and move', () => {
    const rng = rngFor((a, b) => a === b);
    const o = { rng };
    const sum = randInt(o, 1, 6) * 2;
    const { g } = newGame(1, { rng, position: 10, jailTurns: 3 });
    const evs = g.roll();
    expect(evs[2]).toEqual({ t: 'jailRoll', escaped: true, attemptsLeft: 0 });
    expect(evs[3]).toMatchObject({ t: 'move', from: 10, to: 10 + sum });
    expect(g.state.jailTurns).toBe(0);
    expect(g.state.freeRolls).toBe(0);
  });

  it('released after the 3rd failed attempt', () => {
    for (let rng = 1; ; rng++) {
      const { g } = newGame(1, { rng, position: 10, jailTurns: 3 });
      const rolls = [g.roll(), g.roll(), g.roll()];
      if (rolls.some((evs) => evs[0].t === 'roll' && evs[0].doubles)) continue;
      expect(rolls.map((evs) => evs[2])).toEqual([
        { t: 'jailRoll', escaped: false, attemptsLeft: 2 },
        { t: 'jailRoll', escaped: false, attemptsLeft: 1 },
        { t: 'jailRoll', escaped: false, attemptsLeft: 0 },
      ]);
      expect(rolls[0].some((e) => e.t === 'move')).toBe(false);
      expect(rolls[2][3]).toMatchObject({ t: 'move', from: 10 });
      break;
    }
  });

  it('third consecutive double sends to jail', () => {
    for (let rng = 1; ; rng++) {
      const { g } = newGame(1, { rng, doublesStreak: 2 });
      const evs = g.roll();
      if (!(evs[0].t === 'roll' && evs[0].doubles)) continue;
      expect(evs.map((e) => e.t).slice(0, 3)).toEqual(['roll', 'dice', 'jail']);
      expect(g.state.position).toBe(10);
      expect(g.state.freeRolls).toBe(0);
      break;
    }
  });
});

describe('multipliers', () => {
  it('availability, clamping and auto-downgrade', () => {
    const { g } = newGame(1, { dice: 12 });
    expect(g.availableMultipliers()).toEqual([1, 2]);
    g.setMultiplier(100);
    expect(g.state.multiplier).toBe(2);
    const big = newGame(1, { dice: 600 }).g;
    expect(big.availableMultipliers()).toEqual([1, 2, 3, 5, 10, 20, 50, 100]);

    const { g: z } = newGame(1, { dice: 0 });
    expect(z.availableMultipliers()).toEqual([1]);
    expect(z.canRoll()).toBe(false);
    expect(() => z.roll()).toThrow();

    // roll at x10 from 50 dice: after the roll, x10 (needs 50) is gone
    for (let rng = 1; ; rng++) {
      const { g: h } = newGame(1, { rng, dice: 50 });
      h.setMultiplier(10);
      expect(h.state.multiplier).toBe(10);
      const evs = h.roll();
      expect(evs[0]).toMatchObject({ t: 'roll', cost: 10, multiplier: 10 });
      if (h.state.freeRolls > 0) {
        expect(h.state.multiplier).toBe(10); // free roll keeps the same m
        h.setMultiplier(1);
        expect(h.state.multiplier).toBe(10);
        continue;
      }
      expect(h.availableMultipliers()).toContain(h.state.multiplier);
      expect(h.state.multiplier).toBe(Math.max(...h.availableMultipliers()));
      expect(h.state.multiplier).toBeLessThan(10);
      break;
    }
  });

  it('cannot roll while a minigame is pending', () => {
    const { g } = newGame(2, { dice: 10_000 });
    while (!g.state.pending) g.roll();
    expect(g.canRoll()).toBe(false);
    expect(() => g.roll()).toThrow();
  });
});
