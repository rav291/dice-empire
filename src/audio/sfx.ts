import type { SoundKey } from '../contract';

// Web Audio player. Call unlockAudio() from the first user gesture (PLAY button).
const ctx = new AudioContext();
const master = ctx.createGain();
const sfxBus = ctx.createGain();
const musicBus = ctx.createGain();
sfxBus.connect(master);
musicBus.connect(master);
master.connect(ctx.destination);
musicBus.gain.value = 0.35;

const buffers = new Map<SoundKey, Promise<AudioBuffer | null>>();
let musicNode: AudioBufferSourceNode | null = null;

function load(key: SoundKey) {
  let p = buffers.get(key);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}assets/audio/${key}.ogg`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null); // missing sound = silent, never crash the game
    buffers.set(key, p);
  }
  return p;
}

export function preloadAudio(keys: SoundKey[]) {
  return Promise.all(keys.map(load));
}

export function unlockAudio() {
  if (ctx.state !== 'running') void ctx.resume();
}

export function play(key: SoundKey, opts: { volume?: number; rate?: number } = {}) {
  void load(key).then((buf) => {
    if (!buf || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    g.gain.value = opts.volume ?? 1;
    src.connect(g).connect(sfxBus);
    src.start();
  });
}

export async function startMusic() {
  if (musicNode) return;
  const buf = await load('music');
  if (!buf || musicNode) return;
  musicNode = ctx.createBufferSource();
  musicNode.buffer = buf;
  musicNode.loop = true;
  musicNode.connect(musicBus);
  musicNode.start();
}

export function setSfxEnabled(on: boolean) { sfxBus.gain.value = on ? 1 : 0; }
export function setMusicEnabled(on: boolean) { musicBus.gain.value = on ? 0.35 : 0; }
