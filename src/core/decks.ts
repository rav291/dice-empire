import type { IconKey, PackTier } from '../contract';

export type CardFx =
  | { kind: 'coins'; k: number } // ×S·m
  | { kind: 'dice'; n: number }
  | { kind: 'shield' }
  | { kind: 'pack'; tier: PackTier }
  | { kind: 'go' }
  | { kind: 'rail' }
  | { kind: 'back3' }
  | { kind: 'jail' }
  | { kind: 'heist' }
  | { kind: 'raid' };

export interface Card { title: string; text: string; icon: IconKey; w: number; fx: CardFx }

// `{n}` in text is replaced with the actual amount.
export const DECKS: Record<'chance' | 'chest', Card[]> = {
  chance: [
    { title: 'Bank Blunder', text: 'The bank slipped a decimal in your favor. Collect {n} coins!', icon: 'bank', w: 3, fx: { kind: 'coins', k: 3 } },
    { title: 'Street Talent', text: 'Your sidewalk show went viral. Collect {n} coins!', icon: 'star', w: 2, fx: { kind: 'coins', k: 2 } },
    { title: 'Lucky Roll', text: 'Fresh dice, hot off the press! +{n} dice.', icon: 'dice', w: 2, fx: { kind: 'dice', n: 5 } },
    { title: 'Force Field', text: 'Your city just got a shield upgrade.', icon: 'shield', w: 2, fx: { kind: 'shield' } },
    { title: 'Sticker Drop', text: 'A sticker pack fell from the sky!', icon: 'album', w: 2, fx: { kind: 'pack', tier: 1 } },
    { title: 'Express Lane', text: 'Advance to GO and collect big.', icon: 'go', w: 2, fx: { kind: 'go' } },
    { title: 'All Aboard!', text: 'Advance to the next station.', icon: 'rail', w: 2, fx: { kind: 'rail' } },
    { title: 'Wrong Turn', text: 'Oops! Move back 3 spaces.', icon: 'hourglass', w: 2, fx: { kind: 'back3' } },
    { title: 'Busted!', text: 'Caught jaywalking. Go straight to jail.', icon: 'siren', w: 1, fx: { kind: 'jail' } },
    { title: 'Vault Tip-Off', text: 'A rival left the vault open. Heist time!', icon: 'money_bag', w: 1, fx: { kind: 'heist' } },
    { title: 'Cannon Ready', text: 'The cannon is loaded. Raid a rival!', icon: 'target', w: 1, fx: { kind: 'raid' } },
  ],
  chest: [
    { title: 'Birthday Bash', text: 'Everyone chipped in. Collect {n} coins!', icon: 'party', w: 3, fx: { kind: 'coins', k: 2 } },
    { title: 'Golden Ticket', text: 'Jackpot! Collect {n} coins!', icon: 'money_bag', w: 1, fx: { kind: 'coins', k: 5 } },
    { title: 'Dice Bag', text: 'A bag full of dice! +{n} dice.', icon: 'dice', w: 3, fx: { kind: 'dice', n: 8 } },
    { title: 'Safety First', text: 'A free shield for your city.', icon: 'shield', w: 2, fx: { kind: 'shield' } },
    { title: 'Sticker Surprise', text: 'A shiny sticker pack, just for you!', icon: 'gift', w: 2, fx: { kind: 'pack', tier: 2 } },
    { title: 'Home Run', text: 'Advance to GO and collect big.', icon: 'go', w: 1, fx: { kind: 'go' } },
    { title: 'Next Stop!', text: 'Hop on the train to the next station.', icon: 'rail', w: 1, fx: { kind: 'rail' } },
    { title: 'Secret Map', text: 'You found the vault map. Heist time!', icon: 'key', w: 1, fx: { kind: 'heist' } },
  ],
};
