// Dev harness for the board (board-test.html). Exposes window.board / window.dev for automation.
import type { GameState } from '../contract';
import { BOARD as DEFS } from '../shared/board-data';
import { cityTheme, loadManifest } from '../shared/manifest';
import { BoardView } from './index';

const board = new BoardView();
const stage = document.getElementById('stage')!;
const panel = document.getElementById('panel')!;
const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');

const state = {
  position: 0,
  properties: new Array(40).fill(0) as number[],
  city: 0,
  landmarks: Array.from({ length: 5 }, () => ({ stage: 0, damaged: false })),
};
const asGame = () => state as unknown as GameState;
let fast = false;
let hud = params.has('hud');
let busy = false;

const rnd = (n: number) => 1 + Math.floor(Math.random() * n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step<T>(fn: () => Promise<T>) {
  if (busy) return;
  busy = true;
  try { await fn(); } finally { busy = false; }
}

const dev = {
  async roll(d1 = rnd(6), d2 = rnd(6)) {
    await board.rollDice(d1, d2);
    await dev.move(d1 + d2);
  },
  async move(n: number) {
    const path = Array.from({ length: Math.abs(n) }, (_, i) => (state.position + (n > 0 ? i + 1 : -(i + 1)) + 40) % 40);
    await board.moveToken(path, { fast });
    state.position = path[path.length - 1];
    const def = DEFS[state.position];
    board.pulseTile(state.position, def.kind === 'property' ? '#ffe27a' : '#7cf5ff');
    if (def.kind === 'property') {
      const lv = Math.min(5, state.properties[state.position] + 1);
      state.properties[state.position] = lv;
      await board.setPropertyLevel(state.position, lv);
    } else board.burstCoins(state.position);
  },
  async jail() {
    await board.jumpToken(10);
    state.position = 10;
  },
  async hotels() {
    const props = DEFS.filter((d) => d.kind === 'property');
    await Promise.all(props.map(async (d, i) => {
      await sleep(i * 60);
      state.properties[d.index] = 5;
      await board.setPropertyLevel(d.index, 5);
    }));
  },
  mixedProps() {
    DEFS.forEach((d) => { if (d.kind === 'property') state.properties[d.index] = 1 + (d.index % 5); });
    board.sync(asGame());
  },
  resetProps() {
    state.properties.fill(0);
    board.sync(asGame());
  },
  async build(i: number) {
    const l = state.landmarks[i];
    if (l.damaged) l.damaged = false;
    else l.stage = Math.min(4, l.stage + 1);
    await board.setLandmark(i, l.stage, l.damaged);
  },
  async damage(i: number) {
    const l = state.landmarks[i];
    if (l.stage === 0) l.stage = 3;
    l.damaged = true;
    await board.setLandmark(i, l.stage, true);
  },
  async allStage(s: number) {
    await Promise.all(state.landmarks.map(async (l, i) => {
      await sleep(i * 120);
      l.stage = s; l.damaged = false;
      await board.setLandmark(i, s, false);
    }));
  },
  async city(delta: number) {
    state.city = Math.max(0, state.city + delta);
    await board.setCity(state.city);
  },
  view: (v: 'board' | 'city') => board.setView(v),
  intro: () => board.playIntro(),
  skip: () => board.skipIntro(),
  quality: (q: 'high' | 'low') => board.setQuality(q),
  toggleHud() {
    hud = !hud;
    applyInsets();
  },
  async thumbs() {
    const g = document.getElementById('gallery')!;
    g.style.display = 'flex';
    g.innerHTML = '';
    const m = await loadManifest().catch(() => null);
    const keys = m ? cityTheme(m, state.city).landmarks : ['lm_a', 'lm_b', 'lm_c', 'lm_d', 'lm_e'];
    const t0 = performance.now();
    for (const k of keys) {
      for (const [s, dmg] of [[0, false], [1, false], [2, false], [3, false], [4, false], [4, true]] as const) {
        const url = await board.renderLandmarkThumbnail(k, s, dmg);
        const f = document.createElement('figure');
        f.innerHTML = `<img src="${url}"><figcaption>${k} s${s}${dmg ? ' dmg' : ''}</figcaption>`;
        g.appendChild(f);
      }
    }
    console.info(`[dev] thumbnails in ${(performance.now() - t0).toFixed(0)} ms`);
  },
  hideThumbs() { document.getElementById('gallery')!.style.display = 'none'; },
  state,
};
Object.assign(window, { board, dev });

function applyInsets() {
  const portrait = innerHeight > innerWidth;
  const ins = hud ? (portrait ? { top: 96, right: 0, bottom: 190, left: 0 } : { top: 80, right: 0, bottom: 150, left: 0 }) : { top: 0, right: 0, bottom: 0, left: 0 };
  board.setInsets(ins);
  const t = document.getElementById('in-top')!, b = document.getElementById('in-bottom')!;
  Object.assign(t.style, { display: hud ? 'block' : 'none', left: '0', right: '0', top: '0', height: `${ins.top}px` });
  Object.assign(b.style, { display: hud ? 'block' : 'none', left: '0', right: '0', bottom: '0', height: `${ins.bottom}px` });
}
addEventListener('resize', applyInsets);
addEventListener('keydown', (e) => { if (e.key === 'h') document.body.classList.toggle('clean'); });

function ui() {
  const btn = (label: string, fn: () => unknown) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => void step(async () => { await fn(); });
    return b;
  };
  const row = (title: string, ...els: HTMLElement[]) => {
    const h = document.createElement('h4');
    h.textContent = title;
    const d = document.createElement('div');
    d.append(...els);
    panel.append(h, d);
  };
  const num = (v: number, min: number, max: number) => {
    const i = document.createElement('input');
    i.type = 'number'; i.value = String(v); i.min = String(min); i.max = String(max);
    return i;
  };
  const stats = document.createElement('div');
  stats.id = 'stats';
  panel.append(stats);
  setInterval(() => {
    const s = board.stats;
    stats.textContent = `${s.fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms · ${s.quality} · pr ${s.pixelRatio.toFixed(2)} · ${s.calls} calls`;
  }, 500);

  const steps = num(5, -12, 40);
  const fastBtn = btn('fast: off', () => { fast = !fast; fastBtn.textContent = `fast: ${fast ? 'on' : 'off'}`; });
  row('Dice & token', btn('Roll random', () => dev.roll()), btn('Roll 6+6', () => dev.roll(6, 6)), steps,
    btn('Move N', () => dev.move(+steps.value)), btn('Jail jump', () => dev.jail()), fastBtn);

  const tile = num(1, 0, 39), lvl = num(1, 0, 5);
  row('Properties', tile, lvl, btn('Set level', async () => {
    state.properties[+tile.value] = +lvl.value;
    await board.setPropertyLevel(+tile.value, +lvl.value);
  }), btn('Hotels everywhere', () => dev.hotels()), btn('Mixed (sync)', () => dev.mixedProps()), btn('Reset', () => dev.resetProps()),
  btn('Pulse tile', () => board.pulseTile(+tile.value)), btn('Coins', () => board.burstCoins(+tile.value)));

  const lmEls: HTMLElement[] = [];
  for (let i = 0; i < 5; i++) lmEls.push(btn(`Build ${i}`, () => dev.build(i)));
  for (let i = 0; i < 5; i++) lmEls.push(btn(`Dmg ${i}`, () => dev.damage(i)));
  row('Landmarks', ...lmEls, btn('All → 4', () => dev.allStage(4)), btn('All → 0', () => dev.allStage(0)), btn('Celebrate', () => board.celebrate()));

  row('City & camera', btn('◀ City', () => dev.city(-1)), btn('City ▶', () => dev.city(1)), btn('City view', () => dev.view('city')),
    btn('Board view', () => dev.view('board')), btn('Intro', () => dev.intro()), btn('Skip intro', () => dev.skip()), btn('HUD insets', () => dev.toggleHud()));
  row('Render', btn('Thumbnails', () => dev.thumbs()), btn('Hide thumbs', () => dev.hideThumbs()), btn('High', () => dev.quality('high')), btn('Low', () => dev.quality('low')));

  // tileToScreen probe: click a tile number to drop a DOM marker
  const probe = document.createElement('div');
  Object.assign(probe.style, { position: 'fixed', width: '14px', height: '14px', margin: '-7px', borderRadius: '50%', background: '#ff2d6f', zIndex: '8', pointerEvents: 'none', display: 'none' });
  document.body.appendChild(probe);
  row('Projection', btn('tileToScreen', () => {
    const p = board.tileToScreen(+tile.value);
    Object.assign(probe.style, { left: `${p.x}px`, top: `${p.y}px`, display: 'block' });
  }), btn('landmarkToScreen 1', () => {
    const p = board.landmarkToScreen(1);
    Object.assign(probe.style, { left: `${p.x}px`, top: `${p.y}px`, display: 'block' });
  }));
}

(async () => {
  const pct = document.getElementById('pct')!;
  const t0 = performance.now();
  await board.init(stage, { onProgress: (p) => { pct.textContent = `${Math.round(p * 100)}%`; } });
  console.info(`[dev] board ready in ${(performance.now() - t0).toFixed(0)} ms`);
  document.getElementById('loading')!.remove();
  applyInsets();
  board.sync(asGame());
  ui();
  (window as unknown as { boardReady: boolean }).boardReady = true;
  if (params.has('intro')) void board.playIntro();
})();
