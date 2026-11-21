#!/usr/bin/env node
// 016 汐 正式版：Blender 导出的原始 GLB（art/source/characters/bake/char-xi-raw.glb）→ 交付结构
//   - 3 个材质接贴图（图集 tex-xi-albedo/normal/orm 共用；头发 MASK + 双面），extras 写 toonRamp / wetMask / sdfFace
//   - COLOR_0 = 平滑法线（同位置顶点的法线平均，n*0.5+0.5，RGBA8 归一化）给外扩描边；A = 描边宽度系数（r2：脸 0.6、发梢收细）
//   - 根节点 char-xi + extras { heightM, forward, skeleton }；去掉 Blender 的 Armature 包装层名差异
//   - 输出未压缩 GLB（贴图为 1×1 占位 PNG，名字 = 贴图名），再由 glb-pack-ktx2.mjs 换成外置 KTX2 + Meshopt
// 用法：node art/tools/finish-char-xi.mjs [raw.glb] [out.glb]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = process.argv[2] ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../source/characters/bake/char-xi-raw.glb');
const OUT = process.argv[3] ?? path.resolve(HERE, '../models/characters/char-xi.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(RAW);
const root = doc.getRoot();
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const tex = {};
for (const n of ['tex-xi-albedo', 'tex-xi-normal', 'tex-xi-orm']) tex[n] = doc.createTexture(n).setImage(new Uint8Array(PNG1)).setMimeType('image/png').setURI(`${n}.png`);

const WET = { texture: 'tex-xi-orm', channel: 'a', note: 'ORM.a = 湿润遮罩（1 = 最先湿：肩、下摆、袖口、裤脚、雨靴）。shader：color *= 1 - 0.22*wet*uWetness；roughness = mix(rough, 0.28, wet*uWetness)。ORM.g 为干燥粗糙度。' };
const SDF = { texture: 'tex-xi-sdf-face', texCoord: 1, note: 'TEXCOORD_1 = 脸正面投影 UV。光从角色右侧(-X)来时直接采样、从左侧来时 u 翻转；θ = 光的水平角/90° ∈ [0,1]，lit = θ <= sdf（灰度 R；sdf = 该像素开始变暗的 θ）。' };
const mats = {};
for (const m of root.listMaterials()) mats[m.getName()] = m;
for (const [name, m] of Object.entries(mats)) {
  m.setBaseColorTexture(tex['tex-xi-albedo']).setBaseColorFactor([1, 1, 1, 1])
    .setNormalTexture(tex['tex-xi-normal'])
    .setOcclusionTexture(tex['tex-xi-orm']).setOcclusionStrength(1)
    .setMetallicRoughnessTexture(tex['tex-xi-orm']).setMetallicFactor(1).setRoughnessFactor(1)
    .setEmissiveFactor([0, 0, 0]);
  if (name.endsWith('hair')) m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true).setExtras({ toonRamp: 'tex-xi-ramp', anisoHighlight: 'albedo 已画一条；023 可再加 shader 高光' });
  else if (name.endsWith('face')) m.setAlphaMode('OPAQUE').setDoubleSided(false).setExtras({ toonRamp: 'tex-xi-ramp', sdfFace: SDF });
  else m.setAlphaMode('OPAQUE').setDoubleSided(false).setExtras({ toonRamp: 'tex-xi-ramp', wetMask: WET });
}
if (Object.keys(mats).length > 3) throw new Error('材质超过 3 个: ' + Object.keys(mats));
for (const t of root.listTextures()) if (!Object.values(tex).includes(t)) t.dispose();

// COLOR_0：平滑法线（r5 重写，程序 r4 反馈「头发卡片内部细暗线 / 兜帽领口锯齿暗线」）
//   身体 + 脸：按位置 0.5 mm 容差焊接（网格 + 邻格并查集，不再是 2e4 取整——取整会把相距 <0.05 mm 但跨格的接缝顶点分开，
//     领口内外层 / 接缝两侧各算各的法线 → 外扩壳在接缝处一段一段错开 = 锯齿），焊接簇内 NORMAL 求和归一
//   头发：发缕是 6 mm 粗的开口管（64 个连通块），按管自身法线外扩，每一缕都会在相邻发缕上描一圈 → 「卡片内部细暗线」。
//     改为整头一致朝外：马尾顶点（马尾骨权重 ≥ 0.5）= 离马尾骨折线最近点 → 顶点；其余 = 头部中心 → 顶点；
//     与发缕自身平滑法线按 XI_HAIR_OWN（默认 0）混合；再保证与顶点法线 dot ≥ 0.05（见下）。外轮廓上外扩方向仍朝外，头发描边保留
//   A = 描边宽度系数（身体 1.0；脸 0.6；头发根→梢 0.75 → 0.30；碎发卡片 0.25）——注意 game OutlineHull.ts 目前没读 A
const HAIR_OWN = +(process.env.XI_HAIR_OWN ?? 0);
const WELD = 0.0005;
const buf = root.listBuffers()[0];
{
  const skin = root.listSkins()[0];
  const jn = skin.listJoints().map((j) => j.getName());
  const jpos = (n) => skin.listJoints()[jn.indexOf(n)].getWorldTranslation();
  const PTJ = ['hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03'].map((n) => jn.indexOf(n));
  const pl = ['hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03'].map(jpos);
  pl.push(pl[2].map((x, c) => x + 4 * (pl[2][c] - pl[1][c])));          // 马尾梢：末节方向往外延 4 倍
  const closestOnPolyline = (p) => {
    let best = null, bd = 1e9;
    for (let s = 0; s + 1 < pl.length; s++) {
      const a = pl[s], b = pl[s + 1], ab = b.map((x, c) => x - a[c]), L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L));
      const q = a.map((x, c) => x + t * ab[c]), d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };
  for (const mesh of root.listMeshes()) {
    const prims = mesh.listPrimitives();
    const isHair = prims.map((pr) => pr.getMaterial().getName().endsWith('hair'));
    // 全 mesh 顶点表
    const V = []; prims.forEach((pr, pi) => { const n = pr.getAttribute('POSITION').getCount(); for (let i = 0; i < n; i++) V.push([pi, i]); });
    const P = prims.map((pr) => pr.getAttribute('POSITION').getArray()), N = prims.map((pr) => pr.getAttribute('NORMAL').getArray());
    const pos = (k) => { const [pi, i] = V[k]; return [P[pi][i * 3], P[pi][i * 3 + 1], P[pi][i * 3 + 2]]; };
    // 容差焊接：同组（头发 / 非头发）之间，距离 ≤ WELD
    const par = V.map((_, k) => k), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    const grid = new Map(), gk = (x, y, z) => `${x},${y},${z}`;
    V.forEach((_, k) => { const p = pos(k), key = gk(...p.map((q) => Math.floor(q / WELD))); (grid.get(key) ?? grid.set(key, []).get(key)).push(k); });
    V.forEach((v, k) => {
      const p = pos(k), c = p.map((q) => Math.floor(q / WELD));
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const o of grid.get(gk(c[0] + dx, c[1] + dy, c[2] + dz)) ?? []) {
        if (o <= k || isHair[V[o][0]] !== isHair[v[0]]) continue;
        const q = pos(o); if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= WELD) par[f(o)] = f(k);
      }
    });
    const sum = new Map();
    V.forEach(([pi, i], k) => { const r = f(k), a = sum.get(r) ?? [0, 0, 0]; for (let c = 0; c < 3; c++) a[c] += N[pi][i * 3 + c]; sum.set(r, a); });
    // 头部中心 = 非马尾头发顶点包围盒中心
    let hc = null;
    prims.forEach((pr, pi) => {
      if (!isHair[pi]) return;
      const J = pr.getAttribute('JOINTS_0'), W = pr.getAttribute('WEIGHTS_0'), n = J.getCount(), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      const ptw = (i) => { const j = J.getElement(i, []), w = W.getElement(i, []); let s = 0; for (let c = 0; c < 4; c++) if (PTJ.includes(j[c])) s += w[c]; return s; };
      pr.__pt = new Uint8Array(n);
      for (let i = 0; i < n; i++) { if (ptw(i) >= 0.5) { pr.__pt[i] = 1; continue; } for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[pi][i * 3 + c]); hi[c] = Math.max(hi[c], P[pi][i * 3 + c]); } }
      hc = lo.map((x, c) => (x + hi[c]) / 2);
    });
    let base = 0;
    prims.forEach((pr, pi) => {
      const n = P[pi].length / 3, C = new Uint8Array(n * 4);
      const mname = pr.getMaterial()?.getName() ?? '';
      const UV = pr.getAttribute('TEXCOORD_0')?.getArray();
      for (let i = 0; i < n; i++) {
        const a = sum.get(f(base + i)); let l = Math.hypot(...a) || 1; let d = a.map((x) => x / l);
        if (isHair[pi]) {
          const p = [P[pi][i * 3], P[pi][i * 3 + 1], P[pi][i * 3 + 2]], o = pr.__pt[i] ? closestOnPolyline(p) : hc;
          const r = p.map((x, c) => x - o[c]), rl = Math.hypot(...r) || 1;
          const m = r.map((x, c) => x / rl + HAIR_OWN * d[c]); l = Math.hypot(...m) || 1; d = m.map((x) => x / l);
          // 不能和顶点法线反向（game vertexColors.ts 校验 >5% 反向判不合格；发缕朝里那半圈）：把朝里的分量补回到 dot ≥ 0.05。
          // 正对头心那一面（r ≈ −n）因此退回自身法线 = 朝头心外扩，壳落在发缕自己身后，不出线
          const nv = [N[pi][i * 3], N[pi][i * 3 + 1], N[pi][i * 3 + 2]], dn = d[0] * nv[0] + d[1] * nv[1] + d[2] * nv[2];
          if (dn < 0.05) { const e = d.map((x, c) => x + (0.05 - dn) * nv[c]); l = Math.hypot(...e) || 1; d = e.map((x) => x / l); }
        }
        for (let c = 0; c < 3; c++) C[i * 4 + c] = Math.round((d[c] * 0.5 + 0.5) * 255);
        let wf = 1.0;
        if (mname === 'mat-char-xi-face') wf = 0.6;
        else if (mname === 'mat-char-xi-hair' && UV) {
          const u = UV[i * 2], v = 1 - UV[i * 2 + 1];                 // glTF v 朝下 → 回到 Blender v（头发块 v' = 0.25·(1 − 0.98 t)）
          const t = Math.min(1, Math.max(0, (1 - v / 0.25) / 0.98));
          wf = u >= 0.40 ? 0.25 : 0.75 - 0.45 * t;                     // u ≥ 0.40 = 碎发卡片列（局部 u 0.80–1.0）
        }
        C[i * 4 + 3] = Math.round(wf * 255);
      }
      delete pr.__pt;
      const old = pr.getAttribute('COLOR_0'); if (old) old.dispose();
      pr.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(C).setNormalized(true).setBuffer(buf));
      base += n;
    });
  }
}
// UV：只有脸保留 TEXCOORD_1（SDF 用）；减面后头发 UV 有 1e-3 级的越界 → 夹到 [0,1]，好让 12 bit 量化生效
for (const mesh of root.listMeshes()) for (const pr of mesh.listPrimitives()) {
  if (!pr.getMaterial().getName().endsWith('face')) { const t1 = pr.getAttribute('TEXCOORD_1'); if (t1) { pr.setAttribute('TEXCOORD_1', null); if (!t1.listParents().some((x) => x !== root)) t1.dispose(); } }
  for (const s of ['TEXCOORD_0', 'TEXCOORD_1']) {
    const a = pr.getAttribute(s); if (!a) continue;
    const arr = a.getArray().slice(); for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, Math.max(0, arr[i]));
    pr.setAttribute(s, doc.createAccessor().setType('VEC2').setArray(arr).setBuffer(buf)); if (!a.listParents().some((x) => x !== root)) a.dispose();
  }
}
// 根节点
const scene = root.listScenes()[0];
let top = scene.listChildren();
let rootNode = top.find((n) => n.getName() === 'char-xi');
if (!rootNode) {
  if (top.length === 1) rootNode = top[0].setName('char-xi');
  else { rootNode = doc.createNode('char-xi'); for (const n of top) { scene.removeChild(n); rootNode.addChild(n); } scene.addChild(rootNode); }
}
rootNode.setExtras({ heightM: 1.5, forward: '+Z', skeleton: 'char-xi' });
for (const s of root.listSkins()) s.setName('char-xi-skeleton');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
// 摘要
const tris = (m) => m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
console.log('wrote', OUT);
for (const n of root.listNodes()) if (n.getMesh()) console.log(`  ${n.getName()}: ${tris(n.getMesh())} tris, prims ${n.getMesh().listPrimitives().map((p) => `${p.getMaterial()?.getName()}[${p.listSemantics().join(',')}]`).join(' ')}`);
console.log('  joints', root.listSkins()[0].listJoints().length, ' socket', !!root.listNodes().find((n) => n.getName() === 'hand_r_socket'));
