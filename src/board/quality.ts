// Post-processing chain + quality tiers + frame-time watchdog.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export type Quality = 'high' | 'low';
const MAX_PIXELS = 4.2e6; // pixel budget for 'high' (≈ 1080p × 2)

export class Post {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private fxaa = new FXAAPass();
  private msaa: boolean;
  quality: Quality = 'high';

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // AA: 4× MSAA on the HDR target (crisper tile text, ~6 ms cheaper than SMAA on an iGPU);
    // FXAA only without MSAA support. Both tiers go through the composer: on ANGLE/D3D11 iGPUs this
    // measured faster than rendering straight into the multisampled default framebuffer.
    this.msaa = renderer.capabilities.maxSamples >= 4;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.msaa ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    // threshold above lit white surfaces: only glints, sparkles and glow rings bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.6);
    // clamp HDR input: tiny GGX highlights (lacquer, clearcoat) otherwise bloom into huge white blobs
    const hp = this.bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( 4.0 ) );',
    );
    hp.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    this.apply();
  }

  /** sync passes/targets with the current tier */
  apply() {
    // MSAA stays on in 'low' too: measured cheaper than FXAA on a non-multisampled target (UHD 630)
    const samples = this.msaa ? 4 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    this.bloom.enabled = this.quality === 'high';
    this.fxaa.enabled = samples === 0;
  }

  pixelRatio(w: number, h: number) {
    if (this.quality === 'low') return 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.max(1, Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(1, w * h))));
  }

  setSize(w: number, h: number) {
    const pr = this.pixelRatio(w, h);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}

/** average frame time over 3 s windows; fires once when it stays above the budget */
export class PerfWatch {
  private t = 0;
  private sum = 0;
  private n = 0;
  private warm = 2.5;
  fps = 60;
  ms = 16.7;
  fired = false;

  sample(dt: number): boolean {
    if (dt > 0.25) return false; // tab switch / hitch, not representative
    if (this.warm > 0) { this.warm -= dt; return false; }
    this.t += dt; this.sum += dt; this.n++;
    if (this.t < 3) return false;
    this.ms = (this.sum / this.n) * 1000;
    this.fps = 1000 / this.ms;
    this.t = this.sum = this.n = 0;
    if (!this.fired && this.ms > 24) { this.fired = true; return true; }
    return false;
  }

  /** after a manual quality change, give the new tier a fresh warm-up */
  reset() { this.warm = 2.5; this.t = this.sum = this.n = 0; }
}
