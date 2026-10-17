import './build.css';
import type { GameEvent, ScreenDeps } from '../../contract';
import { cityTheme } from '../../shared/manifest';
import { CHECK_SVG, CLOSE_SVG, countUp, esc, fmt, ic, mount, q, reduced, setImg, shake, sparkle, wait } from './common';

type LandmarkEv = Extract<GameEvent, { t: 'landmark' }>;

export async function openBuild(deps: ScreenDeps): Promise<void> {
  const { game, board, manifest } = deps;
  let requestClose = () => {};
  const ui = mount(deps, 'bd', () => requestClose());
  void board.setView('city').catch(() => {});
  deps.sfx('popup');

  ui.el.innerHTML = `
    <div class="bd-shade"></div>
    <section class="bd-panel panel" role="dialog" aria-label="Build your city">
      <header class="bd-head">
        <div class="bd-head-row">
          <div class="bd-city">
            <span class="bd-kicker">${ic('build', 'bd-kicker-ic')}<span class="bd-city-n"></span></span>
            <span class="sc-display bd-city-name"></span>
          </div>
          <div class="bd-coins">${ic('coin', 'bd-coin-ic')}<span></span></div>
          <button class="btn btn-red sc-round bd-close" aria-label="Close">${CLOSE_SVG}</button>
        </div>
        <div class="bd-prog"><div class="bd-prog-bar"><i></i></div><span class="bd-prog-txt"></span></div>
      </header>
      <div class="bd-list"></div>
    </section>`;

  const panel = q(ui.el, '.bd-panel');
  const list = q(ui.el, '.bd-list');
  const coinsEl = q(ui.el, '.bd-coins span');
  let shownCoins = game.state.coins;
  let city = -1;
  let paused = false;
  let chain: Promise<void> = Promise.resolve();

  const keyOf = (i: number) => cityTheme(manifest, game.state.city).landmarks[i];

  const renderCity = () => {
    city = game.state.city;
    const theme = cityTheme(manifest, city);
    panel.style.setProperty('--accent', theme.accent);
    q(ui.el, '.bd-city-n').textContent = `City ${city + 1}`;
    const nm = q(ui.el, '.bd-city-name');
    nm.textContent = theme.name;
    nm.dataset.text = theme.name;
    list.innerHTML = theme.landmarks.map((key, i) => `
      <article class="bd-card" data-i="${i}" style="animation-delay:${i * 50}ms">
        <div class="bd-thumb sc-shimmer"><img alt=""></div>
        <div class="bd-info">
          <div class="bd-name">${esc(manifest.models.landmarks[key]?.name ?? `Landmark ${i + 1}`)}</div>
          <div class="bd-pips">${[1, 2, 3, 4].map(() => '<i></i>').join('')}</div>
          <div class="bd-stage"></div>
        </div>
        <button class="btn btn-go bd-btn"><span class="bd-btn-label">BUILD</span><span class="bd-cost">${ic('coin', 'bd-cost-ic')}<b></b></span></button>
        <div class="bd-done">${CHECK_SVG}<span>COMPLETE</span></div>
        <div class="bd-need"></div>
      </article>`).join('');
  };

  const thumbFor = (i: number) => {
    const card = list.children[i] as HTMLElement;
    const l = game.state.landmarks[i];
    // Always preview the finished landmark (the goal); the pips show progress.
    const want = `${keyOf(i)}:${l.damaged}`;
    if (card.dataset.thumb === want) return;
    card.dataset.thumb = want;
    const box = q(card, '.bd-thumb');
    box.classList.add('sc-shimmer');
    board.renderLandmarkThumbnail(keyOf(i), 4, l.damaged)
      .then((url) => (card.dataset.thumb === want ? setImg(q<HTMLImageElement>(box, 'img'), url) : false))
      .catch(() => false)
      .finally(() => { if (card.dataset.thumb === want) box.classList.remove('sc-shimmer'); });
  };

  const refresh = () => {
    if (game.state.city !== city) renderCity();
    const st = game.state;
    let total = 0;
    st.landmarks.forEach((l, i) => {
      total += l.stage;
      const card = list.children[i] as HTMLElement;
      const cost = game.landmarkCost(i);
      const done = cost == null;
      const poor = !done && st.coins < cost;
      card.classList.toggle('complete', done);
      card.classList.toggle('damaged', l.damaged);
      card.classList.toggle('poor', poor);
      card.querySelectorAll('.bd-pips i').forEach((p, k) => {
        p.classList.toggle('on', k < l.stage);
        p.classList.toggle('bad', l.damaged && k === l.stage - 1);
      });
      q(card, '.bd-stage').textContent = done ? 'Fully built!' : l.damaged ? 'Damaged by a raid' : `Stage ${l.stage}/4`;
      const btn = q<HTMLButtonElement>(card, '.bd-btn');
      btn.disabled = done || poor;
      btn.classList.toggle('btn-go', !l.damaged);
      btn.classList.toggle('btn-orange', l.damaged);
      q(btn, '.bd-btn-label').textContent = l.damaged ? 'REPAIR' : 'BUILD';
      q(btn, '.bd-cost b').textContent = done ? '' : fmt(cost);
      btn.setAttribute('aria-label', done ? 'Complete' : `${l.damaged ? 'Repair' : 'Build'} for ${fmt(cost)} coins`);
      q(card, '.bd-need').textContent = poor ? `Need ${fmt(cost - st.coins)} more` : '';
      thumbFor(i);
    });
    q(ui.el, '.bd-prog-bar i').style.width = `${(total / 20) * 100}%`;
    q(ui.el, '.bd-prog-txt').textContent = `${total}/20`;
  };

  const setCoins = (animate: boolean) => {
    const to = game.state.coins;
    if (animate) void countUp(coinsEl, shownCoins, to, 450);
    else coinsEl.textContent = fmt(to);
    shownCoins = to;
  };

  renderCity();
  refresh();
  setCoins(false);

  const floatText = (card: HTMLElement, text: string) => {
    if (reduced()) return;
    const f = document.createElement('div');
    f.className = 'bd-float';
    f.textContent = text;
    q(card, '.bd-thumb').appendChild(f);
    f.animate(
      [{ transform: 'translate(-50%, 0) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -26px) scale(1.1)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%, -60px) scale(1)', opacity: 0 }],
      { duration: 900, easing: 'ease-out', fill: 'forwards' },
    ).finished.then(() => f.remove());
  };

  const build = (i: number, btn: HTMLButtonElement) => {
    const card = list.children[i] as HTMLElement;
    let evs: GameEvent[];
    try {
      evs = game.buildLandmark(i);
    } catch {
      deps.sfx('error');
      shake(btn, 6, 300);
      return;
    }
    deps.save();
    const lmEvs = evs.filter((e): e is LandmarkEv => e.t === 'landmark');
    const rest = evs.filter((e) => e.t !== 'landmark');
    deps.sfx('build');

    // Instant feedback so rapid tapping feels great; the 3D build animates in the background queue.
    card.classList.remove('bump');
    void card.offsetWidth;
    card.classList.add('bump');
    const pr = panel.getBoundingClientRect(), tr = q(card, '.bd-thumb').getBoundingClientRect();
    sparkle(panel, tr.left - pr.left + tr.width / 2, tr.top - pr.top + tr.height / 2, 10, tr.width * 0.7);
    floatText(card, lmEvs.some((e) => e.repaired) ? 'REPAIRED!' : lmEvs[0]?.stage === 4 ? 'COMPLETE!' : '+1 STAGE');
    setCoins(true);
    q(ui.el, '.bd-coins').animate([{ transform: 'scale(1)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 220 });
    refresh();

    // Packs (stages 2 & 4) and city completion take over the screen: hold taps until they're presented.
    const big = rest.some((e) => e.t === 'cityComplete' || e.t === 'newCity');
    const hold = big || rest.some((e) => e.t === 'stickers');
    if (hold) paused = true;
    chain = chain.then(async () => {
      try {
        for (const ev of lmEvs) await board.setLandmark(ev.index, ev.stage, false).catch(() => {});
        if (big) {
          panel.classList.add('away');
          await wait(reduced() ? 0 : 450);
        }
        if (rest.length) await deps.play(rest);
      } catch (err) {
        console.warn('[build] presenting events failed', err);
      } finally {
        if (hold) {
          if (big) void board.setView('city').catch(() => {});
          refresh();
          setCoins(true);
          panel.classList.remove('away');
          paused = false;
        }
      }
    });
  };

  list.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.bd-btn');
    if (!btn || btn.disabled || paused) return;
    build(+btn.closest<HTMLElement>('.bd-card')!.dataset.i!, btn);
  });

  await new Promise<void>((done) => {
    requestClose = () => { if (!paused) done(); };
    q(ui.el, '.bd-close').addEventListener('click', () => { deps.sfx('click'); requestClose(); });
    q(ui.el, '.bd-shade').addEventListener('click', () => requestClose());
  });
  paused = true;
  panel.classList.add('away');
  await chain;
  await Promise.all([ui.close(), board.setView('board').catch(() => {})]);
}
