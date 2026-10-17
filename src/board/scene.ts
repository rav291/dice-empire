// World around the board: gradient sky dome, HDRI/room environment, warm sun with soft shadows,
// a floating grass island with cliffs, drifting clouds and scattered decor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { bakeModel, type Model } from './assets';
import type { PBR } from './boardMesh';

export const GROUND_Y = -1.42;
const ISLAND_R = 31;

// ------------------------------------------------------------------ sky
const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFrag = /* glsl */ `
uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(bottom, top, pow(smoothstep(-0.03, 0.42, h), 0.75));
  // below the horizon: a soft bright haze (sea of clouds)
  vec3 haze = mix(bottom, vec3(1.0), 0.45);
  c = mix(c, haze, smoothstep(0.0, -0.35, h));
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 24.0) * 0.6 + pow(s, 4.0) * 0.08);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    top: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(-0.45, 0.6, 0.35).normalize() },
  };
  private fromTop = new THREE.Color();
  private fromBottom = new THREE.Color();
  private toTop = new THREE.Color();
  private toBottom = new THREE.Color();

  constructor(private fog: THREE.Fog) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
    // drawn after all opaque geometry so early-z skips every covered pixel
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  /** set immediately */
  set(top: string, bottom: string) {
    this.uniforms.top.value.set(top);
    this.uniforms.bottom.value.set(bottom);
    this.fog.color.copy(this.uniforms.bottom.value).lerp(new THREE.Color(1, 1, 1), 0.25);
  }

  /** prepare a crossfade; call blend(k) with k 0→1 */
  beginBlend(top: string, bottom: string) {
    this.fromTop.copy(this.uniforms.top.value);
    this.fromBottom.copy(this.uniforms.bottom.value);
    this.toTop.set(top);
    this.toBottom.set(bottom);
  }
  blend(k: number) {
    this.uniforms.top.value.lerpColors(this.fromTop, this.toTop, k);
    this.uniforms.bottom.value.lerpColors(this.fromBottom, this.toBottom, k);
    this.fog.color.copy(this.uniforms.bottom.value).lerp(WHITE, 0.25);
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// ------------------------------------------------------------------ environment
export function makeEnvironment(renderer: THREE.WebGLRenderer, hdr: THREE.DataTexture | null): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let env: THREE.Texture;
  if (hdr) {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    env = pmrem.fromEquirectangular(hdr).texture;
  } else {
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  pmrem.dispose();
  return env;
}

export function makeSun(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight('#fff0d8', 2.1);
  sun.position.set(-15, 30, 13);
  sun.castShadow = true;
  const c = sun.shadow.camera;
  c.left = -19; c.right = 19; c.top = 19; c.bottom = -19; c.near = 5; c.far = 80;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  sun.shadow.intensity = 0.85;
  return sun;
}

// ------------------------------------------------------------------ island
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const edgeNoise = (a: number) =>
  1 + 0.05 * Math.sin(a * 3 + 1.3) + 0.035 * Math.sin(a * 7 + 0.4) + 0.02 * Math.sin(a * 13 + 2.1);

export function buildIsland(grass: PBR, rock: PBR): THREE.Group {
  const g = new THREE.Group();
  const seg = 128;

  // grass top: a disc with a noisy rim
  const top = new THREE.CircleGeometry(ISLAND_R, seg);
  {
    const p = top.attributes.position as THREE.BufferAttribute;
    const uv = top.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const a = Math.atan2(y, x), r = Math.hypot(x, y);
      const f = r > 0 ? edgeNoise(a) : 1;
      p.setXY(i, x * f, y * f);
      uv.setXY(i, (x * f) / 10, (y * f) / 10);
    }
    top.rotateX(-Math.PI / 2);
    top.computeVertexNormals();
  }
  const grassMat = new THREE.MeshStandardMaterial({
    color: grass.color ? '#b8e07a' : '#5fbf4a', map: grass.color, normalMap: grass.normal,
    roughnessMap: grass.rough, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8),
  });
  const topMesh = new THREE.Mesh(top, grassMat);
  topMesh.renderOrder = 2; // after the board: the grass under the board is depth-rejected
  topMesh.position.y = GROUND_Y;
  topMesh.receiveShadow = true;
  g.add(topMesh);

  // cliff: lathe-like ring that tapers down to a rocky point
  const rings = [
    { y: 0, r: 1.0 }, { y: -0.35, r: 1.005 }, { y: -1.6, r: 0.96 }, { y: -3.6, r: 0.86 },
    { y: -6.5, r: 0.66 }, { y: -10, r: 0.4 }, { y: -13.5, r: 0.14 }, { y: -15, r: 0.02 },
  ];
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let j = 0; j < rings.length; j++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const jitter = j > 0 ? 1 + (hash(i * 7.3 + j * 13.1) - 0.5) * 0.08 : 1;
      const r = ISLAND_R * rings[j].r * edgeNoise(a) * jitter;
      pos.push(Math.cos(a) * r, GROUND_Y + rings[j].y, -Math.sin(a) * r);
      uvs.push((i / seg) * 18, rings[j].y / 4);
    }
  }
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const cliff = new THREE.BufferGeometry();
  cliff.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cliff.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  cliff.setIndex(idx);
  cliff.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({
    color: rock.color ? '#c99a6e' : '#9a6b45', map: rock.color, normalMap: rock.normal, roughness: 0.95,
  });
  const cliffMesh = new THREE.Mesh(cliff, rockMat);
  g.add(cliffMesh);

  // grass lip that overhangs the cliff edge a little
  const lip = new THREE.TorusGeometry(ISLAND_R * 1.0, 0.32, 8, seg);
  {
    const p = lip.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const a = Math.atan2(y, x);
      const r = Math.hypot(x, y);
      const f = edgeNoise(a);
      p.setXY(i, (x / r) * (r * f), (y / r) * (r * f));
    }
    lip.rotateX(-Math.PI / 2);
    lip.computeVertexNormals();
  }
  const lipMesh = new THREE.Mesh(lip, grassMat);
  lipMesh.position.y = GROUND_Y - 0.12;
  g.add(lipMesh);

  // soft contact shadow under the board
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const ao = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }),
  );
  ao.position.y = GROUND_Y + 0.01;
  ao.renderOrder = 1;
  g.add(ao);
  return g;
}

// ------------------------------------------------------------------ clouds
export function buildClouds(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(7);
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 1, emissive: '#dfe9ff', emissiveIntensity: 0.35, flatShading: false,
  });
  const variants: THREE.BufferGeometry[] = [];
  for (let v = 0; v < 3; v++) {
    const parts: THREE.BufferGeometry[] = [];
    const n = 5 + v;
    for (let i = 0; i < n; i++) {
      const s = 1.2 + r() * 1.4;
      const p = new THREE.IcosahedronGeometry(s, 3);
      p.translate((i - n / 2) * 1.5 + r() * 0.6, r() * 0.8 + (i % 2) * 0.5, (r() - 0.5) * 1.6);
      parts.push(p);
    }
    const m = mergeGeometries(parts)!;
    // flatten the underside
    const pa = m.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) if (pa.getY(i) < -0.3) pa.setY(i, -0.3 + (pa.getY(i) + 0.3) * 0.3);
    m.computeVertexNormals();
    variants.push(m);
  }
  const inst = variants.map((v) => new THREE.InstancedMesh(v, mat, 8));
  const counts = [0, 0, 0];
  const o = new THREE.Object3D();
  for (let i = 0; i < 24; i++) {
    const below = i < 13;
    const a = (i / 24) * Math.PI * 2 + r() * 0.4;
    const dist = below ? 48 + r() * 40 : 70 + r() * 70;
    o.position.set(Math.cos(a) * dist, below ? -9 - r() * 10 : 18 + r() * 26, Math.sin(a) * dist);
    o.scale.setScalar(below ? 1.6 + r() * 1.6 : 2.2 + r() * 2.5);
    o.rotation.set(0, r() * Math.PI, 0);
    o.updateMatrix();
    const v = i % 3;
    inst[v].setMatrixAt(counts[v]++, o.matrix);
  }
  inst.forEach((m, v) => { m.count = counts[v]; m.computeBoundingSphere(); m.frustumCulled = false; g.add(m); });
  return g;
}

// ------------------------------------------------------------------ decor scatter
type Kind = 'tree' | 'rock' | 'small' | 'flower' | 'lamp';
function decorKind(path: string): Kind {
  const p = path.toLowerCase();
  if (/lamp|lantern|light/.test(p)) return 'lamp';
  if (/flower/.test(p)) return 'flower';
  if (/tree|pine|palm|oak|birch|fir/.test(p)) return 'tree';
  if (/rock|stone|boulder|cliff/.test(p)) return 'rock';
  return 'small';
}
const HEIGHT: Record<Kind, [number, number]> = {
  tree: [2.5, 4.3], rock: [0.45, 1.0], small: [0.5, 1.0], flower: [0.35, 0.6], lamp: [1.7, 1.7],
};

/** scatter decor on the island ring; one InstancedMesh per baked model */
export function scatterDecor(models: { path: string; model: Model }[]): THREE.Group {
  const g = new THREE.Group();
  if (!models.length) return g;
  const r = rng(42);
  const B = 13.1; // board half-size incl. frame
  const kinds = models.map((m) => decorKind(m.path));
  const byKind = (k: Kind) => models.map((_, i) => i).filter((i) => kinds[i] === k);
  const spots: { x: number; z: number; s: number; yaw: number; m: number }[] = [];
  const placed: { x: number; z: number; rad: number }[] = [];
  const tryPlace = (mi: number, x: number, z: number, h: number) => {
    const size = models[mi].model.size;
    const s = Math.min(h / Math.max(size.y, 1e-3), (kinds[mi] === 'tree' ? 3.4 : 2.0) / Math.max(size.x, size.z, 1e-3));
    const rad = Math.max(size.x, size.z) * s * 0.42 + 0.15;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.rad + rad) ** 2)) return false;
    placed.push({ x, z, rad });
    spots.push({ x, z, s, yaw: r() * Math.PI * 2, m: mi });
    return true;
  };
  // lanterns: around the frame (not in front of the near edge)
  const lamps = byKind('lamp');
  if (lamps.length) {
    for (const [x, z] of [[-14.6, 14.6], [14.6, 14.6], [-14.6, -14.6], [14.6, -14.6], [-14.9, 0], [14.9, 0], [-6, -14.9], [6, -14.9]]) {
      tryPlace(lamps[0], x, z, HEIGHT.lamp[0]);
    }
  }
  const pool = models.map((_, i) => i).filter((i) => kinds[i] !== 'lamp');
  for (let t = 0; t < 4000 && spots.length < 250; t++) {
    const a = r() * Math.PI * 2;
    const d = 14 + Math.sqrt(r()) * (ISLAND_R - 14);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (d > ISLAND_R * edgeNoise(Math.atan2(-z, x)) - 1.4) continue;
    const e = Math.max(Math.abs(x), Math.abs(z)) - B; // distance outside the board square
    if (e < 0.9) continue;
    const front = z > 0 && Math.abs(z) >= Math.abs(x) - 2;
    const back = z < 0 && Math.abs(z) >= Math.abs(x);
    let mi = pool[Math.floor(r() * pool.length)];
    let [h0, h1] = HEIGHT[kinds[mi]];
    let h = h0 + r() * (h1 - h0);
    // tall things near the camera side / far edge would cover tiles: they need distance ≈ their height
    if (kinds[mi] === 'tree' && ((front || back) ? e < 0.95 * h + 0.8 : e < 1.8)) {
      const low = pool.filter((i) => kinds[i] !== 'tree');
      if (!low.length) continue;
      mi = low[Math.floor(r() * low.length)];
      [h0, h1] = HEIGHT[kinds[mi]];
      h = h0 + r() * (h1 - h0);
    }
    tryPlace(mi, x, z, h);
    // flower patches: a few extra around each flower
    if (kinds[mi] === 'flower') for (let f = 0; f < 3; f++) tryPlace(mi, x + (r() - 0.5) * 1.6, z + (r() - 0.5) * 1.6, h0 + r() * (h1 - h0));
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  models.forEach(({ model }, mi) => {
    const mine = spots.filter((s) => s.m === mi);
    if (!mine.length) return;
    if (model.geometry && model.material) {
      const inst = new THREE.InstancedMesh(model.geometry, model.material, mine.length);
      mine.forEach((s, k) => {
        q.setFromAxisAngle(up, s.yaw);
        p.set(s.x, GROUND_Y, s.z);
        sc.setScalar(s.s);
        inst.setMatrixAt(k, m4.compose(p, q, sc));
      });
      inst.castShadow = inst.receiveShadow = true;
      inst.computeBoundingSphere();
      g.add(inst);
    } else {
      for (const s of mine) {
        const o = model.make();
        o.position.set(s.x, GROUND_Y, s.z);
        o.rotation.y = s.yaw;
        o.scale.setScalar(s.s);
        g.add(o);
      }
    }
  });
  return g;
}

/** procedural low-poly trees/rocks/bushes when no decor models are available (baked → instanced) */
export function fallbackDecorModels(): { path: string; model: Model }[] {
  const leaf = new THREE.MeshStandardMaterial({ color: '#4cc85a', roughness: 0.5 });
  const trunk = new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.8 });
  const rockM = new THREE.MeshStandardMaterial({ color: '#9aa3b5', roughness: 0.7 });
  const tree = new THREE.Group();
  tree.add(
    new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 8).translate(0, 0.5, 0), trunk),
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 2).translate(0, 1.5, 0), leaf),
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2).translate(0.2, 2.1, 0.1), leaf),
  );
  const rock = new THREE.Group();
  rock.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0).scale(1, 0.6, 0.8).translate(0, 0.3, 0), rockM));
  const bush = new THREE.Group();
  bush.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2).scale(1, 0.75, 1).translate(0, 0.35, 0), leaf));
  return [
    { path: 'tree', model: bakeModel(tree) },
    { path: 'rock', model: bakeModel(rock) },
    { path: 'bush', model: bakeModel(bush) },
  ];
}
