// Reusable modal + the shell's own dialogs (card reveal, rewards, out-of-dice, news, settings, gift).
import type { AssetManifest, GameEvent, IconKey, IGame, NewsItem, Reward, SoundKey } from '../contract';
import { cityTheme } from '../shared/manifest';
import { PACK_NAMES } from '../shared/stickers';
import { esc, fmt, fmtAgo, fmtTime, possessive } from './format';
import { confetti, img, pop } from './fx';

let layer: HTMLElement;
let sfx: (k: SoundKey) => void = () => {};
export function initModals(el: HTMLElement, play: (k: SoundKey) => void) {
  layer = el;
  sfx = play;
}

// ---------------------------------------------------------------- settings (per device)
export interface Settings { sound: boolean; music: boolean; quality: 'high' | 'low' }
const SETTINGS_KEY = 'dice-empire-settings';
export const settings: Settings = (() => {
  const d: Settings = { sound: true, music: true, quality: 'high' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return d; }
})();
export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- base modal
export interface Action { label: string; cls?: string; icon?: IconKey; value?: string; run?: () => boolean | void; disabled?: boolean }
export interface ModalOpts {
  title?: string;
  icon?: IconKey;
  body?: string | Node;
  cls?: string;
  dismissible?: boolean; // scrim / Esc / close button (default true)
  actions?: Action[];
  sound?: SoundKey | null;
}
export interface Modal { el: HTMLElement; panel: HTMLElement; dismissible: boolean; close(v?: string): void; closed: Promise<string | undefined> }

const stack: Modal[] = [];
let uid = 0;

const CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/></svg>`;

export function openModal(o: ModalOpts): Modal {
  const dismissible = o.dismissible ?? true;
  const id = `m-t-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = `m-wrap ${o.cls ?? ''}`;
  wrap.innerHTML = `<div class="m-scrim"></div>
    <div class="m-panel panel" role="dialog" aria-modal="true" ${o.title ? `aria-labelledby="${id}"` : 'aria-label="Dialog"'}>
      ${o.icon ? `<div class="m-hero">${img(o.icon, 'm-hero-ic')}</div>` : ''}
      ${o.title ? `<h2 class="m-title panel-title" id="${id}">${esc(o.title)}</h2>` : ''}
      <div class="m-body"></div>
      ${o.actions?.length ? '<div class="m-actions"></div>' : ''}
      ${dismissible ? `<button class="m-x" aria-label="Close">${CLOSE}</button>` : ''}
    </div>`;
  const panel = wrap.querySelector<HTMLElement>('.m-panel')!;
  const body = wrap.querySelector<HTMLElement>('.m-body')!;
  if (typeof o.body === 'string') body.innerHTML = o.body;
  else if (o.body) body.append(o.body);

  const prevFocus = document.activeElement as HTMLElement | null;
  let resolve!: (v: string | undefined) => void;
  const closed = new Promise<string | undefined>((r) => (resolve = r));
  let done = false;
  const m: Modal = {
    el: wrap,
    panel,
    dismissible,
    closed,
    close(v) {
      if (done) return;
      done = true;
      stack.splice(stack.indexOf(m), 1);
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 200);
      prevFocus?.focus?.({ preventScroll: true });
      resolve(v);
    },
  };

  const actions = wrap.querySelector<HTMLElement>('.m-actions');
  for (const a of o.actions ?? []) {
    const b = document.createElement('button');
    b.className = `btn ${a.cls ?? 'btn-go'}`;
    b.innerHTML = `${a.icon ? img(a.icon, 'btn-ic') : ''}<span>${esc(a.label)}</span>`;
    b.disabled = !!a.disabled;
    b.addEventListener('click', () => {
      sfx('click');
      if (a.run?.() === false) return;
      m.close(a.value ?? a.label);
    });
    actions!.append(b);
  }
  if (dismissible) {
    wrap.querySelector('.m-scrim')!.addEventListener('click', () => m.close());
    wrap.querySelector('.m-x')!.addEventListener('click', () => { sfx('click'); m.close(); });
  }
  layer.append(wrap);
  stack.push(m);
  if (o.sound !== null) sfx(o.sound ?? 'popup');
  requestAnimationFrame(() => (wrap.querySelector<HTMLElement>('.m-actions .btn:not(:disabled), .m-x') ?? panel).focus({ preventScroll: true }));
  return m;
}

/** Esc: close the top shell modal if it is also the top overlay (screens handle their own Esc). */
export function closeTopModal(): boolean {
  const m = stack[stack.length - 1];
  if (!m || !m.dismissible || layer.lastElementChild !== m.el) return false;
  sfx('click');
  m.close();
  return true;
}

export const overlayOpen = () => !!layer && layer.childElementCount > 0;

export async function confirmModal(title: string, text: string, ok: string, cls = 'btn-red'): Promise<boolean> {
  const m = openModal({
    title, icon: 'siren', cls: 'm-confirm', body: `<p class="m-text">${esc(text)}</p>`,
    actions: [{ label: 'CANCEL', cls: 'btn', value: 'no' }, { label: ok, cls, value: 'yes' }],
  });
  return (await m.closed) === 'yes';
}

// ---------------------------------------------------------------- reward chips
const PACK_COLORS: Record<number, string> = { 1: '#39d353', 2: '#ffcc2e', 3: '#ec4fae', 4: '#2f8bff', 5: '#ffb300' };
export function packChip(tier: number) {
  return `<div class="m-pack" style="--pc:${PACK_COLORS[tier] ?? '#39d353'}">
    <div class="m-pack-card">${img('album', 'm-pack-ic')}<div class="m-pack-stars">${'★'.repeat(tier)}</div></div>
    <span>${esc(PACK_NAMES[tier] ?? 'Pack')}</span></div>`;
}
export function rewardChips(r: Reward) {
  const c: string[] = [];
  if (r.coins) c.push(`<div class="m-chip">${img('coin')}<b>+${fmt(r.coins)}</b></div>`);
  if (r.dice) c.push(`<div class="m-chip">${img('dice')}<b>+${fmt(r.dice)}</b></div>`);
  if (r.shields) c.push(`<div class="m-chip">${img('shield')}<b>+${r.shields}</b></div>`);
  for (const p of r.packs ?? []) c.push(packChip(p));
  return c.length ? `<div class="m-chips">${c.join('')}</div>` : '';
}

/** Big celebration / reward dialog with a COLLECT button. */
export async function rewardModal(o: { title: string; sub?: string; icon: IconKey; reward?: Reward; button?: string; tone?: string; sound?: SoundKey; party?: boolean }) {
  const m = openModal({
    title: o.title,
    icon: o.icon,
    cls: `m-reward tone-${o.tone ?? 'gold'}`,
    dismissible: false,
    sound: o.sound ?? 'popup',
    body: `${o.sub ? `<p class="m-text">${esc(o.sub)}</p>` : ''}${o.reward ? rewardChips(o.reward) : ''}`,
    actions: [{ label: o.button ?? 'COLLECT', cls: 'btn-go m-collect' }],
  });
  if (o.party) confetti();
  await m.closed;
}

// ---------------------------------------------------------------- card reveal
export function showCard(ev: Extract<GameEvent, { t: 'card' }>, autoMs?: number): Promise<void> {
  const chance = ev.deck === 'chance';
  const wrap = document.createElement('div');
  wrap.className = `m-wrap m-cardwrap ${chance ? 'deck-chance' : 'deck-chest'}`;
  wrap.innerHTML = `<div class="m-scrim"></div>
    <div class="m-card" role="button" tabindex="0" aria-label="${esc(`${ev.title}. ${ev.text}. Tap to continue`)}">
      <div class="m-card-face m-card-back">${img(chance ? 'chance' : 'gift', 'm-card-back-ic')}</div>
      <div class="m-card-face m-card-front">
        <div class="m-card-head">${chance ? 'CHANCE' : 'GIFT BOX'}</div>
        <div class="m-card-art">${img(ev.icon, 'm-card-ic')}</div>
        <div class="m-card-title">${esc(ev.title)}</div>
        <div class="m-card-text">${esc(ev.text)}</div>
        <div class="m-card-tap">${autoMs ? '' : 'TAP TO CONTINUE'}</div>
      </div>
    </div>`;
  layer.append(wrap);
  sfx(chance ? 'card' : 'chest');
  const card = wrap.querySelector<HTMLElement>('.m-card')!;
  card.focus({ preventScroll: true });
  return new Promise((done) => {
    let gone = false;
    const close = () => {
      if (gone) return;
      gone = true;
      wrap.classList.add('closing');
      setTimeout(() => { wrap.remove(); done(); }, 180);
    };
    // ignore taps during the flip so a double-tap on GO can't skip the card unseen
    setTimeout(() => {
      wrap.addEventListener('click', close);
      card.addEventListener('keydown', (e) => { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); close(); } });
    }, 420);
    if (autoMs) setTimeout(close, autoMs);
  });
}

// ---------------------------------------------------------------- out of dice
export function outOfDiceModal(game: IGame, onGift: () => void) {
  const body = document.createElement('div');
  body.innerHTML = `<p class="m-text">Your dice refill over time. Grab your free gift for a quick boost!</p>
    <div class="m-timer">${img('hourglass')}<div><small>NEXT DIE IN</small><b class="m-t-die">--:--</b></div></div>
    <div class="m-timer m-timer-gift">${img('gift')}<div><small>FREE GIFT</small><b class="m-t-gift">--:--</b></div></div>`;
  let giftReady = false;
  const m = openModal({
    title: 'Out of Dice!', icon: 'dice', cls: 'm-ood', body, sound: 'error',
    actions: [{ label: 'FREE GIFT', icon: 'gift', cls: 'btn-gold m-ood-gift', run: () => { if (!giftReady) return false; onGift(); } }],
  });
  const giftBtn = m.el.querySelector<HTMLButtonElement>('.m-ood-gift')!;
  const upd = () => {
    const now = Date.now();
    const next = game.nextDieAt();
    body.querySelector('.m-t-die')!.textContent = next ? fmtTime(next - now) : 'FULL';
    giftReady = game.state.giftAt <= now;
    body.querySelector('.m-t-gift')!.textContent = giftReady ? 'READY!' : fmtTime(game.state.giftAt - now);
    giftBtn.disabled = !giftReady;
    body.querySelector('.m-timer-gift')!.classList.toggle('ready', giftReady);
  };
  upd();
  const t = setInterval(upd, 1000);
  void m.closed.then(() => clearInterval(t));
  return m;
}

// ---------------------------------------------------------------- news
export function newsText(n: NewsItem, game: IGame, manifest: AssetManifest) {
  const r = game.state.rivals.find((x) => x.id === n.rivalId);
  const name = `<b>${esc(r?.name ?? 'A rival')}</b>`;
  const pname = `<b>${esc(possessive(r?.name ?? 'A rival'))}</b>`;
  if (n.blocked) return { avatar: r?.avatar ?? 'avatar_fox', html: `Shield blocked ${pname} ${n.kind}!`, tone: 'blue' as const };
  if (n.kind === 'heist') return { avatar: r?.avatar ?? 'avatar_fox', html: `${name} heisted <b class="neg">${fmt(n.coinsLost)}</b> coins!`, tone: 'red' as const };
  const theme = cityTheme(manifest, game.state.city);
  const lm = n.landmark != null ? manifest.models.landmarks[theme.landmarks[n.landmark]]?.name : undefined;
  return { avatar: r?.avatar ?? 'avatar_fox', html: `${name} raided your ${esc(lm ?? 'city')}!`, tone: 'red' as const };
}

export function newsModal(game: IGame, manifest: AssetManifest) {
  const items = [...game.state.news].sort((a, b) => b.at - a.at).slice(0, 40);
  const list = items.map((n) => {
    const t = newsText(n, game, manifest);
    return `<li class="m-news ${n.seen ? '' : 'unseen'} tone-${t.tone}">
      <div class="m-news-av">${img(t.avatar)}${img(n.blocked ? 'shield' : n.kind === 'heist' ? 'money_bag' : 'boom', 'm-news-badge')}</div>
      <div class="m-news-t">${t.html}<small>${fmtAgo(n.at)}</small></div></li>`;
  }).join('');
  const m = openModal({
    title: 'News', icon: 'news', cls: 'm-newsmodal',
    body: items.length ? `<ul class="m-news-list">${list}</ul>` : `<p class="m-text m-empty">All quiet in your city. Rivals' raids and heists will show up here.</p>`,
  });
  game.markNewsSeen();
  return m;
}

// ---------------------------------------------------------------- settings
export function settingsModal(o: { apply: () => void; onReset: () => void }) {
  const row = (key: 'sound' | 'music', label: string, on: IconKey, off: IconKey) =>
    `<button class="m-toggle" data-k="${key}" role="switch" aria-checked="${settings[key]}">
      ${img(settings[key] ? on : off, 'm-toggle-ic')}<span>${label}</span><i class="m-switch"><i></i></i></button>`;
  const body = document.createElement('div');
  body.className = 'm-settings';
  body.innerHTML = `${row('sound', 'Sound FX', 'sound_on', 'sound_off')}${row('music', 'Music', 'bell', 'sound_off')}
    <div class="m-seg-row"><span>${img('sparkles', 'm-toggle-ic')}Graphics</span>
      <div class="m-seg" role="radiogroup" aria-label="Graphics quality">
        <button role="radio" data-q="high">HIGH</button><button role="radio" data-q="low">LOW</button></div></div>
    <button class="btn btn-red m-reset">${img('bomb', 'btn-ic')}<span>RESET PROGRESS</span></button>
    <p class="m-fine">Dice Empire · an original game. Icons: Microsoft Fluent Emoji (MIT).</p>`;
  const paint = () => {
    for (const b of body.querySelectorAll<HTMLButtonElement>('.m-toggle')) {
      const k = b.dataset.k as 'sound' | 'music';
      b.setAttribute('aria-checked', String(settings[k]));
      b.querySelector<HTMLImageElement>('.m-toggle-ic')!.outerHTML = img(settings[k] ? (k === 'music' ? 'bell' : 'sound_on') : 'sound_off', 'm-toggle-ic');
    }
    for (const b of body.querySelectorAll<HTMLButtonElement>('[data-q]')) b.setAttribute('aria-checked', String(b.dataset.q === settings.quality));
  };
  body.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest('button');
    if (!t) return;
    sfx('click');
    if (t.dataset.k) settings[t.dataset.k as 'sound' | 'music'] = !settings[t.dataset.k as 'sound' | 'music'];
    else if (t.dataset.q) settings.quality = t.dataset.q as Settings['quality'];
    else if (t.classList.contains('m-reset')) {
      if (await confirmModal('Reset progress?', 'Your coins, cities, landmarks and stickers will be gone for good.', 'RESET')) o.onReset();
      return;
    }
    saveSettings();
    o.apply();
    paint();
    pop(t, 1.05);
  });
  paint();
  return openModal({ title: 'Settings', icon: 'gear', cls: 'm-settingsmodal', body });
}

// ---------------------------------------------------------------- gift (not ready yet)
export function giftWaitModal(game: IGame) {
  const body = document.createElement('div');
  body.innerHTML = `<p class="m-text">A free gift of dice and coins arrives every hour.</p>
    <div class="m-timer">${img('hourglass')}<div><small>NEXT GIFT IN</small><b class="m-t-gift">--:--</b></div></div>`;
  const m = openModal({ title: 'Free Gift', icon: 'gift', cls: 'm-giftwait', body, actions: [{ label: 'OK', cls: 'btn' }] });
  const upd = () => {
    const left = game.state.giftAt - Date.now();
    body.querySelector('.m-t-gift')!.textContent = left > 0 ? fmtTime(left) : 'READY!';
    if (left <= 0) m.close();
  };
  upd();
  const t = setInterval(upd, 1000);
  void m.closed.then(() => clearInterval(t));
  return m;
}
