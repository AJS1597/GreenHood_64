import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
  Vector3,
} from '@babylonjs/core';

/** A sky plus the meshes it owns, so a location can dispose it in one go. */
export interface Sky {
  readonly root: TransformNode;
  /** Optional per-frame animation (e.g. drifting clouds). */
  update?(dt: number): void;
  dispose(): void;
}

const SKY_RADIUS = 350;
/** How fast the cloud layer sweeps around the player, in radians per second. */
const CLOUD_DRIFT = 0.008;

/**
 * Builds the sky for a location.
 *
 * The forest sky is a bright blue gradient with drifting cumulus clouds and a
 * diffuse sun glow. The castle sky is flat black so the dungeon reads as a
 * sealed stone interior.
 */
export function createForestSky(scene: Scene, sunDirection: Vector3): Sky {
  const root = new TransformNode('sky-forest-root', scene);

  const dome = MeshBuilder.CreateSphere(
    'sky-dome',
    { diameter: SKY_RADIUS * 2, segments: 24, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  dome.parent = root;
  paintGradient(dome, {
    zenith: new Color3(0.16, 0.42, 0.82),
    horizon: new Color3(0.72, 0.86, 0.96),
    ground: new Color3(0.52, 0.6, 0.55),
  });
  dome.material = unlitMaterial(scene, 'sky-dome-mat', new Color3(1, 1, 1));
  dome.isPickable = false;
  dome.receiveShadows = false;

  // A single flat cloud sheet inside the dome. Its texture fades out toward the
  // edges, so it can drift forever without ever showing a hard border.
  const clouds = MeshBuilder.CreatePlane(
    'sky-clouds',
    { width: 580, height: 580, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  clouds.parent = root;
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 160;
  clouds.material = cloudMaterial(scene);
  clouds.isPickable = false;
  clouds.receiveShadows = false;

  const sunPosition = sunDirection.normalizeToNew().scale(280);
  const sun = MeshBuilder.CreatePlane('sky-sun', { size: 90 }, scene);
  sun.parent = root;
  sun.position.copyFrom(sunPosition);
  sun.billboardMode = Mesh.BILLBOARDMODE_ALL;
  sun.material = sunMaterial(scene);
  sun.isPickable = false;

  let drift = 0;
  return {
    root,
    update: (dt) => {
      drift += dt * CLOUD_DRIFT;
      clouds.rotation.y = drift;
    },
    dispose: () => {
      root.dispose(false, true);
    },
  };
}

/** Flat black dome; the castle needs no detail above. */
export function createCastleSky(scene: Scene): Sky {
  const root = new TransformNode('sky-castle-root', scene);
  const dome = MeshBuilder.CreateSphere(
    'sky-castle-dome',
    { diameter: SKY_RADIUS * 2, segments: 12, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  dome.parent = root;
  const material = unlitMaterial(scene, 'sky-castle-mat', new Color3(0.01, 0.01, 0.015));
  material.backFaceCulling = false;
  dome.material = material;
  dome.isPickable = false;
  return {
    root,
    dispose: () => {
      root.dispose(false, true);
    },
  };
}

interface Gradient {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
}

/** Unlit vertical gradient baked into vertex colours (no UV orientation tricks). */
function paintGradient(mesh: Mesh, gradient: Gradient): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) {
    return;
  }
  // Vertex colours are RGBA: four floats per vertex. The array must be sized
  // for all four, or the alpha channel reads back garbage and the dome renders
  // transparent.
  const vertexCount = positions.length / 3;
  const colors = new Array<number>(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const y = (positions[vertex * 3 + 1] ?? 0) / SKY_RADIUS;
    let color: Color3;
    if (y >= 0) {
      color = Color3.Lerp(gradient.horizon, gradient.zenith, smoothstep(y));
    } else {
      color = Color3.Lerp(gradient.horizon, gradient.ground, smoothstep(-y * 2));
    }
    const i = vertex * 4;
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
    colors[i + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function unlitMaterial(scene: Scene, name: string, base: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  // With lighting disabled the shader multiplies by the emissive term, so the
  // base colour has to live there for vertex colours and textures to show.
  material.diffuseColor = base;
  material.emissiveColor = base;
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  material.fogEnabled = false;
  return material;
}

function cloudMaterial(scene: Scene): StandardMaterial {
  const size = 1024;
  const texture = new DynamicTexture('sky-cloud-tex', { width: size, height: size }, scene, false);
  const context = texture.getContext() as CanvasRenderingContext2D;
  context.clearRect(0, 0, size, size);

  // Clusters of overlapping soft puffs read as soft cumulus. Clusters are kept
  // near the middle of the sheet so the layer thins out before its edge.
  const rng = mulberry(9137);
  for (let cluster = 0; cluster < 20; cluster += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * size * 0.28;
    const cx = size / 2 + Math.cos(angle) * distance;
    const cy = size / 2 + Math.sin(angle) * distance;
    const spread = size * (0.03 + rng() * 0.035);
    const puffs = 6 + Math.floor(rng() * 7);

    // Shaded base first, then the bright sunlit top on top of it.
    for (let puff = 0; puff < puffs; puff += 1) {
      const px = cx + (rng() - 0.5) * spread * 2;
      const py = cy + spread * (0.12 + rng() * 0.5);
      const radius = spread * (0.4 + rng() * 0.5);
      drawPuff(context, px, py, radius, 0.4 + rng() * 0.3, 206);
    }
    for (let puff = 0; puff < puffs; puff += 1) {
      const px = cx + (rng() - 0.5) * spread * 1.9;
      const py = cy - spread * (0.05 + rng() * 0.45);
      const radius = spread * (0.45 + rng() * 0.55);
      drawPuff(context, px, py, radius, 0.65 + rng() * 0.3, 253);
    }
  }

  // Fade the whole sheet toward its border so the drifting plane never shows an
  // edge against the sky dome.
  context.globalCompositeOperation = 'destination-in';
  const fade = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.32,
    size / 2,
    size / 2,
    size * 0.5,
  );
  fade.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = fade;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'source-over';

  texture.update();
  texture.hasAlpha = true;

  const material = new StandardMaterial('sky-cloud-mat', scene);
  material.disableLighting = true;
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.diffuseTexture.hasAlpha = true;
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  material.fogEnabled = false;
  return material;
}

/** One soft white (or grey) puff, brightest in the middle and transparent at the rim. */
function drawPuff(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  shade: number,
): void {
  const blue = Math.min(255, shade + 4);
  const gradient = context.createRadialGradient(x, y, radius * 0.15, x, y, radius);
  gradient.addColorStop(0, `rgba(${shade}, ${shade}, ${blue}, ${alpha})`);
  gradient.addColorStop(0.55, `rgba(${shade}, ${shade}, ${blue}, ${alpha * 0.78})`);
  gradient.addColorStop(1, `rgba(${shade}, ${shade}, ${blue}, 0)`);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function sunMaterial(scene: Scene): StandardMaterial {
  const size = 256;
  const texture = new DynamicTexture('sky-sun-tex', { width: size, height: size }, scene, false);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const center = size / 2;

  const glow = context.createRadialGradient(center, center, 4, center, center, center);
  glow.addColorStop(0, 'rgba(255, 250, 226, 0.85)');
  glow.addColorStop(0.22, 'rgba(255, 246, 214, 0.45)');
  glow.addColorStop(0.55, 'rgba(250, 244, 220, 0.14)');
  glow.addColorStop(1, 'rgba(250, 244, 220, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
  texture.update();
  texture.hasAlpha = true;

  const material = new StandardMaterial('sky-sun-mat', scene);
  material.disableLighting = true;
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  material.fogEnabled = false;
  return material;
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Tiny local PRNG so the sky is identical every load. */
function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
