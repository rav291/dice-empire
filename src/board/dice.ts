// Two glossy rounded dice with inset pips (one atlas texture + bump map) and a scripted tumble
// that always settles on the requested faces.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp01, easeOutCubic, lerp } from './anim';
import { DICE_SPOTS, PLAZA_TOP } from './layout';

export const DIE = 1.15;
const RADIUS = 0.2;
// BoxGeometry group order: +x, −x, +y, −y, +z, −z
const FACE_VALUE = [2, 5, 1, 6, 3, 4];
const NORMAL: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(1, 0, 0), 5: new THREE.Vector3(-1, 0, 0),
  3: new THREE.Vector3(0, 0, 1), 4: new THREE.Vector3(0, 0, -1),
};
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
const UP = new THREE.Vector3(0, 1, 0);

/** orientation that shows `value` on top, with a yaw about the vertical */
export function faceUpQuat(value: number, yaw: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(NORMAL[value], UP);
  return out.setFromAxisAngle(UP, yaw).multiply(q);
}

/** which value is on top for a given orientation (for tests) */
export function topValue(q: THREE.Quaternion): number {
  let best = 1, bestY = -2;
  const v = new THREE.Vector3();
  for (const k of [1, 2, 3, 4, 5, 6]) {
    v.copy(NORMAL[k]).applyQuaternion(q);
    if (v.y > bestY) { bestY = v.y; best = k; }
  }
  return best;
}

function drawAtlas(): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512;
  const mk = () => { const c = document.createElement('canvas'); c.width = S * 3; c.height = S * 2; return c; };
  const cc = mk(), bc = mk();
  const c = cc.getContext('2d')!, b = bc.getContext('2d')!;
  b.fillStyle = '#fff';
  b.fillRect(0, 0, S * 3, S * 2);
  for (let f = 0; f < 6; f++) {
    const v = FACE_VALUE[f];
    const ox = (f % 3) * S, oy = Math.floor(f / 3) * S;
    // ivory face with a soft centre glow
    const g = c.createRadialGradient(ox + S / 2, oy + S / 2, S * 0.1, ox + S / 2, oy + S / 2, S * 0.72);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#f1ece4');
    c.fillStyle = g;
    c.fillRect(ox, oy, S, S);
    const one = v === 1;
    const pr = one ? S * 0.135 : S * 0.085;
    for (const [px, py] of PIPS[v]) {
      const x = ox + S / 2 + px * S * 0.235, y = oy + S / 2 + py * S * 0.235;
      // inset pip: dark rim at the top-left, lit floor at the bottom-right
      const pg = c.createRadialGradient(x + pr * 0.25, y + pr * 0.3, pr * 0.1, x, y, pr);
      if (one) { pg.addColorStop(0, '#ff5a52'); pg.addColorStop(0.75, '#d81f26'); pg.addColorStop(1, '#7a0c12'); }
      else { pg.addColorStop(0, '#3a4a7a'); pg.addColorStop(0.75, '#1a2348'); pg.addColorStop(1, '#070b1c'); }
      c.fillStyle = pg;
      c.beginPath(); c.arc(x, y, pr, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = S * 0.008;
      c.beginPath(); c.arc(x, y, pr * 1.02, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      // bump: depressed bowl
      const bg = b.createRadialGradient(x, y, 0, x, y, pr * 1.08);
      bg.addColorStop(0, '#000');
      bg.addColorStop(0.7, '#202020');
      bg.addColorStop(1, '#fff');
      b.fillStyle = bg;
      b.beginPath(); b.arc(x, y, pr * 1.08, 0, Math.PI * 2); b.fill();
    }
  }
  const color = new THREE.CanvasTexture(cc);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = 8;
  const bump = new THREE.CanvasTexture(bc);
  return { color, bump };
}

function dieGeometry(): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(DIE, DIE, DIE, 5, RADIUS);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  g.groups.forEach((gr, f) => {
    const cx = f % 3, cy = Math.floor(f / 3);
    for (let i = gr.start; i < gr.start + gr.count; i++) {
      uv.setXY(i, (cx + uv.getX(i)) / 3, 1 - (cy + 1 - uv.getY(i)) / 2);
    }
  });
  g.clearGroups();
  return g;
}

interface Roll {
  t: number;
  dur: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  qEnd: THREE.Quaternion;
  a1: THREE.Vector3;
  a2: THREE.Vector3;
  ang1: number;
  ang2: number;
  h0: number;
  bounced: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

// bounce schedule as fractions of the roll: [start, end, peak height]
const HOPS: [number, number, number][] = [[0, 0.4, 0], [0.4, 0.64, 0.95], [0.64, 0.8, 0.36], [0.8, 0.9, 0.1]];

export class Dice {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  private rolls: (Roll | null)[] = [null, null];
  private done: (() => void) | null = null;
  onBounce: (die: number, strength: number, pos: THREE.Vector3) => void = () => {};

  constructor() {
    const { color, bump } = drawAtlas();
    const mat = new THREE.MeshPhysicalMaterial({
      map: color, bumpMap: bump, bumpScale: 1.4, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06,
      sheen: 0.2, sheenColor: new THREE.Color('#ffffff'),
    });
    const geo = dieGeometry();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.meshes.push(m);
      this.rest(i, i === 0 ? 5 : 6);
    }
  }

  private ground(q: THREE.Quaternion): number {
    _m.makeRotationFromQuaternion(q);
    const e = _m.elements;
    const half = DIE / 2 - RADIUS;
    return PLAZA_TOP + half * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9])) + RADIUS;
  }

  rest(i: number, value: number) {
    const m = this.meshes[i];
    faceUpQuat(value, (i ? 0.25 : -0.2), m.quaternion);
    m.position.set(DICE_SPOTS[i].x, this.ground(m.quaternion), DICE_SPOTS[i].z);
  }

  roll(d1: number, d2: number, dur = 1.25): Promise<void> {
    this.done?.();
    return new Promise((resolve) => {
      this.done = resolve;
      [d1, d2].forEach((v, i) => {
        const end = new THREE.Vector3(DICE_SPOTS[i].x + (Math.random() - 0.5) * 0.5, 0, DICE_SPOTS[i].z + (Math.random() - 0.5) * 0.4);
        const start = new THREE.Vector3(end.x * 1.6 + (Math.random() - 0.5) * 1.2, 0, end.z + 6.5 + Math.random());
        const travel = new THREE.Vector3().subVectors(end, start).normalize();
        const a1 = new THREE.Vector3().crossVectors(UP, travel).normalize(); // roll forward
        const a2 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        this.rolls[i] = {
          t: -i * 0.05, dur, start, end,
          qEnd: faceUpQuat(v, (Math.random() - 0.5) * 0.7),
          a1, a2,
          ang1: -(Math.PI * 2) * (2.2 + Math.random() * 0.8),
          ang2: Math.PI * (0.8 + Math.random()),
          h0: 3.4 + Math.random() * 0.6,
          bounced: 0,
        };
        this.meshes[i].visible = true;
      });
    });
  }

  get rolling() { return this.rolls.some((r) => r); }

  update(dt: number) {
    let active = false;
    for (let i = 0; i < 2; i++) {
      const r = this.rolls[i];
      if (!r) continue;
      r.t += dt;
      const m = this.meshes[i];
      const k = clamp01(r.t / r.dur);
      // orientation: random spin unwinding into the end pose
      const e = easeOutCubic(clamp01(k / 0.92));
      _q.setFromAxisAngle(r.a1, r.ang1 * (1 - e));
      _q2.setFromAxisAngle(r.a2, r.ang2 * (1 - e) * (1 - e));
      // world-space spin (premultiplied) so a1 really is the forward-rolling axis
      m.quaternion.copy(_q).multiply(_q2).multiply(r.qEnd);
      // horizontal glide
      const h = easeOutCubic(clamp01(k / 0.95));
      m.position.x = lerp(r.start.x, r.end.x, h);
      m.position.z = lerp(r.start.z, r.end.z, h);
      // vertical: throw arc then shrinking bounces
      let y = 0;
      for (let b = 0; b < HOPS.length; b++) {
        const [s, en, peak] = HOPS[b];
        if (k >= s && k < en) {
          const u = (k - s) / (en - s);
          y = b === 0 ? r.h0 * (1 - u * u) + 0.8 * Math.sin(Math.PI * u) * (1 - u) : 4 * peak * u * (1 - u);
          if (r.bounced < b) {
            r.bounced = b;
            this.onBounce(i, peak, m.position);
          }
        }
      }
      if (k >= HOPS[HOPS.length - 1][1] && r.bounced < HOPS.length) {
        r.bounced = HOPS.length;
        this.onBounce(i, 0.05, m.position);
      }
      m.position.y = this.ground(m.quaternion) + y;
      if (k >= 1) {
        m.quaternion.copy(r.qEnd);
        m.position.y = this.ground(m.quaternion);
        this.rolls[i] = null;
      } else active = true;
    }
    if (!active && this.done) {
      const d = this.done;
      this.done = null;
      d();
    }
  }
}
