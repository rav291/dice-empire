// Director: presents GameEvents in order, awaiting board animations and layering DOM juice on top.
import type { AssetManifest, GameEvent, IBoardView, IconKey, IGame, ScreenDeps, SoundKey } from '../contract';
import { GROUP_COLORS } from '../shared/board-data';
import { cityTheme } from '../shared/manifest';
import { STICKER_SETS } from '../shared/stickers';
import { runHeist } from './screens/heist';
import { runRaid } from './screens/raid';
import { showPackOpening } from './screens/packs';
import { coinSprites, fmt } from './format';
import { banner, center, confetti, floatText, flyIcons, reduced, shake, toast, wait, type Pt } from './fx';
import type { Hud } from './hud';
import { newsText, rewardModal, showCard } from './modals';

type Ev<T extends GameEvent['t']> = Extract<GameEvent, { t: T }>;

export interface DirectorOpts {
  game: IGame;
  board: IBoardView;
  hud: Hud;
  manifest: AssetManifest;
  shake: HTMLElement;              // element to shake on tax / jail
  sfx: (k: SoundKey, o?: { volume?: number; rate?: number }) => void;
  isAuto: () => boolean;
  stopAuto: () => void;
  deps: () => ScreenDeps;
}

const GROUP_NAMES: Record<string, string> = {
  brown: 'Brown', sky: 'Sky', pink: 'Pink', orange: 'Orange', red: 'Red', yellow: 'Yellow', green: 'Green', navy: 'Navy',
};

export class Director {
  private mult = 1;
  private lastCoinSfx = 0;
  constructor(private o: DirectorOpts) {}

  /** Fast presentation while auto-rolling or at high multipliers. */
  private get fast() { return this.o.isAuto() || this.mult >= 10; }
  private k(ms: number) { return Math.round(ms * (reduced() ? 0.5 : this.fast ? 0.6 : 1)); }

  async play(events: GameEvent[]): Promise<void> {
    for (const ev of events) {
      try { await this.one(ev); } catch (e) { console.error('[director]', ev.t, e); }
    }
  }

  private at(tile?: number): Pt {
    if (tile == null) return center();
    const p = this.o.board.tileToScreen(tile);
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : center();
  }

  private async one(ev: GameEvent): Promise<void> {
    const { board, hud, sfx } = this.o;
    switch (ev.t) {
      case 'roll': {
        this.mult = ev.multiplier;
        sfx('roll');
        if (ev.free) floatText('FREE ROLL', { x: innerWidth / 2, y: innerHeight * 0.62 }, { tone: 'green', size: 1.1 });
        await board.rollDice(ev.d1, ev.d2); // board plays dice_land on each bounce
        if (ev.multiplier > 1) floatText(`x${ev.multiplier}`, { x: innerWidth / 2, y: innerHeight * 0.36 }, { tone: ev.multiplier >= 10 ? 'purple' : 'gold', size: 1.4, ms: 900 });
        return;
      }
      case 'doubles':
        sfx('popup');
        await banner('DOUBLES!', ev.streak >= 2 ? 'Careful: one more and it\'s jail!' : 'Roll again for free', { tone: 'green', icon: 'dice', ms: this.k(1200) });
        return;
      case 'jailRoll':
        if (ev.escaped) await banner('ESCAPED!', 'Doubles break you out', { tone: 'green', icon: 'key', ms: this.k(1100) });
        else if (ev.attemptsLeft > 0) await banner('STILL IN JAIL', `${ev.attemptsLeft} ${ev.attemptsLeft === 1 ? 'try' : 'tries'} left`, { tone: 'red', icon: 'lock', ms: this.k(1000) });
        else await banner('RELEASED!', 'Time served, off you go', { tone: 'blue', icon: 'key', ms: this.k(1000) });
        return;
      case 'move': return this.move(ev);
      case 'passGo':
        sfx('coins_big');
        floatText('PASS GO!', this.at(0), { tone: 'green', size: 1.5, icon: 'go' });
        return;
      case 'land':
        board.pulseTile(ev.tile);
        return;
      case 'property': {
        if (ev.level === ev.prevLevel) { // already a hotel: just collect rent
          floatText('RENT', this.at(ev.tile), { tone: 'white', size: 0.8, rise: 60, ms: 1000 });
          return;
        }
        const lbl = ev.level === 1 ? 'BOUGHT!' : ev.level >= 5 ? 'HOTEL!' : `HOUSE ${ev.level - 1}`;
        sfx(ev.level === 1 ? 'build' : 'upgrade');
        floatText(lbl, this.at(ev.tile), { tone: ev.level >= 5 ? 'purple' : 'blue', size: 1.25, icon: ev.level >= 5 ? 'hotel' : 'house', rise: 90 });
        await board.setPropertyLevel(ev.tile, ev.level);
        return;
      }
      case 'coins': return this.coins(ev);
      case 'dice': {
        if (ev.reason === 'roll' || ev.reason === 'regen') { hud.addDice(ev.amount); return; }
        if (ev.amount > 0) {
          floatText(`+${ev.amount}`, center(), { tone: 'green', icon: 'dice', size: 1.3 });
          const n = Math.min(8, Math.max(3, Math.round(ev.amount / 5)));
          const per = ev.amount / n;
          let got = 0;
          await flyIcons('dice', center(), () => hud.dicePoint(), n, {
            size: 48, stagger: 70, ms: this.k(800),
            onArrive: (i) => { const add = Math.round(per * (i + 1)) - got; got += add; hud.addDice(add); sfx('hop', { volume: 0.5, rate: 1.4 }); },
          });
        } else {
          hud.addDice(ev.amount);
          floatText(`${ev.amount}`, hud.dicePoint(), { tone: 'red', icon: 'dice' });
        }
        return;
      }
      case 'shield': {
        if (ev.amount > 0) {
          sfx('popup');
          await flyIcons('shield', center(), () => hud.shieldPoint(ev.total - 1), 1, { size: 72, ms: this.k(800) });
          hud.setShields(ev.total);
          floatText('+1 SHIELD', hud.shieldPoint(ev.total - 1), { tone: 'blue', size: 0.9, rise: -60 });
        } else {
          sfx('blocked');
          hud.setShields(ev.total);
        }
        return;
      }
      case 'card':
        await showCard(ev, this.o.isAuto() ? 1800 : undefined);
        return;
      case 'tax':
        sfx('tax');
        shake(this.o.shake, 14, 520);
        this.o.shake.animate([{ boxShadow: 'inset 0 0 0 0 rgba(255,40,60,0)' }, { boxShadow: 'inset 0 0 120px 30px rgba(255,40,60,.55)' }, { boxShadow: 'inset 0 0 0 0 rgba(255,40,60,0)' }], 600);
        floatText('TAX!', this.at(ev.tile), { tone: 'red', size: 1.4, icon: 'tax' });
        await wait(this.k(350));
        return;
      case 'jail':
        sfx('jail');
        await board.jumpToken(10);
        shake(this.o.shake, 8, 400);
        await banner('JAIL!', ev.reason === 'doubles' ? 'Three doubles in a row!' : ev.reason === 'card' ? 'The card sent you to jail' : 'Roll doubles to break out', { tone: 'red', icon: 'jail', ms: this.k(1500) });
        return;
      case 'setComplete': {
        sfx('set_complete');
        this.extras.celebrate?.();
        confetti({ count: this.fast ? 90 : undefined });
        const hotels = ev.kind === 'hotels';
        const name = GROUP_NAMES[ev.group] ?? ev.group;
        await this.celebrate(hotels ? 'HOTEL SET!' : 'SET COMPLETE!', `${name} street ${hotels ? 'is all hotels' : 'is all yours'}`, hotels ? 'hotel' : 'house', GROUP_COLORS[ev.group]);
        return;
      }
      case 'pending': {
        this.o.stopAuto();
        sfx('whoosh');
        const isHeist = ev.pending.kind === 'heist';
        await banner(isHeist ? 'HEIST!' : 'RAID!', isHeist ? 'Crack the vault' : 'Fire away at a rival', { tone: isHeist ? 'gold' : 'red', icon: isHeist ? 'money_bag' : 'target', ms: 1100 });
        await (isHeist ? runHeist : runRaid)(this.o.deps());
        return;
      }
      case 'stickers':
        await showPackOpening(this.o.deps(), ev);
        return;
      case 'stickerSetComplete': {
        this.o.stopAuto();
        const set = STICKER_SETS.find((s) => s.id === ev.setId);
        sfx('set_complete');
        await rewardModal({ title: 'Album Set Complete!', sub: set ? `You collected every ${set.name} sticker!` : 'Set complete!', icon: 'album', reward: ev.reward, party: true, sound: 'sticker' });
        return;
      }
      case 'cityComplete': {
        this.o.stopAuto();
        sfx('city_complete');
        this.extras.celebrate?.();
        const name = cityTheme(this.o.manifest, ev.city).name;
        await rewardModal({ title: 'City Complete!', sub: `${name} is a masterpiece. On to the next city!`, icon: 'trophy', reward: ev.reward, party: true, sound: 'set_complete', button: 'NEXT CITY' });
        return;
      }
      case 'newCity': {
        sfx('whoosh');
        await board.setCity(ev.city);
        board.sync(this.o.game.state);
        hud.sync();
        const name = cityTheme(this.o.manifest, ev.city).name;
        confetti({ count: 80 });
        await banner(name.toUpperCase(), `Welcome to city ${ev.city + 1}!`, { tone: 'blue', icon: 'rocket', ms: 2000, big: true });
        return;
      }
      case 'attacked': {
        const n = ev.news;
        const t = newsText(n, this.o.game, this.o.manifest);
        sfx(n.blocked ? 'blocked' : n.kind === 'raid' ? 'explosion' : 'tax');
        toast(t.html, { tone: t.tone, avatar: t.avatar, badge: n.blocked ? 'shield' : n.kind === 'raid' ? 'boom' : 'money_bag' });
        hud.setNews(this.o.game.state.news.filter((x) => !x.seen).length);
        if (!n.blocked && n.kind === 'raid' && n.landmark != null) {
          const lm = this.o.game.state.landmarks[n.landmark];
          if (lm) void board.setLandmark(n.landmark, lm.stage, lm.damaged);
        }
        if (n.blocked) hud.setShields(this.o.game.state.shields);
        await wait(this.k(500));
        return;
      }
      case 'gift':
        await rewardModal({ title: 'Free Gift!', sub: 'Here\'s a little something to keep you rolling.', icon: 'gift', reward: ev.reward, party: true, sound: 'chest' });
        return;
      default:
        return; // heistReveal / heistResult / raidResult / landmark are presented by the screens
    }
  }

  private move(ev: Ev<'move'>) {
    return this.o.board.moveToken(ev.path, { fast: this.fast }); // the board plays a hop sound per tile
  }

  /** Optional BoardView extras (not in IBoardView): coin burst from a tile, plaza confetti. */
  private get extras() { return this.o.board as IBoardView & { burstCoins?(tile: number): void; celebrate?(): void }; }

  private async coins(ev: Ev<'coins'>) {
    const { hud, sfx } = this.o;
    const from = ev.reason === 'passGo' ? this.at(0) : this.at(ev.tile);
    if (ev.amount < 0) {
      if (ev.reason === 'robbed') sfx('tax'); // tax plays its own; build/repair sounds belong to the build screen
      const c = hud.coinPoint();
      floatText(`-${fmt(-ev.amount)}`, ev.tile == null ? { x: c.x, y: c.y + 54 } : from, { tone: 'red', size: 1.35, icon: 'coin', rise: ev.tile == null ? -50 : 70 });
      hud.addCoins(ev.amount, 700);
      hud.hurtCoins();
      await wait(this.k(450));
      return;
    }
    if (ev.amount === 0) return;
    const big = ev.amount >= hud.coinsTarget * 0.25 && ev.amount > 1000;
    sfx(big ? 'coins_big' : 'coin');
    if (ev.tile != null) this.extras.burstCoins?.(ev.tile);
    floatText(`+${fmt(ev.amount)}`, from, { tone: 'gold', size: big ? 1.6 : 1.3, rise: 80 });
    const n = this.fast ? Math.min(10, coinSprites(ev.amount)) : coinSprites(ev.amount);
    const ms = this.k(760), stagger = this.fast ? 28 : 40;
    hud.addCoins(ev.amount, n * stagger + 300, ms * 0.85);
    void flyIcons('coin', from, () => hud.coinPoint(), n, {
      size: 40, stagger, ms,
      onArrive: () => {
        hud.bumpCoins();
        const t = performance.now();
        if (t - this.lastCoinSfx > 55) { this.lastCoinSfx = t; sfx('coin', { volume: 0.35, rate: 1 + Math.random() * 0.25 }); }
      },
    });
    await wait(this.fast ? 260 : 620);
  }

  /** Timed celebration ribbon (does not block auto-roll). */
  private celebrate(title: string, sub: string, ic: IconKey, color?: string) {
    return banner(title, sub, { tone: 'gold', icon: ic, ms: this.k(2200), big: true, color });
  }
}
