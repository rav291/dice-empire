// Offscreen landmark thumbnails: render target → OutputPass (tone map + sRGB) → readPixels → PNG.
import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LandmarkVisual, lawnMaterial, type LandmarkModel } from './city';
import { PLOT_SIZE } from './layout';

const SIZE = 512;

export class Thumbnails {
  private cache = new Map<string, Promise<string>>();
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private rtScene = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, samples: 4 });
  private rtOut = new THREE.WebGLRenderTarget(SIZE, SIZE);
  private out = new OutputPass();
  private pixels = new Uint8Array(SIZE * SIZE * 4);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private renderer: THREE.WebGLRenderer, env: THREE.Texture, private marker: THREE.Texture | null) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 1.0;
    const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
    sun.position.set(-4, 9, 6);
    this.scene.add(sun, new THREE.HemisphereLight('#dff1ff', '#f3d9b0', 0.6));
    this.out.renderToScreen = false;
  }

  get(key: string, stage: number, damaged: boolean, model: () => Promise<LandmarkModel>): Promise<string> {
    const id = `${key}|${stage}|${damaged ? 1 : 0}`;
    let p = this.cache.get(id);
    if (!p) {
      // serialised: one offscreen render at a time
      p = this.queue.then(model).then((m) => this.render(m, stage, damaged)).catch(() => '');
      this.queue = p;
      this.cache.set(id, p);
    }
    return p;
  }

  private render(lm: LandmarkModel, stage: number, damaged: boolean): string {
    const vis = new LandmarkVisual();
    vis.setModel('thumb', lm.model, lm.scale);
    vis.apply(stage, damaged);
    const holder = new THREE.Group();
    holder.add(vis.root);
    if (stage === 0) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(PLOT_SIZE * 0.8, 0.12, PLOT_SIZE * 0.8), lawnMaterial());
      pad.position.y = 0.06;
      holder.add(pad);
      if (this.marker) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.marker }));
        s.scale.setScalar(1.6);
        s.position.y = 1.2;
        holder.add(s);
      }
    }
    this.scene.add(holder);

    // frame the full-size landmark so every stage shares the same framing
    const h = Math.max(1.6, vis.height);
    const r = Math.max(h * 0.62, 2.0);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.cam.fov / 2)) * 0.98;
    const yaw = -0.6, pitch = 0.42;
    const ty = h * 0.45;
    this.cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    this.cam.lookAt(0, ty, 0);

    const rd = this.renderer;
    const prevTarget = rd.getRenderTarget();
    const prevClear = rd.getClearColor(new THREE.Color());
    const prevAlpha = rd.getClearAlpha();
    rd.setRenderTarget(this.rtScene);
    rd.setClearColor(0x000000, 0);
    rd.clear();
    rd.render(this.scene, this.cam);
    this.out.render(rd, this.rtOut, this.rtScene, 0, false);
    rd.readRenderTargetPixels(this.rtOut, 0, 0, SIZE, SIZE, this.pixels);
    rd.setRenderTarget(prevTarget);
    rd.setClearColor(prevClear, prevAlpha);

    this.scene.remove(holder);
    holder.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && o.parent === holder) m.geometry.dispose();
    });

    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    // flip rows (GL origin is bottom-left) and un-premultiply nothing: alpha is straight here
    for (let y = 0; y < SIZE; y++) {
      const src = (SIZE - 1 - y) * SIZE * 4;
      img.data.set(this.pixels.subarray(src, src + SIZE * 4), y * SIZE * 4);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
}
