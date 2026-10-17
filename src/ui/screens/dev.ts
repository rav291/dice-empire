// Screens harness (screens-test.html only — never imported by the game).
// Real core; real BoardView when src/board/index.ts exists, else a tiny stand-in below.
import '../../styles/tokens.css';
import type { AssetManifest, GameEvent, IBoardView, IGame, PackTier, ScreenDeps } from '../../contract';
import { play as playSfx, unlockAudio } from '../../audio/sfx';
import { loadManifest } from '../../shared/manifest';
import { STICKERS } from '../../shared/stickers';
import { openAlbum } from './album';
import { openBuild } from './build';
import { runHeist } from './heist';
import { showPackOpening } from './packs';
import { runRaid } from './raid';

type CreateGame = (save?: string | null, seed?: number) => IGame;
const cores = import.meta.glob<{ createGame: CreateGame }>('../../core/index.ts');
const boards = import.meta.glob<{ BoardView: new () => IBoardView }>('../../board/index.ts');

const SAVE_KEY = 'dice-empire-screens-save';
const params = new URLSearchParams(location.search);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const FALLBACK: AssetManifest = {
  hdri: '',
  textures: {},
  music: [],
  models: {
    token: '', house: '', hotel: '', decor: [],
    landmarks: Object.fromEntries(
      [['clock', 'Clock Tower'], ['bridge', 'Harbor Bridge'], ['ferris', 'Big Wheel'], ['dome', 'Grand Dome'], ['statue', 'Liberty Lady']]
        .map(([k, name]) => [k, { file: '', name }]),
    ),
  },
  cities: [
    { name: 'Sunny Bay', landmarks: ['clock', 'bridge', 'ferris', 'dome', 'statue'], sky: ['#3aa8ff', '#cdeeff'], accent: '#ffcc2e' },
    { name: 'Neon Heights', landmarks: ['dome', 'statue', 'clock', 'ferris', 'bridge'], sky: ['#5a2dbf', '#ff9ad5'], accent: '#ff5fb0' },
  ],
};

/** Stand-in board for the harness: resolved promises + canvas-drawn landmark thumbnails. */
function fakeBoard(): IBoardView {
  const cache = new Map<string, string>();
  const draw = (key: string, stage: number, damaged: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
    g.fillStyle = '#5cb84e';
    g.beginPath(); g.ellipse(128, 222, 100, 26, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < stage; i++) {
      const w = 120 - i * 18, y = 210 - (i + 1) * 40;
      const grad = g.createLinearGradient(128 - w / 2, 0, 128 + w / 2, 0);
      grad.addColorStop(0, `hsl(${h},70%,${damaged ? 30 : 62}%)`);
      grad.addColorStop(1, `hsl(${h},70%,${damaged ? 18 : 42}%)`);
      g.fillStyle = grad;
      g.fillRect(128 - w / 2, y, w, 40);
      g.fillStyle = 'rgba(255,255,220,.8)';
      for (let x = 128 - w / 2 + 10; x < 128 + w / 2 - 10; x += 20) g.fillRect(x, y + 12, 9, 14);
    }
    if (stage) {
      const top = 210 - stage * 40;
      g.fillStyle = `hsl(${(h + 40) % 360},80%,${damaged ? 25 : 55}%)`;
      g.beginPath(); g.moveTo(128 - 40, top); g.lineTo(128, top - 50); g.lineTo(128 + 40, top); g.fill();
    }
    if (damaged) {
      g.strokeStyle = '#111'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(100, 120); g.lineTo(130, 150); g.lineTo(115, 175); g.lineTo(150, 205); g.stroke();
    }
    return c.toDataURL();
  };
  const noop = async () => {};
  return {
    init: noop, sync() {}, playIntro: noop, skipIntro() {}, rollDice: noop, moveToken: noop, jumpToken: noop,
    setPropertyLevel: noop, setLandmark: () => wait(300), setCity: noop, setView: noop,
    tileToScreen: () => ({ x: 0, y: 0 }), landmarkToScreen: () => ({ x: 0, y: 0 }), pulseTile() {}, setQuality() {}, setInsets() {},
    async renderLandmarkThumbnail(key, stage, damaged = false) {
      const k = `${key}:${stage}:${damaged}`;
      if (!cache.has(k)) { await wait(250 + Math.random() * 500); cache.set(k, draw(key, stage, damaged)); }
      return cache.get(k)!;
    },
  };
}

async function main() {
  const coreLoader = cores['../../core/index.ts'];
  if (!coreLoader) {
    document.getElementById('dev')!.textContent = 'Waiting for src/core/index.ts…';
    setTimeout(() => location.reload(), 3000);
    return;
  }
  const { createGame } = await coreLoader();
  const manifest = await loadManifest().then((m) => (m?.cities?.length ? m : FALLBACK)).catch(() => FALLBACK);
  const root = document.getElementById('overlay')!;
  const host = document.getElementById('board-host')!;
  let game = createGame(localStorage.getItem(SAVE_KEY));

  let board = fakeBoard();
  const boardLoader = boards['../../board/index.ts'];
  if (boardLoader && !params.has('fakeboard')) {
    try {
      const { BoardView } = await boardLoader();
      const b = new BoardView();
      await b.init(host);
      b.sync(game.state);
      board = b;
    } catch (e) {
      console.warn('[dev] BoardView failed, using stand-in', e);
    }
  }

  const save = () => { try { localStorage.setItem(SAVE_KEY, game.save()); } catch { /* private mode */ } };
  const deps = (): ScreenDeps => ({ game, board, manifest, root, play: present, sfx: (k) => playSfx(k), save });
  async function present(events: GameEvent[]) {
    for (const ev of events) {
      console.info('[play]', ev.t, JSON.stringify(ev));
      if (ev.t === 'stickers') await showPackOpening(deps(), ev);
      else await wait(60);
    }
  }
  /** Edit the save JSON and reload the game from it (the "crafted save" route). */
  const craft = (fn: (s: any) => void) => {
    const s = JSON.parse(game.save());
    fn(s);
    game = createGame(JSON.stringify(s));
    save();
    board.sync(game.state);
  };
  const force = (kind: 'heist' | 'raid') => {
    for (let i = 0; i < 6000; i++) {
      const p = game.state.pending;
      if (p?.kind === kind) return;
      if (p?.kind === 'heist') { for (let d = 0; d < 12 && game.state.pending; d++) game.heistPick(d); continue; }
      if (p?.kind === 'raid') { game.raidShoot(-1); continue; }
      if (!game.canRoll()) craft((s) => { s.dice = 100000; s.freeRolls = 0; });
      game.roll();
    }
  };
  const rival = (s: any) => s.rivals.find((r: any) => r.id === s.pending.rivalId);

  let current: Promise<void> | null = null;
  const run = (p: Promise<void>) => { current = p.finally(() => { current = null; save(); }); };

  const dev = {
    get game() { return game; },
    get busy() { return !!current; },
    reset() { localStorage.removeItem(SAVE_KEY); game = createGame(null, 7); save(); board.sync(game.state); },
    heist(opened = 0) {
      if (game.state.pending?.kind !== 'heist') force('heist');
      for (let d = 0, n = 0; d < 12 && n < opened; d++) {
        const p = game.state.pending;
        if (p?.kind !== 'heist' || p.doors[d]) continue;
        const prize = (p as any).layout[d];
        if (p.doors.filter((x) => x === prize).length >= 2) continue; // never finish it here
        game.heistPick(d);
        n++;
      }
      save();
      run(runHeist(deps()));
    },
    raid(shields = 0) {
      if (game.state.pending?.kind !== 'raid') force('raid');
      craft((s) => {
        const r = rival(s);
        r.shields = shields;
        r.landmarks = [{ stage: 4, damaged: false }, { stage: 3, damaged: false }, { stage: 2, damaged: true }, { stage: 4, damaged: false }, { stage: 1, damaged: false }];
      });
      run(runRaid(deps()));
    },
    build(preset: 'fresh' | 'mixed' | 'almost' | 'poor' = 'mixed') {
      craft((s) => {
        s.pending = null;
        s.coins = preset === 'poor' ? 900 : 50_000_000;
        s.landmarks = preset === 'fresh' ? Array.from({ length: 5 }, () => ({ stage: 0, damaged: false }))
          : preset === 'almost' ? [4, 4, 4, 4, 3].map((stage) => ({ stage, damaged: false }))
          : [{ stage: 4, damaged: false }, { stage: 2, damaged: true }, { stage: 1, damaged: false }, { stage: 0, damaged: false }, { stage: 3, damaged: false }];
        if (preset === 'poor') s.landmarks[1].damaged = false;
      });
      run(openBuild(deps()));
    },
    album() {
      craft((s) => {
        s.stickers = {};
        STICKERS.forEach((st, i) => {
          const n = st.set === 'snacks' ? 1 + (i % 3) : (i * 7) % 5 < 2 + (st.stars < 3 ? 1 : 0) ? 1 + (i % 2) : 0;
          if (n) s.stickers[st.id] = n;
        });
        s.completedSets = ['snacks'];
      });
      run(openAlbum(deps()));
    },
    pack(tier: PackTier = 3) {
      const pool = STICKERS.filter((x) => x.stars <= tier + 1);
      const ids = Array.from({ length: Math.max(2, tier + 1) - 1 }, (_, i) => pool[(i * 11 + tier * 5 + Date.now()) % pool.length].id);
      ids.push(STICKERS.filter((x) => x.stars >= tier)[tier % 3].id);
      const newIds = [...new Set(ids.filter((id) => !game.state.stickers[id]))];
      craft((s) => { for (const id of ids) s.stickers[id] = (s.stickers[id] ?? 0) + 1; });
      run(showPackOpening(deps(), { t: 'stickers', pack: tier, ids, newIds }));
    },
  };
  (window as any).dev = dev;

  const bar = document.getElementById('dev')!;
  const btns: [string, () => void, string?][] = [
    ['Heist', () => dev.heist()], ['Heist (resume 2)', () => dev.heist(2)],
    ['Raid', () => dev.raid(0), 'btn-red'], ['Raid (shield)', () => dev.raid(2), 'btn-red'],
    ['Build', () => dev.build('mixed'), 'btn-go'], ['Build (almost)', () => dev.build('almost'), 'btn-go'], ['Build (poor)', () => dev.build('poor'), 'btn-go'],
    ['Album', () => dev.album(), 'btn-purple'],
    ...([1, 2, 3, 4, 5] as PackTier[]).map((t): [string, () => void, string] => [`Pack ${t}`, () => dev.pack(t), 'btn-orange']),
    ['Reset', () => dev.reset(), 'btn-red'],
  ];
  for (const [label, fn, cls] of btns) {
    const b = document.createElement('button');
    b.className = `btn ${cls ?? ''}`;
    b.textContent = label;
    b.onclick = () => { unlockAudio(); if (!current) fn(); };
    bar.appendChild(b);
  }
  addEventListener('pointerdown', unlockAudio, { once: true });
  document.body.dataset.ready = '1';
}

void main();
