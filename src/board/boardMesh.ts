// The physical board: bevelled wood slab, felt inlay, 40 raised printed tiles (one draw call),
// gold trim and the stone city plaza.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOARD, FRAME, GAP, HALF, PLAZA_TOP, TILE_BASE, TILE_D, TILE_TOP, TILES } from './layout';

export interface PBR {
  color: THREE.Texture | null;
  normal: THREE.Texture | null;
  rough: THREE.Texture | null;
}

function roundedRect(half: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.quadraticCurveTo(half, -half, half, -half + r);
  s.lineTo(half, half - r);
  s.quadraticCurveTo(half, half, half - r, half);
  s.lineTo(-half + r, half);
  s.quadraticCurveTo(-half, half, -half, half - r);
  s.lineTo(-half, -half + r);
  s.quadraticCurveTo(-half, -half, -half + r, -half);
  return s;
}

/** clone a texture set with its own repeat */
function withRepeat(p: PBR, rep: number): PBR {
  const f = (t: THREE.Texture | null) => {
    if (!t) return null;
    const c = t.clone();
    c.repeat.set(rep, rep);
    c.needsUpdate = true;
    return c;
  };
  return { color: f(p.color), normal: f(p.normal), rough: f(p.rough) };
}

export function buildBoard(tileMap: THREE.Texture, tex: { wood: PBR; felt: PBR; stone: PBR; metal: PBR }) {
  const group = new THREE.Group();
  group.name = 'board';

  // --- wood slab (lacquered) -------------------------------------------
  const depth = 0.95, bevel = 0.24;
  const slabGeo = new THREE.ExtrudeGeometry(roundedRect(HALF + FRAME - bevel, 1.25), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 14,
  });
  slabGeo.rotateX(-Math.PI / 2);
  slabGeo.translate(0, -(depth + bevel), 0);
  const wood = withRepeat(tex.wood, 0.07);
  // lacquered wood: low roughness instead of a clearcoat layer (much cheaper on iGPUs)
  const woodMat = new THREE.MeshStandardMaterial({
    color: wood.color ? '#ffd2a8' : '#b8733a',
    map: wood.color, normalMap: wood.normal, roughnessMap: wood.rough,
    roughness: wood.rough ? 0.42 : 0.32,
    normalScale: new THREE.Vector2(0.5, 0.5),
  });
  const slab = new THREE.Mesh(slabGeo, woodMat);
  slab.receiveShadow = true;
  slab.castShadow = true;
  slab.renderOrder = 1; // covered surfaces draw after the tiles/plaza so early-z rejects them
  group.add(slab);

  // --- felt inlay (visible in the gaps between tiles) -------------------
  const felt = withRepeat(tex.felt, 6);
  const feltMat = new THREE.MeshStandardMaterial({
    color: '#1f4f86', map: felt.color, normalMap: felt.normal, roughness: 0.95,
  });
  const feltMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD + 0.2, BOARD + 0.2).rotateX(-Math.PI / 2), feltMat);
  feltMesh.position.y = TILE_BASE - 0.005;
  feltMesh.receiveShadow = true;
  feltMesh.renderOrder = 1;
  group.add(feltMesh);

  // --- gold trim around the tile ring -----------------------------------
  const metal = withRepeat(tex.metal, 2);
  const goldMat = new THREE.MeshStandardMaterial({
    color: '#ffc63d', metalness: 1, roughness: 0.26, normalMap: metal.normal,
  });
  const trimGeos: THREE.BufferGeometry[] = [];
  const tw = 0.16, th = 0.1, L = BOARD + 0.3;
  for (let s = 0; s < 4; s++) {
    const g = new RoundedBoxGeometry(L, th, tw, 2, 0.045);
    g.translate(0, TILE_BASE + th / 2, HALF + 0.08);
    g.rotateY((s * Math.PI) / 2);
    trimGeos.push(g);
  }
  const trim = new THREE.Mesh(mergeGeometries(trimGeos)!, goldMat);
  trim.receiveShadow = true;
  group.add(trim);

  // --- 40 tile blocks merged, planar UVs into the printed canvas ---------
  const h = TILE_TOP - TILE_BASE;
  const geos: THREE.BufferGeometry[] = [];
  for (const t of TILES) {
    const g = new RoundedBoxGeometry(t.x1 - t.x0 - GAP, h, t.z1 - t.z0 - GAP, 3, 0.09);
    g.translate(t.cx, TILE_BASE + h / 2, t.cz);
    g.clearGroups();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + HALF) / BOARD, 1 - (pos.getZ(i) + HALF) / BOARD);
    }
    geos.push(g);
  }
  const tileGeo = mergeGeometries(geos)!;
  const tileMat = new THREE.MeshStandardMaterial({ map: tileMap, roughness: 0.42 });
  const tiles = new THREE.Mesh(tileGeo, tileMat);
  tiles.receiveShadow = true;
  group.add(tiles);

  // --- city plaza --------------------------------------------------------
  const inner = BOARD - 2 * TILE_D - 0.3;
  const stone = withRepeat(tex.stone, 3);
  const plazaMat = new THREE.MeshStandardMaterial({
    color: stone.color ? '#fff4e6' : '#d9d2c5',
    map: stone.color, normalMap: stone.normal, roughnessMap: stone.rough,
    roughness: stone.rough ? 0.9 : 0.7,
  });
  const plazaGeo = new RoundedBoxGeometry(inner, PLAZA_TOP - TILE_BASE, inner, 3, 0.12);
  // world-scaled UVs on top so the stone keeps its proportions
  {
    const pos = plazaGeo.attributes.position as THREE.BufferAttribute;
    const uv = plazaGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / inner + 0.5, 0.5 - pos.getZ(i) / inner);
  }
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.position.y = (PLAZA_TOP + TILE_BASE) / 2;
  plaza.receiveShadow = true;
  group.add(plaza);

  return { group, tileMat, woodMat, goldMat, plazaMat };
}
