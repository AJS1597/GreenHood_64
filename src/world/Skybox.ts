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
  dispose(): void;
}

const SKY_RADIUS = 350;

/**
 * Builds the sky for a location.
 *
 * The forest sky is a subdued overcast-blue gradient with soft cloud banks and
 * a diffuse sun glow. The castle sky is flat black so the dungeon reads as a
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
    zenith: new Color3(0.6, 0.74, 0.86),
    horizon: new Color3(0.86, 0.9, 0.93),
    ground: new Color3(0.58, 0.63, 0.56),
  });
  dome.material = unlitMaterial(scene, 'sky-dome-mat', new Color3(1, 1, 1));
  dome.isPickable = false;
  dome.receiveShadows = false;

  const clouds = MeshBuilder.CreatePlane(
    'sky-clouds',
    { width: 420, height: 420, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  clouds.parent = root;
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 150;
  clouds.material = cloudMaterial(scene);
  clouds.isPickable = false;

  const sunPosition = sunDirection.normalizeToNew().scale(280);
  const sun = MeshBuilder.CreatePlane('sky-sun', { size: 90 }, scene);
  sun.parent = root;
  sun.position.copyFrom(sunPosition);
  sun.billboardMode = Mesh.BILLBOARDMODE_ALL;
  sun.material = sunMaterial(scene);
  sun.isPickable = false;

  return {
    root,
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
  const colors = new Array<number>(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const y = (positions[i + 1] ?? 0) / SKY_RADIUS;
    let color: Color3;
    if (y >= 0) {
      color = Color3.Lerp(gradient.horizon, gradient.zenith, smoothstep(y));
    } else {
      color = Color3.Lerp(gradient.horizon, gradient.ground, smoothstep(-y * 2));
    }
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
  const size = 512;
  const texture = new DynamicTexture('sky-cloud-tex', { width: size, height: size }, scene, false);
  const context = texture.getContext() as CanvasRenderingContext2D;

  // Soft, low-contrast cumulus made from overlapping translucent blobs.
  const rng = mulberry(9137);
  for (let i = 0; i < 90; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 18 + rng() * 46;
    const alpha = 0.05 + rng() * 0.06;
    const shade = 232 + Math.floor(rng() * 20);
    context.beginPath();
    context.fillStyle = `rgba(${shade}, ${shade}, ${shade - 4}, ${alpha})`;
    context.ellipse(x, y, radius * 1.7, radius, rng() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
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
