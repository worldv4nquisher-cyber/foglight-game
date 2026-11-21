"""冷色阴天光预览渲染（自检用，不进游戏）。

用法：
  /opt/blender/blender -b art/source/props/props-puzzle-ch1.blend --python art/tools/render-preview.py -- \
      --root prop-lantern-brass --out art/models/props/preview/prop-lantern-brass.png [--samples 96] [--size 1024]
  --root 可重复；多个根节点时一起入画（例如风灯 + 灯台）。
光照：世界色 #8FA0AE（阴天天光，强度 1.0）+ 弱冷色太阳（#C9D6E0，1.2）；Cycles CPU，AgX。
风灯发光材质按 glowDefault 保持开启，做为唯一暖光（style-guide 制作人裁定）。
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector


def hex_rgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


a = argparse.ArgumentParser()
a.add_argument("--root", action="append", required=True)
a.add_argument("--out", required=True)
a.add_argument("--samples", type=int, default=96)
a.add_argument("--size", type=int, default=1024)
a = a.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

sc = bpy.context.scene
keep = set()
for name in a.root:
    stack = [bpy.data.objects[name]]
    while stack:
        o = stack.pop()
        keep.add(o.name)
        stack += list(o.children)
for o in sc.objects:
    hidden = o.name not in keep or o.hide_render or o.name.endswith(("-collider", "-interact", "-socket", "-emitter", "-emitter-dir"))
    o.hide_render = hidden

pts = []
for o in sc.objects:
    if o.type == "MESH" and not o.hide_render:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr, ext = (lo + hi) / 2, (hi - lo).length

# 地面（冷灰）
bpy.ops.mesh.primitive_plane_add(size=ext * 8, location=(ctr.x, ctr.y, lo.z))
ground = bpy.context.object
gm = bpy.data.materials.new("preview-ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*hex_rgb("#5E6870"), 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
ground.data.materials.append(gm)

# 世界：阴天冷光
w = bpy.data.worlds.new("preview-overcast")
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (*hex_rgb("#8FA0AE"), 1)
bg.inputs["Strength"].default_value = 1.0
sc.world = w
sun = bpy.data.objects.new("preview-sun", bpy.data.lights.new("preview-sun", "SUN"))
sun.data.energy = 1.2
sun.data.color = hex_rgb("#C9D6E0")
sun.data.angle = math.radians(25)  # 大角度 = 软阴影
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
sc.collection.objects.link(sun)

# 相机：3/4 前视（模型正面 = Blender -Y）
cam = bpy.data.objects.new("preview-cam", bpy.data.cameras.new("preview-cam"))
cam.data.lens = 70
sc.collection.objects.link(cam)
d = Vector((0.55, -1.0, 0.35)).normalized()
cam.location = ctr + d * ext * 2.1
cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam

sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = a.samples
sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = a.size
sc.render.film_transparent = False
try:
    sc.view_settings.view_transform = "AgX"
except TypeError:
    sc.view_settings.view_transform = "Filmic"
sc.render.filepath = bpy.path.abspath(a.out) if a.out.startswith("//") else a.out
bpy.ops.render.render(write_still=True)
print("preview ->", sc.render.filepath)
