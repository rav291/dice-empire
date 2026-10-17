import './album.css';
import type { ScreenDeps } from '../../contract';
import { stickerImg } from '../../shared/manifest';
import { STICKERS, STICKER_SETS, type StickerSet } from '../../shared/stickers';
import { BACK_SVG, CHECK_SVG, CLOSE_SVG, esc, ic, mount, q, starsHtml } from './common';


export async function openAlbum(deps: ScreenDeps): Promise<void> {
  const { game } = deps;
  let view: StickerSet | null = null;
  let requestClose = () => {};
  const ui = mount(deps, 'ab', () => (view ? show(null) : requestClose()));
  deps.sfx('popup');

  const owned = (id: string) => game.state.stickers[id] ?? 0;
  const have = (set: string) => STICKERS.filter((s) => s.set === set && owned(s.id) > 0).length;
  const total = STICKERS.filter((s) => owned(s.id) > 0).length;

  ui.el.innerHTML = `
    <div class="sc-scrim"></div>
    <section class="ab-book panel sc-pop" role="dialog" aria-label="Sticker album">
      <header class="ab-head">
        <button class="btn sc-round ab-back" aria-label="Back">${BACK_SVG}</button>
        <div class="ab-titles">
          ${ic('album', 'ab-head-ic')}
          <span class="sc-display ab-title" data-text="Sticker Album">Sticker Album</span>
        </div>
        <div class="ab-total" title="Stickers collected"><b>${total}</b>/${STICKERS.length}</div>
        <button class="btn btn-red sc-round ab-close" aria-label="Close">${CLOSE_SVG}</button>
      </header>
      <div class="ab-page"></div>
    </section>`;
  const book = q(ui.el, '.ab-book');
  const page = q(ui.el, '.ab-page');

  const overview = () => `
    <div class="ab-sets">
      ${STICKER_SETS.map((s, i) => {
        const n = have(s.id);
        const done = game.state.completedSets.includes(s.id) || n === 9;
        const mine = STICKERS.filter((x) => x.set === s.id);
        const hero = [...mine].reverse().find((x) => owned(x.id) > 0) ?? mine[8];
        const locked = owned(hero.id) === 0;
        return `
        <button class="ab-set ${done ? 'done' : ''}" data-set="${s.id}" style="--c:${s.color};animation-delay:${i * 45}ms">
          <span class="ab-set-band"><span class="ab-set-name">${esc(s.name)}</span></span>
          <span class="ab-set-art">
            <img class="${locked ? 'sil' : ''}" src="${stickerImg(hero.id)}" alt="" draggable="false">
            ${locked ? '<span class="ab-q">?</span>' : ''}
          </span>
          <span class="ab-set-foot">
            <span class="ab-bar"><i style="width:${(n / 9) * 100}%"></i></span>
            <span class="ab-set-n">${n}/9</span>
          </span>
          <span class="ab-reward">${ic('dice', 'ab-reward-ic')}<b>${s.rewardDice}</b></span>
          ${done ? `<span class="ab-check">${CHECK_SVG}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;

  const detail = (s: StickerSet) => {
    const n = have(s.id);
    const done = game.state.completedSets.includes(s.id) || n === 9;
    return `
    <div class="ab-detail" style="--c:${s.color}">
      <div class="ab-dhead">
        <span class="sc-display ab-dname" data-text="${esc(s.name)}">${esc(s.name)}</span>
        <span class="ab-dprog"><span class="ab-bar"><i style="width:${(n / 9) * 100}%"></i></span><b>${n}/9</b></span>
        <span class="ab-reward big ${done ? 'claimed' : ''}">${done ? CHECK_SVG : ''}${ic('dice', 'ab-reward-ic')}<b>${s.rewardDice}</b></span>
      </div>
      <div class="ab-grid">
        ${STICKERS.filter((x) => x.set === s.id).map((x, i) => {
          const c = owned(x.id);
          return `
          <div class="ab-st s${x.stars} ${c ? '' : 'locked'}" style="animation-delay:${i * 35}ms;--tilt:${((i * 37) % 5) - 2}deg">
            <div class="ab-st-art">
              <img src="${stickerImg(x.id)}" alt="" draggable="false">
              ${c ? '' : '<span class="ab-q">?</span>'}
            </div>
            <div class="ab-st-name">${esc(x.name)}</div>
            ${starsHtml(x.stars)}
            ${c > 1 ? `<span class="ab-dup">+${c - 1}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  };

  const show = (s: StickerSet | null) => {
    view = s;
    book.classList.toggle('in-detail', !!s);
    page.innerHTML = s ? detail(s) : overview();
    page.scrollTop = 0;
    if (s) deps.sfx('whoosh');
  };
  show(null);

  page.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.ab-set');
    if (!b) return;
    deps.sfx('click');
    show(STICKER_SETS.find((s) => s.id === b.dataset.set) ?? null);
  });
  q(ui.el, '.ab-back').addEventListener('click', () => { deps.sfx('click'); show(null); });

  await new Promise<void>((done) => {
    requestClose = done;
    q(ui.el, '.ab-close').addEventListener('click', () => { deps.sfx('click'); done(); });
    q(ui.el, '.sc-scrim').addEventListener('click', () => done());
  });
  await ui.close();
}
