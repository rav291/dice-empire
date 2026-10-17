// FROZEN CONTRACT between src/core (rules), src/board (3D), src/ui (DOM), public/assets.
// Agents: do not rename/remove anything here. If you truly need an addition, add an
// OPTIONAL field/new union member and say so in your final report.

// ---------------------------------------------------------------- board
export type TileKind =
  | 'go' | 'property' | 'rail' | 'utility' | 'chance' | 'chest'
  | 'tax' | 'jail' | 'park' | 'gotojail';

export type ColorGroup = 'brown' | 'sky' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'navy';

export interface TileDef {
  index: number;
  kind: TileKind;
  name: string;
  group?: ColorGroup; // property only
  tier?: number;      // 1..8 value tier (property, rail, utility, tax)
  icon?: IconKey;     // non-property tiles
}

// ---------------------------------------------------------------- icons / sounds
// Icons are Microsoft Fluent Emoji 3D PNGs at /assets/icons/<key>.png
export type IconKey =
  | 'coin' | 'dice' | 'shield' | 'gift' | 'chance' | 'rail' | 'power' | 'water'
  | 'tax' | 'jail' | 'park' | 'go' | 'gotojail' | 'bank' | 'target' | 'bomb' | 'boom'
  | 'medal_gold' | 'medal_silver' | 'medal_bronze' | 'money_bag' | 'gem' | 'crown'
  | 'star' | 'glow_star' | 'trophy' | 'fire' | 'sparkles' | 'party' | 'confetti'
  | 'hourglass' | 'lock' | 'key' | 'house' | 'hotel' | 'construction' | 'album'
  | 'rocket' | 'swords' | 'siren' | 'bell' | 'gear' | 'sound_on' | 'sound_off'
  | 'news' | 'build' | 'clover'
  | 'avatar_fox' | 'avatar_cat' | 'avatar_bear' | 'avatar_panda' | 'avatar_tiger'
  | 'avatar_frog' | 'avatar_unicorn' | 'avatar_lion' | 'avatar_monkey';

// Sounds at /assets/audio/<key>.ogg ('music' is a seamless loop)
export type SoundKey =
  | 'click' | 'roll' | 'dice_land' | 'hop' | 'coin' | 'coins_big' | 'upgrade'
  | 'set_complete' | 'card' | 'chest' | 'tax' | 'jail' | 'door' | 'heist_win'
  | 'cannon' | 'explosion' | 'blocked' | 'build' | 'city_complete' | 'sticker'
  | 'error' | 'whoosh' | 'popup' | 'music';

// ---------------------------------------------------------------- state
export interface LandmarkState {
  stage: number;     // 0 = empty plot .. 4 = complete
  damaged: boolean;  // after a rival raid; must be repaired before next stage
}

export interface Rival {
  id: string;
  name: string;
  avatar: IconKey;
  city: number;                 // rival's current city index
  landmarks: LandmarkState[];   // length 5
  shields: number;              // 0..3
  coins: number;                // their "vault" for heists
}

export interface NewsItem {
  id: string;
  at: number;                   // ms epoch
  rivalId: string;
  kind: 'raid' | 'heist';
  blocked: boolean;             // a shield blocked it
  coinsLost: number;
  landmark?: number;            // raid target index
  seen: boolean;
}

export type PackTier = 1 | 2 | 3 | 4 | 5; // green, yellow, pink, blue, gold — # of guaranteed stars

export interface Reward {
  coins?: number;
  dice?: number;
  shields?: number;
  packs?: PackTier[];
}

export type HeistPrize = 'bronze' | 'silver' | 'gold';

export type Pending =
  | { kind: 'heist'; rivalId: string; doors: (HeistPrize | null)[]; /* null = unopened, length 12 */ picks: number[] }
  | { kind: 'raid'; rivalId: string };

export interface GameState {
  version: 1;
  seed: number;
  coins: number;
  dice: number;
  diceMax: number;           // regen cap (rewards may exceed it)
  lastRegenAt: number;       // ms epoch
  multiplier: number;        // selected multiplier
  shields: number;           // 0..3
  position: number;          // tile index
  jailTurns: number;         // > 0 while in jail = attempts left
  doublesStreak: number;
  freeRolls: number;         // doubles grant free rolls (no dice cost)
  properties: number[];      // length 40; 0 unowned, 1 owned, 2..4 = 1..3 houses, 5 hotel (non-property tiles stay 0)
  city: number;              // 0-based, unbounded (themes cycle)
  landmarks: LandmarkState[]; // length 5, current city
  stickers: Record<string, number>; // sticker id -> copies owned
  completedSets: string[];
  rivals: Rival[];
  news: NewsItem[];
  giftAt: number;            // ms epoch when free gift is claimable
  pending: Pending | null;
  stats: { rolls: number; heists: number; raids: number; citiesDone: number };
}

// ---------------------------------------------------------------- events
// roll()/heistPick()/raidShoot()/buildLandmark()/tick()/claimGift() return ordered events.
// The UI "director" plays them in order (dice → move → land → rewards …).
export type GameEvent =
  | { t: 'roll'; d1: number; d2: number; doubles: boolean; cost: number; free: boolean; multiplier: number }
  | { t: 'move'; from: number; to: number; path: number[] }   // path excludes from, includes to
  | { t: 'passGo'; coins: number }
  | { t: 'land'; tile: number }
  | { t: 'coins'; amount: number; reason: string; tile?: number }   // signed delta
  | { t: 'dice'; amount: number; reason: string }                   // signed delta
  | { t: 'shield'; amount: number; total: number; reason: string }
  | { t: 'property'; tile: number; level: number; prevLevel: number }
  | { t: 'setComplete'; group: ColorGroup; kind: 'set' | 'hotels'; reward: Reward }
  | { t: 'card'; deck: 'chance' | 'chest'; title: string; text: string; icon: IconKey }
  | { t: 'tax'; tile: number; amount: number }
  | { t: 'jail'; reason: 'gotojail' | 'doubles' | 'card' }
  | { t: 'jailRoll'; escaped: boolean; attemptsLeft: number }
  | { t: 'doubles'; streak: number }                     // free roll granted
  | { t: 'pending'; pending: Pending }                   // minigame starts; roll() blocked until resolved
  | { t: 'heistReveal'; door: number; prize: HeistPrize }
  | { t: 'heistResult'; prize: HeistPrize; coins: number; rivalId: string }
  | { t: 'raidResult'; outcome: 'hit' | 'blocked' | 'miss'; coins: number; rivalId: string; target: number }
  | { t: 'stickers'; pack: PackTier; ids: string[]; newIds: string[] }
  | { t: 'stickerSetComplete'; setId: string; reward: Reward }
  | { t: 'landmark'; index: number; stage: number; cost: number; repaired: boolean }
  | { t: 'cityComplete'; city: number; reward: Reward }
  | { t: 'newCity'; city: number }
  | { t: 'attacked'; news: NewsItem }
  | { t: 'gift'; reward: Reward };

// ---------------------------------------------------------------- core API (src/core/index.ts exports createGame)
export interface IGame {
  readonly state: Readonly<GameState>;
  readonly board: readonly TileDef[];
  tick(now?: number): GameEvent[];          // dice regen; call ~1/s
  nextDieAt(): number | null;               // ms epoch of next regen, null if at cap
  canRoll(): boolean;
  availableMultipliers(): number[];         // ascending, always includes 1
  setMultiplier(m: number): void;
  roll(): GameEvent[];                      // throws if !canRoll()
  heistPick(door: number): GameEvent[];     // only while pending.kind === 'heist'
  raidShoot(target: number): GameEvent[];   // 0..4 landmark index, -1 = missed; only while pending.kind === 'raid'
  landmarkCost(index: number): number | null; // next stage or repair cost; null when complete
  buildLandmark(index: number): GameEvent[]; // throws if unaffordable
  rentFor(tile: number): number;            // coins at x1 for landing now (tooltips)
  netWorth(): number;
  claimGift(): GameEvent[];                 // throws if Date.now() < state.giftAt
  markNewsSeen(): void;
  save(): string;                           // JSON for localStorage
}
// export function createGame(saveJson?: string | null, seed?: number): IGame;

// ---------------------------------------------------------------- 3D board API (src/board/index.ts exports class BoardView)
export interface IBoardView {
  init(container: HTMLElement, opts?: { onProgress?: (p: number) => void }): Promise<void>;
  sync(state: Readonly<GameState>): void;   // instant, no animation (load / new city)
  playIntro(): Promise<void>;               // cinematic fly-over; resolves when done
  skipIntro(): void;
  rollDice(d1: number, d2: number): Promise<void>;
  moveToken(path: number[], opts?: { fast?: boolean }): Promise<void>;
  jumpToken(tile: number): Promise<void>;   // jail teleport
  setPropertyLevel(tile: number, level: number): Promise<void>;
  setLandmark(index: number, stage: number, damaged: boolean): Promise<void>;
  setCity(city: number): Promise<void>;     // animated theme switch
  setView(view: 'board' | 'city'): Promise<void>;
  tileToScreen(tile: number): { x: number; y: number };     // CSS px, viewport
  landmarkToScreen(index: number): { x: number; y: number };
  pulseTile(tile: number, color?: string): void;
  setQuality(q: 'high' | 'low'): void;
  /** CSS px covered by HUD on each edge; camera frames the board inside the remaining area. */
  setInsets(insets: { top: number; right: number; bottom: number; left: number }): void;
  /** offscreen render of a landmark model (manifest key) at a stage → transparent PNG data URL, ~512px. Cached. */
  renderLandmarkThumbnail(key: string, stage: number, damaged?: boolean): Promise<string>;
}

// ---------------------------------------------------------------- UI screens (src/ui/screens/*)
export interface ScreenDeps {
  game: IGame;
  board: IBoardView;
  manifest: AssetManifest;
  root: HTMLElement;                                 // overlay layer to mount into
  play: (events: GameEvent[]) => Promise<void>;      // director presents generic events
  sfx: (key: SoundKey) => void;
  save: () => void;                                  // persist after state changes
}
// Director.play() IGNORES these types — the screen that triggered them presents them itself:
//   heistReveal, heistResult (heist screen) · raidResult (raid screen) · landmark (build screen)
// Screens pass every other event they receive (coins, stickers, cityComplete, newCity, …) to deps.play().

// ---------------------------------------------------------------- asset manifest (/assets/manifest.json)
export interface TextureSet { color: string; normal?: string; rough?: string; ao?: string }

export interface CityTheme {
  name: string;
  landmarks: [string, string, string, string, string]; // keys into models.landmarks
  sky: [string, string];     // top, bottom hex
  accent: string;            // UI accent hex
}

export interface AssetManifest {
  hdri: string;
  textures: Record<string, TextureSet>;  // at least: wood, felt, ground, metal
  models: {
    token: string;
    house: string;
    hotel: string;
    decor: string[];                     // trees/props for board surroundings
    landmarks: Record<string, { file: string; name: string; scale?: number }>;
  };
  cities: CityTheme[];                   // >= 6
  music: string[];                       // optional extra tracks
}
