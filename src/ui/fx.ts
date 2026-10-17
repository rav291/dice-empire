// DOM effects layer: floating numbers, icon flights, banners, toasts, confetti, shake.
import type { IconKey } from '../contract';
import { icon } from '../shared/manifest';
import { esc } from './format';

export type Pt = { x: number; y: number };
export type Tone = 'gold' | 'green' | 'red' | 'blue' | 'purple' | 'white';

const rm = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => rm.matches;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const center = (): Pt => ({ x: innerWidth / 2, y: innerHeight * 0.45 });
export const rectCenter = (el: Element): Pt => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

let layer: HTMLElement;
let toasts: HTMLElement;
let live: HTMLElement;
export function initFx(el: HTMLElement) {
  layer = el;
  toasts = el.appendChild(Object.assign(document.createElement('div'), { className: 'fx-toasts' }));
  live = el.appendChild(Object.assign(document.createElement('div'), { className: 'sr-only' }));
  live.setAttribute('aria-live', 'polite');
}
/** Screen-reader announcement for visual-only feedback. */
export const announce = (text: string) => { if (live) live.textContent = text; };

const div = (cls: string, html = '') => {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  return d;
};
export const img = (key: IconKey | string, cls = '') => `<img class="${cls}" src="${icon(key)}" alt="" draggable="false">`;

/** Scale "bump" on an element (counter hit, badge update). */
export function pop(el: Element, scale = 1.18, ms = 260) {
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
}

export function shake(el: Element, px = 10, ms = 420) {
  if (reduced()) return;
  const k = [0, -1, 0.9, -0.7, 0.5, -0.3, 0].map((f) => ({ transform: `translate(${f * px}px, ${f * px * -0.4}px)` }));
  el.animate(k, { duration: ms, easing: 'ease-out' });
}

/** Floating text ("+12.5K", "BOUGHT!") that rises and fades at a viewport point. */
export function floatText(text: string, at: Pt, o: { tone?: Tone; size?: number; icon?: IconKey; ms?: number; rise?: number } = {}) {
  const el = div(`fx-float tone-${o.tone ?? 'gold'}`, `${o.icon ? img(o.icon, 'fx-float-ic') : ''}<span>${esc(text)}</span>`);
  el.style.fontSize = `${o.size ?? 1}em`;
  layer.append(el);
  const half = el.offsetWidth / 2 + 6; // keep the label on screen at edge tiles
  el.style.left = `${Math.max(half, Math.min(innerWidth - half, at.x))}px`;
  el.style.top = `${Math.max(40, Math.min(innerHeight - 20, at.y))}px`;
  const rise = o.rise ?? 70;
  const a = el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
      { transform: 'translate(-50%,-80%) scale(1.15)', opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%,-90%) scale(1)', opacity: 1, offset: 0.3 },
      { transform: `translate(-50%, calc(-90% - ${rise}px)) scale(0.95)`, opacity: 0 },
    ],
    { duration: o.ms ?? 1300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
  );
  void a.finished.then(() => el.remove(), () => el.remove());
}

/**
 * Burst `count` icons out of `from`, then curve them into `to()` (re-read at launch so the
 * target tracks layout). onArrive fires per sprite. Resolves when the last one lands.
 */
export function flyIcons(key: IconKey, from: Pt, to: () => Pt, count: number,
  o: { size?: number; stagger?: number; ms?: number; onArrive?: (i: number) => void } = {}): Promise<void> {
  if (reduced()) count = Math.min(count, 2);
  const size = o.size ?? 44, stagger = o.stagger ?? 45, ms = o.ms ?? 780;
  const src = icon(key);
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('img');
    el.src = src;
    el.alt = '';
    el.className = 'fx-fly';
    el.style.width = el.style.height = `${size}px`;
    layer.append(el);
    const t = to();
    const ang = Math.random() * Math.PI * 2;
    const r = count > 1 ? 34 + Math.random() * 58 : 0;
    const bx = from.x + Math.cos(ang) * r, by = from.y + Math.sin(ang) * r * 0.75 - 18;
    // control point between burst and target for an arc
    const mx = (bx + t.x) / 2 + (Math.random() - 0.5) * 90, my = Math.min(by, t.y) - 40 - Math.random() * 50;
    const tr = (x: number, y: number, s: number, rot = 0) => `translate(${x - size / 2}px, ${y - size / 2}px) scale(${s}) rotate(${rot}deg)`;
    const spin = (Math.random() - 0.5) * 120;
    const a = el.animate(
      [
        { transform: tr(from.x, from.y, 0.2), opacity: 0, easing: 'cubic-bezier(.2,.9,.3,1)' },
        { transform: tr(bx, by, 1.15, spin * 0.3), opacity: 1, offset: 0.32, easing: 'cubic-bezier(.5,0,.9,.5)' },
        { transform: tr(mx, my, 1, spin * 0.7), opacity: 1, offset: 0.68, easing: 'cubic-bezier(.4,0,1,1)' },
        { transform: tr(t.x, t.y, 0.55, spin), opacity: 0.9 },
      ],
      { duration: ms, delay: i * stagger, fill: 'both' },
    );
    jobs.push(a.finished.then(() => { el.remove(); o.onArrive?.(i); }, () => el.remove()));
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Center-screen ribbon banner. Resolves after it has left. */
export function banner(title: string, sub = '', o: { tone?: Tone; icon?: IconKey; ms?: number; big?: boolean; color?: string } = {}): Promise<void> {
  const el = div(`fx-banner tone-${o.tone ?? 'gold'}${o.big ? ' big' : ''}`,
    `<div class="fx-banner-ribbon">${o.icon ? img(o.icon, 'fx-banner-ic') : ''}<div class="fx-banner-t" data-text="${esc(title)}">${esc(title)}</div></div>${sub ? `<div class="fx-banner-sub">${esc(sub)}</div>` : ''}`);
  if (o.color) el.style.setProperty('--group', o.color);
  layer.append(el);
  announce(`${title} ${sub}`);
  const ms = o.ms ?? 1300;
  const a = el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(0.2) rotate(-6deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.12) rotate(1deg)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.22 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.82 },
      { transform: 'translate(-50%,-60%) scale(1.25)', opacity: 0 },
    ],
    { duration: ms, easing: 'ease-out', fill: 'forwards' },
  );
  return a.finished.then(() => el.remove(), () => el.remove());
}

/** Slide-in notification card (rival attacks etc). */
export function toast(html: string, o: { tone?: Tone; avatar?: IconKey; badge?: IconKey; ms?: number } = {}) {
  const el = div(`fx-toast tone-${o.tone ?? 'blue'}`,
    `${o.avatar ? `<div class="fx-toast-av">${img(o.avatar)}${o.badge ? img(o.badge, 'fx-toast-badge') : ''}</div>` : ''}<div class="fx-toast-t">${html}</div>`);
  el.setAttribute('role', 'status');
  toasts.append(el);
  while (toasts.childElementCount > 3) toasts.firstElementChild?.remove();
  const a = el.animate(
    [
      { transform: 'translateY(-140%) scale(.9)', opacity: 0 },
      { transform: 'translateY(6%) scale(1.02)', opacity: 1, offset: 0.08 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.12 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.9 },
      { transform: 'translateY(-60%) scale(.95)', opacity: 0 },
    ],
    { duration: o.ms ?? 3600, easing: 'ease-out', fill: 'forwards' },
  );
  void a.finished.then(() => el.remove(), () => el.remove());
}

/** Small 2D-canvas confetti burst over everything. */
const CONFETTI = ['#ffcc2e', '#ff3d4f', '#39d353', '#2f8bff', '#8d4dff', '#ff9b1f', '#ffffff', '#ec4fae'];
export function confetti(o: { count?: number; ms?: number; from?: Pt } = {}) {
  if (reduced()) return;
  const cv = document.createElement('canvas');
  cv.className = 'fx-confetti';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  layer.append(cv);
  const g = cv.getContext('2d');
  if (!g) { cv.remove(); return; }
  g.scale(dpr, dpr);
  const n = o.count ?? Math.round(Math.min(220, 90 + W / 8));
  const ms = o.ms ?? 3200;
  const parts = Array.from({ length: n }, (_, i) => {
    const fromTop = !o.from && i % 3 === 0;
    const sx = o.from?.x ?? (fromTop ? Math.random() * W : i % 2 ? W * 0.12 : W * 0.88);
    const sy = o.from?.y ?? (fromTop ? -20 : H * 0.62);
    const a = fromTop ? Math.PI / 2 : -Math.PI / 2 + (i % 2 ? 0.35 : -0.35) + (Math.random() - 0.5) * 1.1;
    const sp = fromTop ? 1 + Math.random() * 2 : 9 + Math.random() * 9;
    return {
      x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      w: 6 + Math.random() * 7, h: 9 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: CONFETTI[i % CONFETTI.length], wob: Math.random() * 6,
    };
  });
  const t0 = performance.now();
  let last = t0;
  const step = (t: number) => {
    const dt = Math.min(2.5, (t - last) / 16.7);
    last = t;
    const life = (t - t0) / ms;
    g.clearRect(0, 0, W, H);
    g.globalAlpha = life > 0.75 ? Math.max(0, (1 - life) / 0.25) : 1;
    for (const p of parts) {
      p.vy += 0.28 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += (p.vx + Math.sin(t / 300 + p.wob) * 0.6) * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.scale(1, Math.cos(t / 160 + p.wob));
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (life < 1) requestAnimationFrame(step);
    else cv.remove();
  };
  requestAnimationFrame(step);
}
