// Pure board geometry (no three imports) — world units, y up, camera looks north (−z).
// Tile 0 = GO at the bottom-right (south-east) corner; order runs clockwise seen from above:
// bottom row east→west 0..10, west column south→north 10..20, top row west→east 20..30,
// east column north→south 30..39.

export const TILE_W = 2;              // regular tile width along its row
export const TILE_D = 3;              // tile depth = corner size
export const BOARD = 2 * TILE_D + 9 * TILE_W; // 24
export const HALF = BOARD / 2;
export const BAND = 0.78;             // inner colour band depth (buildings sit here)
export const GAP = 0.07;              // gap between tile blocks
export const TILE_BASE = 0.02;        // felt surface height
export const TILE_TOP = 0.3;          // top of the printed tile blocks
export const PLAZA_TOP = 0.26;
export const FRAME = 1.15;            // wood rim around the tiles

export type Side = 0 | 1 | 2 | 3;     // 0 bottom, 1 left, 2 top, 3 right

export interface TileRect {
  index: number;
  side: Side;
  corner: boolean;
  /** world-space rectangle on the XZ plane */
  x0: number; x1: number; z0: number; z1: number;
  cx: number; cz: number;
  /** unit vector pointing from the tile toward the board centre */
  inX: number; inZ: number;
  /** travel direction of the token while on this side */
  dirX: number; dirZ: number;
}

export function tileRect(i: number): TileRect {
  const side = Math.floor(i / 10) as Side;
  const k = i % 10; // 0 = corner that starts the side
  const corner = k === 0;
  const H = HALF, D = TILE_D, W = TILE_W;
  // along = distance from the side's starting corner edge to the tile's far edge
  const a0 = corner ? 0 : D + (k - 1) * W;
  const a1 = corner ? D : a0 + W;
  let x0 = 0, x1 = 0, z0 = 0, z1 = 0, inX = 0, inZ = 0, dirX = 0, dirZ = 0;
  switch (side) {
    case 0: x1 = H - a0; x0 = H - a1; z0 = H - D; z1 = H; inZ = -1; dirX = -1; break;
    case 1: x0 = -H; x1 = -H + D; z1 = H - a0; z0 = H - a1; inX = 1; dirZ = -1; break;
    case 2: x0 = -H + a0; x1 = -H + a1; z0 = -H; z1 = -H + D; inZ = 1; dirX = 1; break;
    case 3: x0 = H - D; x1 = H; z0 = -H + a0; z1 = -H + a1; inX = -1; dirZ = 1; break;
  }
  return { index: i, side, corner, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, inX, inZ, dirX, dirZ };
}

export const TILES: readonly TileRect[] = Array.from({ length: 40 }, (_, i) => tileRect(i));

/** where the token stands on a tile (slightly toward the outer edge so houses stay visible) */
export function tokenSpot(i: number): { x: number; z: number } {
  const t = TILES[((i % 40) + 40) % 40];
  // corners: toward the outer corner so the big corner label stays readable
  if (t.corner) return { x: t.cx + Math.sign(t.cx) * 0.55, z: t.cz + Math.sign(t.cz) * 0.55 };
  return { x: t.cx - t.inX * 0.3, z: t.cz - t.inZ * 0.3 };
}

/** centre of the inner colour band and the axis buildings line up along */
export function bandSpot(i: number): { x: number; z: number; alongX: number; alongZ: number; outYaw: number } {
  const t = TILES[i];
  const depth = TILE_D / 2 - BAND / 2;
  const x = t.cx + t.inX * depth, z = t.cz + t.inZ * depth;
  // buildings face outward (away from the centre)
  const outYaw = Math.atan2(-t.inX, -t.inZ);
  return { x, z, alongX: t.inZ !== 0 ? 1 : 0, alongZ: t.inX !== 0 ? 1 : 0, outYaw };
}

/** yaw (rotation about +y, 0 = facing +z) for travelling along a direction */
export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

// Landmark plots on the central plaza (x, z, rotation facing the camera).
export const PLOTS: readonly { x: number; z: number }[] = [
  { x: -5.2, z: -4.3 },
  { x: 0, z: -5.2 },
  { x: 5.2, z: -4.3 },
  { x: -4.7, z: 1.3 },
  { x: 4.7, z: 1.3 },
];
export const PLOT_SIZE = 3.5;
export const LANDMARK_FOOT = 2.8;
export const LANDMARK_MAX_H = 5.8;

// Dice rest spots (front of the plaza, nearest the camera)
export const DICE_SPOTS = [
  { x: -0.95, z: 5.4 },
  { x: 0.95, z: 5.75 },
];
