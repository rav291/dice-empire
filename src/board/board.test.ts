import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TILES, HALF, tokenSpot, bandSpot } from './layout';
import { faceUpQuat, topValue } from './dice';
import { fitRig } from './camera';

describe('board layout', () => {
  it('places the corners where the contract says (GO bottom-right, clockwise)', () => {
    const c = (i: number) => [Math.sign(TILES[i].cx), Math.sign(TILES[i].cz)];
    expect(c(0)).toEqual([1, 1]);   // GO bottom-right (+z is toward the camera)
    expect(c(10)).toEqual([-1, 1]); // jail bottom-left
    expect(c(20)).toEqual([-1, -1]); // park top-left
    expect(c(30)).toEqual([1, -1]); // go-to-jail top-right
  });
  it('chains tiles edge to edge inside the board', () => {
    for (let i = 0; i < 40; i++) {
      const a = TILES[i], b = TILES[(i + 1) % 40];
      const touchX = Math.abs(a.x0 - b.x1) < 1e-9 || Math.abs(a.x1 - b.x0) < 1e-9;
      const touchZ = Math.abs(a.z0 - b.z1) < 1e-9 || Math.abs(a.z1 - b.z0) < 1e-9;
      expect(touchX || touchZ).toBe(true);
      for (const v of [a.x0, a.x1, a.z0, a.z1]) expect(Math.abs(v)).toBeLessThanOrEqual(HALF + 1e-9);
    }
  });
  it('keeps token and building spots on their own tile', () => {
    for (const t of TILES) {
      const s = tokenSpot(t.index);
      expect(s.x > t.x0 && s.x < t.x1 && s.z > t.z0 && s.z < t.z1).toBe(true);
      if (!t.corner) {
        const b = bandSpot(t.index);
        expect(b.x > t.x0 && b.x < t.x1 && b.z > t.z0 && b.z < t.z1).toBe(true);
      }
    }
  });
});

describe('dice', () => {
  it('end orientation shows the requested face on top for any yaw', () => {
    for (let v = 1; v <= 6; v++) for (const yaw of [0, 0.4, -1.3, 2.9]) expect(topValue(faceUpQuat(v, yaw))).toBe(v);
  });
});

describe('camera fit', () => {
  it('keeps every point inside the frustum and centres the bounds', () => {
    const pts = [[-13, 0, -13], [13, 0, -13], [-13, 0, 13], [13, 0, 13], [0, 5, -5]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    for (const [tanX, tanY, pitch] of [[0.35, 0.35, 1.0], [0.2, 0.45, 1.1], [0.55, 0.3, 0.85]]) {
      const r = fitRig(pts, 0, pitch, tanX, tanY);
      const cam = new THREE.PerspectiveCamera();
      cam.position.set(r.tx, r.ty + Math.sin(r.pitch) * r.dist, r.tz + Math.cos(r.pitch) * r.dist);
      cam.lookAt(r.tx, r.ty, r.tz);
      cam.updateMatrixWorld();
      const inv = cam.matrixWorldInverse;
      for (const p of pts) {
        const v = p.clone().applyMatrix4(inv);
        expect(Math.abs(v.x / -v.z)).toBeLessThanOrEqual(tanX + 1e-3);
        expect(Math.abs(v.y / -v.z)).toBeLessThanOrEqual(tanY + 1e-3);
      }
      expect(Math.max(r.fillX!, r.fillY!)).toBeGreaterThan(0.98); // tight on the limiting axis
    }
  });
});
