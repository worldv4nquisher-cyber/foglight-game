"""Blender → GLB 导出脚本（v0.1 美术交付规范 §5）。

做的事：
  1. 只导出指定根节点及其子树（根节点临时归零，导出后恢复）；
  2. glTF 标准 Y 轴向上（export_yup），带物体自定义属性（extras，如 puzzleCritical）；
  3. 把「平滑法线」写进顶点色 COLOR_0（给反向法线外扩描边用，见 style-guide §7.3）：
     - 按位置焊接后求面积加权平均法线，所以硬边/UV 缝处也不会断线；
     - 已换算到 glTF 坐标（x, z, -y）、网格本地空间，编码为 n*0.5+0.5（RGB，A=1）；
  4. 调 gltf-transform 做 Meshopt 压缩（几何量化 + EXT_meshopt_compression）；
     若装了 KTX-Software（ktx 或 toktx），顺带把内嵌贴图转 KTX2（颜色 ETC1S，法线/ORM UASTC）。

用法：
  /opt/blender/blender -b art/source/props/props-puzzle-ch1.blend --python art/tools/export-glb.py -- \
      --root prop-lantern-brass --out art/models/props/prop-lantern-brass.glb [--no-ktx2] [--keep-temp]
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import bpy
from mathutils import Vector

TOOLS = os.path.dirname(os.path.abspath(__file__))
GLTF_TRANSFORM = os.path.join(TOOLS, "node_modules", ".bin", "gltf-transform")
OUTLINE_ATTR = "outline-normal"


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True, help="根节点名，例如 prop-lantern-brass")
    p.add_argument("--out", required=True, help="输出 .glb 路径")
    p.add_argument("--no-ktx2", action="store_true", help="不转 KTX2（保留 PNG）")
    p.add_argument("--keep-temp", action="store_true")
    return p.parse_args(argv)


def subtree(root):
    out = [root]
    for c in root.children:
        out += subtree(c)
    return out


def write_outline_normals(obj):
    me = obj.data
    key = lambda co: (round(co.x, 5), round(co.y, 5), round(co.z, 5))
    acc = {}
    for poly in me.polygons:
        n = poly.normal * poly.area
        for vi in poly.vertices:
            k = key(me.vertices[vi].co)
            acc[k] = acc.get(k, Vector()) + n
    if OUTLINE_ATTR in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[OUTLINE_ATTR])
    attr = me.color_attributes.new(OUTLINE_ATTR, "FLOAT_COLOR", "POINT")
    for i, v in enumerate(me.vertices):
        n = acc.get(key(v.co), Vector((0, 0, 1)))
        n = n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))
        g = (n.x, n.z, -n.y)  # Blender Z-up → glTF Y-up
        attr.data[i].color = (g[0] * 0.5 + 0.5, g[1] * 0.5 + 0.5, g[2] * 0.5 + 0.5, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    want = dict(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_extras=True,
        export_apply=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="AUTO", export_cameras=False, export_lights=False,
        export_animations=False, export_draco_mesh_compression_enable=False,
        export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_colors=True,  # 4.1 及更早的旧参数名
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})


def run(cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main():
    a = parse()
    root = bpy.data.objects.get(a.root)
    if root is None:
        sys.exit(f"找不到根节点 {a.root}")
    if root.parent is not None:
        sys.exit("--root 必须是顶层物体")
    objs = subtree(root)
    for o in objs:
        if o.type == "MESH":
            write_outline_normals(o)
    saved = root.matrix_world.copy()
    root.matrix_world.identity()
    tmp = tempfile.mkdtemp(prefix="glb-")
    raw = os.path.join(tmp, "raw.glb")
    try:
        bpy.context.view_layer.update()
        export(objs, raw)
    finally:
        root.matrix_world = saved
    if not os.path.exists(GLTF_TRANSFORM):
        sys.exit(f"缺少 gltf-transform：先在 {TOOLS} 里运行 npm install")
    cur = raw
    if not a.no_ktx2 and (shutil.which("ktx") or shutil.which("toktx")):
        nxt = os.path.join(tmp, "uastc.glb")
        run([GLTF_TRANSFORM, "uastc", cur, nxt, "--slots", "{normalTexture,occlusionTexture,metallicRoughnessTexture}", "--level", "2", "--zstd", "18"])
        cur, nxt = nxt, os.path.join(tmp, "etc1s.glb")
        run([GLTF_TRANSFORM, "etc1s", cur, nxt, "--slots", "{baseColorTexture,emissiveTexture}", "--quality", "255"])
        cur = nxt
    elif not a.no_ktx2:
        print("警告：没找到 KTX-Software（ktx/toktx），贴图保持 PNG。")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    run([GLTF_TRANSFORM, "meshopt", cur, os.path.abspath(a.out), "--level", "medium"])
    if a.keep_temp:
        print("临时文件：", tmp)
    else:
        shutil.rmtree(tmp, ignore_errors=True)
    print("OK ->", a.out)


main()
