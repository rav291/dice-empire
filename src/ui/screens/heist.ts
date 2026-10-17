import './heist.css';
import type { GameEvent, HeistPrize, ScreenDeps } from '../../contract';
import { asset } from '../../shared/manifest';
import { banner, burst, collect, esc, ic, mount, pop, q, reduced, shake, sparkle, wait } from './common';

type HeistResult = Extract<GameEvent, { t: 'heistResult' }>;

const ORDER: HeistPrize[] = ['gold', 'silver', 'bronze'];
const LABEL: Record<HeistPrize, string> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };

// Wheel handle: 3 spokes through a hub, ball knobs past the rim. Gradients live in one shared <defs>.
const SPOKES = [90, 30, -30].map((a) => {
  const r = (a * Math.PI) / 180;
  const x = 44 * Math.cos(r), y = 44 * Math.sin(r);
  return { d: `M${50 - x} ${50 - y}L${50 + x} ${50 + y}`, ends: [[50 - x, 50 - y], [50 + x, 50 + y]] };
});
const WHEEL = `<svg class="hz-wheel" viewBox="0 0 100 100" aria-hidden="true">
  <g fill="none" stroke-linecap="round">
    ${SPOKES.map((s) => `<path d="${s.d}" stroke="#262b33" stroke-width="10"/><path d="${s.d}" stroke="url(#hz-g-spoke)" stroke-width="6"/>`).join('')}
    <circle cx="50" cy="50" r="30" stroke="#262b33" stroke-width="11"/>
    <circle cx="50" cy="50" r="30" stroke="url(#hz-g-ring)" stroke-width="7"/>
  </g>
  ${SPOKES.flatMap((s) => s.ends).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.5" fill="url(#hz-g-knob)" stroke="#262b33" stroke-width="2.5"/>`).join('')}
  <circle cx="50" cy="50" r="12" fill="url(#hz-g-hub)" stroke="#262b33" stroke-width="3"/>
  <circle cx="46" cy="46" r="3.5" fill="#fff" opacity=".7"/>
</svg>`;
const BOLTS = `<svg class="hz-dial" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="41" fill="url(#hz-g-plate)" stroke="#2c323c" stroke-width="2.5"/>
  <circle cx="50" cy="50" r="35" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/>
  ${Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return `<circle cx="${50 + 38 * Math.cos(a)}" cy="${50 + 38 * Math.sin(a)}" r="2.3" fill="url(#hz-g-knob)" stroke="#2c323c" stroke-width="1"/>`;
  }).join('')}
</svg>`;
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="hz-g-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c4"/><stop offset=".45" stop-color="#e7b43c"/><stop offset="1" stop-color="#8a5a10"/></linearGradient>
  <linearGradient id="hz-g-spoke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdf2c0"/><stop offset=".5" stop-color="#d9a33a"/><stop offset="1" stop-color="#7d4f0c"/></linearGradient>
  <radialGradient id="hz-g-knob" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fffbe6"/><stop offset=".45" stop-color="#e8b94a"/><stop offset="1" stop-color="#7a4c0b"/></radialGradient>
  <radialGradient id="hz-g-hub" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c7ced8"/><stop offset="1" stop-color="#4b5361"/></radialGradient>
  <radialGradient id="hz-g-plate" cx=".4" cy=".3" r=".85"><stop offset="0" stop-color="#f4f6fa"/><stop offset=".55" stop-color="#a7afbc"/><stop offset="1" stop-color="#5b6372"/></radialGradient>
</defs></svg>`;

const loot = (p: HeistPrize) =>
  `<span class="hz-loot is-${p}"><span class="hz-glow"></span><span class="hz-bars"><i></i><i></i><i></i></span>${ic(`medal_${p}`, 'hz-medal')}</span>`;

const possessive = (n: string) => (n.endsWith('s') ? `${n}'` : `${n}'s`);

export async function runHeist(deps: ScreenDeps): Promise<void> {
  const { game } = deps;
  const p0 = game.state.pending;
  if (!p0 || p0.kind !== 'heist') return;
  const rival = game.state.rivals.find((r) => r.id === p0.rivalId);
  const name = rival?.name ?? 'Rival';

  const ui = mount(deps, 'hz'); // no Esc: a heist must be finished
  const metal = deps.manifest.textures?.metal;
  if (metal?.color) ui.el.style.setProperty('--metal', `url("${asset(metal.color)}")`);
  if (metal?.normal) ui.el.style.setProperty('--metal-n', `url("${asset(metal.normal)}")`);

  const title = `Heist on ${possessive(name)} Bank!`;
  ui.el.innerHTML = `${DEFS}
    <div class="hz-bg"></div>
    <div class="hz-wrap sc-pop">
      <header class="hz-head">
        <div class="sc-avatar">${ic(rival?.avatar ?? 'avatar_fox')}</div>
        <div class="hz-head-txt">
          <span class="sc-display hz-title" data-text="${esc(title)}">${esc(title)}</span>
          <div class="hz-sub">Crack the doors. Match <b>3</b> to win!</div>
        </div>
      </header>
      <div class="hz-track">
        ${ORDER.map((p) => `<div class="hz-trow is-${p}" data-p="${p}">${ic(`medal_${p}`, 'hz-tmedal')}<span class="hz-slots"><i></i><i></i><i></i></span></div>`).join('')}
      </div>
      <div class="hz-grid">
        ${Array.from({ length: 12 }, (_, i) => `
          <button class="hz-door" data-i="${i}" aria-label="Vault door ${i + 1}">
            <span class="hz-recess"></span>
            <span class="hz-leaf">
              <span class="hz-face">
                <span class="hz-plate">${String(i + 1).padStart(2, '0')}</span>
                ${BOLTS}${WHEEL}
              </span>
              <span class="hz-back"></span>
            </span>
          </button>`).join('')}
      </div>
    </div>`;

  const grid = q(ui.el, '.hz-grid');
  const doors = [...grid.querySelectorAll<HTMLButtonElement>('.hz-door')];
  const counts: Record<HeistPrize, number> = { gold: 0, silver: 0, bronze: 0 };

  const renderTrack = (fresh?: HeistPrize) => {
    for (const p of ORDER) {
      const row = q(ui.el, `.hz-trow[data-p="${p}"]`);
      row.querySelectorAll('i').forEach((s, k) => s.classList.toggle('on', k < counts[p]));
      row.classList.toggle('hot', counts[p] === 2);
      if (fresh === p) {
        pop(row, 1.12, 300);
        const slot = row.querySelectorAll('i')[counts[p] - 1];
        if (slot) pop(slot, 1.6, 360);
      }
    }
  };

  const openDoor = (d: HTMLButtonElement, prize: HeistPrize) => {
    q(d, '.hz-recess').innerHTML = loot(prize);
    d.classList.add('open', `is-${prize}`);
    d.setAttribute('aria-label', `${LABEL[prize]} found`);
  };

  // Resume: doors opened before a reload are shown open, without animation.
  p0.doors.forEach((prize, i) => {
    if (!prize) return;
    doors[i].classList.add('instant');
    openDoor(doors[i], prize);
    counts[prize]++;
  });
  renderTrack();
  requestAnimationFrame(() => doors.forEach((d) => d.classList.remove('instant')));

  const rm = reduced();
  const reveal = async (d: HTMLButtonElement, prize: HeistPrize) => {
    deps.sfx('door');
    d.classList.add('turning');
    await q(d, '.hz-wheel').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-220deg)' }], {
      duration: rm ? 1 : 380, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards',
    }).finished;
    openDoor(d, prize);
    await wait(rm ? 0 : 240);
    deps.sfx('coin');
    counts[prize]++;
    renderTrack(prize);
    const gr = grid.getBoundingClientRect(), dr = d.getBoundingClientRect();
    sparkle(grid, dr.left - gr.left + dr.width / 2, dr.top - gr.top + dr.height / 2, 8, dr.width * 0.55);
    await wait(rm ? 0 : 200);
  };

  const later: GameEvent[] = [];
  let busy = false;
  const result = await new Promise<HeistResult>((done) => {
    grid.addEventListener('click', async (e) => {
      const d = (e.target as Element).closest<HTMLButtonElement>('.hz-door');
      if (!d || busy || d.classList.contains('open')) return;
      busy = true;
      let evs: GameEvent[];
      try {
        evs = game.heistPick(+d.dataset.i!);
      } catch {
        deps.sfx('error');
        shake(d, 6, 300);
        busy = false;
        return;
      }
      deps.save(); // so a reload mid-heist resumes with these doors open
      let res: HeistResult | undefined;
      for (const ev of evs) {
        if (ev.t === 'heistReveal') await reveal(doors[ev.door] ?? d, ev.prize);
        else if (ev.t === 'heistResult') res = ev;
        else later.push(ev);
      }
      if (res) done(res);
      else busy = false;
    });
  });

  // Matched doors glow, the rest dim, then the big reveal.
  await wait(rm ? 0 : 300);
  doors.forEach((d) => d.classList.add(d.classList.contains(`is-${result.prize}`) ? 'win' : 'dim'));
  await wait(rm ? 200 : 950);

  const stage = document.createElement('div');
  stage.className = `hz-result is-${result.prize}`;
  stage.innerHTML = `<div class="sc-rays"></div><div class="hz-bigloot">${loot(result.prize)}${ic('money_bag', 'hz-bag')}</div>`;
  ui.el.appendChild(stage);
  deps.sfx('heist_win');
  const sr = stage.getBoundingClientRect(), lr = q(stage, '.hz-bigloot').getBoundingClientRect();
  const cx = lr.left - sr.left + lr.width / 2, cy = lr.top - sr.top + lr.height / 2;
  burst(stage, cx, cy, 40, { spread: Math.min(460, sr.width * 0.6) });
  sparkle(stage, cx, cy, 12, lr.width * 0.7);
  await banner(stage, `${LABEL[result.prize]} HEIST!`, result.prize);
  await collect(deps, stage, { title: `You cracked ${possessive(name)} vault!`, amount: result.coins, isTop: ui.isTop, variant: 'hz-reward' });
  await ui.close();
  if (later.length) await deps.play(later);
}
