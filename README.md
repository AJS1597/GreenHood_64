# GreenHood 64

A first-person Robin Hood stealth-archer dungeon crawler built with **Babylon.js**, **TypeScript**, **Vite** and **pnpm**.

You raid a randomly generated two-floor castle, steal gold from chests and vaults, hunt the king for crowns, and extract back through the entrance to bank your loot. Between runs, spend gold and crowns at a fixed Sherwood forest camp on better bows, abilities and training.

## Status

Early scaffolding. The engine boots and the development showcase scene loads every Kenney kit plus the custom guard and bow exports. Gameplay scenes are next.

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
| Interact / shop | `E` |
| Release mouse | `Esc` |

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

## Source assets

The reference art lives in `Assets/Models/` and is never modified. `pnpm assets:prepare` selectively copies only the runtime files (GLB + textures) into `public/assets/kenney/`, and the Blender script writes generated models into `public/assets/custom/`.

- **Kenney** — Fantasy Town Kit, Mini Dungeon, Modular Dungeon Kit (CC0)
- **CptDrunkBear** — `items.blend` bow meshes (public domain)
- **Mujtaba-io** — `soldier-20.blend` guard (public domain)

See `CREDITS.md` for links.

## Project layout

```
src/
  app/      application state, save data
  core/     engine-independent logic (rng, config, generation, combat math)
  world/    Babylon scene builders and asset loading
  gameplay/ player, bow, guards, loot (coming next)
  ui/       HTML/CSS overlays
scripts/    asset preparation and Blender exports
tests/      Vitest logic tests
```
