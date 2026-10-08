import bpy
import os
import sys

folder = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
os.makedirs(folder, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 1))
cube = bpy.context.object
cube.name = 'Animated cube'
material = bpy.data.materials.new('Mint')
material.diffuse_color = (0.22, 0.75, 0.48, 1)
cube.data.materials.append(material)
cube.rotation_euler.z = 0
cube.keyframe_insert(data_path='rotation_euler', frame=1)
cube.rotation_euler.z = 3.14
cube.keyframe_insert(data_path='rotation_euler', frame=61)
bpy.context.scene.frame_end = 61
bpy.context.scene.frame_set(1)
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=(3, 0, 1))
bpy.context.object.name = 'Sphere'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(folder, 'sample.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'sample.glb'), export_format='GLB')
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'compressed.glb'), export_format='GLB', export_draco_mesh_compression_enable=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'sample.gltf'), export_format='GLTF_SEPARATE')
bpy.ops.export_scene.fbx(filepath=os.path.join(folder, 'sample.fbx'))
bpy.ops.wm.obj_export(filepath=os.path.join(folder, 'sample.obj'))
bpy.ops.wm.stl_export(filepath=os.path.join(folder, 'sample.stl'))
bpy.ops.wm.ply_export(filepath=os.path.join(folder, 'sample.ply'))
