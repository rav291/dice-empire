// Asset loading with graceful fallbacks: every loader resolves (null = missing) and never throws.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssetManifest } from '../contract';
import { asset, loadManifest } from '../shared/manifest';

export const FONT = 'Lilita One';
export const FONT_STACK = `'${FONT}', 'Arial Rounded MT Bold', 'Arial Black', sans-serif`;

const FALLBACK_MANIFEST: AssetManifest = {
  hdri: 'hdri/env.hdr',
  textures: {
    wood: { color: 'textures/wood/color.jpg', normal: 'textures/wood/normal.jpg', rough: 'textures/wood/rough.jpg' },
    felt: { color: 'textures/felt/color.jpg', normal: 'textures/felt/normal.jpg', rough: 'textures/felt/rough.jpg' },
    ground: { color: 'textures/ground/color.jpg', normal: 'textures/ground/normal.jpg', rough: 'textures/ground/rough.jpg' },
    metal: { color: 'textures/metal/color.jpg', normal: 'textures/metal/normal.jpg', rough: 'textures/metal/rough.jpg' },
    stone: { color: 'textures/stone/color.jpg', normal: 'textures/stone/normal.jpg', rough: 'textures/stone/rough.jpg' },
  },
  models: { token: 'models/token.glb', house: 'models/house.glb', hotel: 'models/hotel.glb', decor: [], landmarks: {} },
  cities: [
    { name: 'Sunny Bay', landmarks: ['lm_a', 'lm_b', 'lm_c', 'lm_d', 'lm_e'], sky: ['#3aa8ff', '#bfe9ff'], accent: '#ffcc2e' },
    { name: 'Rose Valley', landmarks: ['lm_f', 'lm_g', 'lm_h', 'lm_i', 'lm_j'], sky: ['#ff7eb6', '#ffe0c2'], accent: '#ff4f9a' },
    { name: 'Emerald Isle', landmarks: ['lm_k', 'lm_l', 'lm_m', 'lm_n', 'lm_o'], sky: ['#29c4a9', '#d8fff2'], accent: '#16b45a' },
    { name: 'Dusk City', landmarks: ['lm_p', 'lm_q', 'lm_r', 'lm_s', 'lm_t'], sky: ['#6a5cff', '#ffb38a'], accent: '#8d4dff' },
    { name: 'Frost Peak', landmarks: ['lm_u', 'lm_v', 'lm_w', 'lm_x', 'lm_y'], sky: ['#5fa8ff', '#f2f8ff'], accent: '#4cc3f5' },
    { name: 'Desert Gold', landmarks: ['lm_a', 'lm_c', 'lm_e', 'lm_g', 'lm_i'], sky: ['#ff9a3d', '#ffe8a8'], accent: '#ff9419' },
  ],
  music: [],
};

export async function getManifest(): Promise<AssetManifest> {
  try {
    const m = await loadManifest();
    if (!m || !Array.isArray(m.cities) || !m.cities.length) return FALLBACK_MANIFEST;
    return {
      ...FALLBACK_MANIFEST,
      ...m,
      textures: { ...FALLBACK_MANIFEST.textures, ...(m.textures ?? {}) },
      models: { ...FALLBACK_MANIFEST.models, ...(m.models ?? {}), landmarks: m.models?.landmarks ?? {}, decor: m.models?.decor ?? [] },
    };
  } catch {
    return FALLBACK_MANIFEST;
  }
}

export async function loadFont(): Promise<void> {
  try {
    const f = new FontFace(FONT, `url(${asset('fonts/LilitaOne-Regular.woff2')})`);
    await f.load();
    document.fonts.add(f);
  } catch {
    /* system fallback font */
  }
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const texLoader = new THREE.TextureLoader();
export function loadTexture(path: string | undefined, srgb: boolean, repeat = 1, aniso = 8): Promise<THREE.Texture | null> {
  if (!path) return Promise.resolve(null);
  return texLoader.loadAsync(asset(path)).then(
    (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = aniso;
      return t;
    },
    () => null,
  );
}

export function loadHDR(path: string): Promise<THREE.DataTexture | null> {
  return new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(asset(path)).then(
    (t) => t,
    () => null,
  );
}

// ------------------------------------------------------------------ models
export interface Model {
  /** size after normalisation (centred on x/z, sitting on y = 0) */
  size: THREE.Vector3;
  /** new instance sharing geometry/material */
  make(): THREE.Object3D;
  /** the baked single mesh, when the model could be merged */
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material;
}

export interface BakeOpts {
  physical?: boolean;
  /** colour grade applied to baked material colours (e.g. push teal foliage toward green) */
  grade?: (c: THREE.Color) => void;
}

/** glossy toy look; clearcoat (physical) only for small hero objects — it is costly on iGPUs */
function makeMat(p: THREE.MeshStandardMaterialParameters, o: BakeOpts): THREE.MeshStandardMaterial {
  return o.physical
    ? new THREE.MeshPhysicalMaterial({ ...p, clearcoat: 1, clearcoatRoughness: 0.08 })
    : new THREE.MeshStandardMaterial(p);
}

/** glossy toy look for anything coming out of a GLB */
export function toyMaterial(src: THREE.Material, o: BakeOpts = {}): THREE.MeshStandardMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = makeMat({
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    normalMap: s.normalMap ?? null,
    vertexColors: !!s.vertexColors,
    roughness: Math.min(s.roughness ?? 0.6, 0.5),
    metalness: Math.min(s.metalness ?? 0, 0.3),
    transparent: s.transparent && s.opacity < 1,
    opacity: s.opacity ?? 1,
    side: s.side ?? THREE.FrontSide,
  }, o);
  if (s.emissive && s.emissive.getHex() !== 0) {
    m.emissive.copy(s.emissive);
    m.emissiveMap = s.emissiveMap ?? null;
    m.emissiveIntensity = s.emissiveIntensity ?? 1;
  }
  return m;
}

/**
 * Merge every mesh of a GLB into one geometry (material colours baked into vertex colours)
 * so each instance is a single draw call. Models with several distinct textures stay a scene graph.
 */
export function bakeModel(root: THREE.Object3D, o: BakeOpts = {}): Model {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.attributes.position) meshes.push(m);
  });
  const mats = meshes.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])) as THREE.MeshStandardMaterial[];
  const maps = new Set(mats.map((m) => m.map ?? null));
  const sharedMap = maps.size === 1 ? [...maps][0] : null;
  const mergeable = meshes.length > 0 && maps.size === 1;
  // Kenney palette atlases: sample cells exactly so colours never bleed between swatches at distance
  for (const t of maps) if (t) { t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }

  if (mergeable) {
    const hasUV = !!sharedMap && meshes.every((m) => m.geometry.attributes.uv);
    const geos: THREE.BufferGeometry[] = [];
    const rough = mats.reduce((a, m) => a + (m.roughness ?? 0.6), 0);
    const metal = mats.reduce((a, m) => a + (m.metalness ?? 0), 0);
    for (const mesh of meshes) {
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const vc = g.attributes.color as THREE.BufferAttribute | undefined;
      const matArr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
      const c = new THREE.Color();
      for (const gr of groups) {
        const mat = (matArr[gr.materialIndex ?? 0] ?? matArr[0]) as THREE.MeshStandardMaterial;
        c.copy(mat.color ?? new THREE.Color(1, 1, 1));
        o.grade?.(c);
        const end = Math.min(n, gr.start + gr.count);
        for (let v = gr.start; v < end; v++) {
          let r = c.r, gg = c.g, b = c.b;
          if (vc) { r *= vc.getX(v); gg *= vc.getY(v); b *= vc.getZ(v); }
          col[v * 3] = r; col[v * 3 + 1] = gg; col[v * 3 + 2] = b;
        }
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', g.attributes.position);
      out.setAttribute('normal', g.attributes.normal);
      if (hasUV) out.setAttribute('uv', g.attributes.uv);
      out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(out);
    }
    const geometry = mergeGeometries(geos, false);
    if (geometry) {
      const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute);
      const ctr = box.getCenter(new THREE.Vector3());
      geometry.translate(-ctr.x, -box.min.y, -ctr.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const size = box.getSize(new THREE.Vector3());
      const cnt = Math.max(1, mats.length);
      const material = makeMat({
        vertexColors: true,
        map: hasUV ? sharedMap : null,
        roughness: Math.min(0.5, rough / cnt),
        metalness: Math.min(0.25, metal / cnt),
      }, o);
      const make = () => {
        const m = new THREE.Mesh(geometry, material);
        m.castShadow = m.receiveShadow = true;
        return m;
      };
      return { size, make, geometry, material };
    }
  }

  // Fallback: keep the scene graph, toyify materials, normalise with a wrapper.
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (src: THREE.Material) => {
      let d = cache.get(src);
      if (!d) cache.set(src, (d = toyMaterial(src, o)));
      return d;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
    m.castShadow = m.receiveShadow = true;
  });
  const box = new THREE.Box3().setFromObject(root);
  const ctr = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(root);
  root.position.sub(new THREE.Vector3(ctr.x, box.min.y, ctr.z));
  return { size: box.getSize(new THREE.Vector3()), make: () => inner.clone(true) };
}

const gltf = new GLTFLoader();
const modelCache = new Map<string, Promise<Model | null>>();

export function loadModel(path: string | undefined, o: BakeOpts = {}): Promise<Model | null> {
  if (!path) return Promise.resolve(null);
  let p = modelCache.get(path);
  if (!p) {
    p = gltf.loadAsync(asset(path)).then(
      (g) => {
        try {
          return bakeModel(g.scene, o);
        } catch (e) {
          console.warn('[board] model bake failed', path, e);
          return null;
        }
      },
      () => null,
    );
    modelCache.set(path, p);
  }
  return p;
}

/** uniform scale that fits a footprint (max x/z extent) and a max height */
export function fitScale(size: THREE.Vector3, foot: number, maxH = Infinity): number {
  const s = foot / Math.max(size.x, size.z, 1e-3);
  return size.y * s > maxH ? maxH / Math.max(size.y, 1e-3) : s;
}
