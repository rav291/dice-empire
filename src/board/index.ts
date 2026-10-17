// Dice Empire — 3D board view (implements IBoardView from src/contract.ts).
import * as THREE from 'three';
import type { AssetManifest, GameState, IBoardView, IconKey } from '../contract';
import { BOARD as DEFS } from '../shared/board-data';
import { cityTheme, icon } from '../shared/manifest';
import { play } from '../audio/sfx';
import { Tweens, easeOutBack, easeInCubic } from './anim';
import { getManifest, loadFont, loadHDR, loadImage, loadModel, loadTexture, type Model } from './assets';
import { buildBoard, type PBR } from './boardMesh';
import { Buildings } from './buildings';
import { CameraRig, type Insets } from './camera';
import { City, fallbackLandmark, type LandmarkModel } from './city';
import { Dice } from './dice';
import { FX } from './fx';
import { GAP, PLAZA_TOP, TILES, TILE_TOP } from './layout';
import { Post, PerfWatch, type Quality } from './quality';
import { Sky, buildClouds, buildIsland, fallbackDecorModels, makeEnvironment, makeSun, scatterDecor } from './scene';
import { Thumbnails } from './thumbnails';
import { TILE_ICONS, drawBoardCanvas } from './tileTexture';
import { Token } from './token';

const _v = new THREE.Vector3();
const _hsl = { h: 0, s: 0, l: 0 };
/** Kenney foliage is teal; push cyan hues toward a lush toy green */
function foliage(c: THREE.Color) {
  c.getHSL(_hsl);
  if (_hsl.h > 0.36 && _hsl.h < 0.56 && _hsl.s > 0.3) c.setHSL(0.3 + (_hsl.h - 0.36) * 0.12, Math.min(1, _hsl.s * 1.15), _hsl.l * 0.7);
}

export class BoardView implements IBoardView {
  /** set false to let the caller own hop / dice-land / whoosh sounds */
  sounds = true;

  private container!: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig = new CameraRig();
  private post!: Post;
  private perf = new PerfWatch();
  private tw = new Tweens();
  private manifest!: AssetManifest;
  private sky!: Sky;
  private sun!: THREE.DirectionalLight;
  private clouds!: THREE.Group;
  private dice!: Dice;
  private token!: Token;
  private buildings!: Buildings;
  private city!: City;
  private fx!: FX;
  private thumbs!: Thumbnails;
  private ready = false;
  private pendingState: Readonly<GameState> | null = null;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private last = 0;
  private cityIndex = 0;
  private lm = Array.from({ length: 5 }, () => ({ stage: 0, damaged: false }));
  private plotKey: string[] = ['', '', '', '', ''];
  private moving = 0;
  private shadowTick = 0;
  private quality: Quality = 'high';
  private w = 1;
  private h = 1;

  // ---------------------------------------------------------------- init
  async init(container: HTMLElement, opts: { onProgress?: (p: number) => void } = {}): Promise<void> {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.info.autoReset = false; // count draw calls over all composer passes (stats)
    r.shadowMap.type = THREE.PCFShadowMap; // r186: PCF with vogel-disk radius = soft
    r.shadowMap.autoUpdate = false; // re-rendered only while something moves (see frame())
    r.shadowMap.needsUpdate = true;
    Object.assign(r.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    container.appendChild(r.domElement);
    this.post = new Post(r, this.scene, this.rig.cam);

    const progress = opts.onProgress ?? (() => {});
    let done = 0, total = 1;
    const track = <T>(p: Promise<T>): Promise<T> => {
      total++;
      return p.finally(() => progress(Math.min(0.97, ++done / total)));
    };
    progress(0);

    const m = (this.manifest = await track(getManifest()));
    const aniso = r.capabilities.getMaxAnisotropy();
    const pbr = (key: string, srgbRepeat = 1): Promise<PBR> => {
      const s = m.textures[key];
      return Promise.all([
        track(loadTexture(s?.color, true, srgbRepeat, aniso)),
        track(loadTexture(s?.normal, false, srgbRepeat, aniso)),
        track(loadTexture(s?.rough, false, srgbRepeat, aniso)),
      ]).then(([color, normal, rough]) => ({ color, normal, rough }));
    };
    const iconKeys: IconKey[] = [...TILE_ICONS, 'construction'];
    const theme = cityTheme(m, this.cityIndex);
    const [, icons, wood, felt, ground, metal, stone, hdr, tokenM, houseM, hotelM, decor] = await Promise.all([
      track(loadFont()),
      Promise.all(iconKeys.map((k) => track(loadImage(icon(k))).then((img) => [k, img] as const))).then((e) => new Map(e)),
      pbr('wood'), pbr('felt'), pbr('ground'), pbr('metal'), pbr('stone'),
      // manifest extra: 1k HDRI for the low tier
      track(loadHDR(this.quality === 'low' ? ((m as AssetManifest & { hdriLow?: string }).hdriLow ?? m.hdri) : m.hdri)),
      track(loadModel(m.models.token, { physical: true })),
      track(loadModel(m.models.house)),
      track(loadModel(m.models.hotel)),
      Promise.all(m.models.decor.map((p) => track(loadModel(p, { grade: foliage })).then((model) => (model ? { path: p, model } : null)))),
      ...theme.landmarks.map((k) => track(this.landmarkModel(k))),
    ]);

    // ---- world
    const fog = new THREE.Fog('#cfefff', 90, 260);
    this.scene.fog = fog;
    this.sky = new Sky(fog);
    this.sky.set(theme.sky[0], theme.sky[1]);
    this.scene.add(this.sky.mesh);
    this.scene.environment = makeEnvironment(r, hdr);
    this.scene.environmentIntensity = 0.6;
    this.sun = makeSun();
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight('#d6ecff', '#8a7650', 0.25));
    this.scene.add(buildIsland(ground, stone));
    this.clouds = buildClouds();
    this.scene.add(this.clouds);
    const decorModels = decor.filter((d): d is { path: string; model: Model } => !!d);
    this.scene.add(scatterDecor(decorModels.length ? decorModels : fallbackDecorModels()));

    // ---- board
    const canvas = drawBoardCanvas(icons, (felt.color?.image as HTMLImageElement) ?? null);
    const tileTex = new THREE.CanvasTexture(canvas);
    tileTex.colorSpace = THREE.SRGBColorSpace;
    tileTex.anisotropy = aniso;
    tileTex.generateMipmaps = true;
    tileTex.minFilter = THREE.LinearMipmapLinearFilter;
    const board = buildBoard(tileTex, { wood, felt, stone, metal });
    this.scene.add(board.group);

    this.buildings = new Buildings(houseM, hotelM);
    this.scene.add(this.buildings.group);

    const markerImg = icons.get('construction');
    const markerTex = markerImg ? new THREE.Texture(markerImg) : null;
    if (markerTex) { markerTex.colorSpace = THREE.SRGBColorSpace; markerTex.needsUpdate = true; }
    this.city = new City(markerTex);
    this.city.onSmoke = (x, y, z) => this.fx.smoke(x, y, z);
    this.scene.add(this.city.group);

    this.fx = new FX(icons.get('coin') ?? null);
    this.scene.add(this.fx.group);

    this.dice = new Dice();
    this.dice.onBounce = (_i, s, p) => {
      if (s > 0.3) this.fx.dust(p.x, PLAZA_TOP + 0.05, p.z, 6, '#ffffff');
      if (this.sounds && s > 0.08) play('dice_land', { volume: Math.min(1, 0.35 + s * 0.6), rate: 0.9 + Math.random() * 0.2 });
    };
    this.scene.add(this.dice.group);

    this.token = new Token(tokenM);
    this.token.onHop = (tile, fast) => {
      const t = TILES[tile];
      this.rig.updateFollowTarget(t.cx, t.cz);
      if (this.sounds) play('hop', { volume: fast ? 0.3 : 0.45, rate: 0.92 + Math.random() * 0.2 });
    };
    this.token.onLand = (p, hard) => this.fx.dust(p.x, TILE_TOP, p.z, hard ? 18 : 8);
    this.scene.add(this.token.root);

    this.thumbs = new Thumbnails(r, this.scene.environment, markerTex);

    this.applyCity(this.cityIndex);

    // ---- size + first compile
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    this.rig.update(0);
    try {
      await r.compileAsync(this.scene, this.rig.cam);
    } catch { /* not fatal */ }
    this.ready = true;
    if (this.quality === 'low') this.setQuality('low');
    if (this.pendingState) this.sync(this.pendingState);
    this.last = performance.now();
    r.setAnimationLoop(() => this.frame());
    progress(1);
  }

  /** GLB from the manifest (with its normalising scale) or a procedural stand-in */
  private landmarkModel(key: string): Promise<LandmarkModel> {
    const e = this.manifest?.models.landmarks[key];
    return loadModel(e?.file).then((model) => (model ? { model, scale: e?.scale } : { model: fallbackLandmark(key) }));
  }

  /** swap the plot models + sky to a city instantly (models may arrive async) */
  private applyCity(city: number) {
    this.cityIndex = city;
    const theme = cityTheme(this.manifest, city);
    this.sky.set(theme.sky[0], theme.sky[1]);
    theme.landmarks.forEach((key, i) => {
      this.plotKey[i] = key;
      void this.landmarkModel(key).then(({ model, scale }) => {
        if (this.plotKey[i] !== key) return;
        this.city.setModel(i, key, model, scale);
        this.city.set(i, this.lm[i].stage, this.lm[i].damaged);
      });
    });
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.w = w; this.h = h;
    this.post.setSize(w, h);
    this.rig.resize(w, h);
  }

  private frame() {
    const now = performance.now();
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(raw, 1 / 20);
    this.tw.update(dt);
    this.dice.update(dt);
    this.token.update(dt);
    this.buildings.update(dt);
    this.city.update(dt);
    this.fx.update(dt);
    this.rig.update(dt);
    this.clouds.rotation.y += dt * 0.004;
    // shadows only change while things animate; refresh at ~2 Hz otherwise (idle bob, flags)
    this.shadowTick++;
    if (this.tw.active || this.dice.rolling || this.token.busy || this.shadowTick % 30 === 0) this.renderer.shadowMap.needsUpdate = true;
    if (this.perf.sample(raw) && this.quality === 'high') {
      console.info(`[board] avg frame ${this.perf.ms.toFixed(1)} ms > 24 ms — switching to low quality`);
      this.setQuality('low');
    }
    this.renderer.info.reset();
    this.post.render();
  }

  // ---------------------------------------------------------------- state
  sync(state: Readonly<GameState>): void {
    if (!this.ready) { this.pendingState = state; return; }
    this.token.place(state.position);
    for (const d of DEFS) if (d.kind === 'property') this.buildings.set(d.index, state.properties[d.index] ?? 0);
    state.landmarks.forEach((l, i) => { this.lm[i] = { stage: l.stage, damaged: l.damaged }; });
    if (state.city !== this.cityIndex || !this.plotKey[0]) this.applyCity(state.city);
    for (let i = 0; i < 5; i++) this.city.set(i, this.lm[i].stage, this.lm[i].damaged);
  }

  playIntro(): Promise<void> {
    if (!this.ready) return Promise.resolve();
    return this.rig.playIntro(5);
  }

  skipIntro(): void {
    this.rig.skipIntro();
  }

  rollDice(d1: number, d2: number): Promise<void> {
    if (!this.ready) return Promise.resolve();
    if (this.rig.view === 'city') void this.setView('board');
    this.dice.meshes.forEach((m) => { m.visible = true; m.scale.setScalar(1); });
    return this.dice.roll(d1, d2);
  }

  async moveToken(path: number[], opts: { fast?: boolean } = {}): Promise<void> {
    if (!this.ready || !path.length) return;
    this.moving++;
    const t = TILES[this.token.tile];
    this.rig.setFollow(true, t.cx, t.cz);
    try {
      await this.token.move(path, !!opts.fast, this.tw);
    } finally {
      this.moving--;
    }
    void this.tw.wait(0.7).then(() => { if (!this.moving) this.rig.setFollow(false); });
  }

  async jumpToken(tile: number): Promise<void> {
    if (!this.ready) return;
    await this.token.jump(tile, this.tw, () => { if (this.sounds) play('whoosh', { volume: 0.7 }); });
  }

  setPropertyLevel(tile: number, level: number): Promise<void> {
    if (!this.ready) return Promise.resolve();
    return this.buildings.animate(tile, level, this.tw, (x, z, big) => {
      this.fx.dust(x, TILE_TOP + 0.05, z, big ? 20 : 12);
      this.fx.sparkle(x, TILE_TOP + 0.6, z, big ? 26 : 14, big ? '#ffd84a' : '#ffffff', big ? 4.5 : 3, 0.35);
    });
  }

  setLandmark(index: number, stage: number, damaged: boolean): Promise<void> {
    if (!this.ready || index < 0 || index > 4) return Promise.resolve();
    this.lm[index] = { stage, damaged };
    return this.city.animate(index, stage, damaged, this.tw, {
      dust: (x, y, z, n, c) => this.fx.dust(x, y, z, n, c),
      sparkle: (x, y, z, n, c, s, sz) => this.fx.sparkle(x, y, z, n, c, s, sz),
      burst: (x, y, z) => {
        this.fx.glow(x, y, z, '#ffd36b', 7);
        this.fx.confetti(x, y + 1, z, 70, 5);
        this.fx.pulse(x, PLAZA_TOP + 0.05, z, 3.2, 3.2, '#ffd84a', 1.2, 1.4, 0.5);
      },
      boom: (x, y, z) => {
        this.fx.dust(x, y, z, 26, '#6b6670');
        this.fx.sparkle(x, y, z, 20, '#ff8a3d', 5, 0.5);
        this.fx.glow(x, y, z, '#ff7a2e', 5);
      },
    });
  }

  async setCity(city: number): Promise<void> {
    if (!this.ready) return;
    const theme = cityTheme(this.manifest, city);
    this.cityIndex = city;
    const models = theme.landmarks.map((k) => this.landmarkModel(k));
    this.sky.beginBlend(theme.sky[0], theme.sky[1]);
    const skyFade = this.tw.run(1.6, (k) => this.sky.blend(k * k * (3 - 2 * k)));
    // shrink the old landmarks away
    const bodies = this.city.plots.map((p) => p.vis.body);
    const from = bodies.map((b) => b.scale.x);
    await this.tw.run(0.35, (k) => bodies.forEach((b, i) => b.scale.setScalar(Math.max(0.001, from[i] * (1 - easeInCubic(k))))));
    const loaded = await Promise.all(models);
    theme.landmarks.forEach((key, i) => {
      this.plotKey[i] = key;
      this.city.setModel(i, key, loaded[i].model, loaded[i].scale);
      this.city.set(i, this.lm[i].stage, this.lm[i].damaged);
    });
    // pop the new ones in, staggered
    const targets = bodies.map((b) => b.scale.x);
    bodies.forEach((b) => b.scale.setScalar(0.001));
    await this.tw.run(0.9, (k) => bodies.forEach((b, i) => {
      const u = Math.min(1, Math.max(0, (k * 0.9 - i * 0.08) / 0.5));
      b.scale.setScalar(Math.max(0.001, targets[i] * easeOutBack(u)));
    }));
    this.city.plots.forEach((p) => this.fx.sparkle(p.pad.position.x, PLAZA_TOP + 1.5, p.pad.position.z, 10, theme.accent, 3, 0.4));
    await skyFade;
  }

  async setView(view: 'board' | 'city'): Promise<void> {
    if (!this.ready) return;
    if (view === this.rig.view) return;
    const dice = this.dice.meshes;
    const s0 = dice[0].scale.x;
    void this.tw.run(0.3, (k) => dice.forEach((m) => {
      const s = view === 'city' ? s0 * (1 - k) : easeOutBack(k);
      m.scale.setScalar(Math.max(0.001, s));
      m.visible = s > 0.01;
    }));
    await this.rig.setView(view, 1.1);
  }

  // ---------------------------------------------------------------- screen helpers
  private toScreen(v: THREE.Vector3) {
    const cam = this.rig.cam;
    cam.updateMatrixWorld();
    v.project(cam);
    const rect = this.renderer?.domElement.getBoundingClientRect() ?? new DOMRect(0, 0, this.w, this.h);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  tileToScreen(tile: number): { x: number; y: number } {
    const t = TILES[((tile % 40) + 40) % 40];
    return this.toScreen(_v.set(t.cx, TILE_TOP + 0.3, t.cz));
  }

  landmarkToScreen(index: number): { x: number; y: number } {
    if (!this.ready) return { x: 0, y: 0 };
    return this.toScreen(this.city.worldTop(Math.max(0, Math.min(4, index)), _v));
  }

  pulseTile(tile: number, color = '#ffe27a'): void {
    if (!this.ready) return;
    const t = TILES[((tile % 40) + 40) % 40];
    this.fx.pulse(t.cx, TILE_TOP + 0.03, t.cz, t.x1 - t.x0 - GAP, t.z1 - t.z0 - GAP, color);
    this.fx.sparkle(t.cx, TILE_TOP + 0.4, t.cz, 10, color, 2.6, 0.32);
  }

  /** extra (not in IBoardView): coins pop out of a tile */
  burstCoins(tile: number): void {
    if (!this.ready) return;
    const t = TILES[((tile % 40) + 40) % 40];
    this.fx.coins(t.cx, TILE_TOP, t.cz, 9);
  }

  /** extra (not in IBoardView): confetti + sparkles over the plaza */
  celebrate(): void {
    if (!this.ready) return;
    this.fx.confetti(0, 2, 0, 140, 8);
    this.fx.glow(0, 3, 0, '#fff1a8', 9);
  }

  /** extra: live perf numbers for dev tools */
  get stats() {
    return { fps: this.perf.fps, ms: this.perf.ms, quality: this.quality, pixelRatio: this.renderer?.getPixelRatio() ?? 1, calls: this.renderer?.info.render.calls ?? 0 };
  }

  setQuality(q: 'high' | 'low'): void {
    this.quality = q;
    if (!this.ready) return;
    this.post.quality = q;
    this.post.apply();
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.radius = q === 'high' ? 3 : 2;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.perf.reset();
    this.resize();
  }

  setInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
    this.insets = { ...insets };
    this.rig.setInsets(this.insets);
  }

  renderLandmarkThumbnail(key: string, stage: number, damaged = false): Promise<string> {
    if (!this.ready) return Promise.resolve('');
    return this.thumbs.get(key, Math.max(0, Math.min(4, stage)), damaged, () => this.landmarkModel(key));
  }
}
