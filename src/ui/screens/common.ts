import './common.css';
import type { ScreenDeps } from '../../contract';
import { icon } from '../../shared/manifest';

// Shared helpers for the full-screen screens (heist, raid, build, album, packs).

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 999, 1.2K, 3.4M, 5.6B (floored so 999,999 never reads as 1.0M). */
export function fmt(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a < 1000) return s + Math.round(a);
  for (const [v, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (a >= v) {
      const x = a / v;
      return s + (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u;
    }
  }
  return s + a;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** <img> markup for a Fluent icon. */
export const ic = (key: string, cls = '') => `<img class="sc-ic ${cls}" src="${icon(key)}" alt="" draggable="false">`;

export const starsHtml = (n: number) => `<span class="sc-stars">${ic('star').repeat(n)}</span>`;

export const CLOSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;
export const BACK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const CHECK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  return root.querySelector(sel) as T;
}

// ---------------------------------------------------------------- overlay mounting
const stack: HTMLElement[] = [];

/** Mounts a full-screen layer into deps.root. `onEsc` runs on Escape only when this is the top layer. */
export function mount(deps: ScreenDeps, cls: string, onEsc?: () => void) {
  const el = document.createElement('div');
  el.className = `sc-overlay ${cls}`;
  deps.root.appendChild(el);
  stack.push(el);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onEsc && stack[stack.length - 1] === el) {
      e.preventDefault();
      onEsc();
    }
  };
  addEventListener('keydown', key);
  let closing: Promise<void> | null = null;
  return {
    el,
    isTop: () => stack[stack.length - 1] === el,
    close() {
      return (closing ??= (async () => {
        removeEventListener('keydown', key);
        el.classList.add('sc-closing');
        el.style.pointerEvents = 'none';
        await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 1 : 240, easing: 'ease-in', fill: 'forwards' }).finished;
        stack.splice(stack.indexOf(el), 1);
        el.remove();
      })());
    },
  };
}

/** Resolves on the first Space/Enter press while `isTop()`. */
export function onKey(keys: string[], isTop: () => boolean, fn: () => void) {
  const h = (e: KeyboardEvent) => {
    if (keys.includes(e.code) && isTop() && !e.repeat) {
      e.preventDefault();
      fn();
    }
  };
  addEventListener('keydown', h);
  return () => removeEventListener('keydown', h);
}

// ---------------------------------------------------------------- juice
/** rAF count-up with ease-out; calls tick() at most every ~70ms (for coin sounds). */
export function countUp(el: HTMLElement, from: number, to: number, ms: number, tick?: () => void): Promise<void> {
  if (reduced() || ms <= 0) {
    el.textContent = fmt(to);
    return Promise.resolve();
  }
  return new Promise((done) => {
    const t0 = performance.now();
    let lastTick = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (tick && t - lastTick > 70 && k < 1) { lastTick = t; tick(); }
      if (k < 1) requestAnimationFrame(step);
      else { el.textContent = fmt(to); done(); }
    };
    requestAnimationFrame(step);
  });
}

/** Burst of icon particles from (x, y) in `host` coordinates, with gravity. */
export function burst(host: HTMLElement, x: number, y: number, n: number, opts: { key?: string; size?: number; spread?: number; up?: number } = {}) {
  if (reduced()) return;
  const { key = 'coin', size = 44, spread = 260, up = 1 } = opts;
  const src = icon(key);
  for (let i = 0; i < n; i++) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'sc-particle';
    img.alt = '';
    const s = size * rand(0.6, 1.15);
    img.style.cssText = `left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px`;
    host.appendChild(img);
    const a = rand(0, Math.PI * 2);
    const d = rand(0.35, 1) * spread;
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d * 0.8 - spread * 0.55 * up;
    const fall = spread * rand(0.9, 1.5);
    const r = rand(-540, 540);
    const dur = rand(900, 1400);
    img.animate(
      [
        { transform: 'translate(0,0) scale(.3) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.75}px,${dy}px) scale(1) rotate(${r * 0.5}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px,${dy + fall}px) scale(.85) rotate(${r}deg)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' },
    ).finished.then(() => img.remove());
  }
}

/** Little sparkle stars popping around an element's box. */
export function sparkle(host: HTMLElement, x: number, y: number, n = 8, r = 80) {
  if (reduced()) return;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = 'sc-spark';
    const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = r * rand(0.5, 1.1);
    s.style.cssText = `left:${x}px;top:${y}px`;
    host.appendChild(s);
    s.animate(
      [
        { transform: 'translate(-50%,-50%) scale(0)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.2}px), calc(-50% + ${Math.sin(a) * d * 1.2}px)) scale(0)`, opacity: 0 },
      ],
      { duration: rand(600, 900), delay: rand(0, 160), easing: 'ease-out', fill: 'both' },
    ).finished.then(() => s.remove());
  }
}

export function shake(el: HTMLElement, px = 10, ms = 450) {
  if (reduced()) return;
  const k = [];
  for (let i = 0; i <= 8; i++) {
    const f = (1 - i / 8) * px;
    k.push({ transform: `translate(${rand(-f, f)}px,${rand(-f, f)}px)` });
  }
  k[k.length - 1] = { transform: 'translate(0,0)' };
  el.animate(k, { duration: ms, easing: 'linear' });
}

export function pop(el: Element, scale = 1.18, ms = 260) {
  if (reduced()) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
}

/** Big slammed-in outlined title (e.g. "SHUTDOWN!"). Resolves when it has landed. */
export async function banner(host: HTMLElement, text: string, variant: string, hold = 0) {
  const b = document.createElement('div');
  b.className = `sc-banner sc-banner-${variant}`;
  b.innerHTML = `<span class="sc-display" data-text="${esc(text)}">${esc(text)}</span>`;
  host.appendChild(b);
  await b.animate(
    [
      { transform: 'translate(-50%,-50%) scale(2.6) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.92) rotate(-3deg)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(-3deg)', opacity: 1 },
    ],
    { duration: reduced() ? 1 : 420, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' },
  ).finished;
  if (hold) await wait(hold);
  return b;
}

/** Reward card with coin count-up and COLLECT. Resolves when collected. */
export async function collect(deps: ScreenDeps, host: HTMLElement, opts: { title: string; amount: number; isTop: () => boolean; variant?: string }) {
  const card = document.createElement('div');
  card.className = `sc-reward panel ${opts.variant ?? ''}`;
  card.innerHTML = `
    <div class="sc-reward-title">${esc(opts.title)}</div>
    <div class="sc-reward-amt">${ic('coin', 'sc-reward-coin')}<span>0</span></div>
    <button class="btn btn-go sc-reward-btn" disabled>COLLECT</button>`;
  host.appendChild(card);
  const num = q(card, '.sc-reward-amt span');
  const btn = q<HTMLButtonElement>(card, 'button');
  const r = card.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  burst(host, r.left - hr.left + r.width / 2, r.top - hr.top + r.height * 0.45, 22, { spread: 300 });
  deps.sfx('coins_big');
  await countUp(num, 0, opts.amount, 1300, () => deps.sfx('coin'));
  pop(num.parentElement!, 1.25, 320);
  btn.disabled = false;
  btn.focus({ preventScroll: true });
  await new Promise<void>((done) => {
    const off = onKey(['Space', 'Enter'], opts.isTop, () => fire());
    function fire() {
      off();
      deps.sfx('click');
      done();
    }
    btn.addEventListener('click', fire, { once: true });
  });
}

/** Loads an image URL; resolves false on error (no throw). */
export function setImg(img: HTMLImageElement, src: string) {
  return new Promise<boolean>((done) => {
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
}
