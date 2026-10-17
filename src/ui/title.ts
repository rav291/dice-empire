// Loading + title screen: animated logo, floating icons, progress bar, PLAY.
import { img, reduced } from './fx';

const TIPS = [
  'Hold GO to auto-roll',
  'Raise the multiplier for bigger rewards',
  'Shields block rival raids',
  'Own a whole color set for a bonus',
  'Finish all 5 landmarks to unlock a new city',
  'A free gift arrives every hour',
];

const FLOATERS: [string, string][] = [
  ['dice', 'f1'], ['coin', 'f2'], ['money_bag', 'f3'], ['gem', 'f4'], ['coin', 'f6'], ['star', 'f7'], ['dice', 'f8'],
];

// stacked copies: dark outline + 3D extrude, white rim, gradient fill, gloss
const word = (t: string, cls: string) =>
  `<span class="ttl-word ${cls}" aria-hidden="true">${['l1', 'l2', 'l3', 'l4'].map((l) => `<span class="${l}">${t}</span>`).join('')}</span>`;

export class TitleScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private pct: HTMLElement;
  private shown = 0;

  constructor(parent: HTMLElement) {
    const el = (this.el = document.createElement('div'));
    el.className = 'ttl';
    el.innerHTML = `
      <div class="ttl-rays" aria-hidden="true"></div>
      <div class="ttl-stage">
        <div class="ttl-floaters" aria-hidden="true">${FLOATERS.map(([k, c]) => img(k, `ttl-f ${c}`)).join('')}</div>
        <h1 class="ttl-logo" aria-label="Dice Empire">${img('crown', 'ttl-crown')}${word('DICE', 'w1')}${word('EMPIRE', 'w2')}</h1>
        <p class="ttl-tag">Roll · Build · Rule the board</p>
      </div>
      <div class="ttl-foot">
        <div class="ttl-load" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="ttl-bar"><i></i></div><span class="ttl-pct">LOADING 0%</span>
        </div>
        <button class="btn btn-go ttl-play" hidden>PLAY</button>
        <p class="ttl-tip">${img('glow_star', 'ttl-tip-ic')}<span>Tip: ${TIPS[Math.floor(Math.random() * TIPS.length)]}</span></p>
      </div>`;
    parent.append(el);
    this.bar = el.querySelector('.ttl-bar i')!;
    this.pct = el.querySelector('.ttl-pct')!;
  }

  progress(p: number) {
    const v = Math.max(this.shown, Math.min(1, p)); // never runs backwards
    this.shown = v;
    this.bar.style.width = `${(v * 100).toFixed(1)}%`;
    const n = Math.round(v * 100);
    this.pct.textContent = `LOADING ${n}%`;
    this.el.querySelector('.ttl-load')!.setAttribute('aria-valuenow', String(n));
  }

  /** Swap the bar for PLAY; resolves on the first press (a user gesture, for audio unlock). */
  waitForPlay(): Promise<void> {
    this.progress(1);
    const play = this.el.querySelector<HTMLButtonElement>('.ttl-play')!;
    this.el.classList.add('ready');
    play.hidden = false;
    play.focus({ preventScroll: true });
    return new Promise((r) => play.addEventListener('click', () => r(), { once: true }));
  }

  error(msg: string) {
    this.el.classList.add('failed');
    this.pct.textContent = msg;
    const b = this.el.querySelector<HTMLButtonElement>('.ttl-play')!;
    b.hidden = false;
    b.textContent = 'RETRY';
    b.onclick = () => location.reload();
  }

  async leave() {
    this.el.classList.add('leaving');
    await new Promise((r) => setTimeout(r, reduced() ? 0 : 700));
    this.el.remove();
  }
}
