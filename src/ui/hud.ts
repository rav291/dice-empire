// In-game HUD: wallet, shields, side buttons, GO (tap = roll, hold = auto), multiplier, dice + regen.
import type { AssetManifest, IconKey, IGame } from '../contract';
import { cityTheme } from '../shared/manifest';
import { STICKERS } from '../shared/stickers';
import { fmt, fmtCounter, fmtTime } from './format';
import { img, pop, rectCenter, reduced, shake, type Pt } from './fx';

export interface HudHandlers {
  roll(): void;
  autoStart(): void;
  autoStop(): void;
  multiplier(): void;
  build(): void;
  album(): void;
  news(): void;
  gift(): void;
  settings(): void;
}

const HOLD_MS = 600;
const AVATARS: IconKey[] = ['avatar_lion', 'avatar_unicorn', 'avatar_tiger', 'avatar_fox', 'avatar_cat', 'avatar_bear', 'avatar_panda', 'avatar_frog', 'avatar_monkey'];

export class Hud {
  readonly el: HTMLElement;
  private $ = <T extends HTMLElement = HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private coin = { shown: 0, from: 0, to: 0, t0: 0, dur: 0, raf: 0 };
  private dice = 0;
  private shields = -1;
  private auto = false;
  private busy = false;
  private holdTimer = 0;
  private swallowUp = false;

  constructor(parent: HTMLElement, private game: IGame, private manifest: AssetManifest, private on: HudHandlers) {
    const used = new Set(game.state.rivals.map((r) => r.avatar));
    const me = AVATARS.find((a) => !used.has(a)) ?? 'avatar_lion';
    const side = (act: string, key: IconKey, label: string, extra = '') =>
      `<button class="hud-side-btn" data-act="${act}" aria-label="${label}">${img(key, 'hud-side-ic')}<span class="hud-lbl">${label}</span>${extra}</button>`;
    const el = (this.el = document.createElement('div'));
    el.className = 'hud';
    el.dataset.state = 'hidden';
    el.innerHTML = `
      <header class="hud-top">
        <div class="hud-player">
          <div class="hud-avatar">${img(me)}<span class="hud-level" aria-label="City level"></span></div>
          <div class="hud-nw"><small>NET WORTH</small><b class="hud-nw-val">0</b><span class="hud-city"></span></div>
        </div>
        <div class="hud-wallet">
          <div class="hud-coins" aria-live="off">${img('coin', 'hud-coin-ic')}<b class="hud-coin-val">0</b></div>
          <div class="hud-shields" role="img" aria-label="Shields">
            ${[0, 1, 2].map((i) => `<span class="hud-shield" data-i="${i}">${img('shield')}</span>`).join('')}
          </div>
        </div>
        <button class="hud-round" data-act="settings" aria-label="Settings">${img('gear')}</button>
      </header>
      <nav class="hud-side hud-side-l" aria-label="Collections">
        ${side('album', 'album', 'Album', '<span class="hud-meter"></span>')}
      </nav>
      <nav class="hud-side hud-side-r" aria-label="Rewards and news">
        ${side('gift', 'gift', 'Gift', '<span class="hud-gift-t"></span>')}
        ${side('news', 'news', 'News', '<span class="hud-badge" hidden></span>')}
      </nav>
      <footer class="hud-dock">
        <button class="btn btn-orange hud-build" data-act="build" aria-label="Build landmarks">
          ${img('build', 'hud-build-ic')}<span class="hud-lbl">BUILD</span><span class="hud-badge hud-build-badge" hidden>!</span>
        </button>
        <div class="hud-go-wrap">
          <button class="btn btn-go hud-go" aria-label="Roll the dice. Hold for auto roll.">
            <span class="hud-go-fill" aria-hidden="true"></span>
            <span class="hud-go-label">GO</span><span class="hud-go-sub">HOLD FOR AUTO</span>
          </button>
          <div class="hud-dice" role="status">
            ${img('dice', 'hud-dice-ic')}
            <div class="hud-dice-main"><b class="hud-dice-val">0/50</b><div class="hud-regen"><i></i></div></div>
            <span class="hud-regen-t"></span>
          </div>
        </div>
        <button class="btn hud-mult" data-act="multiplier" aria-label="Multiplier"><small>MULTI</small><b>x1</b>${img('lock', 'hud-mult-lock')}</button>
      </footer>`;
    parent.append(el);

    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      pop(b, 0.9, 160);
      (this.on[b.dataset.act as keyof HudHandlers] as () => void)();
    });
    this.wireGo(this.$('.hud-go'));
    this.sync(false);
  }

  private wireGo(go: HTMLElement) {
    const clear = () => { clearTimeout(this.holdTimer); this.holdTimer = 0; this.el.classList.remove('holding'); };
    go.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      go.setPointerCapture?.(e.pointerId);
      if (this.auto) { this.swallowUp = true; this.on.autoStop(); return; }
      this.swallowUp = false;
      this.el.classList.add('holding');
      this.holdTimer = window.setTimeout(() => {
        clear();
        this.swallowUp = true;
        this.on.autoStart();
      }, HOLD_MS);
    });
    go.addEventListener('pointerup', () => {
      if (this.swallowUp) { this.swallowUp = false; return; }
      if (!this.holdTimer) return;
      clear();
      this.on.roll();
    });
    go.addEventListener('pointercancel', clear);
    go.addEventListener('contextmenu', (e) => e.preventDefault());
    // keyboard / assistive "click" (pointer clicks are handled above)
    go.addEventListener('click', (e) => { if (e.detail === 0) { if (this.auto) this.on.autoStop(); else this.on.roll(); } });
  }

  // ------------------------------------------------------------ visibility / layout
  show() {
    this.el.dataset.state = 'shown';
    return new Promise<void>((r) => setTimeout(r, reduced() ? 0 : 650));
  }

  /** CSS px the HUD covers on each edge (layout boxes, unaffected by the slide-in transform). */
  insets() {
    const top = this.$('.hud-top'), dock = this.$('.hud-dock'), side = this.$('.hud-side-l');
    const landscape = innerWidth > innerHeight * 1.1;
    const s = landscape ? side.offsetLeft + side.offsetWidth + 6 : 0;
    return { top: top.offsetTop + top.offsetHeight, right: s, bottom: Math.max(0, innerHeight - dock.offsetTop), left: s };
  }

  // ------------------------------------------------------------ state
  setAuto(on: boolean) { this.auto = on; this.renderGo(); }
  setBusy(on: boolean) { this.busy = on; this.renderGo(); }

  private renderGo() {
    const s = this.game.state;
    const out = !s.pending && !this.game.canRoll();
    this.el.dataset.auto = this.auto ? '1' : '';
    this.el.dataset.busy = this.busy ? '1' : '';
    this.el.dataset.out = out ? '1' : '';
    this.$('.hud-go-label').textContent = this.auto ? 'AUTO' : 'GO';
    this.$('.hud-go-sub').textContent = this.auto ? 'TAP TO STOP' : s.pending ? 'MINIGAME!' : out ? 'NO DICE' : s.freeRolls > 0 ? 'FREE ROLL' : 'HOLD FOR AUTO';
  }

  /** Snap/tween every widget to the true game state. */
  sync(animate = true) {
    const s = this.game.state;
    this.setCoins(s.coins, animate ? 650 : 0);
    this.dice = s.dice;
    this.renderDice();
    this.setShields(s.shields, animate);
    const theme = cityTheme(this.manifest, s.city);
    this.el.style.setProperty('--accent', theme.accent);
    this.$('.hud-city').textContent = theme.name;
    this.$('.hud-level').textContent = String(s.city + 1);
    this.$('.hud-nw-val').textContent = fmt(this.game.netWorth());
    const mult = this.$('.hud-mult');
    const mb = mult.querySelector('b')!;
    if (mb.textContent !== `x${s.multiplier}`) { mb.textContent = `x${s.multiplier}`; if (animate) pop(mult, 1.15); }
    mult.dataset.tier = s.multiplier >= 10 ? '3' : s.multiplier >= 3 ? '2' : s.multiplier > 1 ? '1' : '0';
    const locked = s.freeRolls > 0;
    mult.dataset.locked = locked ? '1' : '';
    mult.querySelector('small')!.textContent = locked ? 'LOCKED' : 'MULTI';
    mult.setAttribute('aria-label', locked ? `Multiplier x${s.multiplier}, locked during free roll` : `Multiplier x${s.multiplier}. Tap to change.`);
    let afford = false;
    for (let i = 0; i < 5; i++) { const c = this.game.landmarkCost(i); if (c !== null && c <= s.coins) afford = true; }
    this.$('.hud-build-badge').hidden = !afford;
    this.$('.hud-build').classList.toggle('glow', afford);
    const owned = STICKERS.filter((x) => (s.stickers[x.id] ?? 0) > 0).length;
    this.$('.hud-meter').textContent = `${owned}/${STICKERS.length}`;
    this.setNews(s.news.filter((n) => !n.seen).length);
    this.tickTimers();
  }

  /** 1 Hz: regen bar, gift countdown, GO state. */
  tickTimers() {
    const s = this.game.state, now = Date.now();
    const next = this.game.nextDieAt();
    const bar = this.$('.hud-regen i');
    const t = this.$('.hud-regen-t');
    if (next == null || s.dice >= s.diceMax) { bar.style.width = '100%'; t.textContent = 'FULL'; }
    else {
      const left = Math.max(0, next - now);
      bar.style.width = `${Math.round((1 - Math.min(1, left / 90_000)) * 100)}%`;
      t.textContent = `+1 in ${fmtTime(left)}`;
    }
    const ready = s.giftAt <= now;
    const gift = this.$('[data-act="gift"]');
    gift.classList.toggle('ready', ready);
    this.$('.hud-gift-t').textContent = ready ? 'FREE!' : fmtTime(s.giftAt - now);
    gift.setAttribute('aria-label', ready ? 'Free gift ready' : `Free gift in ${fmtTime(s.giftAt - now)}`);
    this.renderGo();
  }

  setNews(n: number) {
    const b = this.$('[data-act="news"] .hud-badge');
    const was = b.textContent;
    b.hidden = n <= 0;
    b.textContent = n > 9 ? '9+' : String(n);
    if (n > 0 && was !== b.textContent) pop(b, 1.5, 320);
    this.$('[data-act="news"]').setAttribute('aria-label', n ? `News, ${n} new` : 'News');
  }

  // ------------------------------------------------------------ coins (tweened count-up)
  get coinsTarget() { return this.coin.to; }

  setCoins(to: number, ms = 600, delay = 0) {
    const c = this.coin;
    if (to === c.to && (ms > 0 || to === c.shown)) return;
    c.from = c.shown;
    c.to = to;
    c.t0 = performance.now() + delay;
    c.dur = reduced() ? 0 : ms;
    if (!c.raf) c.raf = requestAnimationFrame(this.coinStep);
  }
  addCoins(delta: number, ms = 600, delay = 0) { this.setCoins(this.coin.to + delta, ms, delay); }

  private coinStep = (t: number) => {
    const c = this.coin;
    const k = c.dur <= 0 ? 1 : Math.max(0, Math.min(1, (t - c.t0) / c.dur));
    c.shown = Math.round(c.from + (c.to - c.from) * (1 - Math.pow(1 - k, 3)));
    this.$('.hud-coin-val').textContent = fmtCounter(c.shown);
    this.$('.hud-coins').setAttribute('aria-label', `${fmtCounter(c.to)} coins`);
    c.raf = k < 1 ? requestAnimationFrame(this.coinStep) : 0;
  };

  bumpCoins() { pop(this.$('.hud-coin-ic'), 1.3, 180); pop(this.$('.hud-coins'), 1.06, 180); }
  hurtCoins() { shake(this.$('.hud-coins'), 8); this.$('.hud-coins').animate([{ filter: 'brightness(1.6) saturate(2) hue-rotate(-40deg)' }, { filter: 'none' }], 600); }

  // ------------------------------------------------------------ dice / shields
  addDice(delta: number, bump = true) {
    this.dice += delta;
    this.renderDice();
    if (bump) pop(this.$('.hud-dice'), delta > 0 ? 1.12 : 0.94, 220);
  }
  private renderDice() {
    const s = this.game.state;
    this.$('.hud-dice-val').textContent = `${Math.max(0, this.dice)}/${s.diceMax}`;
    this.$('.hud-dice').classList.toggle('low', this.dice < Math.max(1, s.multiplier));
    this.$('.hud-dice').setAttribute('aria-label', `${this.dice} of ${s.diceMax} dice`);
  }

  setShields(n: number, animate = true) {
    if (n === this.shields) return;
    const prev = this.shields;
    this.shields = n;
    this.el.querySelectorAll<HTMLElement>('.hud-shield').forEach((el, i) => {
      el.classList.toggle('on', i < n);
      if (animate && prev >= 0 && (i < n) !== (i < prev)) pop(el, i < n ? 1.5 : 0.6, 320);
    });
    this.$('.hud-shields').setAttribute('aria-label', `Shields ${n} of 3`);
  }

  // ------------------------------------------------------------ flight targets
  coinPoint(): Pt { return rectCenter(this.$('.hud-coin-ic')); }
  dicePoint(): Pt { return rectCenter(this.$('.hud-dice-ic')); }
  shieldPoint(i: number): Pt { return rectCenter(this.el.querySelectorAll('.hud-shield')[Math.max(0, Math.min(2, i))]); }
  newsPoint(): Pt { return rectCenter(this.$('[data-act="news"]')); }
}
