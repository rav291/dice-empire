// Seeded mulberry32. The generator state lives in the game state (`rng`), so a save
// resumes the exact same sequence.
export interface Rng { rng: number }

export function rand(s: Rng): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** integer in [lo, hi] */
export const randInt = (s: Rng, lo: number, hi: number) => lo + Math.floor(rand(s) * (hi - lo + 1));

export const pick = <T>(s: Rng, xs: readonly T[]): T => xs[Math.floor(rand(s) * xs.length)];

export function weighted<T>(s: Rng, xs: readonly T[], w: (x: T) => number): T {
  let r = rand(s) * xs.reduce((a, x) => a + w(x), 0);
  for (const x of xs) if ((r -= w(x)) < 0) return x;
  return xs[xs.length - 1];
}

export function shuffle<T>(s: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
