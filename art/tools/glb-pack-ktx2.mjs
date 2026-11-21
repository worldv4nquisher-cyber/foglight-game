#!/usr/bin/env node
// GLB 贴图换成 KTX2 + Meshopt（含 KHR_mesh_quantization）重新打包（v0.1 §5.7）
// 用法：node art/tools/glb-pack-ktx2.mjs [--embed] [--out-dir DIR] a.glb b.glb ...
//   - 贴图按名字（去扩展名）找 art/textures/<名>.ktx2（先跑 tex-to-ktx2.sh）。
//   - 默认外置共用图集：images[i].uri = 相对 GLB 的路径（art/models/<类>/x.glb → ../../textures/<名>.ktx2）；
//     游戏侧 assets/models/<类>/ 与 assets/textures/ 保持同样的相对层级即可。--embed 则把 KTX2 打进 GLB。
//   - 量化：位置 14 bit（-collider / -wall 网格保持 float：PhysicsSystem 会 applyMatrix4 烘焙世界坐标，
//     归一化 int16 会被截断），法线/切线 10 bit，UV 12 bit（超出 [0,1] 的 UV 自动保留 float），顶点色 8 bit，权重 8 bit。
//   - 输入可以是 meshopt 压缩过的 GLB（会先解码）。节点名、extras 原样保留。
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Format } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { reorder, quantize, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const TEX_DIR = path.resolve(HERE, '../textures');
const args = process.argv.slice(2);
let uvBits = 12;
let embed = false, outDir = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--embed') embed = true;
  else if (args[i] === '--uv-bits') uvBits = +args[++i]; // v0.1-029：光照贴图 UV2 用 14 bit（默认 12 不变）
  else if (args[i] === '--out-dir') outDir = args[++i];
  else files.push(args[i]);
}
if (!files.length) { console.error('用法: glb-pack-ktx2.mjs [--embed] [--out-dir DIR] a.glb ...'); process.exit(1); }

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
// v0.1-029 修正：渲染 LOD（名字以 _lodN 结尾，如 env-courtyard-wall-s2_lod0）不算碰撞网格。
// 以前会被误判，位置在 reorder 前存了 float 拷贝、之后还原，和 UV / 法线顺序对不上。
const physRe = { test: (n) => /-(collider|wall)(\b|_|$)/.test(n) && !/_lod\d+$/.test(n) };

for (const file of files) {
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  const root = doc.getRoot();
  const dst = path.resolve(outDir ?? path.dirname(file), path.basename(file));
  // ---- 贴图
  const extUri = new Map();
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const tex of root.listTextures()) {
    const base = path.basename(tex.getURI() || tex.getName() || '', path.extname(tex.getURI() || tex.getName() || '')) || tex.getName();
    const k = path.join(TEX_DIR, `${base}.ktx2`);
    if (!fs.existsSync(k)) throw new Error(`${file}: 缺 ${k}（先跑 art/tools/tex-to-ktx2.sh）`);
    tex.setName(base).setMimeType('image/ktx2').setURI('');
    if (embed) tex.setImage(new Uint8Array(fs.readFileSync(k)));
    else { tex.setImage(null); extUri.set(base, path.relative(path.dirname(dst), k).split(path.sep).join('/')); }
  }
  // ---- 碰撞网格不量化：先把位置挪到独立的 float 拷贝，量化后再还原
  const keep = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && physRe.test(node.getName())) keep.push({ node, mesh, matrix: node.getMatrix(), pos: mesh.listPrimitives().map((p) => p.getAttribute('POSITION').getArray().slice()) });
  }
  for (const k of keep) k.node.setMesh(null); // 断开后 quantize 不会改这些节点的矩阵
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: uvBits, quantizeColor: 8, quantizeWeight: 8, cleanup: false }),
  );
  const buf = root.listBuffers()[0];
  for (const k of keep) {
    k.mesh.listPrimitives().forEach((p, i) => p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(k.pos[i])).setBuffer(buf)));
    k.node.setMesh(k.mesh).setMatrix(k.matrix);
  }
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true, keepExtras: true, keepSolidTextures: true }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  let glb = await io.writeBinary(doc);
  // ---- 外置贴图：把 image 改成 uri
  if (!embed) {
    const jl = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl)));
    for (const img of json.images ?? []) { img.uri = extUri.get(img.name); if (!img.uri) throw new Error(`no uri for ${img.name}`); delete img.mimeType; }
    let js = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
    const rest = glb.subarray(20 + jl);
    const out = Buffer.alloc(12 + 8 + js.length + rest.length);
    out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
    out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); Buffer.from(js).copy(out, 20); Buffer.from(rest).copy(out, 20 + js.length);
    glb = out;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, glb);
  const unnamed = root.listNodes().filter((n) => !n.getName()).length;
  console.log(`${path.basename(file).padEnd(36)} ${(before / 1024).toFixed(0).padStart(7)} KB → ${(glb.length / 1024).toFixed(0).padStart(7)} KB  ${embed ? '内嵌' : '外置'} ${root.listTextures().length} 张 KTX2${unnamed ? `  ⚠ 新增无名节点 ${unnamed}` : ''}`);
}
