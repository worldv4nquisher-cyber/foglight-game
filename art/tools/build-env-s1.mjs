// S1 落潮滩场景大件（需求单 018）程序化建模 → GLB。无需 Blender，只用 game/node_modules 里的 three 与 meshoptimizer。
//   node art/tools/build-env-s1.mjs [--only=name,name] [--embed]
// 输出：art/models/env/*.glb、art/models/props/prop-boat-rowboat*.glb、art/source/env/s1-layout.json
// 约定（v0.1-index §5、style-guide §8 §9）：
//   1 单位 = 1 m，+Y 向上，+Z 朝北（013），右手系 ⇒ 东 = -X、西 = +X。高度基准：退潮水面 y = 0，涨潮水面 y = 1.6（011）。
//   场景大件的局部 y 就是世界高度（摆放时 y 平移 = 0），原点在占地中心的 y = 0 处；摆放见根节点 extras.placement 与 s1-layout.json。
//   每件 <名>_lod0/_lod1/_lod2（每级约减半，meshopt simplify），<名>-collider（简化碰撞，extras.collider），TEXCOORD_1 = 光照贴图 UV2（自动分块 + 打包，不重叠，留 4 px@1024）。
//   COLOR_0 = 平滑法线（外扩描边用，与道具/角色一致）。礁石 a–f 单材质单 primitive，可直接 InstancedMesh。
//   贴图：art/textures/tex-<对象>-{albedo,normal,orm}.webp（外部引用、多件共用；正式交付由 tex-to-ktx2.sh 转 .ktx2，034 替换引用）。--embed 改为内嵌。
//   材质 7 个（018 单子上限 12）：mat-env-rock-shore / mat-env-stone-masonry / mat-env-lighthouse-white（主灯塔，共用石砌法线/ORM）/ mat-env-sand-tidal / mat-env-wood-ch1 / mat-env-net / mat-env-silhouette-far。没有任何自发光。
import * as THREE from '../../game/node_modules/three/build/three.module.js';
import { MeshoptEncoder, MeshoptSimplifier } from '../../game/node_modules/meshoptimizer/index.js';
import { ConvexGeometry } from '../../game/node_modules/three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeVertices } from '../../game/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_TEX = join(ART, 'source/textures');
const OUT_TEX = join(ART, 'textures');
const OUT_ENV = join(ART, 'models/env');
const OUT_PROPS = join(ART, 'models/props');
const EMBED = process.argv.includes('--embed');
// 主灯塔岛（制作人裁定 2026-10-29 13:33）：世界上只有一座灯塔、一种尺寸 → S1 远景正式用 env-lighthouse-island-main-s3tower
//   = 礁丘（不带塔）+ 插槽 lighthouse-ch1-socket，程序在插槽上实例化 020 的 env-lighthouse-ch1（1.0 比例）。
//   旧的烤进塔的 env-lighthouse-island-main（19.7 m 细塔）已退役，默认不再出；--legacy-tower 仅用于对照（只出这一件、不写 s1-layout.json）。
//   --s3tower 保留为默认行为的同义参数。
const LEGACY_TOWER = process.argv.includes('--legacy-tower');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

// =====================================================================================
// 噪声
// =====================================================================================
function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = sm(x - i), fy = sm(y - j), fz = sm(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(i, j, k), hash3(i + 1, j, k), fx), L(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), fx), fy),
    L(L(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), fx), L(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), fx), fy), fz);
}
function fbm(x, y, z, oct = 4, gain = 0.5) {
  let a = 1, s = 0, t = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f + o * 17.3, y * f + o * 9.1, z * f + o * 3.7); t += a; a *= gain; f *= 2.03; }
  return s / t;
}
const ridged = (x, y, z, oct = 4) => 1 - Math.abs(fbm(x, y, z, oct) - 0.5) * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

// =====================================================================================
// 材质 / 贴图
// =====================================================================================
const MATS = {
  rock: { name: 'mat-env-rock-shore', tex: 'tex-rock-shore', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.72, wetRoughness: 0.2, tideMark: 'uTideLevel', triplanarOk: true } },
  masonry: { name: 'mat-env-stone-masonry', tex: 'tex-stone-masonry', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.75, wetRoughness: 0.22, tideMark: 'uTideLevel' } },
  sand: { name: 'mat-env-sand-tidal', tex: 'tex-sand-tidal', tile: 4.0, extras: { tileM: 4.0, wetDarken: 0.78, wetRoughness: 0.15, tideMark: 'uTideLevel' } },
  wood: { name: 'mat-env-wood-ch1', tex: 'tex-wood-ch1', extras: { atlas: true, wetDarken: 0.75, wetRoughness: 0.3, tideMarkPainted: 1.6 } },
  // 返工 1030：低潮版船绳 1.6 潮线以下那段（刚出水的湿绳）：同一张木材图集，只压暗底色、降粗糙度
  ropeWet: { name: 'mat-env-rope-wet-ch1', tex: 'tex-wood-ch1', baseFactor: [0.5, 0.53, 0.53], roughFactor: 0.55, extras: { atlas: true, wet: true, note: '返工 1030：= mat-env-wood-ch1 的绳区 × 底色 0.5 / 粗糙度 0.55（湿绳），只用在 env-pier-wood-ch1-rope-low 的潮线以下段' } },
  net: { name: 'mat-env-net', tex: 'tex-net-a', albedoOnly: true, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true, tile: 0.5, extras: { tileM: 0.5, alphaHint: 'alphaHash', note: '网线远看是亚像素，mip 平均后 alpha<0.5 会整片消失：运行时请用 material.alphaHash=true（或 alphaToCoverage + MSAA），alphaTest 置 0' } },
  white: { name: 'mat-env-lighthouse-white', tex: 'tex-stone-masonry', albedoTex: 'tex-lighthouse-whitewash', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.8, wetRoughness: 0.25, tideMark: 'uTideLevel', note: '主灯塔刷白石砌：法线/ORM 与 mat-env-stone-masonry 共用，只换 albedo' } },
  sil: { name: 'mat-env-silhouette-far', color: '#56616B', extras: { impostor: true, fogLayer: 'far', note: '远景剪影：程序可换成 unlit + 雾色混合' } },
};
// 木材图集分区（与 gen_tex_env_s1.py WOOD_REGIONS 一致），[u0, v0, w, h]，glTF v 向下
const WOOD = {
  deck: [0, 0, 1, 0.5], boat: [0, 0.5, 0.5, 0.25], pile: [0.5, 0.5, 0.25, 0.5], beam: [0.75, 0.5, 0.25, 0.25],
  iron: [0.75, 0.75, 0.25, 0.25], rope: [0, 0.75, 0.25, 0.25], shed: [0.25, 0.75, 0.5, 0.25],
};
const PILE_Y_TOP = 2.6, PILE_Y_BOT = -2.0;
const WPAD = 3 / 2048;
const inReg = (reg, u, v) => { const [u0, v0, w, h] = WOOD[reg]; return [u0 + WPAD + clamp(u, 0, 1) * (w - 2 * WPAD), v0 + WPAD + clamp(v, 0, 1) * (h - 2 * WPAD)]; };

// =====================================================================================
// 几何工具：Part = { pos:Float32Array, nrm, uv, idx:Uint32Array, mat }
// =====================================================================================
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a) => new THREE.Matrix4().makeRotationX(a);
const RY = (a) => new THREE.Matrix4().makeRotationY(a);
const RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
const mul = (...ms) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4());

function fromGeo(g, mat) {
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return { pos: Float32Array.from(g.attributes.position.array), nrm: Float32Array.from(g.attributes.normal.array), uv: Float32Array.from(g.attributes.uv.array), idx: Uint32Array.from(g.index.array), mat };
}
function xform(p, m) {
  const nm = new THREE.Matrix3().getNormalMatrix(m), v = V3();
  for (let i = 0; i < p.pos.length; i += 3) {
    v.fromArray(p.pos, i).applyMatrix4(m).toArray(p.pos, i);
    v.fromArray(p.nrm, i).applyMatrix3(nm).normalize().toArray(p.nrm, i);
  }
  if (m.determinant() < 0) for (let t = 0; t < p.idx.length; t += 3) { const a = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = a; }
  return p;
}
// 规则网格曲面：fn(u, v) → [x, y, z]，u ∈ [0,1]（nu 段），v ∈ [0,1]（nv 段）；flip 翻转朝向
function grid(nu, nv, fn, mat, flip = false) {
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), uv = new Float32Array((nu + 1) * (nv + 1) * 2), idx = new Uint32Array(nu * nv * 6);
  let k = 0;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv); pos.set(p, k * 3); uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv; k++;
  }
  k = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (!flip) idx.set([a, c, b, b, c, d], k); else idx.set([a, b, c, b, d, c], k);
    k += 6;
  }
  const p = { pos, nrm: new Float32Array(pos.length), uv, idx, mat };
  return smoothNormals(p);
}
function smoothNormals(p) {
  const n = p.nrm.fill(0), a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < p.idx.length; t += 3) {
    const i0 = p.idx[t], i1 = p.idx[t + 1], i2 = p.idx[t + 2];
    a.fromArray(p.pos, i0 * 3); b.fromArray(p.pos, i1 * 3); c.fromArray(p.pos, i2 * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a));
    for (const i of [i0, i1, i2]) { n[i * 3] += e1.x; n[i * 3 + 1] += e1.y; n[i * 3 + 2] += e1.z; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return p;
}
// 位置相同的顶点共享法线（对接缝两侧平均），不合并顶点
function weldNormals(p) {
  const key = (i) => `${Math.round(p.pos[i * 3] * 1e4)},${Math.round(p.pos[i * 3 + 1] * 1e4)},${Math.round(p.pos[i * 3 + 2] * 1e4)}`;
  const acc = new Map();
  for (let i = 0; i < p.pos.length / 3; i++) { const k = key(i); const v = acc.get(k) ?? [0, 0, 0]; v[0] += p.nrm[i * 3]; v[1] += p.nrm[i * 3 + 1]; v[2] += p.nrm[i * 3 + 2]; acc.set(k, v); }
  for (let i = 0; i < p.pos.length / 3; i++) { const v = acc.get(key(i)); const l = Math.hypot(...v) || 1; p.nrm[i * 3] = v[0] / l; p.nrm[i * 3 + 1] = v[1] / l; p.nrm[i * 3 + 2] = v[2] / l; }
  return p;
}
// 按角度阈值分组的法线：同位置、面法线夹角 < deg 的三角面才平均 → 折面之间是硬边（礁石/岩岛用）
function hardEdgeNormals(p, deg = 38) {
  const cosT = Math.cos(deg * Math.PI / 180), tri = p.idx.length / 3;
  const fn = new Float32Array(tri * 3), a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < tri; t++) {
    a.fromArray(p.pos, p.idx[t * 3] * 3); b.fromArray(p.pos, p.idx[t * 3 + 1] * 3); c.fromArray(p.pos, p.idx[t * 3 + 2] * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a)); const l = e1.length() || 1; fn[t * 3] = e1.x; fn[t * 3 + 1] = e1.y; fn[t * 3 + 2] = e1.z; // 面积加权
    fn[t * 3] /= 1; void l;
  }
  const key = (i) => `${Math.round(p.pos[i * 3] * 1e4)},${Math.round(p.pos[i * 3 + 1] * 1e4)},${Math.round(p.pos[i * 3 + 2] * 1e4)}`;
  const byPos = new Map(), vtri = new Int32Array(p.pos.length / 3).fill(-1);
  // 先把每个三角面角点拆开（顶点可能被多个面共享）
  const P = [], N = [], U = [], idx = new Uint32Array(p.idx.length);
  for (let t = 0; t < tri; t++) for (let k = 0; k < 3; k++) {
    const i = p.idx[t * 3 + k], j = P.length / 3; idx[t * 3 + k] = j;
    P.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); U.push(p.uv[i * 2], p.uv[i * 2 + 1]);
    const kk = key(i); let L = byPos.get(kk); if (!L) byPos.set(kk, (L = [])); L.push(t); vtri[0] = 0;
  }
  const n = V3(), m = V3(), o = V3();
  for (let t = 0; t < tri; t++) for (let k = 0; k < 3; k++) {
    const i = p.idx[t * 3 + k]; n.set(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]); m.copy(n).normalize(); o.set(0, 0, 0);
    for (const u of byPos.get(key(i))) { n.set(fn[u * 3], fn[u * 3 + 1], fn[u * 3 + 2]); const l = n.length() || 1; if (n.x * m.x / l + n.y * m.y / l + n.z * m.z / l >= cosT) o.add(n); }
    o.normalize(); N.push(o.x, o.y, o.z);
  }
  return weld({ pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx, mat: p.mat });
}
// 盒投影 UV（世界尺度平铺）：按三角面主轴拆点。scale = 每张贴图多少米，off = 随机偏移（让相邻块不重复）
function boxUV(p, scale, off = [0, 0], rot = 0) {
  const tri = p.idx.length / 3;
  const pos = new Float32Array(tri * 9), nrm = new Float32Array(tri * 9), uv = new Float32Array(tri * 6);
  const a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let t = 0; t < tri; t++) {
    const ids = [p.idx[t * 3], p.idx[t * 3 + 1], p.idx[t * 3 + 2]];
    a.fromArray(p.pos, ids[0] * 3); b.fromArray(p.pos, ids[1] * 3); c.fromArray(p.pos, ids[2] * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a));
    const ax = Math.abs(e1.x), ay = Math.abs(e1.y), az = Math.abs(e1.z);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const i = ids[k];
      const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
      let u, v;
      if (axis === 0) { u = (e1.x > 0 ? -z : z); v = -y; } else if (axis === 1) { u = x; v = (e1.y > 0 ? z : -z); } else { u = (e1.z > 0 ? x : -x); v = -y; }
      const ru = u * cr - v * sr, rv = u * sr + v * cr;
      pos.set([x, y, z], (t * 3 + k) * 3); nrm.set(p.nrm.subarray(i * 3, i * 3 + 3), (t * 3 + k) * 3);
      uv[(t * 3 + k) * 2] = ru / scale + off[0]; uv[(t * 3 + k) * 2 + 1] = rv / scale + off[1];
    }
  }
  return weld({ pos, nrm, uv, idx: Uint32Array.from({ length: tri * 3 }, (_, i) => i), mat: p.mat });
}
// 合并完全相同的顶点（pos + nrm + uv）
function weld(p) {
  const map = new Map(), remap = new Uint32Array(p.pos.length / 3);
  const P = [], N = [], U = [];
  for (let i = 0; i < p.pos.length / 3; i++) {
    const k = `${Math.round(p.pos[i * 3] * 1e5)},${Math.round(p.pos[i * 3 + 1] * 1e5)},${Math.round(p.pos[i * 3 + 2] * 1e5)},${Math.round(p.nrm[i * 3] * 1e3)},${Math.round(p.nrm[i * 3 + 1] * 1e3)},${Math.round(p.nrm[i * 3 + 2] * 1e3)},${Math.round(p.uv[i * 2] * 1e5)},${Math.round(p.uv[i * 2 + 1] * 1e5)}`;
    let j = map.get(k);
    if (j === undefined) { j = P.length / 3; map.set(k, j); P.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); N.push(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]); U.push(p.uv[i * 2], p.uv[i * 2 + 1]); }
    remap[i] = j;
  }
  const idx = new Uint32Array(p.idx.length);
  for (let i = 0; i < idx.length; i++) idx[i] = remap[p.idx[i]];
  return { pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx, mat: p.mat };
}
// 盒子（可分段），返回带面法线的 Part；uvFn(face, lx, ly, lz) → [u,v]（局部坐标，盒中心为原点）
function box(w, h, d, mat, seg = [1, 1, 1]) {
  return fromGeo(new THREE.BoxGeometry(w, h, d, ...seg), mat);
}
// 带倒角的石块（RoundedBox 思路的简化：盒子 + 顶点按到棱的距离收进），noiseAmp 为凿面起伏
function stoneBlock(w, h, d, bev, seed, noiseAmp = 0.006, seg = null) {
  const sx = seg?.[0] ?? Math.max(2, Math.round(w / 0.12)), sy = seg?.[1] ?? Math.max(2, Math.round(h / 0.12)), sz = seg?.[2] ?? Math.max(2, Math.round(d / 0.12));
  const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  const pa = g.attributes.position;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    // 倒角：把靠近边缘的点往里收（球面化到内盒 + bev）
    const ix = clamp(x, -hw + bev, hw - bev), iy = clamp(y, -hh + bev, hh - bev), iz = clamp(z, -hd + bev, hd - bev);
    let dx = x - ix, dy = y - iy, dz = z - iz; const l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) { const s = bev / l; x = ix + dx * s; y = iy + dy * s; z = iz + dz * s; }
    const n = (fbm(x * 3 + seed, y * 3, z * 3, 3) - 0.5) * 2 * noiseAmp + (fbm(x * 11, y * 11 + seed, z * 11, 2) - 0.5) * noiseAmp * 0.5;
    const ln = Math.hypot(x, y, z) || 1;
    pa.setXYZ(i, x + (x / ln) * n, y + (y / ln) * n, z + (z / ln) * n);
  }
  g.deleteAttribute('normal'); g.computeVertexNormals();
  // BoxGeometry 各面独立顶点 → 倒角后同位置点需共享法线才圆润
  const p = fromGeo(g, 'masonry');
  return weldNormals(p);
}
// 管子（绳子 / 圆木）
function tubePart(pts, r, seg, rad, mat, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => V3(...q)), closed, 'catmullrom', 0.5);
  return fromGeo(new THREE.TubeGeometry(curve, seg, r, rad, closed), mat);
}
// 返工 1030 第二轮：绳的股纹按全长铺（以前 u × 4…20 被 inReg 夹到 0..1，只有开头一小段有股纹）。
// 图集绳区 u 0..1 = 一整条股纹，密度 ROPE_TILE_M 米 / 区（= 低潮绳全长 2.72 m）。长绳切成整数段管截面的几块，每块各自 0..1。
// 做法：建模时 uv.x 先存「1000 + 沿绳坐标（单位 = 块）」、拓扑与以前完全一样 → LOD 简化结果不变；
// 简化之后再由 fixRopeUV 按三角面所在块复制顶点、映射进图集（位置不变）。
const ROPE_TILE_M = 2.72, ROPE_MARK = 1000;
function ropeTube(pts, r, seg, rad, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => V3(...q)), closed, 'catmullrom', 0.5);
  const p = fromGeo(new THREE.TubeGeometry(curve, seg, r, rad, closed), 'wood'), len = curve.getLength();
  const tile = len <= ROPE_TILE_M ? ROPE_TILE_M : (Math.max(1, Math.floor((seg * ROPE_TILE_M) / len)) * len) / seg; // 块边界落在管截面环上
  for (let i = 0; i < p.uv.length; i += 2) p.uv[i] = ROPE_MARK + (p.uv[i] * len) / tile;
  return p;
}
function ropeRing(p, circ) { for (let i = 0; i < p.uv.length; i += 2) p.uv[i] = ROPE_MARK + (p.uv[i] * circ) / ROPE_TILE_M; return p; }
function fixRopeUV(prims) {
  return prims.map((p) => {
    const nv = p.pos.length / 3, P = [...p.pos], N = [...p.nrm], U = [...p.uv], I = Array.from(p.idx), dup = new Map();
    let n = nv;
    for (let t = 0; t < I.length; t += 3) {
      const tri = [I[t], I[t + 1], I[t + 2]];
      if (!tri.some((i) => p.uv[i * 2] >= ROPE_MARK / 2)) continue;
      const k = Math.floor(tri.reduce((s, i) => s + p.uv[i * 2] - ROPE_MARK, 0) / 3);
      for (let c = 0; c < 3; c++) {
        const i = tri[c], key = i * 64 + k; let j = dup.get(key);
        if (j === undefined) {
          j = n++; dup.set(key, j);
          P.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); N.push(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]);
          U.push(...inReg('rope', p.uv[i * 2] - ROPE_MARK - k, p.uv[i * 2 + 1]));
        }
        I[t + c] = j;
      }
    }
    const out = compact({ mat: p.mat, pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U) }, Uint32Array.from(I)); // 去掉不再被引用的原绳顶点
    return out;
  });
}
function lathePart(prof, seg, mat) { return fromGeo(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), seg), mat); }
// 木材图集映射：按局部长轴（x）做 u，适合横梁、木板
function mapWoodBox(p, reg, L, W, opt = {}) {
  // p 为局部坐标（长 L 沿 x，居中），W = 截面尺寸（用于 v）
  const uLen = opt.uLen ?? 2.0, uOff = opt.uOff ?? 0, strip = opt.strip;
  for (let i = 0; i < p.pos.length / 3; i++) {
    const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2];
    const nx = Math.abs(p.nrm[i * 3]), ny = Math.abs(p.nrm[i * 3 + 1]);
    const along = (x + L / 2) / uLen + uOff;
    let across = ny > 0.5 ? z / W + 0.5 : y / W + 0.5;
    if (nx > 0.7) across = z / W + 0.5;
    let uu, vv;
    if (strip !== undefined) {
      const s0 = strip / 8;
      [uu, vv] = inReg(reg, along, s0 + clamp(across, 0.04, 0.96) / 8);
    } else [uu, vv] = inReg(reg, along % 1.0001, clamp(across, 0, 1));
    p.uv[i * 2] = uu; p.uv[i * 2 + 1] = vv;
  }
  return p;
}
function mapUVRegion(p, reg, fn) {
  for (let i = 0; i < p.pos.length / 3; i++) {
    const [u, v] = fn(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2], p.uv[i * 2], p.uv[i * 2 + 1], i);
    [p.uv[i * 2], p.uv[i * 2 + 1]] = inReg(reg, u, v);
  }
  return p;
}
const clone = (p) => ({ pos: p.pos.slice(), nrm: p.nrm.slice(), uv: p.uv.slice(), idx: p.idx.slice(), mat: p.mat });

// 按材质合并
function mergeParts(parts) {
  const mats = [...new Set(parts.map((p) => p.mat))];
  return mats.map((mat) => {
    const ps = parts.filter((p) => p.mat === mat);
    const nv = ps.reduce((s, p) => s + p.pos.length / 3, 0), ni = ps.reduce((s, p) => s + p.idx.length, 0);
    const out = { mat, pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), idx: new Uint32Array(ni) };
    let vo = 0, io = 0;
    for (const p of ps) {
      out.pos.set(p.pos, vo * 3); out.nrm.set(p.nrm, vo * 3); out.uv.set(p.uv, vo * 2);
      for (let i = 0; i < p.idx.length; i++) out.idx[io + i] = p.idx[i] + vo;
      vo += p.pos.length / 3; io += p.idx.length;
    }
    return dropDegenerate(out);
  });
}
function dropDegenerate(p) {
  const keep = [], a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < p.idx.length; t += 3) {
    a.fromArray(p.pos, p.idx[t] * 3); b.fromArray(p.pos, p.idx[t + 1] * 3); c.fromArray(p.pos, p.idx[t + 2] * 3);
    if (e1.subVectors(b, a).cross(e2.subVectors(c, a)).lengthSq() > 1e-14) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
  }
  p.idx = Uint32Array.from(keep);
  return p;
}
const triCount = (prims) => prims.reduce((s, p) => s + p.idx.length / 3, 0);

// =====================================================================================
// LOD（meshopt simplify）
// =====================================================================================
function compact(p, idx) {
  const remap = new Int32Array(p.pos.length / 3).fill(-1); let n = 0;
  for (const i of idx) if (remap[i] < 0) remap[i] = n++;
  const out = { mat: p.mat, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2), idx: new Uint32Array(idx.length) };
  for (let i = 0; i < remap.length; i++) if (remap[i] >= 0) {
    const j = remap[i]; out.pos.set(p.pos.subarray(i * 3, i * 3 + 3), j * 3); out.nrm.set(p.nrm.subarray(i * 3, i * 3 + 3), j * 3); out.uv.set(p.uv.subarray(i * 2, i * 2 + 2), j * 2);
  }
  for (let i = 0; i < idx.length; i++) out.idx[i] = remap[idx[i]];
  return out;
}
function simplifyPrim(p, ratio, opt = {}) {
  const target = Math.max(3, Math.floor((p.idx.length * ratio) / 3) * 3);
  let best = p.idx;
  for (const err of [0.001, 0.002, 0.004, 0.008, 0.016, 0.03, 0.06, 0.12]) {
    const flags = opt.lockBorder ? ['LockBorder'] : ['Prune'];
    const [idx] = MeshoptSimplifier.simplify(p.idx, p.pos, 3, target, err, flags);
    best = idx;
    if (idx.length <= target * 1.04) break;
  }
  if (best.length > target * 1.15) { // 拓扑上降不下去（很多独立小件）→ sloppy 兜底
    const [idx] = MeshoptSimplifier.simplifySloppy(p.idx, p.pos, 3, null, target, 0.05);
    if (idx.length > 0) best = idx;
  }
  return compact(p, best);
}

// =====================================================================================
// UV2：自动分块（主轴 + 连通）→ 平面投影 → 货架打包（不重叠，留 pad 像素）
// =====================================================================================
function addUV2(prims, texSize = 1024, pad = 4, opt = {}) {
  const keyId = new Map(); let nid = 0;
  const vid = prims.map((p) => {
    const a = new Uint32Array(p.pos.length / 3);
    for (let i = 0; i < a.length; i++) {
      const k = `${Math.round(p.pos[i * 3] * 2e3)},${Math.round(p.pos[i * 3 + 1] * 2e3)},${Math.round(p.pos[i * 3 + 2] * 2e3)}`;
      let id = keyId.get(k); if (id === undefined) { id = nid++; keyId.set(k, id); } a[i] = id;
    }
    return a;
  });
  const faces = []; // {p, t, axis}
  const a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  prims.forEach((p, pi) => {
    for (let t = 0; t < p.idx.length / 3; t++) {
      a.fromArray(p.pos, p.idx[t * 3] * 3); b.fromArray(p.pos, p.idx[t * 3 + 1] * 3); c.fromArray(p.pos, p.idx[t * 3 + 2] * 3);
      e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
      // 分块方向用「面法线 + 顶点平滑法线」的平均，噪声曲面上不会碎成一片片
      for (let k = 0; k < 3; k++) { const i = p.idx[t * 3 + k]; e1.x += p.nrm[i * 3]; e1.y += p.nrm[i * 3 + 1]; e1.z += p.nrm[i * 3 + 2]; }
      const ax = Math.abs(e1.x), ay = Math.abs(e1.y), az = Math.abs(e1.z);
      const axis = ax >= ay && ax >= az ? (e1.x > 0 ? 0 : 1) : ay >= az ? (e1.y > 0 ? 2 : 3) : (e1.z > 0 ? 4 : 5);
      faces.push(pi, t, axis);
    }
  });
  const F = faces.length / 3;
  const edge = new Map();
  const fv = (f, k) => vid[faces[f * 3]][prims[faces[f * 3]].idx[faces[f * 3 + 1] * 3 + k]];
  for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) {
    const x = fv(f, k), y = fv(f, (k + 1) % 3); const key = Math.min(x, y) * 4194304 + Math.max(x, y);
    const l = edge.get(key); if (l) l.push(f); else edge.set(key, [f]);
  }
  const chart = new Int32Array(F).fill(-1); let nc = 0;
  const stack = [];
  for (let f0 = 0; f0 < F; f0++) {
    if (chart[f0] >= 0) continue;
    chart[f0] = nc; stack.push(f0);
    while (stack.length) {
      const f = stack.pop();
      for (let k = 0; k < 3; k++) {
        const x = fv(f, k), y = fv(f, (k + 1) % 3); const key = Math.min(x, y) * 4194304 + Math.max(x, y);
        for (const g of edge.get(key)) if (chart[g] < 0 && faces[g * 3 + 2] === faces[f * 3 + 2]) { chart[g] = nc; stack.push(g); }
      }
    }
    nc++;
  }
  // 投影 + 包围盒
  const proj = (axis, x, y, z) => (axis < 2 ? [axis === 0 ? -z : z, y] : axis < 4 ? [x, axis === 2 ? -z : z] : [axis === 4 ? x : -x, y]);
  const cb = Array.from({ length: nc }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  const corner = new Float32Array(F * 6);
  for (let f = 0; f < F; f++) {
    const p = prims[faces[f * 3]], t = faces[f * 3 + 1], axis = faces[f * 3 + 2], bb = cb[chart[f]];
    for (let k = 0; k < 3; k++) {
      const i = p.idx[t * 3 + k];
      const [u, v] = proj(axis, p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      corner[f * 6 + k * 2] = u; corner[f * 6 + k * 2 + 1] = v;
      bb[0] = Math.min(bb[0], u); bb[1] = Math.min(bb[1], v); bb[2] = Math.max(bb[2], u); bb[3] = Math.max(bb[3], v);
    }
  }
  // 最终打磨（只给 opt.rotate 的资产用，默认关 → 其他资产 UV2 不变）：竖长分块转 90°（u↔v 互换），货架按行高排得更满
  if (opt.rotate) {
    const rot = cb.map((bb) => bb[3] - bb[1] > bb[2] - bb[0]);
    for (let f = 0; f < F; f++) if (rot[chart[f]]) for (let k = 0; k < 3; k++) { const u = corner[f * 6 + k * 2]; corner[f * 6 + k * 2] = corner[f * 6 + k * 2 + 1]; corner[f * 6 + k * 2 + 1] = u; }
    cb.forEach((bb, ci) => { if (rot[ci]) { const [a0, b0, a1, b1] = bb; bb[0] = b0; bb[1] = a0; bb[2] = b1; bb[3] = a1; } });
  }
  const order = [...Array(nc).keys()].sort((x, y) => (cb[y][3] - cb[y][1]) - (cb[x][3] - cb[x][1]));
  const place = new Float32Array(nc * 2);
  const tryPack = (s) => {
    let x = 0, y = 0, rowH = 0;
    for (const ci of order) {
      const w = Math.ceil((cb[ci][2] - cb[ci][0]) * s) + 2 * pad, h = Math.ceil((cb[ci][3] - cb[ci][1]) * s) + 2 * pad;
      if (w > texSize) return false;
      if (x + w > texSize) { x = 0; y += rowH; rowH = 0; }
      place[ci * 2] = x; place[ci * 2 + 1] = y; x += w; rowH = Math.max(rowH, h);
      if (y + rowH > texSize) return false;
    }
    return true;
  };
  let lo = 0.01, hi = 4096;
  for (let it = 0; it < 30; it++) { const m = Math.sqrt(lo * hi); if (tryPack(m)) lo = m; else hi = m; }
  tryPack(lo);
  const S = lo;
  // 拆点：每个 (原顶点, 分块) 一个新顶点
  const out = prims.map((p) => ({ mat: p.mat, P: [], N: [], U: [], U2: [], I: [], map: new Map() }));
  for (let f = 0; f < F; f++) {
    const pi = faces[f * 3], p = prims[pi], t = faces[f * 3 + 1], ci = chart[f], o = out[pi];
    for (let k = 0; k < 3; k++) {
      const i = p.idx[t * 3 + k], key = i * 65536 + (ci % 65536) + Math.floor(ci / 65536) * 1e12;
      let j = o.map.get(key);
      if (j === undefined) {
        j = o.P.length / 3; o.map.set(key, j);
        o.P.push(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); o.N.push(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]); o.U.push(p.uv[i * 2], p.uv[i * 2 + 1]);
        const u = corner[f * 6 + k * 2], v = corner[f * 6 + k * 2 + 1];
        o.U2.push((place[ci * 2] + pad + (u - cb[ci][0]) * S) / texSize, (place[ci * 2 + 1] + pad + (v - cb[ci][1]) * S) / texSize);
      }
      o.I.push(j);
    }
  }
  const res = out.map((o) => ({ mat: o.mat, pos: new Float32Array(o.P), nrm: new Float32Array(o.N), uv: new Float32Array(o.U), uv2: new Float32Array(o.U2), idx: new Uint32Array(o.I) }));
  res.lightmap = { size: texSize, charts: nc, texelsPerM: +S.toFixed(1) };
  return res;
}
// 高度场专用 UV2：俯视平面投影（地形不会自重叠）
function planarUV2(prims, minX, minZ, size, texSize = 2048, pad = 4) {
  const k = (texSize - 2 * pad) / texSize;
  const res = prims.map((p) => {
    const uv2 = new Float32Array((p.pos.length / 3) * 2);
    for (let i = 0; i < p.pos.length / 3; i++) { uv2[i * 2] = pad / texSize + ((p.pos[i * 3] - minX) / size) * k; uv2[i * 2 + 1] = pad / texSize + ((p.pos[i * 3 + 2] - minZ) / size) * k; }
    return { ...p, uv2 };
  });
  res.lightmap = { size: texSize, charts: 1, texelsPerM: +((texSize - 2 * pad) / size).toFixed(1) };
  return res;
}

// =====================================================================================
// 平滑法线 → COLOR_0；顶点缓存优化
// =====================================================================================
function outlineColors(prims) {
  const key = (p, i) => `${Math.round(p[i * 3] * 1e4)},${Math.round(p[i * 3 + 1] * 1e4)},${Math.round(p[i * 3 + 2] * 1e4)}`;
  const acc = new Map();
  const a = V3(), b = V3(), c = V3(), ab = V3(), ac = V3();
  for (const { pos, idx } of prims) for (let t = 0; t < idx.length; t += 3) {
    a.fromArray(pos, idx[t] * 3); b.fromArray(pos, idx[t + 1] * 3); c.fromArray(pos, idx[t + 2] * 3);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    for (let k = 0; k < 3; k++) { const kk = key(pos, idx[t + k]); const v = acc.get(kk); if (v) v.add(n); else acc.set(kk, n.clone()); }
  }
  for (const p of prims) {
    const n = p.pos.length / 3, col = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = (acc.get(key(p.pos, i)) ?? V3(0, 1, 0)).clone();
      if (v.lengthSq() < 1e-20) v.set(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]);
      v.normalize();
      // 位置共享但朝向相反的面（薄铁片、简化后塌缩的小件）会把平滑法线抵消甚至翻转：退回顶点法线
      if (v.x * p.nrm[i * 3] + v.y * p.nrm[i * 3 + 1] + v.z * p.nrm[i * 3 + 2] < 0.1) v.set(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]).normalize();
      col[i * 4] = Math.round((v.x * 0.5 + 0.5) * 255); col[i * 4 + 1] = Math.round((v.y * 0.5 + 0.5) * 255); col[i * 4 + 2] = Math.round((v.z * 0.5 + 0.5) * 255); col[i * 4 + 3] = 255;
    }
    p.col = col;
  }
}
function reorder(p) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(p.idx, true, true);
  const out = (src, k, Ty) => { const d = new Ty(unique * k); for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let j = 0; j < k; j++) d[remap[i] * k + j] = src[i * k + j]; return d; };
  p.pos = out(p.pos, 3, Float32Array); p.nrm = out(p.nrm, 3, Float32Array); p.uv = out(p.uv, 2, Float32Array);
  if (p.uv2) p.uv2 = out(p.uv2, 2, Float32Array);
  if (p.col) p.col = out(p.col, 4, Uint8Array);
}

// =====================================================================================
// 贴图：PNG 源 → art/textures/*.webp（外部共用）
// =====================================================================================
const texDone = new Set();
function texFile(tex, kind) {
  const name = `${tex}-${kind}`;
  const dst = join(OUT_TEX, `${name}.webp`);
  if (!texDone.has(name)) {
    const src = join(SRC_TEX, `${name}.png`);
    if (!existsSync(dst) || (existsSync(src) && statSync(dst).mtimeMs < statSync(src).mtimeMs)) {
      const q = kind === 'albedo' ? 90 : 95;
      const lossless = kind === 'albedo' && tex === 'tex-net-a' ? ', lossless=True' : '';
      execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(src)}).save(${JSON.stringify(dst)}, 'WEBP', quality=${q}, method=6${lossless})`]);
    }
    texDone.add(name);
  }
  return dst;
}
const srgbToLinear = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

// =====================================================================================
// GLB 写出：根节点 → <名>_lodN、<名>-collider、辅助空节点
// =====================================================================================
function writeGlb(asset, path) {
  const json = {
    asset: { version: '2.0', generator: 'game-studio art/tools/build-env-s1.mjs' },
    scene: 0, scenes: [{ name: asset.name, nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
    buffers: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'], extensionsRequired: ['EXT_meshopt_compression', 'EXT_texture_webp'],
  };
  const chunks = []; let off = 0; let fallback = 0;
  const pushBin = (u8) => { const o = off; chunks.push(u8); off += u8.byteLength; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } return o; };
  const view = (u8, stride, count, mode, target) => {
    const bv = { buffer: 1, byteOffset: fallback, byteLength: u8.byteLength };
    if (stride && mode === 'ATTRIBUTES') bv.byteStride = stride;
    if (target) bv.target = target;
    const enc = MeshoptEncoder.encodeGltfBuffer(u8, count, stride, mode, 0);
    fallback += Math.ceil(u8.byteLength / 4) * 4;
    bv.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: pushBin(enc), byteLength: enc.byteLength, byteStride: stride, count, mode } };
    json.bufferViews.push(bv); return json.bufferViews.length - 1;
  };
  const acc = (o) => { json.accessors.push(o); return json.accessors.length - 1; };
  const u8 = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);

  const texIndex = new Map();
  const tex = (file, wrap) => {
    const k = file + wrap;
    if (texIndex.has(k)) return texIndex.get(k);
    let img;
    if (EMBED) img = json.images.push({ name: file.split('/').pop().replace('.webp', ''), bufferView: json.bufferViews.push({ buffer: 0, byteOffset: pushBin(readFileSync(file)), byteLength: readFileSync(file).byteLength }) - 1, mimeType: 'image/webp' }) - 1;
    else img = json.images.push({ name: file.split('/').pop().replace('.webp', ''), uri: relative(dirname(path), file).split('\\').join('/'), mimeType: 'image/webp' }) - 1;
    const ti = json.textures.push({ sampler: wrap ? 0 : 1, extensions: { EXT_texture_webp: { source: img } } }) - 1;
    texIndex.set(k, ti); return ti;
  };
  const matIndex = {};
  const mats = [...new Set([...asset.lods.flat(), ...(asset.meshNodes ?? []).flatMap((n) => n.prims)].map((p) => p.mat))];
  for (const m of mats) {
    const M = MATS[m]; const wrap = !WOOD[m] && m !== 'wood' && m !== 'ropeWet';
    const mat = { name: M.name, extras: { ...M.extras } };
    if (M.color) mat.pbrMetallicRoughness = { baseColorFactor: [...srgbToLinear(M.color), 1], metallicFactor: 0, roughnessFactor: 1 };
    else if (M.albedoOnly) mat.pbrMetallicRoughness = { baseColorTexture: { index: tex(texFile(M.tex, 'albedo'), wrap) }, metallicFactor: 0, roughnessFactor: 0.9 };
    else {
      const orm = tex(texFile(M.tex, 'orm'), wrap);
      mat.pbrMetallicRoughness = { baseColorTexture: { index: tex(texFile(M.albedoTex ?? M.tex, 'albedo'), wrap) }, metallicRoughnessTexture: { index: orm }, metallicFactor: 1, roughnessFactor: M.roughFactor ?? 1 };
      if (M.baseFactor) mat.pbrMetallicRoughness.baseColorFactor = [...M.baseFactor, 1];
      mat.normalTexture = { index: tex(texFile(M.tex, 'normal'), wrap), scale: 1 };
      mat.occlusionTexture = { index: orm, strength: 1 };
    }
    if (M.alphaMode) { mat.alphaMode = M.alphaMode; mat.alphaCutoff = M.alphaCutoff; }
    if (M.doubleSided) mat.doubleSided = true;
    matIndex[m] = json.materials.push(mat) - 1;
  }
  const meshPrim = (p, withMat = true) => {
    const n = p.pos.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.pos[i * 3 + k]); max[k] = Math.max(max[k], p.pos[i * 3 + k]); }
    const idx = n < 65536 ? new Uint16Array(p.idx) : p.idx;
    const attributes = { POSITION: acc({ bufferView: view(u8(p.pos), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3', min, max }) };
    if (withMat) {
      attributes.NORMAL = acc({ bufferView: view(u8(p.nrm), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3' });
      attributes.TEXCOORD_0 = acc({ bufferView: view(u8(p.uv), 8, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC2' });
      if (p.uv2) attributes.TEXCOORD_1 = acc({ bufferView: view(u8(p.uv2), 8, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC2' });
      if (p.col) attributes.COLOR_0 = acc({ bufferView: view(u8(p.col), 4, n, 'ATTRIBUTES', 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
    }
    const indices = acc({ bufferView: view(u8(idx), idx.BYTES_PER_ELEMENT, p.idx.length, 'TRIANGLES', 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' });
    const prim = { attributes, indices, mode: 4 };
    if (withMat) prim.material = matIndex[p.mat];
    return prim;
  };
  const root = { name: asset.name, children: [], extras: { ...asset.extras } };
  json.nodes.push(root);
  asset.lods.forEach((prims, li) => {
    const mi = json.meshes.push({ name: `${asset.name}_lod${li}`, primitives: prims.map((p) => meshPrim(p)) }) - 1;
    const node = { name: `${asset.name}_lod${li}`, mesh: mi };
    if (prims.lightmap) node.extras = { lightmap: prims.lightmap };
    root.children.push(json.nodes.push(node) - 1);
  });
  // 返工 1030：可切换的独立网格节点（不分 LOD，如船绳高/低潮两版）
  for (const mn of asset.meshNodes ?? []) {
    const mi = json.meshes.push({ name: mn.name, primitives: mn.prims.map((p) => meshPrim(p)) }) - 1;
    root.children.push(json.nodes.push({ name: mn.name, mesh: mi, extras: mn.extras }) - 1);
  }
  if (asset.collider) {
    const mi = json.meshes.push({ name: `${asset.name}-collider`, primitives: [meshPrim(asset.collider, false)] }) - 1;
    root.children.push(json.nodes.push({ name: `${asset.name}-collider`, mesh: mi, extras: { collider: true } }) - 1);
  }
  for (const em of asset.extraMeshes ?? []) {
    const mi = json.meshes.push({ name: em.name, primitives: [meshPrim(em.mesh, false)] }) - 1;
    root.children.push(json.nodes.push({ name: em.name, mesh: mi, extras: em.extras }) - 1);
  }
  for (const h of asset.helpers ?? []) {
    const node = { name: h.name, translation: h.t.map((v) => +v.toFixed(4)) };
    if (h.r) node.rotation = h.r.map((v) => +v.toFixed(6));
    if (h.extras) node.extras = h.extras;
    root.children.push(json.nodes.push(node) - 1);
  }
  json.buffers.push({ byteLength: off }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } });
  const bin = new Uint8Array(off); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(total, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  writeFileSync(path, Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), Buffer.from(bin)]));
  return total;
}
// 碰撞体工具：多个 Part / 盒子合成一个只有位置的网格
function colliderFrom(parts) {
  const P = [], I = [];
  for (const p of parts) { const base = P.length / 3; P.push(...p.pos); for (const i of p.idx) I.push(base + i); }
  return { pos: new Float32Array(P), idx: new Uint32Array(I) };
}
function colBox(cx, cy, cz, w, h, d, rotY = 0) { return xform(box(w, h, d, 'x'), mul(T(cx, cy, cz), RY(rotY))); }
function hull(points) { return fromGeo(new ConvexGeometry(points.map((p) => V3(...p))), 'x'); }
const quatLookY = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
function quatLookAt(from, to) {
  // 节点 +Z 指向 to（glTF 相机看 -Z；这里约定 -cam 节点的 -Z 看向目标，与 three 相机一致）
  const m = new THREE.Matrix4().lookAt(V3(...from), V3(...to), V3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

// =====================================================================================
// 收尾：LOD → UV2 → 描边色 → 顶点重排 → 写 GLB
// =====================================================================================
const REPORT = [];
const LAYOUT = { note: '', instances: [], nodes: {} };
function finishAsset(a) {
  const t0 = Date.now();
  const lod0 = a.lod0 ?? a.lods?.[0] ?? mergeParts(a.parts);
  // 原点：占地中心、y = 0（a.origin 可覆盖）；所有内容平移到局部
  let origin = a.origin;
  if (!origin) {
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const p of lod0) for (let i = 0; i < p.pos.length; i += 3) { mnx = Math.min(mnx, p.pos[i]); mxx = Math.max(mxx, p.pos[i]); mnz = Math.min(mnz, p.pos[i + 2]); mxz = Math.max(mxz, p.pos[i + 2]); }
    origin = [+((mnx + mxx) / 2).toFixed(2), 0, +((mnz + mxz) / 2).toFixed(2)];
  }
  const shift = (arr) => { for (let i = 0; i < arr.length; i += 3) { arr[i] -= origin[0]; arr[i + 1] -= origin[1]; arr[i + 2] -= origin[2]; } };
  let lods = a.lods ?? [lod0, lod0.map((p) => simplifyPrim(p, 0.5, a)), lod0.map((p) => simplifyPrim(p, 0.25, a))];
  if (a.lodCount === 1) lods = [lod0];
  for (const l of lods) for (const p of l) shift(p.pos);
  if (a.collider) shift(a.collider.pos);
  for (const w of a.walls ?? []) shift(w.pos);
  const meshNodes = (a.meshNodes ?? []).map((mn) => {
    const prims = mergeParts(mn.parts); for (const p of prims) shift(p.pos);
    const r = addUV2(prims, mn.uv2Size ?? 256); outlineColors(r); r.forEach(reorder);
    return { name: mn.name, prims: r, extras: mn.extras };
  });
  const helpers = (a.helpers ?? []).map((h) => ({ ...h, t: [h.t[0] - origin[0], h.t[1] - origin[1], h.t[2] - origin[2]] }));
  lods = lods.map((l) => {
    const r = a.uv2Planar ? planarUV2(l, a.uv2Planar[0] - origin[0], a.uv2Planar[1] - origin[2], a.uv2Planar[2], 2048) : addUV2(l, a.uv2Size ?? 1024, 4, { rotate: !!a.uv2Rotate });
    outlineColors(r); r.forEach(reorder); return r;
  });
  const placement = a.placement ?? { translation: origin, rotationY: 0 };
  const extras = { ...(a.extras ?? {}), placement, units: 'm', upAxis: '+Y', north: '+Z', east: '-X', tide: { low: 0, high: 1.6 } };
  const asset = { name: a.name, lods, collider: a.collider, helpers, extras, meshNodes };
  const path = join(a.outDir ?? OUT_ENV, `${a.name}.glb`);
  const bytes = writeGlbWithWalls(asset, a.walls, path);
  const tris = lods.map(triCount);
  for (const mn of meshNodes) console.log(`  + ${mn.name}: ${triCount(mn.prims)} tris（${mn.prims.map((p) => MATS[p.mat].name).join(' + ')}）`);
  REPORT.push({ name: a.name, tris, mats: [...new Set(lods[0].map((p) => MATS[p.mat].name))], bytes, colliderTris: a.collider ? a.collider.idx.length / 3 : 0, lightmap: lods[0].lightmap, secs: ((Date.now() - t0) / 1000).toFixed(1) });
  LAYOUT.nodes[a.name] = { file: relative(ART, path), ...placement };
  console.log(`${a.name}: lod ${tris.join(' / ')} tris, ${(bytes / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return asset;
}
// -wall：不可见空气墙（002 约定），与 collider 一样只有位置
function writeGlbWithWalls(asset, walls, path) {
  if (!walls?.length) return writeGlb(asset, path);
  return writeGlb({ ...asset, extraMeshes: [{ name: `${asset.name}-wall`, mesh: colliderFrom(walls), extras: { wall: true } }] }, path);
}

// =====================================================================================
// 礁石 a–f：随机切面多面体 + fbm + 层理，底部压平，原点在底面中心
// =====================================================================================
const ROCKS = {
  a: { size: [0.78, 0.5, 0.62], seed: 11, planes: 9, top: 0.56, tilt: 0.04, detail: 26, use: '小径石板（顶面平，可走）' },
  b: { size: [0.62, 0.46, 0.55], seed: 23, planes: 8, top: 0.5, tilt: 0.06, detail: 22, use: '小径石板（小号）' },
  c: { size: [1.0, 0.54, 0.55], seed: 37, planes: 10, top: 0.58, tilt: 0.03, detail: 26, use: '小径石板（长条）' },
  d: { size: [0.9, 0.68, 0.78], seed: 41, planes: 11, detail: 24, use: '圆礁石（装饰 / 垫脚）' },
  e: { size: [0.75, 1.65, 0.65], seed: 53, planes: 10, strata: 0.22, detail: 28, use: '立石 / 石柱（装饰，远处剪影）' },
  f: { size: [2.6, 1.15, 2.0], seed: 67, planes: 14, top: 0.7, tilt: 0.08, strata: 0.18, detail: 36, use: '大礁盘（装饰 / 地形补缝）' },
};
// 018 第一部分（11:40）：去圆润。整块全切面（不再 lerp 回球面）+ 平行层理（每层退进/凸出不一 → 台阶状侧面）
// + 几道裂缝（V 形凹槽，只裂一段）+ 细凿面噪声；法线按 38° 分组 → 折面之间是硬边。顶面（a/b/c/f 的可走面）保持平。
function makeRockC(c, opt = {}) {
  const R = rng(c.seed * 7919);
  let g = new THREE.IcosahedronGeometry(1, c.detail); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5);
  const planes = [];
  const nPl = Math.round(c.planes * 1.8) + 4;
  for (let k = 0; k < nPl; k++) {
    const th = R() * Math.PI * 2, ph = Math.acos(R() * 1.7 - 0.85);
    planes.push([V3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)), 0.66 + R() * 0.26]);
  }
  if (c.top) planes.push([V3(Math.sin(c.tilt), 1, Math.cos(R() * 6) * c.tilt).normalize(), c.top]);
  // 层理：略倾斜的层面，层厚 strataH（相对单位），每层随机退进
  const bedTh = R() * 6.28, bedTilt = 0.12 + R() * 0.25;
  const bed = V3(Math.sin(bedTilt) * Math.cos(bedTh), Math.cos(bedTilt), Math.sin(bedTilt) * Math.sin(bedTh));
  const strataH = c.strataH ?? (c.strata ? c.strata * 0.9 : 0.2);
  const cracks = [];
  for (let k = 0; k < (c.cracks ?? 3); k++) {
    const th = R() * Math.PI * 2, ph = Math.acos(R() * 1.2 - 0.6);
    cracks.push({ n: V3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.5, Math.sin(ph) * Math.sin(th)).normalize(), o: (R() - 0.5) * 0.7, w: 0.025 + R() * 0.02, dep: 0.05 + R() * 0.04, seed: R() * 50 });
  }
  const [sx, sy, sz] = c.size, pa = g.attributes.position, d = V3(), q = V3();
  for (let i = 0; i < pa.count; i++) {
    d.set(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize();
    let r = 1, topness = 0;
    for (const [n, dist] of planes) { const dn = d.dot(n); if (dn > 1e-3 && dist / dn < r) { r = dist / dn; topness = n.y > 0.9 && c.top ? 1 : 0; } }
    q.copy(d).multiplyScalar(r);                     // 单位空间里的点
    const side = 1 - topness;
    // 细凿面（小振幅，保持折面平整）
    let disp = (fbm(q.x * 2.6 + c.seed, q.y * 2.6, q.z * 2.6, 3) - 0.5) * 0.06 * side + (ridged(q.x * 7, q.y * 7 + c.seed, q.z * 7, 2) - 0.6) * 0.018 * side;
    // 层理：每层整体退进 0–0.06，层间凹缝
    const sv = q.dot(bed) / strataH + fbm(q.x * 0.8, c.seed * 0.1, q.z * 0.8, 2) * 0.5, li = Math.floor(sv), f = sv - li;
    disp -= (hash3(li, c.seed, 7) * 0.06 + sstep(0.86, 0.97, f) * 0.035) * side;
    // 裂缝：只在一段里出现
    for (const ck of cracks) {
      const dist = Math.abs(q.dot(ck.n) - ck.o);
      if (dist < ck.w) { const mask = sstep(0.42, 0.52, vnoise(q.x * 1.6 + ck.seed, q.y * 1.6, q.z * 1.6)); disp -= ck.dep * (1 - dist / ck.w) * mask * (topness ? 0.35 : 1); }
    }
    let x = q.x * sx, y = q.y * sy, z = q.z * sz;
    if (topness) y += (fbm(x * 3, c.seed, z * 3, 3) - 0.5) * 0.03; // 顶面微起伏 ±1.5 cm
    const ln = Math.hypot(x / sx, y / sy, z / sz) || 1;
    x += (x / sx / ln) * disp * sx; y += (y / sy / ln) * disp * sy * 0.7; z += (z / sz / ln) * disp * sz;
    pa.setXYZ(i, x, y, z);
  }
  const bottom = -sy * (opt.bottom ?? 0.62);
  for (let i = 0; i < pa.count; i++) if (pa.getY(i) < bottom) pa.setY(i, bottom + (pa.getY(i) - bottom) * 0.08);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeVertexNormals();
  let p = fromGeo(g, opt.mat ?? 'rock');
  p = boxUV(p, opt.tile ?? MATS.rock.tile, [R(), R()], R() * 6);
  p = hardEdgeNormals(p, 38);
  return { prim: p, height: bb.max.y - bb.min.y, foot: [bb.max.x - bb.min.x, bb.max.z - bb.min.z] };
}
const makeRock = (key) => makeRockC(ROCKS[key]);
function buildRock(key) {
  const { prim, height, foot } = makeRock(key);
  const lod0 = [prim];
  const lod1 = [simplifyPrim(prim, 0.5)], lod2 = [simplifyPrim(prim, 0.25)];
  // 碰撞：lod2 顶点凸包（顶面不会低于渲染面）
  const cs = simplifyPrim(prim, 0.03); const pts = []; for (let i = 0; i < cs.pos.length; i += 3) pts.push([cs.pos[i], cs.pos[i + 1], cs.pos[i + 2]]);
  const hp = hull(pts); hp.nrm.fill(0); hp.uv.fill(0);
  const h = weld(hp);
  const col = { pos: h.pos, idx: h.idx };
  const c = ROCKS[key];
  // 平顶高度：顶面采样中位数
  let topY = height;
  if (c.top) { const ys = []; for (let i = 0; i < prim.pos.length; i += 3) if (Math.hypot(prim.pos[i], prim.pos[i + 2]) < 0.25) ys.push(prim.pos[i + 1]); ys.sort((a, b) => a - b); topY = ys[ys.length >> 1] ?? height; }
  ROCKS[key].height = height; ROCKS[key].topY = topY;
  return finishAsset({ name: `env-rock-shore-${key}`, lods: [lod0, lod1, lod2], origin: [0, 0, 0], collider: col,
    extras: { instancing: 'InstancedMesh 友好：单材质单 primitive', use: c.use, heightM: +height.toFixed(3), walkTopY: c.top ? +topY.toFixed(3) : null, footprintM: foot.map((v) => +v.toFixed(2)), originAt: '底面中心；摆放时 y = 地面 - 埋深（注意：extras 里不能用 pivot 键，three 的 GLTFLoader 会把它当成 GLTFExporter 的枢轴容器，位置变 NaN）' },
    placement: { instanced: true } });
}

// =====================================================================================
// 潮间带地形
// =====================================================================================
const TER = { x0: -24, x1: 32, z0: -20, z1: 14, step: 0.125 };
const SEA = (z) => (z > -3.5 ? 0 : z > -18 ? -(-3.5 - z) * 0.072 : -14.5 * 0.072 - (-18 - z) * 0.6);
const softBox = (x, z, x0, x1, z0, z1, w) => sstep(0, w, Math.min(x - x0, x1 - x, z - z0, z1 - z));
const CH_TRACK_MIN_X = -1.9;
const CH_Z0_SAND = 8.4;
function terrainAt(x, z, forCollider = false) {
  const n1 = fbm(x * 0.08, 0, z * 0.08, 3), n2 = fbm(x * 0.45, 1.7, z * 0.45, 3);
  let hs = 0.1 + SEA(z) + (n1 - 0.5) * 0.12 * sstep(-3, -7, z) + (n2 - 0.5) * 0.025;
  const rr = ridged(x * 0.2, 3.3, z * 0.2, 4);
  let hr = 0.03 + (rr - 0.55) * 0.4 + (n2 - 0.5) * 0.09 + SEA(z) * 0.9;
  hr -= sstep(0.6, 0.7, fbm(x * 0.32, 7.7, z * 0.32, 3)) * 0.2; // 潮水坑
  const nm = (fbm(x * 0.25, 5.5, z * 0.25, 3) - 0.5) * 2.6;
  const mReef = sstep(-0.4, 0.9, Math.min(x + 12.5, 1.4 - x, z + 8.6, 7.8 - z) + nm);
  const mWest = sstep(12.2, 14.2, x + nm);
  const mEast = sstep(-9.6, -11.4, x + nm * 0.6);
  const mNorth = sstep(12.5, 13.1, z);
  const mBank = sstep(-3.4, -5, x) * sstep(4.8, 6.4, z);
  const mSouth = sstep(0.66, 0.73, fbm(x * 0.12, 9, z * 0.12, 3)) * sstep(-6, -9, z);
  let m = Math.max(mReef, mWest, mEast, mNorth, mBank, mSouth);
  let h = lerp(hs, hr, m);
  // 西侧抬高的乱石岸：滩地北段从可走外框 x 15.6 外才起坡；往南入海段仍从 x 12 起坡，海床与深水送回多边形（layout deepWater 西沿）对齐
  const wSea = sstep(-3.5, -8.5, z);
  h += 1.75 * sstep(lerp(15.6, 12, wSea), lerp(22, 21, wSea), x) + 1.6 * sstep(24, 31, x) + (fbm(x * 0.3, 2, z * 0.3, 3) - 0.5) * 0.5 * sstep(lerp(16, 14, wSea), lerp(21, 20, wSea), x);
  h += 0.75 * sstep(-10.5, -15, x) * sstep(-6, -2.5, z); // 石台以北的东侧岩坡
  h += 0.45 * mBank * sstep(5, 8, z); // 潮沟南沿的岩坎（约 0.5）
  h += (z - 12.5) * 1.6 * mNorth; // 崖脚
  // 推动轨道区：严格 0.1、纯沙
  const tw = softBox(x, z, -9, 10.4, 8.6, 12.4, 0.7);
  h = lerp(h, 0.1, tw); m = lerp(m, 0, tw);
  // 潮沟（x < 0.55）地形压到 -0.7，被潮沟几何体盖住；碰撞体在石槽段（x ≥ −1.9，layout.ts channel.trackMinX；返工 1029 原 −2.25）保持 0.1
  if (x < 0.55 && z > 8.4 && z < 12.6) { h = forCollider && x >= CH_TRACK_MIN_X ? 0.1 : -0.7; m = 1; }
  // 可走滩地（白盒沙面碰撞 0.1、外框 x ≤ 15.6、潮沟以南）美术地面不高出 0.13，否则人脚陷进地里
  if (!forCollider && z < CH_Z0_SAND && x > -19.6) h = Math.min(h, 0.13 + Math.max(0, x - 15.5) * 4 + Math.max(0, -19.5 - x) * 4);
  // 北侧起坡在台阶槽内留出净空，否则崖脚会穿出登岸踏步。
  if (!forCollider && z >= FAR.z0) {
    const throat = sstep(-0.6, 0, Math.min(x - FAR.x[0], FAR.x[1] - x));
    h = lerp(h, Math.min(h, stairTopAt(z) - 0.28), throat);
  }
  return { h, m };
}
function buildTerrain() {
  const { x0, x1, z0, z1, step } = TER;
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), mk = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, { h, m } = terrainAt(x, z), k = j * (nx + 1) + i;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; mk[k] = m;
  }
  const idx = new Uint32Array(nx * nz * 6); let t = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    // 对角线交替，避免规则网格的方向感
    if ((i + j) & 1) idx.set([a, c, b, b, c, d], t); else idx.set([a, c, d, a, d, b], t);
    t += 6;
  }
  const full = smoothNormals({ pos, nrm: new Float32Array(pos.length), uv: new Float32Array((pos.length / 3) * 2), idx, mat: 'sand' });
  const split = (P) => {
    const by = { sand: [], rock: [] };
    for (let t = 0; t < P.idx.length; t += 3) {
      const cx = (P.pos[P.idx[t] * 3] + P.pos[P.idx[t + 1] * 3] + P.pos[P.idx[t + 2] * 3]) / 3, cz = (P.pos[P.idx[t] * 3 + 2] + P.pos[P.idx[t + 1] * 3 + 2] + P.pos[P.idx[t + 2] * 3 + 2]) / 3;
      (terrainAt(cx, cz).m > 0.5 ? by.rock : by.sand).push(P.idx[t], P.idx[t + 1], P.idx[t + 2]);
    }
    return ['sand', 'rock'].map((mat) => {
      const p = compact({ ...P, mat }, Uint32Array.from(by[mat]));
      const tile = MATS[mat].tile;
      for (let i = 0; i < p.pos.length / 3; i++) { p.uv[i * 2] = p.pos[i * 3] / tile; p.uv[i * 2 + 1] = -p.pos[i * 3 + 2] / tile; }
      return p;
    });
  };
  const simp = (r) => { const target = Math.floor((full.idx.length * r) / 3) * 3; let out; for (const e of [0.0005, 0.001, 0.002, 0.004, 0.008]) { [out] = MeshoptSimplifier.simplify(full.idx, full.pos, 3, target, e, ['LockBorder']); if (out.length <= target * 1.04) break; } return compact(full, out); };
  const lods = [split(full), split(simp(0.5)), split(simp(0.25))];
  // 碰撞：0.5 m 高度场
  const cs = 0.5, cnx = Math.round((x1 - x0) / cs), cnz = Math.round((z1 - z0) / cs);
  const cp = [], ci = [];
  for (let j = 0; j <= cnz; j++) for (let i = 0; i <= cnx; i++) { const x = x0 + i * cs, z = z0 + j * cs; cp.push(x, terrainAt(x, z, true).h, z); }
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) { const a = j * (cnx + 1) + i, b = a + 1, c = a + cnx + 1, d = c + 1; ci.push(a, c, b, b, c, d); }
  const walls = [colBox(13.6, 2.5, 2.5, 0.2, 6, 22), colBox(-19.6, 4, 0, 0.2, 8, 25), colBox(4, 2.5, -15.5, 40, 6, 0.2)];
  const helpers = [
    { name: 'env-tidal-flat-s1-stone-slot', t: [-0.9, 0.1, 10.5], r: quatLookY(-Math.PI / 2), extras: { note: '石槽锚位：浮台中心，搁浅台面 0.4，浮起台面 1.85', raftDeckFloatY: 1.85 } },
    { name: 'env-tidal-flat-s1-push-track-start', t: [9.1, 0.1, 10.5], r: quatLookY(-Math.PI / 2), extras: { note: '浮台搁浅起点（台面 y = 0.4），+Z 为推动方向（世界 -X）', raftDeckY: 0.4 } },
    { name: 'env-tidal-flat-s1-push-track-end', t: [-0.9, 0.1, 10.5], r: quatLookY(-Math.PI / 2), extras: { lengthM: 10 } },
    { name: 'env-tidal-flat-s1-reef-path-end', t: [1.8, 0.1, 3.4] },
  ];
  return finishAsset({ name: 'env-tidal-flat-s1', lods, origin: [4, 0, -3], uv2Planar: [x0, z0, x1 - x0],
    collider: { pos: new Float32Array(cp), idx: new Uint32Array(ci) }, walls, helpers,
    extras: { sizeM: [x1 - x0, z1 - z0], sandY: 0.1, trackZone: { x: [0.6, 10.4], z: [8.6, 12.4], y: 0.1 }, note: '沙/岩两材质按噪声遮罩分面；地形在潮沟下压到 -0.7（被 env-cliff-s1 盖住）',
      lightmap: { ticket: 'v0.1-029', texture: 'tex-s1-tidal-flat-lightmap.ktx2', encoding: 'RGBM8', uv: 'TEXCOORD_1', lightMapIntensity: 1, rect: [0, 0, 1, 1] } } });
}

// =====================================================================================
// 旧木码头（局部：+Z 指向陆端/钟台，原点在桥面中点下方 y = 0）
// =====================================================================================
const PIER = { land: [-10, -7.5], sea: [3.22, -12.1], deckY: 2.2, width: 2.5, length: 14 };
PIER.mid = [(PIER.land[0] + PIER.sea[0]) / 2, (PIER.land[1] + PIER.sea[1]) / 2];
PIER.rotY = Math.atan2(PIER.land[0] - PIER.sea[0], PIER.land[1] - PIER.sea[1]);
const pierToWorld = (x, y, z) => { const c = Math.cos(PIER.rotY), s = Math.sin(PIER.rotY); return [PIER.mid[0] + x * c + z * s, y, PIER.mid[1] - x * s + z * c]; };
const MOOR_POST = [1.05, -6.8];   // 码头局部：尽头 +X 侧系船桩（bents[0]，sx +1）
// 返工 1029（程序要求）：船挪到 +X 系船桩旁，船头朝桩、涨潮 1.6 漂浮（吃水 0.24）。旧：pos [-2.35, 1.36, -4.6]，yaw 0.12（−X 缆桩一侧）。
// 船头方向 BOAT_DIR（码头局部，从船指向桩，略斜出码头尽头外侧）；船头环 bow-ring（船局部 z 1.45）离桩中心 BOAT_RING_GAP。
const BOAT_DIR = (() => { const d = [-0.45, 0.89], n = Math.hypot(d[0], d[1]); return [d[0] / n, d[1] / n]; })();
const BOAT_RING_GAP = 0.7, BOAT_RING_Z = 1.45, BOAT_RING_Y = 0.62;
const BOAT_LOCAL = { pos: [MOOR_POST[0] - BOAT_DIR[0] * (BOAT_RING_Z + BOAT_RING_GAP), 1.6 - 0.24, MOOR_POST[1] - BOAT_DIR[1] * (BOAT_RING_Z + BOAT_RING_GAP)], yaw: Math.atan2(BOAT_DIR[0], BOAT_DIR[1]) };
const BOAT_BOW_RING_LOCAL = [BOAT_LOCAL.pos[0] + Math.sin(BOAT_LOCAL.yaw) * BOAT_RING_Z, BOAT_LOCAL.pos[1] + BOAT_RING_Y, BOAT_LOCAL.pos[2] + Math.cos(BOAT_LOCAL.yaw) * BOAT_RING_Z];
const BOAT_WAS = { pos: [-2.35, 1.36, -4.6], yaw: 0.12 };

function woodPost(r, y0, y1, seed, sides = 12, reg = 'pile') {
  const segs = Math.max(4, Math.round((y1 - y0) / 0.3));
  const p = grid(sides, segs, (u, v) => {
    const a = u * Math.PI * 2, y = y0 + (y1 - y0) * v;
    const rr = r * (1 + (fbm(Math.cos(a) * 2 + seed, y * 1.3, Math.sin(a) * 2, 3) - 0.5) * 0.18 - 0.05 * sstep(1.4, 0.2, y) * (1 - Math.abs(Math.sin(a * 2 + seed))));
    return [Math.cos(a) * rr, y, -Math.sin(a) * rr];
  }, 'wood');
  // 圆柱接缝 u=0/1 法线需共享
  weldNormals(p);
  mapUVRegion(p, reg, (x, y, z, u) => [((u + seed * 0.37) % 1), reg === 'pile' ? (PILE_Y_TOP - y) / (PILE_Y_TOP - PILE_Y_BOT) : y / 2]);
  // 顶盖（略倒角的圆盘）
  const cap = fromGeo(new THREE.CircleGeometry(r * 0.93, sides), 'wood');
  xform(cap, mul(T(0, y1 + 0.005, 0), RX(-Math.PI / 2)));
  mapUVRegion(cap, 'beam', (x, y, z) => [0.5 + x * 0.8, 0.5 + z * 0.8]);
  return [p, cap];
}
function plank(L, W, H, reg, opt = {}) {
  const sx = Math.max(2, Math.round(L / 0.25));
  const p = fromGeo(new THREE.BoxGeometry(L, H, W, sx, 1, 2), 'wood');
  // 板面微翘（杯形 + 长度方向下垂）+ 端部磨圆
  for (let i = 0; i < p.pos.length / 3; i++) {
    const x = p.pos[i * 3], z = p.pos[i * 3 + 2];
    p.pos[i * 3 + 1] += (z / W) ** 2 * (opt.cup ?? 0.012) * (p.pos[i * 3 + 1] > 0 ? 1 : 0.5) - (opt.sag ?? 0) * (1 - (2 * x / L) ** 2) + (opt.twist ?? 0) * (x / L) * (z / W);
  }
  smoothNormals(p);
  const nrm = fromGeo(new THREE.BoxGeometry(L, H, W, sx, 1, 2), 'wood').nrm; p.nrm.set(nrm); // 保持硬边法线
  return mapWoodBox(p, reg, L, W, opt);
}
// 返工 1030：低潮版船绳。桩侧端点 a0 与涨潮版相同（桩上绳圈朝船一侧，deck + 0.45 = 2.65），
// 船头端点 = 退潮（水位 0）时船头环：船 y 1.36 → −0.24，x/z 不变 → 环 y 1.98 → 0.38。
// 绳在过 a0 与船头环的竖直面内（= 船中线面）：先从绳圈向外斜出、越过桥面板端头（局部 z −7），
// 贴着桩外侧几乎竖直垂下，最低点（≈ 0.23，比退潮水面高一点）兜一个弯，再从船头正前方上到船头环。
// 1.6 潮线以下（刚出水）用湿绳材质 mat-env-rope-wet-ch1。u 沿绳 1.0 = 全长（图集绳区不能平铺）。
// 曲线按弧长参数 u 上第一次低于 y 的位置
function findU(curve, y) { for (let i = 0; i <= 2000; i++) if (curve.getPointAt(i / 2000).y < y) return i / 2000; return 1; }
function boatRopeLow(a0) {
  const bow = [BOAT_BOW_RING_LOCAL[0], BOAT_BOW_RING_LOCAL[1] - 1.6, BOAT_BOW_RING_LOCAL[2]];
  const e = [bow[0] - a0[0], bow[2] - a0[2]], span = Math.hypot(e[0], e[1]); e[0] /= span; e[1] /= span;
  const side = [-e[1], e[0]];
  // (s 沿船中线水平距离 / span 归一前的米数, y 高度, 侧向微摆 m)
  const key = [[0, a0[1], 0], [0.05, 2.53, 0.004], [0.1, 2.33, 0.008], [0.13, 2.1, 0.01], [0.152, 1.75, 0.012], [0.168, 1.3, 0.01], [0.182, 0.9, 0.006],
    [0.205, 0.6, 0.002], [0.228, 0.42, -0.003], [0.258, 0.3, -0.007], [0.295, 0.248, -0.008], [0.335, 0.265, -0.006], [0.368, 0.322, -0.003], [0.398, 0.37, 0], [span, bow[1], 0]];
  const pts = key.map(([s, y, l]) => [a0[0] + e[0] * s + side[0] * l, y, a0[2] + e[1] * s + side[1] * l]);
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => V3(...q)), false, 'centripetal');
  const n = 96, total = curve.getLength();
  const cut = Math.round(n * findU(curve, 1.6));   // 潮线（1.6）所在段：之前干、之后湿
  const tube = fromGeo(new THREE.TubeGeometry(curve, n, 0.016, 6, false), 'wood');
  const u0 = tube.uv.slice();
  mapUVRegion(tube, 'rope', (x, y, z, u, v) => [u, v]);
  const dry = [], wet = [];
  for (let t = 0; t < tube.idx.length; t += 3) {
    const k = Math.floor(((u0[tube.idx[t] * 2] + u0[tube.idx[t + 1] * 2] + u0[tube.idx[t + 2] * 2]) / 3) * n);
    (k < cut ? dry : wet).push(tube.idx[t], tube.idx[t + 1], tube.idx[t + 2]);
  }
  const parts = [compact(tube, Uint32Array.from(dry)), { ...compact(tube, Uint32Array.from(wet)), mat: 'ropeWet' }];
  return { parts, bowLow: bow, lengthM: total };
}
// 最终打磨：加桩表（码头局部；单独 rng，不影响原有部件）
function extraPiles() {
  const R = rng(4242), out = [], bents = 8, bz = (i) => -6.8 + i * (13.5 / (bents - 1)), sp = 13.5 / (bents - 1);
  for (let i = 0; i < bents; i++) out.push({ kind: 'bent-mid', x: 0, z: bz(i), r: 0.12, top: 1.72, seed: 40 + i, lean: (R() - 0.5) * 0.03, leanX: (R() - 0.5) * 0.02 });
  for (let i = 0; i < bents - 1; i++) for (const sx of [-1, 1]) out.push({ kind: 'span', x: sx * 1.05 + (R() - 0.5) * 0.04, z: bz(i) + sp * (0.5 + (R() - 0.5) * 0.12), r: 0.105 + R() * 0.02, top: 1.94, seed: 60 + i * 2 + (sx > 0), lean: (R() - 0.5) * 0.05, leanX: (R() - 0.5) * 0.04 });
  for (const [x, z, top, r] of [[-1.05, -8.75, 2.5, 0.13], [-0.15, -9.1, 1.95, 0.12], [-1.3, -10.3, 2.25, 0.125]]) out.push({ kind: 'stump', x, z, r, top, seed: 90 + out.length, lean: (R() - 0.5) * 0.12, leanX: (R() - 0.5) * 0.1 });
  return out;
}
function buildPier() {
  const parts = [], R = rng(9001);
  const { deckY, width } = PIER, zS = -7, zL = 7.45; // 陆端伸进石台 0.45 m
  const bents = 8, bz = (i) => -6.8 + i * (13.5 / (bents - 1));
  // 桩、帽梁、斜撑
  for (let i = 0; i < bents; i++) {
    const z = bz(i);
    for (const sx of [-1, 1]) {
      const tall = sx === 1 && i % 2 === 0; // 一侧隔一根高出，系绳栏
      const mooring = sx === 1 && i === 0;
      const top = mooring ? 3.05 : tall ? 2.95 : 1.94;
      const lean = (R() - 0.5) * 0.04;
      for (const q of woodPost(mooring ? 0.16 : 0.13, PILE_Y_BOT, top, i * 2 + sx, 12)) parts.push(xform(q, mul(T(sx * 1.05, 0, z), RZ(lean), RX((R() - 0.5) * 0.03))));
      if (mooring) { // 系船桩上绕的绳圈
        for (let k = 0; k < 4; k++) parts.push(xform(ropeRing(fromGeo(new THREE.TorusGeometry(0.175, 0.022, 6, 18), 'wood'), 2 * Math.PI * 0.175), mul(T(1.05, 2.62 + k * 0.05, z), RX(Math.PI / 2 + (R() - 0.5) * 0.15))));
      }
    }
    // 帽梁 1.72–1.94
    parts.push(xform(plank(2.75, 0.22, 0.22, 'beam', { uLen: 2.75, uOff: R() }), mul(T(0, 1.83, z), RY(0))));
    // X 斜撑（两块，前后错开）
    const len = Math.hypot(2.1, 1.9), ang = Math.atan2(1.9, 2.1);
    for (const [s, dz] of [[1, 0.15], [-1, -0.15]]) parts.push(xform(plank(len + 0.2, 0.05, 0.16, 'beam', { uLen: 2.5, uOff: R() }), mul(T(0, 0.75, z + dz), RZ(s * ang), RX(Math.PI / 2))));
    // 螺栓
    for (const [x, y] of [[-1.05, 1.83], [1.05, 1.83], [0, 0.75]]) for (const dz of [0.24, -0.24]) {
      const b = fromGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6), 'wood'); mapUVRegion(b, 'iron', (x, y, z) => [0.5 + x * 4, 0.5 + z * 4]);
      parts.push(xform(b, mul(T(x, y, z + dz * (y > 1 ? 0.5 : 1)), RX(Math.PI / 2))));
    }
  }
  // 纵梁 1.94–2.14
  for (const x of [-1.05, 0, 1.05]) for (const [a, b] of [[zS, 0.05], [0.05, zL]]) parts.push(xform(plank(b - a, 0.16, 0.2, 'beam', { uLen: 2.5, uOff: R() }), mul(T(x, 2.04, (a + b) / 2), RY(Math.PI / 2))));
  // 桥面：12 条纵向木板，0.2 宽，2.14–2.20，接头错开落在排架上
  const pw = 0.2, gap = (width - 12 * pw) / 11;
  for (let k = 0; k < 12; k++) {
    const x = -width / 2 + pw / 2 + k * (pw + gap);
    let z = zS; let bi = (k % 3) + 1;
    while (z < zL - 0.01) {
      const zEnd = bi >= bents - 1 ? zL : Math.min(zL, bz(bi) + 0.0);
      const L = zEnd - z - 0.006;
      const missing = k === 11 && bi === 3; // 一块缺板（远离出生点）
      if (!missing) {
        const p = plank(L, pw, 0.06, 'deck', { strip: Math.floor(R() * 8), uLen: 4, uOff: R(), cup: 0.008, sag: 0.006, twist: (R() - 0.5) * 0.01 });
        parts.push(xform(p, mul(T(x + (R() - 0.5) * 0.008, deckY - 0.03 + (R() - 0.5) * 0.004, z + L / 2 + 0.003), RY(-Math.PI / 2), RX((R() - 0.5) * 0.006))));
        // 钉子：每条板在每个排架上 2 颗
        for (let j = 0; j < bents; j++) {
          const zz = bz(j); if (zz < z || zz > zEnd) continue;
          for (const dx of [-0.055, 0.055]) {
            const n = fromGeo(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 6), 'wood'); mapUVRegion(n, 'iron', (x, y, z) => [0.5 + x * 8, 0.5 + z * 8]);
            parts.push(xform(n, T(x + dx, deckY + 0.001, zz + (R() - 0.5) * 0.02)));
          }
        }
      }
      z = zEnd; bi += 3;
    }
  }
  // 绳栏：+X 侧高桩之间下垂的绳
  const tallZ = [...Array(bents).keys()].filter((i) => i % 2 === 0).map(bz);
  for (let k = 0; k < tallZ.length - 1; k++) {
    const a = tallZ[k], b = tallZ[k + 1], pts = [];
    for (let s = 0; s <= 8; s++) { const t = s / 8; pts.push([1.05 + 0.03, 2.86 - Math.sin(t * Math.PI) * 0.22, lerp(a, b, t)]); }
    parts.push(ropeTube(pts, 0.018, 24, 6));
  }
  // 铁系缆桩（局部 -1.0, 2.2, -6.4）
  const boll = lathePart([[0.001, 0], [0.16, 0], [0.16, 0.04], [0.11, 0.06], [0.1, 0.3], [0.14, 0.36], [0.15, 0.4], [0.12, 0.44], [0.001, 0.45]], 14, 'wood');
  mapUVRegion(boll, 'iron', (x, y, z, u) => [u, y / 0.45]); weldNormals(boll);
  parts.push(xform(boll, T(-1.0, deckY, -6.4)));
  // 系船绳（返工 1029：从 −X 缆桩改到 +X 系船桩）：桩上绳圈（deck + 0.42…0.57）朝船一侧 → 船头环 bow-ring（涨潮漂浮位置）
  const bowL = BOAT_BOW_RING_LOCAL;
  const a0 = [MOOR_POST[0] - BOAT_DIR[0] * 0.19, deckY + 0.45, MOOR_POST[1] - BOAT_DIR[1] * 0.19];
  const rp = []; for (let s = 0; s <= 12; s++) { const t = s / 12; rp.push([lerp(a0[0], bowL[0], t), lerp(a0[1], bowL[1], t) - Math.sin(t * Math.PI) * 0.12, lerp(a0[2], bowL[2], t)]); }
  // 返工 1030：船绳拆成高 / 低潮两版独立节点（不再并进 _lodN）。涨潮版 = 原来这根，几何不变
  const ropeHigh = fixRopeUV(mergeParts([ropeTube(rp, 0.016, 32, 6)]));
  const { parts: ropeLow, bowLow } = boatRopeLow(a0);
  // 甲板上的一卷绳
  const coil = []; for (let s = 0; s <= 90; s++) { const a = s * 0.42, r = 0.08 + s * 0.0024; coil.push([0.7 + Math.cos(a) * r, deckY + 0.016 + (s % 15 === 0 ? 0.01 : 0), -5.2 + Math.sin(a) * r]); }
  parts.push(ropeTube(coil, 0.016, 260, 6));
  // 最终打磨（制作人 10-29 验收遗留「码头再多些木桩」，对照 concept-ch1-opening-wide）：加桩，原有部件和随机序列都不动（单独 rng）。
  //   ① 每个排架中间加一根桩（x 0，顶 1.72 托帽梁，夹在两道斜撑之间）；② 相邻排架之间两侧各加一根中间桩（x ±1.05，顶 1.94 托纵梁）；
  //   ③ 码头尽头外侧（−X 一边，离小船 ≥ 2 m）3 根旧桩残桩，是早先码头更长时留下的，涨潮 1.6 露出 0.3–0.9 m。全在桥面以下 / 码头外，不进走道。
  const XP = extraPiles();
  for (const e of XP) for (const q of woodPost(e.r, PILE_Y_BOT, e.top, e.seed, 12)) parts.push(xform(q, mul(T(e.x, 0, e.z), RZ(e.lean), RX(e.leanX))));
  // 简化用原拓扑（绳 uv 里存的是沿绳坐标），简化后再把绳 uv 映射进图集
  const raw0 = mergeParts(parts);
  const lods = [raw0, raw0.map((p) => simplifyPrim(p, 0.5)), raw0.map((p) => simplifyPrim(p, 0.25))].map(fixRopeUV);
  // 碰撞：桥面板 + 桩 + 绳栏桩 + 缆桩
  const cb = [colBox(0, deckY - 0.15, 0.225, width, 0.3, 14.45)];
  for (let i = 0; i < bents; i++) for (const sx of [-1, 1]) { const top = sx === 1 && i % 2 === 0 ? 3.0 : deckY - 0.3; cb.push(colBox(sx * 1.05, (top + PILE_Y_BOT) / 2, bz(i), 0.26, top - PILE_Y_BOT, 0.26)); }
  cb.push(colBox(-1.0, deckY + 0.22, -6.4, 0.3, 0.45, 0.3));
  for (const e of XP) cb.push(colBox(e.x, (e.top + PILE_Y_BOT) / 2, e.z, e.r * 2, e.top - PILE_Y_BOT, e.r * 2));
  // 局部 → 世界：节点摆放
  const helpers = [
    { name: 'env-pier-wood-ch1-spawn-start', t: [0, deckY, -6.0], r: quatLookY(0), extras: { note: '出生点：码头尽头，面朝 +Z（陆端 / 钟台方向）' } },
    { name: 'env-pier-wood-ch1-boat-mooring', t: [MOOR_POST[0] - 0.37, deckY, MOOR_POST[1]], r: quatLookY(Math.PI / 2), extras: { anim: 'xi-tie-boat', interact: true, postCenter: [MOOR_POST[0], deckY, MOOR_POST[1]], postR: 0.16, postTopAboveDeck: 0.85, postAheadM: 0.37, ropeLoopsAboveDeck: [0.42, 0.57], wrapAboveDeck: [0.52, 0.62], boatLocal: BOAT_LOCAL, was: [-1.0, +(deckY + 0.33).toFixed(2), -6.4], note: '返工 1029：汐系船站位（桥面上，+Z 朝码头局部 +X 那根系船桩，桩中心在她前方 0.37 m）。原节点在 −X 侧铁缆桩顶 (−1.0, 2.53, −6.4)，和 017 xi-tie-boat 用的桩不在一边' } },
    { name: 'env-pier-wood-ch1-mooring-post-top', t: [MOOR_POST[0], deckY + 0.85, MOOR_POST[1]], extras: { note: '码头尽头 +X 侧系船桩顶（r 0.16，高出桥面 0.85）' } },
    { name: 'env-pier-wood-ch1-bollard', t: [-1.0, deckY + 0.33, -6.4], extras: { note: '−X 侧铁缆桩（纯装饰；返工 1029 起船绳不再系在这里，改系 +X 系船桩）' } },
    { name: 'env-pier-wood-ch1-rope-bow-end', t: BOAT_BOW_RING_LOCAL.map((v) => +v.toFixed(3)), extras: { note: '返工 1029：船绳在船头的端点 = 涨潮 1.6 时 prop-boat-rowboat-bow-ring 的位置（两者一致）。返工 1030：保留为 -rope-bow-end-high 的别名（verify-render 在用）', ropeFrom: [MOOR_POST[0], deckY + 0.45, MOOR_POST[1]], tide: 1.6, aliasOf: 'env-pier-wood-ch1-rope-bow-end-high' } },
    { name: 'env-pier-wood-ch1-rope-bow-end-high', t: BOAT_BOW_RING_LOCAL.map((v) => +v.toFixed(3)), extras: { note: '返工 1030：涨潮版船绳（-rope-high）船头端点 = 涨潮 1.6 时船头环', variant: 'high', tide: 1.6, ropeFromLocal: a0.map((v) => +v.toFixed(3)) } },
    { name: 'env-pier-wood-ch1-rope-bow-end-low', t: bowLow.map((v) => +v.toFixed(3)), extras: { note: '返工 1030：低潮版船绳（-rope-low）船头端点 = 退潮 0 时船头环（船 y −0.24，x/z 不变）', variant: 'low', tide: 0, ropeFromLocal: a0.map((v) => +v.toFixed(3)) } },
  ];
  const meshNodes = [
    { name: 'env-pier-wood-ch1-rope-high', parts: ropeHigh, extras: { tideVariant: 'high', defaultVisible: true, bowEnd: 'env-pier-wood-ch1-rope-bow-end-high', note: '返工 1030：涨潮版船绳（桩上绳圈 → 涨潮船头环），= 返工 1029 那根。glTF 没有可见性字段：默认可见' } },
    { name: 'env-pier-wood-ch1-rope-low', parts: ropeLow, extras: { tideVariant: 'low', defaultVisible: false, bowEnd: 'env-pier-wood-ch1-rope-bow-end-low', wetBelowY: 1.6, note: '返工 1030：低潮版船绳（桩上绳圈 → 退潮船头环，自然下垂；1.6 潮线以下用湿绳材质）。默认应隐藏：glTF 不存可见性，加载后按 extras.defaultVisible 设置，或由 layout.ts S1.boatRope 切换' } },
  ];
  LAYOUT.nodes.pierFrame = { mid: PIER.mid, rotationY: +PIER.rotY.toFixed(5), landEnd: PIER.land, seaEnd: PIER.sea };
  return finishAsset({ name: 'env-pier-wood-ch1', lods, origin: [0, 0, 0], uv2Rotate: true, collider: colliderFrom(cb), helpers, meshNodes,
    placement: { translation: [+PIER.mid[0].toFixed(3), 0, +PIER.mid[1].toFixed(3)], rotationY: +PIER.rotY.toFixed(5), rotationYDeg: +(PIER.rotY * 180 / Math.PI).toFixed(2) },
    extras: { lengthM: 14, widthM: 2.5, deckY, plankDir: '+Z（局部）→ 世界指向东侧钟台', wetMark: '桩柱贴图 v = 世界高度，1.6 以下湿色 + 藤壶' } });
}

// =====================================================================================
// 小船（叠板船，长 3.0 m，原点在龙骨底中心，船头 +Z）
// =====================================================================================
function hullShape(t, s, side) {
  // t: 0 船尾 → 1 船头；s: 0 龙骨 → 1 舷缘
  const L = 3.0, z = (t - 0.5) * L;
  const beam = 0.6 * Math.pow(Math.sin(Math.PI * lerp(0.2, 1, t)), 0.55) * (t > 0.85 ? 1 - sstep(0.85, 1, t) * 0.92 : 1);
  const sheer = 0.6 + 0.16 * Math.pow(Math.max(0, t - 0.6) / 0.4, 2) + 0.05 * Math.pow(Math.max(0, 0.25 - t) / 0.25, 2);
  const keel = 0.06 + 0.06 * sstep(0.75, 1, t) * 2;
  const a = s * Math.PI / 2;
  const strake = s * 6, f = strake - Math.floor(strake);
  const lap = s < 0.995 ? 0.012 * (1 - f) : 0; // 叠板台阶
  const r = 1 + lap / Math.max(0.05, beam);
  const x = side * beam * Math.pow(Math.sin(a), 0.75) * r;
  const y = keel + (sheer - keel) * (1 - Math.cos(a) ** 1.3) - 0.06 * (1 - s);
  return [x, Math.max(0, y), z];
}
// 返工 1029：xi-row-boat 对位（017 extras.align.rowing）：原点 = 横座正下方的踏板面，汐面朝 +Z（= 船尾，船局部 −Z）
const ROW = { origin: [0, 0.135, 0.36], floorTop: 0.135, seatTop: 0.35, oarlock: [0.56, 0.525, 0.22] };
const rowToBoat = ([x, y, z]) => [ROW.origin[0] - x, ROW.origin[1] + y, ROW.origin[2] - z];   // 绕 Y 转 180°
function buildBoat(sunken = false) {
  const parts = [], R = rng(sunken ? 515 : 313);
  const nt = 40, ns = 48;
  const holes = (t, s, side) => sunken && side > 0 && ((t > 0.35 && t < 0.62 && s > 0.45) || (t > 0.7 && s > 0.8)) && fbm(t * 6, s * 6, 3, 2) > 0.42;
  for (const side of [-1, 1]) for (const inner of [false, true]) {
    let p = grid(nt, ns, (t, s) => {
      const [x, y, z] = hullShape(t, s, side);
      if (!inner) return [x, y, z];
      const k = 0.02; return [x - side * k * Math.sin(s * Math.PI / 2), y + k * Math.cos(s * Math.PI / 2) + 0.004, z * (1 - k / 1.5)];
    }, 'wood', (side > 0) !== inner);
    weldNormals(p);
    mapUVRegion(p, 'boat', (x, y, z, u, v) => [u, v]);
    if (sunken) { // 去掉破洞处的面
      const keep = [];
      for (let t = 0; t < p.idx.length; t += 3) { const u = p.uv.length; const i0 = p.idx[t]; const ti = (i0 % (nt + 1)) / nt, si = Math.floor(i0 / (nt + 1)) / ns; if (!holes(ti, si, side)) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]); }
      p = compact(p, Uint32Array.from(keep));
    }
    parts.push(p);
  }
  // 舷缘（上沿压条）、龙骨、艏柱、艉板
  const gun = (side) => { const pts = []; for (let i = 0; i <= 30; i++) { const t = 0.02 + (i / 30) * 0.96; if (sunken && side > 0 && t > 0.4 && t < 0.58) continue; pts.push(hullShape(t, 1, side)); } return pts; };
  for (const side of [-1, 1]) {
    const g = gun(side);
    if (sunken && side > 0) { const i = g.findIndex((q) => q[2] > 0.1); for (const seg of [g.slice(0, i), g.slice(i)]) if (seg.length > 2) parts.push(mapUVRegion(tubePart(seg, 0.025, 40, 6, 'wood'), 'beam', (x, y, z, u, v) => [u * 2, v])); }
    else parts.push(mapUVRegion(tubePart(g, 0.025, 60, 6, 'wood'), 'beam', (x, y, z, u, v) => [u * 2, v]));
  }
  const keelPts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; const [, y, z] = hullShape(t, 0, 1); keelPts.push([0, y - 0.02, z]); }
  const stemTop = hullShape(1, 1, 1); keelPts.push([0, stemTop[1] * 0.6, 1.52], [0, stemTop[1] + 0.04, 1.5]);
  parts.push(mapUVRegion(tubePart(keelPts, 0.035, 40, 6, 'wood'), 'beam', (x, y, z, u, v) => [u * 2, v]));
  // 艉板
  const tr = []; for (let i = 0; i <= 12; i++) { const s = i / 12; tr.push(hullShape(0, s, -1)); }
  for (let i = 12; i >= 0; i--) { const s = i / 12; tr.push(hullShape(0, s, 1)); }
  const shape = new THREE.Shape(tr.map(([x, y]) => new THREE.Vector2(x, y)));
  const tg = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  const tp = mapUVRegion(fromGeo(tg, 'wood'), 'boat', (x, y) => [0.02 + (x + 0.5) * 0.1, 1 - y]);
  parts.push(xform(tp, T(0, 0, -1.5)));
  // 肋骨
  for (let k = 1; k < 8; k++) {
    const t = k / 8.5 + 0.03; const pts = [];
    for (let i = 0; i <= 10; i++) { const s = -1 + (i / 10) * 2; const [x, y, z] = hullShape(t, Math.abs(s), Math.sign(s) || 1); pts.push([x * 0.95, y + 0.02, z]); }
    if (sunken && t > 0.35 && t < 0.62) continue;
    parts.push(mapUVRegion(tubePart(pts, 0.018, 20, 5, 'wood'), 'beam', (x, y, z, u, v) => [u, v]));
  }
  // 坐板
  for (const t of [0.32, 0.62]) {
    const [x, y, z] = hullShape(t, 0.86, 1);
    if (sunken && t === 0.62) { parts.push(xform(plank(x * 2 - 0.06, 0.24, 0.035, 'beam', { uLen: 2 }), mul(T(-0.1, y - 0.18, z), RZ(0.35)))); continue; }
    parts.push(xform(plank(x * 2 - 0.04, 0.24, 0.035, 'beam', { uLen: 2, uOff: R() }), T(0, y - 0.05, z)));
  }
  if (!sunken) {
    // 返工 1029：船底踏板（顶 = 0.135 = xi-row-boat 原点平面；座面 0.485 = 原点 + 0.35；舷边 0.60 = 原点 + 0.465；水面 0.24 = 原点 + 0.105）
    const hw = (t) => { let lo = 0, hi = 1; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (hullShape(t, m, 1)[1] < ROW.floorTop - 0.012) lo = m; else hi = m; } return hullShape(t, lo, 1)[0]; };
    const nb = 5, bw = 0.13, t0 = 0.16, t1 = 0.8;
    for (let b = 0; b < nb; b++) {
      const xc = (b - (nb - 1) / 2) * (bw + 0.012);
      let ta = t0, tb = t1; while (ta < tb && hw(ta) < Math.abs(xc) + bw / 2 + 0.01) ta += 0.01; while (tb > ta && hw(tb) < Math.abs(xc) + bw / 2 + 0.01) tb -= 0.01;
      if (tb - ta < 0.08) continue;
      const za = (ta - 0.5) * 3.0, zb = (tb - 0.5) * 3.0;
      const pb = plank(zb - za, bw, 0.02, 'beam', { uLen: 2, uOff: R(), cup: 0.002 });
      parts.push(xform(pb, mul(T(xc, ROW.floorTop - 0.01, (za + zb) / 2), RY(Math.PI / 2))));
    }
    // 桨架（铁桨栓 + 舷边垫块），位置 = xi-row-boat extras.align.rowing 的 oarlockL / R
    for (const sx of [-1, 1]) {
      const [ox, oy, oz] = rowToBoat([sx * -ROW.oarlock[0], ROW.oarlock[1], ROW.oarlock[2]]);
      const gy = hullShape(0.5 + oz / 3.0, 1, 1)[1];
      const pad = plank(0.22, 0.07, 0.04, 'beam', { uLen: 1 }); parts.push(xform(pad, mul(T(ox, gy + 0.02, oz), RY(Math.PI / 2))));
      const pin = mapUVRegion(fromGeo(new THREE.CylinderGeometry(0.012, 0.012, oy - gy + 0.02, 6), 'wood'), 'iron', (x, y, z) => [0.5 + x * 4, 0.5 + z * 4]);
      parts.push(xform(pin, T(ox, (oy + gy) / 2, oz)));
      const fork = mapUVRegion(fromGeo(new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI), 'wood'), 'iron', (x, y, z, u, v) => [u, v]);
      parts.push(xform(fork, mul(T(ox, oy, oz), RY(Math.PI / 2))));
    }
  }
  if (!sunken) { // 两支桨放在船内
    for (const s of [-1, 1]) {
      const oar = [...(() => { const sh = fromGeo(new THREE.CylinderGeometry(0.022, 0.026, 2.1, 8, 4), 'wood'); return [mapUVRegion(sh, 'beam', (x, y, z, u, v) => [v, u])]; })()];
      const blade = mapUVRegion(fromGeo(new THREE.BoxGeometry(0.14, 0.55, 0.018, 1, 3, 1), 'wood'), 'beam', (x, y) => [0.5 + y, 0.5 + x * 2]);
      xform(blade, T(0, -1.2, 0));
      for (const q of [...oar, blade]) parts.push(xform(q, mul(T(s * 0.22, 0.36 + (s > 0 ? 0.03 : 0), 0.1), RZ(s * 0.08), RX(Math.PI / 2 + 0.05), RY(s * 0.1))));
    }
    // 船头的绳圈
    const c = []; for (let i = 0; i <= 50; i++) { const a = i * 0.5, r = 0.06 + i * 0.002; c.push([Math.cos(a) * r, 0.2 + (i % 13 === 0 ? 0.01 : 0), 1.0 + Math.sin(a) * r]); }
    parts.push(ropeTube(c, 0.014, 150, 5));   // 返工 1030 第 3 批：绳纹按全长铺（原 u × 12 被 inReg 截断，只有开头一段有股纹）；几何与原 tubePart 相同
  } else { // 船内淤沙
    const sand = grid(16, 10, (u, v) => { const t = lerp(0.12, 0.85, u), [x, y, z] = hullShape(t, 0.6, 1); const xx = lerp(-x, x, v) * 0.97; return [xx, 0.22 + (fbm(xx * 4, 1, z * 4, 3) - 0.5) * 0.08 + 0.05 * Math.sin(t * Math.PI), z]; }, 'sand', true);
    for (let i = 0; i < sand.pos.length / 3; i++) { sand.uv[i * 2] = sand.pos[i * 3] / 4; sand.uv[i * 2 + 1] = -sand.pos[i * 3 + 2] / 4; }
    parts.push(sand);
  }
  const lod0 = mergeParts(parts);
  // 绳圈 uv 存沿绳坐标：用原拓扑简化（与 finishAsset 默认 0.5 / 0.25 相同），再 fixRopeUV 映射进图集（只改 UV）
  const lods = sunken ? undefined : [lod0, lod0.map((p) => simplifyPrim(p, 0.5)), lod0.map((p) => simplifyPrim(p, 0.25))].map(fixRopeUV);
  const name = sunken ? 'prop-boat-rowboat-sunken' : 'prop-boat-rowboat';
  const cb = [colBox(0, 0.32, 0, 1.15, 0.64, 2.9)];
  const helpers = sunken ? [] : [
    { name: `${name}-waterline`, t: [0, 0.24, 0], extras: { note: '吃水线：漂浮时与水面对齐' } },
    { name: `${name}-bow-ring`, t: [0, 0.62, 1.45], extras: { note: '系船绳挂点（码头 -boat-mooring 连到这里）' } },
    { name: `${name}-seat`, t: ROW.origin, r: quatLookY(Math.PI), extras: { anim: 'xi-row-boat', alignKey: 'extras.align.rowing', seatTopAboveOrigin: ROW.seatTop, seatTopY: +(ROW.origin[1] + ROW.seatTop).toFixed(3), floorboardTopY: ROW.floorTop, gunwaleAboveOrigin: 0.465, waterAboveOrigin: 0.105, was: [0, 0.42, -0.25], note: '返工 1029：= xi-row-boat 的原点（船尾侧横座 z 0.36 正下方的船底踏板面 0.135），+Z 朝船尾（汐面朝方向）。横座顶 0.485 = 原点 + 0.35' } },
    ...[['l', 1], ['r', -1]].map(([k, sx]) => ({ name: `${name}-oarlock-${k}`, t: rowToBoat([sx * ROW.oarlock[0], ROW.oarlock[1], ROW.oarlock[2]]).map((v) => +v.toFixed(3)), r: quatLookY(Math.PI), extras: { xiLocal: [sx * ROW.oarlock[0], ROW.oarlock[1], ROW.oarlock[2]], note: `返工 1029：桨架转轴（桨栓顶）= align.rowing.oarlock${k.toUpperCase()}（汐局部 [${sx > 0 ? '' : '−'}0.56, 0.525, 0.22]，${k === 'l' ? '她的左手' : '她的右手'}）` } })),
  ];
  let placement;
  if (sunken) placement = { translation: [10.2, -1.15, -17.0], rotationY: 0.6, rotationXDeg: 9, rotationZDeg: -21, note: '半埋在退潮线外的泥沙里，退潮时露出船舷' };
  else { const w = pierToWorld(...BOAT_LOCAL.pos); const ry = PIER.rotY + BOAT_LOCAL.yaw, ww = pierToWorld(...BOAT_WAS.pos), g = terrainAt(w[0], w[2]).h; placement = { translation: w.map((v) => +v.toFixed(3)), rotationY: +ry.toFixed(5), rotationYDeg: +(ry * 180 / Math.PI).toFixed(2), seabedY: +g.toFixed(3), mooredTo: 'env-pier-wood-ch1-mooring-post-top', bowRingWorld: pierToWorld(...BOAT_BOW_RING_LOCAL).map((v) => +v.toFixed(3)),
    was: { translation: ww.map((v) => +v.toFixed(3)), rotationY: +(PIER.rotY + BOAT_WAS.yaw).toFixed(5) },
    note: `返工 1029：涨潮 1.6 漂浮，系在码头尽头 +X 系船桩上，船头朝桩（船头环离桩中心 ${BOAT_RING_GAP} m，= 码头节点 env-pier-wood-ch1-rope-bow-end）。y 随水位：水面 − 0.24；退潮搁在泥上（此处海床 y ≈ ${g.toFixed(2)}）` }; }
  return finishAsset({ name, ...(lods ? { lods } : { lod0 }), origin: [0, 0, 0], outDir: OUT_PROPS, collider: colliderFrom(cb), helpers, placement,
    extras: { lengthM: 3.0, beamM: 1.2, waterlineY: 0.24, sunken, ...(sunken ? {} : { rowing: { origin: ROW.origin, seatTopY: +(ROW.origin[1] + ROW.seatTop).toFixed(3), floorboardTopY: ROW.floorTop, oarlockL: rowToBoat([ROW.oarlock[0], ROW.oarlock[1], ROW.oarlock[2]]), oarlockR: rowToBoat([-ROW.oarlock[0], ROW.oarlock[1], ROW.oarlock[2]]) } }) } });
}

// =====================================================================================
// 石砌工具：成层砌墙、铺地石板
// =====================================================================================
// 一段墙：面在 p0→p1 线上，out = 朝外的水平法线 [nx, nz]；石块向内伸 depth。groundFn 用来跳过整块埋在地下的层。
function courseWall(parts, p0, p1, yBot, yTop, out, seed, opt = {}) {
  const R = rng(seed * 131 + 7);
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), tx = (p1[0] - p0[0]) / L, tz = (p1[1] - p0[1]) / L;
  const yaw = Math.atan2(-tz, tx), depth = opt.depth ?? 0.42, ch = opt.course ?? 0.42;
  const n = Math.max(1, Math.round((yTop - yBot) / ch)), h = (yTop - yBot) / n;
  const ground = opt.ground ?? (() => -99);
  for (let k = 0; k < n; k++) {
    const y0 = yBot + k * h;
    let s = -(opt.overlap ?? 0) + (k % 2 ? R() * 0.4 : 0);
    if (k % 2) { const first = 0.25 + R() * 0.35; s = -(opt.overlap ?? 0); addBlock(first); }
    while (s < L + (opt.overlap ?? 0) - 0.05) addBlock(Math.min(0.55 + R() * 0.75, L + (opt.overlap ?? 0) - s));
    function addBlock(len) {
      const sc = s + len / 2, cx = p0[0] + tx * sc - out[0] * depth / 2, cz = p0[1] + tz * sc - out[1] * depth / 2;
      s += len;
      if (len < 0.08) return;
      if (y0 + h < ground(cx + out[0] * depth / 2, cz + out[1] * depth / 2) - 0.25) return; // 整块在地下
      const jut = (R() - 0.5) * 0.03, coarse = y0 + h < 0;
      const b = stoneBlock(len - 0.014, h - 0.014, depth, 0.025 + R() * 0.02, seed + k * 13 + s, 0.007, coarse ? [Math.max(2, Math.round(len / 0.3)), 2, 2] : null);
      xform(b, mul(T(cx + out[0] * jut, y0 + h / 2, cz + out[1] * jut), RY(yaw + (R() - 0.5) * 0.012), RZ((R() - 0.5) * 0.01)));
      parts.push(boxUV(b, MATS.masonry.tile, [R(), R()], (R() - 0.5) * 0.1));
    }
  }
}
function paving(parts, x0, x1, z0, z1, top, seed, opt = {}) {
  const R = rng(seed * 977 + 3), th = opt.thick ?? 0.14, skip = opt.skip ?? (() => false);
  let z = z0;
  while (z < z1 - 0.02) {
    const d = Math.min(0.55 + R() * 0.35, z1 - z); let x = x0;
    while (x < x1 - 0.02) {
      const w = Math.min(0.6 + R() * 0.6, x1 - x);
      if (!skip(x + w / 2, z + d / 2)) {
        const b = stoneBlock(w - 0.012, th, d - 0.012, 0.018, seed + x * 3 + z, 0.004, [Math.max(2, Math.round(w / 0.15)), 1, Math.max(2, Math.round(d / 0.15))]);
        xform(b, mul(T(x + w / 2, top - th / 2 - 0.002 * R(), z + d / 2), RX((R() - 0.5) * 0.006), RZ((R() - 0.5) * 0.006)));
        parts.push(boxUV(b, MATS.masonry.tile, [R(), R()], R() * 6));
      }
      x += w;
    }
    z += d;
  }
}
function coreBox(parts, x0, x1, y0, y1, z0, z1, mat = 'masonry') {
  const b = box(x1 - x0, y1 - y0, z1 - z0, mat); xform(b, T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  parts.push(boxUV(b, MATS[mat].tile, [0.3, 0.7]));
}
// 矩形石砌台：四面成层墙 + 顶面铺石 + 内芯
function masonryPlatform(parts, x0, x1, z0, z1, yBot, top, seed, opt = {}) {
  const ground = (x, z) => terrainAt(x, z).h;
  const wallTop = top - (opt.paveThick ?? 0.14);
  const sides = opt.sides ?? ['s', 'n', 'e', 'w'];
  if (sides.includes('s')) courseWall(parts, [x0, z0], [x1, z0], yBot, wallTop, [0, -1], seed + 1, { ground, overlap: 0.02 });
  if (sides.includes('n')) courseWall(parts, [x1, z1], [x0, z1], yBot, wallTop, [0, 1], seed + 2, { ground, overlap: 0.02 });
  if (sides.includes('w')) courseWall(parts, [x1, z0], [x1, z1], yBot, wallTop, [1, 0], seed + 3, { ground, overlap: 0.02 }); // 西 = +X
  if (sides.includes('e')) courseWall(parts, [x0, z1], [x0, z0], yBot, wallTop, [-1, 0], seed + 4, { ground, overlap: 0.02 });
  coreBox(parts, x0 + 0.05, x1 - 0.05, yBot, wallTop - 0.005, z0 + 0.05, z1 - 0.05);
  paving(parts, x0 - 0.04, x1 + 0.04, z0 - 0.04, z1 + 0.04, top, seed + 5, { thick: opt.paveThick ?? 0.14, skip: opt.paveSkip });
}

// =====================================================================================
// 岸边石台（钟台 y = 2.4 + 送回安全点）
// =====================================================================================
const LEDGE = { x0: -19, x1: -10, z0: -10.5, z1: -2, top: 2.4, bot: -1.8 };
const RSTAIR = { run: 0.32, rise: 0.2, n: 11, z: [-3.8, -2.2] };   // layout.ts reefStairs
function buildLedge() {
  const parts = [], R = rng(4242), { x0, x1, z0, z1, top, bot } = LEDGE;
  masonryPlatform(parts, x0, x1, z0, z1, bot, top, 100);
  // 南侧 / 东侧残破矮墙（0.55 高），有缺口、倒落石块
  const para = [[[x0 + 0.2, z0 + 0.2], [x1 - 0.4, z0 + 0.2], [0, -1]], [[x0 + 0.2, z1 - 0.3], [x0 + 0.2, z0 + 0.2], [-1, 0]]];
  for (const [a, b, out] of para) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let s = 0;
    while (s < L) {
      const seg = 1.2 + R() * 2.2, gap = 0.5 + R() * 1.2;
      const e = Math.min(L, s + seg), t0 = s / L, t1 = e / L;
      const pa = [lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)], pb = [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)];
      courseWall(parts, pa, pb, top, top + (R() < 0.35 ? 0.3 : 0.58), out, 300 + s * 10, { depth: 0.36, course: 0.29 });
      s = e + gap;
      if (R() < 0.6 && s < L) { // 倒落在石板上的一块
        const t = Math.min(1, (s - gap / 2) / L), fb = stoneBlock(0.55 + R() * 0.3, 0.27, 0.34, 0.035, 900 + s, 0.01);
        xform(fb, mul(T(lerp(a[0], b[0], t) - out[0] * (0.6 + R() * 0.5), top + 0.13, lerp(a[1], b[1], t) - out[1] * (0.6 + R() * 0.5)), RY(R() * 3), RZ((R() - 0.5) * 0.3)));
        parts.push(boxUV(fb, 2, [R(), R()]));
      }
    }
  }
  // 西侧下行石阶（返工 1029 对齐 layout.ts reefStairs）：11 级 × 0.2，踏步 0.32，x −10 → −6.48，z −3.8…−2.2（原 0.177 × 0.3，z −4…−2.6）
  const steps = [];
  for (let i = 0; i < RSTAIR.n; i++) {
    const xa = x1 + i * RSTAIR.run, xb = xa + RSTAIR.run + 0.04, ty = top - RSTAIR.rise * (i + 1);
    const b = stoneBlock(xb - xa, ty + 0.4, RSTAIR.z[1] - RSTAIR.z[0], 0.03, 500 + i, 0.006);
    xform(b, T((xa + xb) / 2, (ty - 0.4) / 2, (RSTAIR.z[0] + RSTAIR.z[1]) / 2));
    parts.push(boxUV(b, 2, [R(), R()], R()));
    steps.push([xa, ty]);
  }
  // 铁系船环（码头旁西墙上）
  const ring = mapUVRegion(fromGeo(new THREE.TorusGeometry(0.12, 0.02, 6, 16), 'masonry'), 'iron', () => [0, 0]);
  // 石台只有石材：铁环用石材 + 深色区（避免第 3 个材质只为一个小环）→ 改为木材图集的铁区
  ring.mat = 'wood'; mapUVRegion(ring, 'iron', (x, y, z, u, v) => [u, v]);
  parts.push(xform(ring, mul(T(x1 + 0.03, 1.55, -8.7), RY(Math.PI / 2), RX(0.25))));
  const plate = mapUVRegion(fromGeo(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), 'wood'), 'iron', (x, y, z) => [0.5 + x * 3, 0.5 + z * 3]);
  parts.push(xform(plate, mul(T(x1 + 0.01, 1.68, -8.7), RZ(Math.PI / 2))));
  const lod0 = mergeParts(parts);
  // 碰撞
  const cb = [colBox((x0 + x1) / 2, (bot + top) / 2, (z0 + z1) / 2, x1 - x0, top - bot, z1 - z0)];
  for (const [xa, ty] of steps) cb.push(colBox(xa + RSTAIR.run / 2, (ty - 0.4) / 2, (RSTAIR.z[0] + RSTAIR.z[1]) / 2, RSTAIR.run, ty + 0.4, RSTAIR.z[1] - RSTAIR.z[0]));
  cb.push(colBox((x0 + x1) / 2, top + 0.3, z0 + 0.2, x1 - x0, 0.6, 0.36), colBox(x0 + 0.2, top + 0.3, (z0 + z1) / 2, 0.36, 0.6, z1 - z0));
  const helpers = [
    { name: 'env-shore-ledge-s1-bell-anchor', t: [-15.5, top, -6.2], r: quatLookY(Math.PI / 2), extras: { forPuzzle: 'tide-bell-s1', propTicket: 'v0.1-021', scale: 1, standY: top, contactAboveStand: 1.10, interactAheadM: 0.98, interactAt: [-15.5 + 0.98, top, -6.2], note: '潮汐钟 tide-bell-s1 摆放点（钟架根 = 钟台面 y 2.4）。返工 1029：+Z 朝 +X（西，礁石小径方向；白盒 puzzles.ts 的交互点在钟西侧 x+1.05 面朝钟），原 quatLookY(0.75π) 朝西南。敲击触点高出台面 1.10（021 道具：触点 Xi 局部 [−0.04, 1.10, 0.72]、r ≈ 0.26、钟心在交互点前 0.98；bell-swing 原点 = 吊点），S3 小潮钟同尺寸' } },
    { name: 'env-shore-ledge-s1-reef-stairs-top', t: [x1, top, (RSTAIR.z[0] + RSTAIR.z[1]) / 2], r: quatLookY(Math.PI / 2), extras: { note: '返工 1029：去礁石小径的台阶顶（layout.ts reefStairs：11 级 × 0.2，踏步 0.32，x −10 → −6.48，z −3.8…−2.2）', bottomTop: +(top - RSTAIR.rise * RSTAIR.n).toFixed(3) } },
    { name: 'env-shore-ledge-s1-safe-point', t: [-12.5, top, -4.0], r: quatLookY(Math.PI / 2), extras: { note: '送回安全点（涨潮落水后传送到这里）' } },
    { name: 'env-shore-ledge-s1-cam', t: [-18.2, 6.4, -12.6], r: quatLookAt([-18.2, 6.4, -12.6], [-6, 0.4, -0.5]), extras: { note: '钟台机位：同时看到钟和礁石滩（three 相机约定，-Z 看向目标）' } },
  ];
  return finishAsset({ name: 'env-shore-ledge-s1', lod0, uv2Size: 2048, collider: colliderFrom(cb), helpers,
    extras: { topY: top, stepsWest: { count: RSTAIR.n, rise: RSTAIR.rise, run: RSTAIR.run, z: RSTAIR.z, x: [x1, +(x1 + RSTAIR.run * RSTAIR.n).toFixed(2)], bottomTop: +(top - RSTAIR.rise * RSTAIR.n).toFixed(3) } } });
}

// =====================================================================================
// 北崖 + 潮沟 + 近侧石台 + 石脊 + 对岸石阶 + 出口裂谷
// =====================================================================================
const CH = { z0: 8.5, z1: 12.5, floorY: -0.5, slotX: [-1.9, 0.62], stop: [-2.4, -1.9], kerb: 0.28, slotTop: 0.1 };   // 返工 1029：石槽 x ≥ −1.9（layout.ts stoneSlot −1.9…0.1，原 −2.25）
const NEAR = { x0: -4.6, x1: 0.6, z0: 5.6, z1: 8.5, top: 1.85 };
// 返工 1029（对齐 layout.ts farSteps / plateau）：对岸台阶改为向北上行——x −2.4…0.6，平台 z 12.5–13.5（1.85），18 级 × 0.17 × 1/3 到 z 19.5（4.91），再一步上崖顶平台 5.2
// （原：沿 −X 向东上行到 x −10.8…−8.6 的 4.91 平台 + 裂谷）
const FAR = { x: [-2.4, 0.6], z0: 12.5, landing: 1.0, rise: 0.17, run: 1 / 3, n: 18, baseY: 1.85 };
FAR.landZ = [FAR.z0, FAR.z0 + FAR.landing]; FAR.z1 = FAR.landZ[1] + FAR.n * FAR.run; FAR.topY = FAR.baseY + FAR.n * FAR.rise;
const PLATEAU = { x: [-12, 0.6], z: [19.5, 23.5], top: 5.2 };
const CLEFT = { x: [-10.8, -8.4], z1: 27.5 };                // 出口北侧窄谷（视觉去 S2，地面缓升）
const RIDGE = [[-12, -2.2, 2.35], [-11, 0.5, 2.25], [-9, 3.0, 2.1], [-6.5, 5.4, 1.95], [-4.4, 6.6, 1.85]];
const EXIT = [-9.6, 5.2, 21];
const REEF_TOPS = [0.42, 0.5, 0.38, 0.55, 0.45, 0.36];   // layout.ts reefPath 顶面
const plateauY = (z) => PLATEAU.top + (z > PLATEAU.z[1] ? (z - PLATEAU.z[1]) * 0.22 : 0);
const stairTopAt = (z) => (z < FAR.landZ[1] ? FAR.baseY : z >= FAR.z1 ? PLATEAU.top : FAR.baseY + FAR.rise * Math.min(FAR.n, Math.ceil((z - FAR.landZ[1]) / FAR.run - 1e-6)));
const inStairBand = (x, z) => x > FAR.x[0] - 0.3 && x < FAR.x[1] + 0.3 && z > FAR.z0 + 0.4 && z < FAR.z1 + 0.05;
const inPlateauBand = (x, z) => x > PLATEAU.x[0] - 0.3 && x < PLATEAU.x[1] + 0.3 && z > PLATEAU.z[0] - 0.05;

function resample(poly, step) {
  const out = [];
  for (let k = 0; k < poly.length - 1; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) out.push([lerp(ax, bx, i / n), lerp(az, bz, i / n)]);
  }
  out.push(poly[poly.length - 1]);
  return out;
}
// 崖壁条带：沿基线（行进方向左手 = 朝外，内向 = up × 切线）竖起，带层理、凹凸、崖脚碎坡、顶部向内收的崖顶
function cliffStrip(poly, opt) {
  const step = opt.step ?? 0.17, pts = resample(poly, step), n = pts.length;
  const inw = pts.map((_, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz); return [tz / l, -tx / l]; });
  // up × t = (0,1,0) × (tx,0,tz) = (tz, 0, -tx)
  let maxH = 0; const yb = [], yt = [];
  pts.forEach(([x, z], i) => { yb.push(opt.yBot(x, z)); yt.push(opt.yTop(x, z, i)); maxH = Math.max(maxH, yt[i] - yb[i]); });
  const rows = Math.ceil(maxH / step), capRows = opt.capRows ?? 10;
  const p = grid(n - 1, rows + capRows, (u, v) => {
    const i = Math.round(u * (n - 1)), [bx, bz] = pts[i], [ix, iz] = inw[i];
    const j = v * (rows + capRows);
    let y, d;
    if (j <= rows) {
      const t = j / rows; y = lerp(yb[i], yt[i], t);
      const wx = bx, wz = bz;
      const big = (fbm(wx * 0.07, y * 0.1, wz * 0.07, 3) - 0.5) * 3.2;
      const strataS = y / 0.55 + fbm(wx * 0.15, 3, wz * 0.15, 2) * 2.2, f = strataS - Math.floor(strataS);
      const strata = sstep(0.62, 0.95, f) * 0.22 + (ridged(wx * 0.5, y * 1.3, wz * 0.5, 3) - 0.6) * 0.22;
      const crack = sstep(0.82, 0.9, ridged(wx * 0.16, y * 0.05, wz * 0.16, 2)) * 0.35;
      // 节理块：沿崖线按 ~2.4 m 分块、按岩层分层，每块独立进退，边缘倒角 → 海蚀崖的方块感
      const sArc = i * step / 2.4 + (fbm(wx * 0.3, y * 0.2, wz * 0.3, 2) - 0.5) * 1.4;
      const bi = Math.floor(sArc), bj = Math.floor(strataS), fu = sArc - bi;
      const bev = sstep(0, 0.09, Math.min(fu, 1 - fu)) * sstep(0, 0.12, Math.min(f, 1 - f));
      const blk = (hash3(bi, bj, 71) - 0.5) * 0.7 * bev - (1 - bev) * 0.12;
      const butt = (ridged(wx * 0.22, y * 0.035, wz * 0.22, 2) - 0.55) * -1.1; // 竖向扶壁 / 冲沟
      d = big + strata * 1.4 + crack + blk + butt + (fbm(wx * 1.8, y * 1.8, wz * 1.8, 3) - 0.5) * 0.14;
      d -= sstep(1.6, 0, y - yb[i]) * (opt.talus ?? 0.7);         // 崖脚外扩（负 = 朝外）
      d += sstep(yt[i] - 2.5, yt[i], y) * 1.2;                        // 崖顶边缘内收、变圆
      const lim = opt.maxOut ? opt.maxOut(bx, y, bz) : 9;
      d = Math.max(d, -lim);
    } else {
      const c = (j - rows) / capRows;
      y = yt[i] + c * (opt.capRise ?? 1.6) + (fbm(bx * 0.2, 7, bz * 0.2, 3) - 0.5) * (opt.capRoughness ?? 1.4) * c;
      d = 1.2 + c * (typeof opt.capDepth === 'function' ? opt.capDepth(bx, bz) : opt.capDepth ?? 9);
    }
    return [bx + ix * d, y, bz + iz * d];
  }, opt.mat ?? 'rock', false);
  // 朝向自检：面法线应朝外（-inward）
  let dot = 0; const a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < p.idx.length; t += 3 * 97) {
    a.fromArray(p.pos, p.idx[t] * 3); b.fromArray(p.pos, p.idx[t + 1] * 3); c.fromArray(p.pos, p.idx[t + 2] * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a)); const i = Math.min(n - 1, Math.round(((p.idx[t] % n)))); dot += -(e1.x * inw[i][0] + e1.z * inw[i][1]);
  }
  if (dot < 0) { for (let t = 0; t < p.idx.length; t += 3) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; } smoothNormals(p); }
  return p;
}
function rockSurface(nu, nv, fn) { const p = grid(nu, nv, fn, 'rock'); return p; }
function orientUp(p) { // 让网格法线大体朝上（地面类曲面）
  let s = 0; for (let i = 1; i < p.nrm.length; i += 3) s += p.nrm[i];
  if (s < 0) { for (let t = 0; t < p.idx.length; t += 3) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; } smoothNormals(p); }
  return p;
}
function buildCliff() {
  const parts = [], R = rng(777), cb = [];
  const inChannelBand = (x, z) => x < 1.0 && z > 12.2;
  // ---- 主崖
  // 返工 1029：崖线 = 西侧崖 → 台阶槽西壁 (x 0.6) → 崖顶平台北壁 (z 23.5，中间开出口窄谷) → 平台东壁 (x −12) → 平台南壁 (z 19.5) → 台阶槽东壁 (x −2.4) → 潮沟北岸
  const [px0, px1] = PLATEAU.x, [pz0, pz1] = PLATEAU.z, [cx0, cx1] = CLEFT.x;
  const main = [[32, 13.0], [24, 12.9], [16, 12.85], [8, 12.75], [px1, 12.7], [px1, pz1], [cx1, pz1], [cx1, CLEFT.z1], [cx0, CLEFT.z1], [cx0, pz1], [px0, pz1], [px0, pz0], [FAR.x[0], pz0], [FAR.x[0], FAR.z0], [-24, 12.5]];
  const cliff = cliffStrip(main, {
    yBot: (x, z) => (inPlateauBand(x, z) ? plateauY(z) - 0.35 : inStairBand(x, z) ? stairTopAt(z) - 0.35 : inChannelBand(x, z) ? -0.65 : terrainAt(x, z).h - 0.45),
    yTop: (x, z) => 9 + 7 * fbm(x * 0.045, 1, z * 0.045, 3) + (z > 15 ? 1.5 : 0) + sstep(14, 26, x) * 2,
    maxOut: (x, y, z) => (x < 1.2 && x > -12.6 && z > 12.2 ? (y < 7.8 ? 0.02 : 0.6) : x <= -12.6 && z > 12.2 ? (y < 6.5 ? 0.02 : 0.6) : 9),
    capDepth: (x, z) => (z < 13.2 && x < FAR.x[0] + 0.2 && x > -12.6 ? 5 : z > pz0 - 0.2 && z < pz0 + 0.2 && x < FAR.x[0] && x > px0 ? 5 : 9),   // 平台南侧那块岩体只有 7 m 深：两边崖顶别盖到平台上
    talus: 0.6,
  });
  parts.push(boxUV(cliff, MATS.rock.tile, [0.13, 0.41]));
  // ---- 潮沟南岸低崖（x ∈ [-24, -4.6]，z = 8.5，向 +X 行进 → 内向 = -Z）
  const bank = cliffStrip([[-24, 8.5], [-4.55, 8.5]], {
    yBot: () => -0.65, yTop: (x) => terrainAt(x, 7.9).h + 0.08, maxOut: () => 0.03, talus: 0, capRows: 4, capDepth: 1.2, step: 0.16,
  });
  parts.push(boxUV(bank, MATS.rock.tile, [0.71, 0.29]));
  // ---- 沟底 y = -0.5（x ∈ [-24, -2.25]）
  const floor = orientUp(rockSurface(Math.round(21.75 / 0.25), 18, (u, v) => {
    const x = lerp(-24, CH.slotX[0] + 0.05, u), z = lerp(CH.z0 - 0.15, CH.z1 + 0.15, v);
    return [x, CH.floorY + (fbm(x * 0.9, 2, z * 0.9, 3) - 0.5) * 0.04 + (ridged(x * 2, 1, z * 2, 2) - 0.6) * 0.015, z];
  }));
  parts.push(boxUV(floor, MATS.rock.tile, [0.5, 0.5]));
  cb.push(colBox((-24 + CH.slotX[0]) / 2, CH.floorY - 0.25, 10.5, CH.slotX[0] + 24, 0.5, 4));
  // ---- 石槽：槽底 0.1、两侧挡石 0.28、东端止推石 0.5
  masonryPlatform(parts, CH.slotX[0], CH.slotX[1], CH.z0 + 0.4, CH.z1 - 0.4, -0.65, CH.slotTop, 610, { sides: ['e'], paveThick: 0.18 });
  for (const [za, zb] of [[CH.z0, CH.z0 + 0.4], [CH.z1 - 0.4, CH.z1]]) {
    courseWall(parts, [CH.slotX[0], za], [CH.slotX[1], za], -0.65, CH.kerb, [0, -1], 620 + za, { depth: 0.4, course: 0.31 });
    paving(parts, CH.slotX[0], CH.slotX[1], za, zb, CH.kerb + 0.001, 640 + za, { thick: 0.12 });
    cb.push(colBox((CH.slotX[0] + CH.slotX[1]) / 2, (CH.kerb - 0.65) / 2, (za + zb) / 2, CH.slotX[1] - CH.slotX[0], CH.kerb + 0.65, 0.4));
  }
  const stop = stoneBlock(CH.stop[1] - CH.stop[0], 1.15, CH.z1 - CH.z0 - 0.8, 0.04, 650, 0.008);
  xform(stop, T((CH.stop[0] + CH.stop[1]) / 2, (0.5 - 0.65) / 2, 10.5)); parts.push(boxUV(stop, 2, [0.2, 0.9]));
  cb.push(colBox((CH.slotX[0] + CH.slotX[1]) / 2, (CH.slotTop - 0.65) / 2, 10.5, CH.slotX[1] - CH.slotX[0], CH.slotTop + 0.65, 3.2));
  cb.push(colBox((CH.stop[0] + CH.stop[1]) / 2, (0.5 - 0.65) / 2, 10.5, CH.stop[1] - CH.stop[0], 1.15, 3.2));
  // ---- 近侧崖下石台 y = 1.85
  masonryPlatform(parts, NEAR.x0, NEAR.x1, NEAR.z0, NEAR.z1, -0.65, NEAR.top, 700);
  cb.push(colBox((NEAR.x0 + NEAR.x1) / 2, (NEAR.top - 0.65) / 2, (NEAR.z0 + NEAR.z1) / 2, NEAR.x1 - NEAR.x0, NEAR.top + 0.65, NEAR.z1 - NEAR.z0));
  // ---- 石脊（始终高于水面 1.6；顶宽 1.6）
  const rp = [];
  for (let k = 0; k < RIDGE.length - 1; k++) for (let i = 0; i < 24; i++) { const t = i / 24; rp.push(RIDGE[k].map((v, d) => lerp(v, RIDGE[k + 1][d], t))); }
  rp.push(RIDGE[RIDGE.length - 1]);
  // 两端各延伸 0.6 m 埋进石台
  const ext = (a, b, l) => { const dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz); return [a[0] + dx / L * l, a[1] + dz / L * l, a[2]]; };
  rp.unshift(ext(rp[0], rp[1], 0.6)); rp.push(ext(rp[rp.length - 1], rp[rp.length - 2], 0.6));
  const ridgeTop = (s) => { const f = s * (rp.length - 1), i = Math.min(rp.length - 2, Math.floor(f)), t = f - i; return [lerp(rp[i][0], rp[i + 1][0], t), lerp(rp[i][1], rp[i + 1][1], t), lerp(rp[i][2], rp[i + 1][2], t)]; };
  const ridge = orientUp(rockSurface(220, 30, (u, v) => {
    const [x, z, top] = ridgeTop(u), [xa, za] = ridgeTop(Math.max(0, u - 0.004)), [xb, zb] = ridgeTop(Math.min(1, u + 0.004));
    const tl = Math.hypot(xb - xa, zb - za) || 1, nx = -(zb - za) / tl, nz = (xb - xa) / tl;
    const c = v * 2 - 1, ac = Math.abs(c), sg = Math.sign(c) || 1;
    let w, y;
    if (ac <= 0.45) { w = (c / 0.45) * 0.8; y = top + (fbm(x * 2.2, 4, z * 2.2, 3) - 0.5) * 0.035 + (ridged(x * 5, 1, z * 5, 2) - 0.6) * 0.01; }
    else {
      const t = (ac - 0.45) / 0.55, g = terrainAt(x + nx * sg * 2.6, z + nz * sg * 2.6).h - 0.35;
      const prof = 1 - Math.pow(t, 1.6);
      y = g + (top - g) * prof + (fbm(x * 1.5, t * 4 + 9, z * 1.5, 3) - 0.5) * 0.25 * Math.sin(t * Math.PI) - sstep(0, 0.12, t) * 0.04;
      // 沙面以上贴着石脊碰撞（宽 1.6）几乎竖直，像一道岩墙；埋进沙里才向外摊开
      const flare = sstep(0.12, -0.35, y);
      w = sg * (0.8 + 0.05 * t + (fbm(x * 0.8, t * 3, z * 0.8, 3) - 0.5) * 0.06 * t + flare * Math.pow(t, 1.4) * 2.0);
    }
    return [x + nx * w, y, z + nz * w];
  }));
  parts.push(boxUV(ridge, MATS.rock.tile, [0.37, 0.63]));
  for (let k = 0; k < rp.length - 1; k += 2) {
    const a = rp[k], b = rp[Math.min(rp.length - 1, k + 2)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), top = (a[2] + b[2]) / 2;
    cb.push(colBox((a[0] + b[0]) / 2, top - 0.6, (a[1] + b[1]) / 2, 1.6, 1.2, L + 0.05, Math.atan2(b[0] - a[0], b[1] - a[1])));
  }
  // ---- 对岸（返工 1029，layout.ts farSteps）：最下一级平台 x −2.4…0.6、z 12.5–13.5、y 1.85（石砌墩到 −0.65）
  masonryPlatform(parts, FAR.x[0], FAR.x[1], FAR.landZ[0], FAR.landZ[1], -0.65, FAR.baseY, 800, { sides: ['s', 'w', 'e'] });
  cb.push(colBox((FAR.x[0] + FAR.x[1]) / 2, (FAR.baseY - 0.65) / 2, (FAR.landZ[0] + FAR.landZ[1]) / 2, FAR.x[1] - FAR.x[0], FAR.baseY + 0.65, FAR.landZ[1] - FAR.landZ[0]));
  // 18 级踏步（每级 0.17 × 1/3），向北（+Z）上行到 z 19.5、4.91；踏步宽 3.0（两侧崖壁夹着）
  const W3 = FAR.x[1] - FAR.x[0], XC = (FAR.x[0] + FAR.x[1]) / 2;
  for (let i = 1; i <= FAR.n; i++) {
    const za = FAR.landZ[1] + (i - 1) * FAR.run - 0.02, zb = FAR.landZ[1] + i * FAR.run, ty = FAR.baseY + FAR.rise * i;
    const st = stoneBlock(W3 + 0.3 + (R() - 0.5) * 0.1, 0.26, zb - za + 0.04, 0.03, 820 + i, 0.006);
    xform(st, mul(T(XC + (R() - 0.5) * 0.04, ty - 0.13, (za + zb) / 2 + 0.02), RY((R() - 0.5) * 0.03)));
    parts.push(boxUV(st, 2, [R(), R()], R()));
    cb.push(colBox(XC, (ty - 0.65) / 2, FAR.landZ[1] + (i - 0.5) * FAR.run, W3, ty + 0.65, FAR.run + 0.005));
  }
  // 踏步下的岩坡（顶面贴着踏步下沿；两侧伸进崖壁 1.2 m，盖住崖脚和踏步端头之间的缝）
  const bench = orientUp(rockSurface(16, 120, (u, v) => {
    const x = lerp(FAR.x[0] - 1.2, FAR.x[1] + 1.2, u), z = lerp(FAR.landZ[1] - 0.1, FAR.z1 + 0.1, v);
    const top = Math.min(FAR.topY, FAR.baseY + ((z - FAR.landZ[1]) / FAR.run) * FAR.rise) - 0.28;
    return [x, top + (fbm(x, z, 5, 2) - 0.5) * 0.04, z];
  }));
  parts.push(boxUV(bench, MATS.rock.tile, [0.83, 0.17]));
  // 崖顶平台（x −12…0.6、z 19.5–23.5，顶 5.2）+ 北侧出口窄谷（地面缓升）；台阶顶 4.91 → 平台 5.2 一步
  const pl = orientUp(rockSurface(70, 26, (u, v) => {
    const x = lerp(PLATEAU.x[0] - 0.4, PLATEAU.x[1] + 0.4, u), z = lerp(PLATEAU.z[0] - 0.02, PLATEAU.z[1] + 0.4, v);
    const edge = Math.min(x - PLATEAU.x[0], PLATEAU.x[1] - x, PLATEAU.z[1] - z);
    return [x, PLATEAU.top + (fbm(x * 1.5, 6, z * 1.5, 3) - 0.5) * 0.05 + sstep(0.25, -0.4, edge) * 0.3, z];
  }));
  parts.push(boxUV(pl, MATS.rock.tile, [0.1, 0.9]));
  // 平台南沿（台阶顶那一步的立面：4.91 → 5.2）
  { const lip = stoneBlock(W3 + 0.2, 0.55, 0.3, 0.03, 870, 0.006); xform(lip, T(XC, PLATEAU.top - 0.275, FAR.z1 + 0.15)); parts.push(boxUV(lip, 2, [0.4, 0.6])); }
  cb.push(colBox((PLATEAU.x[0] + PLATEAU.x[1]) / 2, (PLATEAU.top - 0.65) / 2, (PLATEAU.z[0] + PLATEAU.z[1]) / 2, PLATEAU.x[1] - PLATEAU.x[0], PLATEAU.top + 0.65, PLATEAU.z[1] - PLATEAU.z[0]));
  const cleft = orientUp(rockSurface(14, 40, (u, v) => {
    const x = lerp(CLEFT.x[0] - 0.3, CLEFT.x[1] + 0.3, u), z = lerp(PLATEAU.z[1] + 0.2, CLEFT.z1 + 0.2, v);
    return [x, plateauY(z) + (fbm(x * 1.5, 6, z * 1.5, 3) - 0.5) * 0.05 + sstep(0.3, 0, Math.min(u, 1 - u)) * 0.25, z];
  }));
  parts.push(boxUV(cleft, MATS.rock.tile, [0.1, 0.9]));
  for (let z = PLATEAU.z[1]; z < CLEFT.z1; z += 1) cb.push(colBox((CLEFT.x[0] + CLEFT.x[1]) / 2, plateauY(z + 0.5) - 0.5, z + 0.5, CLEFT.x[1] - CLEFT.x[0], 1.0, 1.02));
  // 崖下几块坠石（装饰，和崖同一材质）
  const lod0 = mergeParts(parts);
  // 崖壁碰撞：sloppy 简化
  const wallCol = (p, target) => { const [idx] = MeshoptSimplifier.simplifySloppy(p.idx, p.pos, 3, null, target * 3, 0.02); const c = compact(p, idx); return { pos: c.pos, idx: c.idx, nrm: c.nrm, uv: c.uv }; };
  cb.push(wallCol(cliff, 4000), wallCol(bank, 300));
  const helpers = [
    { name: 'env-cliff-s1-exit-to-s2', t: EXIT, r: quatLookY(0), extras: { note: '场景出口 exit-to-s2（SceneExit 触发体放这里，+Z 朝北出去）', target: 's2', entry: 'spawn-from-s1' } },
    { name: 'env-cliff-s1-link-near', t: [-0.9, NEAR.top, NEAR.z1], extras: { note: 'TraversalLink：近侧石台边（跨 0.5 m 到浮台）' } },
    { name: 'env-cliff-s1-link-far', t: [-0.9, 1.85, FAR.landZ[0]], extras: { note: 'TraversalLink：对岸最下一级（跨 0.5 m 到浮台）' } },
    { name: 'env-cliff-s1-far-steps-top', t: [XC, FAR.topY, FAR.z1], r: quatLookY(0), extras: { note: '返工 1029：对岸台阶顶（第 18 级 4.91，z 19.5）；再一步 0.29 上崖顶平台 5.2', count: FAR.n, rise: FAR.rise, run: +FAR.run.toFixed(4) } },
    { name: 'env-cliff-s1-plateau', t: [(PLATEAU.x[0] + PLATEAU.x[1]) / 2, PLATEAU.top, (PLATEAU.z[0] + PLATEAU.z[1]) / 2], extras: { note: '返工 1029：崖顶平台（layout.ts plateau）', min: [PLATEAU.x[0], PLATEAU.z[0]], max: [PLATEAU.x[1], PLATEAU.z[1]], topY: PLATEAU.top } },
    { name: 'env-cliff-s1-raft-slot', t: [-0.9, CH.slotTop, 10.5], extras: { note: '浮台在槽中的中心；x ∈ [-1.9, 0.1]，z ∈ [9, 12]', kerbTop: CH.kerb, stopTop: 0.5 } },
  ];
  // 原点固定在 029 烘焙时的位置（光照贴图 UV2 按它对齐）
  return finishAsset({ name: 'env-cliff-s1', origin: [4, 0, 17], lod0, uv2Size: 2048, collider: colliderFrom(cb), helpers,
    extras: { channel: { widthM: 4, floorY: CH.floorY, z: [CH.z0, CH.z1] }, nearPlatformY: NEAR.top, farLowestStepY: 1.85, steps: { count: FAR.n, rise: FAR.rise, run: +FAR.run.toFixed(4), x: FAR.x, landingZ: FAR.landZ, z1: FAR.z1, topY: +FAR.topY.toFixed(2), direction: '+Z（北）' }, plateau: PLATEAU, slotX: [-1.9, 0.1], ridgeTopsY: RIDGE.map((r) => r[2]) } });
}

// =====================================================================================
// 倒塌渔具棚（西侧远景，不可进入）
// =====================================================================================
function beam(parts, a, b, w, h, reg = 'beam', seed = 0) {
  const d = V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  const p = plank(L, w, h, reg, { uLen: reg === 'shed' ? 2.0 : 2.5, uOff: (seed * 0.37) % 1 });
  const q = new THREE.Quaternion().setFromUnitVectors(V3(1, 0, 0), d.clone().normalize());
  parts.push(xform(p, mul(T((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new THREE.Matrix4().makeRotationFromQuaternion(q), RX(seed % 1))));
}

const BELL_WALL = { x0: -16.62, x1: -16.22, z0: -7.1, z1: -4.9, top: 3.3 };   // layout.ts bellWall
function buildUnloadingShore() {
  const parts = [];
  // 岸台背后的岬角向内陆升高，露出连续的层岩轮廓；高处留在可走边界外。
  const promontory = orientUp(rockSurface(76, 132, (u, v) => {
    const z = lerp(-21, 26, v);
    const edge = -19.45 - 2.5 * sstep(-6, -19, z) - 2.4 * sstep(10, 22, z);
    const x = lerp(edge, -40, u);
    const rise = 4.4 + 5.5 * sstep(-8, 18, z);
    const inland = sstep(0, 0.47, u) * (1 - sstep(0.76, 1, u));
    const coast = sstep(-21, -10, z) * (1 - sstep(19, 26, z));
    const strata = 0.36 * Math.sin(u * 59 + fbm(x * 0.3, 8, z * 0.25, 3) * 4);
    const relief = (fbm(x * 0.38, 12, z * 0.36, 3) - 0.5) * 2.3;
    return [x, -0.95 + (rise + relief + strata) * inland * coast, z];
  }));
  parts.push(boxUV(promontory, MATS.rock.tile, [0.13, 0.41]));

  // 钟台坐在基岩岬角上；岬角向北收窄，埋进原有的礁脊。
  const headland = [[-22.8, -11.65], [-19.5, -11.1], [-17.1, -10.5], [-14.5, -9.75],
    [-13.0, -7.7], [-12.6, -5.4], [-12.35, -2.2], [-11.0, 0.5], [-9.0, 3], [-6.5, 5.4]];
  const bank = cliffStrip(headland.reverse(), {
    step: 0.29, capRows: 5, capDepth: 4, capRise: 0.12, capRoughness: 0.16, talus: 0.35,
    yBot: (x, z) => Math.min(-0.32, terrainAt(x, z).h - 0.3),
    yTop: (x, z) => 1.69 - sstep(-1, 6, z) * 0.55 + (fbm(x * 0.2, 5, z * 0.25, 3) - 0.5) * 0.22,
    maxOut: (x, y, z) => 0.18 * (1 - sstep(-2.2, 0, z)),
  });
  parts.push(boxUV(bank, MATS.rock.tile, [0.13, 0.41]));

  // 原石台承托码头；收口梁留在甲板碰撞范围内，退潮时不挡桥下通道。
  const yBearing = PIER.deckY - 0.19, zBearing = PIER.length / 2;
  const bearingHalfWidth = PIER.width / 2 - 0.03;
  beam(parts, pierToWorld(-bearingHalfWidth, yBearing, zBearing),
    pierToWorld(bearingHalfWidth, yBearing, zBearing), 0.20, 0.17, 'beam', 21);

  // 钟台原调查点改成嵌铁刻度的石柱，位置与白盒相同。
  const gx = -14.2, gz = -7.6;
  for (const [w, h, y, seed] of [[0.37, 0.16, 0.06, 2110], [0.28, 2.05, 1.16, 2111], [0.33, 0.09, 2.16, 2112]]) {
    const part = stoneBlock(w, h, w, 0.025, seed);
    parts.push(boxUV(xform(part, T(gx, LEDGE.top + y, gz)), MATS.masonry.tile, [0.18, 0.68]));
  }
  for (let i = 0; i < 9; i++) {
    const y = LEDGE.top + 0.38 + i * 0.18, half = i % 2 === 0 ? 0.092 : 0.056;
    beam(parts, [gx - half, y, gz - 0.141], [gx + half, y, gz - 0.141], 0.016, 0.012, 'iron');
  }

  // 潮汐钟落在嵌进台面的整块基石上，背后一道齐胸的护墙（白盒 s1-bell-wall 同尺寸）挡海风，铁拉杆把石柱顶拉进墙里。
  const bpx = -15.5, bpz = -5.54;
  parts.push(boxUV(xform(stoneBlock(0.92, 0.14, 0.92, 0.02, 2120), T(bpx, LEDGE.top - 0.035, bpz)), MATS.masonry.tile, [0.42, 0.18]));
  for (const [dx, dz] of [[0.36, 0], [-0.36, 0], [0, 0.36], [0, -0.36]]) {
    const wedge = stoneBlock(dx ? 0.12 : 0.5, 0.1, dz ? 0.12 : 0.5, 0.015, 2121 + dx * 10 + dz * 5);
    parts.push(boxUV(xform(wedge, T(bpx + dx * 0.72, LEDGE.top + 0.08, bpz + dz * 0.72)), MATS.masonry.tile, [0.52, 0.2]));
  }
  courseWall(parts, [BELL_WALL.x1, BELL_WALL.z0], [BELL_WALL.x1, BELL_WALL.z1], LEDGE.top - 0.1, BELL_WALL.top, [1, 0], 2130, { depth: BELL_WALL.x1 - BELL_WALL.x0, course: 0.28 });
  beam(parts, [bpx, LEDGE.top + 2.08, bpz], [BELL_WALL.x1 + 0.02, BELL_WALL.top - 0.12, bpz], 0.035, 0.035, 'iron');
  beam(parts, [BELL_WALL.x1 + 0.03, BELL_WALL.top - 0.22, bpz - 0.09], [BELL_WALL.x1 + 0.03, BELL_WALL.top - 0.02, bpz - 0.09], 0.05, 0.03, 'iron');

  // 小径的露头属于同一层基岩。石脊是高路，低路的岩层只接石阶与湿沙。
  const path = [[LEDGE.x1 + RSTAIR.n * RSTAIR.run - 0.23, 0.2, -3],
    ...REEF_PATH.map(([x, z], i) => [x, REEF_TOPS[i], z]), [1.8, 0.1, 3.4]];
  const shelf = orientUp(rockSurface(84, 18, (u, v) => {
    const f = u * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), t = f - i, a = path[i], b = path[i + 1];
    const x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t), top = lerp(a[1], b[1], t);
    const prev = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 2)];
    const ax = lerp(b[0] - prev[0], next[0] - a[0], t);
    const az = lerp(b[2] - prev[2], next[2] - a[2], t);
    const len = Math.hypot(ax, az), side = v * 2 - 1;
    const as = Math.abs(side), hw = 0.66;
    const w = Math.sign(side) * (as <= 0.7 ? (as / 0.7) * hw : hw + ((as - 0.7) / 0.3) * (0.45 + 0.3 * fbm(x, 4.3, z, 3)));
    const wx = x - az / len * w, wz = z + ax / len * w;
    const g = terrainAt(wx, wz).h - 0.15;
    const relief = (fbm(wx * 2.5, 8.7, wz * 2.5, 3) - 0.5) * 0.07;
    const y = lerp(top - 0.055 + relief, g, sstep(0.7, 0.75, as));
    return [wx, lerp(g, y, 1 - sstep(0.88, 1, u)), wz];
  }));
  parts.push(boxUV(shelf, MATS.rock.tile, [0.13, 0.41]));

  // 两处砌石泊位的护舷木固定在台壁，退潮推筏的沟道和涨潮跨步口均留空。
  for (const [z, top, sign] of [[NEAR.z1, NEAR.top, 1], [FAR.z0, FAR.baseY, -1]]) {
    for (const x of [FAR.x[0] + 0.22, FAR.x[1] - 0.22]) {
      beam(parts, [x, 0.26, z + 0.055 * sign], [x, top + 0.20, z + 0.055 * sign], 0.16, 0.16, 'pile', x);
    }
    beam(parts, [FAR.x[0] + 0.11, top - 0.16, z + 0.043 * sign], [FAR.x[1] - 0.11, top - 0.16, z + 0.043 * sign], 0.095, 0.15);
  }
  // 对岸踏步两侧的短翼墙砌入崖脚，不在沟里另放散石。
  for (const [lo, hi] of [[FAR.x[0] - 0.61, FAR.x[0]], [FAR.x[1], FAR.x[1] + 0.57]]) {
    masonryPlatform(parts, lo, hi, FAR.z0 - 0.16, FAR.z0 + FAR.landing + 0.8, -0.65, FAR.baseY + 0.39, 2030 + lo * 10);
  }
  return finishAsset({ name: 'env-unloading-shore-s1', origin: [0, 0, 0], parts, uv2Size: 1024 });
}

function buildShed() {
  const parts = [], R = rng(1717), C = [18.2, 0, 2.5];
  const gy = (x, z) => terrainAt(x, z).h;
  const W = 4.2, D = 3.2, H = 2.4; // 局部：x 宽、z 深
  const base = Math.max(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => gy(C[0] + sx * W / 2, C[2] + sz * D / 2)));
  const w = (x, y, z) => [C[0] + x, base + y, C[2] + z];
  // 石砌墙基（0.35 高，露出地面）
  const foot = [];
  for (const [a, b, out] of [[[-W / 2, -D / 2], [W / 2, -D / 2], [0, -1]], [[W / 2, D / 2], [-W / 2, D / 2], [0, 1]], [[W / 2, -D / 2], [W / 2, D / 2], [1, 0]], [[-W / 2, D / 2], [-W / 2, -D / 2], [-1, 0]]])
    courseWall(parts, [C[0] + a[0], C[2] + a[1]], [C[0] + b[0], C[2] + b[1]], base - 0.5, base + 0.32, out, 1800 + a[0] * 7 + a[1], { depth: 0.3, course: 0.27, overlap: 0.15 });
  // 角柱：两根还立着，一根歪，一根断
  const posts = [[-W / 2 + 0.1, -D / 2 + 0.1, H + 0.3, 0, 0], [W / 2 - 0.1, -D / 2 + 0.1, H, 0.05, 0], [W / 2 - 0.1, D / 2 - 0.1, H - 0.9, 0.22, -0.15], [-W / 2 + 0.1, D / 2 - 0.1, 1.1, 0, 0]];
  posts.forEach(([x, z, h, lean, lz], i) => { const a = w(x, 0.3, z), b = w(x + lean * h, 0.3 + h, z + lz * h); beam(parts, a, b, 0.14, 0.14, 'beam', i + 0.3); });
  // 墙板：东墙（朝场景）大部分还在，北墙残几块
  for (let k = 0; k < 13; k++) {
    const x = -W / 2 + 0.25 + k * 0.3; if (k === 5 || k === 9 || k === 10) continue;
    const top = 0.3 + (k < 8 ? 1.9 + R() * 0.4 : 0.6 + R() * 0.9);
    beam(parts, w(x, 0.3, -D / 2 + 0.03), w(x + (R() - 0.5) * 0.06, top, -D / 2 + 0.03), 0.28, 0.03, 'shed', k);
  }
  for (let k = 0; k < 6; k++) { const x = W / 2 - 0.25 - k * 0.32; beam(parts, w(x, 0.3, D / 2 - 0.03), w(x + 0.05, 0.3 + 0.8 + R() * 0.8, D / 2 - 0.03), 0.3, 0.03, 'shed', k + 20); }
  for (let k = 0; k < 9; k++) { const z = -D / 2 + 0.25 + k * 0.33; if (k > 6) continue; beam(parts, w(-W / 2 + 0.03, 0.3, z), w(-W / 2 + 0.03, 0.3 + 1.6 + R() * 0.6, z), 0.3, 0.03, 'shed', k + 40); }
  // 檐梁 + 塌下来的屋面（一端还搭在南墙顶，另一端落地）
  beam(parts, w(-W / 2, H + 0.25, -D / 2 + 0.1), w(W / 2, H + 0.1, -D / 2 + 0.1), 0.16, 0.16, 'beam', 5);
  const roofA = [-W / 2 + 0.1, H + 0.32, -D / 2 - 0.25], roofB = [W / 2 - 0.4, 0.55, D / 2 + 0.2];
  for (let k = 0; k < 7; k++) { // 椽子
    const t = k / 6, x0 = lerp(-W / 2 + 0.1, W / 2 - 0.2, t);
    beam(parts, w(x0, lerp(H + 0.32, H - 0.05, t), -D / 2 - 0.3), w(x0 + 0.2, lerp(0.5, 1.6, t * t), D / 2 + 0.25), 0.07, 0.12, 'beam', k + 60);
  }
  for (let k = 0; k < 16; k++) { // 屋面板（有缺）
    if ([3, 7, 8, 12].includes(k)) continue;
    const t = (k + 0.5) / 16, z0 = -D / 2 - 0.3, z1 = D / 2 + 0.25, y0 = H + 0.36, y1 = lerp(0.56, 1.66, 0.5);
    const z = lerp(z0, z1, t), y = lerp(y0, y1, t) - Math.sin(t * Math.PI) * 0.25, tilt = (t - 0.5) * 0.25;
    beam(parts, w(-W / 2 - 0.15, y + tilt * 0.6, z), w(W / 2 - 0.1 - (k > 11 ? 1.4 : 0), y - tilt, z + 0.05), 0.2, 0.025, 'shed', k + 80);
  }
  // 地上散落的板、一只破木桶的箍
  for (let k = 0; k < 7; k++) { const x = (R() - 0.5) * 5, z = -D / 2 - 0.6 - R() * 1.6; beam(parts, w(x, 0.04 + gy(C[0] + x, C[2] + z) - base, z), w(x + (R() - 0.5) * 2.2, 0.08 + gy(C[0] + x, C[2] + z) - base, z + (R() - 0.5) * 1.2), 0.18, 0.025, 'shed', k + 120); }
  const barrel = lathePart([[0.001, 0], [0.24, 0], [0.28, 0.25], [0.29, 0.38], [0.27, 0.62], [0.23, 0.72], [0.001, 0.72]], 12, 'wood');
  mapUVRegion(barrel, 'shed', (x, y, z, u) => [u * 1.5, y / 0.8]); weldNormals(barrel);
  parts.push(xform(barrel, mul(T(...w(-1.4, 0.15, -D / 2 - 0.9)), RZ(1.45), RY(0.4))));
  const lod0 = mergeParts(parts);
  const cb = [colBox(C[0], base + 1.2, C[2], W + 0.4, 2.8, D + 0.8)];
  return finishAsset({ name: 'env-fish-shed-ruin', lod0, collider: colliderFrom(cb),
    extras: { enterable: false, note: '西侧远景，在 env-tidal-flat-s1-wall 之外，碰撞只是一个整体盒子' } });
}

// =====================================================================================
// 晾网架（两种变体）
// =====================================================================================
function netSheet(parts, a, b, drop, sag, seed, opt = {}) {
  // a、b：横杆上的两个挂点（世界坐标）；网片下垂 drop 米，中间下兜 sag，被风轻轻吹向 +X
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), nu = Math.max(6, Math.round(L / 0.12)), nv = Math.max(6, Math.round(drop / 0.12));
  const p = grid(nu, nv, (u, v) => {
    const x = lerp(a[0], b[0], u), z = lerp(a[2], b[2], u), top = lerp(a[1], b[1], u) - Math.sin(u * Math.PI) * sag * 0.25;
    const hang = drop * v * (1 - (opt.torn ? sstep(0.55, 0.9, fbm(u * 4, v * 4, seed, 2)) * 0.5 * v : 0));
    const bulge = Math.sin(u * Math.PI) * (sag * v + 0.08 * Math.sin(v * Math.PI));
    const nx = -(b[2] - a[2]) / L, nz = (b[0] - a[0]) / L;
    const fold = Math.sin(u * L * 4.5 + seed) * 0.05 * v + (fbm(u * 6, v * 6, seed, 2) - 0.5) * 0.12 * v;
    return [x + nx * (bulge + fold), top - hang, z + nz * (bulge + fold)];
  }, 'net');
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const k = j * (nu + 1) + i; p.uv[k * 2] = (i / nu) * L / MATS.net.tile; p.uv[k * 2 + 1] = (j / nv) * drop / MATS.net.tile; }
  parts.push(p);
}
function buildNetRack(variant) {
  const parts = [], R = rng(variant === 'a' ? 3131 : 4141);
  const C = variant === 'a' ? [16.2, 0, -2.5] : [17.4, 0, 7.6];
  const yaw = variant === 'a' ? 0.25 : -0.4;
  const gy = (x, z) => terrainAt(x, z).h;
  const loc = (x, z) => [C[0] + x * Math.cos(yaw) + z * Math.sin(yaw), C[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
  const bays = variant === 'a' ? 2 : 1, span = 2.3, H = 1.95;
  const postX = [...Array(bays + 1).keys()].map((k) => (k - bays / 2) * span);
  const tops = [];
  postX.forEach((x, k) => {
    const [wx, wz] = loc(x, 0), g = gy(wx, wz);
    const lean = variant === 'b' && k === 0 ? 0.18 : (R() - 0.5) * 0.05;
    const top = [wx + lean * 0.7, g + H + (R() - 0.5) * 0.1, wz + lean * 0.4];
    for (const q of woodPost(0.055, -0.4, H + 0.12, k + (variant === 'a' ? 0 : 9), 8, 'beam')) parts.push(xform(q, mul(T(wx, g, wz), RZ(-lean * 0.5), RX(lean * 0.3))));
    // 斜撑脚
    const [bx, bz] = loc(x, 0.55); beam(parts, [wx, g + 1.0, wz], [bx, gy(bx, bz) - 0.05, bz], 0.05, 0.05, 'beam', k + 3);
    tops.push(top);
  });
  // 横杆（圆木）
  const pole = []; for (let i = 0; i <= 12; i++) { const t = i / 12, k = Math.min(tops.length - 2, Math.floor(t * (tops.length - 1))), f = t * (tops.length - 1) - k; pole.push(tops[k].map((v, d) => lerp(v, tops[k + 1][d], f) - (d === 1 ? Math.sin(f * Math.PI) * 0.03 : 0))); }
  const ext = (p0, p1) => p0.map((v, d) => v + (p0[d] - p1[d]) * 0.12);
  pole.unshift(ext(pole[0], pole[1])); pole.push(ext(pole[pole.length - 1], pole[pole.length - 2]));
  parts.push(mapUVRegion(tubePart(pole, 0.045, 40, 8, 'wood'), 'beam', (x, y, z, u, v) => [u * 2, v]));
  // 网片
  for (let k = 0; k < bays; k++) {
    const a = tops[k].slice(), b = tops[k + 1].slice(); a[1] -= 0.03; b[1] -= 0.03;
    const shrink = (p, q, t) => p.map((v, d) => lerp(v, q[d], t));
    netSheet(parts, shrink(a, b, 0.05), shrink(b, a, 0.05), variant === 'b' ? 1.25 : 1.55 - k * 0.2, 0.25, k * 7 + 1, { torn: variant === 'b' });
  }
  if (variant === 'b') { // 落在地上的一团网（压扁的网片）+ 浮子
    const [cx, cz] = loc(0.5, 0.9);
    const pile = grid(14, 10, (u, v) => { const x = cx + (u - 0.5) * 1.6, z = cz + (v - 0.5) * 1.1; return [x, gy(x, z) + 0.02 + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.12 + (fbm(u * 5, v * 5, 3, 2) - 0.5) * 0.12, z]; }, 'net', true);
    for (let i = 0; i < pile.pos.length / 3; i++) { pile.uv[i * 2] = pile.pos[i * 3] / 0.5; pile.uv[i * 2 + 1] = pile.pos[i * 3 + 2] / 0.5; }
    parts.push(pile);
  }
  for (let k = 0; k < 5; k++) { // 网上挂的木浮子
    const t = (k + 0.5) / 5, top = tops[0].map((v, d) => lerp(v, tops[tops.length - 1][d], t));
    const f = fromGeo(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6), 'wood'); mapUVRegion(f, 'shed', (x, y, z, u, v) => [u * 0.2, v * 0.2]);
    parts.push(xform(f, mul(T(top[0], top[1] - 0.06, top[2]), RZ(Math.PI / 2))));
  }
  const lod0 = mergeParts(parts);
  const cb = postX.map((x) => { const [wx, wz] = loc(x, 0); return colBox(wx, gy(wx, wz) + 1, wz, 0.2, 2, 0.2); });
  return finishAsset({ name: `env-net-rack-${variant}`, lod0, collider: colliderFrom(cb), uv2Size: 512,
    extras: { variant, note: variant === 'a' ? '两跨，网片完整' : '单跨，一根柱歪，网片破、一团落地', netMaterial: 'mat-env-net（alpha MASK 0.5，双面）' } });
}

// =====================================================================================
// 远景灯塔剪影（impostor 风格：极简体块，统一剪影色，靠雾融入）
// =====================================================================================
function silParts(silDetail) {
  const parts = [];
  // 岩岛
  const isle = fromGeo(new THREE.IcosahedronGeometry(1, silDetail[0]), 'sil');
  const pa = isle.pos;
  for (let i = 0; i < pa.length; i += 3) {
    const x = pa[i], y = pa[i + 1], z = pa[i + 2];
    const s = 1 + (fbm(x * 1.5, y * 1.5, z * 1.5, 3) - 0.5) * 0.5;
    pa[i] = x * 22 * s; pa[i + 1] = Math.max(-0.3, y) * 7 * s; pa[i + 2] = z * 14 * s;
  }
  smoothNormals(isle); parts.push(isle);
  // 塔身 + 灯室 + 屋顶
  const LS = silDetail[1];
  parts.push(xform(lathePart([[3.0, 0], [2.9, 1], [2.2, 20], [2.3, 20.4], [3.0, 20.6], [3.0, 21.1], [1.8, 21.2], [1.8, 23.6], [2.1, 23.7], [1.2, 25.0], [0.15, 26.3], [0.05, 27.2], [0.001, 27.3]], LS, 'sil'), T(2, 4.5, 0)));
  parts.push(xform(box(5, 4.2, 3.6, 'sil'), T(-4.2, 6.4, 1)));          // 看守屋
  parts.push(xform(fromGeo(new THREE.CylinderGeometry(0.01, 3.2, 2.0, 4, 1), 'sil'), mul(T(-4.2, 9.5, 1), RY(Math.PI / 4), S(1.1, 1, 0.8))));
  const m = mergeParts(parts);
  for (const p of m) { for (let i = 0; i < p.uv.length; i++) p.uv[i] = 0.5; }
  return m;
}
function buildSilhouette() {
  const lods = [silParts([6, 12]), silParts([4, 8]), silParts([2, 6])];
  return finishAsset({ name: 'env-lighthouse-silhouette-far', lods, origin: [0, 0, 0], uv2Size: 256,
    placement: { instances: [{ translation: [23.1, -0.5, -321.9], rotationY: -0.8, scale: 0.8 }, { translation: [142.9, -0.5, -268.5], rotationY: 1.9, scale: 0.72 }], note: 'S1 两处远景小塔，分在主灯塔两侧（开场画面横向约 41 % 和 73 %，对齐概念图）；主灯塔 = env-lighthouse-island-main-s3tower + 020 塔（约 58.5 %）。S2、S3 按各自构图另摆' },
    extras: { impostor: true, heightM: 31.8, note: '远景剪影：单色材质，靠雾和剪影色融入天际；不要描边' } });
}

// =====================================================================================
// 主灯塔岩岛（018 第二部分，11:50 按概念图改比例）
//   概念图：低矮、黑、碎石堆成的宽扁礁丘（高 ≈ 塔高的 1/4–1/3）+ 细高白塔，岛+塔约占画面高 1/3，塔占大头。
//   开场镜头 (-0.9,4.2,9.5) 水平看向南偏西（俯仰 0°，原 -4.7°）：岛放在 110 m 外、画面横向约 58.5 %。
//   岛 = 宽扁高度场（椭圆底 + 碎块噪声，无台阶、无尖柱）+ 一圈半埋的碎礁（makeRockC 放大）+ 两条低矮礁尾；
//   塔 = 白色石砌细塔（mat-env-lighthouse-white）+ 外廊 + 铁灯室 + 圆顶。局部原点 = 塔基中心的 y = 0，局部 y = 世界高度。
// =====================================================================================
// 开场机位（预览；不动）。岛沿视线从 110.7 m 推到 1.25× = 138.4 m（占位，正式坐标 013 与 S3 一起定）
const OPEN_CAM = [-0.9, 4.2, 9.5], ISLAND_AT_018 = [31.6, 0, -96.3], ISLAND_PUSH = 1.25;
const S3_FRAME = { towerCenter: [39.73, 0, -122.75], rotY: (135 * Math.PI) / 180, islandRotY: -0.19, socketY: 6.6 };   // = game/src/levels/s1/layout.ts S3_WORLD_FRAME（返工 1029）
const ISLAND_AT = LEGACY_TOWER ? ISLAND_AT_018 : [0, 1, 2].map((k) => (k === 1 ? 0 : +(OPEN_CAM[k] + (ISLAND_AT_018[k] - OPEN_CAM[k]) * ISLAND_PUSH).toFixed(2)));
const ISLAND_DIST = Math.hypot(ISLAND_AT[0] - OPEN_CAM[0], ISLAND_AT[2] - OPEN_CAM[2]);
// 中景雾：保持和 018 一样的雾占比（110.7 m × 0.0045）→ 密度按距离反比
const ISLAND_FOG = LEGACY_TOWER ? 0.0045 : +(0.0045 * Math.hypot(ISLAND_AT_018[0] - OPEN_CAM[0], ISLAND_AT_018[2] - OPEN_CAM[2]) / ISLAND_DIST).toFixed(4);
// flatR：塔基压平半径 [全平, 过渡到原地形]。020 塔勒脚半径 4.15 → 加宽到 5.0 / 7.0（旧细塔 3.0 / 5.2）
const ISLAND = { at: ISLAND_AT, rotY: -0.19, plateauY: 7.4, shaftH: 14.6, flatR: LEGACY_TOWER ? [3.0, 5.2] : [5.0, 7.0],
  // spread：礁丘水平放大（不加高）。岛推远 1.25× 后礁丘在画面里也同比放宽，配 020 粗塔仍读作「宽扁低丘」
  spread: LEGACY_TOWER ? 1 : ISLAND_PUSH };
function islandH(xw, zw) {
  const x = xw / ISLAND.spread, z = zw / ISLAND.spread;
  // 局部 x 与画面横向一致；礁丘往右（+x）拖得更长（概念图右侧碎礁尾）
  const ux = x > 0 ? x / 21 : x / 15, uz = z / 11;
  const wob = (fbm(x * 0.07 + 3, 0, z * 0.07, 3) - 0.5) * 0.6;
  const core = 1 - Math.hypot(ux, uz) * (1 + wob);
  if (core < -0.3) return -3;
  // 宽扁：中心 ~7.6，边缘很快落到水下；凸形剖面（顶部圆钝、四周陡）
  let h = -3 + 10.6 * Math.pow(sstep(-0.3, 0.95, core), 0.7);
  // 碎块：两层脊状噪声 + 取整成小台阶面（0.45 m，随机倾斜）→ 乱石堆而不是山体层理
  const rg = ridged(x * 0.16, 1.7, z * 0.16, 3), rg2 = ridged(x * 0.42, 6.1, z * 0.42, 2);
  const on = sstep(-0.1, 0.25, core);
  h += ((rg - 0.55) * 2.4 + (rg2 - 0.55) * 0.8) * on;
  const tilt = (fbm(x * 0.2, 9, z * 0.2, 2) - 0.5) * 0.9;
  const q = 0.45, t = (h + tilt) / q, k = Math.floor(t), fr = t - k;
  h = lerp(h, (k + sstep(0.45, 0.8, fr)) * q - tilt, 0.55 * on);
  // 塔基：压平到 plateauY（半径见 ISLAND.flatR）
  const pk = sstep(ISLAND.flatR[1], ISLAND.flatR[0], Math.hypot(xw, zw));
  return lerp(h, ISLAND.plateauY + (fbm(x * 0.6, 2, z * 0.6, 2) - 0.5) * 0.15, pk);
}
function islandParts(det) {
  const parts = [];
  // 高度场
  const SP = ISLAND.spread, X0 = -24 * SP, X1 = 30 * SP, Z0 = -16 * SP, Z1 = 16 * SP, nx = det.nx, nz = Math.round(det.nx * (Z1 - Z0) / (X1 - X0));
  let hf = grid(nx, nz, (u, v) => { const x = lerp(X0, X1, u), z = lerp(Z1, Z0, v); return [x, islandH(x, z), z]; }, 'rock');
  hf = orientUp(hf);
  { const keep = []; for (let t = 0; t < hf.idx.length; t += 3) { const ys = [0, 1, 2].map((k) => hf.pos[hf.idx[t + k] * 3 + 1]); if (Math.max(...ys) > -2.5) keep.push(hf.idx[t], hf.idx[t + 1], hf.idx[t + 2]); } hf.idx = Uint32Array.from(keep); hf = compact(hf, hf.idx); }
  hf = boxUV(hf, 3.0, [0.3, 0.7], 0.4);
  parts.push(hardEdgeNormals(hf, 40));
  // 半埋碎礁：沿礁丘边缘和坡面（全是低矮、平顶的 c/d/f；没有尖柱）
  const R = rng(9137);
  const place = (pr, x, y, z, sx, sy, sz, ry) => xform(pr, mul(T(x, y, z), RY(ry), S(sx, sy, sz)));
  const nB = det.boulders;
  for (let i = 0; i < nB; i++) {
    const ang = R() * Math.PI * 2, rr = 0.35 + R() * 0.7;
    const x = Math.cos(ang) * rr * (Math.cos(ang) > 0 ? 20 : 14) * SP, z = Math.sin(ang) * rr * 10.5 * SP;
    const g = islandH(x, z); if (g < -1.5 || Math.hypot(x, z) < 5) continue;
    const k = 'cdfdc'[i % 5], c = { ...ROCKS[k], seed: 500 + i * 11, detail: det.rock, strataH: 0.14, cracks: 4 };
    const { prim, height } = makeRockC(c, { tile: 2.0 / 2.5 });
    const sc = (2.2 + R() * 1.8) * Math.sqrt(SP), sy = sc / Math.sqrt(SP) * (0.55 + R() * 0.45);
    parts.push(place(prim, x, g - height * sy * 0.45, z, sc, sy, sc * (0.8 + R() * 0.4), R() * 6.28));
  }
  // 两条礁尾（左短右长），涨潮只露 0.3–0.8 m
  const tails = [[-17, -1, 2.6], [-21, 2, 2.2], [22, 1, 3.0], [27, -2, 2.6], [31, 0.5, 2.2], [35, -1.5, 1.8]];
  tails.forEach(([x, z, sc], i) => {
    const c = { ...ROCKS.f, seed: 400 + i * 17, detail: det.rock, strataH: 0.12, cracks: 4 };
    const { prim, height } = makeRockC(c, { tile: 2.0 / sc });
    const top = 1.6 + 0.3 + R() * 0.5, bot = -1.8, sy = (top - bot) / height;
    parts.push(place(prim, x * SP, bot, z * SP, sc * 1.3 * SP, sy, sc * 0.8 * SP, (R() - 0.5) * 0.5));
  });
  if (det.noTower) return mergeParts(parts);
  // 灯塔：白色石砌细塔（略收分），外廊，铁灯室
  const P = ISLAND.plateauY, Hs = ISLAND.shaftH, seg = det.lathe;
  const shaft = lathePart([[2.15, -1.0], [2.05, 0], [2.0, 0.6], [1.42, Hs]].map(([r, y]) => [r, y + P]), seg, 'white');
  for (let i = 0; i < shaft.uv.length; i += 2) { shaft.uv[i] *= 2 * Math.PI * 1.8 / 2.0; shaft.uv[i + 1] *= (Hs + 1.0) / 2.0; }
  parts.push(shaft);
  const ring = (r0, r1, y0, y1, mat = 'white') => { const q = lathePart([[0.001, y0], [r0, y0], [r1, y1], [0.001, y1]].map(([r, y]) => [r, y + P]), seg, mat); for (let i = 0; i < q.uv.length; i++) q.uv[i] *= 3; return q; };
  parts.push(ring(2.15, 2.15, -0.3, 0.5));                // 塔基束腰
  parts.push(ring(1.42, 2.0, Hs, Hs + 0.38));             // 外廊托檐
  parts.push(ring(2.0, 2.0, Hs + 0.38, Hs + 0.6));        // 外廊地板
  const iron = (q) => { for (let i = 0; i < q.uv.length; i += 2) { const [u, v] = inReg('iron', (q.uv[i] * 4) % 1, q.uv[i + 1]); q.uv[i] = u; q.uv[i + 1] = v; } return q; };
  const nRail = det.rail, rR = 1.92;
  for (let k = 0; k < nRail; k++) { const a = k / nRail * Math.PI * 2; parts.push(iron(xform(fromGeo(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 4), 'wood'), T(Math.cos(a) * rR, P + Hs + 1.05, Math.sin(a) * rR)))); }
  parts.push(iron(xform(fromGeo(new THREE.TorusGeometry(rR, 0.05, 4, seg), 'wood'), mul(T(0, P + Hs + 1.5, 0), RX(Math.PI / 2)))));
  // 灯室：白色基座 + 铁框玻璃（统一铁色）+ 圆顶 + 风向针
  parts.push(ring(1.15, 1.15, Hs + 0.6, Hs + 1.25));
  parts.push(iron(lathePart([[1.1, Hs + 1.25], [1.1, Hs + 2.9], [1.32, Hs + 3.0], [1.28, Hs + 3.12], [0.9, Hs + 3.7], [0.32, Hs + 4.2], [0.12, Hs + 4.45], [0.04, Hs + 4.95], [0.001, Hs + 5.05]].map(([r, y]) => [r, y + P]), seg, 'wood')));
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; parts.push(iron(xform(box(0.1, 1.65, 0.1, 'wood'), mul(T(Math.cos(a) * 1.12, P + Hs + 2.07, Math.sin(a) * 1.12), RY(-a))))); }
  return mergeParts(parts);
}
function buildIslandMainS3Tower() {
  // 020：与 S3 同一座灯塔，1.0 比例。塔基插槽 y = 台面 7.4 - 0.8（020 塔的勒脚顶 0.8 落在台面；塔脚 -1.6 埋进礁丘 2.4 m）。
  const lods = [{ nx: 170, rock: 10, boulders: 24 }, { nx: 120, rock: 7, boulders: 24 }, { nx: 84, rock: 5, boulders: 24 }].map((d) => islandParts({ ...d, noTower: true }));
  const sy = ISLAND.plateauY - 0.8, top = sy + 25.95, d = ISLAND_DIST.toFixed(1);
  const name = 'env-lighthouse-island-main-s3tower';
  const r = finishAsset({ name, lods, origin: [0, 0, 0], uv2Size: 1024,
    placement: { translation: ISLAND.at, rotationY: ISLAND.rotY, note: `S1 主灯塔岛（正式组合，占位坐标；正式坐标 013 与 S3 一起定）。开场镜头 (-0.9,4.2,9.5) 水平看向 (6.58,4.2,-29.78)，岛沿视线从 110.7 m 推到 ${d} m（1.25×）：画面横向约 58.5 %；涨潮 1.6 时水面到塔尖 ≈ ${(top - 1.6).toFixed(1)} m ≈ 画面高 0.31（约 1/3）。塔由插槽 lighthouse-ch1-socket 实例化 020 env-lighthouse-ch1（1.0 比例）` },
    helpers: [{ name: 'lighthouse-ch1-socket', t: [0, sy, 0], r: quatLookY(S3_FRAME.rotY - ISLAND.rotY), extras: { worldRotationY: S3_FRAME.rotY, worldRotationYDeg: 135, localRotationY: +(S3_FRAME.rotY - ISLAND.rotY).toFixed(5), frameNote: '返工 1029：插槽局部绕 Y = 135° − 岛的 −0.19 rad，让塔实例世界朝向 = 135°（layout.ts S3_WORLD_FRAME，与 S3 场景同一坐标系：S3 门 θ225 朝世界北）', instance: 'env-lighthouse-ch1', file: 'models/env/env-lighthouse-ch1.glb', scale: 1, lod: 'auto', lodByTier: { ultra: 1, high: 2, standard: 2 }, previewLod: 2, ticket: 'v0.1-020',
      note: `把 020 灯塔（局部原点 = 塔中心、y 0 = S3 低潮）原样放这里，scale 必须 1（全世界只有一种尺寸）。LOD 走 lodDistances：开场 ${d} m → 极致 LOD1（60–150 m）、高/标准 LOD2。实例世界朝向 135°（返工 1029，与 S3 场景一致；原「绕 Y 转随意」）。塔尖 y ≈ ${top.toFixed(1)}，塔径 8.3 m` } }],
    extras: { heightM: +top.toFixed(1), plateauY: ISLAND.plateauY, fogLayer: 'mid', fogDensityHint: ISLAND_FOG, distanceFromOpeningCamM: +d,
      note: `主灯塔岩岛（无塔版 + 020 塔插槽）。不可到达，无碰撞。雾（给程序）：fogLayer = mid，FogExp2 约 ${ISLAND_FOG}（018 时 110.7 m 用 0.0045；距离 ×1.25 后按反比降，雾占比保持约 22 %）。灯室没有自发光（000 规范）。` } });
  LAYOUT.nodes[name].socketInstances = [{ socket: 'lighthouse-ch1-socket', instance: 'env-lighthouse-ch1', file: 'models/env/env-lighthouse-ch1.glb', scale: 1, lodByTier: { ultra: 1, high: 2, standard: 2 }, previewLod: 2, worldRotationY: S3_FRAME.rotY, worldRotationYDeg: 135, socketLocalRotationY: +(S3_FRAME.rotY - ISLAND.rotY).toFixed(5), socketY: +sy.toFixed(2) }];
  return r;
}
function buildIslandMain() {
  const lods = [islandParts({ nx: 170, rock: 10, lathe: 32, rail: 24, boulders: 24 }), islandParts({ nx: 120, rock: 7, lathe: 20, rail: 16, boulders: 24 }), islandParts({ nx: 84, rock: 5, lathe: 12, rail: 8, boulders: 24 })];
  const top = ISLAND.plateauY + ISLAND.shaftH + 5.05;
  return finishAsset({ name: 'env-lighthouse-island-main', lods, origin: [0, 0, 0], uv2Size: 1024,
    placement: { translation: ISLAND.at, rotationY: ISLAND.rotY, note: '开场镜头 (-0.9,4.2,9.5) 水平看向 (6.58,4.2,-29.78)：110 m 外、画面横向约 58.5 %；涨潮 1.6 时水面到塔尖 ≈ ' + (top - 1.6).toFixed(1) + ' m ≈ 画面高 1/3，其中礁丘露出 ≈ 6 m、塔 ≈ ' + (top - ISLAND.plateauY).toFixed(1) + ' m' },
    extras: { heightM: +top.toFixed(1), plateauY: ISLAND.plateauY, lanternY: +(ISLAND.plateauY + ISLAND.shaftH + 2.1).toFixed(2), fogLayer: 'mid', fogDensityHint: 0.0045,
      note: '主灯塔岩岛（中景）。不可到达，无碰撞；三套 LOD 各自独立生成。雾（给程序）：本件 fogLayer = mid，请用比全局低的雾密度，FogExp2 约 0.0045（全局 0.009 的一半），在 110 m 外雾占比约 22 %，礁丘保持深色剪影、白塔可读；用全局 0.009 会被吃掉约 62 %，整岛发灰。灯室没有自发光（000 规范）。' } });
}

// =====================================================================================
// 礁石摆放（InstancedMesh 数据）→ s1-layout.json
// =====================================================================================
const REEF_PATH = [[-5.9, -3.0], [-4.5, -1.9], [-3.2, -0.7], [-2.0, 0.5], [-0.8, 1.6], [0.4, 2.6]];
function distToPoly(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[i + 1], dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
// 白盒沙面碰撞 0.1 上、退潮可走的范围（S1 外框内、潮沟以南、layout.ts deepWater 以北）
function onWalkableSand(x, z) {
  if (x < -19.5 || x > 15.6 || z > 8.5) return false;
  const deepZ = x < -10.5 ? -11.25 : x < 12.5 ? -8.95 : -8.95 - (x - 12.5) * 3.6;
  return z > deepZ;
}
function layoutRocks() {
  const R = rng(2468), inst = [];
  const keys = ['a', 'c', 'b', 'a', 'c', 'b'], tops = [0.42, 0.5, 0.38, 0.55, 0.45, 0.36];
  REEF_PATH.forEach(([x, z], i) => {
    const k = keys[i], r = ROCKS[k], s = 1 + (R() - 0.5) * 0.1, g = terrainAt(x, z).h;
    // 顶面 = tops[i]；底面必须埋进地面 ≥ 0.1 m，否则竖向拉伸
    let sy = s, y = tops[i] - r.topY * sy;
    if (y > g - 0.1) { sy = (tops[i] - (g - 0.12)) / r.topY; y = tops[i] - r.topY * sy; }
    inst.push({ rock: k, role: 'reef-path', walkableWhen: 'low', translation: [x, +y.toFixed(3), z], rotationY: +(R() * 6.283).toFixed(3), scale: [+s.toFixed(3), +sy.toFixed(3), +s.toFixed(3)], topY: tops[i] });
  });
  const avoid = (x, z, rad) =>
    distToPoly(x, z, REEF_PATH) < 1.3 + rad ||
    (x > -1 - rad && x < 11 + rad && z > 8 - rad && z < 13) ||                 // 推动轨道
    (x > LEDGE.x0 - 0.3 - rad && x < -6.4 + rad && z > LEDGE.z0 - rad && z < LEDGE.z1 + rad) ||
    distToPoly(x, z, [PIER.land, PIER.sea]) < 1.6 + rad ||
    (z > 5.3 - rad && x < 1 + rad) || (x > 12.9 && x < 14.3) || (x > 0.5 && x < 12 && z > -3 && z < 8.5) ||
    distToPoly(x, z, RIDGE.map((p) => [p[0], p[1]])) < 1.4 + rad || inst.some((q) => Math.hypot(q.translation[0] - x, q.translation[2] - z) < (q.rad ?? 0.8) + rad);
  const zones = [
    { n: 26, x: [-12, 1.2], z: [-8.5, 6], pick: 'aabbcdd' },     // 礁石滩
    { n: 8, x: [-19, -10.5], z: [-14, -11], pick: 'ddfe' },       // 石台南脚
    { n: 8, x: [-24, -11], z: [-2, 7.5], pick: 'ddeff' },          // 东侧岩坡
    { n: 10, x: [14.5, 30], z: [-12, 12], pick: 'ddeef' },        // 西侧乱石岸
    { n: 7, x: [-6, 14], z: [-17, -10], pick: 'dde' },            // 南侧浅水（退潮露出）
    { n: 6, x: [1.2, 30], z: [12.4, 13.6], pick: 'ddf' },         // 崖脚
  ];
  for (const zn of zones) {
    let placed = 0, tries = 0;
    while (placed < zn.n && tries++ < 600) {
      const x = lerp(zn.x[0], zn.x[1], R()), z = lerp(zn.z[0], zn.z[1], R()), k = zn.pick[Math.floor(R() * zn.pick.length)], r = ROCKS[k];
      const s = k === 'f' ? 0.8 + R() * 0.6 : k === 'e' ? 0.6 + R() * 0.7 : 0.6 + R() * 0.9;
      const rad = Math.max(...r.size) * s * 0.9;
      if (avoid(x, z, rad)) continue;
      const g = terrainAt(x, z).h, ry = R(), sy = s * (0.85 + R() * 0.3);
      // 落在可走滩地上的（没有挡人体）只露出 ≤ 0.12 m 的礁背，不然人会走进石头里
      const y = onWalkableSand(x, z) ? Math.min(g - r.height * s * 0.18, 0.22 - r.topY * sy) : g - r.height * s * 0.18;
      inst.push({ rock: k, role: 'dressing', translation: [+x.toFixed(2), +y.toFixed(3), +z.toFixed(2)], rotationY: +ry.toFixed(3), scale: [+s.toFixed(3), +sy.toFixed(3), +s.toFixed(3)], rad });
      placed++;
    }
  }
  // 018 第二部分：外侧礁带。按开场镜头取样（画面横向 sx、前向距离 D），平顶 f/d 横向拉长、顺着画面横向摆，
  //   涨潮 1.6 只露 0.3–0.8 m；周围撒小碎石（顶面高出水面 0.05–0.4 m）；e 最多 2 块。底面压到 max(地面, -1.8) 以下，退潮时不悬空。
  {
    const camAt = (sx, D) => { const a = (sx - 0.5) * 1.294; return [-0.9 + D * 0.187 + a * D * 0.982, 9.5 - D * 0.982 + a * D * 0.187]; };
    const bands = [
      { sx: [0.56, 0.80], D: [19, 25], n: 7 },
      { sx: [0.64, 0.96], D: [28, 35], n: 8 },
      { sx: [0.50, 0.70], D: [44, 58], n: 6 },
      { sx: [0.80, 1.02], D: [46, 62], n: 5 },
    ];
    const boats = [[0.18, -13.53, 3.2], [...((p) => [p[0], p[2]])(pierToWorld(...BOAT_LOCAL.pos)), 3.2], [10.2, -17, 3.6]];   // 返工 1029：旧船位保留（不改礁石布置），加新船位
    const blocked = (x, z, rad) => distToPoly(x, z, [PIER.land, PIER.sea]) < 2.0 + rad || boats.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br + rad) || inst.some((q) => q.role !== 'dressing-hightide' && Math.hypot(q.translation[0] - x, q.translation[2] - z) < (q.rad ?? 0.8) + rad);
    const put = (k, x, z, sx, sz, ry, top) => {
      const r = ROCKS[k], g = terrainAt(x, z).h, bot = Math.min(Math.max(g, -1.8), -0.3) - 0.15, sy = (top - bot) / r.height;
      inst.push({ rock: k, role: 'dressing-hightide', translation: [+x.toFixed(2), +bot.toFixed(3), +z.toFixed(2)], rotationY: +ry.toFixed(3), scale: [+sx.toFixed(3), +sy.toFixed(3), +sz.toFixed(3)], rad: Math.max(r.size[0] * sx, r.size[2] * sz) * 0.5 });
    };
    let eLeft = 2;
    for (const bd of bands) {
      // 一条礁带：沿带等距推进 + 抖动，相邻两块允许搭接
      let placed = 0;
      for (let i = 0, tries = 0; placed < bd.n && tries < 80; tries++, i++) {
        const sxp = lerp(bd.sx[0], bd.sx[1], (placed + R() * 0.6) / bd.n), D = lerp(bd.D[0], bd.D[1], 0.5 + (R() - 0.5) * 0.7);
        const [x, z] = camAt(sxp, D);
        const k = R() < 0.6 ? 'f' : 'd', s = (k === 'f' ? 0.9 : 1.1) + R() * 0.7;
        const sx = s * (1.1 + R() * 0.4), sz = s * (0.7 + R() * 0.3);
        if (blocked(x, z, Math.max(sx, sz) * 1.2)) continue;
        put(k, x, z, sx, sz, -0.19 + (R() - 0.5) * 1.6, 1.6 + 0.3 + R() * 0.5);
        placed++;
        // 碎块 3–5 块：顶面也在水上 0.3–0.8（个别 0.1–0.3），形成参差的礁带轮廓
        const nb = 3 + Math.floor(R() * 3);
        for (let j = 0; j < nb; j++) {
          const bx = x + (R() - 0.5) * sx * 5, bz = z + (R() - 0.5) * sz * 3.5;
          let kk = 'bcdcd'[Math.floor(R() * 5)]; if (eLeft > 0 && R() < 0.05) { kk = 'e'; eLeft--; }
          const bs = 0.55 + R() * 0.75;
          if (blocked(bx, bz, bs)) continue;
          put(kk, bx, bz, bs, bs * (0.8 + R() * 0.4), R() * 6.283, 1.6 + (kk === 'e' ? 0.8 : R() < 0.3 ? 0.1 + R() * 0.2 : 0.3 + R() * 0.5));
        }
      }
    }
  }
  // 018 最终打磨（制作人 10-29 验收遗留「右下前景大湿石」）：开场镜头右下。画面最下沿那块是退潮沙滩 / 脚印 / 浮台路线
  //   （避让区 x 0.5–12、z −3…8.5），不能进；所以压在避让区南沿外（z ≤ −3.2），画面 sx 0.78–1.0、sy ≈ 0.72–0.75。
  //   2 块大礁盘 f + 2 块大圆礁 d 成一簇（涨潮露出 0.6–1.1 m），周围 5 块碎石（只高出沙面 0.25–0.6 m，退潮才露）。底面埋进地面 ≥ 0.15 m（退潮不悬空）。
  //   独立随机流 rng(8642)、追加在最后 → 原 155 个实例的位置/朝向/缩放一个不变。
  {
    const R2 = rng(8642), from = inst.length;
    const fgPut = (k, x, z, s, sz, top, ry) => {
      const r = ROCKS[k], g = terrainAt(x, z).h, sy = Math.max(s * 0.85, (top - (g - 0.15)) / r.height), bot = top - r.height * sy;
      inst.push({ rock: k, role: 'dressing-hightide', translation: [+x.toFixed(2), +bot.toFixed(3), +z.toFixed(2)], rotationY: +ry.toFixed(3), scale: [+s.toFixed(3), +sy.toFixed(3), +sz.toFixed(3)], rad: Math.max(r.size[0] * s, r.size[2] * sz) * 0.5 });
    };
    const fgBlocked = (x, z, rad) => (x > 0.5 - rad && x < 12 + rad && z > -3 - rad && z < 8.5) || distToPoly(x, z, [PIER.land, PIER.sea]) < 2.0 + rad ||
      inst.some((q) => Math.hypot(q.translation[0] - x, q.translation[2] - z) < ((q.rad ?? 0.8) + rad) * 0.8);
    for (const [k, x, z, s, sz, top] of [['f', 8.6, -5.9, 1.45, 1.25, 2.75], ['d', 6.4, -4.7, 1.9, 1.7, 2.45], ['f', 11.6, -6.6, 1.25, 1.1, 2.4], ['d', 10.6, -4.6, 1.5, 1.35, 2.25]]) {
      const ry = -0.19 + (R2() - 0.5) * 0.9;
      if (!fgBlocked(x, z, Math.max(ROCKS[k].size[0] * s, ROCKS[k].size[2] * sz) * 0.5)) fgPut(k, x, z, s, sz, top, ry);
      else console.warn(`  ! 前景大石 ${k} (${x}, ${z}) 被挡，跳过`);
    }
    for (let j = 0, n = 0; j < 40 && n < 5; j++) {
      const x = lerp(5.6, 12.4, R2()), z = lerp(-7.6, -3.6, R2()), k = 'bcdcd'[Math.floor(R2() * 5)], bs = 0.6 + R2() * 0.6;
      const rad = Math.max(ROCKS[k].size[0], ROCKS[k].size[2]) * bs * 0.5;
      if (fgBlocked(x, z, rad)) continue;
      fgPut(k, x, z, bs, bs * (0.8 + R2() * 0.4), terrainAt(x, z).h + 0.25 + R2() * 0.35, R2() * 6.283); n++;   // 碎石只在退潮露出，不拉成柱子
    }
    console.log(`  018 打磨：右下前景湿石 ${inst.length - from} 块：` + inst.slice(from).map((q) => `${q.rock}(${q.translation[0]},${q.translation[2]})`).join(' '));
  }
  inst.forEach((q) => delete q.rad);
  LAYOUT.instances = inst;
  return inst;
}

// =====================================================================================
// 主流程
// =====================================================================================
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
mkdirSync(OUT_TEX, { recursive: true }); mkdirSync(OUT_ENV, { recursive: true }); mkdirSync(OUT_PROPS, { recursive: true });
const want = (n) => !ONLY.length || ONLY.some((o) => n.includes(o));
const T0 = Date.now();
for (const k of Object.keys(ROCKS)) { if (want(`env-rock-shore-${k}`) || want('layout')) buildRock(k); }
if (want('env-tidal-flat-s1')) buildTerrain();
if (want('env-pier-wood-ch1')) buildPier();
if (want('prop-boat-rowboat')) { buildBoat(false); buildBoat(true); }
if (want('env-shore-ledge-s1')) buildLedge();
if (want('env-cliff-s1')) buildCliff();
if (want('env-unloading-shore-s1')) buildUnloadingShore();
if (want('env-fish-shed-ruin')) buildShed();
if (want('env-net-rack')) { buildNetRack('a'); buildNetRack('b'); }
if (want('env-lighthouse-silhouette-far')) buildSilhouette();
if (LEGACY_TOWER) buildIslandMain();   // 退役对照件，只在显式参数时出
else if (want('env-lighthouse-island-main')) buildIslandMainS3Tower();
const inst = layoutRocks();

// ---- 汇总
const rockTris = Object.fromEntries(REPORT.filter((r) => r.name.startsWith('env-rock-shore-')).map((r) => [r.name.slice(-1), r.tris]));
const instTris = [0, 1, 2].map((l) => inst.reduce((s, q) => s + (rockTris[q.rock]?.[l] ?? 0), 0));
const statics = REPORT.filter((r) => !r.name.startsWith('env-rock-shore-'));
const silInst = 2;
// 020 灯塔外观（插槽实例，tris 取自 020 build-env-s3 报告；它的 LOD 也走 lodDistances）
const S3_TOWER_TRIS = [43_980, 21_268, 10_440];   // 返工 1029 S3 重建后
const total = [0, 1, 2].map((l) => statics.reduce((s, r) => s + r.tris[l] * (r.name === 'env-lighthouse-silhouette-far' ? silInst : 1), 0) + instTris[l] + (LEGACY_TOWER ? 0 : S3_TOWER_TRIS[l]));
LAYOUT.note = '返工 2026-10-29：已按 013 白盒 game/src/levels/s1/layout.ts（权威，只读）对位——礁石台阶、对岸台阶 / 崖顶平台、石槽、points；冲突以 layout.ts 为准。+Z 北、右手系 ⇒ 东 = -X、西 = +X；局部 y = 世界高度。';
LAYOUT.authority = 'game/src/levels/s1/layout.ts';
LAYOUT.worldFrames = { s3: { authority: 'layout.ts S3_WORLD_FRAME', towerCenter: S3_FRAME.towerCenter, rotationY: +S3_FRAME.rotY.toFixed(5), rotationYDeg: 135, islandRotationY: S3_FRAME.islandRotY, socketY: S3_FRAME.socketY, formula: 'S3 局部 → 世界：world = R_y(135°)·local + towerCenter（three.js R_y）', s1SocketInstanceWorldRotYDeg: 135,
  towerBaseYNote: '015 注意：S3 场景里塔基 y 0（= S3 低潮 0）；S1 远景插槽里同一座塔实例的塔基在 y 6.6（岛台面 7.4 − 0.8）。两者不是同一套高度，S3 场景放进世界时 y 不跟 6.6 对齐（layout.ts 遗留项，留给 015）' } };
LAYOUT.axes = { north: '+Z', east: '-X', west: '+X', up: '+Y', units: 'm' };
LAYOUT.keyHeights = { pierDeck: 2.2, bellPlatform: 2.4, reefPathTops: [0.36, 0.55], raftDeckGrounded: 0.4, raftDeckFloating: 1.85, reefStairsBottom: 0.2, farStepsTop: 4.91, plateau: 5.2, nearPlatform: 1.85, farLowestStep: 1.85, channelFloor: -0.5, sand: 0.1, tideLow: 0, tideHigh: 1.6 };
LAYOUT.points = {
  spawnStart: pierToWorld(0, 2.2, -6.0).map((v) => +v.toFixed(3)), bellAnchor: [-15.5, 2.4, -6.2], bellAnchorOriginAt: '钟轴正下方站台面点 = prop-tide-bell 根原点（021：根节点直接对齐本挂点，不加偏移、不缩放）', safePoint: [-12.5, 2.4, -4.0],
  reefPath: REEF_PATH.map(([x, z], i) => [x, REEF_TOPS[i], z]), reefPathFormat: '[x, 顶面 y, z]（返工 1029：原 [x, z]）', reefPathEnd: [1.8, 0.1, 3.4], raftHome: [9.1, 0.4, 10.5], stoneSlot: [-0.9, 0.4, 10.5], raftNote: '浮台中心 = 搁浅甲板顶 0.4（layout.ts raft.home / slot；原 y 0.1 = 沙面）', stoneSlotBox: { min: [-1.9, 9], max: [0.1, 12] },
  linkNear: [-0.9, 1.85, 8.5], linkFar: [-0.9, 1.85, 12.5], exitToS2: EXIT,
  reefStairs: { x0: -10, run: RSTAIR.run, rise: RSTAIR.rise, count: RSTAIR.n, z: RSTAIR.z },
  farSteps: { x: FAR.x, z0: FAR.z0, landing: FAR.landing, count: FAR.n, rise: FAR.rise, run: +FAR.run.toFixed(4), baseY: FAR.baseY, topZ: FAR.z1, topY: +FAR.topY.toFixed(2) }, plateau: { min: [PLATEAU.x[0], PLATEAU.z[0]], max: [PLATEAU.x[1], PLATEAU.z[1]], topY: PLATEAU.top },
  ridge: RIDGE.map(([x, z, y]) => [x, y, z]), ridgeFormat: '[x, 顶面 y, z]（返工 1029：原 [x, z, y]）', fishShed: [18.73, 0, 1.46], netRacks: [[16.25, 0, -2.25], [17.31, 0, 8.13]],
};
LAYOUT.triangles = { lod: total, instances: inst.length, instanceTris: instTris, socketInstanceTris: { 'env-lighthouse-ch1': S3_TOWER_TRIS }, budget: [4_000_000, 2_300_000, 1_000_000] };
if (!ONLY.length && !LEGACY_TOWER) writeFileSync(join(ART, 'source/env/s1-layout.json'), JSON.stringify(LAYOUT, null, 1));
console.log('\n资产                              LOD0 / LOD1 / LOD2           材质  碰撞面  UV2(块/texel·m⁻¹)  大小');
for (const r of REPORT) console.log(`${r.name.padEnd(34)}${r.tris.map((t) => String(t).padStart(8)).join(' /')}   ${r.mats.length}   ${String(r.colliderTris).padStart(6)}   ${r.lightmap ? `${r.lightmap.charts}/${r.lightmap.texelsPerM}@${r.lightmap.size}` : '-'}  ${(r.bytes / 1024).toFixed(0)} KB`);
console.log(`礁石实例 ${inst.length} 个：${instTris.join(' / ')}`);
console.log(`S1 静态大件合计（含礁石实例、剪影×${silInst}、020 塔插槽实例）：${total.join(' / ')}（预算 4M / 2.3M / 1M）`);
console.log(`材质：${[...new Set(REPORT.flatMap((r) => r.mats))].join(', ')}`);
console.log(`用时 ${((Date.now() - T0) / 1000).toFixed(0)} s`);
