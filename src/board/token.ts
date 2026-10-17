// Player token: hops tile to tile with squash & stretch, faces its travel direction.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { angleDelta, clamp01, easeInCubic, easeOutCubic, easeOutElastic, lerp } from './anim';
import { fitScale, type Model } from './assets';
import { TILES, TILE_TOP, tokenSpot, yawOf } from './layout';

export const TOKEN_LEN = 1.85;

function fallbackCar(): THREE.Object3D {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: '#ff3d4f', roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#bfe6ff', roughness: 0.05, metalness: 0, clearcoat: 1, transmission: 0 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#23252e', roughness: 0.6 });
  const rim = new THREE.MeshPhysicalMaterial({ color: '#ffd84a', metalness: 1, roughness: 0.25 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.36, 1.5, 4, 0.14), paint);
  body.position.y = 0.36;
  const cab = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.34, 0.76, 4, 0.14), glass);
  cab.position.set(0, 0.68, -0.08);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.08, 0.66, 2, 0.04), paint);
  roof.position.set(0, 0.86, -0.08);
  g.add(body, cab, roof);
  const wg = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 18).rotateZ(Math.PI / 2);
  const rg = new THREE.CylinderGeometry(0.1, 0.1, 0.17, 12).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.44, 0.48], [0.44, 0.48], [-0.44, -0.48], [0.44, -0.48]]) {
    const w = new THREE.Mesh(wg, tyre);
    w.position.set(x, 0.2, z);
    const r = new THREE.Mesh(rg, rim);
    r.position.copy(w.position);
    g.add(w, r);
  }
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff7c2', emissive: '#fff2a0', emissiveIntensity: 1.5 });
  for (const x of [-0.28, 0.28]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lamp);
    l.position.set(x, 0.4, 0.75);
    g.add(l);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

/** car models often face ±x; the longest horizontal axis is treated as forward */
const MODEL_FORWARD_FLIP = 0; // radians; tweak if a model faces backwards

export class Token {
  readonly root = new THREE.Group();   // position + yaw
  private squash = new THREE.Group();  // scale (pivot at the wheels)
  private yaw = 0;
  private yawGoal = 0;
  tile = 0;
  busy = 0;
  private idleT = 0;
  onHop: (tile: number, fast: boolean) => void = () => {};
  onLand: (pos: THREE.Vector3, hard: boolean) => void = () => {};

  private halo: THREE.Mesh;
  private t = 0;

  constructor(model: Model | null) {
    let obj: THREE.Object3D;
    if (model) {
      obj = model.make();
      const s = model.size;
      const alongX = s.x > s.z;
      obj.scale.setScalar(fitScale(s, TOKEN_LEN, 1.2));
      obj.rotation.y = (alongX ? -Math.PI / 2 : 0) + MODEL_FORWARD_FLIP;
      if (model.material instanceof THREE.MeshPhysicalMaterial) {
        model.material.clearcoat = 1;
        model.material.clearcoatRoughness = 0.06;
        model.material.roughness = Math.min(model.material.roughness, 0.35);
      }
    } else obj = fallbackCar();
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.squash.add(obj);
    this.root.add(this.squash);
    // glowing "you are here" ring under the car, stays on the tile while the car hops
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 20, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.15)');
    g.addColorStop(0.8, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 2.3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: new THREE.Color('#ffd84a').multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.halo.renderOrder = 3;
    this.root.add(this.halo);
    this.place(0);
  }

  private restYaw(tile: number) {
    const t = TILES[tile];
    return yawOf(t.dirX, t.dirZ);
  }

  place(tile: number) {
    this.tile = tile;
    const p = tokenSpot(tile);
    this.root.position.set(p.x, TILE_TOP, p.z);
    this.yaw = this.yawGoal = this.restYaw(tile);
    this.root.rotation.y = this.yaw;
    this.squash.scale.set(1, 1, 1);
  }

  async move(path: number[], fast: boolean, tw: { run: (d: number, f: (k: number) => void) => Promise<void> }) {
    if (!path.length) return;
    this.busy++;
    const hopT = fast ? 0.09 : 0.18;
    const H = fast ? 0.42 : 0.62;
    for (let i = 0; i < path.length; i++) {
      const to = ((path[i] % 40) + 40) % 40;
      const ax = this.root.position.x, az = this.root.position.z;
      const b = tokenSpot(to);
      const dx = b.x - ax, dz = b.z - az;
      this.yawGoal = Math.abs(dx) + Math.abs(dz) > 1e-3 ? yawOf(dx, dz) : this.yawGoal;
      const y0 = this.yaw;
      const dy = angleDelta(y0, this.yawGoal);
      this.onHop(to, fast);
      await tw.run(hopT, (k) => {
        // 0..0.2 ground squash (landing of the previous hop / take-off), then airborne
        if (k < 0.2) {
          const u = k / 0.2;
          const sy = 1 - 0.24 * Math.sin(Math.PI * u);
          this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
          this.yaw = y0 + dy * easeOutCubic(u);
        } else {
          const u = (k - 0.2) / 0.8;
          this.yaw = y0 + dy;
          this.root.position.x = lerp(ax, b.x, u);
          this.root.position.z = lerp(az, b.z, u);
          this.root.position.y = TILE_TOP + 4 * H * u * (1 - u);
          const sy = 1 + 0.2 * Math.sin(Math.PI * u);
          this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        }
        this.root.rotation.y = this.yaw;
      });
      this.tile = to;
    }
    // final landing: squash then elastic recovery, settle to the side's rest yaw
    const y0 = this.yaw;
    const dy = angleDelta(y0, this.restYaw(this.tile));
    this.onLand(this.root.position, false);
    await tw.run(0.32, (k) => {
      const sy = 1 - 0.26 * (1 - easeOutElastic(k));
      this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      this.yaw = y0 + dy * easeOutCubic(clamp01(k * 1.6));
      this.root.rotation.y = this.yaw;
    });
    this.squash.scale.set(1, 1, 1);
    this.busy--;
  }

  /** up / whoosh / drop teleport (jail) */
  async jump(tile: number, tw: { run: (d: number, f: (k: number) => void) => Promise<void> }, onWhoosh: () => void) {
    this.busy++;
    const ax = this.root.position.x, az = this.root.position.z;
    const b = tokenSpot(tile);
    const top = 7;
    const y0 = this.yaw;
    await tw.run(0.14, (k) => {
      const sy = 1 - 0.3 * Math.sin((Math.PI / 2) * k);
      this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    });
    onWhoosh();
    await tw.run(0.34, (k) => {
      const e = easeOutCubic(k);
      this.root.position.y = TILE_TOP + top * e;
      const sy = 1.35 - 0.35 * k;
      this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      this.yaw = y0 + e * Math.PI * 2;
      this.root.rotation.y = this.yaw;
    });
    await tw.run(0.32, (k) => {
      const e = easeOutCubic(k);
      this.root.position.x = lerp(ax, b.x, e);
      this.root.position.z = lerp(az, b.z, e);
      this.root.position.y = TILE_TOP + top + Math.sin(Math.PI * k) * 0.8;
    });
    const ry = this.restYaw(tile);
    const y1 = this.yaw;
    const dy = angleDelta(y1, ry + Math.PI * 2);
    await tw.run(0.26, (k) => {
      const e = easeInCubic(k);
      this.root.position.y = TILE_TOP + top * (1 - e);
      const sy = 1 + 0.3 * e;
      this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      this.yaw = y1 + dy * k;
      this.root.rotation.y = this.yaw;
    });
    this.tile = tile;
    this.root.position.set(b.x, TILE_TOP, b.z);
    this.onLand(this.root.position, true);
    await tw.run(0.36, (k) => {
      const sy = 1 - 0.38 * (1 - easeOutElastic(k));
      this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    });
    this.place(tile);
    this.busy--;
  }

  update(dt: number) {
    // halo hugs the tile surface whatever the car does
    this.t += dt;
    this.halo.position.y = TILE_TOP + 0.02 - this.root.position.y;
    this.halo.rotation.y = -this.root.rotation.y;
    const air = Math.min(1, (this.root.position.y - TILE_TOP) / 2);
    this.halo.scale.setScalar(1 + 0.06 * Math.sin(this.t * 3) - air * 0.3);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.75 - air * 0.5;
    if (this.busy) return;
    this.idleT += dt;
    const sy = 1 + 0.018 * Math.sin(this.idleT * 3.2);
    this.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  }
}
