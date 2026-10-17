# DICE EMPIRE — build spec

An original browser game built on the loop of **MONOPOLY GO!**, the #2 top-grossing game on Google Play
in Aug 2026 behind Roblox, a platform that can't be cloned. All names, art and branding are original
or CC0/MIT-licensed. **Never** use Hasbro/Monopoly/Scopely names, logos, characters (no "Mr. Monopoly",
"Boardwalk", "Park Place", "Community Chest") or any ripped assets.

Quality bar: this must feel like a shipped premium casual mobile game. It is not a prototype. Bright,
saturated, toy-like 3D board, chunky glossy UI, juicy feedback on every action (sound, particles,
count-ups, squash/stretch), 60 fps on a mid laptop, and it must also work in phone portrait (390×844).

## Stack
Vite 8 + TypeScript (strict) + three 0.186 (use `three/addons/...` for GLTFLoader, HDRLoader/RGBELoader,
EffectComposer, RoundedBoxGeometry etc.). Use no other runtime deps. Tests use vitest. **Do not run
`npm install` or edit package.json.** If you truly need a tool, install it outside the project in the
session scratchpad. Each agent's dev server gets its own port (below).

## Shared, frozen files (owned by the orchestrator)
- `src/contract.ts`: all cross-module types and APIs. Read it first, then code against it exactly.
- `src/shared/board-data.ts`: the 40 tiles, group colors and tiers. `src/shared/stickers.ts`: the album.
- `src/shared/manifest.ts`: asset URL helpers and `loadManifest()`. `src/audio/sfx.ts`: `play(key)`, music.
- `src/styles/tokens.css`: design tokens plus `.btn`, `.btn-go`, `.panel` and the other shared classes.

## Ownership (touch only your own files)
| agent | owns | dev port |
|---|---|---|
| core | `src/core/**` (incl. `*.test.ts`) | — |
| board | `src/board/**`, `board-test.html` | 5301 |
| ui-shell | `index.html`, `src/main.ts`, `src/ui/*.ts|css` (not screens/) | 5302 |
| ui-screens | `src/ui/screens/**`, `screens-test.html` | 5303 |
| assets | `public/assets/**`, `CREDITS.md` | — |

## Asset conventions (all under `public/assets/`, referenced via `asset('…')` from manifest.ts)
- `manifest.json`: matches `AssetManifest` in contract.ts. Paths inside it are relative to `assets/`.
- `icons/<IconKey>.png`: Fluent Emoji 3D, 256px, for every IconKey in contract.ts.
- `stickers/<id>.png`: Fluent Emoji 3D for every sticker in stickers.ts.
- `audio/<SoundKey>.ogg`: every SoundKey; `music.ogg` is a seamless loop.
- `fonts/LilitaOne-Regular.woff2`, `fonts/Nunito-Variable.woff2`.
- `hdri/*.hdr` (≤2k), `textures/<set>/{color,normal,rough}.jpg` (2k), `models/**/*.glb`.
- Licenses: CC0 preferred, MIT/OFL/CC-BY acceptable. Every item is credited in `CREDITS.md`.

## Game rules (core implements, everyone else relies on them)
Let `S = scale(city)`, a coin unit that grows per city (≈ ×1.6 per city), and `m` = multiplier.
- **Start**: 2,000 coins (scaled), 50 dice, diceMax 50, 0 shields, city 0, tile 0. Free gift claimable now.
- **Dice regen**: +1 die every 90 s while `dice < diceMax`. Offline regen is applied on load/tick.
- **Multipliers** `[1,2,3,5,10,20,50,100]`: m>1 available iff `dice >= 5m`. A roll costs m dice, a free roll costs 0. If the selected m stops being available, it drops to the highest available.
- **Doubles** grant 1 free roll at the same m. A 3rd consecutive double sends you to jail.
- **GO**: pass = salary 2·S·m; land exactly = 4·S·m.
- **Property**: each landing upgrades it one level, 0→1 (bought) → 2,3,4 (houses) → 5 (hotel) and pays rent for the new level (`rentFor`). Rent grows with level and tier. The first time a whole color group is owned, a `setComplete 'set'` reward fires. The first time the whole group has hotels, `setComplete 'hotels'` fires with a bigger reward plus a pack.
- **Rail**: 50/50 Heist or Raid minigame (`pending`). Roll is blocked until it's resolved.
  - **Heist**: 12 hidden doors with a biased gold/silver/bronze mix. Open doors until 3 of a kind match; bronze/silver/gold pay ≈ 4/8/15·S·m.
  - **Raid**: a rival's 5 landmarks. `raidShoot(i)`: -1 = miss (≈1·S·m); rival shield → blocked (shield −1, ≈2·S·m); otherwise a hit damages that landmark (≈6·S·m).
- **Utility**: (d1+d2)·k·S·m. **Tax**: lose a scaled amount, never below 0 coins. **Lucky Park**: coins plus a 25% shield chance.
- **Chance / Gift Box decks**: coins, dice, shield (coins if already at 3), packs, advance to GO / to a rail, move back 3, go to jail, instant heist/raid. Always emit a `card` event first, then the effects' events.
- **Jail**: Go To Jail → `jail` event, position 10, 3 attempts. In jail a roll costs dice as usual: doubles = escape and move. After the 3rd fail you're released and move anyway.
- **Shields**: max 3. They block inbound rival raids.
- **Landmarks**: 5 per city × 4 stages, built in any order with coins. Stage costs rise per stage, landmark and city. A damaged landmark must be repaired (≈50% of its last stage cost) before its next stage. All 5 at stage 4 → `cityComplete` (dice, coins, gold pack) → `newCity` (properties reset, landmarks reset, S grows).
- **Stickers**: pack tier T gives T+1 stickers (min 2) and guarantees ≥1 sticker of ≥T stars. Draws are weighted toward low stars. Completing a set pays its `rewardDice` plus coins.
- **Rivals**: 8 seeded AI rivals with original names and avatar_* icons, cities near yours, who slowly build and gain coins. After each roll there's a ~4% chance of an inbound raid (shield blocks it, else a random built landmark is damaged) or heist (lose 5–12% of coins, capped). These come as `attacked` events plus news.
- **Gift**: every 60 min, ≈10 dice + coins, sometimes a pack.
- **Balance target**: a bot playing x1 completes city 0 in ~150–250 rolls; later cities take slightly longer.
- Seeded PRNG in state, so the same seed and actions give the same result. `save()`/`createGame(json)` round-trip, and corrupt saves start a new game.

## Presentation flow
`main.ts` boots: manifest → `new BoardView().init()` with a progress bar → `createGame(localStorage)` → title
screen (PLAY unlocks audio and starts music) → `board.playIntro()` → HUD. Pressing GO (or Space; hold for
auto-roll) calls `game.roll()` and the **Director** plays each event with board animations and DOM effects.
`pending` hands off to `runHeist`/`runRaid`, a `stickers` event to `showPackOpening`, the Build button to
`openBuild`, the Album button to `openAlbum`. The game saves to localStorage (`dice-empire-save`, guarded
with try/catch) after every resolved action.
