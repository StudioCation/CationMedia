import bpy
import math
import sys

# Input is an app-created GLB. Run Blender with --factory-startup and --disable-autoexec.
input_file, output_file = sys.argv[sys.argv.index('--') + 1:][:2]
for item in tuple(bpy.data.objects):
    bpy.data.objects.remove(item, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=input_file)
if bpy.data.actions:
    bpy.context.scene.frame_start = math.floor(min(action.frame_range[0] for action in bpy.data.actions))
    bpy.context.scene.frame_end = math.ceil(max(action.frame_range[1] for action in bpy.data.actions))
result = bpy.ops.export_scene.fbx(
    filepath=output_file,
    use_selection=False,
    object_types={'MESH', 'ARMATURE', 'EMPTY'},
    use_mesh_modifiers=False,
    add_leaf_bones=False,
    bake_anim=True,
    bake_anim_use_nla_strips=False,
    bake_anim_use_all_actions=False,
    bake_anim_simplify_factor=0.0,
    path_mode='COPY',
    embed_textures=True,
)
if 'FINISHED' not in result:
    raise RuntimeError('Blender did not finish FBX export')
