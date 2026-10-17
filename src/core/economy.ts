import type { HeistPrize, PackTier, Reward } from '../contract';

// Every balance number lives here. Coin amounts are in units of S = scale(city) and are
// multiplied by the roll multiplier m where the rules say "·S·m".
export const MULTIPLIERS = [1, 2, 3, 5, 10, 20, 50, 100];

export const ECON = {
  scaleBase: 1000,
  scaleGrowth: 1.6,

  startCoins: 2,
  startDice: 50,
  diceMax: 50,
  regenMs: 90_000,
  giftMs: 60 * 60_000,
  multDice: 5, // m > 1 needs dice >= multDice·m

  passGo: 2,
  landGo: 4,
  rentBase: 0.3, // rent = S·rentBase·(1 + rentTier·(tier-1))·rentLevel[level]
  rentTier: 0.3,
  rentLevel: [0, 1, 1.5, 2.2, 3.2, 4.5],
  utilityPip: 0.05, // utility = (d1+d2)·utilityPip·tier·S·m
  taxPerTier: 0.25,
  park: 2,
  parkShieldChance: 0.25,
  cardShieldCoins: 2, // shield card when already at 3 shields

  heist: { bronze: 4, silver: 8, gold: 15 } as Record<HeistPrize, number>,
  heistDoors: { bronze: 5, silver: 4, gold: 3 } as Record<HeistPrize, number>, // 12 doors
  raid: { miss: 1, blocked: 2, hit: 6 },

  // landmark stage cost = S·lmBase·(1 + lmStep·index)·lmStage[stage-1]·(1 + lmCity·city)
  lmBase: 8,
  lmStep: 0.2,
  lmStage: [1, 1.5, 2.2, 3.2],
  lmCity: 0.08,
  repair: 0.5, // × cost of the landmark's last built stage
  lmPack: (stage: number, city: number): PackTier | null =>
    stage === 2 || stage === 4 ? tier((stage === 4 ? 2 : 1) + Math.floor(city / 3)) : null,
  cityReward: (city: number): Reward => ({ dice: 40 + 10 * Math.min(city, 6), coins: 20, packs: [5] }),

  setReward: (groupTier: number): Reward => ({ coins: 2 + groupTier, dice: 4 }),
  hotelsReward: (groupTier: number): Reward => ({
    coins: 10 + 3 * groupTier,
    dice: 10,
    packs: [tier(1 + Math.floor(groupTier / 2))],
  }),
  stickerSetCoins: 5, // × (set index + 1)
  stickerWeights: [0, 50, 25, 13, 8, 4], // draw weight by star count

  gift: { dice: 10, coins: 3, packChance: 0.35 },

  attackChance: 0.04, // inbound rival attack per roll
  attackHeistLoss: [0.05, 0.12],
  attackHeistCap: 25, // × S
  rivalBuildChance: 0.25, // per roll, one rival progresses
  rivalShieldChance: 0.02, // per roll, one rival gains a shield
};

const tier = (n: number) => Math.max(1, Math.min(5, n)) as PackTier;

/** Round to 3 significant digits so amounts read nicely (1,447 -> 1,450). */
export function nice(x: number): number {
  if (x < 100) return Math.round(x);
  const p = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Math.round(x / p) * p;
}

/** The city coin unit S, ≈ ×1.6 per city: 1,000 → 1,600 → 2,560 … */
export const scale = (city: number) => nice(ECON.scaleBase * ECON.scaleGrowth ** city);

export const rent = (city: number, tileTier: number, level: number) =>
  nice(scale(city) * ECON.rentBase * (1 + ECON.rentTier * (tileTier - 1)) * ECON.rentLevel[level]);

export const stageCost = (city: number, index: number, stage: number) =>
  nice(scale(city) * ECON.lmBase * (1 + ECON.lmStep * index) * ECON.lmStage[stage - 1] * (1 + ECON.lmCity * city));
