import type { AssetManifest, CityTheme } from '../contract';

export const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;
export const icon = (key: string) => asset(`icons/${key}.png`);
export const stickerImg = (id: string) => asset(`stickers/${id}.png`);

let cached: Promise<AssetManifest> | null = null;
export function loadManifest(): Promise<AssetManifest> {
  return (cached ??= fetch(asset('manifest.json')).then((r) => r.json()));
}

export const cityTheme = (m: AssetManifest, city: number): CityTheme => m.cities[city % m.cities.length];
