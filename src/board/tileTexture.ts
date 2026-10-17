// Draws the 40 printed tiles onto one 4096² canvas (top-down map, north = canvas top).
// Every label is drawn upright for the default (south) camera, so all four sides read naturally.
import type { IconKey, TileDef } from '../contract';
import { BOARD as TILE_DEFS, GROUP_COLORS } from '../shared/board-data';
import { BAND, BOARD, HALF, TILES, type TileRect } from './layout';
import { FONT_STACK } from './assets';

export const TEX_SIZE = 4096;
const PPU = TEX_SIZE / BOARD; // px per world unit

const EMOJI: Partial<Record<IconKey, string>> = {
  go: '🏁', gift: '🎁', chance: '❓', rail: '🚂', power: '⚡', water: '💧', tax: '💰',
  jail: '🔒', park: '🍀', gotojail: '👮', construction: '🚧', coin: '🪙', clover: '🍀',
};

const BODY: Record<string, [string, string]> = {
  property: ['#fffdf6', '#f4e7cf'],
  chance: ['#fff1b8', '#ffd66b'],
  chest: ['#d9f8cf', '#9fe58f'],
  rail: ['#eef2fa', '#c9d3e6'],
  utility: ['#dff4ff', '#a8dcff'],
  tax: ['#ffe2e0', '#ffb3ae'],
  go: ['#5fe07f', '#16a64a'],
  jail: ['#ffc677', '#ff8a2b'],
  park: ['#c9f27a', '#5fc23d'],
  gotojail: ['#9cc8ff', '#3d7cf0'],
};

const INK = '#22305a';

export type IconMap = Map<IconKey, HTMLImageElement | null>;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** balanced 1–2 line split */
function splitName(name: string): string[] {
  const words = name.split(' ');
  if (words.length < 2) return [name];
  let best = [name], bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(a.length, b.length);
    if (w < bestW) { bestW = w; best = [a, b]; }
  }
  return best;
}

function drawText(
  ctx: CanvasRenderingContext2D, lines: string[], cx: number, cy: number, maxW: number, maxH: number,
  maxPx: number, fill: string, stroke?: string,
) {
  let px = maxPx;
  ctx.font = `${px}px ${FONT_STACK}`;
  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l).width));
  while (px > 12 && (widest() > maxW || px * 1.02 * lines.length > maxH)) {
    px -= 2;
    ctx.font = `${px}px ${FONT_STACK}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lh = px * 1.02;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    const y = y0 + i * lh + px * 0.04;
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = px * 0.2;
      ctx.strokeText(l, cx, y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillText(l, cx, y + px * 0.08);
    }
    ctx.fillStyle = fill;
    ctx.fillText(l, cx, y);
  });
}

function drawIcon(ctx: CanvasRenderingContext2D, icons: IconMap, key: IconKey, cx: number, cy: number, size: number, rot = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  // soft contact shadow under the sticker-like icon
  ctx.fillStyle = 'rgba(30,20,60,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.42, size * 0.36, size * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  const img = icons.get(key);
  if (img) {
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    ctx.font = `${Math.round(size * 0.8)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(EMOJI[key] ?? '★', 0, size * 0.05);
  }
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, th: number) {
  // points west (−x), the direction tokens leave GO
  const hx = cx - len / 2, tx = cx + len / 2, head = th * 1.25;
  ctx.beginPath();
  ctx.moveTo(hx, cy);
  ctx.lineTo(hx + head, cy - th);
  ctx.lineTo(hx + head, cy - th * 0.45);
  ctx.lineTo(tx, cy - th * 0.45);
  ctx.lineTo(tx, cy + th * 0.45);
  ctx.lineTo(hx + head, cy + th * 0.45);
  ctx.lineTo(hx + head, cy + th);
  ctx.closePath();
}

function tilePx(t: TileRect) {
  return {
    x: (t.x0 + HALF) * PPU, y: (t.z0 + HALF) * PPU,
    w: (t.x1 - t.x0) * PPU, h: (t.z1 - t.z0) * PPU,
  };
}

function drawTile(ctx: CanvasRenderingContext2D, def: TileDef, t: TileRect, icons: IconMap) {
  const { x, y, w, h } = tilePx(t);
  const pad = 0.16 * PPU; // keep artwork off the bevelled edge
  const [c0, c1] = BODY[def.kind] ?? BODY.property;

  // body
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // soft inner vignette for a moulded feel
  const vg = ctx.createRadialGradient(x + w / 2, y + h * 0.4, Math.min(w, h) * 0.2, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(255,255,255,0.18)');
  vg.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = vg;
  ctx.fillRect(x, y, w, h);

  // free area (excluding the colour band for properties)
  let ax = x + pad, ay = y + pad, aw = w - pad * 2, ah = h - pad * 2;

  if (def.kind === 'property' && def.group) {
    const col = GROUP_COLORS[def.group];
    const b = BAND * PPU;
    let bx = x, by = y, bw = w, bh = h;
    if (t.inZ < 0) { bh = b; ay = y + b + pad * 0.6; ah = h - b - pad * 1.6; }               // band on north edge
    else if (t.inZ > 0) { by = y + h - b; bh = b; ah = h - b - pad * 1.6; }               // band on south edge
    else if (t.inX > 0) { bx = x + w - b; bw = b; aw = w - b - pad * 1.6; }               // band on east edge
    else { bw = b; ax = x + b + pad * 0.6; aw = w - b - pad * 1.6; }                      // band on west edge
    const bg = ctx.createLinearGradient(bx, by, bx, by + bh);
    bg.addColorStop(0, shade(col, 0.28));
    bg.addColorStop(0.5, col);
    bg.addColorStop(1, shade(col, -0.18));
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, bw, bh);
    // glossy highlight + separator line
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    rr(ctx, bx + bw * 0.08, by + bh * 0.1, bw * 0.84, bh * 0.22, bh * 0.1);
    ctx.fill();
    ctx.fillStyle = shade(col, -0.35);
    if (t.inZ < 0) ctx.fillRect(bx, by + bh - 5, bw, 5);
    else if (t.inZ > 0) ctx.fillRect(bx, by, bw, 5);
    else if (t.inX > 0) ctx.fillRect(bx, by, 5, bh);
    else ctx.fillRect(bx + bw - 5, by, 5, bh);

    drawText(ctx, splitName(def.name.toUpperCase()), ax + aw / 2, ay + ah * 0.5, aw, ah * 0.78, 66, INK);
    return;
  }

  if (t.corner) {
    const cx = x + w / 2, cy = y + h / 2;
    if (def.kind === 'go') {
      drawText(ctx, ['GO'], cx, cy - h * 0.12, w * 0.8, h * 0.45, 230, '#ffffff', '#0d5a26');
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0d5a26';
      ctx.lineWidth = 12;
      ctx.lineJoin = 'round';
      arrow(ctx, cx, cy + h * 0.25, w * 0.66, h * 0.09);
      ctx.stroke();
      ctx.fill();
      drawText(ctx, ['COLLECT SALARY'], cx, cy + h * 0.4, w * 0.8, h * 0.08, 38, '#ffffff', '#0d5a26');
      drawIcon(ctx, icons, 'coin', x + w * 0.18, y + h * 0.17, w * 0.2, -0.3);
      drawIcon(ctx, icons, 'coin', x + w * 0.83, y + h * 0.15, w * 0.16, 0.35);
    } else {
      const label = def.kind === 'gotojail' ? ['GO TO', 'JAIL'] : def.kind === 'park' ? ['LUCKY', 'PARK'] : ['JAIL'];
      const stroke = def.kind === 'jail' ? '#8a3a00' : def.kind === 'park' ? '#2c6d12' : '#173a8a';
      drawIcon(ctx, icons, def.icon ?? 'star', cx, cy - h * 0.12, w * 0.5);
      drawText(ctx, label, cx, cy + h * 0.28, w * 0.84, h * 0.34, 110, '#ffffff', stroke);
    }
    return;
  }

  // icon tiles (chance / gift / rail / utility / tax)
  const vertical = h > w; // bottom/top rows are tall in canvas space
  const iconSize = Math.min(aw, ah) * (vertical ? 0.82 : 0.72);
  if (vertical) {
    drawIcon(ctx, icons, def.icon ?? 'star', ax + aw / 2, ay + ah * 0.38, iconSize);
    drawText(ctx, splitName(def.name.toUpperCase()), ax + aw / 2, ay + ah * 0.84, aw, ah * 0.28, 52, INK);
  } else {
    drawIcon(ctx, icons, def.icon ?? 'star', ax + aw * 0.3, ay + ah / 2, iconSize * 0.95);
    drawText(ctx, splitName(def.name.toUpperCase()), ax + aw * 0.74, ay + ah / 2, aw * 0.46, ah * 0.8, 50, INK);
  }
}

export function drawBoardCanvas(icons: IconMap, felt: HTMLImageElement | null): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d')!;
  // felt shows only on the tile side walls' far edges; keep it dark and calm
  ctx.fillStyle = '#16365a';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  if (felt) {
    ctx.globalAlpha = 0.25;
    for (let yy = 0; yy < TEX_SIZE; yy += 1024) for (let xx = 0; xx < TEX_SIZE; xx += 1024) ctx.drawImage(felt, xx, yy, 1024, 1024);
    ctx.globalAlpha = 1;
  }
  for (const t of TILES) drawTile(ctx, TILE_DEFS[t.index], t, icons);
  return cv;
}

export const TILE_ICONS: IconKey[] = ['go', 'gift', 'chance', 'rail', 'power', 'water', 'tax', 'jail', 'park', 'gotojail', 'coin'];
