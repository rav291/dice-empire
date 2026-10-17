// Tiny tween runner driven by the render loop (no per-frame allocations).

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export function easeOutElastic(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}
/** smallest signed angle a→b */
export function angleDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

export class Tweens {
  private list: Tween[] = [];

  /** run step(k) with k going 0→1 over dur seconds; resolves after the final step */
  run(dur: number, step: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.list.push({ t: 0, dur: Math.max(dur, 1e-4), step, done: resolve });
    });
  }

  /** fire-and-forget delay */
  wait(dur: number): Promise<void> {
    return this.run(dur, () => {});
  }

  get active() { return this.list.length > 0; }

  update(dt: number) {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const tw = l[i];
      tw.t += dt;
      const k = tw.t >= tw.dur ? 1 : tw.t / tw.dur;
      tw.step(k);
      if (k >= 1) {
        l[i] = l[l.length - 1];
        l.pop();
        i--;
        tw.done?.();
      }
    }
  }
}
