# Exports the custom character and weapon models to glTF for the web build.
#
# Run through Blender:
#   blender -b --python scripts/export-models.py
#
# Inputs (never modified):
#   Assets/Models/Mujtaba-io/soldier-20.blend     -> public/assets/custom/guard.glb
#   Assets/Models/CptDrunkBear/Weapons/items.blend -> public/assets/custom/bow-tier-*.glb
#   Assets/Models/Umplix/arrow.blend               -> public/assets/custom/arrow.glb
#
# Also renders small Workbench previews into public/assets/custom/preview/ so the
# exports can be eyeballed without opening Blender.
#
# The models are public domain per the project owner.

import math
import os
import sys

import bpy
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "public", "assets", "custom")
PREVIEW_DIR = os.path.join(OUT_DIR, "preview")
SOLDIER_BLEND = os.path.join(REPO_ROOT, "Assets", "Models", "Mujtaba-io", "soldier-20.blend")
ITEMS_BLEND = os.path.join(REPO_ROOT, "Assets", "Models", "CptDrunkBear", "Weapons", "items.blend")
ARROW_BLEND = os.path.join(REPO_ROOT, "Assets", "Models", "Umplix", "arrow.blend")

# object name in items.blend -> exported tier file.
# The source models are bow staves/limbs without strings; the game adds a
# procedural string between the tips so they read as complete bows.
BOW_TIERS = [
    ("bow-tier-1", "Cube.020"),
    ("bow-tier-2", "Cube.024"),
    ("bow-tier-3", "Cube.022"),
    ("bow-tier-4", "Cube.027"),
    ("bow-tier-5", "Cube.030"),
]

# The source blends store flat 0.8 grey materials (and the glTF exporter drops
# even that), so we author deliberate low-poly palette colours on export.
GUARD_COLORS = {
    "skin": (0.72, 0.50, 0.34, 1.0),
    "armor_clothe": (0.42, 0.45, 0.50, 1.0),
    "helmet": (0.32, 0.34, 0.38, 1.0),
    "shoes": (0.27, 0.19, 0.13, 1.0),
    "belt": (0.34, 0.22, 0.14, 1.0),
}
GUARD_FALLBACK = (0.45, 0.47, 0.50, 1.0)
SPEAR_COLOR = (0.40, 0.29, 0.18, 1.0)

BOW_COLORS = {
    "bow_0": (0.45, 0.30, 0.16, 1.0),
    "bow_1": (0.52, 0.36, 0.20, 1.0),
    "bow_3": (0.38, 0.26, 0.15, 1.0),
    "bow_4.001": (0.60, 0.44, 0.24, 1.0),
    "bow_5": (0.33, 0.22, 0.13, 1.0),
}
BOW_FALLBACK = (0.48, 0.33, 0.19, 1.0)

ARROW_COLORS = {
    "Wood": (0.46, 0.30, 0.16, 1.0),
    "Metal": (0.66, 0.67, 0.72, 1.0),
    "Feather": (0.84, 0.80, 0.68, 1.0),
}
ARROW_FALLBACK = (0.48, 0.33, 0.19, 1.0)

# Exported sizes in metres so every scene starts from a sane scale.
TARGET_GUARD_HEIGHT = 1.7
TARGET_BOW_LENGTH = 1.25
TARGET_ARROW_LENGTH = 0.9


def log(message):
    print("[models] {}".format(message))


def open_blend(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    bpy.ops.wm.open_mainfile(filepath=path)
    log("opened {}".format(os.path.relpath(path, REPO_ROOT)))


def delete_except(names):
    keep = set(names)
    for obj in list(bpy.data.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)


def select_only(objects):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    active = None
    for obj in objects:
        obj.select_set(True)
        active = active or obj
    if active is not None:
        bpy.context.view_layer.objects.active = active


def ensure_simple_material(material, color, roughness=0.62, metallic=0.0):
    """Rebuild a material as a single Principled BSDF -> Output so glTF exports the colour."""
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()

    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (300, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    material.diffuse_color = color
    material.roughness = roughness
    material.metallic = metallic


def apply_palette(colors, fallback, default_roughness=0.62):
    for material in bpy.data.materials:
        color = colors.get(material.name, fallback)
        ensure_simple_material(material, color, roughness=default_roughness)


def ensure_object_material(obj, color, name):
    if obj.type != "MESH":
        return
    if obj.data.materials and obj.data.materials[0]:
        ensure_simple_material(obj.data.materials[0], color)
        return
    material = bpy.data.materials.new(name)
    ensure_simple_material(material, color)
    obj.data.materials.append(material)


def export_glb(path, animations=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_animations=animations,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_image_format="AUTO",
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError as error:
        log("falling back to minimal export options ({})".format(error))
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True)
    log("wrote {}".format(os.path.relpath(path, REPO_ROOT)))


def render_preview(name):
    """Render a small Workbench thumbnail of the current scene."""
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return

    minimum, maximum = bounds_of(meshes)
    center = (minimum + maximum) * 0.5
    radius = max((maximum - minimum).length * 0.5, 0.2)

    camera_data = bpy.data.cameras.new("preview-cam")
    camera = bpy.data.objects.new("preview-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    direction = Vector((1.0, -1.4, 0.7)).normalized()
    distance = radius * 2.6
    camera.location = center + direction * distance
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.render.filepath = os.path.join(PREVIEW_DIR, "{}.png".format(name))
    bpy.ops.render.render(write_still=True)
    log("preview -> {}".format(os.path.relpath(scene.render.filepath, REPO_ROOT)))

    bpy.data.objects.remove(camera, do_unlink=True)


def bounds_of(objects):
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world.x)
            minimum.y = min(minimum.y, world.y)
            minimum.z = min(minimum.z, world.z)
            maximum.x = max(maximum.x, world.x)
            maximum.y = max(maximum.y, world.y)
            maximum.z = max(maximum.z, world.z)
    return minimum, maximum


def export_guard():
    open_blend(SOLDIER_BLEND)
    armature = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    guard = bpy.data.objects.get("guard") or next(
        (o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)),
        None,
    )
    spear = bpy.data.objects.get("spear")

    if armature is None or guard is None:
        raise RuntimeError("soldier blend is missing its armature or skinned mesh")

    delete_except([o.name for o in (armature, guard, spear) if o is not None])

    # Keep every animation action alive so the exporter can find them all.
    for action in bpy.data.actions:
        action.use_fake_user = True

    apply_palette(GUARD_COLORS, GUARD_FALLBACK, default_roughness=0.55)
    if spear is not None:
        ensure_object_material(spear, SPEAR_COLOR, "spear")

    # Spear follows the right hand; without this it floats during swings.
    if spear is not None and "hand.R" in armature.data.bones:
        world = spear.matrix_world.copy()
        spear.parent = armature
        spear.parent_type = "BONE"
        spear.parent_bone = "hand.R"
        spear.matrix_world = world

    # Normalise the rig to a real-world height so every scene shares a scale.
    minimum, maximum = bounds_of([guard])
    height = max(maximum.z - minimum.z, 0.001)
    armature.scale = (TARGET_GUARD_HEIGHT / height,) * 3

    render_preview("guard")
    keep = [o for o in (armature, guard, spear) if o is not None]
    select_only(keep)
    export_glb(os.path.join(OUT_DIR, "guard.glb"), animations=True)
    log("exported {} animation action(s)".format(len(bpy.data.actions)))


def export_bow(tier_name, object_name):
    open_blend(ITEMS_BLEND)
    target = bpy.data.objects.get(object_name)
    if target is None:
        log("SKIP {}: no object named {}".format(tier_name, object_name))
        return

    # Move the mesh to the origin so the game controls placement.
    target.location = (0.0, 0.0, 0.0)
    delete_except([target.name])
    apply_palette(BOW_COLORS, BOW_FALLBACK, default_roughness=0.7)

    # Normalise the stave length so tiers read at a consistent size.
    minimum, maximum = bounds_of([target])
    length = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z, 0.001)
    target.scale = (TARGET_BOW_LENGTH / length,) * 3

    select_only([target])
    render_preview(tier_name)
    export_glb(os.path.join(OUT_DIR, "{}.glb".format(tier_name)), animations=False)


def export_arrow():
    open_blend(ARROW_BLEND)
    target = bpy.data.objects.get("Arrow")
    if target is None:
        raise RuntimeError("arrow blend is missing its Arrow mesh")

    delete_except([target.name])
    apply_palette(ARROW_COLORS, ARROW_FALLBACK, default_roughness=0.65)

    # Bake source transforms, then point the tip along +Z in glTF space.
    select_only([target])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    target.rotation_mode = "XYZ"
    target.rotation_euler = (0.0, 0.0, math.pi)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Normalise the length and centre the mesh on its origin.
    minimum, maximum = bounds_of([target])
    size = maximum - minimum
    length = max(size.x, size.y, size.z, 0.001)
    scale = TARGET_ARROW_LENGTH / length
    target.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    minimum, maximum = bounds_of([target])
    center = (minimum + maximum) * 0.5
    target.location = -center
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    render_preview("arrow")
    select_only([target])
    export_glb(os.path.join(OUT_DIR, "arrow.glb"), animations=False)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    export_guard()
    export_arrow()
    for tier_name, object_name in BOW_TIERS:
        export_bow(tier_name, object_name)
    log("done -> {}".format(os.path.relpath(OUT_DIR, REPO_ROOT)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - surface the failure to the CLI
        log("FAILED: {}".format(error))
        sys.exit(1)
