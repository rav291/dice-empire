import './styles/tokens.css';
import './ui/ui.css';
import './ui/hud.css';
import type { AssetManifest, GameEvent, IBoardView, IGame, ScreenDeps, SoundKey } from './contract';
import { createGame } from './core';
import { BoardView } from './board';
import { icon, loadManifest } from './shared/manifest';
import { play as sfx, preloadAudio, setMusicEnabled, setSfxEnabled, startMusic, unlockAudio } from './audio/sfx';
import { Director } from './ui/director';
import { Hud } from './ui/hud';
import { floatText, initFx, rectCenter, shake, wait } from './ui/fx';
import {
  closeTopModal, giftWaitModal, initModals, newsModal, outOfDiceModal, overlayOpen, settings, settingsModal,
} from './ui/modals';
import { TitleScreen } from './ui/title';
import { openAlbum } from './ui/screens/album';
import { openBuild } from './ui/screens/build';
import { runHeist } from './ui/screens/heist';
import { runRaid } from './ui/screens/raid';

const SAVE_KEY = 'dice-empire-save';
const SOUNDS: SoundKey[] = [
  'click', 'roll', 'dice_land', 'hop', 'coin', 'coins_big', 'upgrade', 'set_complete', 'card', 'chest', 'tax', 'jail',
  'door', 'heist_win', 'cannon', 'explosion', 'blocked', 'build', 'city_complete', 'sticker', 'error', 'whoosh', 'popup',
];
const PRELOAD_ICONS = [
  'coin', 'dice', 'shield', 'gift', 'news', 'album', 'build', 'gear', 'avatar_tiger', 'hourglass', 'sound_on', 'sound_off',
  'chance', 'house', 'hotel', 'go', 'trophy', 'party', 'glow_star', 'money_bag', 'gem', 'crown', 'star',
];

const $ = (id: string) => document.getElementById(id)!;
const app = $('app'), host = $('board-host'), hudLayer = $('hud'), overlay = $('overlay'), fxLayer = $('fx');

initFx(fxLayer);
initModals(overlay, (k) => sfx(k));
const applyAudio = () => { setSfxEnabled(settings.sound); setMusicEnabled(settings.music); };
applyAudio();

function loadGame(): IGame {
  let saved: string | null = null;
  try { saved = localStorage.getItem(SAVE_KEY); } catch { /* storage blocked */ }
  try { return createGame(saved); } catch (e) {
    console.warn('[save] unreadable, starting fresh', e);
    return createGame(null);
  }
}

const preloadImg = (src: string) => { const i = new Image(); i.src = src; return i.decode().catch(() => undefined); };

async function boot() {
  const title = new TitleScreen(app);
  let manifest: AssetManifest, board: IBoardView, game: IGame;
  try {
    manifest = await loadManifest();
    title.progress(0.06);
    board = new BoardView();
    await board.init(host, { onProgress: (p) => title.progress(0.06 + Math.max(0, Math.min(1, p)) * 0.84) });
    game = loadGame();
    board.sync(game.state);
    board.setQuality(settings.quality);
    title.progress(0.94);
    await Promise.race([Promise.all([document.fonts.ready, ...PRELOAD_ICONS.map((k) => preloadImg(icon(k)))]), wait(5000)]);
  } catch (e) {
    console.error('[boot]', e);
    title.error('Could not start the game');
    return;
  }
  start(title, manifest, board, game);
}

function start(title: TitleScreen, manifest: AssetManifest, board: IBoardView, game: IGame) {
  let busy = false, auto = false, resetting = false, live = false;
  let afterIdle: (() => void) | null = null;

  const save = () => {
    if (resetting) return;
    try { localStorage.setItem(SAVE_KEY, game.save()); } catch { /* quota / private mode */ }
  };

  const hud = new Hud(hudLayer, game, manifest, {
    roll: () => roll(),
    autoStart: () => void autoLoop(),
    autoStop: () => stopAuto(),
    multiplier: () => {
      const s = game.state;
      const list = game.availableMultipliers();
      const btn = hud.el.querySelector('.hud-mult')!;
      if (s.freeRolls > 0 || list.length < 2) { // locked during a free roll, or not enough dice for x2
        sfx('error');
        shake(btn, 6, 300);
        floatText(s.freeRolls > 0 ? 'FREE ROLL FIRST' : 'NEED 10 DICE', rectCenter(btn), { tone: 'white', size: 0.55, rise: 50, ms: 1100 });
        return;
      }
      game.setMultiplier(list[(list.indexOf(s.multiplier) + 1) % list.length] ?? 1);
      sfx('click');
      save();
      hud.sync();
    },
    build: () => screen(async () => {
      const done = openBuild(deps);
      // Frame the city beside (desktop) or above (phone) the build panel, matching build.css's 760px breakpoint.
      const panel = overlay.querySelector<HTMLElement>('.bd-panel');
      if (panel) {
        const ins = hud.insets();
        board.setInsets(innerWidth >= 760 ? { ...ins, right: panel.offsetWidth + 32 } : { ...ins, bottom: panel.offsetHeight });
      }
      await done;
    }),
    album: () => screen(() => openAlbum(deps)),
    news: () => whenIdle(() => { sfx('click'); newsModal(game, manifest); hud.setNews(0); save(); }),
    gift: () => whenIdle(gift),
    settings: () => {
      stopAuto();
      settingsModal({
        apply: () => { applyAudio(); board.setQuality(settings.quality); },
        onReset: () => {
          resetting = true;
          try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
          location.reload();
        },
      });
    },
  });

  const director = new Director({
    game, board, hud, manifest, shake: app, sfx,
    isAuto: () => auto,
    stopAuto: () => stopAuto(),
    deps: () => deps,
  });

  const deps: ScreenDeps = {
    game, board, manifest, root: overlay,
    play: (ev: GameEvent[]) => director.play(ev),
    sfx: (k) => sfx(k),
    save,
  };

  // -------------------------------------------------------------- actions
  /** Serializes resolved actions: one at a time, saved and synced afterwards. */
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    hud.setBusy(true);
    try { await fn(); } catch (e) { console.error('[action]', e); } finally {
      save();
      busy = false;
      hud.setBusy(false);
      hud.sync();
    }
    const next = afterIdle;
    afterIdle = null;
    next?.();
  }

  /** Build/Album: hide the dock + side buttons while open, restore the board framing after. */
  function screen(fn: () => Promise<void>) {
    whenIdle(() => void run(async () => {
      document.body.classList.add('screen-open');
      try { await fn(); } finally { document.body.classList.remove('screen-open'); layout(); }
    }));
  }

  function whenIdle(fn: () => void) {
    stopAuto();
    if (busy) afterIdle = fn;
    else fn();
  }

  const runPending = async () => {
    const p = game.state.pending;
    if (p) await (p.kind === 'heist' ? runHeist : runRaid)(deps);
  };

  function outOfDice() {
    stopAuto();
    if (!overlayOpen()) outOfDiceModal(game, () => whenIdle(gift));
  }

  async function rollOnce() {
    if (game.state.pending) { stopAuto(); return runPending(); }
    if (!game.canRoll()) return outOfDice();
    const ev = game.roll();
    save();
    await director.play(ev);
  }

  function roll() {
    if (!live || overlayOpen() || busy) return;
    if (!game.state.pending && !game.canRoll()) return outOfDice();
    void run(rollOnce);
  }

  async function autoLoop() {
    if (auto || !live) return;
    if (!game.state.pending && !game.canRoll()) return outOfDice();
    auto = true;
    hud.setAuto(true);
    sfx('popup');
    while (auto) {
      if (overlayOpen()) break;
      if (busy) { await wait(80); continue; }
      if (game.state.pending) { stopAuto(); await run(runPending); break; }
      if (!game.canRoll()) { outOfDice(); break; }
      await run(rollOnce);
      await wait(game.state.multiplier >= 10 ? 90 : 160);
    }
    stopAuto();
  }

  function stopAuto() {
    if (!auto) return;
    auto = false;
    hud.setAuto(false);
  }

  function gift() {
    if (game.state.giftAt > Date.now()) { giftWaitModal(game); return; }
    void run(async () => {
      const ev = game.claimGift();
      save();
      await director.play(ev);
    });
  }

  // -------------------------------------------------------------- layout, input, clock
  const layout = () => board.setInsets(hud.insets());
  layout();
  addEventListener('resize', layout);
  const ro = new ResizeObserver(layout);
  hud.el.querySelectorAll('.hud-top, .hud-dock, .hud-side').forEach((el) => ro.observe(el));

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (closeTopModal()) e.preventDefault(); return; }
    if (!live || e.repeat || !['Space', 'Enter', 'NumpadEnter'].includes(e.code) || overlayOpen()) return;
    const a = document.activeElement;
    const go = hud.el.querySelector('.hud-go');
    if (a && a !== document.body && a !== go && a.closest('button, input, select, textarea')) return; // let focused buttons work
    e.preventDefault();
    if (auto) stopAuto();
    else roll();
  });

  setInterval(() => {
    const ev = game.tick();
    if (ev.length) {
      save();
      for (const e of ev) if (e.t === 'dice') hud.addDice(e.amount, live);
      const rest = ev.filter((e) => e.t !== 'dice');
      if (rest.length && !busy) void run(() => director.play(rest));
    }
    hud.tickTimers();
  }, 1000);

  addEventListener('visibilitychange', () => { if (document.hidden) { stopAuto(); save(); } });
  addEventListener('pagehide', save);

  // -------------------------------------------------------------- title → intro → HUD
  void title.waitForPlay().then(async () => {
    unlockAudio();
    sfx('click');
    void startMusic();
    void preloadAudio(SOUNDS);
    const skip = () => board.skipIntro();
    const hint = document.createElement('div');
    hint.className = 'skip-hint';
    hint.textContent = 'TAP TO SKIP';
    fxLayer.append(hint);
    const leaving = title.leave();
    await wait(120);
    addEventListener('pointerdown', skip);
    addEventListener('keydown', skip);
    try { await board.playIntro(); } catch (e) { console.error('[intro]', e); }
    removeEventListener('pointerdown', skip);
    removeEventListener('keydown', skip);
    hint.remove();
    await leaving;
    sfx('whoosh');
    await hud.show();
    live = true;
    layout();
    hud.sync();
    if (game.state.pending) void run(runPending);
  });

  // debug/automation hook (dev server only)
  if (import.meta.env.DEV) (window as unknown as { __dice?: unknown }).__dice = { game, board, hud, director, isBusy: () => busy, isAuto: () => auto, isLive: () => live };
}

void boot();
