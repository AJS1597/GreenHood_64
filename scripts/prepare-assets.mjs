#!/usr/bin/env node
/**
 * Copies the runtime glTF assets out of the reference `Assets/` folder and
 * into `public/assets/`, which is what Vite serves and bundles.
 *
 * The source assets are never modified. Run with `pnpm assets:prepare`.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'Assets', 'Models', 'Kenney');
const destRoot = join(repoRoot, 'public', 'assets', 'kenney');

/** kit id -> folder (relative to the Kenney source root) holding the GLBs. */
const KITS = [
  { id: 'modular-dungeon', source: 'Modular Dungeon/Models/GLB format' },
  { id: 'mini-dungeon', source: 'Mini Dungeon/Models/GLB format' },
  { id: 'fantasy-town', source: 'Fantasy town/Models/GLB format' },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyKit(kit) {
  const sourceDir = join(sourceRoot, kit.source);
  const destDir = join(destRoot, kit.id);

  if (!(await exists(sourceDir))) {
    throw new Error(`Missing source kit: ${sourceDir}`);
  }

  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  let models = 0;
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) {
      await cp(join(sourceDir, entry.name), join(destDir, entry.name));
      models += 1;
    }
  }

  const textures = join(sourceDir, 'Textures');
  if (await exists(textures)) {
    await cp(textures, join(destDir, 'Textures'), { recursive: true });
  }

  console.log(`[assets] ${kit.id}: ${models} models + textures`);
}

async function main() {
  await mkdir(destRoot, { recursive: true });
  for (const kit of KITS) {
    await copyKit(kit);
  }
  console.log(`[assets] done -> ${destRoot}`);
}

main().catch((error) => {
  console.error('[assets] failed:', error);
  process.exitCode = 1;
});
