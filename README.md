# GreenHood 64

A first-person Robin Hood stealth-archer dungeon crawler built with **Babylon.js**, **TypeScript**, **Vite** and **pnpm**.

You raid a randomly generated two-floor castle, steal gold from chests and vaults, hunt the king for crowns, and extract back through the entrance to bank your loot. Between runs, spend gold and crowns at a fixed Sherwood forest camp on better bows, abilities and training.

## Status

Non-combat base pass complete. Playable loop taking shape:

- **Sherwood camp** (fixed hub): a forest clearing with a path, a stone castle keep, gatehouse and towers, plus four merchant stalls (Bows, Abilities, Training, Crowns). A subdued overcast sky with soft clouds and a diffuse sun.
- **First-person controller**: pointer lock, WASD, sprint, crouch, head bob, plus a visible equipped bow. Movement resolves against a reusable 2D collision system with per-storey vertical spans.
- **Progression**: gold (bows, training, gold abilities) and crowns (elite abilities), saved to `localStorage`.
- **Castle run**: seeded two-floor dungeon with rooms, corridors, a real walkable staircase, chests, keys and a locked vault. Black sky, torch lighting. Enter from the gate, take the stairs between floors, and leave through the entrance to bank your run gold.
- **Looting**: chests and keys are collected and removed from the world; chests are scaled to a readable size, and stone columns reach the ceiling and block movement.
- **Combat (first pass)**: chargeable physical arrows, RMB aim/zoom, guards with vision cones + hearing + alert propagation, patrol/investigate/chase/search states, spear attacks, player health/damage/death, and crouched rear takedowns.
- **Combat consequences**: guards hit for 25 damage (four hits at base health); dying loses run gold and keys and returns you to Sherwood.

Next up: king and bodyguards, abilities in combat, light/shadow stealth, and audio.

## Base pass fixes

- Replaced the stair teleporter with a real walkable staircase and floor-height ramp.
- Corrected stair orientation, shaft walls, and collision so both floors remain traversable.
- Fixed first-floor ceiling / second-floor floor z-fighting.
- Corrected the dungeon playable bounds, removing the invisible wall around the castle edge.
- Aligned the castle exit door with the back wall and its collision plane.
- Fixed chest/key collection so picked-up meshes disappear.
- Scaled up chests, stretched columns to the ceiling, and gave columns collision.
- Added the Sherwood castle facade and the visible bow viewmodel.

## Requirements

- Node.js >= 20.19
- pnpm 11
- Optional: Blender (only to regenerate the custom guard/bow exports)

## Run it

```bash
pnpm install
pnpm assets:prepare   # copy Kenney GLBs into public/assets (once, or after changing Assets/)
pnpm assets:models    # optional: re-export guard.glb + bow-tier-*.glb with Blender
pnpm dev
```

Open the printed URL. Add `?debug=1` for the debug HUD, or `?view=assets` for the development asset viewer.

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look | Mouse |
| Sprint | `Shift` |
| Crouch | `Ctrl` |
| Charge / fire bow | Hold / release `LMB` |
| Aim / zoom | `RMB` |
| Takedown guard | `E` while crouched behind an unaware guard |
| Interact / shop / enter castle | `E` |
| Pause / recapture mouse | `Esc` (or click) |

## Debug and dev tools

| URL / command | Purpose |
| --- | --- |
| `?debug=1` | Draw the debug HUD (seed, state, position, FPS, combat) |
| `?view=assets` | Development asset viewer (every kit + custom model on a grid) |
| `?castle=1` | Boot straight into a castle run |
| `?castle=1&at=vault` | Spawn inside the vault |
| `?castle=1&at=guard` | Spawn near the first guard |
| `?god` | Disable player damage (debug) |
| `scripts/shot.sh <url> <out.png>` | Headless screenshot helper (Firefox + geckodriver) |
| `scripts/eval.sh <url> <js>` | Evaluate JS in the running page (debugging) |


## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server with hot reload |
| `pnpm build` | Type-check then produce a production build in `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm test` | Run the Vitest logic tests |
| `pnpm typecheck` | TypeScript only |
| `pnpm assets:prepare` | Copy runtime GLBs/textures from `Assets/` to `public/assets/` |
| `pnpm assets:models` | Re-export the custom guard and bow models with Blender |

## Project layout

```
src/
  app/      application state, save data
  core/     engine-independent logic (rng, collision, dungeon gen, shop)
  world/    Babylon scene builders (hub, castle, skybox) and asset loading
  gameplay/ first-person player controller
  ui/       HTML/CSS overlays (HUD, shop)
scripts/    asset preparation, Blender exports, headless dev helpers
tests/      Vitest logic tests
```


## Source assets

The reference art lives in `Assets/Models/` and is never modified. `pnpm assets:prepare` selectively copies only the runtime files (GLB + textures) into `public/assets/kenney/`, and the Blender script writes generated models into `public/assets/custom/`.

- **Kenney** — Fantasy Town Kit, Mini Dungeon, Modular Dungeon Kit (CC0)
- **CptDrunkBear** — `items.blend` bow meshes (public domain)
- **Mujtaba-io** — `soldier-20.blend` guard (public domain)

See `CREDITS.md` for links.
