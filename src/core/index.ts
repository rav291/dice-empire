import type {
  GameEvent, GameState, HeistPrize, IGame, LandmarkState, PackTier, Pending, Reward, TileDef,
} from '../contract';
import { BOARD, GROUP_TIER, GROUP_TILES, JAIL_INDEX } from '../shared/board-data';
import { STICKERS, STICKER_SETS } from '../shared/stickers';
import { DECKS, type Card } from './decks';
import { ECON, MULTIPLIERS, nice, rent, scale, stageCost } from './economy';
import { pick, rand, randInt, shuffle, weighted } from './rng';
import { inboundAttack, makeRivals, nudgeRivals, stepRivals } from './rivals';

export { scale, rent, stageCost, ECON, MULTIPLIERS } from './economy';

// Private additions on top of the frozen GameState: `rng` (PRNG state) and, on pending
// minigames, `m` (multiplier when triggered) plus the heist's hidden door `layout`.
type HeistPending = Extract<Pending, { kind: 'heist' }> & { layout: HeistPrize[]; m: number };
type RaidPending = Extract<Pending, { kind: 'raid' }> & { m: number };
export interface CoreState extends Omit<GameState, 'pending'> {
  pending: HeistPending | RaidPending | null;
  rng: number;
}

const RAILS = BOARD.filter((t) => t.kind === 'rail').map((t) => t.index);
const emptyLandmarks = (): LandmarkState[] => Array.from({ length: 5 }, () => ({ stage: 0, damaged: false }));
const fmt = (n: number) => n.toLocaleString('en-US');

function freshState(seed: number, now: number): CoreState {
  const s: CoreState = {
    version: 1,
    seed,
    rng: seed >>> 0,
    coins: ECON.startCoins * scale(0),
    dice: ECON.startDice,
    diceMax: ECON.diceMax,
    lastRegenAt: now,
    multiplier: 1,
    shields: 0,
    position: 0,
    jailTurns: 0,
    doublesStreak: 0,
    freeRolls: 0,
    properties: Array(40).fill(0),
    city: 0,
    landmarks: emptyLandmarks(),
    stickers: {},
    completedSets: [],
    rivals: [],
    news: [],
    giftAt: now,
    pending: null,
    stats: { rolls: 0, heists: 0, raids: 0, citiesDone: 0 },
  };
  s.rivals = makeRivals(s, 0);
  return s;
}

// ---------------------------------------------------------------- save validation / migration
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validLandmarks = (v: unknown) =>
  Array.isArray(v) && v.length === 5 &&
  v.every((l) => isObj(l) && isInt(l.stage, 0, 4) && typeof l.damaged === 'boolean' && !(l.damaged && l.stage === 0));
const validRival = (r: unknown) =>
  isObj(r) && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.avatar === 'string' &&
  isInt(r.city, 0, 1e6) && validLandmarks(r.landmarks) && isInt(r.shields, 0, 3) && isNum(r.coins);
const validNews = (n: unknown) =>
  isObj(n) && typeof n.id === 'string' && isNum(n.at) && typeof n.rivalId === 'string' &&
  (n.kind === 'raid' || n.kind === 'heist') && typeof n.blocked === 'boolean' && isNum(n.coinsLost) && typeof n.seen === 'boolean';
const PRIZES: HeistPrize[] = ['bronze', 'silver', 'gold'];
function validPending(p: unknown): boolean {
  if (!isObj(p) || typeof p.rivalId !== 'string' || !isInt(p.m, 1, 100)) return false;
  if (p.kind === 'raid') return true;
  return p.kind === 'heist' &&
    Array.isArray(p.layout) && p.layout.length === 12 && p.layout.every((x: unknown) => PRIZES.includes(x as HeistPrize)) &&
    Array.isArray(p.doors) && p.doors.length === 12 && p.doors.every((x: unknown, i: number) => x === null || x === p.layout[i]) &&
    Array.isArray(p.picks) && p.picks.every((i: unknown) => isInt(i, 0, 11) && p.doors[i as number] !== null);
}

/** Field-by-field: keep valid saved values, fill everything else from a fresh game. */
function migrate(raw: unknown, d: CoreState): CoreState {
  if (!isObj(raw)) return d;
  const v = raw;
  const ok: Partial<Record<keyof CoreState, boolean>> = {
    seed: isInt(v.seed, 0, 2 ** 32 - 1),
    rng: isInt(v.rng, 0, 2 ** 32 - 1),
    coins: isInt(v.coins, 0, Number.MAX_SAFE_INTEGER),
    dice: isInt(v.dice, 0, 1e9),
    diceMax: isInt(v.diceMax, 1, 1e6),
    lastRegenAt: isNum(v.lastRegenAt),
    multiplier: MULTIPLIERS.includes(v.multiplier),
    shields: isInt(v.shields, 0, 3),
    position: isInt(v.position, 0, 39),
    jailTurns: isInt(v.jailTurns, 0, 3),
    doublesStreak: isInt(v.doublesStreak, 0, 2),
    freeRolls: isInt(v.freeRolls, 0, 1e6),
    properties: Array.isArray(v.properties) && v.properties.length === 40 &&
      v.properties.every((l: unknown, i: number) => isInt(l, 0, BOARD[i].kind === 'property' ? 5 : 0)),
    city: isInt(v.city, 0, 1e6),
    landmarks: validLandmarks(v.landmarks),
    stickers: isObj(v.stickers) && Object.values(v.stickers).every((n) => isInt(n, 0, 1e9)),
    completedSets: Array.isArray(v.completedSets) && v.completedSets.every((x: unknown) => typeof x === 'string'),
    rivals: Array.isArray(v.rivals) && v.rivals.length === 8 && v.rivals.every(validRival),
    news: Array.isArray(v.news) && v.news.length <= 30 && v.news.every(validNews),
    giftAt: isNum(v.giftAt),
    pending: v.pending === null || validPending(v.pending),
  };
  const s = { ...d } as Record<string, unknown>;
  for (const k of Object.keys(ok) as (keyof CoreState)[]) if (ok[k]) s[k] = v[k];
  if (!ok.rng && ok.seed) s.rng = v.seed;
  const p = s.pending as CoreState['pending'];
  if (p && !(s.rivals as CoreState['rivals']).some((r) => r.id === p.rivalId)) s.pending = null;
  const st = isObj(v.stats) ? v.stats : {};
  s.stats = Object.fromEntries(Object.entries(d.stats).map(([k, dv]) => [k, isInt(st[k], 0, 1e12) ? st[k] : dv]));
  return s as unknown as CoreState;
}

// ---------------------------------------------------------------- the game
class Game implements IGame {
  readonly board: readonly TileDef[] = BOARD;
  private s: CoreState;
  private ev: GameEvent[] = [];

  constructor(s: CoreState, private clock: () => number) {
    this.s = s;
    this.regen(clock());
    this.normalizeMultiplier();
  }

  get state(): Readonly<GameState> {
    return this.s;
  }

  private get S() {
    return scale(this.s.city);
  }

  // ---------------------------------------------------------------- time
  private regen(now: number): number {
    const s = this.s;
    if (s.dice >= s.diceMax) {
      s.lastRegenAt = Math.max(s.lastRegenAt, now);
      return 0;
    }
    const n = Math.floor((now - s.lastRegenAt) / ECON.regenMs);
    if (n <= 0) return 0;
    const add = Math.min(n, s.diceMax - s.dice);
    s.dice += add;
    s.lastRegenAt = s.dice >= s.diceMax ? now : s.lastRegenAt + n * ECON.regenMs;
    return add;
  }

  tick(now = this.clock()): GameEvent[] {
    const add = this.regen(now);
    return add > 0 ? [{ t: 'dice', amount: add, reason: 'regen' }] : [];
  }

  nextDieAt(): number | null {
    return this.s.dice >= this.s.diceMax ? null : this.s.lastRegenAt + ECON.regenMs;
  }

  // ---------------------------------------------------------------- multipliers
  availableMultipliers(): number[] {
    return MULTIPLIERS.filter((m) => m === 1 || this.s.dice >= ECON.multDice * m);
  }

  /** Clamps to the highest available ≤ m. Locked while a free roll is owed (it plays at the same m). */
  setMultiplier(m: number): void {
    if (this.s.freeRolls > 0) return;
    this.s.multiplier = Math.max(...this.availableMultipliers().filter((x) => x <= m), 1);
  }

  private normalizeMultiplier() {
    const avail = this.availableMultipliers();
    if (this.s.freeRolls === 0 && !avail.includes(this.s.multiplier)) this.s.multiplier = avail[avail.length - 1];
  }

  // ---------------------------------------------------------------- roll
  canRoll(): boolean {
    const s = this.s;
    return !s.pending && (s.freeRolls > 0 || s.dice >= s.multiplier);
  }

  roll(): GameEvent[] {
    if (!this.canRoll()) throw new Error('Cannot roll now');
    const s = this.s;
    const now = this.clock();
    this.ev = [];
    const m = s.multiplier;
    const free = s.freeRolls > 0;
    const cost = free ? 0 : m;
    if (free) s.freeRolls--;
    else {
      if (s.dice >= s.diceMax && s.dice - cost < s.diceMax) s.lastRegenAt = now;
      s.dice -= cost;
    }
    const d1 = randInt(s, 1, 6);
    const d2 = randInt(s, 1, 6);
    const doubles = d1 === d2;
    s.stats.rolls++;
    this.emit({ t: 'roll', d1, d2, doubles, cost, free, multiplier: m });
    if (cost) this.emit({ t: 'dice', amount: -cost, reason: 'roll' });

    if (s.jailTurns > 0) {
      s.doublesStreak = 0;
      s.jailTurns = doubles ? 0 : s.jailTurns - 1;
      this.emit({ t: 'jailRoll', escaped: doubles, attemptsLeft: s.jailTurns });
      if (s.jailTurns === 0) this.moveBy(d1 + d2, m, d1 + d2);
    } else if (doubles && s.doublesStreak >= 2) {
      this.goToJail('doubles');
    } else {
      s.doublesStreak = doubles ? s.doublesStreak + 1 : 0;
      if (doubles) {
        s.freeRolls++;
        this.emit({ t: 'doubles', streak: s.doublesStreak });
      }
      this.moveBy(d1 + d2, m, d1 + d2);
    }

    stepRivals(s);
    if (!s.pending) this.ev.push(...inboundAttack(s, now));
    this.normalizeMultiplier();
    return this.ev;
  }

  private emit(e: GameEvent) {
    this.ev.push(e);
  }

  private addCoins(amount: number, reason: string, tile?: number) {
    const s = this.s;
    const delta = Math.max(-s.coins, Math.round(amount));
    if (!delta) return;
    s.coins += delta;
    this.emit(tile === undefined ? { t: 'coins', amount: delta, reason } : { t: 'coins', amount: delta, reason, tile });
  }

  private addDice(n: number, reason: string) {
    if (n <= 0) return;
    this.s.dice += n;
    this.emit({ t: 'dice', amount: n, reason });
  }

  private addShields(n: number, reason: string): number {
    const s = this.s;
    const add = Math.min(n, 3 - s.shields);
    if (add <= 0) return 0;
    s.shields += add;
    this.emit({ t: 'shield', amount: add, total: s.shields, reason });
    return add;
  }

  /** Reward coins are absolute here (already scaled). */
  private grant(r: Reward, reason: string) {
    if (r.coins) this.addCoins(r.coins, reason);
    if (r.dice) this.addDice(r.dice, reason);
    if (r.shields) this.addShields(r.shields, reason);
    for (const p of r.packs ?? []) this.openPack(p);
  }

  /** Convert an ECON reward (coins in S units) to absolute coins. */
  private scaled(r: Reward): Reward {
    return r.coins ? { ...r, coins: nice(r.coins * this.S) } : r;
  }

  // ---------------------------------------------------------------- movement
  private moveBy(steps: number, m: number, pips: number) {
    const s = this.s;
    const from = s.position;
    const path = Array.from({ length: steps }, (_, i) => (from + i + 1) % 40);
    const to = path[path.length - 1];
    s.position = to;
    this.emit({ t: 'move', from, to, path });
    if (path.slice(0, -1).includes(0)) {
      const coins = nice(ECON.passGo * this.S * m);
      this.emit({ t: 'passGo', coins });
      this.addCoins(coins, 'passGo');
    }
    this.land(to, m, pips);
  }

  private moveBack(steps: number, m: number, pips: number) {
    const s = this.s;
    const from = s.position;
    const path = Array.from({ length: steps }, (_, i) => (from - i - 1 + 40) % 40);
    s.position = path[path.length - 1];
    this.emit({ t: 'move', from, to: s.position, path });
    this.land(s.position, m, pips);
  }

  private goToJail(reason: 'gotojail' | 'doubles' | 'card') {
    const s = this.s;
    s.position = JAIL_INDEX;
    s.jailTurns = 3;
    s.doublesStreak = 0;
    this.emit({ t: 'jail', reason });
  }

  // ---------------------------------------------------------------- tiles
  private land(tile: number, m: number, pips: number) {
    const s = this.s;
    const def = BOARD[tile];
    const S = this.S;
    this.emit({ t: 'land', tile });
    switch (def.kind) {
      case 'go':
        return this.addCoins(nice(ECON.landGo * S * m), 'go', tile);
      case 'property':
        return this.landProperty(tile, m);
      case 'rail':
        return this.startMinigame(rand(s) < 0.5 ? 'heist' : 'raid', m);
      case 'utility':
        return this.addCoins(nice(pips * ECON.utilityPip * (def.tier ?? 1) * S * m), 'utility', tile);
      case 'tax': {
        const amount = Math.min(s.coins, nice(ECON.taxPerTier * (def.tier ?? 1) * S * m));
        this.emit({ t: 'tax', tile, amount });
        return this.addCoins(-amount, 'tax', tile);
      }
      case 'park':
        this.addCoins(nice(ECON.park * S * m), 'park', tile);
        if (rand(s) < ECON.parkShieldChance) this.addShields(1, 'park');
        return;
      case 'gotojail':
        return this.goToJail('gotojail');
      case 'chance':
      case 'chest':
        return this.drawCard(def.kind, tile, m, pips);
      case 'jail':
        return;
    }
  }

  private landProperty(tile: number, m: number) {
    const s = this.s;
    const def = BOARD[tile];
    const prevLevel = s.properties[tile];
    const level = Math.min(5, prevLevel + 1);
    s.properties[tile] = level;
    this.emit({ t: 'property', tile, level, prevLevel });
    this.addCoins(rent(s.city, def.tier!, level) * m, 'rent', tile);
    const group = def.group!;
    const tiles = GROUP_TILES[group];
    const before = tiles.map((i) => (i === tile ? prevLevel : s.properties[i]));
    const tier = GROUP_TIER[group];
    for (const [kind, lvl, reward] of [
      ['set', 1, ECON.setReward(tier)],
      ['hotels', 5, ECON.hotelsReward(tier)],
    ] as const) {
      if (before.some((l) => l < lvl) && tiles.every((i) => s.properties[i] >= lvl)) {
        const r = this.scaled(reward);
        this.emit({ t: 'setComplete', group, kind, reward: r });
        this.grant(r, kind === 'set' ? 'setComplete' : 'hotelsComplete');
      }
    }
  }

  // Chains are finite: back-3 lands on tax/property/chest, and the chest deck has no back-3.
  private drawCard(deck: 'chance' | 'chest', tile: number, m: number, pips: number) {
    const s = this.s;
    const card: Card = weighted(s, DECKS[deck], (c) => c.w);
    const fx = card.fx;
    const S = this.S;
    const coins = fx.kind === 'coins' ? nice(fx.k * S * m) : 0;
    const n = fx.kind === 'dice' ? fx.n : coins;
    this.emit({ t: 'card', deck, title: card.title, text: card.text.replace('{n}', fmt(n)), icon: card.icon });
    switch (fx.kind) {
      case 'coins':
        return this.addCoins(coins, 'card', tile);
      case 'dice':
        return this.addDice(fx.n, 'card');
      case 'shield':
        if (!this.addShields(1, 'card')) this.addCoins(nice(ECON.cardShieldCoins * S * m), 'card', tile);
        return;
      case 'pack':
        return this.openPack(fx.tier);
      case 'go':
        return this.moveBy(40 - s.position, m, pips);
      case 'rail': {
        const rail = RAILS.find((r) => r > s.position) ?? RAILS[0];
        return this.moveBy((rail - s.position + 40) % 40, m, pips);
      }
      case 'back3':
        return this.moveBack(3, m, pips);
      case 'jail':
        return this.goToJail('card');
      case 'heist':
      case 'raid':
        return this.startMinigame(fx.kind, m);
    }
  }

  // ---------------------------------------------------------------- minigames
  private startMinigame(kind: 'heist' | 'raid', m: number) {
    const s = this.s;
    if (kind === 'heist') {
      const layout = shuffle(s, PRIZES.flatMap((p) => Array<HeistPrize>(ECON.heistDoors[p]).fill(p)));
      s.pending = { kind, rivalId: pick(s, s.rivals).id, doors: Array(12).fill(null), picks: [], layout, m };
    } else {
      const built = s.rivals.filter((r) => r.landmarks.some((l) => l.stage > 0));
      s.pending = { kind, rivalId: pick(s, built.length ? built : s.rivals).id, m };
    }
    this.emit({ t: 'pending', pending: s.pending });
  }

  private rival(id: string) {
    return this.s.rivals.find((r) => r.id === id)!;
  }

  heistPick(door: number): GameEvent[] {
    const s = this.s;
    const p = s.pending;
    if (p?.kind !== 'heist') throw new Error('No heist in progress');
    if (!isInt(door, 0, 11)) throw new Error(`Bad door ${door}`);
    if (p.doors[door] !== null) return [];
    this.ev = [];
    const prize = p.layout[door];
    p.doors[door] = prize;
    p.picks.push(door);
    this.emit({ t: 'heistReveal', door, prize });
    if (p.doors.filter((d) => d === prize).length >= 3) {
      const coins = nice(ECON.heist[prize] * this.S * p.m);
      const r = this.rival(p.rivalId);
      r.coins = Math.max(0, r.coins - coins);
      s.pending = null;
      s.stats.heists++;
      this.emit({ t: 'heistResult', prize, coins, rivalId: r.id });
      this.addCoins(coins, 'heist');
    }
    return this.ev;
  }

  /** target 0..4 = rival landmark, -1 = missed. Shooting an empty plot counts as a miss. */
  raidShoot(target: number): GameEvent[] {
    const s = this.s;
    const p = s.pending;
    if (p?.kind !== 'raid') throw new Error('No raid in progress');
    if (!isInt(target, -1, 4)) throw new Error(`Bad target ${target}`);
    this.ev = [];
    const r = this.rival(p.rivalId);
    const outcome = target < 0 || r.landmarks[target].stage === 0 ? 'miss' : r.shields > 0 ? 'blocked' : 'hit';
    if (outcome === 'blocked') r.shields--;
    if (outcome === 'hit') r.landmarks[target].damaged = true;
    const coins = nice(ECON.raid[outcome] * this.S * p.m);
    s.pending = null;
    s.stats.raids++;
    this.emit({ t: 'raidResult', outcome, coins, rivalId: r.id, target });
    this.addCoins(coins, 'raid');
    return this.ev;
  }

  // ---------------------------------------------------------------- stickers
  private openPack(pack: PackTier) {
    const s = this.s;
    const w = (st: (typeof STICKERS)[number]) => ECON.stickerWeights[st.stars];
    const ids: string[] = [];
    while (ids.length < Math.max(2, pack + 1) - 1) ids.push(weighted(s, STICKERS, w).id);
    ids.push(weighted(s, STICKERS.filter((st) => st.stars >= pack), w).id); // guaranteed ≥pack stars, revealed last
    const newIds = [...new Set(ids.filter((id) => !s.stickers[id]))];
    for (const id of ids) s.stickers[id] = (s.stickers[id] ?? 0) + 1;
    this.emit({ t: 'stickers', pack, ids, newIds });
    STICKER_SETS.forEach((set, i) => {
      if (s.completedSets.includes(set.id)) return;
      if (!STICKERS.every((st) => st.set !== set.id || s.stickers[st.id])) return;
      s.completedSets.push(set.id);
      const reward: Reward = { dice: set.rewardDice, coins: nice(ECON.stickerSetCoins * (i + 1) * this.S) };
      this.emit({ t: 'stickerSetComplete', setId: set.id, reward });
      this.grant(reward, 'stickerSet');
    });
  }

  // ---------------------------------------------------------------- landmarks
  landmarkCost(index: number): number | null {
    const l = this.s.landmarks[index];
    if (!l) return null;
    if (l.damaged) return nice(ECON.repair * stageCost(this.s.city, index, l.stage));
    return l.stage >= 4 ? null : stageCost(this.s.city, index, l.stage + 1);
  }

  buildLandmark(index: number): GameEvent[] {
    const s = this.s;
    const cost = this.landmarkCost(index);
    if (cost === null) throw new Error(`Landmark ${index} is complete`);
    if (s.coins < cost) throw new Error('Not enough coins');
    this.ev = [];
    const l = s.landmarks[index];
    const repaired = l.damaged;
    if (repaired) l.damaged = false;
    else l.stage++;
    this.emit({ t: 'landmark', index, stage: l.stage, cost, repaired });
    this.addCoins(-cost, repaired ? 'repair' : 'build');
    const pack = repaired ? null : ECON.lmPack(l.stage, s.city);
    if (pack) this.openPack(pack);
    if (s.landmarks.every((x) => x.stage === 4 && !x.damaged)) {
      const reward = this.scaled(ECON.cityReward(s.city));
      this.emit({ t: 'cityComplete', city: s.city, reward });
      this.grant(reward, 'cityComplete');
      s.city++;
      s.stats.citiesDone++;
      s.properties = Array(40).fill(0);
      s.landmarks = emptyLandmarks();
      nudgeRivals(s);
      this.emit({ t: 'newCity', city: s.city });
    }
    return this.ev;
  }

  // ---------------------------------------------------------------- misc
  rentFor(tile: number): number {
    const s = this.s;
    const def = BOARD[tile];
    const S = this.S;
    switch (def.kind) {
      case 'property':
        return rent(s.city, def.tier!, Math.min(5, s.properties[tile] + 1));
      case 'utility':
        return nice(7 * ECON.utilityPip * def.tier! * S);
      case 'go':
        return nice(ECON.landGo * S);
      case 'park':
        return nice(ECON.park * S);
      case 'tax':
        return -nice(ECON.taxPerTier * def.tier! * S);
      default:
        return 0;
    }
  }

  netWorth(): number {
    const s = this.s;
    let w = s.coins;
    s.landmarks.forEach((l, i) => {
      for (let st = 1; st <= l.stage; st++) w += stageCost(s.city, i, st);
    });
    s.properties.forEach((lvl, i) => {
      if (lvl) w += rent(s.city, BOARD[i].tier!, lvl);
    });
    return w;
  }

  claimGift(): GameEvent[] {
    const s = this.s;
    const now = this.clock();
    if (now < s.giftAt) throw new Error('Gift not ready');
    this.ev = [];
    s.giftAt = now + ECON.giftMs;
    const g = ECON.gift;
    const reward: Reward = { dice: g.dice, coins: nice(g.coins * this.S) };
    if (rand(s) < g.packChance) reward.packs = [randInt(s, 1, 2) as PackTier];
    this.emit({ t: 'gift', reward });
    this.grant(reward, 'gift');
    return this.ev;
  }

  markNewsSeen(): void {
    for (const n of this.s.news) n.seen = true;
  }

  save(): string {
    return JSON.stringify(this.s);
  }
}

/**
 * New game, or resume from `saveJson` (validated field by field; corrupt saves start fresh).
 * `clock` is for tests/sims; the game otherwise uses Date.now().
 */
export function createGame(saveJson?: string | null, seed?: number, clock: () => number = Date.now): IGame {
  const fresh = freshState((seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0, clock());
  let raw: unknown = null;
  try {
    raw = saveJson ? JSON.parse(saveJson) : null;
  } catch {
    raw = null;
  }
  return new Game(migrate(raw, fresh), clock);
}
