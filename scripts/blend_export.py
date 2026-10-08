import bpy
import sys

# Run with --disable-autoexec. Never execute scripts stored in the source file.
output = sys.argv[sys.argv.index('--') + 1]
bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', use_selection=False,
                          export_animations=True, export_yup=True)
