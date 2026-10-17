import './raid.css';
import type { GameEvent, ScreenDeps } from '../../contract';
import { cityTheme, icon } from '../../shared/manifest';
import { banner, burst, collect, esc, ic, mount, onKey, q, rand, reduced, setImg, shake, sparkle, wait } from './common';

type RaidResult = Extract<GameEvent, { t: 'raidResult' }>;

const RETICLE = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="34" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="11"/>
  <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="6"/>
  <circle cx="50" cy="50" r="17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-dasharray="7 6"/>
  <g stroke-linecap="round"><path d="M50 2v20M50 78v20M2 50h20M78 50h20" stroke="rgba(0,0,0,.45)" stroke-width="10"/>
  <path d="M50 2v20M50 78v20M2 50h20M78 50h20" stroke="currentColor" stroke-width="5"/></g>
  <circle cx="50" cy="50" r="4" fill="currentColor"/>
</svg>`;

export async function runRaid(deps: ScreenDeps): Promise<void> {
  const { game, board, manifest } = deps;
  const p0 = game.state.pending;
  if (!p0 || p0.kind !== 'raid') return;
  const rival = game.state.rivals.find((r) => r.id === p0.rivalId);
  const name = rival?.name ?? 'Rival';
  const lms = rival?.landmarks ?? Array.from({ length: 5 }, () => ({ stage: 0, damaged: false }));
  const theme = cityTheme(manifest, rival?.city ?? 0);
  const keys = theme.landmarks;
  const shields = rival?.shields ?? 0;
  const rm = reduced();

  const ui = mount(deps, 'rd'); // no Esc: the shot must be taken
  ui.el.style.setProperty('--sky-a', theme.sky[0]);
  ui.el.style.setProperty('--sky-b', theme.sky[1]);
  ui.el.style.setProperty('--accent', theme.accent);
  const title = `Raid ${name}!`;
  ui.el.innerHTML = `
    <div class="rd-sky"><i class="rd-sun"></i><i class="rd-cloud c1"></i><i class="rd-cloud c2"></i><i class="rd-cloud c3"></i></div>
    <header class="rd-head sc-pop">
      <div class="sc-avatar">${ic(rival?.avatar ?? 'avatar_fox')}</div>
      <div class="rd-head-txt">
        <span class="sc-display rd-title" data-text="${esc(title)}">${esc(title)}</span>
        <div class="rd-sub">${esc(theme.name)} &middot; aim for a landmark</div>
      </div>
      <div class="rd-shields" aria-label="${shields} shields">
        ${[0, 1, 2].map((i) => `<span class="rd-bub ${i < shields ? 'on' : ''}">${ic('shield')}</span>`).join('')}
      </div>
    </header>
    <div class="rd-field">
      <div class="rd-island"></div>
      ${shields > 0 ? '<div class="rd-dome"></div>' : ''}
      ${lms.map((l, i) => `
        <div class="rd-lm ${l.damaged ? 'damaged' : ''}" data-i="${i}" title="${esc(manifest.models.landmarks[keys[i]]?.name ?? '')}">
          <span class="rd-plot"></span>
          <span class="rd-thumb sc-shimmer"><img alt=""></span>
          ${l.damaged ? ic('fire', 'rd-burn') : ''}
          <span class="rd-pips">${[1, 2, 3, 4].map((s) => `<i class="${s <= l.stage ? 'on' : ''}"></i>`).join('')}</span>
        </div>`).join('')}
      <div class="rd-reticle">${RETICLE}</div>
    </div>
    <footer class="rd-foot">
      <div class="rd-cannon"><div class="rd-barrel"><i class="rd-flash"></i></div><div class="rd-carriage"><i></i></div></div>
      <button class="btn btn-red rd-fire">${ic('bomb', 'rd-fire-ic')}FIRE!</button>
      <div class="rd-hint">Tap anywhere or press Space</div>
    </footer>`;

  const field = q(ui.el, '.rd-field');
  const reticle = q(ui.el, '.rd-reticle');
  const barrel = q(ui.el, '.rd-barrel');
  const lmEls = [...field.querySelectorAll<HTMLElement>('.rd-lm')];
  const dome = field.querySelector<HTMLElement>('.rd-dome');

  // Thumbnails render offscreen; shimmer until each one lands.
  const thumbs = lms.map((l, i) =>
    board.renderLandmarkThumbnail(keys[i], l.stage, l.damaged)
      .then((url) => setImg(q<HTMLImageElement>(lmEls[i], 'img'), url))
      .catch(() => false)
      .finally(() => q(lmEls[i], '.rd-thumb').classList.remove('sc-shimmer')),
  );

  // ---- layout: 5 targets on a gentle arc; the reticle follows the same arc.
  let W = 0, H = 0, sp = 0, size = 0, x0 = 0, base = 0, amp = 0;
  const arcY = (x: number) => {
    const t = (x - W / 2) / (2 * sp);
    return base - amp * (1 - Math.min(1, t * t));
  };
  const cx = (i: number) => x0 + i * sp;
  const layout = () => {
    W = field.clientWidth;
    H = field.clientHeight;
    const rowW = Math.min(W - 8, 980);
    sp = rowW / 5;
    size = Math.min(sp * 1.3, H * 0.5, 240);
    x0 = (W - rowW) / 2 + sp / 2;
    base = H * 0.56;
    amp = Math.min(H * 0.12, 70);
    lmEls.forEach((el, i) => {
      el.style.cssText = `left:${cx(i)}px;top:${arcY(cx(i))}px;width:${size}px;height:${size}px;z-index:${i === 2 ? 1 : 2}`;
    });
    const isl = q(field, '.rd-island');
    isl.style.cssText = `left:${x0 - sp * 0.7}px;width:${rowW + sp * 0.4}px;top:${base - size * 0.02}px;height:${size * 0.55}px`;
    if (dome) {
      const top = arcY(W / 2) - size * 0.78;
      dome.style.cssText = `left:${x0 - sp * 0.62}px;width:${rowW + sp * 0.24}px;top:${top}px;height:${base + size * 0.3 - top}px`;
    }
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(field);

  const hitIndex = (x: number) => {
    for (let i = 0; i < 5; i++) if (Math.abs(x - cx(i)) <= sp * 0.33) return i;
    return -1;
  };

  // ---- reticle sweep (ping-pong, easing at the ends, speeds up each pass)
  let u = 0.5, dir = 1, speed = 0.5, last = 0, raf = 0, aimX = 0, aimY = 0;
  const place = () => {
    const a = x0 - sp * 0.45, b = cx(4) + sp * 0.45;
    aimX = a + (b - a) * (1 - Math.cos(Math.PI * u)) / 2;
    aimY = arcY(aimX);
    reticle.style.transform = `translate(${aimX}px, ${aimY}px) translate(-50%, -50%)`;
    const hit = hitIndex(aimX);
    reticle.classList.toggle('lock', hit >= 0 && lms[hit].stage > 0); // empty plots count as misses
    lmEls.forEach((el, i) => el.classList.toggle('aimed', i === hit));
    const fr = field.getBoundingClientRect(), br = barrel.parentElement!.getBoundingClientRect();
    const dx = fr.left + aimX - (br.left + br.width / 2), dy = br.top + br.height * 0.7 - (fr.top + aimY);
    barrel.style.transform = `rotate(${Math.atan2(dx, dy) * 57.3 * 0.55}deg)`;
  };
  const tick = (t: number) => {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    u += dir * speed * dt;
    if (u >= 1 || u <= 0) {
      u = Math.max(0, Math.min(1, u));
      dir = -dir;
      speed = Math.min(speed * 1.09, 1.15);
    }
    place();
    raf = requestAnimationFrame(tick);
  };
  place();

  let ready = false, fired = false;
  await Promise.race([Promise.all(thumbs), wait(2500)]);
  await wait(rm ? 0 : 250);
  ready = true;
  ui.el.classList.add('live');
  raf = requestAnimationFrame(tick);

  // ---- fire
  const shot = await new Promise<{ x: number; y: number; idx: number; evs: GameEvent[] }>((done) => {
    const fire = () => {
      if (!ready || fired) return;
      const idx = hitIndex(aimX);
      let evs: GameEvent[];
      try {
        evs = game.raidShoot(idx);
      } catch {
        deps.sfx('error');
        return;
      }
      fired = true;
      cancelAnimationFrame(raf);
      offKey();
      deps.save();
      done({ x: aimX, y: aimY, idx, evs });
    };
    const offKey = onKey(['Space', 'Enter'], ui.isTop, fire);
    ui.el.addEventListener('pointerdown', (e) => { if (e.button === 0) fire(); });
  });
  ro.disconnect();
  ui.el.classList.remove('live');
  ui.el.classList.add('fired');

  const res = shot.evs.find((e): e is RaidResult => e.t === 'raidResult');
  const later = shot.evs.filter((e) => e.t !== 'raidResult');
  const target = res && res.target >= 0 ? res.target : shot.idx;
  const dmgThumb = res?.outcome === 'hit' && target >= 0
    ? board.renderLandmarkThumbnail(keys[target], lms[target].stage, true).catch(() => '')
    : null;

  // Cannon: recoil + muzzle flash, ball arcs from the barrel tip to the aim point.
  deps.sfx('cannon');
  barrel.classList.add('recoil');
  const fr = field.getBoundingClientRect();
  const tip = barrel.getBoundingClientRect();
  const sx = tip.left + tip.width / 2 - fr.left, sy = tip.top - fr.top;
  smoke(field, sx, sy, 3, 'rd-smoke-muzzle');
  let ex = shot.x, ey = shot.y;
  const domeHit = res?.outcome === 'blocked' && dome;
  if (domeHit) {
    const dr = dome.getBoundingClientRect();
    const rx = dr.width / 2, ry = dr.height, dcx = dr.left - fr.left + rx, dby = dr.bottom - fr.top;
    const k = Math.max(-0.95, Math.min(0.95, (ex - dcx) / rx));
    ey = dby - ry * Math.sqrt(1 - k * k);
  }
  const ball = document.createElement('img');
  ball.className = 'rd-ball';
  ball.src = icon('bomb');
  field.appendChild(ball);
  const frames: Keyframe[] = [];
  const apex = Math.max(140, (sy - ey) * 0.55);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = sx + (ex - sx) * t, y = sy + (ey - sy) * t - apex * 4 * t * (1 - t);
    frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1.25 - 0.6 * t}) rotate(${t * 540}deg)` });
  }
  await ball.animate(frames, { duration: rm ? 1 : 720, easing: 'cubic-bezier(.35,.1,.55,1)', fill: 'forwards' }).finished;

  const outcome = res?.outcome ?? 'miss';
  if (outcome === 'hit') {
    ball.remove();
    deps.sfx('explosion');
    explode(field, ex, ey, size);
    shake(ui.el, 16, 600);
    const el = lmEls[target];
    if (el) {
      el.classList.add('damaged', 'struck');
      if (!el.querySelector('.rd-burn')) el.insertAdjacentHTML('beforeend', ic('fire', 'rd-burn'));
      void dmgThumb?.then((url) => { if (url) void setImg(q<HTMLImageElement>(el, 'img'), url); });
    }
    await banner(ui.el, 'SHUTDOWN!', 'hit');
  } else if (outcome === 'blocked') {
    deps.sfx('blocked');
    dome?.classList.add('flash');
    ripple(field, ex, ey);
    const bub = [...ui.el.querySelectorAll('.rd-bub.on')].pop();
    bub?.classList.add('lost');
    const side = ex < W / 2 ? -1 : 1;
    void ball.animate(
      [
        { transform: `translate(${ex}px, ${ey}px) translate(-50%, -50%) scale(.65) rotate(540deg)`, opacity: 1 },
        { transform: `translate(${ex + side * 140}px, ${ey - 120}px) translate(-50%, -50%) scale(.7) rotate(800deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${ex + side * 260}px, ${H + 80}px) translate(-50%, -50%) scale(.75) rotate(1200deg)`, opacity: 0.2 },
      ],
      { duration: rm ? 1 : 900, easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'forwards' },
    ).finished.then(() => ball.remove());
    shake(ui.el, 6, 300);
    await banner(ui.el, 'BLOCKED!', 'blocked');
  } else {
    deps.sfx('whoosh');
    smoke(field, ex, ey + size * 0.15, 6, 'rd-smoke-dust');
    void ball.animate(
      [
        { transform: `translate(${ex}px, ${ey}px) translate(-50%, -50%) scale(.65)`, opacity: 1 },
        { transform: `translate(${ex + 18}px, ${ey - 30}px) translate(-50%, -50%) scale(.6)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${ex + 30}px, ${ey + 6}px) translate(-50%, -50%) scale(.58)`, opacity: 0 },
      ],
      { duration: rm ? 1 : 650, easing: 'ease-out', fill: 'forwards' },
    ).finished.then(() => ball.remove());
    await banner(ui.el, 'MISSED!', 'miss');
  }

  await wait(rm ? 300 : 800);
  const coins = res?.coins ?? 0;
  const rewardTitle = outcome === 'hit' ? `${manifest.models.landmarks[keys[target]]?.name ?? 'Landmark'} shut down!`
    : outcome === 'blocked' ? 'Their shield held. Consolation prize!' : 'So close! Consolation prize!';
  await collect(deps, ui.el, { title: rewardTitle, amount: coins, isTop: ui.isTop });
  await ui.close();
  if (later.length) await deps.play(later);
}

function smoke(host: HTMLElement, x: number, y: number, n: number, cls: string) {
  if (reduced()) return;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = `rd-smoke ${cls}`;
    const sz = rand(50, 90);
    s.style.cssText = `left:${x}px;top:${y}px;width:${sz}px;height:${sz}px`;
    host.appendChild(s);
    const dx = rand(-60, 60), dy = rand(-90, -30);
    s.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0.95 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.6)`, opacity: 0 },
      ],
      { duration: rand(900, 1500), delay: i * 50, easing: 'ease-out', fill: 'both' },
    ).finished.then(() => s.remove());
  }
}

function explode(host: HTMLElement, x: number, y: number, size: number) {
  const flash = document.createElement('i');
  flash.className = 'rd-flashbang';
  host.appendChild(flash);
  flash.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 450, easing: 'ease-out', fill: 'forwards' }).finished.then(() => flash.remove());
  const boom = document.createElement('img');
  boom.src = icon('boom');
  boom.className = 'rd-boom';
  boom.style.cssText = `left:${x}px;top:${y}px;width:${size * 1.2}px;height:${size * 1.2}px`;
  host.appendChild(boom);
  boom.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.2) rotate(-20deg)', opacity: 1 },
      { transform: 'translate(-50%,-50%) scale(1.25) rotate(8deg)', opacity: 1, offset: 0.35 },
      { transform: 'translate(-50%,-50%) scale(1.5) rotate(12deg)', opacity: 0 },
    ],
    { duration: reduced() ? 1 : 900, easing: 'ease-out', fill: 'forwards' },
  ).finished.then(() => boom.remove());
  burst(host, x, y, 12, { key: 'fire', size: 40, spread: 220 });
  sparkle(host, x, y, 10, size * 0.7);
  smoke(host, x, y, 7, 'rd-smoke-dark');
}

function ripple(host: HTMLElement, x: number, y: number) {
  if (reduced()) return;
  for (let i = 0; i < 2; i++) {
    const r = document.createElement('i');
    r.className = 'rd-ripple';
    r.style.cssText = `left:${x}px;top:${y}px`;
    host.appendChild(r);
    r.animate(
      [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(3.2)', opacity: 0 }],
      { duration: 700, delay: i * 140, easing: 'ease-out', fill: 'both' },
    ).finished.then(() => r.remove());
  }
}
