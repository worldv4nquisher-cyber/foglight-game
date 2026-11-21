// 读回 GLB 自检：三角面、材质、节点、extras、扩展；并实际解码 EXT_meshopt_compression 校验数据可读、COLOR_0 是单位法线。
//   node art/tools/inspect-glb.mjs art/models/props/*.glb art/models/characters/*.glb
// 带 skin 的模型：另外检查 JOINTS_0 不越界、WEIGHTS_0 每顶点和为 1、骨骼数与命名（小写英文 + 下划线）。
import { MeshoptDecoder } from '../../game/node_modules/meshoptimizer/index.js';
import { readFileSync } from 'node:fs';

await MeshoptDecoder.ready;
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
let bad = 0;
for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString());
  const bin = buf.subarray(28 + jl);
  const viewData = (i) => {
    const bv = json.bufferViews[i], m = bv.extensions?.EXT_meshopt_compression;
    if (!m) return new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
    const out = new Uint8Array(m.count * m.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, m.count, m.byteStride, new Uint8Array(bin.buffer, bin.byteOffset + (m.byteOffset ?? 0), m.byteLength), m.mode, m.filter);
    return out;
  };
  const read = (ai) => { const a = json.accessors[ai], d = viewData(a.bufferView); return new CT[a.componentType](d.buffer, d.byteOffset + (a.byteOffset ?? 0), a.count * NC[a.type]); };
  console.log(`\n== ${file}  (${(buf.length / 1024).toFixed(0)} KB)`);
  console.log('  extensionsRequired:', (json.extensionsRequired ?? []).join(', ') || '无');
  console.log('  材质:', json.materials.map((m) => m.name + (m.extras ? ' ' + JSON.stringify(m.extras) : '')).join(' | '));
  for (const [si, sk] of (json.skins ?? []).entries()) {
    const names = sk.joints.map((j) => json.nodes[j].name);
    const badNames = names.filter((n) => !/^[a-z][a-z0-9_]*$/.test(n));
    const ibm = sk.inverseBindMatrices !== undefined ? json.accessors[sk.inverseBindMatrices].count : 0;
    console.log(`  skin ${si} "${sk.name ?? ''}": ${names.length} 根骨骼, inverseBindMatrices ${ibm}, 根 ${json.nodes[sk.skeleton]?.name}${badNames.length ? '  ✗ 命名不合规: ' + badNames.join(',') : ''}`);
    if (badNames.length || ibm !== names.length) bad++;
  }
  const walk = (ni, depth) => {
    const n = json.nodes[ni];
    let line = `${'  '.repeat(depth + 1)}- ${n.name}`;
    if (n.translation) line += ` t=[${n.translation.map((v) => +v.toFixed(3)).join(', ')}]`;
    if (n.rotation) line += ` r=[${n.rotation.join(', ')}]`;
    if (n.extras) line += ` extras=${JSON.stringify(n.extras)}`;
    if (n.skin !== undefined) line += ` skin=${n.skin}`;
    if (n.mesh !== undefined) {
      const mesh = json.meshes[n.mesh];
      let tris = 0; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      const parts = mesh.primitives.map((p) => {
        const idx = read(p.indices); const t = idx.length / 3; tris += t;
        const pos = read(p.attributes.POSITION);
        for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); }
        let maxIdx = 0; for (const i of idx) maxIdx = Math.max(maxIdx, i);
        if (maxIdx >= pos.length / 3) { console.log('    ✗ 索引越界'); bad++; }
        let colInfo = '无 COLOR_0';
        if (p.attributes.COLOR_0 !== undefined) {
          const c = read(p.attributes.COLOR_0), k = NC[json.accessors[p.attributes.COLOR_0].type]; let worst = 0;
          for (let i = 0; i < c.length; i += k) { const x = c[i] / 127.5 - 1, y = c[i + 1] / 127.5 - 1, z = c[i + 2] / 127.5 - 1; worst = Math.max(worst, Math.abs(Math.hypot(x, y, z) - 1)); }
          colInfo = `COLOR_0 平滑法线 |n|-1 最大偏差 ${worst.toFixed(3)}`;
          if (worst > 0.02) bad++;
        }
        let skinInfo = '';
        if (p.attributes.JOINTS_0 !== undefined) {
          const jn = read(p.attributes.JOINTS_0), wt = read(p.attributes.WEIGHTS_0), nj = json.skins[n.skin].joints.length;
          const wn = json.accessors[p.attributes.WEIGHTS_0].normalized ? (json.accessors[p.attributes.WEIGHTS_0].componentType === 5121 ? 255 : 65535) : 1;
          let worstW = 0, oob = 0; const used = new Set();
          for (let i = 0; i < jn.length; i += 4) {
            let sum = 0; for (let k = 0; k < 4; k++) { const w = wt[i + k] / wn; sum += w; if (w > 0) { used.add(jn[i + k]); if (jn[i + k] >= nj) oob++; } }
            worstW = Math.max(worstW, Math.abs(sum - 1));
          }
          skinInfo = `, 蒙皮 ${used.size} 根骨骼有权重, 权重和偏差 ${worstW.toFixed(4)}${oob ? `, ✗ ${oob} 个关节索引越界` : ''}`;
          if (oob || worstW > 0.01) bad++;
        }
        return `${json.materials[p.material]?.name ?? '(无材质)'}: ${t} 面, ${colInfo}${skinInfo}`;
      });
      line += `  [${tris} 三角面]  尺寸 ${hi.map((v, i) => (v - lo[i]).toFixed(3)).join(' × ')} m (x×y×z)  y∈[${lo[1].toFixed(3)}, ${hi[1].toFixed(3)}]`;
      console.log(line); parts.forEach((s) => console.log(`${'  '.repeat(depth + 3)}${s}`));
    } else console.log(line);
    (n.children ?? []).forEach((c) => walk(c, depth + 1));
  };
  json.scenes[json.scene ?? 0].nodes.forEach((n) => walk(n, 0));
}
process.exit(bad ? 1 : 0);
