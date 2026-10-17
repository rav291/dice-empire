// Camera rig: target + yaw/pitch/distance, fitted to the area left free by the HUD insets.
import * as THREE from 'three';
import { clamp01, easeInOutCubic, easeInOutSine, easeOutCubic, lerp } from './anim';
import { HALF, FRAME, PLOTS } from './layout';

export interface Rig {
  tx: number; ty: number; tz: number; yaw: number; pitch: number; dist: number;
  /** fraction of the free width/height the fitted points cover (fitRig output) */
  fillX?: number; fillY?: number;
}
export interface Insets { top: number; right: number; bottom: number; left: number }

const rig = (): Rig => ({ tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0.9, dist: 40 });
const copyRig = (o: Rig, a: Rig) => { o.tx = a.tx; o.ty = a.ty; o.tz = a.tz; o.yaw = a.yaw; o.pitch = a.pitch; o.dist = a.dist; return o; };
function mixRig(o: Rig, a: Rig, b: Rig, k: number) {
  o.tx = lerp(a.tx, b.tx, k); o.ty = lerp(a.ty, b.ty, k); o.tz = lerp(a.tz, b.tz, k);
  o.yaw = lerp(a.yaw, b.yaw, k); o.pitch = lerp(a.pitch, b.pitch, k); o.dist = lerp(a.dist, b.dist, k);
  return o;
}

const B = HALF + FRAME + 0.3;
/** points that must stay on screen in the board view */
const BOARD_PTS = [
  [-B, 0, -B], [B, 0, -B], [-B, 0, B], [B, 0, B],
  [-B, -1.4, B], [B, -1.4, B], [-B, 1.2, -B], [B, 1.2, -B],
  ...PLOTS.map((p) => [p.x, 5.5, p.z]),
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const CITY_PTS = [
  ...PLOTS.flatMap((p) => [[p.x - 1.9, 0.3, p.z - 1.9], [p.x + 1.9, 0.3, p.z + 1.9], [p.x - 1.9, 0.3, p.z + 1.9], [p.x + 1.9, 0.3, p.z - 1.9], [p.x, 6.2, p.z]]),
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function basis(yaw: number, pitch: number) {
  // forward = from camera toward target
  _f.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  _r.crossVectors(_f, UP).normalize();
  _u.crossVectors(_r, _f).normalize();
}

/**
 * Fit points into a symmetric frustum with half-tangents tanX/tanY for a fixed view direction.
 * Iteratively recentres the target so the projected bounds are centred. Exported for tests.
 */
export function fitRig(points: THREE.Vector3[], yaw: number, pitch: number, tanX: number, tanY: number, out: Rig = rig()): Rig {
  basis(yaw, pitch);
  _t.set(0, 0, 0);
  for (const p of points) _t.add(p);
  _t.divideScalar(points.length);
  let d = 0, fx = 1, fy = 1;
  for (let it = 0; it < 8; it++) {
    d = 0;
    for (const p of points) {
      _v.subVectors(p, _t);
      const x = _v.dot(_r), y = _v.dot(_u), z = _v.dot(_f);
      d = Math.max(d, Math.abs(x) / tanX - z, Math.abs(y) / tanY - z);
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      _v.subVectors(p, _t);
      const z = d + _v.dot(_f);
      const x = _v.dot(_r) / z, y = _v.dot(_u) / z;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    fx = (x1 - x0) / (2 * tanX); fy = (y1 - y0) / (2 * tanY);
    _t.addScaledVector(_r, mx * d).addScaledVector(_u, my * d);
  }
  out.tx = _t.x; out.ty = _t.y; out.tz = _t.z; out.yaw = yaw; out.pitch = pitch; out.dist = d;
  out.fillX = fx; out.fillY = fy;
  return out;
}

export function applyRig(cam: THREE.PerspectiveCamera, r: Rig) {
  const cp = Math.cos(r.pitch);
  cam.position.set(r.tx + Math.sin(r.yaw) * cp * r.dist, r.ty + Math.sin(r.pitch) * r.dist, r.tz + Math.cos(r.yaw) * cp * r.dist);
  cam.lookAt(r.tx, r.ty, r.tz);
}

export class CameraRig {
  readonly cam: THREE.PerspectiveCamera;
  view: 'board' | 'city' = 'board';
  private boardRig = rig();
  private cityRig = rig();
  private cur = rig();
  private from = rig();
  private tmp = rig();
  private tween: { t: number; dur: number; done: () => void } | null = null;
  private intro: { t: number; dur: number; done: () => void } | null = null;
  private introStart = rig();
  private follow = new THREE.Vector3();
  private followS = new THREE.Vector3();
  private followK = 0;
  private followGoal = 0;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private w = 1;
  private h = 1;
  private tanX = 0.3;
  private tanY = 0.3;

  constructor() {
    this.cam = new THREE.PerspectiveCamera(38, 1, 0.5, 1500);
  }

  setInsets(i: Insets) {
    this.insets = { ...i };
    this.refit();
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.refit();
  }

  private refit() {
    const { w, h, insets } = this;
    const fw = Math.max(80, w - insets.left - insets.right);
    const fh = Math.max(80, h - insets.top - insets.bottom);
    this.cam.aspect = w / h;
    this.cam.setViewOffset(w, h, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, w, h);
    this.cam.updateProjectionMatrix();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    const tanY = (tanHalf * fh) / h * 0.95, tanX = (tanHalf * fw) / h * 0.95;
    this.tanX = tanX; this.tanY = tanY;
    const a = clamp01((fw / fh - 0.6) / 1.0);
    fitRig(BOARD_PTS, 0, THREE.MathUtils.degToRad(lerp(62, 50, a)), tanX, tanY, this.boardRig);
    fitRig(CITY_PTS, 0, THREE.MathUtils.degToRad(lerp(46, 36, a)), tanX * 0.93, tanY * 0.93, this.cityRig);
    if (!this.tween && !this.intro) this.snap();
  }

  private goal() {
    return this.view === 'board' ? this.boardRig : this.cityRig;
  }

  snap() {
    copyRig(this.cur, this.goal());
  }

  setView(v: 'board' | 'city', dur = 1.1): Promise<void> {
    this.view = v;
    this.tween?.done();
    copyRig(this.from, this.cur);
    return new Promise((done) => { this.tween = { t: 0, dur, done }; });
  }

  /** token follow (board view only): pans part-way toward the token and zooms in slightly */
  setFollow(on: boolean, x = 0, z = 0) {
    this.followGoal = on ? 1 : 0;
    if (on) {
      this.follow.set(x, 0.3, z);
      if (this.followK < 0.05) this.followS.copy(this.follow);
    }
  }
  updateFollowTarget(x: number, z: number) {
    this.follow.set(x, 0.3, z);
  }

  playIntro(dur = 5): Promise<void> {
    this.intro?.done();
    this.view = 'board';
    const g = this.boardRig;
    copyRig(this.introStart, g);
    this.introStart.yaw = g.yaw - 2.3;
    this.introStart.pitch = THREE.MathUtils.degToRad(76);
    this.introStart.dist = g.dist * 2.1;
    this.introStart.tx = 0; this.introStart.ty = 2; this.introStart.tz = -2;
    return new Promise((done) => {
      this.intro = { t: 0, dur, done };
      this.update(0);
    });
  }

  skipIntro() {
    if (!this.intro) return;
    const d = this.intro.done;
    this.intro = null;
    this.snap();
    applyRig(this.cam, this.cur);
    d();
  }

  get introActive() { return !!this.intro; }

  update(dt: number) {
    const g = this.goal();
    if (this.intro) {
      const it = this.intro;
      it.t += dt;
      const k = clamp01(it.t / it.dur);
      const s = this.introStart, o = this.cur;
      const e = easeInOutSine(k);
      o.yaw = lerp(s.yaw, g.yaw, easeInOutCubic(k));
      o.pitch = lerp(s.pitch, g.pitch, e ** 1.4);
      o.dist = lerp(s.dist, g.dist, easeOutCubic(k) * 0.35 + e * 0.65);
      o.tx = lerp(s.tx, g.tx, e); o.ty = lerp(s.ty, g.ty, e); o.tz = lerp(s.tz, g.tz, e);
      if (k >= 1) { this.intro = null; it.done(); }
    } else if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = clamp01(tw.t / tw.dur);
      mixRig(this.cur, this.from, g, easeInOutCubic(k));
      if (k >= 1) { this.tween = null; tw.done(); }
    } else {
      copyRig(this.cur, g);
    }

    // follow blend
    const target = this.view === 'board' && !this.intro ? this.followGoal : 0;
    this.followK += (target - this.followK) * (1 - Math.exp(-dt * (target > this.followK ? 3.5 : 2)));
    this.followS.lerp(this.follow, 1 - Math.exp(-dt * 4));
    const o = copyRig(this.tmp, this.cur);
    if (this.followK > 1e-3) {
      // pan toward the token, but only inside the slack the fit leaves: the board never clips
      const k = this.followK, b = this.boardRig;
      const maxX = Math.max(0, 1 - (b.fillX ?? 1)) * this.tanX * b.dist;
      const maxZ = (Math.max(0, 1 - (b.fillY ?? 1)) * this.tanY * b.dist) / Math.max(0.3, Math.sin(b.pitch));
      o.tx += THREE.MathUtils.clamp((this.followS.x - o.tx) * 0.5, -maxX, maxX) * k;
      o.tz += THREE.MathUtils.clamp((this.followS.z - o.tz) * 0.5, -maxZ, maxZ) * k;
    }
    applyRig(this.cam, o);
  }
}
