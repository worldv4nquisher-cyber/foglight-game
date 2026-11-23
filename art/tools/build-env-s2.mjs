// S2 守灯人小屋场景大件（需求单 019）程序化建模 → GLB。无需 Blender，只用 game/node_modules 里的 three 与 meshoptimizer。
//   node art/tools/build-env-s2.mjs [--only=name,name] [--embed]
// 输出：art/models/env/*.glb、art/source/env/s2-layout.json；之后 node art/tools/glb-pack-ktx2.mjs 换 KTX2 + 量化。
// 通用工具（噪声、几何、LOD、UV2、描边色、GLB 写出）从 build-env-s1.mjs 复制（S1 脚本不动），S2 内容在文件后半。
// 约定（v0.1-index §5、style-guide §8 §9）：1 单位 = 1 m，+Y 向上，+Z 朝北（014），右手系 ⇒ 东 = -X、西 = +X。
//   崖顶地面 y = 0；小屋一层地面 y = 0、二层地面 y = 3.0。局部 y = 世界高度；摆放见根节点 extras.placement 与 s2-layout.json。
//   每件 <名>_lod0/_lod1/_lod2，<名>-collider，TEXCOORD_1 = UV2，COLOR_0 = 平滑法线。环境里没有任何自发光 / 灯光：
//   唯一暖光是汐放在二层书桌上的风灯（程序动态光，socket 见室内 GLB）。

//   材质 7 个：mat-env-stone-masonry / mat-env-rock-shore / mat-env-slate-roof / mat-env-plaster-interior / mat-env-wood-house-s2 / mat-env-glass-window / mat-env-turf-clifftop；每件 ≤ 3。没有任何自发光。
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
const EMBED = process.argv.includes('--embed');
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
  masonry: { name: 'mat-env-stone-masonry', tex: 'tex-stone-masonry', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.75, wetRoughness: 0.22, rainWet: true, note: '与 S1 共用' } },
  rock: { name: 'mat-env-rock-shore', tex: 'tex-rock-shore', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.72, wetRoughness: 0.2, rainWet: true, triplanarOk: true, note: '与 S1 共用' } },
  slate: { name: 'mat-env-slate-roof', tex: 'tex-slate-roof', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.7, wetRoughness: 0.15, rainWet: true } },
  plaster: { name: 'mat-env-plaster-interior', tex: 'tex-plaster-interior', tile: 2.0, extras: { tileM: 2.0, interior: true } },
  wood: { name: 'mat-env-wood-house-s2', tex: 'tex-wood-house-s2', extras: { atlas: true, wetDarken: 0.8, wetRoughness: 0.3, note: '图集：地板 / 家具旧木 / 灰蓝漆木 / 粗梁 / 羊毛毯 / 亚麻 / 铁件 / 绳；室内部分不淋湿（室外件按 rainWet 处理）' } },
  glass: { name: 'mat-env-glass-window', tex: 'tex-glass-rain', albedoOnly: true, rough: 0.08, alphaMode: 'BLEND', doubleSided: true, tile: 0.6, extras: { tileM: 0.6, transparent: true, depthWrite: false, note: '简单透明窗玻璃 + 雨后湿痕（RGBA，alpha 0.16–0.55）；不发光。程序可加环境反射' } },
  turf: { name: 'mat-env-turf-clifftop', tex: 'tex-turf-clifftop', tile: 4.0, extras: { tileM: 4.0, wetDarken: 0.8, wetRoughness: 0.3, rainWet: true, note: '草丛实例另做（植被，不在 019）' } },
};
// 小屋木材图集分区（与 gen_tex_env_s2.py HOUSE_REGIONS 一致），[u0, v0, w, h]，glTF v 向下
const WOOD = {
  floor: [0, 0, 1, 0.5], furn: [0, 0.5, 0.5, 0.25], paint: [0.5, 0.5, 0.5, 0.25], beam: [0, 0.75, 0.25, 0.25],
  fabric: [0.25, 0.75, 0.25, 0.25], linen: [0.5, 0.75, 0.25, 0.25], iron: [0.75, 0.75, 0.25, 0.125], rope: [0.75, 0.875, 0.25, 0.125],
};
const PILE_Y_TOP = 2.6, PILE_Y_BOT = -2.0; // woodPost 兼容（S2 不用 pile 区）
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
function addUV2(prims, texSize = 1024, pad = 4) {
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
    asset: { version: '2.0', generator: 'game-studio art/tools/build-env-s2.mjs' },
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
  const mats = [...new Set(asset.lods.flat().map((p) => p.mat))];
  for (const m of mats) {
    const M = MATS[m]; const wrap = !WOOD[m] && m !== 'wood';
    const mat = { name: M.name, extras: { ...M.extras } };
    if (M.color) mat.pbrMetallicRoughness = { baseColorFactor: [...srgbToLinear(M.color), 1], metallicFactor: 0, roughnessFactor: 1 };
    else if (M.albedoOnly) mat.pbrMetallicRoughness = { baseColorTexture: { index: tex(texFile(M.tex, 'albedo'), wrap) }, metallicFactor: 0, roughnessFactor: M.rough ?? 0.9 };
    else {
      const orm = tex(texFile(M.tex, 'orm'), wrap);
      mat.pbrMetallicRoughness = { baseColorTexture: { index: tex(texFile(M.albedoTex ?? M.tex, 'albedo'), wrap) }, metallicRoughnessTexture: { index: orm }, metallicFactor: 1, roughnessFactor: 1 };
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
  if (asset.collider) {
    const mi = json.meshes.push({ name: `${asset.name}-collider`, primitives: [meshPrim(asset.collider, false)] }) - 1;
    root.children.push(json.nodes.push({ name: `${asset.name}-collider`, mesh: mi, extras: { collider: true, ...(asset.colliderExtras ?? {}) } }) - 1);
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
  const helpers = (a.helpers ?? []).map((h) => ({ ...h, t: [h.t[0] - origin[0], h.t[1] - origin[1], h.t[2] - origin[2]] }));
  // fix-r2：俯视平面 UV2 的框改成「所有 LOD 全部顶点」的 xz 包围盒（局部坐标）。原来只按平台框 X0..X1 / Z0..Z1，
  //   崖壁石面（mat-env-rock-shore）伸出框外 → UV2 出到 [-0.032, 1.019]。新框 + planarUV2 自带 4 px 边距 → 全部 LOD 都在 [0,1] 内。
  let planar = a.uv2Planar ? [a.uv2Planar[0] - origin[0], a.uv2Planar[1] - origin[2], a.uv2Planar[2]] : null;
  if (planar && a.uv2PlanarFitAll) {
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const l of lods) for (const p of l) for (let i = 0; i < p.pos.length; i += 3) { mnx = Math.min(mnx, p.pos[i]); mxx = Math.max(mxx, p.pos[i]); mnz = Math.min(mnz, p.pos[i + 2]); mxz = Math.max(mxz, p.pos[i + 2]); }
    const size = Math.max(mxx - mnx, mxz - mnz) * 1.0001; planar = [mnx - (size - (mxx - mnx)) / 2, mnz - (size - (mxz - mnz)) / 2, size]; // 短边居中
  }
  lods = lods.map((l) => {
    const r = planar ? planarUV2(l, planar[0], planar[1], planar[2], 2048) : addUV2(l, a.uv2Size ?? 1024);
    outlineColors(r); r.forEach(reorder); return r;
  });
  const placement = a.placement ?? { translation: origin, rotationY: 0 };
  const extras = { ...(a.extras ?? {}), placement, units: 'm', upAxis: '+Y', north: '+Z', east: '-X', scene: 's2-keeper-house' };
  const asset = { name: a.name, lods, collider: a.collider, colliderExtras: a.colliderExtras, helpers, extras };
  const path = join(a.outDir ?? OUT_ENV, `${a.name}.glb`);
  const bytes = writeGlbWithWalls(asset, a.walls, path);
  const tris = lods.map(triCount);
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

// ---- 以下从 build-env-s1.mjs 复制：礁石切面生成、木件、石砌、崖壁条带
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
      y = yt[i] + c * (opt.capRise ?? 1.6) + (fbm(bx * 0.2, 7, bz * 0.2, 3) - 0.5) * (opt.capNoise ?? 1.4) * c;
      d = 1.2 + c * (opt.capDepth ?? 9);
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
function beam(parts, a, b, w, h, reg = 'beam', seed = 0) {
  const d = V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  const p = plank(L, w, h, reg, { uLen: reg === 'shed' ? 2.0 : 2.5, uOff: (seed * 0.37) % 1 });
  const q = new THREE.Quaternion().setFromUnitVectors(V3(1, 0, 0), d.clone().normalize());
  parts.push(xform(p, mul(T((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new THREE.Matrix4().makeRotationFromQuaternion(q), RX(seed % 1))));
}

// =====================================================================================
// S2 布局常量（占位：014 白盒 / layout.ts 未交付，全部按 014 文字推定，白盒到了按白盒对位）
// =====================================================================================
const HOUSE = { x0: -6, x1: 2, z0: -2, z1: 4, wt: 0.6, f2: 3.0, eave: 5.6, pitch: 2.5 / 3, center: [-2, 0, 1] };
HOUSE.ix0 = HOUSE.x0 + HOUSE.wt; HOUSE.ix1 = HOUSE.x1 - HOUSE.wt; HOUSE.iz0 = HOUSE.z0 + HOUSE.wt; HOUSE.iz1 = HOUSE.z1 - HOUSE.wt;
const ridgeLine = (z) => HOUSE.eave + (3 - Math.abs(z - 1)) * HOUSE.pitch; // 墙顶线（屋面下皮在其上 0.1，屋面上皮在其上 0.2）
// 洞口（世界坐标）
const OPEN = {
  frontDoor: { wall: 'S', a: -4.6, b: -3.6, y0: 0, y1: 2.05, door: true },
  winS2: { wall: 'S', a: -1.25, b: -0.45, y0: 4.0, y1: 5.0 },
  winW2: { wall: 'W', a: 0.55, b: 1.45, y0: 3.9, y1: 5.1, puzzleFrame: true },     // 谜题 4 取景框，窗台 3.9
  winN1: { wall: 'N', a: -3.2, b: -2.4, y0: 1.0, y1: 2.0 },
  cellarDoor: { wall: 'N', a: 0.2, b: 1.05, y0: 0, y1: 1.85, door: true },
  winE1: { wall: 'E', a: 2.2, b: 3.0, y0: 0.95, y1: 2.05 },
  winE2: { wall: 'E', a: -0.65, b: -0.05, y0: 3.95, y1: 4.65, lanternGlow: true }, // 东侧小窗：书桌风灯暖光从这里透出
};
const LIGHT_LOCK = [-4.8, 0.85, HOUSE.z1];                            // 返工 2026-10-29：1.2 → 0.85（制作人裁定：灯座上提灯出光高 0.846；对齐 014 白盒 layout.ts lightLock）
const BEAM_Y = 0.85;
const SHELF_TOP = 1.10;
const D2R_S2 = Math.PI / 180;                                              // 地窖木架钥匙层架面离地（返工 2026-10-29；014 白盒 cellarShelf.h）                                                 // 光束平面（014 白盒 beamY）
const VIEW = { eye: [0.95, HOUSE.f2 + 1.35, 1.0], fov: 30 };          // 观察点：西窗内墙面后 0.45 m
const STONES = { x0: 14, x1: 22, z0: -2.5, z1: 4.5 };                  // 白石分布区（021），距西窗外墙面 12–20 m
STONES.center = [(STONES.x0 + STONES.x1) / 2, 0, (STONES.z0 + STONES.z1) / 2];
const YARD = { x0: -15, x1: -6.25, z0: -8, z1: 9.5, gate: [-9.6, -8.4], wallH: 1.1 };
const LAMP = { east: [-13.2, 0, -5.0], west: [-8.0, 0, -5.0] };     // 灯台基座顶面 y = 0（与铺地齐平）；灯座上提灯出光 0.846 → 光束平面 y = 0.85（返工 2026-10-29，原 1.2）
const RACK = { at: [-8.15, 0, -2.5], len: 2.6 };
const MIRRORS = { a: [-13.2, BEAM_Y, 3.0], b: [-7.2, BEAM_Y, 8.6] };       // 021 立镜占位（只写 layout）
const GATE = { x: [3.4, 5.0], z: 11.5 };
const EXIT_S3 = [5.0, 0, 23.0];
const STAIR_S = { x: [-1.0, 1.0], zTop: -13.5, run: 0.38, rise: 0.2, n: 12 };
const WALK = { x: [-17.5, 25], z: [-14, 12], slopeX: 8, dropPerM: 0.0776, north: { x: [1.5, 8.5], z1: 27 } }; // 014 白盒 layout.ts platform / slope / northPath

// 通用小工具
const P = (p, ...m) => xform(p, mul(...m));
// 木件：c = 中心，size = [x, y, z]，grain = 纹理方向 'x' | 'y' | 'z'
function woodPiece(parts, c, size, reg, grain = 'x', rotY = 0, opt = {}) {
  const [sx, sy, sz] = size; let p, R;
  if (grain === 'x') { p = plank(sx, sz, sy, reg, { cup: 0, ...opt }); R = new THREE.Matrix4(); }
  else if (grain === 'z') { p = plank(sz, sx, sy, reg, { cup: 0, ...opt }); R = RY(-Math.PI / 2); }
  else { p = plank(sy, sz, sx, reg, { cup: 0, ...opt }); R = RZ(Math.PI / 2); }
  parts.push(P(p, T(...c), RY(rotY), R));
  return p;
}
const ironPiece = (parts, c, size, rotY = 0) => woodPiece(parts, c, size, 'iron', 'x', rotY, { uLen: 0.5 });
function quad(pts, mat, uvs) { // 四点面（逆时针 = 正面）
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute((uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]]).flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return fromGeo(g, mat);
}
// 墙面坐标系：p0 → p1（世界 xz），out = 外法线（可见面方向）。s 沿墙，y 向上，d 向墙内（-out）
function wallFrame(p0, p1, out) {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), t = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
  const toW = (s, y, d) => [p0[0] + t[0] * s - out[0] * d, y, p0[1] + t[1] * s - out[1] * d];
  const basis = (dOff = 0) => new THREE.Matrix4().makeBasis(V3(t[0], 0, t[1]), V3(0, 1, 0), V3(-out[0], 0, -out[1])).setPosition(p0[0] - out[0] * dOff, 0, p0[1] - out[1] * dOff);
  return { L, t, toW, basis, yaw: Math.atan2(-t[1], t[0]) };
}
// 挤出的墙芯（带洞口）：outline = [[s, y]...]，holes = [{s0,s1,y0,y1}]，d0..d1 = 墙内深度
function wallCore(fr, outline, holes, d0, d1, mat = 'masonry') {
  const sh = new THREE.Shape(outline.map(([s, y]) => new THREE.Vector2(s, y)));
  for (const h of holes) sh.holes.push(new THREE.Path([new THREE.Vector2(h.s0, h.y0), new THREE.Vector2(h.s1, h.y0), new THREE.Vector2(h.s1, h.y1), new THREE.Vector2(h.s0, h.y1)]));
  const g = new THREE.ExtrudeGeometry(sh, { depth: d1 - d0, bevelEnabled: false, curveSegments: 1 });
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
  const p = fromGeo(ng, mat);
  return weld(xform(p, fr.basis(d0)));
}
// 石墙：成层块石，洞口 / 过梁 / 窗台石处断开；端部 trim0/trim1(y) 给转角石让位
function stoneWall(parts, w) {
  const fr = wallFrame(w.p0, w.p1, w.out), R = rng(w.seed * 131 + 7), depth = w.depth ?? 0.4;
  const top = w.top ?? (() => w.y1);
  const rects = [];
  for (const o of w.openings ?? []) {
    if (o.pad) { rects.push({ s0: o.s0, s1: o.s1, y0: o.y0, y1: o.y1, pad: true }); continue; }
    rects.push({ s0: o.s0, s1: o.s1, y0: o.y0, y1: o.y1 });
    if (o.lintel !== false) rects.push({ s0: o.s0 - 0.22, s1: o.s1 + 0.22, y0: o.y1, y1: o.y1 + 0.3, lintel: true });
    if (!o.door && o.sill !== false) rects.push({ s0: o.s0 - 0.1, s1: o.s1 + 0.1, y0: o.y0 - 0.13, y1: o.y0, sill: true });
  }
  const edges = [...new Set(rects.flatMap((r) => [r.y0, r.y1]).concat(w.edges ?? []))].sort((a, b) => a - b);
  const yMax = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((f) => top(f * fr.L)));
  const courses = []; let y = w.y0;
  while (y < yMax - 0.06) {
    let nx = y + (w.course ?? 0.3) + R() * (w.courseVar ?? 0.14);
    for (const e of edges) if (e > y + 0.1 && e < nx + 0.1) { nx = e; break; }
    if (yMax - nx < 0.12) nx = yMax;
    courses.push([y, nx]); y = nx;
  }
  const cutBy = (sa, sb, ya, yb) => {
    let segs = [[sa, sb]];
    for (const r of rects) if (ya < r.y1 - 0.005 && yb > r.y0 + 0.005) segs = segs.flatMap(([a, b]) => (r.s1 <= a || r.s0 >= b ? [[a, b]] : [[a, Math.min(b, r.s0)], [Math.max(a, r.s1), b]].filter(([u, v]) => v - u > 0.02)));
    return segs;
  };
  const addBlock = (sa, sb, ya, yb, dep = depth, jutOut = 0, seed = 0) => {
    const len = sb - sa, h = yb - ya; if (len < 0.05 || h < 0.05) return;
    const sc = (sa + sb) / 2, c = fr.toW(sc, (ya + yb) / 2, dep / 2 - jutOut);
    const b = stoneBlock(len - 0.016, h - 0.016, dep, Math.min(0.035, len * 0.15, h * 0.15) + R() * 0.01, w.seed + seed + sc * 7 + ya * 3, w.noise ?? 0.008,
      [Math.max(2, Math.round(len / (w.segLen ?? 0.16))), Math.max(2, Math.round(h / 0.16)), 2]);
    const jut = (R() - 0.5) * (w.jut ?? 0.025);
    xform(b, mul(T(c[0] + w.out[0] * jut, c[1], c[2] + w.out[1] * jut), RY(fr.yaw + (R() - 0.5) * 0.012), RZ((R() - 0.5) * (w.tilt ?? 0.01))));
    parts.push(boxUV(b, MATS[w.mat ?? 'masonry'].tile, [R(), R()], (R() - 0.5) * 0.1));
  };
  courses.forEach(([ya, yb], k) => {
    const t0 = w.trim0 ? w.trim0(ya, yb, k) : 0, t1 = w.trim1 ? w.trim1(ya, yb, k) : 0;
    let s = t0 + (k % 2 ? 0 : -(R() * 0.3));
    const sEnd = fr.L - t1;
    let first = true;
    while (s < sEnd - 0.03) {
      let len = first && k % 2 ? 0.3 + R() * 0.3 : (w.minLen ?? 0.45) + R() * (w.lenVar ?? 0.7);
      first = false;
      let sa = Math.max(s, t0), sb = Math.min(s + len, sEnd);
      if (sEnd - sb < 0.2) sb = sEnd;
      s = sb;
      let yTop = Math.min(yb, top(sa), top(sb));
      if (yTop - ya < 0.1) continue;
      for (const [a, b] of cutBy(sa, sb, ya, yTop)) addBlock(a, b, ya, yTop, depth, 0, k * 17);
    }
  });
  // 过梁、窗台石、安装位石板
  for (const r of rects) {
    if (r.lintel) addBlock(r.s0, r.s1, r.y0, r.y1, depth, 0.02, 901);
    if (r.sill) addBlock(r.s0, r.s1, r.y0, r.y1, depth, 0.06, 902);
    if (r.pad) addBlock(r.s0, r.s1, r.y0, r.y1, depth, 0.015, 903);
  }
  return fr;
}
// 转角石（quoin）：两面各 0.75，层高 0.36–0.5，交替长短边
function quoins(parts, cx, cz, dirA, dirB, y0, y1, seed) {
  const R = rng(seed); let y = y0, k = 0;
  while (y < y1 - 0.05) {
    let h = Math.min(0.36 + R() * 0.14, y1 - y); if (y1 - (y + h) < 0.15) h = y1 - y;
    const la = k % 2 ? 0.78 : 0.48, lb = k % 2 ? 0.48 : 0.78;
    // 角点 (cx, cz)，dirA / dirB = 沿两面墙往里的单位向量（指向墙体延伸方向），块占 [0, la] × [0, lb]
    const b = stoneBlock(la - 0.012, h - 0.014, lb - 0.012, 0.03, seed + k * 11, 0.009, [Math.max(2, Math.round(la / 0.16)), Math.max(2, Math.round(h / 0.16)), Math.max(2, Math.round(lb / 0.16))]);
    const m = new THREE.Matrix4().makeBasis(V3(dirA[0], 0, dirA[1]), V3(0, 1, 0), V3(dirB[0], 0, dirB[1])).setPosition(cx + dirA[0] * la / 2 + dirB[0] * lb / 2, y + h / 2, cz + dirA[1] * la / 2 + dirB[1] * lb / 2);
    xform(b, m); parts.push(boxUV(b, MATS.masonry.tile, [R(), R()], R()));
    y += h; k++;
  }
}
// 窗 / 门框（灰蓝漆木）：在墙坐标系里，dSet = 框所在深度（距外墙面）
function windowFrame(parts, glass, fr, o, opt = {}) {
  const dSet = opt.dSet ?? 0.12, fw = 0.065, fd = 0.09, W = o.s1 - o.s0, H = o.y1 - o.y0;
  const at = (s, y, d) => fr.toW(s, y, d);
  const piece = (s, y, ls, ly, ld, grain) => {
    const c = at(s, y, dSet + ld / 2);
    woodPiece(parts, c, grain === 'y' ? [ls, ly, ld] : [ls, ly, ld], 'paint', grain === 'y' ? 'y' : 'x', fr.yaw);
  };
  // 外框
  piece(o.s0 + fw / 2, o.y0 + H / 2, fw, H, fd, 'y'); piece(o.s1 - fw / 2, o.y0 + H / 2, fw, H, fd, 'y');
  piece(o.s0 + W / 2, o.y1 - fw / 2, W - 2 * fw, fw, fd, 'x');
  if (!o.door) piece(o.s0 + W / 2, o.y0 + fw / 2, W - 2 * fw, fw, fd + 0.03, 'x');
  if (o.door) return;
  const iw = W - 2 * fw, ih = H - 2 * fw, s0 = o.s0 + fw, y0 = o.y0 + fw;
  const leaves = W > 0.7 ? 2 : 1, lw = iw / leaves, rw = 0.045;
  for (let l = 0; l < leaves; l++) {
    // 扇：open = 外开角度（弧度，绕外侧竖边）
    const ang = opt.open ? opt.open * (l === 0 ? 1 : -1) : 0;
    const hingeS = l === 0 ? s0 : s0 + iw;
    const sub = [];
    const lp = (ls, ly, sx, sy, grain) => woodPiece(sub, [sx, sy, 0], grain === 'y' ? [ls, ly, 0.045] : [ls, ly, 0.045], 'paint', grain);
    // 扇在局部坐标：s 从铰链往扇内（方向 dirS），y 绝对
    const dirS = l === 0 ? 1 : -1;
    lp(rw, ih, dirS * rw / 2, y0 + ih / 2, 'y'); lp(rw, ih, dirS * (lw - rw / 2), y0 + ih / 2, 'y');
    lp(lw - 2 * rw, rw, dirS * lw / 2, y0 + ih - rw / 2, 'x'); lp(lw - 2 * rw, rw * 1.3, dirS * lw / 2, y0 + rw * 0.65, 'x');
    if (!opt.noBars) lp(lw - 2 * rw, 0.03, dirS * lw / 2, y0 + ih * 0.5, 'x');
    const pa = dirS * rw * 0.6, pb = dirS * (lw - rw * 0.6), yb = y0 + rw, yt = y0 + ih - rw;
    const pane = quad([[pa, yb, 0], [pb, yb, 0], [pb, yt, 0], [pa, yt, 0]], 'glass');
    for (let i = 0; i < pane.uv.length; i += 2) { const k = i / 2; pane.uv[i] = pane.pos[k * 3] / MATS.glass.tile + o.s0 * 0.7; pane.uv[i + 1] = -pane.pos[k * 3 + 1] / MATS.glass.tile; }
    // 局部 → 世界：x = 沿墙 s（相对铰链），z = 深度方向（-out 为 +），外开 = 绕铰链竖轴向外转
    const hinge = at(hingeS, 0, dSet + 0.02);
    const m = mul(T(hinge[0], 0, hinge[2]), RY(fr.yaw), RY(ang));
    for (const q of sub) parts.push(xform(q, m));
    glass.push(xform(pane, m));
  }
}

// =====================================================================================
// 守灯人小屋：墙体定义（外墙面），s 轴见 wallFrame
// =====================================================================================
const H = HOUSE;
const WALLS = {
  S: { p0: [H.x0, H.z0], p1: [H.x1, H.z0], out: [0, -1], sOf: (a, b) => [a - H.x0, b - H.x0], gable: false },
  W: { p0: [H.x1, H.z0], p1: [H.x1, H.z1], out: [1, 0], sOf: (a, b) => [a - H.z0, b - H.z0], gable: true, zOf: (s) => H.z0 + s },
  N: { p0: [H.x1, H.z1], p1: [H.x0, H.z1], out: [0, 1], sOf: (a, b) => [H.x1 - b, H.x1 - a], gable: false },
  E: { p0: [H.x0, H.z1], p1: [H.x0, H.z0], out: [-1, 0], sOf: (a, b) => [H.z1 - b, H.z1 - a], gable: true, zOf: (s) => H.z1 - s },
};
function wallOpenings(key) {
  const W = WALLS[key], out = [];
  for (const [name, o] of Object.entries(OPEN)) if (o.wall === key) { const [s0, s1] = W.sOf(o.a, o.b); out.push({ name, ...o, s0, s1 }); }
  return out;
}
const wallTop = (key) => (WALLS[key].gable ? (s) => ridgeLine(WALLS[key].zOf(s)) - 0.02 : () => H.eave);
function wallOutline(key, L) {
  if (!WALLS[key].gable) return [[0, 0], [L, 0], [L, H.eave], [0, H.eave]];
  return [[0, 0], [L, 0], [L, H.eave - 0.02], [L / 2, ridgeLine(1) - 0.02], [0, H.eave - 0.02]];
}

function buildHouseExterior() {
  const parts = [], glassDummy = [], cores = [];
  const QT = 0.72;
  for (const [key, W] of Object.entries(WALLS)) {
    const ops = wallOpenings(key);
    if (key === 'N') { const s = H.x1 - LIGHT_LOCK[0]; ops.push({ name: 'lightLockPad', pad: true, s0: s - 0.3, s1: s + 0.3, y0: LIGHT_LOCK[1] - 0.3, y1: LIGHT_LOCK[1] + 0.3 }); }
    const trim = (ya) => (ya < H.eave - 0.05 ? QT : 0);
    const fr = stoneWall(parts, { p0: W.p0, p1: W.p1, out: W.out, y0: 0, y1: H.eave, top: wallTop(key), openings: ops, seed: 1900 + key.charCodeAt(0), depth: 0.4, trim0: trim, trim1: trim, edges: [H.eave, 0.42] });
    const core = wallCore(fr, wallOutline(key, fr.L), ops.filter((o) => !o.pad), 0.03, H.wt);
    parts.push(boxUV(core, MATS.masonry.tile, [0.37, 0.11])); cores.push(core);
    for (const o of ops) if (!o.pad) windowFrame(parts, glassDummy, fr, o, { open: o.puzzleFrame ? 1.75 : 0, noBars: o.puzzleFrame });
  }
  // 转角石
  quoins(parts, H.x0, H.z0, [1, 0], [0, 1], 0, H.eave, 1951);
  quoins(parts, H.x1, H.z0, [-1, 0], [0, 1], 0, H.eave, 1952);
  quoins(parts, H.x1, H.z1, [-1, 0], [0, -1], 0, H.eave, 1953);
  quoins(parts, H.x0, H.z1, [1, 0], [0, -1], 0, H.eave, 1954);
  // ---- 屋面（石板瓦）：两坡，带轻微下垂与起伏
  const RX0 = H.x0 - 0.3, RX1 = H.x1 + 0.3, EZ0 = H.z0 - 0.38, EZ1 = H.z1 + 0.38, th = 0.1;
  const rcol = [];
  for (const side of [0, 1]) {
    const za = side ? EZ1 : EZ0, slopeL = Math.hypot(Math.abs(1 - za), Math.abs(1 - za) * H.pitch);
    const surf = (u, v, off) => { // u: x 0..1，v: 屋脊 0 → 檐口 1
      const x = lerp(RX0, RX1, u), z = lerp(1, za, v);
      const sag = -0.05 * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.1)) + (fbm(x * 0.6, v * 3, side * 9, 2) - 0.5) * 0.03;
      return [x, ridgeLine(z) + 0.2 + sag + off, z];
    };
    const top = grid(36, 18, (u, v) => surf(u, v, 0), 'slate', side === 0);
    for (let i = 0; i < top.uv.length / 2; i++) { const x = top.pos[i * 3], z = top.pos[i * 3 + 2]; top.uv[i * 2] = x / 2; top.uv[i * 2 + 1] = Math.abs(z - 1) * Math.hypot(1, H.pitch) / 2 + side * 0.37; }
    orientUp(top); parts.push(top);
    // 屋面下皮（檐下、山墙出挑处看得到）：粗木（椽 + 望板）
    const bot = orientDown(grid(12, 6, (u, v) => surf(u, v, -th), 'wood'));
    mapUVRegion(bot, 'beam', (x, y, z, u, v) => [u, v]);
    parts.push(bot);
    // 檐口、山墙边：石板厚度
    for (const [pa, pb] of [[[0, 1], [1, 1]], [[0, 0], [0, 1]], [[1, 0], [1, 1]]]) {
      const a0 = surf(pa[0], pa[1], 0), b0 = surf(pb[0], pb[1], 0), a1 = surf(pa[0], pa[1], -th), b1 = surf(pb[0], pb[1], -th);
      const q = quad([a0, b0, b1, a1], 'slate', [[0, 0], [Math.hypot(b0[0] - a0[0], b0[2] - a0[2]) / 2, 0], [Math.hypot(b0[0] - a0[0], b0[2] - a0[2]) / 2, 0.05], [0, 0.05]]);
      parts.push(q); // 双面看：再加一片反向
      const q2 = quad([a1, b1, b0, a0], 'slate', [[0, 0.05], [1, 0.05], [1, 0], [0, 0]]); parts.push(q2);
    }
    const pts = []; for (const u of [0, 1]) for (const v of [0, 1]) for (const off of [0, -th - 0.25]) pts.push(surf(u, v, off));
    rcol.push(hull(pts));
    // 檐口封檐板 + 檐沟 + 雨水管
    const ez = side ? EZ1 + 0.01 : EZ0 - 0.01, ey = ridgeLine(side ? EZ1 : EZ0) + 0.2 - th - 0.12;
    woodPiece(parts, [(RX0 + RX1) / 2 + 0.0, ey + 0.02, ez], [RX1 - RX0 - 0.1, 0.2, 0.035], 'paint', 'x');
    const gz = ez + (side ? 0.09 : -0.09);
    const gutter = tubePart([[RX0 + 0.05, ey - 0.02, gz], [RX1 - 0.05, ey - 0.05, gz]], 0.065, 30, 8, 'wood');
    mapUVRegion(gutter, 'iron', (x, y, z, u, v) => [u, v]); parts.push(gutter);
    const dpx = side ? H.x0 + 0.35 : H.x1 - 0.35;
    const pipe = tubePart([[dpx, ey - 0.05, gz], [dpx, ey - 0.35, gz + (side ? -0.12 : 0.12)], [dpx, ey - 0.6, (side ? H.z1 : H.z0) + (side ? 0.1 : -0.1)], [dpx, 0.35, (side ? H.z1 : H.z0) + (side ? 0.1 : -0.1)], [dpx, 0.12, (side ? H.z1 : H.z0) + (side ? 0.3 : -0.3)]], 0.045, 24, 8, 'wood');
    mapUVRegion(pipe, 'iron', (x, y, z, u, v) => [u, v]); parts.push(pipe);
  }
  // 屋脊石
  for (let x = RX0 + 0.02; x < RX1 - 0.05; x += 0.6) {
    const L = Math.min(0.58, RX1 - x - 0.02);
    const b = stoneBlock(L, 0.16, 0.34, 0.05, 1970 + x, 0.008, [4, 2, 3]); P(b, T(x + L / 2, ridgeLine(1) + 0.2 + 0.03, 1));
    parts.push(boxUV(b, 2, [x * 0.3, 0.2]));
  }
  // 山墙封檐板（博风板）
  for (const x of [RX0 - 0.02, RX1 + 0.02]) for (const side of [0, 1]) {
    const za = side ? EZ1 : EZ0, L = Math.hypot(1 - za, (1 - za) * H.pitch), ang = Math.atan(H.pitch) * (side ? -1 : 1);
    const mid = [x, (ridgeLine(1) + ridgeLine(za)) / 2 + 0.2 - th - 0.06, (1 + za) / 2];
    const p = plank(L, 0.035, 0.22, 'paint', { cup: 0 });
    parts.push(P(p, T(...mid), RY(-Math.PI / 2), RZ(ang * (1))));
  }
  // ---- 烟囱（东山墙顶）
  const CH = { x0: -6.08, x1: -5.25, z0: 0.58, z1: 1.42, y0: 7.2, y1: 9.35 };
  { const R = rng(1981); let y = CH.y0, k = 0;
    while (y < CH.y1 - 0.05) {
      const h = Math.min(0.28 + R() * 0.1, CH.y1 - y), w = CH.x1 - CH.x0, d = CH.z1 - CH.z0, t = 0.26;
      const blocks = k % 2 ? [[CH.x0 + w / 2, CH.z0 + t / 2, w, t], [CH.x0 + w / 2, CH.z1 - t / 2, w, t], [CH.x0 + t / 2, (CH.z0 + CH.z1) / 2, t, d - 2 * t], [CH.x1 - t / 2, (CH.z0 + CH.z1) / 2, t, d - 2 * t]]
        : [[CH.x0 + t / 2, (CH.z0 + CH.z1) / 2, t, d], [CH.x1 - t / 2, (CH.z0 + CH.z1) / 2, t, d], [(CH.x0 + CH.x1) / 2, CH.z0 + t / 2, w - 2 * t, t], [(CH.x0 + CH.x1) / 2, CH.z1 - t / 2, w - 2 * t, t]];
      for (const [cx, cz, bw, bd] of blocks) { const b = stoneBlock(bw - 0.014, h - 0.014, bd - 0.014, 0.025, 1982 + k * 5 + cx, 0.008, [3, 2, 3]); P(b, T(cx, y + h / 2, cz)); parts.push(boxUV(b, 2, [R(), R()])); }
      y += h; k++;
    }
    const cap = stoneBlock(CH.x1 - CH.x0 + 0.14, 0.1, CH.z1 - CH.z0 + 0.14, 0.02, 1990, 0.006, [4, 2, 4]); P(cap, T((CH.x0 + CH.x1) / 2, CH.y1 + 0.05, (CH.z0 + CH.z1) / 2)); parts.push(boxUV(cap, 2, [0.1, 0.4]));
    const pot = lathePart([[0.11, 0], [0.12, 0.05], [0.1, 0.32], [0.115, 0.36], [0.09, 0.36], [0.075, 0.1]], 12, 'wood');
    mapUVRegion(pot, 'iron', (x, y, z, u, v) => [u, v]); parts.push(P(pot, T((CH.x0 + CH.x1) / 2, CH.y1 + 0.1, (CH.z0 + CH.z1) / 2)));
    rcol.push(colBox((CH.x0 + CH.x1) / 2, (CH.y0 + CH.y1) / 2, (CH.z0 + CH.z1) / 2, CH.x1 - CH.x0, CH.y1 - CH.y0, CH.z1 - CH.z0));
  }
  // ---- 前门：门槛石 + 门扇（向内开到底，贴东侧墙）
  { const o = OPEN.frontDoor;
    const st = stoneBlock(o.b - o.a + 0.5, 0.16, 0.5, 0.03, 1991, 0.006); P(st, T((o.a + o.b) / 2, -0.08 + 0.005, H.z0 - 0.22)); parts.push(boxUV(st, 2, [0.4, 0.1]));
    const leaf = doorLeaf(o.b - o.a - 0.13, o.y1 - 0.08, 1992);
    for (const q of leaf) parts.push(P(q, T(o.a + 0.075, 0.015, H.z0 + 0.13), RY(-Math.PI / 2 + 0.08)));
    rcol.push(colBox(o.a + 0.1, 1.0, H.z0 + 0.6, 0.06, 2.0, 0.9));
  }
  const lod0 = mergeParts(parts);
  const collider = colliderFrom([...cores, ...rcol]);
  return finishAsset({
    name: 'env-keeper-house-ch1', lod0, origin: H.center, collider, uv2Size: 2048,
    extras: { ticket: '019', storeys: { ground: 0, upper: H.f2 }, footprintM: [8, 6], wallThickness: H.wt, eave: H.eave, ridge: +(ridgeLine(1) + 0.2).toFixed(2), placeholderLayout: true,
      note: '外观；室内另见 env-keeper-house-ch1-interior.glb（窗玻璃在室内 GLB）。西窗两扇外开（谜题 4 取景，不挡视线）。无任何自发光。' },
    helpers: [
      { name: 'env-keeper-house-ch1-light-lock-socket', t: LIGHT_LOCK, r: quatLookY(0), extras: { socket: 'prop-light-lock-s2', y: LIGHT_LOCK[1], was: 1.2, facing: '+Z（北）', note: '光感锁安装位（北墙外表面，石板安装面）；puzzleCritical 物体本身在 021', forPuzzleCritical: true } },
      { name: 'env-keeper-house-ch1-cellar-door-socket', t: [(OPEN.cellarDoor.a + OPEN.cellarDoor.b) / 2, 0, H.z1], r: quatLookY(0), extras: { opening: { w: +(OPEN.cellarDoor.b - OPEN.cellarDoor.a).toFixed(2), h: OPEN.cellarDoor.y1 }, leaf: 'env-cellar-door-s2.glb（铰链在西侧 x = 1.05 - 0.07）', note: '地窖门洞（北墙），门扇单独 GLB 方便程序开门' } },
      { name: 'env-keeper-house-ch1-front-door-socket', t: [(OPEN.frontDoor.a + OPEN.frontDoor.b) / 2, 0, H.z0], r: quatLookY(Math.PI), extras: { opening: { w: 1.0, h: OPEN.frontDoor.y1 }, note: '前门（南墙东段），门扇常开（向内贴墙），可通行' } },
      { name: 'env-keeper-house-ch1-window-east-socket', t: [H.x0, (OPEN.winE2.y0 + OPEN.winE2.y1) / 2, (OPEN.winE2.a + OPEN.winE2.b) / 2], r: quatLookY(-Math.PI / 2), extras: { note: '二层东侧小窗外表面中心：风灯放书桌时暖光从这里透出（程序：可在此放一张很弱的暖色窗光体积片 / 让风灯点光穿窗），环境本身不发光' } },
    ],
  });
}
// 板门门扇：竖板 + 三道横带 + 铁铰链，局部原点在铰链边底部，扇沿 +x，厚度沿 z
function doorLeaf(w, h, seed) {
  const parts = [], n = Math.max(3, Math.round(w / 0.19)), bw = w / n, R = rng(seed);
  for (let i = 0; i < n; i++) woodPiece(parts, [bw * (i + 0.5), h / 2, 0], [bw - 0.006, h, 0.04], 'paint', 'y', 0, { uOff: R() * 0.3 });
  for (const y of [0.25, h / 2, h - 0.25]) woodPiece(parts, [w / 2, y, 0.035], [w - 0.08, 0.14, 0.03], 'paint', 'x', 0, { uOff: R() * 0.3 });
  for (const y of [0.3, h - 0.3]) ironPiece(parts, [0.28, y, -0.024], [0.5, 0.045, 0.008]);
  ironPiece(parts, [w - 0.09, h * 0.48, -0.03], [0.06, 0.14, 0.02]);
  return parts;
}
function buildCellarDoor() {
  const o = OPEN.cellarDoor, w = o.b - o.a - 0.13, h = o.y1 - 0.08;
  const leaf = doorLeaf(w, h, 1995);
  // 关闭位置：门框内，深度 0.12（距北墙外表面）；铰链在西侧（x 大），扇向东（-x）展开 → 绕 Y 转 180°
  const hx = o.b - 0.065, hz = H.z1 - 0.12 - 0.02;
  const parts = leaf.map((q) => P(q, T(hx, 0.015, hz), RY(Math.PI)));
  const lod0 = mergeParts(parts);
  return finishAsset({ name: 'env-cellar-door-s2', lod0, origin: [hx, 0, hz], collider: colliderFrom([colBox(hx - w / 2, h / 2, hz, w, h, 0.06)]), uv2Size: 512,
    extras: { ticket: '019（补）', hingeAxis: '原点处竖轴（Y）', openDir: '绕 +Y 转负角向外（北）开，约 -100°', note: '地窖门扇：光感锁触发后由程序开门（小演出：门缝透光——光由程序做）' } });
}

function orientDown(p) { orientUp(p); for (let t = 0; t < p.idx.length; t += 3) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; } return smoothNormals(p); }

// =====================================================================================
// 室内（灰泥 + 木 + 玻璃）：一层厨房兼起居、楼梯、二层卧室；室内单独 GLB 便于 029 烘焙
// =====================================================================================
const CEIL = 6.9;                                                          // 二层平顶（拉梁下）
const ceilY = (z) => Math.min(CEIL, ridgeLine(z) + 0.1);
const LIN = 0.015;                                                         // 灰泥层厚（凸出石墙内表面）
const STAIR = { x0: -3.0, n: 16, rise: 3.0 / 16, run: 0.244, z0: H.iz0 + LIN, z1: -0.55 };
STAIR.xTop = STAIR.x0 + (STAIR.n - 1) * STAIR.run;                         // 最后一级踢面位置（之后是二层楼板）
const WELL = { x0: 0.09, z1: -0.06 };                                      // 地窖楼梯间隔墙（一层从屋里进不去地窖，只能走北墙外门）
// 地板：顺 x 铺板（图集 floor 区 8 条板 × 4 m），skip(x, z) → 不铺
function floorBoards(parts, x0, x1, z0, z1, top, seed, skip = () => false, bw = 0.2) {
  const R = rng(seed); let z = z0, row = 0;
  while (z < z1 - 0.02) {
    const w = Math.min(bw, z1 - z); let x = x0 - (row % 2 ? 0 : R() * 1.5);
    while (x < x1 - 0.02) {
      const a = Math.max(x, x0), L0 = 1.6 + R() * 2.2, b = Math.min(x + L0, x1);
      if (b - a > 0.05) {
        // 按跳过区切段
        let segs = [[a, b]];
        segs = segs.flatMap(([u, v]) => { const out = []; let s = u; const step = 0.05; let cur = null;
          for (let t = u; t <= v + 1e-6; t += step) { const inside = !skip(Math.min(t + step / 2, v), z + w / 2); if (inside && cur === null) cur = t; if ((!inside || t + step > v + 1e-6) && cur !== null) { out.push([cur, inside ? v : t]); cur = null; } } void s; return out; });
        for (const [u, v] of segs) if (v - u > 0.05) woodPiece(parts, [(u + v) / 2, top - 0.015, z + w / 2], [v - u, 0.03, w - 0.004], 'floor', 'x', 0, { strip: (row * 3 + Math.floor(R() * 8)) % 8, uLen: 4, uOff: R() * Math.max(0, 1 - (v - u) / 4) });
      }
      x += L0;
    }
    z += w; row++;
  }
}
// 墙面灰泥层（带洞口）+ 洞口侧壁
function plasterLining(parts, cols, key) {
  const W = WALLS[key], fr = wallFrame(W.p0, W.p1, W.out), L = fr.L, a = H.wt, b = L - H.wt;
  const zOf = W.gable ? W.zOf : null;
  const topAt = (s) => (zOf ? ceilY(zOf(s)) : ceilY(key === 'S' ? H.iz0 : H.iz1));
  let outline;
  if (!W.gable) outline = [[a, 0], [b, 0], [b, topAt(b)], [a, topAt(a)]];
  else { const pts = [[a, 0], [b, 0]]; for (let i = 40; i >= 0; i--) { const s = a + (b - a) * i / 40; pts.push([s, topAt(s)]); } outline = pts.filter((p, i, arr) => i < 2 || !arr[i - 1] || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 1e-4); }
  const ops = wallOpenings(key);
  const lin = wallCore(fr, outline, ops, H.wt, H.wt + LIN, 'plaster');
  parts.push(boxUV(lin, MATS.plaster.tile, [key.charCodeAt(0) * 0.13, 0.3]));
  // 洞口侧壁（从框后 0.21 到内表面）
  for (const o of ops) {
    const d0 = 0.21, d1 = H.wt + LIN;
    const Q = (s0, y0, s1, y1, mat = 'plaster') => { // 侧壁面：沿 (s,y) 线段，从 d0 到 d1
      const p = quad([fr.toW(s0, y0, d0), fr.toW(s1, y1, d0), fr.toW(s1, y1, d1), fr.toW(s0, y0, d1)], mat); parts.push(boxUV(p, MATS.plaster.tile, [0.2, 0.1]));
    };
    Q(o.s0, o.y1, o.s0, o.y0); Q(o.s1, o.y0, o.s1, o.y1); Q(o.s1, o.y1, o.s0, o.y1);
    if (!o.door) {
      // 内窗台板（漆木）：西窗加宽加厚——谜题 4 取景框下沿
      const wide = o.puzzleFrame ? 0.1 : 0.05, c = fr.toW((o.s0 + o.s1) / 2, o.y0 - 0.02, (d0 + d1) / 2 + wide / 2);
      woodPiece(parts, c, [o.s1 - o.s0 + (o.puzzleFrame ? 0.16 : 0.08), 0.04, d1 - d0 + wide + 0.02], 'paint', 'x', fr.yaw);
    }
  }
  return fr;
}
function buildHouseInterior() {
  const parts = [], glass = [], cols = [], helpers = [];
  // ---- 灰泥墙面 + 窗玻璃（窗框本体在外观 GLB；这里只取玻璃）
  for (const key of Object.keys(WALLS)) {
    const fr = plasterLining(parts, cols, key);
    for (const o of wallOpenings(key)) if (!o.door) windowFrame([], glass, fr, o, { open: o.puzzleFrame ? 1.75 : 0, noBars: o.puzzleFrame });
  }
  const IX0 = H.ix0 + LIN, IX1 = H.ix1 - LIN, IZ0 = H.iz0 + LIN, IZ1 = H.iz1 - LIN;
  // ---- 一层地板（地窖上方 + 其余；地窖楼梯间不铺）
  const inWell = (x, z) => x > WELL.x0 && z > WELL.z1;
  floorBoards(parts, IX0, IX1, IZ0, IZ1, 0, 2101, inWell);
  cols.push(colBox((IX0 + WELL.x0) / 2, -0.1, (IZ0 + IZ1) / 2, WELL.x0 - IX0, 0.2, IZ1 - IZ0), colBox((WELL.x0 + IX1) / 2, -0.1, (IZ0 + WELL.z1) / 2, IX1 - WELL.x0, 0.2, WELL.z1 - IZ0));
  // ---- 二层楼板（楼梯口 x STAIR.x0..xTop、z IZ0..STAIR.z1+0.05 不铺）+ 搁栅
  const hole = (x, z) => x > STAIR.x0 && x < STAIR.xTop && z < STAIR.z1 + 0.05;
  floorBoards(parts, IX0, IX1, IZ0, IZ1, H.f2, 2102, hole);
  for (let x = IX0 + 0.25; x < IX1 - 0.1; x += 0.6) {
    if (x > STAIR.x0 + 0.05 && x < STAIR.xTop - 0.05) { beam(parts, [x, H.f2 - 0.12, STAIR.z1 + 0.06], [x, H.f2 - 0.12, IZ1], 0.08, 0.18, 'beam', x); continue; }
    beam(parts, [x, H.f2 - 0.12, IZ0], [x, H.f2 - 0.12, IZ1], 0.08, 0.18, 'beam', x);
  }
  for (const x of [STAIR.x0, STAIR.xTop]) beam(parts, [x, H.f2 - 0.12, IZ0], [x, H.f2 - 0.12, IZ1], 0.1, 0.2, 'beam', x + 3); // 楼梯口两侧加强搁栅
  beam(parts, [STAIR.x0, H.f2 - 0.12, STAIR.z1 + 0.06], [STAIR.xTop, H.f2 - 0.12, STAIR.z1 + 0.06], 0.1, 0.2, 'beam', 7);
  cols.push(colBox((IX0 + STAIR.x0) / 2, H.f2 - 0.12, (IZ0 + IZ1) / 2, STAIR.x0 - IX0, 0.24, IZ1 - IZ0),
    colBox((STAIR.xTop + IX1) / 2, H.f2 - 0.12, (IZ0 + IZ1) / 2, IX1 - STAIR.xTop, 0.24, IZ1 - IZ0),
    colBox((STAIR.x0 + STAIR.xTop) / 2, H.f2 - 0.12, (STAIR.z1 + 0.05 + IZ1) / 2, STAIR.xTop - STAIR.x0, 0.24, IZ1 - STAIR.z1 - 0.05));
  // ---- 楼梯：16 级踢面 0.1875 ≤ 0.2，沿南墙由东往西上（门进来右转上楼，到顶在西窗旁）
  { const zc = (STAIR.z0 + STAIR.z1) / 2, wz = STAIR.z1 - STAIR.z0;
    for (let i = 1; i < STAIR.n; i++) {
      const x0 = STAIR.x0 + (i - 1) * STAIR.run, y = i * STAIR.rise;
      woodPiece(parts, [x0 + STAIR.run / 2 - 0.01, y - 0.02, zc], [STAIR.run + 0.03, 0.04, wz], 'furn', 'z', 0, { uOff: i * 0.13 % 1 });       // 踏板
      woodPiece(parts, [x0 - 0.012, y - STAIR.rise / 2 - 0.02, zc], [0.024, STAIR.rise - 0.03, wz - 0.02], 'furn', 'z', 0, { uOff: i * 0.29 % 1 }); // 踢板
    }
    woodPiece(parts, [STAIR.xTop - 0.012, H.f2 - STAIR.rise / 2 - 0.02, zc], [0.024, STAIR.rise - 0.03, wz - 0.02], 'furn', 'z');
    // 斜梁（两侧）
    const ang = Math.atan2(STAIR.rise, STAIR.run), Ls = Math.hypot(STAIR.xTop - STAIR.x0, H.f2);
    for (const z of [STAIR.z0 + 0.025, STAIR.z1 + 0.025]) { const p = plank(Ls + 0.2, 0.05, 0.26, 'beam', { cup: 0 }); parts.push(P(p, T((STAIR.x0 + STAIR.xTop) / 2, H.f2 / 2 - 0.1, z), RZ(ang))); }
    // 扶手（开敞一侧 z1）：立柱 + 斜扶手；二层楼梯口护栏
    for (let i = 1; i < STAIR.n; i += 3) { const x = STAIR.x0 + (i - 0.5) * STAIR.run, y = i * STAIR.rise; woodPiece(parts, [x, y + 0.45, STAIR.z1 + 0.03], [0.045, 0.9, 0.045], 'furn', 'y'); }
    { const a = [STAIR.x0 + 0.1, 1.05, STAIR.z1 + 0.03], b = [STAIR.xTop, H.f2 + 0.9, STAIR.z1 + 0.03]; beam(parts, a, b, 0.06, 0.05, 'furn', 3); }
    woodPiece(parts, [STAIR.x0 + 0.02, H.f2 + 0.47, (STAIR.z0 + STAIR.z1 + 0.05) / 2], [0.06, 0.94, 0.06], 'furn', 'y');
    for (let x = STAIR.x0 + 0.02; x < STAIR.xTop - 1.0; x += 0.42) woodPiece(parts, [x, H.f2 + 0.45, STAIR.z1 + 0.08], [0.04, 0.9, 0.04], 'furn', 'y');
    beam(parts, [STAIR.x0 - 0.02, H.f2 + 0.92, STAIR.z1 + 0.08], [STAIR.xTop - 0.95, H.f2 + 0.92, STAIR.z1 + 0.08], 0.07, 0.05, 'furn', 5);
    beam(parts, [STAIR.x0 + 0.02, H.f2 + 0.92, IZ0], [STAIR.x0 + 0.02, H.f2 + 0.92, STAIR.z1 + 0.08], 0.07, 0.05, 'furn', 6);
    for (let z = IZ0 + 0.3; z < STAIR.z1; z += 0.4) woodPiece(parts, [STAIR.x0 + 0.02, H.f2 + 0.45, z], [0.04, 0.9, 0.04], 'furn', 'y');
    // 碰撞：斜坡（凸包）+ 栏杆
    cols.push(hull([[STAIR.x0 - 0.02, 0, STAIR.z0], [STAIR.x0 - 0.02, 0, STAIR.z1], [STAIR.xTop, H.f2, STAIR.z0], [STAIR.xTop, H.f2, STAIR.z1], [STAIR.xTop, 0, STAIR.z0], [STAIR.xTop, 0, STAIR.z1]]));
    cols.push(colBox((STAIR.x0 + STAIR.xTop - 0.95) / 2, H.f2 + 0.5, STAIR.z1 + 0.08, STAIR.xTop - 0.95 - STAIR.x0, 1.0, 0.06), colBox(STAIR.x0 + 0.02, H.f2 + 0.5, (IZ0 + STAIR.z1) / 2, 0.06, 1.0, STAIR.z1 - IZ0));
  }
  // ---- 地窖楼梯间隔墙（灰泥，两面）
  { const t = 0.12, y1 = H.f2 - 0.21;
    const w1 = box(t, y1, IZ1 - WELL.z1, 'plaster', [1, 3, 6]); P(w1, T(WELL.x0 + t / 2 - 0.06, y1 / 2, (WELL.z1 + IZ1) / 2)); parts.push(boxUV(w1, MATS.plaster.tile, [0.4, 0.2]));
    const w2 = box(IX1 - WELL.x0 + 0.06, y1, t, 'plaster', [3, 3, 1]); P(w2, T((WELL.x0 - 0.06 + IX1) / 2, y1 / 2, WELL.z1 - t / 2 + 0.06)); parts.push(boxUV(w2, MATS.plaster.tile, [0.1, 0.6]));
    cols.push(colBox(WELL.x0, y1 / 2, (WELL.z1 + IZ1) / 2, t, y1, IZ1 - WELL.z1), colBox((WELL.x0 + IX1) / 2, y1 / 2, WELL.z1, IX1 - WELL.x0, y1, t));
    woodPiece(parts, [WELL.x0 - 0.075, 0.06, (WELL.z1 + IZ1) / 2], [0.025, 0.12, IZ1 - WELL.z1], 'paint', 'z'); // 踢脚
  }
  // ---- 壁炉腔（东墙）：一层灶台凹龛（灶具 027）+ 壁炉架；二层烟道墙
  { const x0 = IX0, x1 = IX0 + 0.42, z0 = 0.35, z1 = 1.65;
    const g = new THREE.Shape([[z0, 0], [z1, 0], [z1, CEIL], [z0, CEIL]].map(([a, b]) => new THREE.Vector2(a, b)));
    g.holes.push(new THREE.Path([[0.6, 0], [1.4, 0], [1.4, 1.15], [0.6, 1.15]].map(([a, b]) => new THREE.Vector2(a, b))));
    const eg = new THREE.ExtrudeGeometry(g, { depth: x1 - x0, bevelEnabled: false, curveSegments: 1 }); const egn = eg.index ? eg.toNonIndexed() : eg; egn.computeVertexNormals();
    const br = fromGeo(egn, 'plaster'); P(br, T(x0, 0, 0), RY(Math.PI / 2)); // 局部 (z, y, x) → 世界：shape x → -z？下面重映射
    // RY(π/2) 把 shape x 轴映射到 -z，需要镜像：改用基
    const m = new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(1, 0, 0)).setPosition(x0 - 0.001, 0, 0);
    const br2 = fromGeo(egn, 'plaster'); xform(br2, m); parts.push(boxUV(weld(br2), MATS.plaster.tile, [0.5, 0.5])); void br;
    const back = stoneBlock(0.06, 1.15, 0.8, 0.01, 2111, 0.01); P(back, T(x0 + 0.03, 0.575, 1.0)); back.mat = 'plaster'; // 龛背面用石（熏黑在 029）
    const ins = [quad([[x0 + 0.06, 0.001, 0.6], [x1, 0.001, 0.6], [x1, 0.001, 1.4], [x0 + 0.06, 0.001, 1.4]], 'plaster'), quad([[x0, 1.15, 1.4], [x1, 1.15, 1.4], [x1, 1.15, 0.6], [x0, 1.15, 0.6]], 'plaster'),
      quad([[x0, 0, 0.6], [x1, 0, 0.6], [x1, 1.15, 0.6], [x0, 1.15, 0.6]], 'plaster'), quad([[x1, 0, 1.4], [x0, 0, 1.4], [x0, 1.15, 1.4], [x1, 1.15, 1.4]], 'plaster')];
    for (const q of ins) parts.push(boxUV(q, MATS.plaster.tile, [0.3, 0.1]));
    parts.push(boxUV(back, MATS.plaster.tile, [0.1, 0.1])); back.mat = 'plaster';
    woodPiece(parts, [x1 + 0.06, 1.28, 1.0], [0.16, 0.08, 1.5], 'furn', 'z');           // 壁炉架
    const hearth = stoneBlock(0.5, 0.04, 1.1, 0.01, 2112, 0.004); P(hearth, T(x1 + 0.2, 0.01, 1.0)); hearth.mat = 'plaster'; parts.push(boxUV(hearth, MATS.plaster.tile, [0.7, 0.2]));
    cols.push(colBox((x0 + x1) / 2, CEIL / 2, (z0 + z1) / 2, x1 - x0, CEIL, z1 - z0));
    helpers.push({ name: 'env-keeper-house-ch1-interior-stove-socket', t: [x0 + 0.25, 0, 1.0], r: quatLookY(-Math.PI / 2), extras: { socket: '027 灶台 / 铁炉', facing: '-X→ 屋内（西）', note: '凹龛 0.8 × 1.15 × 0.36' } });
  }
  // ---- 一层家具：餐桌（台面 0.75）+ 两把椅子 + 碗柜（北墙）
  const table = (c, w, d, h, seed) => {
    woodPiece(parts, [c[0], h - 0.02, c[2]], [w, 0.04, d], 'furn', 'x', 0, { uOff: seed % 1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const lx = c[0] + sx * (w / 2 - 0.07), lz = c[2] + sz * (d / 2 - 0.07); const leg = lathePart([[0.032, 0], [0.034, 0.1], [0.028, 0.35], [0.034, h - 0.16], [0.034, h - 0.04], [0.001, h - 0.04]], 8, 'wood'); mapUVRegion(leg, 'furn', (x, y, z, u, v) => [u * 0.1 + seed % 0.8, v * 0.6]); parts.push(P(leg, T(lx, 0, lz))); }
    woodPiece(parts, [c[0], h - 0.1, c[2] - d / 2 + 0.07], [w - 0.2, 0.1, 0.022], 'furn', 'x'); woodPiece(parts, [c[0], h - 0.1, c[2] + d / 2 - 0.07], [w - 0.2, 0.1, 0.022], 'furn', 'x');
    woodPiece(parts, [c[0] - w / 2 + 0.07, h - 0.1, c[2]], [0.022, 0.1, d - 0.2], 'furn', 'z'); woodPiece(parts, [c[0] + w / 2 - 0.07, h - 0.1, c[2]], [0.022, 0.1, d - 0.2], 'furn', 'z');
    cols.push(colBox(c[0], h / 2, c[2], w, h, d));
  };
  const chair = (c, yaw, seed, pulled = 0) => {
    const sub = [];
    woodPiece(sub, [0, 0.44, 0], [0.42, 0.035, 0.4], 'furn', 'x', 0, { uOff: seed % 1 });
    for (const [sx, sz, h] of [[-1, -1, 0.44], [1, -1, 0.44], [-1, 1, 0.92], [1, 1, 0.92]]) woodPiece(sub, [sx * 0.18, h / 2, sz * 0.17], [0.035, h, 0.035], 'furn', 'y');
    for (const y of [0.62, 0.78, 0.9]) woodPiece(sub, [0, y, 0.17], [0.36, y > 0.85 ? 0.07 : 0.03, 0.022], 'furn', 'x');
    woodPiece(sub, [0, 0.14, -0.17], [0.36, 0.025, 0.02], 'furn', 'x'); woodPiece(sub, [0, 0.14, 0.17], [0.36, 0.025, 0.02], 'furn', 'x');
    const m = mul(T(...c), RY(yaw), RZ(pulled)); for (const q of sub) parts.push(xform(q, m));
    cols.push(colBox(c[0], 0.45, c[2], 0.45, 0.9, 0.45, yaw));
  };
  const TAB = { c: [-2.6, 0, 1.6], w: 1.3, d: 0.8, h: 0.75 };
  table(TAB.c, TAB.w, TAB.d, TAB.h, 0.31);
  chair([TAB.c[0] - 0.25, 0, TAB.c[2] - 0.62], Math.PI + 0.12, 0.2);       // 南侧（汐的位子，拉开一点）
  chair([TAB.c[0] + 0.3, 0, TAB.c[2] + 0.55], -0.05, 0.6);                  // 北侧（父亲的位子，推进去）
  helpers.push({ name: 'env-keeper-house-ch1-interior-cups-socket', t: [TAB.c[0] + 0.05, TAB.h, TAB.c[2]], r: quatLookY(0), extras: { socket: '027 两只杯子（一只倒扣）', tableTop: TAB.h, note: 'GDD §5.3：家里一切照旧，餐桌上两只杯子一只倒扣' } });
  // 碗柜：下柜 0.85 + 上层敞开搁板
  { const x0 = -5.0, x1 = -3.65, z1 = IZ1, dz = 0.45, zc = z1 - dz / 2;
    woodPiece(parts, [(x0 + x1) / 2, 0.43, zc], [x1 - x0, 0.86, dz], 'paint', 'x');
    woodPiece(parts, [(x0 + x1) / 2, 0.88, zc - 0.02], [x1 - x0 + 0.04, 0.035, dz + 0.04], 'furn', 'x');
    for (const sx of [x0 + 0.33, (x0 + x1) / 2, x1 - 0.33]) woodPiece(parts, [sx, 0.5, z1 - dz - 0.008], [0.3, 0.6, 0.016], 'paint', 'x');
    woodPiece(parts, [x0 + 0.02, 1.45, z1 - 0.15], [0.03, 1.15, 0.3], 'paint', 'z'); woodPiece(parts, [x1 - 0.02, 1.45, z1 - 0.15], [0.03, 1.15, 0.3], 'paint', 'z');
    for (const y of [1.3, 1.65, 2.0]) woodPiece(parts, [(x0 + x1) / 2, y, z1 - 0.14], [x1 - x0 - 0.06, 0.025, 0.28], 'paint', 'x');
    woodPiece(parts, [(x0 + x1) / 2, 1.45, z1 - 0.008], [x1 - x0, 1.15, 0.015], 'paint', 'x');
    cols.push(colBox((x0 + x1) / 2, 1.0, z1 - 0.23, x1 - x0, 2.05, 0.46));
    helpers.push({ name: 'env-keeper-house-ch1-interior-dresser-socket', t: [(x0 + x1) / 2, 0.9, zc], r: quatLookY(Math.PI), extras: { socket: '027 碗碟 / 杂物（上层搁板 y 1.3 / 1.65 / 2.0）' } });
  }
  // ---- 二层：床（北墙）、书桌（东墙，风灯 socket）、椅子、木箱
  const F = H.f2;
  { const x0 = -4.9, x1 = -2.9, z0 = 2.45, z1 = IZ1 - 0.01, hc = F + 0.42;
    for (const [x, h] of [[x0, 1.0], [x1, 0.7]]) { for (const z of [z0 + 0.03, z1 - 0.03]) woodPiece(parts, [x + (x === x0 ? 0.03 : -0.03), F + h / 2, z], [0.06, h, 0.06], 'furn', 'y'); woodPiece(parts, [x + (x === x0 ? 0.03 : -0.03), F + h - 0.15, (z0 + z1) / 2], [0.04, 0.25, z1 - z0 - 0.06], 'furn', 'z'); }
    for (const z of [z0 + 0.03, z1 - 0.03]) woodPiece(parts, [(x0 + x1) / 2, F + 0.3, z], [x1 - x0 - 0.12, 0.14, 0.035], 'furn', 'x');
    // 床垫（亚麻）+ 毯子（格子布，从床尾搭下来）+ 枕头
    const mat = stoneBlock(x1 - x0 - 0.14, 0.16, z1 - z0 - 0.1, 0.05, 2121, 0.004, [8, 2, 4]); mat.mat = 'wood';
    mapUVRegion(mat, 'linen', (x, y, z) => [(x + 1) * 0.5, (z + 0.5) * 0.9]); parts.push(P(mat, T((x0 + x1) / 2, hc, (z0 + z1) / 2)));
    const blanket = grid(16, 10, (u, v) => { const x = lerp(x0 + 0.55, x1 + 0.03, u), z = lerp(z0 - 0.07, z1 - 0.02, v), edge = Math.max(0, x - (x1 - 0.08)); const fold = Math.sin(v * Math.PI) * 0.03 + (fbm(x * 3, z * 3, 1, 2) - 0.5) * 0.025;
      const zz = v < 0.08 ? z0 - 0.07 - (0.08 - v) * 0 : z; const yd = v < 0.06 ? -(0.06 - v) / 0.06 * 0.25 : 0; return [x - edge * 0.2, hc + 0.095 + fold - edge * 2.5 + yd, zz]; }, 'wood');
    orientUp(blanket); mapUVRegion(blanket, 'fabric', (x, y, z, u, v) => [u, v]); parts.push(blanket);
    const pil = stoneBlock(0.4, 0.1, z1 - z0 - 0.3, 0.045, 2122, 0.006, [4, 2, 4]); pil.mat = 'wood'; mapUVRegion(pil, 'linen', (x, y, z) => [x + 0.5, z + 0.5]); parts.push(P(pil, T(x0 + 0.3, hc + 0.12, (z0 + z1) / 2), RZ(0.12)));
    cols.push(colBox((x0 + x1) / 2, F + 0.3, (z0 + z1) / 2, x1 - x0, 0.6, z1 - z0));
    helpers.push({ name: 'env-keeper-house-ch1-interior-bed-interact', t: [(x0 + x1) / 2, F + 0.6, z0 - 0.3], r: quatLookY(0), extras: { interact: true, note: '床（可选互动：坐下 / 看枕边）。非 puzzleCritical' } });
    // 木箱（床尾）
    const cx0 = -2.82, cx1 = -2.36, cz0 = 2.6, cz1 = 3.32;
    woodPiece(parts, [(cx0 + cx1) / 2, F + 0.24, (cz0 + cz1) / 2], [cx1 - cx0, 0.48, cz1 - cz0], 'furn', 'z');
    woodPiece(parts, [(cx0 + cx1) / 2, F + 0.5, (cz0 + cz1) / 2], [cx1 - cx0 + 0.03, 0.05, cz1 - cz0 + 0.03], 'furn', 'z');
    for (const z of [cz0 + 0.12, cz1 - 0.12]) ironPiece(parts, [(cx0 + cx1) / 2, F + 0.3, z], [cx1 - cx0 + 0.012, 0.4, 0.04]);
    cols.push(colBox((cx0 + cx1) / 2, F + 0.26, (cz0 + cz1) / 2, cx1 - cx0, 0.52, cz1 - cz0));
  }
  { const x0 = IX0, x1 = -4.8, z0 = -0.85, z1 = 0.25, top = F + 0.75;
    woodPiece(parts, [(x0 + x1) / 2, top - 0.02, (z0 + z1) / 2], [x1 - x0, 0.04, z1 - z0], 'furn', 'z', 0, { uOff: 0.4 });
    for (const z of [z0 + 0.04, z1 - 0.04]) { woodPiece(parts, [x1 - 0.04, F + 0.365, z], [0.05, 0.73, 0.05], 'furn', 'y'); woodPiece(parts, [x0 + 0.04, F + 0.365, z], [0.05, 0.73, 0.05], 'furn', 'y'); }
    woodPiece(parts, [x1 - 0.04, top - 0.12, (z0 + z1) / 2], [0.02, 0.16, z1 - z0 - 0.1], 'furn', 'z');
    woodPiece(parts, [(x0 + x1) / 2 + 0.03, top - 0.12, (z0 + z1) / 2], [x1 - x0 - 0.12, 0.12, 0.46], 'furn', 'z', 0, { uOff: 0.7 }); // 抽屉
    ironPiece(parts, [x1 - 0.015, top - 0.12, (z0 + z1) / 2], [0.015, 0.02, 0.08]);
    cols.push(colBox((x0 + x1) / 2, F + 0.375, (z0 + z1) / 2, x1 - x0, 0.75, z1 - z0));
    chair([-4.5, F, -0.25], Math.PI / 2 + 0.25, 0.8);
    helpers.push({ name: 'env-keeper-house-ch1-interior-lantern-socket', t: [-5.05, top, -0.35], r: quatLookY(0), extras: { socket: 'prop-lantern-brass（汐读日志时放这里）', deskTop: +top.toFixed(3), light: '唯一暖光：程序在风灯上挂动态点光；东侧小窗 winE2 正对院子透出（环境本身无自发光）', note: '014 / 019：暖光只来自风灯' } });
    helpers.push({ name: 'env-keeper-house-ch1-interior-journal-socket', t: [-5.0, top, 0.02], r: quatLookY(-Math.PI / 2), extras: { socket: '027 日志本（摊开）' } });
    helpers.push({ name: 'env-keeper-house-ch1-interior-desk-interact', t: [-4.6, H.f2, -0.25], r: quatLookY(-Math.PI / 2), extras: { interact: true, note: '书桌：读日志（剧情触发）。非 puzzleCritical。站位在二层地板 y 3.0（返工 2026-10-29，原 3.95 悬空）' } });
  }
  // ---- 二层坡顶灰泥 + 平顶 + 拉梁
  for (const side of [0, 1]) {
    const zA = side ? IZ1 : IZ0, zB = side ? 1 + (CEIL - 0.1 - H.eave) / H.pitch * -1 + 3 : 1 - ((3 - (CEIL - 0.1 - H.eave) / H.pitch));
    void zB;
    const zf = side ? 1 + (3 - (CEIL - 0.1 - H.eave) / H.pitch) : 1 - (3 - (CEIL - 0.1 - H.eave) / H.pitch);
    const sl = grid(6, 6, (u, v) => { const z = lerp(zA, zf, v); return [lerp(IX0, IX1, u), ceilY(z) - 0.002, z]; }, 'plaster');
    orientDown(sl); parts.push(boxUV(sl, MATS.plaster.tile, [side * 0.4, 0.1]));
    if (!side) { const fl = grid(6, 3, (u, v) => [lerp(IX0, IX1, u), CEIL - 0.002, lerp(zf, 2 - zf, v)], 'plaster'); orientDown(fl); parts.push(boxUV(fl, MATS.plaster.tile, [0.3, 0.6])); }
  }
  for (const x of [-4.15, -1.6, 0.6]) beam(parts, [x, CEIL - 0.08, H.iz0 + 0.55], [x, CEIL - 0.08, H.iz1 - 0.55], 0.12, 0.16, 'beam', x + 11);
  // ---- 一层门内侧踢脚 + 西窗（谜题 4）说明节点 + 观察点参考
  const winW = OPEN.winW2, sill = winW.y0;
  helpers.push({ name: 'env-keeper-house-ch1-interior-window-west-frame', t: [H.x1, sill, (winW.a + winW.b) / 2], r: quatLookY(Math.PI / 2), extras: {
    puzzle: 4, sillY: sill, opening: { zMin: winW.a, zMax: winW.b, yMin: winW.y0, yMax: winW.y1, wallOuterX: H.x1, wallInnerX: H.ix1 }, leaves: '两扇外开约 100°、无横档（不挡取景）',
    note: '谜题 4 取景框；窗框位置以 014 白盒为准（白盒未到，按 019 文字占位）。框本身在外观 GLB，玻璃在本 GLB' } });
  helpers.push({ name: 'env-keeper-house-ch1-interior-window-west-interact', t: [H.ix1 - 0.25, sill + 0.5, (winW.a + winW.b) / 2], r: quatLookY(Math.PI / 2), extras: { interact: true, note: '靠窗往外看（谜题 4 观察位）；puzzleCritical 判定在 021 的白石 / 镜子上，本节点只给交互位置' } });
  helpers.push({ name: 'env-keeper-house-ch1-interior-viewpoint-s2-ref', t: VIEW.eye, r: quatLookAt(VIEW.eye, [STONES.center[0], 0.2, STONES.center[2]]), extras: { fov: VIEW.fov, placeholder: true, note: '014 viewpoint-s2 节点未交付，此为 019 推定（眼高 1.35 m，站在内墙面后约 0.45 m 的磨亮地板处）；预览 s2-viewpoint 用它' } });
  helpers.push({ name: 'env-keeper-house-ch1-interior-indoor-volume', t: [(IX0 + IX1) / 2, 0, (IZ0 + IZ1) / 2], r: quatLookY(0), extras: { indoorVolume: { min: [IX0, 0, IZ0], max: [IX1, CEIL, IZ1] }, note: '室内体积（029 烘焙 / 音效混响 / 雨声闷化用）' } });
  parts.push(...glass);
  const lod0 = mergeParts(parts);
  return finishAsset({ name: 'env-keeper-house-ch1-interior', lod0, origin: H.center, collider: colliderFrom(cols), uv2Size: 2048, helpers,
    extras: { ticket: '019', interior: true, ceiling: CEIL, stair: { risers: STAIR.n, rise: STAIR.rise, run: STAIR.run, maxStepM: STAIR.rise }, tableTop: 0.75, deskTop: 3.75, placeholderLayout: true,
      lighting: '室内阴天冷光为主；暖光只来自风灯（程序动态光，见 lantern-socket）。本 GLB 无发光材质', glass: 'mat-env-glass-window：BLEND、双面、雨痕 alpha' } });
}

// =====================================================================================
// 地窖（小屋西半部下方）：石墙、石阶（从北墙外地窖门下去）、木架（钥匙 + 草图）
// =====================================================================================
const CELLAR = { x0: -2.6, x1: H.ix1, z0: H.iz0, z1: H.iz1, y0: -2.4, steps: 12, landingZ: 3.1, sx0: 0.15, sx1: H.ix1 };
function buildCellar() {
  const parts = [], cols = [], helpers = [], C = CELLAR, inWellS = (key) => key;
  void inWellS;
  const walls = [
    { key: 'E', p0: [C.x0, C.z0], p1: [C.x0, C.z1], out: [1, 0], top: () => -0.03 },
    { key: 'W', p0: [C.x1, C.z1], p1: [C.x1, C.z0], out: [-1, 0], top: (s) => (C.z1 - s > WELL.z1 ? 0 : -0.03) },
    { key: 'S', p0: [C.x1, C.z0], p1: [C.x0, C.z0], out: [0, 1], top: () => -0.03 },
    { key: 'N', p0: [C.x0, C.z1], p1: [C.x1, C.z1], out: [0, -1], top: (s) => (C.x0 + s > WELL.x0 ? 0 : -0.03) },
  ];
  walls.forEach((w, i) => {
    const fr = stoneWall(parts, { p0: w.p0, p1: w.p1, out: w.out, y0: C.y0, y1: 0, top: w.top, seed: 2200 + i * 7, depth: 0.35, noise: 0.012, jut: 0.04, course: 0.26, courseVar: 0.16, minLen: 0.3, lenVar: 0.5, edges: [-0.03] });
    const L = fr.L; cols.push(colBox((w.p0[0] + w.p1[0]) / 2 - w.out[0] * 0.2, (C.y0 + 0) / 2, (w.p0[1] + w.p1[1]) / 2 - w.out[1] * 0.2, Math.abs(w.out[0]) ? 0.4 : L, -C.y0, Math.abs(w.out[1]) ? 0.4 : L));
    // v0.1-029：墙背衬板（石块后 0.33–0.39 m，两端各伸 0.45 m 封角）。原来石缝直接透到背景，烘焙时也从缝里看到「地下」的地面色（轻微漏光）。只是视觉网格，碰撞不变
    { const c = fr.toW(L / 2, 0, 0.36), ax = Math.abs(w.out[0]) > 0.5, len = L + 0.9, th = 0.06;
      coreBox(parts, c[0] - (ax ? th / 2 : len / 2), c[0] + (ax ? th / 2 : len / 2), C.y0 - 0.1, 0, c[2] - (ax ? len / 2 : th / 2), c[2] + (ax ? len / 2 : th / 2)); }
  });
  // 地面：石板
  paving(parts, C.x0, C.x1, C.z0, C.z1, C.y0, 2231, { thick: 0.1 });
  // v0.1-029：地面背衬板（石板底 y0-0.1 下再留 1 cm，四边各伸 0.45 m 接墙背衬板）。原来石板缝 / 石板与墙脚之间直接透到背景（029 预览里的白线）。只是视觉网格，碰撞不变
  coreBox(parts, C.x0 - 0.45, C.x1 + 0.45, C.y0 - 0.17, C.y0 - 0.11, C.z0 - 0.45, C.z1 + 0.45);
  cols.push(colBox((C.x0 + C.x1) / 2, C.y0 - 0.1, (C.z0 + C.z1) / 2, C.x1 - C.x0, 0.2, C.z1 - C.z0));
  // 天花：一层地板下的搁栅（楼梯间上方无）
  for (let x = C.x0 + 0.3; x < C.x1 - 0.1; x += 0.6) beam(parts, [x, -0.12, C.z0], [x, -0.12, x > WELL.x0 ? WELL.z1 : C.z1], 0.08, 0.18, 'beam', x + 21);
  beam(parts, [C.x0, -0.13, (C.z0 + C.z1) / 2], [C.x1, -0.13, (C.z0 + C.z1) / 2], 0.16, 0.2, 'beam', 2);     // 主梁
  woodPiece(parts, [(C.x0 + C.x1) / 2 - 0.6, C.y0 + 1.15, (C.z0 + C.z1) / 2], [0.16, 2.3, 0.16], 'beam', 'y');     // 立柱
  cols.push(colBox((C.x0 + C.x1) / 2 - 0.6, C.y0 + 1.15, (C.z0 + C.z1) / 2, 0.16, 2.3, 0.16));
  // 石阶：平台 z 3.1..3.4（y 0），12 级 × 0.2 下到 y -2.4（z 0.35）
  { const R = rng(2241), run = (C.landingZ - 0.35) / (C.steps - 1);
    const land = stoneBlock(C.sx1 - C.sx0, 0.2, C.z1 - C.landingZ + 0.02, 0.02, 2242, 0.006); P(land, T((C.sx0 + C.sx1) / 2, -0.1, (C.landingZ + C.z1) / 2)); parts.push(boxUV(land, 2, [0.2, 0.3]));
    for (let i = 1; i < C.steps; i++) {
      const top = -0.2 * i, z1 = C.landingZ - (i - 1) * run, z0 = z1 - run;
      const b = stoneBlock(C.sx1 - C.sx0 - 0.01 * R(), top - C.y0 + 0.01, run + 0.02, 0.02, 2243 + i, 0.008, [4, 3, 2]);
      P(b, T((C.sx0 + C.sx1) / 2, (top + C.y0) / 2, (z0 + z1) / 2), RY((R() - 0.5) * 0.02)); parts.push(boxUV(b, 2, [R(), R()]));
    }
    cols.push(hull([[C.sx0, 0, C.landingZ], [C.sx1, 0, C.landingZ], [C.sx0, C.y0, 0.35], [C.sx1, C.y0, 0.35], [C.sx0, C.y0, C.landingZ], [C.sx1, C.y0, C.landingZ]]));
    cols.push(colBox((C.sx0 + C.sx1) / 2, -0.1, (C.landingZ + C.z1) / 2, C.sx1 - C.sx0, 0.2, C.z1 - C.landingZ));
    // 靠楼梯开敞侧一根木扶手
    beam(parts, [C.sx0 + 0.03, 0.9, C.landingZ], [C.sx0 + 0.03, C.y0 + 0.9, 0.35], 0.05, 0.05, 'furn', 4);
    for (const z of [C.landingZ, 1.73, 0.4]) { const y = z >= C.landingZ ? 0 : C.y0 + (z - 0.35) / (C.landingZ - 0.35) * 2.2; woodPiece(parts, [C.sx0 + 0.03, y + 0.45, z], [0.05, 0.9, 0.05], 'furn', 'y'); }
  }
  // 木架（东墙）：钥匙 + 草图
  { const x0 = C.x0 + 0.04, x1 = x0 + 0.42, z0 = 1.0, z1 = 2.2, yb = C.y0;
    for (const z of [z0 + 0.03, z1 - 0.03]) for (const x of [x0 + 0.03, x1 - 0.03]) woodPiece(parts, [x, yb + 0.9, z], [0.05, 1.8, 0.05], 'furn', 'y');
    for (const y of [0.35, 0.72, SHELF_TOP - 0.015, 1.5]) woodPiece(parts, [(x0 + x1) / 2, yb + y, (z0 + z1) / 2], [x1 - x0, 0.03, z1 - z0], 'furn', 'z', 0, { uOff: y * 0.3 });
    cols.push(colBox((x0 + x1) / 2, yb + 0.9, (z0 + z1) / 2, x1 - x0, 1.8, z1 - z0));
    helpers.push({ name: 'env-cellar-s2-key-socket', t: [(x0 + x1) / 2, yb + SHELF_TOP, z0 + 0.35], r: quatLookY(-Math.PI / 2), extras: { socket: '027 / 021 钥匙（拿钥匙 → 北边铁门）', shelf: 'key', shelfTopAboveFloor: SHELF_TOP, pickupClip: 'xi-pickup-shelf（根 = env-cellar-s2-shelf-interact，钥匙正前 0.45 m、偏右 5 cm；grab 帧挂 middle_03_r，见 characters/README）', note: '钥匙层架面离地 1.10 m（返工 2026-10-29，原中层 0.965）；socket 在架面上。puzzleCritical 物体本身在 021 / 027，本节点只给位置' } });
    helpers.push({ name: 'env-cellar-s2-sketch-socket', t: [(x0 + x1) / 2, yb + SHELF_TOP, z1 - 0.4], r: quatLookY(-Math.PI / 2), extras: { socket: '027 父亲的草图（S3 提示）', shelf: 'key', shelfTopAboveFloor: SHELF_TOP } });
    helpers.push({ name: 'env-cellar-s2-shelf-interact', t: [(x0 + x1) / 2 + 0.45, yb, z0 + 0.35 + 0.05], r: quatLookY(-Math.PI / 2), extras: { interact: true, anim: 'xi-pickup-shelf', faces: '-X（东，面向木架）', keyAhead: 0.45, keyRight: 0.05, note: '木架互动位：站在地窖地面（y -2.4）；钥匙在正前 0.45 m、偏右 5 cm、架面高 1.10（返工 2026-10-29，原 [x1+0.4, 1.1 悬空, 架中]）' } });
  }
  // 木箱
  { const c = [-1.9, C.y0, -0.85];
    woodPiece(parts, [c[0], c[1] + 0.3, c[2]], [0.7, 0.6, 0.5], 'furn', 'x', 0.2, { uOff: 0.5 });
    for (const y of [0.1, 0.5]) woodPiece(parts, [c[0], c[1] + y, c[2]], [0.72, 0.05, 0.52], 'beam', 'x', 0.2);
    woodPiece(parts, [c[0] + 0.15, c[1] + 0.78, c[2] + 0.1], [0.45, 0.36, 0.4], 'furn', 'x', -0.35, { uOff: 0.1 });
    cols.push(colBox(c[0], c[1] + 0.45, c[2], 0.8, 0.9, 0.6, 0.2));
  }
  const lod0 = mergeParts(parts);
  return finishAsset({ name: 'env-cellar-s2', lod0, origin: H.center, collider: colliderFrom(cols), uv2Size: 1024, helpers,
    extras: { ticket: '019', floorY: CELLAR.y0, steps: { count: CELLAR.steps, rise: 0.2 }, entry: '北墙外地窖门（光感锁开）→ 平台 → 石阶向南下', placeholderLayout: true, lighting: '无灯；进门时程序给门缝冷光 + 汐的风灯' } });
}

// =====================================================================================
// 东侧小院：干砌石墙 + 压顶石、院门石柱、铺地、两个灯台基座
// =====================================================================================
function dryWall(parts, cols, p0, p1, out, seed, opt = {}) {
  const hgt = opt.h ?? YARD.wallH, th = 0.5;
  const fr = stoneWall(parts, { p0, p1, out, y0: -0.1, y1: hgt, seed, depth: th, noise: 0.02, jut: 0.06, tilt: 0.04, course: 0.2, courseVar: 0.16, minLen: 0.25, lenVar: 0.45, segLen: 0.2, openings: opt.openings ?? [] });
  // 压顶：竖立的扁石（cock-and-hen）
  const R = rng(seed + 5); let s = 0;
  while (s < fr.L - 0.08) {
    const w = 0.1 + R() * 0.1, hh = 0.18 + R() * 0.12;
    if (!(opt.openings ?? []).some((o) => s + w > o.s0 && s < o.s1)) {
      const c = fr.toW(s + w / 2, hgt + hh / 2 - 0.03, th / 2);
      const b = stoneBlock(w, hh, th + 0.04, 0.02, seed + s * 13, 0.012, [2, 2, 3]);
      P(b, T(...c), RY(fr.yaw), RZ((R() - 0.5) * 0.25)); parts.push(boxUV(b, 2, [R(), R()]));
    }
    s += w + 0.005;
  }
  // 碰撞：分段盒子
  const segs = [[0, fr.L]]; for (const o of opt.openings ?? []) { const [a, b] = segs.pop(); segs.push([a, o.s0], [o.s1, b]); }
  for (const [a, b] of segs) { const m = fr.toW((a + b) / 2, 0, th / 2); cols.push(colBox(m[0], (hgt + 0.2) / 2, m[2], b - a, hgt + 0.2, th, fr.yaw)); }
  return fr;
}
function pillar(parts, cols, x, z, hgt, seed) {
  const R = rng(seed); let y = -0.1;
  while (y < hgt - 0.05) { const h = Math.min(0.28 + R() * 0.1, hgt - y); const b = stoneBlock(0.6, h - 0.012, 0.6, 0.03, seed + y * 9, 0.01); P(b, T(x, y + h / 2, z), RY((R() - 0.5) * 0.05)); parts.push(boxUV(b, 2, [R(), R()])); y += h; }
  const cap = stoneBlock(0.72, 0.12, 0.72, 0.03, seed + 77, 0.008); P(cap, T(x, hgt + 0.06, z)); parts.push(boxUV(cap, 2, [0.3, 0.1]));
  cols.push(colBox(x, hgt / 2, z, 0.72, hgt + 0.2, 0.72));
}
function buildCourtyard() {
  const parts = [], cols = [], helpers = [], Y = YARD;
  // 南墙（院门）
  dryWall(parts, cols, [Y.x0, Y.z0], [Y.x1, Y.z0], [0, -1], 2301, { openings: [{ s0: Y.gate[0] - Y.x0, s1: Y.gate[1] - Y.x0, y0: -0.1, y1: 2, door: true, lintel: false }] });
  dryWall(parts, cols, [Y.x1, Y.z0 + 0.5], [Y.x1, H.z0], [1, 0], 2302);                 // 西墙（到小屋东南角）
  dryWall(parts, cols, [Y.x0, Y.z1], [Y.x0, Y.z0 + 0.5], [-1, 0], 2303);                // 东墙
  dryWall(parts, cols, [Y.x0 + 0.5, Y.z1], [-9.5, Y.z1], [0, 1], 2304);                 // 北墙（西段开口：镜子 b → 光感锁的光路从这里出院子）
  for (const x of Y.gate) pillar(parts, cols, x + (x === Y.gate[0] ? -0.3 : 0.3), Y.z0 + 0.25, 1.35, 2310 + x);
  pillar(parts, cols, -9.5 + 0.3, Y.z1 - 0.25, 1.25, 2315);
  // 铺地（院子里大半铺石，碎缺处露草）
  const R = rng(2321);
  paving(parts, Y.x0 + 0.5, Y.x1, Y.z0 + 0.5, Y.z1 - 0.5, 0, 2322, { thick: 0.12, skip: (x, z) => {
    if (Object.values(LAMP).some((p) => Math.abs(x - p[0]) < 0.5 && Math.abs(z - p[2]) < 0.5)) return true;
    if (x > H.x0 - 0.05 && z > H.z0 - 0.05 && z < H.z1 + 0.05) return true;
    const edge = Math.min(x - Y.x0, Y.x1 - x, z - Y.z0, Y.z1 - z); return fbm(x * 0.35, z * 0.35, 3, 3) + (edge < 1.2 ? 0.12 : 0) > 0.62 || R() < 0.04; } });
  // 灯台基座（与铺地齐平，顶面 y = 0；021 灯台高 1.0 立在上面，光束平面 y = 1.2，朝 +Z）
  for (const [k, p] of Object.entries(LAMP)) {
    const b = stoneBlock(0.9, 0.3, 0.9, 0.025, 2330 + k.length, 0.004, [4, 2, 4]); P(b, T(p[0], -0.15 + 0.002, p[2])); parts.push(boxUV(b, 2, [0.5, 0.5], 0.2));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const bolt = lathePart([[0.025, 0], [0.025, 0.012], [0.001, 0.014]], 6, 'masonry'); P(bolt, T(p[0] + Math.cos(a) * 0.3, 0, p[2] + Math.sin(a) * 0.3)); parts.push(boxUV(bolt, 2, [0.1, 0.1])); }
    helpers.push({ name: `env-courtyard-wall-s2-lamp-${k}-socket`, t: p, r: quatLookY(0), extras: { socket: `021 灯台（${k === 'east' ? '东' : '西'}）`, baseTopY: 0, standHeight: 1.0, beamPlaneY: BEAM_Y, lampEmitY: 0.846, facing: '+Z（北）', forPuzzleCritical: true, note: '基座本身不是 puzzleCritical；灯台 / 镜子 / 光感锁在 021' } });
  }
  helpers.push({ name: 'env-courtyard-wall-s2-gate-socket', t: [(Y.gate[0] + Y.gate[1]) / 2, 0, Y.z0], r: quatLookY(0), extras: { note: '院门口（无门扇，敞开）' } });
  // 021 立镜安装位（2026-10-30）：= extras.mirrorsPlaceholder a / b 的 x、z，落在铺地面 y 0（立镜 prop-mirror-stand-s2 根 = 石座底面中心）；镜心高 BEAM_Y
  for (const [k, p] of Object.entries(MIRRORS)) helpers.push({ name: `env-courtyard-wall-s2-mirror-${k}-socket`, t: [p[0], 0, p[2]], r: quatLookY(0), extras: { socket: `021 立镜 ${k.toUpperCase()}（prop-mirror-stand-s2）`, from: `extras.mirrorsPlaceholder.${k}`, groundY: 0, mirrorCenterY: BEAM_Y, mirrorCenter: p, facing: '+Z（北）= 石座正面；镜面朝向由程序按白盒 yaw 驱动 mirror-pivot（artSlots world 模式，与 socket 朝向无关）', forPuzzleCritical: true } });
  const lod0 = mergeParts(parts);
  return finishAsset({ name: 'env-courtyard-wall-s2', lod0, collider: colliderFrom(cols), uv2Size: 2048, helpers, origin: [(Y.x0 + Y.x1) / 2, 0, (Y.z0 + Y.z1) / 2],
    extras: { ticket: '019', wallHeight: Y.wallH, lamps: LAMP, rack: RACK, mirrorsPlaceholder: MIRRORS, placeholderLayout: true } });
}
// 晾衣架：A 字架 + 绳 + 一张床单（挡西灯台光路）+ 一块小布；-collider 标 blocksLight
function buildLaundryRack() {
  const parts = [], [cx, , cz] = RACK.at, L = RACK.len, ropeY = 1.95, xa = cx - L / 2, xb = cx + L / 2;
  for (const x of [xa, xb]) {
    for (const s of [-1, 1]) beam(parts, [x, -0.05, cz + s * 0.42], [x, ropeY + 0.08, cz + s * 0.03], 0.06, 0.06, 'beam', x + s);
    woodPiece(parts, [x, 0.5, cz], [0.04, 0.05, 0.75], 'beam', 'z');
  }
  const sag = (x) => ropeY - 0.09 * (1 - ((x - cx) / (L / 2)) ** 2);
  const ropePts = []; for (let i = 0; i <= 16; i++) { const x = lerp(xa, xb, i / 16); ropePts.push([x, sag(x), cz]); }
  const rope = tubePart(ropePts, 0.007, 32, 5, 'wood'); mapUVRegion(rope, 'rope', (x, y, z, u, v) => [u, v]); parts.push(rope);
  const cloth = (x0, x1, y0, seed, reg, amp) => {
    const g = grid(18, 14, (u, v) => { const x = lerp(x0, x1, u), top = sag(x) - 0.01, y = lerp(top, y0 + (fbm(x * 2, seed, 0, 2) - 0.5) * 0.08, v);
      const z = cz + Math.sin(u * Math.PI * 3 + seed) * amp * (0.3 + v) + (fbm(x * 1.5, y * 1.5, seed, 3) - 0.5) * amp * 1.6 * v + 0.05 * v * v; return [x, y, z]; }, 'wood');
    mapUVRegion(g, reg, (x, y, z, u, v) => [u, v]); return g;
  };
  const sheet = cloth(cx - 0.75, cx + 0.65, 0.55, 3, 'linen', 0.05);
  const back = clone(sheet); for (let t = 0; t < back.idx.length; t += 3) { const q = back.idx[t + 1]; back.idx[t + 1] = back.idx[t + 2]; back.idx[t + 2] = q; } for (let i = 0; i < back.nrm.length; i++) back.nrm[i] *= -1;
  parts.push(sheet, back);
  const small = cloth(cx + 0.8, cx + 1.12, 1.4, 9, 'fabric', 0.03), sb = clone(small); for (let t = 0; t < sb.idx.length; t += 3) { const q = sb.idx[t + 1]; sb.idx[t + 1] = sb.idx[t + 2]; sb.idx[t + 2] = q; } for (let i = 0; i < sb.nrm.length; i++) sb.nrm[i] *= -1;
  parts.push(small, sb);
  for (const x of [cx - 0.6, cx - 0.1, cx + 0.45, cx + 0.85, cx + 1.08]) woodPiece(parts, [x, sag(x) - 0.03, cz], [0.012, 0.09, 0.03], 'beam', 'y'); // 木夹
  const cols = [colBox(cx - 0.05, 1.2, cz + 0.02, 1.5, 1.4, 0.18), colBox(xa, 1.0, cz, 0.12, 2.05, 0.9), colBox(xb, 1.0, cz, 0.12, 2.05, 0.9)];
  const lod0 = mergeParts(parts);
  return finishAsset({ name: 'env-laundry-rack', lod0, collider: colliderFrom(cols), uv2Size: 512, origin: RACK.at, colliderExtras: { blocksLight: true },
    extras: { ticket: '019', blocksLight: true, sheet: { xMin: +(cx - 0.75).toFixed(2), xMax: +(cx + 0.65).toFixed(2), yMin: 0.55, yMax: 1.86 }, note: '挡住西灯台（x -8.0）往北的光束；光束平面 y 0.85 穿过床单（0.55–1.86）。碰撞体 extras.blocksLight = true，射线检测用它', placeholderLayout: true } });
}

// =====================================================================================
// 修理院与住家陈设（env-repair-yard-s2）：父亲修航标的院子（工棚、浮标、杆标、沉块、油桶、透镜箱）、
//   住家门前（石板路、长凳、雨水桶、菜畦）、屋后搬运路（石板道、手推车、柴垛）、北门（警示牌、崖径绳栏）。
//   全部落在白盒地面 y 0 上；碰撞盒与 game/src/levels/s2/layout.ts S2.props 一致（-footprint 节点带同一组数）。
//   光路（东灯 → 镜 A → 镜 B → 光感锁、西灯往北）两侧 ≥ 0.5 m 不放东西。
// =====================================================================================
const PROPS = {
  workbench: [-12.75, -7.1, 2.6, 0.7, 0.9], shedPostE: [-14.3, -6.45, 0.18, 0.18, 2.1], shedPostW: [-11.2, -6.45, 0.18, 0.18, 2.1],
  lensCrate: [-10.6, -7.15, 0.62, 0.5, 0.5], spars: [-14.22, -0.7, 0.56, 2.6, 0.75], topmark: [-14.0, -2.7, 0.6, 0.6, 1.0],
  buoy: [-13.55, 7.6, 1.9, 1.4, 1.55], sinker: [-11.6, 8.55, 1.0, 0.7, 0.5], drums: [-7.3, -6.95, 0.9, 0.8, 0.9],
  handcart: [-2.5, 6.3, 1.5, 0.8, 0.95], woodpile: [-2.6, 4.32, 1.6, 0.6, 0.95], bench: [-5.3, -2.45, 0.9, 0.38, 0.46],
  waterButt: [1.45, -2.5, 0.8, 0.8, 0.95], bedA: [1.7, -6.3, 1.3, 2.4, 0.28], bedB: [1.7, -9.3, 1.3, 2.0, 0.28], gateSign: [2.7, 11.05, 0.22, 0.22, 1.7],
  craneMast: [-14.3, 8.75, 0.26, 0.26, 4.2], lanternHead: [-7.8, 0.8, 1.8, 1.8, 2.88], canBuoy: [-15.6, -10.2, 1.2, 1.2, 1.9], coneBuoy: [-13.8, -11.6, 1.3, 1.3, 2.1],
  sparRack: [-12.0, -9.4, 3.0, 0.8, 1.2], chainPile: [-15.6, -12.6, 0.9, 0.9, 0.2], outhouse: [5.6, -9.0, 2.2, 2.0, 2.5], gardenWall: [3.6, -8.9, 0.45, 4.2, 0.62],
};
const RAIL = { x: [1.8, 8.2], z: [13, 16, 19, 22, 25], h: 1.0 };
const latheReg = (prof, reg, seg = 20) => mapUVRegion(lathePart(prof, seg, 'wood'), reg, (x, y, z, u, v) => [u, v]);
const stonePart = (w, h, d, seed, c, rotY = 0) => boxUV(P(stoneBlock(w, h, d, Math.min(0.03, h / 4), seed, 0.005), T(...c), RY(rotY)), MATS.masonry.tile, [seed * 0.13 % 1, seed * 0.29 % 1]);
// 石板路：沿折线铺两列不规则石板，顶面 y 0.025（草皮 −4…+1.5 cm），底埋进土里
function flagPath(parts, pts, width, seed) {
  const R = rng(seed);
  const segs = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(l); total += l; }
  for (let s = 0.3; s < total - 0.2;) {
    const d = 0.42 + R() * 0.2;
    let k = 0, acc = 0; while (k < segs.length - 1 && acc + segs[k] < s) acc += segs[k++];
    const t = (s - acc) / segs[k], a = pts[k], b = pts[k + 1], x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]), nx = Math.cos(yaw), nz = -Math.sin(yaw);
    const split = (R() - 0.5) * 0.25;
    for (const [o0, o1] of [[-width / 2, split], [split, width / 2]]) {
      const w = o1 - o0 - 0.04, o = (o0 + o1) / 2 + (R() - 0.5) * 0.03;
      parts.push(stonePart(w, 0.09, d - 0.05, seed + s * 7 + o0, [x + nx * o, 0.025 - 0.045, z + nz * o], yaw + (R() - 0.5) * 0.08));
    }
    s += d;
  }
}
function buildRepairYard() {
  const parts = [], cols = [], helpers = [];
  for (const [k, [cx, cz, w, d, h]] of Object.entries(PROPS)) {
    cols.push(colBox(cx, h / 2, cz, w, h, d));
    helpers.push({ name: `env-repair-yard-s2-${k}-footprint`, t: [cx, 0, cz], r: quatLookY(0), extras: { collider: [cx, cz, w, d, h], groundY: 0 } });
  }
  // ---- 工棚：靠院子南墙（墙顶 1.1）的单坡棚，后柱立在墙顶上，前柱落地；棚下是修灯头的工作台
  const SH = { x0: -14.6, x1: -10.9, zB: -7.75, zF: -6.45, yB: 2.45, yF: 2.1 };
  for (const x of [-14.3, -11.2]) {
    woodPiece(parts, [x, SH.yF / 2, SH.zF], [0.16, SH.yF, 0.16], 'beam', 'y');
    woodPiece(parts, [x, (1.1 + SH.yB) / 2, SH.zB], [0.14, SH.yB - 1.1, 0.14], 'beam', 'y');
    beam(parts, [x, SH.yB + 0.06, SH.zB - 0.15], [x, SH.yF + 0.06, SH.zF + 0.25], 0.08, 0.12, 'beam', x);   // 椽
  }
  beam(parts, [SH.x0, SH.yF + 0.02, SH.zF], [SH.x1, SH.yF + 0.02, SH.zF], 0.12, 0.12, 'beam', 3);
  beam(parts, [SH.x0, SH.yB + 0.02, SH.zB], [SH.x1, SH.yB + 0.02, SH.zB], 0.12, 0.12, 'beam', 4);
  { const n = 9, a = SH.zB - 0.2, b = SH.zF + 0.3; for (let i = 0; i < n; i++) { const z0 = lerp(a, b, i / n), z1 = lerp(a, b, (i + 1) / n), y = (zz) => lerp(SH.yB, SH.yF, (zz - SH.zB) / (SH.zF - SH.zB)) + 0.15;
    beam(parts, [SH.x0 - 0.1, y((z0 + z1) / 2) + (i % 2) * 0.012, (z0 + z1) / 2], [SH.x1 + 0.1, y((z0 + z1) / 2) + (i % 2) * 0.012, (z0 + z1) / 2], z1 - z0 + 0.03, 0.025, 'beam', i + 0.5); } }
  // 工具板（挂在后柱之间、墙顶之上）+ 挂着的扳手 / 钳子 / 灯罩卡箍
  woodPiece(parts, [-12.75, 1.62, -7.46], [2.9, 0.7, 0.03], 'furn', 'x');
  for (let i = 0; i < 7; i++) { const x = -13.95 + i * 0.4, L = 0.28 + (i % 3) * 0.08; ironPiece(parts, [x, 1.72 - L / 2, -7.43], [0.035, L, 0.012]); ironPiece(parts, [x, 1.72 - L, -7.43], [0.09, 0.05, 0.014]); }
  // 工作台：四腿 + 台面 + 下层隔板；台上虎钳、灯头透镜（拆下来擦的）、油壶
  const [bx, bz, bw, bd, bh] = PROPS.workbench;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) woodPiece(parts, [bx + sx * (bw / 2 - 0.07), (bh - 0.06) / 2, bz + sz * (bd / 2 - 0.07)], [0.09, bh - 0.06, 0.09], 'beam', 'y');
  woodPiece(parts, [bx, bh - 0.03, bz], [bw, 0.06, bd], 'furn', 'x');
  woodPiece(parts, [bx, 0.26, bz], [bw - 0.12, 0.03, bd - 0.1], 'furn', 'x');
  ironPiece(parts, [bx - 0.9, bh + 0.06, bz + 0.22], [0.22, 0.12, 0.14]);
  ironPiece(parts, [bx - 0.9, bh + 0.14, bz + 0.34], [0.03, 0.03, 0.2]);
  { const ring = latheReg([[0.2, 0], [0.22, 0.02], [0.22, 0.05], [0.2, 0.07], [0.19, 0.07], [0.19, 0]], 'iron', 24); parts.push(P(ring, T(bx + 0.1, bh, bz - 0.05)));
    const lens = lathePart([[0.001, 0.02], [0.12, 0.05], [0.185, 0.12], [0.12, 0.2], [0.001, 0.23]], 20, 'glass'); parts.push(P(lens, T(bx + 0.1, bh, bz - 0.05))); }
  parts.push(P(latheReg([[0.001, 0], [0.07, 0], [0.075, 0.02], [0.07, 0.11], [0.02, 0.17], [0.012, 0.25], [0.001, 0.25]], 'iron', 12), T(bx + 0.8, bh, bz + 0.15)));
  // 透镜箱（木板钉的箱子，盖子斜搭）
  { const [cx, cz, w, d, h] = PROPS.lensCrate; for (const sx of [-1, 1]) woodPiece(parts, [cx + sx * (w / 2 - 0.012), h / 2 - 0.02, cz], [0.024, h - 0.04, d], 'furn', 'z');
    for (const sz of [-1, 1]) woodPiece(parts, [cx, h / 2 - 0.02, cz + sz * (d / 2 - 0.012)], [w - 0.05, h - 0.04, 0.024], 'furn', 'x');
    woodPiece(parts, [cx, 0.02, cz], [w, 0.04, d], 'furn', 'x');
    parts.push(P(plank(w + 0.02, d + 0.02, 0.025, 'furn'), T(cx, h - 0.01, cz + 0.02), RX(-0.05))); }
  // 杆标：三根漆过的木杆斜靠东墙（杆身贴着墙顶内沿 (-14.5, 1.1)）+ 一个铁条焊的锥形顶标
  for (const [z, seed] of [[-1.6, 1], [-0.95, 2], [0.15, 3]]) {
    const base = [-14.02 - seed * 0.03, 0.012, z], dx = -14.5 - base[0], dy = 1.1 + 0.07 - base[1], l = Math.hypot(dx, dy), L = 3.0;
    const top = [base[0] + dx / l * L, base[1] + dy / l * L, z + 0.05 * seed];
    parts.push(mapUVRegion(tubePart([base, top], 0.06, 4, 8, 'wood'), seed === 2 ? 'paint' : 'beam', (x, y, zz, u, v) => [u * 3, v]));
  }
  { const [tx, tz] = PROPS.topmark, apex = [tx, 1.0, tz];
    const corners = [[-0.26, -0.26], [0.26, -0.26], [0.26, 0.26], [-0.26, 0.26]].map(([a, b]) => [tx + a, 0.02, tz + b]);
    for (const c of corners) beam(parts, c, apex, 0.03, 0.03, 'iron');
    for (const y of [0.02, 0.4]) { const s = 1 - y / 1.0; for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; beam(parts, [lerp(apex[0], a[0], s), y + 0.015, lerp(apex[2], a[2], s)], [lerp(apex[0], b[0], s), y + 0.015, lerp(apex[2], b[2], s)], 0.03, 0.03, 'iron'); } } }
  // 罐形浮标：横躺在两道木枕上（枕木顶 0.30 = 浮标底），木楔卡住，顶上吊环
  { const [cx, cz] = PROPS.buoy, R0 = 0.62, cy = 0.30 + R0;
    const body = latheReg([[0.001, -0.85], [0.35, -0.85], [0.58, -0.72], [R0, -0.45], [R0, 0.55], [0.52, 0.7], [0.26, 0.85], [0.001, 0.85]], 'iron', 28);
    const band = latheReg([[R0 + 0.004, -0.15], [R0 + 0.012, -0.12], [R0 + 0.012, 0.22], [R0 + 0.004, 0.25]], 'paint', 28);
    for (const p of [body, band]) parts.push(P(p, T(cx, cy, cz), RZ(Math.PI / 2)));
    for (const x of [cx - 0.6, cx + 0.6]) {
      woodPiece(parts, [x, 0.15, cz], [0.2, 0.3, 1.3], 'beam', 'z');
      for (const s of [-1, 1]) { const zz = s * 0.45, top = cy - Math.sqrt(R0 * R0 - zz * zz); woodPiece(parts, [x, (0.3 + top) / 2, cz + zz + s * 0.03], [0.18, top - 0.3 + 0.01, 0.14], 'beam', 'x'); }
    }
    parts.push(P(tubePart([...Array(13).keys()].map((i) => [Math.cos(i / 12 * Math.PI * 2) * 0.09, Math.sin(i / 12 * Math.PI * 2) * 0.09 + 0.09, 0]), 0.018, 24, 6, 'wood', true), T(cx, cy + R0 - 0.01, cz)));
    mapUVRegion(parts[parts.length - 1], 'iron', (x, y, z, u, v) => [u, v]); }
  // 沉块（系浮标的石坠）+ 地上盘着的锚链
  { const [cx, cz] = PROPS.sinker; parts.push(stonePart(0.9, 0.45, 0.6, 2601, [cx, 0.225, cz]));
    ironPiece(parts, [cx, 0.5, cz], [0.18, 0.1, 0.04]);
    const coil = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 5, r = 0.32 - i / 64 * 0.12; coil.push([cx + 0.75 + Math.cos(a) * r, 0.035 + Math.floor(i / 26) * 0.05, cz - 0.15 + Math.sin(a) * r]); }
    coil.push([cx + 0.3, 0.035, cz - 0.05], [cx + 0.05, 0.5, cz]);
    parts.push(mapUVRegion(tubePart(coil, 0.035, 120, 6, 'wood'), 'iron', (x, y, z, u, v) => [u * 8, v])); }
  // 油桶（灯油）
  for (const [x, z, seed] of [[-7.52, -7.1, 0], [-7.02, -6.82, 1]]) {
    parts.push(P(latheReg([[0.001, 0], [0.27, 0], [0.29, 0.02], [0.29, 0.86], [0.27, 0.88], [0.001, 0.88]], seed ? 'paint' : 'iron', 20), T(x, 0, z)));
    for (const y of [0.29, 0.59]) parts.push(P(latheReg([[0.296, y - 0.02], [0.302, y], [0.296, y + 0.02]], 'iron', 20), T(x, 0, z)));
  }
  // ---- 住家门前：石板路（南石阶顶 → 前门），门边石脚长凳，西南角雨水桶 + 落水管，西侧两块菜畦
  flagPath(parts, [[0, -13.35], [-0.35, -10.2], [-1.5, -7.2], [-3.0, -4.6], [-4.1, -2.0]], 1.05, 2701);
  parts.push(stonePart(1.3, 0.12, 0.45, 2702, [-4.1, -0.03, -2.2]));                      // 门前踏石
  { const [cx, cz, w, d, h] = PROPS.bench; for (const s of [-1, 1]) parts.push(stonePart(0.16, h - 0.06, d - 0.04, 2710 + s, [cx + s * (w / 2 - 0.12), (h - 0.06) / 2, cz]));
    woodPiece(parts, [cx, h - 0.03, cz], [w, 0.06, d], 'furn', 'x'); }
  { const [cx, cz, , , h] = PROPS.waterButt;
    parts.push(P(latheReg([[0.001, 0], [0.34, 0], [0.37, 0.15], [0.39, 0.48], [0.37, 0.8], [0.35, h], [0.32, h - 0.02], [0.32, h - 0.08], [0.001, h - 0.08]], 'furn', 18), T(cx, 0, cz)));
    for (const y of [0.12, h - 0.12]) parts.push(P(latheReg([[0.375, y - 0.025], [0.385, y], [0.375, y + 0.025]], 'iron', 18), T(cx, 0, cz)));
    parts.push(mapUVRegion(tubePart([[1.72, 5.45, -2.05], [1.72, 1.4, -2.05], [1.6, 1.1, -2.25], [1.5, h + 0.02, -2.42]], 0.045, 24, 8, 'wood'), 'iron', (x, y, z, u, v) => [u * 4, v]));
    ironPiece(parts, [1.72, 5.5, -2.1], [0.5, 0.08, 0.12]); }
  for (const k of ['bedA', 'bedB']) {
    const [cx, cz, w, d, h] = PROPS[k], R = rng(2720 + cz * 10);
    for (const [ax, az, len, rot] of [[cx, cz - d / 2 + 0.08, w, 0], [cx, cz + d / 2 - 0.08, w, 0], [cx - w / 2 + 0.08, cz, d - 0.32, Math.PI / 2], [cx + w / 2 - 0.08, cz, d - 0.32, Math.PI / 2]]) {
      const n = Math.max(2, Math.round(len / 0.45));
      for (let i = 0; i < n; i++) { const o = -len / 2 + (i + 0.5) * len / n, bx2 = ax + Math.cos(rot) * o, bz2 = az + Math.sin(rot) * o; parts.push(stonePart(len / n - 0.02, h - R() * 0.03, 0.16, 2730 + i + cz, [bx2, (h - 0.015) / 2, bz2], -rot)); }
    }
    const soil = orientUp(grid(10, 14, (u, v) => [lerp(cx - w / 2 + 0.16, cx + w / 2 - 0.16, u), 0.2 + 0.03 * Math.sin(u * Math.PI * 6) * (fbm(u * 3, v * 9, cz, 2) + 0.3), lerp(cz - d / 2 + 0.16, cz + d / 2 - 0.16, v)], 'rock'));
    parts.push(boxUV(soil, MATS.rock.tile));
    woodPiece(parts, [cx - 0.6, 0.5, cz + d / 2 - 0.25], [0.04, 0.6, 0.04], 'beam', 'y');   // 豆架桩
  }
  // ---- 屋后：院子北口 → 地窖门的搬运石板道；柴垛贴北墙（窗台 1.0 下）；手推车停在道边
  flagPath(parts, [[-6.2, 5.15], [-3.6, 5.2], [0.62, 5.2], [0.62, 4.0]], 0.9, 2801);
  flagPath(parts, [[1.4, 5.3], [2.7, 7.6], [3.8, 10.0], [4.2, 11.4]], 0.85, 2802);
  { const [cx, cz, w, d] = PROPS.woodpile, rows = [4, 4, 4, 3, 3, 2, 2], r = 0.072, R = rng(2810);
    rows.forEach((n, j) => { for (let i = 0; i < n; i++) { const z = cz - d / 2 + r + 0.01 + i * (2 * r + 0.008) + (4 - n) * 0.02, y = r + j * r * 1.75, L = w - R() * 0.12;
      parts.push(mapUVRegion(tubePart([[cx - L / 2, y, z], [cx + L / 2, y, z]], r * (0.85 + R() * 0.2), 3, 8, 'wood'), 'beam', (x, yy, zz, u, v) => [u, v])); } }); }
  { const [cx, cz] = PROPS.handcart, bed = 0.55;
    woodPiece(parts, [cx + 0.15, bed, cz], [1.1, 0.06, 0.7], 'furn', 'x');
    for (const s of [-1, 1]) woodPiece(parts, [cx + 0.15, bed + 0.14, cz + s * 0.34], [1.1, 0.22, 0.03], 'furn', 'x');
    woodPiece(parts, [cx + 0.69, bed + 0.14, cz], [0.03, 0.22, 0.7], 'furn', 'z');
    for (const s of [-1, 1]) {
      beam(parts, [cx + 0.7, bed - 0.06, cz + s * 0.3], [cx - 0.75, 0.85, cz + s * 0.3], 0.05, 0.06, 'beam', s);
      beam(parts, [cx - 0.35, bed - 0.05, cz + s * 0.3], [cx - 0.38, 0.0, cz + s * 0.3], 0.05, 0.05, 'beam', s + 2);   // 支腿落地
      const wheel = latheReg([[0.27, -0.03], [0.3, -0.02], [0.3, 0.02], [0.27, 0.03], [0.06, 0.04], [0.06, -0.04]], 'beam', 18);
      parts.push(P(wheel, T(cx + 0.35, 0.3, cz + s * 0.42), RX(Math.PI / 2)));
    }
    beam(parts, [cx + 0.35, 0.3, cz - 0.45], [cx + 0.35, 0.3, cz + 0.45], 0.04, 0.04, 'iron');
    for (let i = 0; i < 3; i++) parts.push(P(latheReg([[0.001, 0], [0.13, 0], [0.13, 0.2], [0.001, 0.2]], 'rope', 12), T(cx + 0.35 - i * 0.28, bed + 0.03, cz - 0.1 + (i % 2) * 0.18))); }
  // ---- 018 大胆版：从俯瞰就读得出「家 + 航标修理院」——院角吊杆、院中修到一半的灯笼头、院南露天航标堆场、屋西石砌柴煤房和菜园石墙、通院门的石板路
  // 吊杆：院子东北角立桅，臂伸到浮标吊环上，铁链垂下挂住
  { const [mx, mz, , , mh] = PROPS.craneMast, [bxu, bzu] = PROPS.buoy, hookY = 0.92 + 0.62 + 0.18;
    woodPiece(parts, [mx, mh / 2, mz], [0.24, mh, 0.24], 'beam', 'y');
    beam(parts, [mx, mh - 0.25, mz], [bxu + 0.05, mh - 0.55, bzu], 0.14, 0.16, 'beam', 41);
    beam(parts, [mx, 1.6, mz], [lerp(mx, bxu, 0.6), mh - 0.42, lerp(mz, bzu, 0.6)], 0.1, 0.1, 'beam', 42);
    parts.push(mapUVRegion(tubePart([[bxu + 0.05, mh - 0.62, bzu], [bxu + 0.05, hookY, bzu]], 0.025, 6, 6, 'wood'), 'iron', (x, y, z, u, v) => [u * 6, v]));
    ironPiece(parts, [bxu + 0.05, mh - 0.6, bzu], [0.16, 0.16, 0.12]);
    for (const s of [-1, 1]) beam(parts, [mx, mh - 0.1, mz], [mx + s * 0.25, 1.15, mz + (s > 0 ? -0.25 : 0.25) * 0], 0.02, 0.02, 'iron'); }
  // 灯笼头：拆回来修的航标灯室（铁座 + 八根窗棂 + 玻璃 + 穹顶 + 通风球），架在木枕上
  { const [lx, lz] = PROPS.lanternHead;
    for (const s of [-1, 1]) woodPiece(parts, [lx + s * 0.55, 0.12, lz], [0.22, 0.24, 1.7], 'beam', 'z');
    const at = (p) => P(p, T(lx, 0.24, lz));
    parts.push(at(latheReg([[0.001, 0], [0.8, 0], [0.82, 0.05], [0.82, 0.48], [0.78, 0.52], [0.001, 0.52]], 'paint', 24)));
    parts.push(at(lathePart([[0.72, 0.52], [0.72, 1.72]], 24, 'glass')));
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; beam(parts, [lx + Math.cos(a) * 0.74, 0.76, lz + Math.sin(a) * 0.74], [lx + Math.cos(a) * 0.74, 1.96, lz + Math.sin(a) * 0.74], 0.05, 0.05, 'iron'); }
    parts.push(at(latheReg([[0.001, 1.72], [0.84, 1.72], [0.84, 1.8], [0.62, 2.12], [0.3, 2.34], [0.08, 2.4], [0.001, 2.4]], 'iron', 24)));
    parts.push(at(latheReg([[0.001, 2.38], [0.1, 2.44], [0.13, 2.52], [0.1, 2.6], [0.001, 2.64]], 'iron', 12)));
    parts.push(at(latheReg([[0.001, 0.52], [0.18, 0.52], [0.2, 0.9], [0.12, 1.25], [0.001, 1.25]], 'iron', 12))); }
  // 院南露天航标堆场：立着的罐形浮标、锥形浮标（底下坠块），木架上横放的杆标，地上一堆锚链
  for (const [k, cone] of [['canBuoy', false], ['coneBuoy', true]]) {
    const [cx, cz, w, , h] = PROPS[k], r = w / 2 - 0.08;
    parts.push(stonePart(w - 0.05, 0.3, w - 0.05, 2900 + cx, [cx, 0.15, cz]));
    const prof = cone ? [[0.001, 0.3], [r, 0.3], [r, 0.7], [r * 0.25, h - 0.15], [0.001, h - 0.12]] : [[0.001, 0.3], [r, 0.3], [r, h - 0.25], [r * 0.9, h - 0.2], [0.001, h - 0.2]];
    parts.push(P(latheReg(prof, 'iron', 22), T(cx, 0, cz)));
    parts.push(P(latheReg([[r + 0.008, 0.75], [r + 0.012, 0.8], [r + 0.012, cone ? 0.95 : 1.15], [r + 0.008, cone ? 1.0 : 1.2]].map(([a, b]) => [cone ? a * (1 - (b - 0.7) / (h - 0.85) * 0.75) : a, b]), 'paint', 22), T(cx, 0, cz)));
    ironPiece(parts, [cx, (cone ? h - 0.1 : h - 0.12), cz], [0.05, 0.12, 0.05]);
  }
  { const [cx, cz, w, d, h] = PROPS.sparRack;
    for (const s of [-1, 1]) { woodPiece(parts, [cx + s * (w / 2 - 0.2), h * 0.45, cz], [0.12, h * 0.9, d], 'beam', 'z'); woodPiece(parts, [cx + s * (w / 2 - 0.2), h * 0.9, cz], [0.16, 0.12, d + 0.1], 'beam', 'z'); }
    for (let i = 0; i < 4; i++) { const z = cz - d / 2 + 0.12 + i * (d - 0.24) / 3, y = h * 0.9 + 0.06 + 0.07;
      parts.push(mapUVRegion(tubePart([[cx - w / 2 - 0.3 + i * 0.1, y, z], [cx + w / 2 + 0.2 - i * 0.15, y, z]], 0.07, 4, 8, 'wood'), i % 2 ? 'paint' : 'beam', (x, yy, zz, u, v) => [u * 3, v])); } }
  { const [cx, cz] = PROPS.chainPile, coil = [];
    for (let i = 0; i <= 90; i++) { const a = i / 90 * Math.PI * 7, r = 0.42 - i / 90 * 0.3; coil.push([cx + Math.cos(a) * r, 0.035 + Math.floor(i / 30) * 0.06, cz + Math.sin(a) * r]); }
    parts.push(mapUVRegion(tubePart(coil, 0.04, 160, 6, 'wood'), 'iron', (x, y, z, u, v) => [u * 10, v])); }
  flagPath(parts, [[-1.0, -11.6], [-3.6, -10.6], [-6.6, -9.4], [-9.0, -8.3]], 0.9, 2803);
  // 屋西柴煤房：石墙、木板单坡顶、朝东（−X）的木门；菜园西边一道干砌石墙
  { const [cx, cz, w, d, h] = PROPS.outhouse, t = 0.3, wallH = h - 0.45;
    let sd = 3000;
    const course = (x0, x1, z0, z1, skip) => { for (let y = 0; y < wallH - 0.01; y += 0.3) { const along = Math.abs(x1 - x0) > Math.abs(z1 - z0), L = along ? x1 - x0 : z1 - z0, n = Math.max(2, Math.round(L / 0.55)), off = (Math.round(y / 0.3) % 2) * 0.5;
      for (let i = -off; i < n; i++) { const a = Math.max(0, (i) / n), b = Math.min(1, (i + 1) / n); if (b - a < 0.05) continue; const m = (a + b) / 2, x = along ? lerp(x0, x1, m) : x0, z = along ? z0 : lerp(z0, z1, m);
        if (skip && skip(x, z, y)) continue;
        parts.push(stonePart((b - a) * Math.abs(L) - 0.03, 0.28, t, sd++, [x, y + 0.14, z], along ? 0 : Math.PI / 2)); } } };
    const door = (x, z, y) => z > cz - 0.45 && z < cz + 0.45 && y < 1.8;
    course(cx - w / 2 + t / 2, cx + w / 2 - t / 2, cz - d / 2 + t / 2, cz - d / 2 + t / 2);
    course(cx - w / 2 + t / 2, cx + w / 2 - t / 2, cz + d / 2 - t / 2, cz + d / 2 - t / 2);
    course(cx - w / 2 + t / 2, cx - w / 2 + t / 2, cz - d / 2 + t, cz + d / 2 - t, door);
    course(cx + w / 2 - t / 2, cx + w / 2 - t / 2, cz - d / 2 + t, cz + d / 2 - t);
    woodPiece(parts, [cx - w / 2 + t / 2, 0.92, cz], [0.05, 1.8, 0.88], 'furn', 'y');
    woodPiece(parts, [cx - w / 2 + t / 2, 1.95, cz], [t + 0.04, 0.12, 1.1], 'beam', 'z');
    for (let i = 0; i < 8; i++) { const z = cz - d / 2 - 0.15 + (i + 0.5) * (d + 0.3) / 8, x0 = cx - w / 2 - 0.3, x1 = cx + w / 2 + 0.2;
      beam(parts, [x0, h + 0.02 + (i % 2) * 0.01, z], [x1, wallH + 0.05 + (i % 2) * 0.01, z], (d + 0.3) / 8 + 0.02, 0.04, 'beam', 60 + i); } }
  { const [gx, gz, gw, gd, gh] = PROPS.gardenWall, n = Math.round(gd / 0.5);
    for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) parts.push(stonePart(gw - 0.06 - j * 0.06, gh / 2 - 0.02, gd / n - 0.04, 3100 + i + j * 50, [gx, gh / 4 + j * gh / 2, gz - gd / 2 + (i + 0.5 + (j ? 0.3 : 0)) * gd / n * (j && i === n - 1 ? 0.97 : 1)], 0)); }
  // ---- 北门：门柱外侧警示牌（铁牌 + 白漆横条）；门外崖径两侧绳栏桩，告诉人这条路是管着的、危险的
  { const [sx, sz, , , h] = PROPS.gateSign; woodPiece(parts, [sx, h / 2, sz], [0.12, h, 0.12], 'beam', 'y');
    ironPiece(parts, [sx, 1.35, sz - 0.075], [0.55, 0.38, 0.02]);
    woodPiece(parts, [sx, 1.35, sz - 0.088], [0.46, 0.07, 0.006], 'paint', 'x'); }
  for (const x of RAIL.x) {
    RAIL.z.forEach((z) => woodPiece(parts, [x, RAIL.h / 2, z], [0.11, RAIL.h, 0.11], 'beam', 'y'));
    for (let i = 0; i < RAIL.z.length - 1; i++) { const a = RAIL.z[i], b = RAIL.z[i + 1], pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([x, RAIL.h - 0.12 - Math.sin(t * Math.PI) * 0.12, lerp(a, b, t)]); }
      parts.push(mapUVRegion(tubePart(pts, 0.016, 16, 5, 'wood'), 'rope', (xx, y, z, u, v) => [u * 4, v])); }
  }
  return finishAsset({ name: 'env-repair-yard-s2', origin: [0, 0, 0], parts, collider: colliderFrom(cols), helpers, uv2Size: 2048,
    extras: { props: PROPS, rail: RAIL, note: '父亲的航标修理院与住家陈设；碰撞盒与 layout.ts S2.props 一致，全部底面 y 0' } });
}

// =====================================================================================
// 崖顶地形：草皮高度场 + 崖壁 + 南石阶 + 北边界石墙 / 铁门位 + 崖径
// =====================================================================================
// 边界（顺时针，数学坐标 x 右 z 上 ⇒ cliffStrip 的 inward = (tz, -tx) 指向场内）
const EDGE = [[-17, 12.0], [-8, 12.6], [1.5, 12.8], [1.2, 18.5], [1.8, 25.0], [8.3, 25.0], [8.8, 18.0], [8.5, 12.8], [16, 11.2], [21.5, 8.4], [24.6, 4.2], [25.2, -1.5], [24.3, -7.5],
  [20.2, -12.2], [10, -14.4], [STAIR_S.x[1] + 0.3, -14.0], [STAIR_S.x[1] + 0.3, -18.6], [STAIR_S.x[0] - 0.3, -18.6], [STAIR_S.x[0] - 0.3, -14.0], [-10, -14.6], [-17, -13.2], [-18.2, -4], [-17.6, 6], [-17, 12.0]];
const CLIFF_SKIP = new Set([15, 16, 17, 4]);   // 不做崖壁的边：南石阶缺口 3 条、北端崖径出口
const inPoly = (x, z, poly = EDGE) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
const edgeDist = (x, z) => { let d = Infinity; for (let i = 0; i < EDGE.length - 1; i++) d = Math.min(d, segDist(x, z, EDGE[i], EDGE[i + 1])); return d; };
function terrainAt(x, z) {
  // 建筑附近平整；西侧 x > 6 往崖边缓坡（白石区）；其余轻微起伏
  const nearBuild = Math.max(sstep(3.5, 1.0, Math.max(H.x0 - x, x - H.x1, H.z0 - z, z - H.z1, 0)), x < YARD.x1 + 1 && x > YARD.x0 - 1 && z > YARD.z0 - 1 && z < YARD.z1 + 1 ? 1 : 0);
  const stair = sstep(4, 1.5, Math.hypot(x - 0, Math.max(0, z - STAIR_S.zTop))) * (z < -10 ? 1 : 0);
  const flatK = Math.max(nearBuild, stair);
  let h = (fbm(x * 0.09, z * 0.09, 7, 3) - 0.5) * 0.7 + (fbm(x * 0.4, z * 0.4, 9, 2) - 0.5) * 0.12;
  h -= 0.05 * Math.max(0, x - 6) + 0.003 * Math.max(0, x - 12) ** 2 * 0.5;          // 西坡
  h += sstep(10, 22, z) * 0.6 * sstep(0, 5, x);                                        // 北侧崖径微微抬起
  h -= sstep(3, 0, edgeDist(x, z)) * 0.25;                                              // 崖边下压、变圆
  h = lerp(h, x < YARD.x1 + 0.6 && x > YARD.x0 - 0.2 && z > YARD.z0 - 0.2 && z < YARD.z1 + 0.2 ? -0.04 : 0, flatK);
  // 可走范围（014 白盒地面：崖顶平台 y 0 / 西坡 slopeY / 北崖径 y 0）里草皮贴住碰撞面，只留 −4…+1.5 cm 的起伏：
  //   原来 ±0.35 m 的起伏让角色脚陷进草里或悬在草上；地面的「精致」交给铺石、小径和陈设
  const walk = Math.max(sstep(-0.6, 0, Math.min(x - WALK.x[0], WALK.x[1] - x, z - WALK.z[0], WALK.z[1] - z)),
    sstep(-0.6, 0, Math.min(x - WALK.north.x[0], WALK.north.x[1] - x, z - WALK.z[1] + 0.6, WALK.north.z1 - z)));
  const ground = x <= WALK.slopeX ? 0 : -(x - WALK.slopeX) * WALK.dropPerM;
  //   白石组（prop-white-stones-s2 贴 slopeY 摆的）一带草皮只往上起伏，石底不悬空
  const stoneK = sstep(-0.8, 0, Math.min(x - STONES.x0, STONES.x1 - x, z - STONES.z0, STONES.z1 - z));
  h = lerp(h, ground + clamp((fbm(x * 0.55, z * 0.55, 13, 2) - 0.55) * 0.12, lerp(-0.04, 0, stoneK), 0.015), walk);
  return { h };
}
function buildClifftop() {
  const parts = [], cols = [], helpers = [], walls = [];
  // ---- 草皮高度场（0.5 m 格），只保留边界内、房屋外的三角形
  const X0 = -18.5, X1 = 25.5, Z0 = -19, Z1 = 25.5, st = 0.5, nu = Math.round((X1 - X0) / st), nv = Math.round((Z1 - Z0) / st);
  const tg = grid(nu, nv, (u, v) => { const x = lerp(X0, X1, u), z = lerp(Z0, Z1, v); return [x, terrainAt(x, z).h, z]; }, 'turf');
  { const keep = [];
    for (let t = 0; t < tg.idx.length; t += 3) {
      let cx = 0, cz = 0; for (let k = 0; k < 3; k++) { cx += tg.pos[tg.idx[t + k] * 3] / 3; cz += tg.pos[tg.idx[t + k] * 3 + 2] / 3; }
      if (!inPoly(cx, cz)) continue;
      if (cx > H.x0 + 0.3 && cx < H.x1 - 0.3 && cz > H.z0 + 0.3 && cz < H.z1 - 0.3) continue;              // 屋内（地窖在下面）
      if (cx > STAIR_S.x[0] - 0.35 && cx < STAIR_S.x[1] + 0.35 && cz < STAIR_S.zTop) continue;           // 南石阶缺口
      keep.push(tg.idx[t], tg.idx[t + 1], tg.idx[t + 2]);
    }
    tg.idx = Uint32Array.from(keep); }
  orientUp(tg);
  for (let i = 0; i < tg.uv.length / 2; i++) { tg.uv[i * 2] = tg.pos[i * 3] / MATS.turf.tile; tg.uv[i * 2 + 1] = tg.pos[i * 3 + 2] / MATS.turf.tile; }
  parts.push(compact(tg, tg.idx));
  cols.push(colliderFrom([tg]));
  // ---- 崖壁（沿边界外扩 1 m，顶在草皮下 0.25 m，崖顶内收段藏在草皮下面）
  { let run = [];
    const flush = () => { if (run.length > 1) {
      const poly = run.map(([x, z], i) => { const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz); return [x - (tz / l) * 1.0, z + (tx / l) * 1.0]; });
      parts.push(cliffStrip(poly, { step: 0.4, yBot: () => -16, yTop: (x, z) => terrainAt(x, z).h - 0.25, capRise: -0.2, capNoise: 0.1, capDepth: 1.6, capRows: 3, talus: 0 })); }
      run = []; };
    for (let i = 0; i < EDGE.length - 1; i++) { if (CLIFF_SKIP.has(i)) { flush(); continue; } if (!run.length) run.push(EDGE[i]); run.push(EDGE[i + 1]); }
    flush(); }
  // ---- 南石阶（下到 S1 方向，12 级 × 0.2）+ 两侧挡墙
  { const S2 = STAIR_S, R = rng(2401);
    for (let i = 0; i < S2.n; i++) {
      const top = -S2.rise * (i + 1), z1 = S2.zTop - i * S2.run, z0 = z1 - S2.run - 0.02;
      for (let x = S2.x[0]; x < S2.x[1] - 0.02;) { const w = Math.min(0.5 + R() * 0.5, S2.x[1] - x); const b = stoneBlock(w - 0.01, 0.2, z1 - z0, 0.02, 2402 + i * 5 + x, 0.008, [3, 2, 2]); P(b, T(x + w / 2, top - 0.1, (z0 + z1) / 2)); parts.push(boxUV(b, 2, [R(), R()])); x += w; }
      const core = box(S2.x[1] - S2.x[0], 3.0, z1 - z0, 'masonry'); P(core, T((S2.x[0] + S2.x[1]) / 2, top - 0.2 - 1.5, (z0 + z1) / 2)); parts.push(boxUV(core, 2, [0.1, 0.2]));
    }
    const zEnd = S2.zTop - S2.n * S2.run - 0.6;
    for (const [sx, out] of [[S2.x[0], [-1, 0]], [S2.x[1], [1, 0]]]) {
      const p0 = out[0] < 0 ? [sx - 0.0, zEnd] : [sx, S2.zTop + 0.4], p1 = out[0] < 0 ? [sx, S2.zTop + 0.4] : [sx, zEnd];
      // 挡墙可见面朝阶内（out 取反），墙顶随阶下降
      const inOut = [-out[0], 0], q0 = inOut[0] > 0 ? p1 : p0, q1 = inOut[0] > 0 ? p0 : p1;
      const fr = stoneWall(parts, { p0: [q0[0], q0[1]], p1: [q1[0], q1[1]], out: inOut, y0: -3.2, y1: 0.45, seed: 2410 + sx, depth: 0.32, top: (s) => { const z = q0[1] + (q1[1] - q0[1]) * s / Math.abs(q1[1] - q0[1]); return 0.45 - S2.rise * clamp((S2.zTop - z) / S2.run, 0, S2.n); }, course: 0.3, noise: 0.012 });
      void fr; cols.push(colBox(sx + out[0] * 0.16, -1.0, (S2.zTop + zEnd) / 2 + 0.2, 0.32, 3.0, S2.zTop - zEnd + 0.8));
    }
    // 阶下平台（出口方向）
    paving(parts, S2.x[0], S2.x[1], zEnd, S2.zTop - S2.n * S2.run, -S2.rise * S2.n, 2420, { thick: 0.15 });
    const top = -S2.rise * S2.n;
    cols.push(hull([[S2.x[0], 0, S2.zTop], [S2.x[1], 0, S2.zTop], [S2.x[0], top, S2.zTop - S2.n * S2.run], [S2.x[1], top, S2.zTop - S2.n * S2.run], [S2.x[0], top - 0.3, S2.zTop], [S2.x[1], top - 0.3, S2.zTop]]));
    cols.push(colBox(0, top - 0.15, (zEnd + S2.zTop - S2.n * S2.run) / 2, S2.x[1] - S2.x[0], 0.3, S2.zTop - S2.n * S2.run - zEnd));
    helpers.push({ name: 'env-clifftop-s2-stairs-top', t: [0, 0, S2.zTop], r: quatLookY(0), extras: { note: '南石阶顶（从 S1 上来）。spawn 建议 (0, 0, -12.5) 朝 +Z' } });
    helpers.push({ name: 'env-clifftop-s2-spawn', t: [0, 0, -12.5], r: quatLookY(0), extras: { spawn: true, facing: '+Z（北，正对小屋前门）', placeholder: true } });
    helpers.push({ name: 'env-clifftop-s2-stairs-bottom', t: [0, top, zEnd + 0.3], r: quatLookY(Math.PI), extras: { note: '石阶底（回 S1 的出口触发区建议放这里）' } });
  }
  // ---- 北边界干砌墙 + 铁门位（崖径起点）
  { const z = GATE.z, R = rng(2430);
    const segsW = [[-16.6, -9.5], [-9.5, 1.3], [1.3, GATE.x[0] - 0.35], [GATE.x[1] + 0.35, 8.7], [8.7, 15.6]];
    for (const [a, b] of segsW) {
      if (a === -9.5) continue; // 小院北墙到小屋北侧之间留开（光路 / 走动）
      dryWall(parts, cols, [b, z], [a, z], [0, 1], 2431 + a * 3, { h: 1.0 + (b - a > 4 ? 0 : 0.1) }); void R;
    }
    for (const x of [GATE.x[0] - 0.3, GATE.x[1] + 0.3]) pillar(parts, cols, x, z + 0.25, 1.6, 2440 + x);
    helpers.push({ name: 'env-clifftop-s2-gate-socket', t: [(GATE.x[0] + GATE.x[1]) / 2, 0, z + 0.25], r: quatLookY(0), extras: { socket: '021 / 027 铁门（地窖钥匙开）', opening: GATE.x[1] - GATE.x[0], pillarH: 1.6, note: '铁门扇不在本单；门洞宽 1.6' } });
    helpers.push({ name: 'env-clifftop-s2-exit-to-s3', t: EXIT_S3, r: quatLookY(0), extras: { exit: 'S3', note: '崖径北端（出口触发区建议 3 × 3 m）', placeholder: true } });
  }
  // ---- 几块露头岩（避开白石区、小屋、小院、路）
  for (const [x, z, s, seed] of [[-15.5, -11.5, 1.6, 1], [11.5, -12.2, 2.0, 2], [22.5, -9, 1.7, 3], [22.8, 7.0, 1.4, 4], [-16.2, 3.0, 1.2, 5], [10.6, 9.6, 1.1, 6], [7.4, 21.5, 1.3, 7], [2.3, 16.5, 0.9, 8], [16.5, -5.8, 0.9, 9]]) {
    if (x > STONES.x0 - 1 && x < STONES.x1 + 1 && z > STONES.z0 - 1 && z < STONES.z1 + 1) continue;
    const c = { size: [1, 0.55, 0.8], seed: 2450 + seed, planes: 9, detail: 9, strataH: 0.16, cracks: 3 };
    const { prim, height } = makeRockC(c, { tile: 2.0 / s });
    const g = terrainAt(x, z).h; parts.push(P(prim, T(x, g - height * s * 0.35, z), RY(seed * 1.7), S(s, s * 0.7, s * 0.85)));
    cols.push(colBox(x, g + height * s * 0.2, z, s * 0.9, height * s * 0.7, s * 0.75, seed * 1.7));
  }
  // ---- 空气墙（-wall）：沿边界内 0.3 m，高 3 m
  for (let i = 0; i < EDGE.length - 1; i++) {
    const [ax, az] = EDGE[i], [bx, bz] = EDGE[i + 1], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, ix = tz * 0.3, iz = -tx * 0.3;
    const mx = (ax + bx) / 2 + ix, mz = (az + bz) / 2 + iz, y = terrainAt(mx, mz).h;
    walls.push(colBox(mx, y + 1.0, mz, L + 0.3, 4.0, 0.2, Math.atan2(-tz, tx)));
  }
  const lod0 = mergeParts(parts);
  return finishAsset({ name: 'env-clifftop-s2', lod0, collider: colliderFrom(cols), walls, origin: [0, 0, 0], uv2Planar: [X0, Z0, Math.max(X1 - X0, Z1 - Z0)], uv2PlanarFitAll: true, helpers,
    extras: { ticket: '019', platform: '平台约 30 × 25 m（x -17..13、z -14..12 大致平整）+ 西坡 x 6..25 到崖边（白石区 x 14–22）+ 北崖径 x 1.5–8.5 到 z 25', stonesArea: STONES, cliffBottomY: -16, placeholderLayout: true } });
}

// =====================================================================================
// 主流程
// =====================================================================================
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
mkdirSync(OUT_ENV, { recursive: true });
const want = (n) => !ONLY.length || ONLY.some((o) => n === o || n.includes(o));
const T0 = Date.now();
if (want('env-keeper-house-ch1')) buildHouseExterior();
if (want('env-keeper-house-ch1-interior')) buildHouseInterior();
if (want('env-cellar-door-s2')) buildCellarDoor();
if (want('env-cellar-s2')) buildCellar();
if (want('env-courtyard-wall-s2')) buildCourtyard();
if (want('env-laundry-rack')) buildLaundryRack();
if (want('env-clifftop-s2')) buildClifftop();
if (want('env-repair-yard-s2')) buildRepairYard();
const total = [0, 1, 2].map((l) => REPORT.reduce((s, r) => s + r.tris[l], 0));
LAYOUT.note = '019 占位布局（014 白盒 / layout.ts 尚未交付）：坐标由美术按 014 / 019 / GDD §6 文字推定，白盒到了按白盒对位（误差要求 ≤ 5 cm）。+Z 北、右手系 ⇒ 东 = -X、西 = +X；局部 y = 世界高度。';
LAYOUT.axes = { north: '+Z', east: '-X', west: '+X', up: '+Y', units: 'm' };
LAYOUT.keyHeights = { groundFloor: 0, upperFloor: H.f2, westWindowSill: OPEN.winW2.y0, lightLockY: LIGHT_LOCK[1], tableTop: 0.75, deskTop: H.f2 + 0.75, lampBaseTop: 0, lampStand: 1.0, beamPlane: BEAM_Y, lampEmitY: 0.846, cellarFloor: CELLAR.y0, cellarShelfTop: +(CELLAR.y0 + SHELF_TOP).toFixed(3), cellarShelfTopAboveFloor: SHELF_TOP, cellarKeyY: +(CELLAR.y0 + SHELF_TOP).toFixed(3), eave: H.eave, ridge: +(ridgeLine(1) + 0.2).toFixed(2) };
LAYOUT.points = {
  house: { center: H.center, footprint: { x: [H.x0, H.x1], z: [H.z0, H.z1] }, wallThickness: H.wt }, openings: OPEN,
  lightLock: LIGHT_LOCK, viewpointS2: { eye: VIEW.eye, lookAt: [STONES.center[0], 0.2, STONES.center[2]], fov: VIEW.fov, placeholder: true },
  stonesArea: STONES, yard: YARD, lamps: LAMP, rack: RACK, mirrors: MIRRORS, northGate: GATE, exitToS3: EXIT_S3, stairsTop: [0, 0, STAIR_S.zTop], spawn: [0, 0, -12.5],
  deskInteract: [-4.6, H.f2, -0.25],                                  // 返工 2026-10-29：y 3.95 → 3.0（二层地板）
  cellarShelf: { x: [CELLAR.x0 + 0.04, CELLAR.x0 + 0.46], z: [1.0, 2.2], topAboveFloor: SHELF_TOP, topY: +(CELLAR.y0 + SHELF_TOP).toFixed(3), shelvesAboveFloor: [0.365, 0.735, SHELF_TOP, 1.515] },
  cellarKey: [+(CELLAR.x0 + 0.25).toFixed(3), +(CELLAR.y0 + SHELF_TOP).toFixed(3), 1.35], cellarSketch: [+(CELLAR.x0 + 0.25).toFixed(3), +(CELLAR.y0 + SHELF_TOP).toFixed(3), 1.8],
  cellarShelfInteract: [+(CELLAR.x0 + 0.25 + 0.45).toFixed(3), CELLAR.y0, 1.4], cellarPickupClip: 'xi-pickup-shelf（钥匙正前 0.45 m、偏右 5 cm，架面 1.10；grab 22 / lift 25，见 art/models/characters/README.md）',
  lanternSocket: [-5.05, H.f2 + 0.75, -0.35], eastWindowGlow: { wall: 'E', z: [OPEN.winE2.a, OPEN.winE2.b], y: [OPEN.winE2.y0, OPEN.winE2.y1] },
};
// 021 白石占位（只给预览用：8 块，散在西坡 12–20 m 处）
LAYOUT.placeholders = { whiteStones: [[15.2, -1.6], [16.6, 2.8], [17.4, 0.3], [18.6, -2.0], [19.3, 3.6], [20.4, 1.2], [21.2, -0.8], [15.8, 4.1]].map(([x, z]) => [x, +terrainAt(x, z).h.toFixed(3), z]) };
LAYOUT.worldFrames = {
  s2: { rotationY: +(120 * D2R_S2).toFixed(5), rotationYDeg: 120, origin: [1.225, 16, 14.75], source: 'game/src/levels/s2/layout.ts S2_WORLD_FRAME（014 白盒）：world = origin + R_y(120°)·local；入口 spawn (0,0,-12.5) 落在 S1 出口 (-9.6, ·, 21)；S2 地面 = 世界 y 16' },
  s3: { towerCenter: [39.73, 0, -122.75], rotationY: 2.35619, rotationYDeg: 135, socketY: 6.6, source: 'game/src/levels/s1/layout.ts S3_WORLD_FRAME（013 白盒）', inS2Local: { towerCenter: [99.83, -16, 102.1], azimuthDeg: 315.6, distanceM: 142.8, note: '方位 0 = 北(+Z)、90 = 东(-X)；S3 灯塔在小屋西北，和 014 白盒注释「局部方位 ≈ 315°」一致' } },
  note: '返工 2026-10-29 写入。下面 silhouettes 仍是 019 的远景占位（260, -30, 520，方位约 333°），程序按 worldFrames.s3 放真塔时以 worldFrames 为准',
};
LAYOUT.silhouettes = [{ file: 'models/env/env-lighthouse-silhouette-far.glb', translation: [260, -30, 520], rotationY: 0.4, scale: 1, note: 'S3 灯塔剪影在西北地平线（+X +Z），复用 018 剪影' }];
LAYOUT.triangles = { lod: total, budget: [4_000_000, 2_300_000, 1_000_000] };
if (!ONLY.length) writeFileSync(join(ART, 'source/env/s2-layout.json'), JSON.stringify(LAYOUT, null, 1));
console.log('\n资产                              LOD0 / LOD1 / LOD2           材质  碰撞面  UV2(块/texel·m⁻¹)  大小');
for (const r of REPORT) console.log(`${r.name.padEnd(34)}${r.tris.map((t) => String(t).padStart(8)).join(' /')}   ${r.mats.length}   ${String(r.colliderTris).padStart(6)}   ${r.lightmap ? `${r.lightmap.charts}/${r.lightmap.texelsPerM}@${r.lightmap.size}` : '-'}  ${(r.bytes / 1024).toFixed(0)} KB`);
console.log(`S2 静态大件合计：${total.join(' / ')}（预算 4M / 2.3M / 1M）`);
console.log(`材质：${[...new Set(REPORT.flatMap((r) => r.mats))].join(', ')}`);
console.log(`用时 ${((Date.now() - T0) / 1000).toFixed(0)} s`);
