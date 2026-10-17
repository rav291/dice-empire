// Property buildings on each tile's inner colour band: 1 = owner flag, 2–4 = 1–3 houses, 5 = hotel.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ColorGroup } from '../contract';
import { BOARD as DEFS, GROUP_COLORS } from '../shared/board-data';
import { easeInCubic, easeOutCubic, easeOutElastic } from './anim';
import type { Model } from './assets';
import { BAND, TILE_TOP, bandSpot } from './layout';

/** centred slots along the band for n houses */
const houseX = (i: number, n: number) => (i - (Math.max(n, 1) - 1) / 2) * 0.63;

type Tw = { run: (d: number, f: (k: number) => void) => Promise<void> };

interface Slot { obj: THREE.Object3D; base: number; shown: boolean }
interface Lot {
  tile: number;
  group: ColorGroup;
  root: THREE.Group;
  flag: Slot;
  cloth: THREE.Mesh;
  houses: Slot[];
  hotel: Slot;
  level: number;
}

function fallbackHouse(color: string): Model {
  const wall = new THREE.MeshStandardMaterial({ color: '#fff6e6', roughness: 0.45 });
  const roof = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const make = () => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 0.5, 2, 0.05).translate(0, 0.21, 0), wall);
    const r = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.34, 4, 1).rotateY(Math.PI / 4).translate(0, 0.59, 0), roof);
    [b, r].forEach((m) => { m.castShadow = m.receiveShadow = true; g.add(m); });
    return g;
  };
  return { size: new THREE.Vector3(0.62, 0.76, 0.62), make };
}

function fallbackHotel(color: string): Model {
  const wall = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: '#fff6e6', roughness: 0.45 });
  const make = () => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.8, 0.62, 2, 0.06).translate(0, 0.4, 0), wall);
    const t = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.12, 0.7, 2, 0.04).translate(0, 0.86, 0), trim);
    const s = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.4, 2, 0.05).translate(0, 1.06, 0), trim);
    [b, t, s].forEach((m) => { m.castShadow = m.receiveShadow = true; g.add(m); });
    return g;
  };
  return { size: new THREE.Vector3(1.5, 1.2, 0.7), make };
}

/** tint a baked material toward a group colour (cached per group) */
function tinted(model: Model, group: ColorGroup, amt: number, cache: Map<string, THREE.Material>): THREE.Object3D {
  const o = model.make();
  if (!model.material) return o;
  const key = `${model.material.uuid}:${group}`;
  let m = cache.get(key);
  if (!m) {
    const c = (model.material as THREE.MeshStandardMaterial).clone();
    const g = new THREE.Color(GROUP_COLORS[group]);
    c.color.set('#ffffff').lerp(g, amt);
    c.emissive.copy(g).multiplyScalar(0.14); // keeps tinted palettes bright and toy-like
    c.roughness = 0.38;
    cache.set(key, (m = c));
  }
  (o as THREE.Mesh).material = m;
  return o;
}

export class Buildings {
  readonly group = new THREE.Group();
  private lots = new Map<number, Lot>();
  private lotList: Lot[] = [];
  private t = 0;

  constructor(house: Model | null, hotel: Model | null) {
    const cache = new Map<string, THREE.Material>();
    const poleMat = new THREE.MeshStandardMaterial({ color: '#f4f4f8', metalness: 0.6, roughness: 0.25 });
    const ballMat = new THREE.MeshStandardMaterial({ color: '#ffcc2e', metalness: 1, roughness: 0.2 });
    const poleGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.8, 8).translate(0, 0.4, 0);
    const ballGeo = new THREE.SphereGeometry(0.055, 12, 8).translate(0, 0.82, 0);
    const baseGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.06, 16).translate(0, 0.03, 0);
    const clothGeo = new RoundedBoxGeometry(0.42, 0.26, 0.025, 1, 0.012).translate(0.21, 0, 0);
    const clothMats = new Map<ColorGroup, THREE.Material>();

    for (const def of DEFS) {
      if (def.kind !== 'property' || !def.group) continue;
      const g = def.group;
      const spot = bandSpot(def.index);
      const root = new THREE.Group();
      root.position.set(spot.x, TILE_TOP, spot.z);
      root.rotation.y = spot.outYaw;
      this.group.add(root);

      // owner flag
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      const ball = new THREE.Mesh(ballGeo, ballMat);
      const base = new THREE.Mesh(baseGeo, poleMat);
      let cm = clothMats.get(g);
      if (!cm) clothMats.set(g, (cm = new THREE.MeshStandardMaterial({ color: GROUP_COLORS[g], roughness: 0.35, side: THREE.DoubleSide })));
      const cloth = new THREE.Mesh(clothGeo, cm);
      cloth.position.set(0.02, 0.64, 0);
      [pole, ball, base, cloth].forEach((m) => { m.castShadow = true; flag.add(m); });
      flag.visible = false;
      flag.scale.setScalar(1.1);
      root.add(flag);

      const hm = house ?? fallbackHouse(GROUP_COLORS[g]);
      const houses: Slot[] = [];
      // narrow side along the band so three chunky houses fit a tile
      const turn = hm.size.x > hm.size.z;
      const along = turn ? hm.size.z : hm.size.x, deep = turn ? hm.size.x : hm.size.z;
      const hs = Math.min(0.62 / along, (BAND + 0.1) / deep, 0.9 / hm.size.y);
      for (let i = 0; i < 3; i++) {
        const inner = house ? tinted(hm, g, 0.3, cache) : hm.make();
        if (turn) inner.rotation.y = Math.PI / 2;
        const o = new THREE.Group();
        o.add(inner);
        o.scale.setScalar(0);
        o.visible = false;
        root.add(o);
        houses.push({ obj: o, base: hs, shown: false });
      }
      const tm = hotel ?? fallbackHotel(GROUP_COLORS[g]);
      const ts = Math.min(1.75 / tm.size.x, (BAND + 0.25) / tm.size.z, 1.7 / tm.size.y);
      const ho = hotel ? tinted(tm, g, 0.42, cache) : tm.make();
      ho.scale.setScalar(0);
      ho.visible = false;
      root.add(ho);
      this.lots.set(def.index, {
        tile: def.index, group: g, root, cloth, level: 0,
        flag: { obj: flag, base: 1.1, shown: false }, houses, hotel: { obj: ho, base: ts, shown: false },
      });
      this.lotList.push(this.lots.get(def.index)!);
    }
  }

  /** world position of a tile's band (for fx) */
  bandWorld(tile: number, out: THREE.Vector3) {
    const l = this.lots.get(tile);
    if (l) out.set(l.root.position.x, TILE_TOP + 0.2, l.root.position.z);
    return out;
  }

  private wanted(level: number) {
    return {
      flag: level === 1,
      houses: level >= 2 && level <= 4 ? level - 1 : 0,
      hotel: level >= 5,
    };
  }

  set(tile: number, level: number) {
    const l = this.lots.get(tile);
    if (!l) return;
    l.level = level;
    const w = this.wanted(level);
    const put = (s: Slot, on: boolean) => {
      s.shown = on;
      s.obj.visible = on;
      s.obj.scale.setScalar(on ? s.base : 0);
    };
    put(l.flag, w.flag);
    l.houses.forEach((h, i) => { put(h, i < w.houses); h.obj.position.x = houseX(i, w.houses); });
    put(l.hotel, w.hotel);
  }

  async animate(tile: number, level: number, tw: Tw, fx: (x: number, z: number, big: boolean) => void): Promise<void> {
    const l = this.lots.get(tile);
    if (!l) return;
    l.level = level;
    const w = this.wanted(level);
    const jobs: Promise<void>[] = [];
    const hide = (s: Slot) => {
      if (!s.shown) return;
      s.shown = false;
      const from = s.obj.scale.x;
      jobs.push(tw.run(0.2, (k) => {
        s.obj.scale.setScalar(from * (1 - easeInCubic(k)));
        if (k >= 1) s.obj.visible = false;
      }));
    };
    let delay = 0;
    const show = (s: Slot) => {
      if (s.shown) return;
      s.shown = true;
      const d = delay;
      delay += 0.09;
      jobs.push(tw.run(d + 0.6, (k) => {
        const u = Math.max(0, (k * (d + 0.6) - d) / 0.6);
        s.obj.visible = u > 0;
        const e = easeOutElastic(u);
        s.obj.scale.set(s.base * e, s.base * (u < 0.15 ? e * 1.5 : e), s.base * e);
      }));
    };
    (w.flag ? show : hide)(l.flag);
    // existing houses slide to make room, new ones pop in at their slot
    l.houses.forEach((h, i) => {
      const x1 = houseX(i, w.houses);
      if (!h.shown) h.obj.position.x = x1;
      else if (i < w.houses) {
        const x0 = h.obj.position.x;
        jobs.push(tw.run(0.28, (k) => { h.obj.position.x = x0 + (x1 - x0) * easeOutCubic(k); }));
      }
      (i < w.houses ? show : hide)(h);
    });
    (w.hotel ? show : hide)(l.hotel);
    fx(l.root.position.x, l.root.position.z, w.hotel);
    await Promise.all(jobs);
  }

  update(dt: number) {
    this.t += dt;
    const lots = this.lotList;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (l.flag.shown) l.cloth.rotation.y = Math.sin(this.t * 3.1 + l.tile) * 0.25;
    }
  }
}
