import './packs.css';
import type { GameEvent, ScreenDeps } from '../../contract';
import { stickerImg } from '../../shared/manifest';
import { PACK_NAMES, STICKERS, STICKER_SETS } from '../../shared/stickers';
import { esc, ic, mount, onKey, q, reduced, shake, sparkle, starsHtml } from './common';

type StickersEv = Extract<GameEvent, { t: 'stickers' }>;

export async function showPackOpening(deps: ScreenDeps, ev: StickersEv): Promise<void> {
  const rm = reduced();
  let skipping = false;
  let wake = () => {};
  const nap = (ms: number) =>
    skipping || rm ? Promise.resolve() : new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      wake = () => { clearTimeout(t); r(); };
    });
  let advance = () => {};
  const skip = () => {
    if (skipping) return;
    skipping = true;
    wake();
    advance();
  };

  const tier = Math.min(5, Math.max(1, ev.pack));
  const ui = mount(deps, `pk pk-t${tier}`, () => skip());
  const name = PACK_NAMES[tier] ?? 'Sticker Pack';
  const defs = ev.ids
    .map((id) => STICKERS.find((s) => s.id === id))
    .filter((s): s is (typeof STICKERS)[number] => !!s)
    .sort((a, b) => a.stars - b.stars);
  const isNew = (id: string) => ev.newIds.includes(id);
  const newCount = new Set(ev.newIds).size;

  ui.el.innerHTML = `
    <div class="pk-bg t${tier}"></div>
    <div class="sc-rays"></div>
    <div class="pk-stage">
      <button class="pk-pack t${tier}" aria-label="Open ${esc(name)}">
        <span class="pk-top"><span class="pk-crimp"></span></span>
        <span class="pk-body">
          <span class="pk-holo"></span>
          <span class="pk-stars">${starsHtml(tier)}</span>
          ${ic('album', 'pk-emblem')}
          <span class="pk-name">${esc(name)}</span>
          <span class="pk-count">${defs.length} STICKERS</span>
          <span class="pk-crimp bot"></span>
          <span class="pk-shine"></span>
        </span>
      </button>
      <div class="pk-tap">Tap to open!</div>
    </div>
    <div class="pk-cards n${defs.length}"></div>
    <button class="pk-skip">Tap to skip<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l7 7-7 7M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  deps.sfx('popup');

  const stage = q(ui.el, '.pk-stage');
  const pack = q(ui.el, '.pk-pack');
  const cardsEl = q(ui.el, '.pk-cards');
  const skipBtn = q(ui.el, '.pk-skip');
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); deps.sfx('click'); skip(); });

  // 1 - wait for a tap on the pack (or anywhere / Space / skip)
  await new Promise<void>((done) => {
    advance = done;
    const off = onKey(['Space', 'Enter'], ui.isTop, () => { off(); done(); });
    ui.el.addEventListener('pointerdown', () => done(), { once: true });
  });

  // 2 - tear
  deps.sfx('whoosh');
  ui.el.classList.add('torn');
  if (!skipping && !rm) {
    shake(pack, 8, 260);
    await nap(260);
    pack.classList.add('rip');
    const pr = pack.getBoundingClientRect();
    sparkle(ui.el, pr.left + pr.width / 2, pr.top + pr.height * 0.18, 14, pr.width * 0.8);
    await nap(520);
  }
  stage.classList.add('gone');

  // 3 - cards fly out of the pack and flip one by one
  cardsEl.innerHTML = defs.map((s) => {
    const set = STICKER_SETS.find((x) => x.id === s.set);
    return `
    <div class="pk-card s${s.stars}" style="--c:${set?.color ?? '#3aa8ff'}">
      <div class="pk-card-in">
        <div class="pk-face pk-back">${ic('album', 'pk-back-ic')}</div>
        <div class="pk-face pk-front">
          <div class="pk-front-set">${esc(set?.name ?? '')}</div>
          <div class="pk-front-art"><img src="${stickerImg(s.id)}" alt="" draggable="false"></div>
          <div class="pk-front-name">${esc(s.name)}</div>
          ${starsHtml(s.stars)}
        </div>
      </div>
      ${isNew(s.id) ? '<span class="pk-new">NEW!</span>' : `<span class="pk-dup">x${deps.game.state.stickers[s.id] ?? 1}</span>`}
    </div>`;
  }).join('');
  const cards = [...cardsEl.querySelectorAll<HTMLElement>('.pk-card')];
  const pr = pack.getBoundingClientRect();
  const px = pr.left + pr.width / 2, py = pr.top + pr.height / 2;
  if (!skipping && !rm) {
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      c.animate(
        [
          { transform: `translate(${px - r.left - r.width / 2}px, ${py - r.top - r.height / 2}px) scale(.25) rotate(${i * 25 - 40}deg)`, opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 520, delay: i * 90, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'backwards' },
      );
    });
    deps.sfx('whoosh');
    await nap(520 + cards.length * 90);
  }
  for (const c of cards) {
    if (skipping) break;
    c.classList.add('flipped');
    const best = c.classList.contains('s4') || c.classList.contains('s5');
    deps.sfx(best ? 'upgrade' : 'sticker');
    const r = c.getBoundingClientRect();
    if (best || c.querySelector('.pk-new')) sparkle(ui.el, r.left + r.width / 2, r.top + r.height / 2, best ? 14 : 8, r.width * 0.75);
    await nap(best ? 620 : 400);
  }
  cards.forEach((c) => c.classList.add('flipped', 'settled'));

  // 4 - summary
  skipBtn.remove();
  const sum = document.createElement('div');
  sum.className = 'pk-sum';
  sum.innerHTML = `
    <div class="pk-sum-txt">${defs.length} stickers${newCount ? ` &middot; <b>${newCount} NEW!</b>` : ''}</div>
    <button class="btn btn-go pk-ok">AWESOME!</button>`;
  ui.el.appendChild(sum);
  if (newCount) deps.sfx('set_complete');
  const ok = q<HTMLButtonElement>(sum, '.pk-ok');
  ok.focus({ preventScroll: true });
  await new Promise<void>((done) => {
    const off = onKey(['Space', 'Enter'], ui.isTop, () => fin());
    advance = () => fin();
    function fin() { off(); deps.sfx('click'); done(); }
    ok.addEventListener('click', fin, { once: true });
  });
  await ui.close();
}
