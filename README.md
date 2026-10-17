# Dice Empire

An original 3D browser board game built on the gameplay loop of MONOPOLY GO!, the #2 top-grossing game on Google Play in 2026 behind Roblox, which is a platform and can't be rebuilt. All names and art are original or CC0/MIT; see `CREDITS.md`.

```sh
npm install                      # .npmrc sets legacy-peer-deps (npm 10.9 peer-dep crash)
npm run dev                      # http://localhost:5300
npm run build                    # typecheck + production build → dist/
npm test                         # rules engine, board math, formatting
```

**Play:** tap GO (or press Space) to roll, and hold GO for auto-roll. The multiplier pill bets more dice for more coins. Landing on properties buys and upgrades them. Rails start a Heist (vault doors, match 3) or a Raid (aim and fire at a rival's city). Spend coins in **Build** to raise your city's 5 landmarks; finishing them moves you to the next city. Sticker packs fill the **Album**. Shields block rival raids. Dice refill +1 every 90 s, and there's a free gift every hour. Progress saves to localStorage.

**Code:** `src/contract.ts` is the interface between the modules:
- `src/core/`: the rules, a pure and seeded engine with tests.
- `src/board/`: the three.js board.
- `src/ui/`: the HUD and the event Director; `src/ui/screens/` holds heist, raid, build, album and packs.
- `public/assets/`: the HD textures, HDRI, models, audio, icons and fonts, described in `manifest.json`.

`SPEC.md` has the full rules.

Dev harnesses: `/board-test.html` (3D board) and `/screens-test.html` (minigames).
