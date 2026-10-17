// Central plaza: 5 landmark plots that grow through build stages, get damaged and swap per city.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { easeInCubic, easeOutBack, easeOutElastic, lerp } from './anim';
import { fitScale, type Model } from './assets';
import { LANDMARK_FOOT, LANDMARK_MAX_H, PLAZA_TOP, PLOTS, PLOT_SIZE } from './layout';

type Tw = { run: (d: number, f: (k: number) => void) => Promise<void> };

export const STAGE_SCALE = [0, 0.42, 0.65, 0.85, 1];
export interface LandmarkModel { model: Model; scale?: number }

// ------------------------------------------------------------------ shared resources
/** mowed-lawn plot with a dashed "build here" outline */
function lawnTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#4fbf45';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    c.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,60,0,0.06)';
    c.fillRect((i * S) / 8, 0, S / 8, S);
  }
  const g = c.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.7);
  g.addColorStop(0, 'rgba(255,255,200,0.12)');
  g.addColorStop(1, 'rgba(0,40,0,0.18)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 12;
  c.setLineDash([34, 22]);
  c.lineCap = 'round';
  c.beginPath();
  c.roundRect(48, 48, S - 96, S - 96, 36);
  c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared() {
  const holo = new THREE.MeshStandardMaterial({
    color: '#7cc4ff', emissive: '#2f8bff', emissiveIntensity: 0.9, transparent: true, opacity: 0.5,
    roughness: 0.2, depthWrite: false,
  });
  const beam = new THREE.MeshStandardMaterial({ color: '#ffb12e', roughness: 0.35, metalness: 0.3 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#fbf7ef', roughness: 0.28 });
  const trimGold = new THREE.MeshStandardMaterial({ color: '#ffc63d', metalness: 1, roughness: 0.25 });
  const pad = new THREE.MeshStandardMaterial({ map: lawnTexture(), roughness: 0.75 });
  const padEdge = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.4 });
  const padGeo = new RoundedBoxGeometry(PLOT_SIZE, 0.1, PLOT_SIZE, 2, 0.04);
  const rimGeo = (() => {
    const s = PLOT_SIZE + 0.12, h = 0.14, w = 0.12;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new RoundedBoxGeometry(s, h, w, 2, 0.04);
      g.translate(0, h / 2, s / 2 - w / 2);
      g.rotateY((i * Math.PI) / 2);
      parts.push(g);
    }
    return mergeGeometries(parts)!;
  })();
  const footGeo = new RoundedBoxGeometry(2.7, 0.2, 2.7, 3, 0.08);
  const footTrimGeo = new RoundedBoxGeometry(2.78, 0.05, 2.78, 2, 0.025);
  return { holo, beam, concrete, trimGold, pad, padEdge, padGeo, rimGeo, footGeo, footTrimGeo };
}

/** orange scaffold cage sized w×h×w */
function scaffold(w: number, h: number, mat: THREE.Material): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const r = 0.045, hw = w / 2;
  for (const [x, z] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) parts.push(new THREE.CylinderGeometry(r, r, h, 6).translate(x, h / 2, z));
  const levels = Math.max(2, Math.round(h / 0.7));
  for (let l = 1; l <= levels; l++) {
    const y = (h * l) / levels;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.CylinderGeometry(r * 0.8, r * 0.8, w, 6).rotateZ(Math.PI / 2).translate(0, y, hw);
      g.rotateY((i * Math.PI) / 2);
      parts.push(g);
    }
  }
  // diagonal braces on two faces
  for (let i = 0; i < 2; i++) {
    const len = Math.hypot(w, h / levels);
    const g = new THREE.CylinderGeometry(r * 0.6, r * 0.6, len, 5).rotateZ(Math.atan2(w, h / levels)).translate(0, h / levels / 2, hw);
    g.rotateY(i * Math.PI);
    parts.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(parts)!, mat);
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------ procedural landmark fallback
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function fallbackLandmark(key: string, accent = '#ffcc2e'): Model {
  const h = hashStr(key);
  const kind = h % 4;
  const hue = ((h >> 4) % 360) / 360;
  const main = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.65, 0.62), roughness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: '#fff7ea', roughness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.9, roughness: 0.25 });
  const make = () => {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    };
    if (kind === 0) { // tower with spire
      add(new RoundedBoxGeometry(1.6, 0.5, 1.6, 2, 0.08), white, 0.25);
      add(new THREE.CylinderGeometry(0.55, 0.7, 3.2, 16), main, 2.1);
      add(new THREE.CylinderGeometry(0.75, 0.75, 0.25, 16), white, 3.8);
      add(new THREE.ConeGeometry(0.6, 1.6, 16), gold, 4.7);
    } else if (kind === 1) { // domed hall
      add(new RoundedBoxGeometry(2.6, 1.4, 2.0, 2, 0.1), white, 0.7);
      for (const x of [-0.9, -0.3, 0.3, 0.9]) add(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 10), main, 0.7, x, 1.05);
      add(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 20), main, 1.65);
      add(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold, 1.9);
    } else if (kind === 2) { // pagoda stack
      for (let i = 0; i < 4; i++) {
        const s = 2.2 - i * 0.42;
        add(new RoundedBoxGeometry(s * 0.7, 0.6, s * 0.7, 2, 0.06), white, 0.3 + i * 0.85);
        add(new THREE.ConeGeometry(s * 0.75, 0.4, 4).rotateY(Math.PI / 4), main, 0.78 + i * 0.85);
      }
      add(new THREE.ConeGeometry(0.15, 0.8, 8), gold, 4.0);
    } else { // castle
      add(new RoundedBoxGeometry(2.2, 1.6, 1.6, 2, 0.08), white, 0.8);
      for (const [x, z] of [[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8]]) {
        add(new THREE.CylinderGeometry(0.34, 0.38, 2.4, 14), white, 1.2, x, z);
        add(new THREE.ConeGeometry(0.46, 0.9, 14), main, 2.85, x, z);
      }
      add(new RoundedBoxGeometry(0.6, 0.9, 0.1, 2, 0.04), gold, 0.45, 0, 0.82);
    }
    return g;
  };
  const size = new THREE.Box3().setFromObject(make()).getSize(new THREE.Vector3());
  return { size, make };
}

// ------------------------------------------------------------------ one landmark (used by plots and thumbnails)
interface MatRec { mesh: THREE.Mesh; normal: THREE.Material | THREE.Material[]; dark: THREE.Material | THREE.Material[] }

export class LandmarkVisual {
  readonly root = new THREE.Group();      // placed on the pad
  readonly body = new THREE.Group();      // scale/tilt animation
  private model: THREE.Object3D | null = null;
  private mats: MatRec[] = [];
  private scaffoldMesh: THREE.Mesh | null = null;
  private foot: THREE.Mesh;
  fit = 1;
  height = 3;
  stage = 0;
  damaged = false;
  key = '';

  constructor() {
    shared ??= makeShared();
    // glossy white plinth with a gold band
    this.foot = new THREE.Mesh(shared.footGeo, shared.concrete);
    this.foot.position.y = 0.1;
    this.foot.receiveShadow = this.foot.castShadow = true;
    const band = new THREE.Mesh(shared.footTrimGeo, shared.trimGold);
    band.position.y = 0.035;
    this.foot.add(band);
    this.root.add(this.foot, this.body);
  }

  /** scale = manifest scale (raw model → 1×2×1 box); without it the model is fitted by its bounds */
  setModel(key: string, model: Model, scale?: number) {
    this.key = key;
    if (this.model) this.body.remove(this.model);
    if (this.scaffoldMesh) { this.root.remove(this.scaffoldMesh); this.scaffoldMesh.geometry.dispose(); this.scaffoldMesh = null; }
    this.mats.forEach((r) => {
      for (const m of [r.dark].flat()) m.dispose();
    });
    this.mats = [];
    const o = model.make();
    // long models (ships, trains) turn broadside to the camera, slightly 3/4
    if (model.size.z > model.size.x * 1.25) o.rotation.y = Math.PI / 2 - 0.35;
    this.fit = scale ? scale * LANDMARK_FOOT : fitScale(model.size, LANDMARK_FOOT, LANDMARK_MAX_H);
    this.height = model.size.y * this.fit;
    o.scale.setScalar(this.fit);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const darken = (src: THREE.Material) => {
        const d = src.clone() as THREE.MeshStandardMaterial;
        if (d.color) d.color.multiplyScalar(0.38);
        d.roughness = 0.9;
        return d;
      };
      const normal = m.material;
      this.mats.push({ mesh: m, normal, dark: Array.isArray(normal) ? normal.map(darken) : darken(normal) });
    });
    this.model = o;
    this.body.add(o);
    this.scaffoldMesh = scaffold(LANDMARK_FOOT * 0.78, Math.max(1.2, this.height * STAGE_SCALE[1] * 1.1), shared!.beam);
    this.root.add(this.scaffoldMesh);
    this.apply(this.stage, this.damaged);
  }

  /** set the static look of a stage (no animation); k scales the body for animations */
  apply(stage: number, damaged: boolean) {
    this.stage = stage;
    this.damaged = damaged;
    const s = STAGE_SCALE[Math.max(0, Math.min(4, stage))];
    this.body.visible = stage > 0;
    this.body.scale.setScalar(s || 0.001);
    this.foot.visible = stage > 0;
    if (this.scaffoldMesh) this.scaffoldMesh.visible = stage === 1;
    const holo = stage === 1;
    for (const r of this.mats) {
      r.mesh.material = holo ? shared!.holo : damaged ? r.dark : r.normal;
      r.mesh.castShadow = !holo;
    }
    this.body.rotation.set(damaged ? -0.07 : 0, 0, damaged ? 0.16 : 0);
    this.body.position.y = 0.2 + (damaged ? -0.05 : 0);
  }

  scaleFor(stage: number) {
    return STAGE_SCALE[Math.max(0, Math.min(4, stage))] || 0.001;
  }
}

// ------------------------------------------------------------------ plots
interface Plot {
  vis: LandmarkVisual;
  marker: THREE.Sprite;
  pad: THREE.Group;
  smokeT: number;
}

/** lawn material of an empty plot (thumbnails reuse it) */
export function lawnMaterial() {
  shared ??= makeShared();
  return shared.pad;
}

export class City {
  readonly group = new THREE.Group();
  readonly plots: Plot[] = [];
  private t = 0;
  onSmoke: (x: number, y: number, z: number) => void = () => {};

  constructor(markerTex: THREE.Texture | null) {
    shared ??= makeShared();
    const markerMat = new THREE.SpriteMaterial({ map: markerTex, color: markerTex ? '#ffffff' : '#ffcc2e', depthWrite: false });
    PLOTS.forEach((p) => {
      const pad = new THREE.Group();
      pad.position.set(p.x, PLAZA_TOP, p.z);
      const base = new THREE.Mesh(shared!.padGeo, shared!.pad);
      base.position.y = 0.05;
      base.receiveShadow = true;
      const rim = new THREE.Mesh(shared!.rimGeo, shared!.padEdge);
      rim.receiveShadow = rim.castShadow = true;
      pad.add(base, rim);
      const vis = new LandmarkVisual();
      vis.root.position.y = 0.1;
      pad.add(vis.root);
      const marker = new THREE.Sprite(markerMat.clone());
      marker.scale.setScalar(1.7);
      marker.position.y = 1.5;
      pad.add(marker);
      this.group.add(pad);
      this.plots.push({ vis, marker, pad, smokeT: 0 });
    });
  }

  worldTop(i: number, out: THREE.Vector3) {
    const p = this.plots[i];
    const h = p.vis.stage > 0 ? p.vis.height * p.vis.scaleFor(p.vis.stage) : 1.2;
    return out.set(p.pad.position.x, PLAZA_TOP + 0.3 + h * 0.55, p.pad.position.z);
  }

  setModel(i: number, key: string, model: Model, scale?: number) {
    this.plots[i].vis.setModel(key, model, scale);
  }

  set(i: number, stage: number, damaged: boolean) {
    const p = this.plots[i];
    p.vis.apply(stage, damaged);
    p.marker.visible = stage === 0;
  }

  async animate(i: number, stage: number, damaged: boolean, tw: Tw, fx: {
    dust: (x: number, y: number, z: number, n?: number, c?: string) => void;
    sparkle: (x: number, y: number, z: number, n?: number, c?: string, speed?: number, size?: number) => void;
    burst: (x: number, y: number, z: number) => void;
    boom: (x: number, y: number, z: number) => void;
  }): Promise<void> {
    const p = this.plots[i];
    const v = p.vis;
    const x = p.pad.position.x, z = p.pad.position.z;
    const prevStage = v.stage, prevDamaged = v.damaged;
    const from = v.body.visible ? v.body.scale.x : 0.001;
    const to = v.scaleFor(stage);
    v.apply(stage, damaged);
    p.marker.visible = stage === 0;

    if (damaged && !prevDamaged && stage === prevStage) {
      // hit: shake + tilt in, dark smoke
      fx.boom(x, PLAZA_TOP + v.height * to * 0.5, z);
      v.body.scale.setScalar(to);
      await tw.run(0.7, (k) => {
        const s = Math.sin(k * 40) * (1 - k) * 0.12;
        v.body.rotation.set(-0.07 * easeOutBack(k), s, 0.16 * easeOutBack(k));
      });
      return;
    }
    if (stage === 0) {
      v.body.visible = from > 0.01;
      await tw.run(0.3, (k) => {
        v.body.scale.setScalar(Math.max(0.001, from * (1 - easeInCubic(k))));
        if (k >= 1) v.apply(0, damaged);
      });
      return;
    }

    // build / repair bounce: squash, then elastic grow to the new stage size
    fx.dust(x, PLAZA_TOP + 0.2, z, 22);
    if (!damaged && prevDamaged) fx.sparkle(x, PLAZA_TOP + v.height * to * 0.6, z, 24, '#bff7ff', 4, 0.45);
    v.body.visible = true;
    await tw.run(0.85, (k) => {
      if (k < 0.18) {
        const u = k / 0.18;
        const s = lerp(from, from * 0.9, u);
        v.body.scale.set(s * (1 + 0.12 * u), s * (1 - 0.25 * u), s * (1 + 0.12 * u));
      } else {
        const u = (k - 0.18) / 0.82;
        const e = easeOutElastic(u);
        const s = lerp(from * 0.9, to, e);
        const st = 1 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 2.2)) * (1 - u);
        v.body.scale.set(s / Math.sqrt(st), s * st, s / Math.sqrt(st));
      }
    });
    v.body.scale.setScalar(to);
    fx.sparkle(x, PLAZA_TOP + v.height * to * 0.7, z, stage === 4 ? 60 : 22, stage === 4 ? '#ffd84a' : '#ffffff', stage === 4 ? 6 : 4);
    if (stage === 4) fx.burst(x, PLAZA_TOP + v.height * 0.5, z);
  }

  update(dt: number) {
    this.t += dt;
    for (let i = 0; i < this.plots.length; i++) {
      const p = this.plots[i];
      if (p.marker.visible) {
        p.marker.position.y = 1.5 + Math.sin(this.t * 2.4 + i) * 0.2;
        p.marker.material.rotation = Math.sin(this.t * 1.7 + i) * 0.12;
      }
      if (p.vis.damaged && p.vis.stage > 0) {
        p.smokeT -= dt;
        if (p.smokeT <= 0) {
          p.smokeT = 0.13;
          const h = p.vis.height * p.vis.scaleFor(p.vis.stage);
          this.onSmoke(p.pad.position.x, PLAZA_TOP + h * 0.7, p.pad.position.z);
        }
      }
    }
  }
}
