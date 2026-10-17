// Pure number/time formatting (no DOM) so it can be unit-tested.

const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];

/** Compact: 950, 1.2K, 12.5K, 125K, 3.4M, 1.2B. Truncates (never shows "1000K"). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  let v = Math.abs(n);
  if (v < 1000) return sign + Math.floor(v + 1e-9);
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i++; }
  const s = v >= 100 ? Math.floor(v + 1e-9) : Math.floor(v * 10 + 1e-9) / 10;
  return sign + s + UNITS[i];
}

/** HUD counter: full digits with commas while they fit, compact beyond 10M. */
export function fmtCounter(n: number): string {
  return Math.abs(n) < 1e7 ? Math.round(n).toLocaleString('en-US') : fmt(n);
}

/** 0:42, 12:05, 1:02:03 */
export function fmtTime(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "just now", "5m ago", "3h ago", "2d ago" */
export function fmtAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** 6..20 coin sprites, growing with log(amount). */
export const coinSprites = (amount: number) =>
  Math.max(6, Math.min(20, Math.round(6 + 2.2 * Math.log10(Math.max(1, Math.abs(amount) / 100)))));

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export const possessive =(name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
