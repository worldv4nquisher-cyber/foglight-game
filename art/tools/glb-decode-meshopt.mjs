// 把 EXT_meshopt_compression 的 GLB 解压成普通 GLB（Blender 4.2 的 glTF 导入器不认 meshopt），外部贴图一并嵌入。
//   node art/tools/glb-decode-meshopt.mjs <in.glb> <out.glb>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MeshoptDecoder } from '../../game/node_modules/meshoptimizer/index.js';
await MeshoptDecoder.ready;
const [inp, out] = process.argv.slice(2);
const b = readFileSync(inp); const jl = b.readUInt32LE(12); const j = JSON.parse(b.slice(20, 20 + jl)); const bin = b.slice(20 + jl + 8);
const chunks = []; let off = 0;
const push = (u8) => { const o = off; chunks.push(Buffer.from(u8)); off += u8.byteLength; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } return o; };
for (const bv of j.bufferViews) {
  const e = bv.extensions?.EXT_meshopt_compression;
  let data;
  if (e) { data = new Uint8Array(e.count * e.byteStride); MeshoptDecoder.decodeGltfBuffer(data, e.count, e.byteStride, bin.subarray(e.byteOffset ?? 0, (e.byteOffset ?? 0) + e.byteLength), e.mode, e.filter); if (e.mode === 'ATTRIBUTES') bv.byteStride = e.byteStride; else delete bv.byteStride; delete bv.extensions; }
  else data = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  bv.buffer = 0; bv.byteOffset = push(data); bv.byteLength = data.byteLength;
}
for (const im of j.images ?? []) if (im.uri) { const d = readFileSync(resolve(dirname(inp), im.uri)); j.bufferViews.push({ buffer: 0, byteOffset: push(d), byteLength: d.byteLength }); im.bufferView = j.bufferViews.length - 1; delete im.uri; }
j.buffers = [{ byteLength: off }];
j.extensionsUsed = (j.extensionsUsed ?? []).filter((x) => x !== 'EXT_meshopt_compression');
j.extensionsRequired = (j.extensionsRequired ?? []).filter((x) => x !== 'EXT_meshopt_compression');
const js = Buffer.from(JSON.stringify(j)); const jp = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const bd = Buffer.concat(chunks);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jp.length + 8 + bd.length, 8);
const c0 = Buffer.alloc(8); c0.writeUInt32LE(jp.length, 0); c0.writeUInt32LE(0x4e4f534a, 4);
const c1 = Buffer.alloc(8); c1.writeUInt32LE(bd.length, 0); c1.writeUInt32LE(0x004e4942, 4);
writeFileSync(out, Buffer.concat([h, c0, jp, c1, bd]));
