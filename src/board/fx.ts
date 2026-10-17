// Pooled GPU-sprite particles (dust, sparkles, smoke, coins, confetti) and glowing tile pulses.
import * as THREE from 'three';

const N = 640; // per layer (normal + additive) — hard cap

// Camera-facing instanced quads (GL_POINTS are emulated slowly by ANGLE/D3D11 on Intel iGPUs).
const vert = /* glsl */ `
attribute vec3 iPos; attribute vec3 iColor; attribute float iSize; attribute float iAlpha; attribute float iCell; attribute float iRot;
varying vec3 vColor; varying float vAlpha; varying float vCell; varying vec2 vUv;
void main() {
  vColor = iColor; vAlpha = iAlpha; vCell = iCell;
  float c = cos(iRot), s = sin(iRot);
  vec2 q = position.xy;
  vUv = q + 0.5;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float sz = iAlpha <= 0.0 ? 0.0 : iSize;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * sz;
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */ `
uniform sampler2D uMap; uniform float uAdd;
varying vec3 vColor; varying float vAlpha; varying float vCell; varying vec2 vUv;
void main() {
  vec2 pc = vec2(vUv.x, 1.0 - vUv.y);
  float cx = mod(vCell, 2.0), cy = floor(vCell / 2.0);
  vec4 t = texture2D(uMap, vec2((cx + pc.x) * 0.5, 1.0 - (cy + pc.y) * 0.5));
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = t.rgb * vColor;
  gl_FragColor = uAdd > 0.5 ? vec4(col * a, a) : vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const CELL = { soft: 0, star: 1, coin: 2, smoke: 3 } as const;

function atlas(coinImg: HTMLImageElement | null): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const ctx = cv.getContext('2d')!;
  // 0 soft blob
  let g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // 1 sparkle star
  ctx.save();
  ctx.translate(S * 1.5, S / 2);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-S / 2, -S / 2, S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? S * 0.48 : S * 0.07;
    const a = (i / 8) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // 2 coin
  if (coinImg) ctx.drawImage(coinImg, 4, S + 4, S - 8, S - 8);
  else {
    ctx.fillStyle = '#ffc62e';
    ctx.beginPath(); ctx.arc(S / 2, S * 1.5, S * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d98b00'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#fff2a8'; ctx.beginPath(); ctx.arc(S * 0.4, S * 1.38, S * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  // 3 smoke puff
  ctx.save();
  ctx.translate(S, S);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = S / 2 + Math.cos(a) * S * 0.16, y = S / 2 + Math.sin(a) * S * 0.16;
    const r = S * (0.22 + (i % 3) * 0.04);
    g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Layer {
  readonly points: THREE.Mesh;
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private size = new Float32Array(N);
  private alpha = new Float32Array(N);
  private cell = new Float32Array(N);
  private rot = new Float32Array(N);
  private life = new Float32Array(N);
  private maxLife = new Float32Array(N);
  private s0 = new Float32Array(N);
  private s1 = new Float32Array(N);
  private a0 = new Float32Array(N);
  private grav = new Float32Array(N);
  private drag = new Float32Array(N);
  private spin = new Float32Array(N);
  private twinkle = new Uint8Array(N);
  private next = 0;
  private live = 0;
  private geo = new THREE.InstancedBufferGeometry();

  constructor(map: THREE.Texture, additive: boolean) {
    const g = this.geo;
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const inst = (a: Float32Array, n: number) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', inst(this.pos, 3));
    g.setAttribute('iColor', inst(this.col, 3));
    g.setAttribute('iSize', inst(this.size, 1));
    g.setAttribute('iAlpha', inst(this.alpha, 1));
    g.setAttribute('iCell', inst(this.cell, 1));
    g.setAttribute('iRot', inst(this.rot, 1));
    g.instanceCount = N;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Mesh(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    c: THREE.Color, life: number, s0: number, s1: number, a0: number, cell: number,
    grav: number, drag: number, spin: number, twinkle = false,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.life[i] = 0; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.cell[i] = cell; this.grav[i] = grav; this.drag[i] = drag;
    this.spin[i] = spin; this.rot[i] = Math.random() * 6.28;
    this.twinkle[i] = twinkle ? 1 : 0;
    this.size[i] = s0; this.alpha[i] = a0;
    this.live = 2; // keep updating for a couple of frames at least
  }

  update(dt: number) {
    if (this.live <= 0) return;
    let any = false;
    for (let i = 0; i < N; i++) {
      if (this.alpha[i] <= 0) continue;
      const l = (this.life[i] += dt);
      const m = this.maxLife[i];
      if (l >= m) { this.alpha[i] = 0; continue; }
      any = true;
      const k = l / m, i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 2] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.3 && this.vel[i3 + 1] < 0 && this.cell[i] === CELL.coin) {
        this.pos[i3 + 1] = 0.3; this.vel[i3 + 1] *= -0.35;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      let a = this.a0[i] * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      if (this.twinkle[i]) a *= 0.65 + 0.35 * Math.sin(l * 40 + i);
      this.alpha[i] = Math.max(a, 1e-4);
      this.rot[i] += this.spin[i] * dt;
    }
    const g = this.geo.attributes;
    g.iPos.needsUpdate = true;
    g.iColor.needsUpdate = true;
    g.iSize.needsUpdate = true;
    g.iAlpha.needsUpdate = true;
    g.iCell.needsUpdate = true;
    g.iRot.needsUpdate = true;
    this.live = any ? 2 : this.live - 1;
  }
}

// ------------------------------------------------------------------ pulse rings
const ringVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ringFrag = /* glsl */ `
uniform vec3 color; uniform float opacity; uniform vec2 size; uniform float radius;
varying vec2 vUv;
float sdRR(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * size;
  float d = sdRR(p, size * 0.5 - 0.42, radius);
  float ring = exp(-abs(d) * 9.0) + exp(-abs(d) * 2.5) * 0.35;
  float fill = smoothstep(0.1, -0.8, d) * 0.22;
  float a = (ring + fill) * opacity;
  gl_FragColor = vec4(color * a, a);
}`;

interface Pulse { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; dur: number; active: boolean; grow: number }

export class FX {
  readonly group = new THREE.Group();
  private normal: Layer;
  private add: Layer;
  private pulses: Pulse[] = [];
  private c = new THREE.Color();
  private plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(coinImg: HTMLImageElement | null) {
    const map = atlas(coinImg);
    this.normal = new Layer(map, false);
    this.add = new Layer(map, true);
    this.group.add(this.normal.points, this.add.points);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 }, size: { value: new THREE.Vector2(1, 1) }, radius: { value: 0.3 } },
        vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.pulses.push({ mesh, mat, t: 0, dur: 1, active: false, grow: 0.1 });
    }
  }

  pulse(x: number, y: number, z: number, w: number, d: number, color: string | THREE.Color, dur = 1.1, radius = 0.3, grow = 0.12, boost = 2.2) {
    const p = this.pulses.find((q) => !q.active) ?? this.pulses[0];
    p.active = true; p.t = 0; p.dur = dur; p.grow = grow;
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.scale.set(w + 0.84, 1, d + 0.84);
    (p.mat.uniforms.size.value as THREE.Vector2).set(w + 0.84, d + 0.84);
    p.mat.uniforms.radius.value = radius;
    (p.mat.uniforms.color.value as THREE.Color).set(color).multiplyScalar(boost);
  }

  dust(x: number, y: number, z: number, n = 14, color = '#fff3df') {
    this.c.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.2;
      this.normal.spawn(x + Math.cos(a) * 0.2, y + 0.1, z + Math.sin(a) * 0.2, Math.cos(a) * s, 0.5 + Math.random() * 1.1, Math.sin(a) * s,
        this.c, 0.55 + Math.random() * 0.4, 0.45, 1.3 + Math.random() * 0.5, 0.75, CELL.smoke, -0.6, 3.2, (Math.random() - 0.5) * 2);
    }
  }

  sparkle(x: number, y: number, z: number, n = 16, color = '#ffe27a', speed = 3.5, size = 0.42) {
    this.c.set(color).multiplyScalar(2.2);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.8);
      this.add.spawn(x, y, z, Math.cos(a) * r * s, Math.abs(u) * s + 1.8, Math.sin(a) * r * s,
        this.c, 0.55 + Math.random() * 0.5, size * (0.8 + Math.random() * 0.6), 0.05, 1, CELL.star, -5, 1.6, (Math.random() - 0.5) * 6, true);
    }
  }

  glow(x: number, y: number, z: number, color = '#ffd36b', size = 4) {
    this.c.set(color).multiplyScalar(1.6);
    this.add.spawn(x, y, z, 0, 0, 0, this.c, 0.45, size * 0.3, size, 0.9, CELL.soft, 0, 0, 0);
  }

  /** damaged-landmark smoke column with the odd ember */
  smoke(x: number, y: number, z: number, dark = true) {
    this.c.set(dark ? '#3b3840' : '#d9d4cc');
    this.normal.spawn(x + (Math.random() - 0.5) * 0.9, y, z + (Math.random() - 0.5) * 0.9,
      (Math.random() - 0.5) * 0.3 + 0.3, 1.1 + Math.random() * 0.7, (Math.random() - 0.5) * 0.3,
      this.c, 1.9 + Math.random() * 0.8, 0.9, 3.0, 0.85, CELL.smoke, 0.2, 0.4, (Math.random() - 0.5) * 0.8);
    if (dark && Math.random() < 0.35) {
      this.c.set('#ff7a2e').multiplyScalar(2.5);
      this.add.spawn(x + (Math.random() - 0.5) * 0.8, y - 0.3, z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6,
        this.c, 0.8 + Math.random() * 0.5, 0.22, 0.05, 1, CELL.soft, 0.5, 0.8, 0, true);
    }
  }

  coins(x: number, y: number, z: number, n = 8) {
    this.c.setRGB(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 1.6;
      this.normal.spawn(x, y + 0.2, z, Math.cos(a) * s, 6 + Math.random() * 3, Math.sin(a) * s,
        this.c, 0.9 + Math.random() * 0.3, 0.62, 0.55, 1, CELL.coin, -16, 0.6, (Math.random() - 0.5) * 8);
    }
    this.sparkle(x, y + 0.6, z, 8, '#ffd84a', 3, 0.35);
  }

  confetti(x: number, y: number, z: number, n = 90, spread = 6) {
    const palette = ['#ff3d4f', '#ffcc2e', '#39d353', '#2f8bff', '#ec4fae', '#8d4dff', '#ffffff'];
    for (let i = 0; i < n; i++) {
      this.c.set(palette[i % palette.length]);
      const a = Math.random() * Math.PI * 2, s = Math.random() * spread;
      this.normal.spawn(x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3, Math.cos(a) * s, 6 + Math.random() * 6, Math.sin(a) * s,
        this.c, 1.6 + Math.random() * 1.2, 0.22 + Math.random() * 0.12, 0.2, 1, CELL.soft, -7, 1.4, (Math.random() - 0.5) * 10);
    }
    this.sparkle(x, y + 1, z, 30, '#fff1a8', 6, 0.5);
  }

  update(dt: number) {
    this.normal.update(dt);
    this.add.update(dt);
    for (const p of this.pulses) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / p.dur;
      if (k >= 1) { p.active = false; p.mesh.visible = false; continue; }
      const env = k < 0.18 ? k / 0.18 : 1 - (k - 0.18) / 0.82;
      p.mat.uniforms.opacity.value = env * (0.85 + 0.15 * Math.sin(p.t * 18));
      const s = 1 + p.grow * k;
      const sz = p.mat.uniforms.size.value as THREE.Vector2;
      p.mesh.scale.set(sz.x * s, 1, sz.y * s);
    }
  }
}
