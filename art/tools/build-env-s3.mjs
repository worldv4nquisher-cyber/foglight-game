// S3 初望灯塔场景大件（需求单 020）程序化建模 → GLB。无需 Blender，只用 game/node_modules 里的 three 与 meshoptimizer。
//   node art/tools/build-env-s3.mjs [--only=name,name] [--embed]
// 输出：art/models/env/*.glb、art/models/props/prop-fresnel-lens-ch1.glb、art/source/env/s3-layout.json；之后 node art/tools/glb-pack-ktx2.mjs 换 KTX2 + 量化。
// 通用工具（噪声、几何、LOD、UV2、描边色、GLB 写出）从 build-env-s1/s2.mjs 复制（S1/S2 脚本不动），S3 内容在文件后半。
// 约定（v0.1-index §5、style-guide §8 §9）：1 单位 = 1 m，+Y 向上，+Z 朝北，右手系 ⇒ 东 = -X、西 = +X。
//   S3 局部原点 = 灯塔中心、y = 0 = 退潮水面（011）；涨潮 1.6。局部 y = 世界高度；摆放见根节点 extras.placement 与 s3-layout.json。
//   每件 <名>_lod0/_lod1/_lod2，<名>-collider，TEXCOORD_1 = UV2，COLOR_0 = 平滑法线。环境里没有任何自发光 / 灯光：
//   点火后的暖光（灯室、光束）全部由程序动态光做，灯室只给 socket / 辅助节点。
//   材质：mat-env-lighthouse-ch1-wall（020 打磨：S3 专用外墙） / mat-env-stone-masonry / mat-env-rock-shore / mat-env-wood-ch1（与 S1 完全相同）
//        + mat-env-lighthouse-weather（新：风化贴花 + 玻璃，alpha 混合）+ mat-prop-puzzle-ch1（021 道具图集的黄铜）+ mat-prop-fresnel-glass；每件 ≤ 3。
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
  // ↓ 与 S1 build-env-s1.mjs 完全一致（同名同参数 → S1 远景与 S3 同一套材质）
  rock: { name: 'mat-env-rock-shore', tex: 'tex-rock-shore', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.72, wetRoughness: 0.2, tideMark: 'uTideLevel', triplanarOk: true } },
  masonry: { name: 'mat-env-stone-masonry', tex: 'tex-stone-masonry', tile: 2.0, extras: { tileM: 2.0, wetDarken: 0.75, wetRoughness: 0.22, tideMark: 'uTideLevel' } },
  wood: { name: 'mat-env-wood-ch1', tex: 'tex-wood-ch1', atlas: true, extras: { atlas: true, wetDarken: 0.75, wetRoughness: 0.3, tideMarkPainted: 1.6 } },
  // 020 打磨：S3 灯塔外墙换成专用的风化刷白石砌（4 m 一张：0.4 m 一皮、灰缝、大片剥落露深灰石、缝里苔）；改名避免和 S1 的 mat-env-lighthouse-white 同名不同图
  white: { name: 'mat-env-lighthouse-ch1-wall', tex: 'tex-lighthouse-ch1-wall', tile: 4.0, extras: { tileM: 4.0, wetDarken: 0.8, wetRoughness: 0.25, tideMark: 'uTideLevel', note: 'S3 灯塔外墙：刷白方石砌，0.4 m 一皮，刷白大片剥落露出深灰石，灰缝带苔；锈流痕/返潮/藻带由 mat-env-lighthouse-weather 贴花叠加' } },
  // ↓ S3 新增
  weather: { name: 'mat-env-lighthouse-weather', tex: 'tex-lighthouse-ch1-weather', atlas: true, alphaMode: 'BLEND', doubleSided: false, extras: { atlas: true, decal: true, transparent: true, depthWrite: false, polygonOffset: -1, note: '风化贴花图集（锈流痕/塔基湿痕藻带/苔/剥落/水渍/室内潮痕）+ 玻璃区，贴在墙外 1–1.5 cm；不发光' } },
  brass: { name: 'mat-prop-puzzle-ch1', tex: 'tex-props-puzzle-ch1', atlas: true, extras: { atlas: true, note: '与 021 道具共用图集（旧黄铜/铁皮区）' } },
  lens: { name: 'mat-prop-fresnel-glass', color: '#B9C6CC', alpha: 0.32, rough: 0.04, metal: 0, alphaMode: 'BLEND', doubleSided: true, extras: { transparent: true, depthWrite: false, steppedSpecular: true, specBands: 3, specColor: '#DCE1E4', ior: 1.52, note: '菲涅尔透镜玻璃：棱环几何本身就是阶梯，023 toon 材质请给 3 级阶梯化高光；点亮前冷色反光，点亮后由程序把高光/透射染成 Lamp Amber。无自发光' } },
};
// 木材图集分区（S1 tex-wood-ch1，与 gen_tex_env_s1.py WOOD_REGIONS 一致）+ 风化图集分区 + 021 道具图集分区，[u0, v0, w, h]，glTF v 向下
const WOOD = {
  deck: [0, 0, 1, 0.5], boat: [0, 0.5, 0.5, 0.25], pile: [0.5, 0.5, 0.25, 0.5], beam: [0.75, 0.5, 0.25, 0.25],
  iron: [0.75, 0.75, 0.25, 0.25], rope: [0, 0.75, 0.25, 0.25], shed: [0.25, 0.75, 0.5, 0.25],
  rust: [0, 0, 0.125, 1], grime: [0.125, 0, 0.125, 1], algae: [0.25, 0, 0.5, 0.5], moss: [0.75, 0, 0.25, 0.25], wet: [0.75, 0.25, 0.25, 0.25],
  ironDark: [0.84375, 0.765625, 0.03125, 0.03125],   // 铁件区里最匀的一块深铁（64 px），外观铁栏/灯笼/穹顶用，避免迷彩铁纹在大面积上变成噪点
  stain: [0.25, 0.5, 0.25, 0.5], tide: [0.5, 0.5, 0.25, 0.5], glass: [0.75, 0.5, 0.25, 0.5],
  brass: [0, 0.5, 0.5, 0.5], tin: [0.75, 0.5, 0.25, 0.5], pstone: [0, 0, 0.5, 0.5],
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
    if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
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
    asset: { version: '2.0', generator: 'game-studio art/tools/build-env-s3.mjs' },
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
    const M = MATS[m]; const wrap = !M.atlas;
    const mat = { name: M.name, extras: { ...M.extras } };
    if (M.color) mat.pbrMetallicRoughness = { baseColorFactor: [...srgbToLinear(M.color), M.alpha ?? 1], metallicFactor: M.metal ?? 0, roughnessFactor: M.rough ?? 1 };
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
  lods = lods.map((l) => {
    const r = a.uv2Planar ? planarUV2(l, a.uv2Planar[0] - origin[0], a.uv2Planar[1] - origin[2], a.uv2Planar[2], 2048) : addUV2(l, a.uv2Size ?? 1024);
    outlineColors(r); r.forEach(reorder); return r;
  });
  const placement = a.placement ?? { translation: origin, rotationY: 0 };
  const extras = { ...(a.extras ?? {}), placement, units: 'm', upAxis: '+Y', north: '+Z', east: '-X', scene: a.scene ?? 's3-first-watch-lighthouse' };
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
// S3 布局常量（015 白盒缺失 → 按 020 / 015 文字定的占位，写入 s3-layout.json placeholders）
//   角度 θ（度）在 XZ 平面从 +X（西）量起，逆时针：θ90 = 北（+Z）、θ180 = 东（-X）、θ270 = 南（-Z）
// =====================================================================================
const D2R = Math.PI / 180;
const polar = (r, th, y) => [r * Math.cos(th * D2R), y, r * Math.sin(th * D2R)];
const TOWER = {
  rBase: 4.0, rTop: 3.5, yTaper0: 0.95, yTop: 21.4, rIn: 3.0, foot: -1.6, plinthR: 4.15, plinthTop: 0.8, floorY: 0.2,
  corbelY0: 20.7, slabBot: 21.75, slabTop: 22.0, galR: 4.4, railR: 4.28,
  murIn: 3.0, murOut: 3.25, murTop: 22.7, lanR: 3.1, glassTop: 24.3, eaveTop: 24.42, domeTop: 25.0, ventTop: 25.32, vaneTop: 25.95,
};
const rOut = (y) => (y <= TOWER.yTaper0 ? TOWER.rBase : lerp(TOWER.rBase, TOWER.rTop, (y - TOWER.yTaper0) / (TOWER.yTop - TOWER.yTaper0)));
const rSurf = (y) => (y < TOWER.plinthTop ? TOWER.plinthR : y < TOWER.yTaper0 ? lerp(TOWER.plinthR, TOWER.rBase, (y - TOWER.plinthTop) / (TOWER.yTaper0 - TOWER.plinthTop)) : rOut(y));
// 螺旋楼梯：沿内壁 r 2.0–3.0（宽 1.0），每级 0.2 m、6°；第 k 级踏面顶 y = 0.2 + 0.2k；LAND = 加长成平台的级（额外角度）
const STAIR = { r0: 2.0, r1: 3.0, rise: 0.2, a: 6, n: 108, start: 152 };
const LAND = { 11: 20, 24: 22, 49: 30, 79: 30 };        // 返工 1029：第 24 级（y 5.0）加长成窗边小平台（28° ≈ 墙边弧长 1.47 / r2.5 处 1.22 m × 深 1.0 m）
const treadTop = (k) => TOWER.floorY + STAIR.rise * k;
function treadSpan(k) { let a = STAIR.start; for (let j = 1; j < k; j++) a += STAIR.a + (LAND[j] ?? 0); return [a, a + STAIR.a + (LAND[k] ?? 0)]; }
const FLOOR_ARRIVE = treadSpan(STAIR.n)[1];             // 第 109 级 = 灯室地面（y 22）的起点角
const HATCH = [(FLOOR_ARRIVE - 72) % 360, FLOOR_ARRIVE % 360]; // 灯室地面楼梯口（角度）= 最后 12 级上方：保证口下踏步净空 ≥ 2.1 m（返工 1029：随 y5 平台整体 +22°，原 [88,160]）
const DOOR = { th: 225, w: 1.1, y0: 2.4, y1: 4.6 };
const ARCH = { spring: 4.05 };                          // 020 打磨：门洞上部半圆拱（起拱线 4.05、半径 0.55、拱顶 4.6 = 原洞口顶）
const WWIN = { th: 0, w: 0.8, y0: 1.0, y1: 2.2 };       // 底层西窗：窗台 1.0（015），无玻璃无栅（天光要进来）
const mid = (k) => { const [a0, a1] = treadSpan(k); return ((a0 + a1) / 2) % 360; };
// 返工 1029：y 5.0 窗边平台的大窗（取代原 stair-window-1 小窗）。宽 0.8、窗台高出平台 0.9、高 1.5（普通小窗 0.45 × 0.8）。
// 朝向：平台只能在 θ310–338（世界朝东，见 README），窗取 θ320 = 世界方位约 93°（正东略偏南）——背离远处两座灯塔（175° / 215°）与 S2 白石（15°）。
const WIN5 = { k: 24, thOff: 10, w: 0.8, sill: 0.9, h: 1.5 };
const SWIN5 = { th: (treadSpan(WIN5.k)[0] + WIN5.thOff) % 360, w: WIN5.w, y0: treadTop(WIN5.k) + WIN5.sill, y1: treadTop(WIN5.k) + WIN5.sill + WIN5.h, k: WIN5.k, glass: true, platform: true };
const SWINS = [SWIN5].concat([38, 64, 92].map((k) => ({ th: mid(k), w: 0.45, y0: treadTop(k) + 0.95, y1: treadTop(k) + 1.75, k, glass: true }))
  .concat([49, 79].map((k) => ({ th: mid(k), w: 0.5, y0: treadTop(k) + 1.0, y1: treadTop(k) + 1.9, k, glass: true }))));
const OPENINGS = [{ ...DOOR, door: true }, { ...WWIN, west: true }, ...SWINS];
// 导光镜 / 点火口（015 名称；占位坐标）。镜子装在伸进楼梯井的铁臂末端（r 1.3），臂在镜子外侧（靠墙一侧），不挡来光
const MIR = {
  window: { th: 0, r: 2.35, seatTop: 1.0, center: [2.35, 1.35, 0] },
  a: { th: mid(49), r: 1.3, y: treadTop(49) + 0.6 },
  b: { th: mid(79), r: 1.3, y: treadTop(79) + 0.6 },
};
MIR.a.puzzle = 5; MIR.a.role = '导光镜 1'; MIR.a.node = 'guide-mirror-s3-mid-a'; MIR.b.puzzle = 5; MIR.b.role = '导光镜 2'; MIR.b.node = 'guide-mirror-s3-mid-b';
MIR.a.center = polar(MIR.a.r, MIR.a.th, MIR.a.y); MIR.b.center = polar(MIR.b.r, MIR.b.th, MIR.b.y);
const IGNITION = [0, 21.85, 0];
// 返工 1029：S3 世界坐标系（权威 = game/src/levels/s1/layout.ts 的 S3_WORLD_FRAME）。world = R_y(rotY)·local + pos（three.js R_y）
const S3_WORLD = { pos: [39.73, 0, -122.75], rotY: 2.35619, rotYDeg: 135, socketYInS1: 6.6 };
const s3ToLocal = ([x, y, z]) => { const dx = x - S3_WORLD.pos[0], dz = z - S3_WORLD.pos[2], c = Math.cos(S3_WORLD.rotY), s = Math.sin(S3_WORLD.rotY); return [dx * c - dz * s, y - S3_WORLD.pos[1], dx * s + dz * c]; };
const s3ToWorld = ([x, y, z]) => { const c = Math.cos(S3_WORLD.rotY), s = Math.sin(S3_WORLD.rotY); return [x * c + z * s + S3_WORLD.pos[0], y + S3_WORLD.pos[1], -x * s + z * c + S3_WORLD.pos[2]]; };
// 远处两座灯塔剪影（layout.ts 的世界坐标）→ S3 局部极角
const FAR_LH = [{ id: 'F1', world: [23.1, -0.5, -321.9] }, { id: 'F2', world: [142.9, -0.5, -268.5] }].map((f) => { const l = s3ToLocal(f.world); return { ...f, local: l.map((v) => +v.toFixed(2)), thDeg: +((Math.atan2(l[2], l[0]) / Math.PI * 180 + 360) % 360).toFixed(1), dist: +Math.hypot(l[0], l[2]).toFixed(1) }; });
const GAZE_TARGET = FAR_LH.reduce((a, b) => (a.dist < b.dist ? a : b));   // 眺望 = 较近的那座（F2）
// 点火拉杆（022；017 数据：Xi 局部 interact 在地面、面朝 +Z；pivot [0.15,0.74,0.55]；杆长 0.30；静止握点 [0.15,1.00,0.40]，绕 +X 拉 −60° → [0.15,0.74,0.25]）
// 放在点火口 +X 侧（纸条在 −X 侧 θ172）。汐站在 (1.45, 22, −0.15) 面朝 −X（朝灯机）。
const LEVER = { interact: [1.45, 22.0, -0.15], yaw: -Math.PI / 2, pivotXi: [0.15, 0.74, 0.55], gripRestXi: [0.15, 1.0, 0.4], gripPulledXi: [0.15, 0.74, 0.25], len: 0.3, pullDeg: -60, pullAxisLocal: '+X' };
LEVER.xiToWorld = (v) => { const c = Math.cos(LEVER.yaw), s = Math.sin(LEVER.yaw); return [LEVER.interact[0] + v[0] * c + v[2] * s, LEVER.interact[1] + v[1], LEVER.interact[2] - v[0] * s + v[2] * c]; };
LEVER.pivot = LEVER.xiToWorld(LEVER.pivotXi); LEVER.gripRest = LEVER.xiToWorld(LEVER.gripRestXi); LEVER.gripPulled = LEVER.xiToWorld(LEVER.gripPulledXi);
const LIGHT_PATH = [[9.5, 4.6, 0.6], MIR.window.center, MIR.a.center, MIR.b.center, IGNITION];
// 返工 1029（策划复核）：光路检查改为「打到点火口判定半径 0.3 m」。窗口镜双轴（光直达导光镜 1 镜心）；导光镜 1/2 单轴（竖轴），固定俯仰做进支架。
// 法线 n = (cos p·cos yaw, sin p, cos p·sin yaw)，yaw 从 +X 往 +Z 量；每面镜子的 yaw 取最优（游戏里由 15° 档 + 7.5° 精调的初始偏移保证可达）。
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mulv=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>mulv(a,1/Math.hypot(...a));
const DEG=Math.PI/180;
function lightPathHit({ W, A, B, T, pitchA, pitchB, radius = 0.3 }) {
  const nrm=(yaw,p)=>[Math.cos(p*DEG)*Math.cos(yaw*DEG),Math.sin(p*DEG),Math.cos(p*DEG)*Math.sin(yaw*DEG)];
  const refl=(d,n)=>sub(d,mulv(n,2*dot(d,n)));
  const plane=(o,d,c,n)=>{const t=dot(sub(c,o),n)/dot(d,n);return add(o,mulv(d,t))};
  const min1=(f,lo,hi)=>{let best=[1e9,0];for(let k=0;k<=3600;k++){const x=lo+(hi-lo)*k/3600,v=f(x);if(v<best[0])best=[v,x]}let [v,x]=best,h=(hi-lo)/3600;for(let it=0;it<60;it++){h*=0.7;for(const xx of[x-h,x+h]){const vv=f(xx);if(vv<v){v=vv;x=xx}}}return [v,x]};
  const dIn=norm(sub(A,W));
  // A：竖轴转，固定俯仰；选最优 yaw 让反射线在镜 B 平面上最靠近 B 心（B 的平面随 B 的 yaw，联合求）
  const solveB=(PB,dB)=>{const f=(y)=>{const n=nrm(y,pitchB);if(dot(dB,n)>=0)return 1e9;const r=refl(dB,n);if(r[1]<=0)return 1e9;const P=plane(PB,r,T,[0,1,0]);return Math.hypot(P[0]-T[0],P[2]-T[2])};return min1(f,-180,180)};
  const fA=(yA)=>{const n=nrm(yA,pitchA);if(dot(dIn,n)>=0)return [1e9];const dB=refl(dIn,n);// 打到 B：先用穿过 B 心的竖直平面近似 B 镜面（取 B 最优 yaw 后再迭代一次）
    const toB=sub(B,A);const t=dot(toB,dB);const close=add(A,mulv(dB,t));return [Math.hypot(...sub(close,B)),dB]};
  const [dA,yA]=min1((y)=>fA(y)[0],-180,180);const dB=fA(yA)[1];
  let PB=add(A,mulv(dB,dot(sub(B,A),dB)));let yB=0,miss=0;
  for(let it=0;it<4;it++){[miss,yB]=solveB(PB,dB);PB=plane(A,dB,B,nrm(yB,pitchB));}
  const nB=nrm(yB,pitchB),rB=refl(dB,nB),PT=plane(PB,rB,T,[0,1,0]);
  // 理想俯仰（镜面法线 = 出射 − 入射 的角平分）
  const idealA=norm(sub(norm(sub(B,A)),dIn)),idealB=norm(sub(norm(sub(T,PB)),dB));
  const r3=(v)=>+v.toFixed(3);
  return { perpMissAtB: r3(dA), pitchA, pitchB, yawA: r3(yA), yawB: r3(yB), offsetOnB: r3(Math.hypot(...sub(PB,B))), hitOnB: PB.map(r3), hitAtPort: PT.map(r3), missM: r3(Math.hypot(PT[0]-T[0],PT[2]-T[2])), radius, hit: Math.hypot(PT[0]-T[0],PT[2]-T[2])<=radius,
    idealPitchA: r3(Math.asin(idealA[1])/DEG), idealYawA: r3(Math.atan2(idealA[2],idealA[0])/DEG), idealPitchB: r3(Math.asin(idealB[1])/DEG), idealYawB: r3(Math.atan2(idealB[2],idealB[0])/DEG),
    segLen: [r3(Math.hypot(...sub(A,W))), r3(Math.hypot(...sub(PB,A))), r3(Math.hypot(...sub(PT,PB)))] };
}

const GUIDE_TILT = { a: -1.1, b: 4.4 };   // 导光镜 1（A）/ 导光镜 2（B）固定俯仰（度，+ = 法线上仰）。来源：015 策划解
const lpArgs = { W: MIR.window.center, A: MIR.a.center, B: MIR.b.center, T: IGNITION, radius: 0.3 };
const lpHit = lightPathHit({ ...lpArgs, pitchA: GUIDE_TILT.a, pitchB: GUIDE_TILT.b });
const lpHitAVertical = lightPathHit({ ...lpArgs, pitchA: 0, pitchB: GUIDE_TILT.b });
const lpRange = (key, fixed, lo, hi) => { let a = null, b = null; for (let q = lo; q <= hi + 1e-9; q += 0.05) { const r = lightPathHit({ ...lpArgs, pitchA: key === 'a' ? q : fixed, pitchB: key === 'b' ? q : fixed }); if (r.hit) { a ??= q; b = q; } } return [a == null ? null : +a.toFixed(2), b == null ? null : +b.toFixed(2)]; };
const lpTolerance = { pitchAWithB44: lpRange('a', GUIDE_TILT.b, -4, 2), pitchBWithA11: lpRange('b', GUIDE_TILT.a, 0, 9), pitchBWithA0: lpRange('b', 0, 0, 9) };
console.log('光路命中点火口（r 0.3）：', JSON.stringify(lpHit), '\n导光镜 1 按竖直：', JSON.stringify(lpHitAVertical), '\n容差：', JSON.stringify(lpTolerance));
// 门外平台 / 石桥（沿东南轴 s，横向 t）
const SE = { ux: -Math.SQRT1_2, uz: -Math.SQRT1_2, vx: Math.SQRT1_2, vz: -Math.SQRT1_2 }; // s 轴朝东南；t 轴朝西南
const seXZ = (s, t) => [SE.ux * s + SE.vx * t, SE.uz * s + SE.vz * t];
const PLAT = { s0: 3.3, s1: 7.6, t0: -2.4, t1: 2.4, top: 2.4 };
const BRIDGE = { s0: 8.5, s1: 33.0, w: 1.5, deck: 3.0, parapetW: 0.3, parapetH: 0.5, piers: [14.0, 19.5, 25.0], spring: 0.2, archR: 2.35 };

// =====================================================================================
// 通用：柱面网格（带开洞）、开洞侧壁、柱面贴花
// =====================================================================================
const ang = (a) => ((a % 360) + 360) % 360;
const angDiff = (a, b) => { const d = ang(a - b); return d > 180 ? d - 360 : d; };
function inOpening(th, y, r, ops, margin = 0) {
  for (const o of ops) { const hw = (o.w / 2 / r) / D2R + margin; if (Math.abs(angDiff(th, o.th)) < hw && y > o.y0 - margin * 0.02 && y < o.y1) return o; }
  return null;
}
// 柱面壳：rFn(y) 半径，angs/ys 断点（角度/高度），开洞内的格子跳过；inward = 法线朝内
function shell(rFn, angs, ys, ops, inward, mat, tile = MATS[mat]?.tile ?? 2.0, dr = 0) {
  const P = [], N = [], U = [], I = [];
  const A = [...new Set(angs.map((a) => +a.toFixed(4)))].sort((a, b) => a - b), Y = [...new Set(ys.map((y) => +y.toFixed(4)))].sort((a, b) => a - b);
  const slope = (y) => (rFn(y + 0.01) - rFn(y - 0.01)) / 0.02;
  for (let j = 0; j < Y.length - 1; j++) for (let i = 0; i < A.length - 1; i++) {
    const ac = (A[i] + A[i + 1]) / 2, yc = (Y[j] + Y[j + 1]) / 2;
    if (inOpening(ac, yc, rFn(yc), ops)) continue;
    const base = P.length / 3;
    for (const [a, y] of [[A[i], Y[j]], [A[i + 1], Y[j]], [A[i], Y[j + 1]], [A[i + 1], Y[j + 1]]]) {
      const r = rFn(y) + dr; P.push(...polar(r, a, y));
      const s = -slope(y), c = Math.cos(a * D2R), sn = Math.sin(a * D2R), l = Math.hypot(1, s), sg = inward ? -1 : 1;
      N.push(sg * c / l, sg * s / l, sg * sn / l); U.push(a * D2R * r / tile, y / tile);
    }
    // 外法线：(a0,y0)-(a0,y1)-(a1,y0) 的叉积朝外 → 逆时针看外面
    if (!inward) I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3); else I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return weld({ pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx: new Uint32Array(I), mat });
}
// 外法线自检：按到 Y 轴的径向判断，平均朝向不对就翻
function orientRadial(p, outward = true) {
  let s = 0; const a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < p.idx.length; t += 3) {
    a.fromArray(p.pos, p.idx[t] * 3); b.fromArray(p.pos, p.idx[t + 1] * 3); c.fromArray(p.pos, p.idx[t + 2] * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a)); const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3; s += e1.x * cx + e1.z * cz;
  }
  if ((s < 0) === outward) for (let t = 0; t < p.idx.length; t += 3) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; }
  return p;
}
// 035：orientRadial 只翻索引绕向、不动顶点法线 → 朝里的车削面（灯室矮墙内面 / 点火孔侧壁 / 穹顶内面）法线和绕向相反，
// 烘焙在石头里面采样（矮墙 lightmap ≈ 0 = 一圈黑洞）、点光 N·L < 0。这里让每个顶点法线跟它所在三角面的朝向一致（已一致的不动）
function alignNormals(p) {
  const acc = new Float32Array(p.nrm.length), a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < p.idx.length; t += 3) {
    a.fromArray(p.pos, p.idx[t] * 3); b.fromArray(p.pos, p.idx[t + 1] * 3); c.fromArray(p.pos, p.idx[t + 2] * 3);
    e1.subVectors(b, a).cross(e2.subVectors(c, a));
    for (let k = 0; k < 3; k++) { const v = p.idx[t + k] * 3; acc[v] += e1.x; acc[v + 1] += e1.y; acc[v + 2] += e1.z; }
  }
  for (let v = 0; v < p.nrm.length; v += 3) if (p.nrm[v] * acc[v] + p.nrm[v + 1] * acc[v + 1] + p.nrm[v + 2] * acc[v + 2] < 0) { p.nrm[v] *= -1; p.nrm[v + 1] *= -1; p.nrm[v + 2] *= -1; }
  return p;
}
const inwardLathe = (p) => alignNormals(orientRadial(p, false));
function quad4(a, b, c, d, mat, n) { // a-b-c-d 逆时针（从法线方向看）
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  const p = fromGeo(g, mat); if (n) for (let i = 0; i < 4; i++) p.nrm.set(n, i * 3); return p;
}
// 开洞侧壁（门窗洞的四个内侧面，平行侧边），从 rA 到 rB
function reveals(o, rAfn, rBfn, mat, opt = {}) {
  const parts = [], rA0 = rAfn(o.y0), rB0 = rBfn(o.y0), rA1 = rAfn(o.y1), rB1 = rBfn(o.y1);
  const edge = (r, y, s) => polar(Math.hypot(r, o.w / 2) , o.th + s * Math.atan2(o.w / 2, r) / D2R, y);
  const L = (s) => [edge(rA0, o.y0, s), edge(rB0, o.y0, s), edge(rB1, o.y1, s), edge(rA1, o.y1, s)];
  const l = L(-1), r = L(1);
  parts.push(quad4(l[0], l[1], l[2], l[3], mat), quad4(r[1], r[0], r[3], r[2], mat));     // 两侧
  parts.push(quad4(l[3], l[2], r[2], r[3], mat));                                            // 顶（过梁底面）
  if (!opt.noSill) parts.push(quad4(l[1], l[0], r[0], r[1], mat));                           // 窗台 / 门槛
  return parts.map((p) => { fixFacing(p, polar(1, o.th, (o.y0 + o.y1) / 2), o); return boxUV(p, MATS[mat]?.tile ?? 2, [0.37, 0.11]); });
}
// 侧壁法线应朝洞口中心轴
function fixFacing(p, _c, o) {
  const a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  a.fromArray(p.pos, p.idx[0] * 3); b.fromArray(p.pos, p.idx[1] * 3); c.fromArray(p.pos, p.idx[2] * 3);
  e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
  const ctr = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  const r = Math.hypot(ctr.x, ctr.z), axis = V3(...polar(r, o.th, (o.y0 + o.y1) / 2));
  const toAxis = axis.sub(ctr); toAxis.normalize();
  if (e1.dot(toAxis) < 0) for (let t = 0; t < p.idx.length; t += 3) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; }
  smoothNormals(p);
}
// 柱面贴花（风化图集）：中心角 th、宽 w（m）、从 yTop 往下 h（m）；u 横向 0..1、v 从上到下 0..1；inward = 室内墙
function cylDecal(reg, th, w, yTop, h, opt = {}) {
  const rF = opt.rFn ?? rSurf, off = opt.off ?? 0.012, nu = opt.nu ?? Math.max(2, Math.ceil(w / 0.5)), nv = opt.nv ?? Math.max(2, Math.ceil(h / 0.4));
  const ops = opt.ops ?? OPENINGS;
  const P = [], N = [], U = [], I = [];
  const topFn = opt.topFn ?? (() => yTop), botFn = opt.botFn ?? (() => yTop - h);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const cells = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
    const ptsAt = ([ii, jj]) => {
      const u = ii / nu, v = jj / nv, r0 = rF(yTop);
      const a = th + ((u - 0.5) * w / r0) / D2R, y = lerp(topFn(a), botFn(a), v), r = (opt.inward ? -off : off) + rF(y);
      return { a, y, r, u, v };
    };
    const q = cells.map(ptsAt);
    const ac = (q[0].a + q[3].a) / 2, yc = (q[0].y + q[3].y) / 2;
    if (inOpening(ac, yc, q[0].r, ops, 0.5)) continue;
    const base = P.length / 3;
    for (const c of q) { P.push(...polar(c.r, c.a, c.y)); const sg = opt.inward ? -1 : 1; N.push(sg * Math.cos(c.a * D2R), 0, sg * Math.sin(c.a * D2R)); U.push(...inReg(reg, opt.flipU ? 1 - c.u : c.u, c.v)); }
    I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  if (!I.length) return null;
  const p = { pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx: new Uint32Array(I), mat: 'weather' };
  return orientRadial(p, !opt.inward);
}
// 扇环实体（踏步、平台、楼板）：r0..r1、角 a0..a1（度）、y0..y1
function sector(r0, r1, a0, a1, y0, y1, mat, segA = null, opt = {}) {
  const n = segA ?? Math.max(1, Math.ceil((a1 - a0) / 6));
  const P = [], I = [];
  const ring = (r, y) => { for (let i = 0; i <= n; i++) P.push(...polar(r, lerp(a0, a1, i / n), y)); };
  ring(r0, y1); ring(r1, y1); ring(r0, y0); ring(r1, y0);
  const at = (q, i) => q * (n + 1) + i;
  const faces = [];
  for (let i = 0; i < n; i++) {
    faces.push([at(0, i), at(0, i + 1), at(1, i + 1), at(1, i)]);   // 顶
    faces.push([at(2, i), at(3, i), at(3, i + 1), at(2, i + 1)]);   // 底
    if (!opt.noInner) faces.push([at(0, i), at(2, i), at(2, i + 1), at(0, i + 1)]);   // 内侧
    if (!opt.noOuter) faces.push([at(1, i), at(1, i + 1), at(3, i + 1), at(3, i)]);   // 外侧
  }
  faces.push([at(0, 0), at(1, 0), at(3, 0), at(2, 0)], [at(0, n), at(2, n), at(3, n), at(1, n)]); // 两端
  for (const f of faces) I.push(f[0], f[1], f[2], f[0], f[2], f[3]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  let p = fromGeo(g.toNonIndexed(), mat);
  // 统一朝外：以实体中心为参照
  const c = V3(...polar((r0 + r1) / 2, (a0 + a1) / 2, (y0 + y1) / 2));
  const a = V3(), b = V3(), cc = V3(), e1 = V3(), e2 = V3();
  for (let t = 0; t < p.idx.length; t += 3) {
    a.fromArray(p.pos, p.idx[t] * 3); b.fromArray(p.pos, p.idx[t + 1] * 3); cc.fromArray(p.pos, p.idx[t + 2] * 3);
    e1.subVectors(b, a).cross(e2.subVectors(cc, a)); const m = a.clone().add(b).add(cc).multiplyScalar(1 / 3).sub(c);
    // 弧形面用径向判断更稳
    if (e1.dot(m) < 0) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; }
  }
  p = fromGeo(toGeo(p).toNonIndexed(), mat); // 面法线
  return boxUV(p, MATS[mat]?.tile ?? 2.0, opt.uvOff ?? [0, 0]);
}
function toGeo(p) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3)); g.setIndex([...p.idx]); g.computeVertexNormals(); return g; }
let IRON_REG = 'iron';   // 外观 / 门扇 / 灯室穹顶内面临时切到 'ironDark'
const ironize = (p, uScale = 4) => { for (let i = 0; i < p.uv.length; i += 2) { const [u, v] = inReg(IRON_REG, Math.abs(p.uv[i] * uScale) % 1, clamp(Math.abs(p.uv[i + 1]) % 1, 0, 1)); p.uv[i] = u; p.uv[i + 1] = v; } return p; };
const ironBox = (w, h, d, m) => ironize(xform(fromGeo(new THREE.BoxGeometry(w, h, d), 'wood'), m), 1);
const ironCyl = (r, h, m, seg = 8) => ironize(xform(fromGeo(new THREE.CylinderGeometry(r, r, h, seg), 'wood'), m), 1);
function ironTube(pts, r, seg, rad = 6) { return ironize(tubePart(pts, r, seg, rad, 'wood'), 1); }
// 径向对齐：局部 +X 指向外（θ 方向）
const radial = (r, th, y) => mul(T(...polar(r, th, y)), RY(-th * D2R));

// =====================================================================================
// 通用小件
// =====================================================================================
// 旋转体：u = 弧长 / tile、v = y / tile（与 S1 塔身同一种贴法）
function latheW(prof, seg, mat, tile = MATS[mat]?.tile ?? 2.0) {
  const p = lathePart(prof, seg, mat);
  for (let i = 0; i < p.pos.length / 3; i++) { const r = Math.hypot(p.pos[i * 3], p.pos[i * 3 + 2]); p.uv[i * 2] = p.uv[i * 2] * Math.PI * 2 * Math.max(r, 0.3) / tile; p.uv[i * 2 + 1] = p.pos[i * 3 + 1] / tile; }
  return p;
}
const latheIron = (prof, seg, us = 6) => ironize(lathePart(prof, seg, 'wood'), us);
// 水平环面（annulus）：r0..r1、y、角度 a0..a1；up = 法线朝上
function annulus(r0, r1, y, mat, seg = 96, up = true, a0 = 0, a1 = 360, tile = MATS[mat]?.tile ?? 2.0) {
  const p = grid(seg, 1, (u, v) => polar(lerp(r0, r1, v), lerp(a0, a1, u), y), mat);
  if (up) orientUp(p); else { orientUp(p); for (let t = 0; t < p.idx.length; t += 3) { const q = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = q; } smoothNormals(p); }
  for (let i = 0; i < p.pos.length / 3; i++) { p.uv[i * 2] = p.pos[i * 3] / tile; p.uv[i * 2 + 1] = p.pos[i * 3 + 2] / tile; }
  return p;
}
const asMat = (p, m) => { p.mat = m; return p; };
// 角度范围碰撞盒（弦长近似）
function colArc(r0, r1, a0, a1, y0, y1) {
  const am = (a0 + a1) / 2, half = (a1 - a0) / 2 * D2R, rm = (r0 + r1) / 2;
  const chord = 2 * r1 * Math.sin(half) + 0.04, cx = Math.cos(half) * rm;
  const p = colBox(0, 0, 0, r1 - r0, y1 - y0, chord);
  return xform(p, mul(T(...polar(cx, am, (y0 + y1) / 2)), RY(-am * D2R)));
}
// 环形碰撞（segs 段，减去 cut 角度区间 [[a0,a1],...]）
function colRing(r0, r1, y0, y1, segs = 32, cuts = []) {
  const out = [];
  for (let i = 0; i < segs; i++) {
    let pieces = [[i * 360 / segs, (i + 1) * 360 / segs]];
    for (const [c0, c1] of cuts) pieces = pieces.flatMap(([a, b]) => { const o = []; const A = Math.max(a, c0), B = Math.min(b, c1); if (A >= B) return [[a, b]]; if (A > a + 0.5) o.push([a, A]); if (b > B + 0.5) o.push([B, b]); return o; });
    for (const [a, b] of pieces) out.push(colArc(r0, r1, a, b, y0, y1));
  }
  return out;
}
const opCut = (o, r) => { const hw = Math.atan2(o.w / 2, r) / D2R; return [o.th - hw, o.th + hw]; };

// =====================================================================================
// env-lighthouse-ch1：灯塔外观（塔身、门窗洞、回廊、铁栏、灯笼玻璃、穹顶、风化贴花）
// =====================================================================================
function buildExterior() {
  const parts = [], R = rng(2001);
  const tw = TOWER;
  IRON_REG = 'ironDark';
  // 塔基（刷白石砌，略外扩的底座 + 倒角）
  parts.push(orientRadial(latheW([[tw.plinthR + 0.05, tw.foot], [tw.plinthR, tw.foot + 0.3], [tw.plinthR, tw.plinthTop], [tw.rBase, tw.yTaper0]], 96, 'white')));
  // 塔身外壳（开门窗洞）
  const angs = [...Array(97).keys()].map((i) => i * 360 / 96), ys = [tw.yTaper0];
  for (let y = 1.5; y < tw.corbelY0 + 0.4; y += 0.5) ys.push(y); ys.push(tw.corbelY0 + 0.45);
  for (const o of OPENINGS) { const r = rOut((o.y0 + o.y1) / 2); angs.push(...opCut(o, r)); ys.push(o.y0, o.y1); }
  parts.push(orientRadial(shell(rOut, angs, ys, OPENINGS, false, 'white')));
  // 门窗洞侧壁（墙厚 0.5–1.0 m）
  for (const o of OPENINGS) parts.push(...reveals(o, () => tw.rIn, (y) => rOut(y), 'white'));
  // 门套（020 打磨）：圆拱门洞 = 矩形洞口上角用拱肩石填死（贯穿墙厚）+ 外面一圈拱石（9 块 + 拱心石）+ 两侧门柱石到起拱线；顶上小铭牌石
  {
    const o = DOOR, r = rOut(3.5) + 0.05, hwT = o.w / 2 + 0.16, ySpr = ARCH.spring, ra = o.w / 2, RB = rng(2201);
    const blk = (w, h, d, seed, m, off) => parts.push(boxUV(xform(asMat(stoneBlock(w, h, d, 0.035, seed, 0.009), 'white'), m), 5, off));
    // 门柱：每侧 3 块错缝（长短交替）
    for (const s of [-1, 1]) {
      let y = o.y0 - 0.02; const hs = [0.62, 0.48, ySpr - o.y0 - 1.08 + 0.02];
      hs.forEach((h, k) => { const wd = k % 2 ? 0.3 : 0.38; blk(0.18, h - 0.015, wd, 11 + s * 3 + k, mul(radial(r + (k % 2 ? 0 : 0.01), o.th, y + h / 2), T(0, 0, s * (ra + wd / 2 + 0.005))), [RB(), RB()]); y += h; });
    }
    // 拱肩填石：形状 = 半宽 ra、高 ra 的矩形 − 半圆；沿径向从 rIn 挤出到墙外
    const sh = new THREE.Shape();
    sh.moveTo(-ra - 0.01, 0); sh.lineTo(-ra - 0.01, o.y1 - ySpr + 0.01); sh.lineTo(ra + 0.01, o.y1 - ySpr + 0.01); sh.lineTo(ra + 0.01, 0); sh.lineTo(ra, 0);
    sh.absarc(0, 0, ra, 0, Math.PI, false); sh.lineTo(-ra - 0.01, 0);
    const r0 = TOWER.rIn + 0.002, r1 = rOut(ySpr) + 0.012;
    const eg = new THREE.ExtrudeGeometry(sh, { depth: r1 - r0, bevelEnabled: false, curveSegments: 20 });
    // Extrude 的 +Z = 径向朝外：先绕 Y 转 +90°（x' = z, z' = −x），再放到 radial(r0, θ, 起拱线)
    let sp = fromGeo(eg.toNonIndexed(), 'white'); sp = xform(sp, mul(radial(r0, o.th, ySpr), RY(Math.PI / 2)));
    parts.push(boxUV(sp, MATS.white.tile, [0.3, 0.1]));
    // 拱石：11 块（中间一块是拱心石，略大、略凸出）
    const NV = 9, rm = ra + 0.19;
    for (let k = 0; k < NV; k++) {
      const ph = Math.PI * (k + 0.5) / NV, key = k === (NV - 1) / 2;
      const len = key ? 0.46 : 0.36 + RB() * 0.05, arc = Math.PI * rm / NV - 0.012;
      const b = asMat(stoneBlock(key ? 0.24 : 0.2, len, key ? arc * 1.2 : arc, 0.03, 61 + k, 0.008), 'white');
      for (let q = 0; q < b.pos.length; q += 3) b.pos[q + 2] *= (rm + b.pos[q + 1]) / rm;   // 楔形：外宽内窄，块间不留三角缝
      parts.push(boxUV(xform(b, mul(radial(r + (key ? 0.03 : 0.01 * RB()), o.th, ySpr), T(0, rm * Math.sin(ph) + (key ? 0.04 : 0), rm * Math.cos(ph)), RX(Math.PI / 2 - ph))), 5, [RB(), RB()]));
    }
    blk(0.08, 0.42, 0.7, 23, radial(rOut(5.3) + 0.03, o.th, 5.35), [0.4, 0.4]);
    // 门槛石：两块，磨圆、中间踩凹
    for (const s of [-1, 1]) {
      const b = asMat(stoneBlock(0.55, 0.2, (o.w + 0.5) / 2 - 0.01, 0.05, 29 + s, 0.012), 'white');
      for (let q = 0; q < b.pos.length; q += 3) if (b.pos[q + 1] > 0.05) b.pos[q + 1] -= 0.025 * Math.exp(-((b.pos[q + 2] + s * 0.2) ** 2) / 0.05) * (1 - Math.abs(b.pos[q]) / 0.3);
      smoothNormals(b); parts.push(boxUV(xform(b, mul(radial(rOut(2.4) + 0.2, o.th, 2.3), T(0, 0, s * ((o.w + 0.5) / 4)))), 10, [0.7 + s * 0.2, 0.2]));
    }
  }
  // 窗：外窗台石（略挑出）+ 铁窗框 + 玻璃（西窗无玻璃：天光要进来）
  for (const o of OPENINGS) {
    if (o.door) continue;
    const r = rOut(o.y0), sill = asMat(stoneBlock(0.18, 0.08, o.w + 0.22, 0.02, 31 + o.th, 0.004), 'white');
    parts.push(boxUV(xform(sill, radial(r + 0.04, o.th, o.y0 - 0.04)), 2, [o.th * 0.01, 0.3]));
    if (!o.glass) continue;
    const rg = rOut((o.y0 + o.y1) / 2) - 0.12, ym = (o.y0 + o.y1) / 2, h = o.y1 - o.y0, w = o.w;
    const F = (m) => mul(radial(rg, o.th, ym), m);
    parts.push(ironBox(0.04, h, 0.04, F(T(0, 0, -w / 2 + 0.02))), ironBox(0.04, h, 0.04, F(T(0, 0, w / 2 - 0.02))), ironBox(0.04, 0.04, w, F(T(0, h / 2 - 0.02, 0))), ironBox(0.04, 0.04, w, F(T(0, -h / 2 + 0.02, 0))));
    parts.push(ironBox(0.03, h, 0.025, F(T(0, 0, 0))), ironBox(0.03, 0.025, w, F(T(0, 0, 0))));
    for (const s of [1, -1]) {
      const g = grid(1, 1, (u, v) => { const q = V3(0, (v - 0.5) * h, (u - 0.5) * w).applyMatrix4(F(T(s * 0.004, 0, 0))); return [q.x, q.y, q.z]; }, 'weather', s < 0);
      for (let i = 0; i < 4; i++) { const [uu, vv] = inReg('glass', g.uv[i * 2], g.uv[i * 2 + 1]); g.uv[i * 2] = uu; g.uv[i * 2 + 1] = vv; }
      parts.push(g);
    }
  }
  // 回廊托檐（叠涩线脚，020 打磨：挑出到 4.75）+ 24 个托石（加长）
  parts.push(orientRadial(latheW([[rOut(20.45) - 0.01, 20.45], [3.62, 20.45], [3.64, 20.74], [3.88, 20.84], [3.95, 21.12], [4.24, 21.22], [4.3, 21.5], [4.64, 21.58], [tw.galR, tw.slabBot]], 96, 'white')));
  for (let i = 0; i < 24; i++) {
    const th = i * 15 + 7.5, W = 0.98, b = asMat(stoneBlock(W, 0.56, 0.26, 0.03, 41 + i, 0.008), 'white');
    for (let k = 0; k < b.pos.length; k += 3) { const t = clamp((0.28 - b.pos[k + 1]) / 0.56, 0, 1); b.pos[k] = b.pos[k] * (1 - 0.6 * t) - W / 2 * 0.6 * t; }
    smoothNormals(b);
    parts.push(boxUV(xform(b, radial(4.2, th, 21.46)), 10, [i * 0.13, 0.4]));
  }
  // 回廊地面（y 22.0，与灯室地面同高）+ 檐口滴水线
  parts.push(orientRadial(latheW([[tw.galR, tw.slabBot], [tw.galR + 0.03, tw.slabBot + 0.04], [tw.galR + 0.03, tw.slabTop - 0.03], [tw.galR, tw.slabTop]], 96, 'white')));
  parts.push(annulus(tw.murOut, tw.galR, tw.slabTop, 'white', 96, true));
  // 回廊铁栏（深铁）：48 根方立柱 + 扶手（扁铁）+ 两道横栏 + 底脚板
  for (let i = 0; i < 48; i++) parts.push(ironBox(0.045, 1.04, 0.045, mul(T(...polar(tw.railR, i * 7.5 + 3.75, 22.52)), RY(-(i * 7.5 + 3.75) * D2R))));
  parts.push(orientRadial(latheIron([[tw.railR - 0.045, 23.02], [tw.railR - 0.045, 23.08], [tw.railR + 0.045, 23.08], [tw.railR + 0.045, 23.02], [tw.railR - 0.045, 23.02]], 144, 1)));
  for (const [y, rr] of [[22.66, 0.022], [22.3, 0.022]]) parts.push(ironize(xform(fromGeo(new THREE.TorusGeometry(tw.railR, rr, 6, 144), 'wood'), mul(T(0, y, 0), RX(Math.PI / 2))), 8));
  parts.push(orientRadial(latheIron([[tw.railR + 0.012, tw.slabTop], [tw.railR + 0.012, tw.slabTop + 0.09]], 144, 1)));
  // 灯笼矮墙（外面刷白）+ 铁窗台（加厚）
  parts.push(orientRadial(latheW([[tw.murOut, tw.slabTop], [tw.murOut, tw.murTop - 0.09]], 96, 'white')));
  parts.push(orientRadial(latheIron([[3.28, tw.murTop - 0.1], [3.36, tw.murTop - 0.06], [3.36, tw.murTop + 0.03]], 96)));
  parts.push(ironize(annulus(tw.murIn - 0.02, 3.36, tw.murTop + 0.03, 'wood', 96, true), 1));
  // 灯笼：12 面玻璃 + 粗立梃 + 三道横档
  const NF = 12, RL = tw.lanR, chord = 2 * RL * Math.sin(Math.PI / NF), y0g = tw.murTop + 0.02, y1g = tw.glassTop;
  for (let i = 0; i < NF; i++) {
    const a = i * 30, am = a + 15, rApo = RL * Math.cos(Math.PI / NF);
    parts.push(ironBox(0.17, y1g - y0g, 0.15, mul(T(...polar(RL + 0.01, a, (y0g + y1g) / 2)), RY(-a * D2R))));
    parts.push(ironBox(0.06, y1g - y0g, 0.2, mul(T(...polar(RL + 0.1, a, (y0g + y1g) / 2)), RY(-a * D2R))));   // 立梃外侧压条
    for (const [yb, hh] of [[y0g + 0.05, 0.1], [(y0g + y1g) / 2 + 0.1, 0.08], [y1g - 0.05, 0.1]]) parts.push(ironBox(0.1, hh, chord, mul(T(...polar(rApo + 0.01, am, yb)), RY(-am * D2R))));
    for (const s of [1, -1]) {
      const g = grid(1, 1, (u, v) => polar(rApo + s * 0.003, am + (u - 0.5) * 30 * (rApo / RL) * 1.0, lerp(y0g, y1g, v)), 'weather', s < 0);
      for (let k = 0; k < 4; k++) { const u = g.uv[k * 2], v = g.uv[k * 2 + 1]; const P = polar(RL + s * 0.003, a + u * 30, lerp(y0g, y1g, v)); g.pos.set(P, k * 3); }
      orientRadial(g, s > 0); smoothNormals(g);
      for (let k = 0; k < 4; k++) { const [uu, vv] = inReg('glass', g.uv[k * 2], 1 - g.uv[k * 2 + 1]); g.uv[k * 2] = uu; g.uv[k * 2 + 1] = vv; }
      parts.push(g);
    }
  }
  // 檐口（加厚）+ 穹顶 + 12 道肋 + 通风球 + 风向标（高度不变）
  parts.push(latheIron([[3.12, y1g - 0.06], [3.46, y1g - 0.02], [3.5, tw.eaveTop], [3.2, tw.eaveTop + 0.02]], 96));
  const dome = [[3.2, tw.eaveTop + 0.02], [2.7, 24.6], [2.0, 24.77], [1.2, 24.91], [0.6, 24.98], [0.33, tw.domeTop]];
  parts.push(latheIron(dome, 96, 4));
  for (let i = 0; i < 12; i++) parts.push(ironTube(dome.map(([r, y]) => polar(r + 0.025, i * 30, y + 0.025)), 0.04, 16, 6));
  parts.push(latheIron([[0.33, tw.domeTop], [0.35, 25.06], [0.31, 25.16], [0.22, 25.25], [0.1, 25.31], [0.001, tw.ventTop]], 32));
  parts.push(ironCyl(0.025, tw.vaneTop - tw.ventTop, T(0, (tw.vaneTop + tw.ventTop) / 2, 0), 6));
  parts.push(ironize(xform(fromGeo(new THREE.SphereGeometry(0.055, 8, 6), 'wood'), T(0, tw.vaneTop, 0)), 1));
  parts.push(ironBox(0.9, 0.035, 0.02, mul(T(0, 25.78, 0), RY(0.6))), ironBox(0.26, 0.2, 0.012, mul(T(0, 25.78, 0), RY(0.6), T(-0.36, 0, 0))));
  parts.push(ironize(xform(fromGeo(new THREE.ConeGeometry(0.06, 0.16, 4), 'wood'), mul(T(0, 25.78, 0), RY(0.6), T(0.48, 0, 0), RZ(-Math.PI / 2))), 1));
  IRON_REG = 'iron';

  // ---- 风化贴花（mat-env-lighthouse-weather，墙外 1.2–2 cm）
  const dec = (p) => { if (p) parts.push(p); };
  // 塔基返潮污渍（全周，16 块横向接缝）→ 再叠藻带：迎浪（西）一侧高到 y≈3.8，背浪（东）≈1.3；底边在退潮线下
  const wind = (a) => 0.5 + 0.5 * Math.cos((a - 350) * D2R);
  for (let i = 0; i < 16; i++) {
    const th = i * 22.5 + 11.25, rr = rSurf(3);
    dec(cylDecal('grime', th, 22.5 * D2R * rr + 0.01, 7, 7.6, { nu: 6, nv: 14, off: 0.011, topFn: (a) => 5.0 + 2.8 * wind(a) + 0.7 * Math.sin(a * D2R * 5), botFn: () => 0.3 }));
  }
  for (let i = 0; i < 8; i++) {
    const th = i * 45 + 22.5, rr = rSurf(2.6);
    dec(cylDecal('algae', th, 45 * D2R * rr, 3.8, 4.4, { nu: 10, nv: 12, off: 0.014, topFn: (a) => 1.6 + 2.6 * wind(a) + 0.5 * Math.sin(a * D2R * 7), botFn: () => -0.6 }));
  }
  // 锈流痕（深褐、长）：每扇窗下两道 + 回廊托檐下 40 道（铁栏的锈水顺托檐流下）+ 门拱 / 铭牌下
  let k = 0;
  for (const o of [...SWINS, WWIN]) for (const s of [-0.3, 0.25]) dec(cylDecal('rust', o.th + s * o.w / rOut(o.y0) / D2R + (R() - 0.5) * 2, 0.35 + R() * 0.2, o.y0 - 0.05, 2.5 + R() * 3.5, { off: 0.016 + (k++ % 3) * 0.002, nu: 2, nv: 8 }));
  for (let i = 0; i < 36; i++) dec(cylDecal('rust', i * 10 + R() * 8, 0.4 + R() * 0.6, 20.45, 3 + R() * 12, { off: 0.016 + (i % 4) * 0.0015, nu: 2, nv: 12 }));
  for (const s of [-1, 1]) dec(cylDecal('rust', DOOR.th + s * 9.5, 0.4, ARCH.spring + 0.5, 2.6, { off: 0.024, nu: 2, nv: 5, ops: [] }));
  dec(cylDecal('rust', DOOR.th + 1.5, 0.3, 5.12, 0.25, { off: 0.024, nu: 2, nv: 2, ops: [] }));
  // 大片水渍（灰）、塔基缝里的苔
  for (let i = 0; i < 22; i++) dec(cylDecal('stain', R() * 360, 0.9 + R() * 1.3, 5 + R() * 15, 2.0 + R() * 4.0, { off: 0.013 + (i % 3) * 0.002, nu: 3, nv: 6 }));
  for (let i = 0; i < 18; i++) { const a = i < 6 ? DOOR.th + (R() - 0.5) * 50 : R() * 360; dec(cylDecal('moss', a, 0.45 + R() * 0.5, (i < 6 ? 2.9 : 0.9) + R() * (1.2 + 1.6 * wind(a)), 0.4 + R() * 0.5, { off: 0.019, nu: 3, nv: 2 })); }
  dec(cylDecal('stain', DOOR.th, 1.8, ARCH.spring + 1.05, 2.0, { off: 0.02, nu: 3, nv: 4, ops: [] }));
  // 门外平台 / 台阶上的湿斑（平贴，y + 1 cm；与礁岛 GLB 同原点，放在这里不给礁岛加材质）
  {
    const RW = rng(2301), wetAt = (s, t, y, sz, rot) => {
      const [x, z] = seXZ(s, t), g = grid(2, 2, (u, v) => { const lx = (u - 0.5) * sz[0], lz = (v - 0.5) * sz[1]; return [x + lx * Math.cos(rot) - lz * Math.sin(rot), y, z + lx * Math.sin(rot) + lz * Math.cos(rot)]; }, 'weather');
      orientUp(g); for (let q = 0; q < g.uv.length / 2; q++) { const [uu, vv] = inReg('wet', g.uv[q * 2], g.uv[q * 2 + 1]); g.uv[q * 2] = uu; g.uv[q * 2 + 1] = vv; }
      parts.push(g);
    };
    for (let i = 0; i < 9; i++) wetAt(PLAT.s0 + 0.9 + RW() * (PLAT.s1 - PLAT.s0 - 1.3), (RW() - 0.5) * 3.8, PLAT.top + 0.012 + i * 0.0006, [0.9 + RW() * 1.4, 0.7 + RW() * 1.0], RW() * 3);
    wetAt(rOut(2.4) + 0.75, 0, PLAT.top + 0.016, [1.4, 1.0], 0.4);   // 门口一大片（门槛下积水）
    for (let i = 1; i <= 3; i++) wetAt(PLAT.s1 - 0.3 + 0.3 * i - 0.12, (RW() - 0.5) * 0.6, PLAT.top + 0.2 * i + 0.012, [0.5, 0.9 + RW() * 0.4], Math.PI / 2 + (RW() - 0.5) * 0.4);
  }

  // ---- 碰撞：塔身环（门洞 / 西窗洞留空，西窗洞外加 -wall），回廊地面，灯笼
  const col = [], walls = [];
  const tiers = [[tw.foot, WWIN.y0], [WWIN.y0, WWIN.y1], [WWIN.y1, DOOR.y0], [DOOR.y0, DOOR.y1], [DOOR.y1, 11], [11, tw.yTop]];
  for (const [y0, y1] of tiers) {
    const cuts = OPENINGS.filter((o) => (o.door || o.west) && o.y0 < y1 - 0.01 && o.y1 > y0 + 0.01).map((o) => opCut(o, tw.rIn));
    col.push(...colRing(tw.rIn + 0.05, y1 <= tw.plinthTop + 0.3 ? tw.plinthR : rOut((y0 + y1) / 2) - 0.02, y0, y1, 32, cuts));
  }
  walls.push(colArc(rOut(1.6) - 0.15, rOut(1.6), ...opCut(WWIN, rOut(1.6)), WWIN.y0, WWIN.y1));
  col.push(...colRing(3.4, tw.galR, tw.corbelY0, tw.slabTop, 24));
  col.push(...colRing(tw.murIn, tw.murOut, tw.slabTop, tw.murTop, 24), ...colRing(3.02, 3.16, tw.murTop, tw.glassTop, 24));
  col.push(hull(dome.flatMap(([r, y]) => [0, 45, 90, 135, 180, 225, 270, 315].map((a) => polar(r, a, y)))));
  walls.push(...colRing(tw.railR - 0.04, tw.railR + 0.04, tw.slabTop, tw.slabTop + 1.1, 24));

  const dHinge = doorHinge();
  return finishAsset({
    name: 'env-lighthouse-ch1', parts, origin: [0, 0, 0], uv2Size: 2048, collider: colliderFrom(col), walls,
    extras: {
      ticket: 'v0.1-020', note: '初望灯塔外观。高 25.0 m（穹顶顶点；通风球与风向标到 25.95），塔基外半径 4.0、塔身顶 3.5、内半径 3.0。门朝东南（θ225，门槛 y 2.4，对门外平台），底层西窗（窗台 1.0）无玻璃。'
        + '迎浪的西侧塔基有湿痕与藻带。没有任何自发光，点火后的暖光由程序动态光做（见 lamp-light-origin 节点）。LOD2 同时作为 S1/S2 远景模型',
      farLod: { lod: 2, usedBy: ['s1-pier (env-lighthouse-island-main 的塔可换成它，见 build-env-s1.mjs --s3tower)', 's2-keeper-house 远景'] },
      fog: { layer: 'mid', density: 0.0045 },
      doorFile: 'models/env/env-lighthouse-ch1-door.glb',
    },
    helpers: [
      { name: 'lighthouse-ch1-top', t: [0, tw.vaneTop, 0] },
      { name: 'lamp-light-origin', t: [0, 23.55, 0], extras: { forProgrammer: '灯室暖光 / 旋转光束的原点（动态光，点火前不亮）；镜头焦点', color: '#FFB25E', defaultOn: false } },
      { name: 'door-s3-hinge-socket', t: dHinge.t, r: quatLookY(dHinge.rotY), extras: { file: 'models/env/env-lighthouse-ch1-door.glb', note: '门扇枢轴（铰链线）。门向内开 0 → -100°' } },
      { name: 'west-window-outer', t: polar(rOut(1.6) + 0.05, WWIN.th, 1.6), extras: { note: '底层西窗外口中心（天光从西照入）', sillY: WWIN.y0, width: WWIN.w, top: WWIN.y1 } },
      ...SWINS.map((o, i) => ({ name: o.platform ? 'stair-window-5m' : `stair-window-${i + 1}`, t: polar(rOut(o.y0), o.th, (o.y0 + o.y1) / 2), extras: o.platform ? { tread: o.k, platformWindow: true, w: o.w, sillAbovePlatform: WIN5.sill, h: WIN5.h, note: '返工 1029：y 5.0 窗边平台的大窗（原 0.45 × 0.8 小窗）' } : { tread: o.k } })),
      { name: 'stair-platform-5m-view', t: polar(2.45, SWIN5.th, treadTop(WIN5.k)), r: quatLookY(Math.PI / 2 - SWIN5.th * D2R), extras: { platformY: treadTop(WIN5.k), span: treadSpan(WIN5.k), note: '返工 1029：y 5.0 窗边小平台站位（地面点，+Z 朝窗）。无文字、无交互；窗世界朝向约正东（见 README）' } },
    ],
  });
}
function doorHinge() {
  const rd = TOWER.rIn + 0.18, hw = 0.54, a = DOOR.th - Math.atan2(hw, rd) / D2R;
  return { t: polar(Math.hypot(rd, hw), a, DOOR.y0), rotY: -(DOOR.th + 90) * D2R };
}
// 门扇（独立文件，原点 = 铰链线底端；局部 +X 沿门宽、+Z 朝塔内）
function buildDoor() {
  // 020 打磨：圆拱顶厚木门（6 块竖板 + 背面 3 道横档）+ 外面重铁件：两道长铰链（端头开叉卷花）、拱顶铁箍、一排排铆钉、大门环
  const parts = [], W = 1.08, H = 2.18, n = 6, R = rng(77), ySp = ARCH.spring - DOOR.y0, ra = W / 2;
  const archY = (x) => ySp + Math.sqrt(Math.max(0, ra * ra - (x - ra) ** 2));
  const fit = (p, y0 = 1.2) => { for (let q = 0; q < p.pos.length; q += 3) { const x = p.pos[q], y = p.pos[q + 1]; if (y > y0) p.pos[q + 1] = y0 + (y - y0) * (archY(clamp(x, 0, W)) - 0.004 - y0) / (H - y0); } return p; };
  IRON_REG = 'ironDark';
  for (let i = 0; i < n; i++) {
    const w = W / n, p = plank(H, w - 0.006, 0.075, 'shed', { uLen: 2.4, uOff: R(), cup: 0.005 });
    parts.push(fit(xform(p, mul(T(w * (i + 0.5), H / 2, 0), RY(Math.PI / 2), RZ(Math.PI / 2)))));   // 10-30 修：板厚 0.075 朝 Z、板宽沿 X（原来只 RZ，板宽 0.174 朝 Z、板间露缝）
  }
  for (const y of [0.32, 0.98, 1.6]) { const p = plank(W - 0.04, 0.16, 0.045, 'shed', { uLen: 2.4, uOff: R() }); parts.push(xform(p, T(W / 2, y, 0.058))); }
  // 铰链（外面 z −）：长扁铁 + 端头分叉
  for (const y of [0.34, 1.42]) {
    parts.push(ironBox(0.86, 0.075, 0.014, T(0.43, y, -0.045)));
    for (const s of [-1, 1]) parts.push(ironBox(0.16, 0.03, 0.012, mul(T(0.9, y + s * 0.03, -0.045), RZ(s * 0.45))));
    parts.push(ironize(xform(fromGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 8), 'wood'), mul(T(0.98, y + 0.06, -0.045), RX(Math.PI / 2))), 1));
    parts.push(ironize(xform(fromGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 8), 'wood'), mul(T(0.98, y - 0.06, -0.045), RX(Math.PI / 2))), 1));
  }
  // 拱顶铁箍：贴着拱边一道扁铁
  { const pts = []; for (let k = 0; k <= 16; k++) { const a = Math.PI * k / 16; pts.push(V3(ra + (ra - 0.05) * Math.cos(a), ySp + (ra - 0.05) * Math.sin(a), -0.046)); }
    parts.push(ironTube([V3(W - 0.05, ySp - 0.25, -0.046), ...pts, V3(0.05, ySp - 0.25, -0.046)], 0.016, 22, 4)); }   // 10-30 修：弧从右（a = 0）到左，端点顺序对应（原来两腿交叉成 X）
  // 铆钉：铰链上 + 横档位置
  for (const y of [0.34, 1.42]) for (let x = 0.1; x < 0.84; x += 0.12) parts.push(ironize(xform(fromGeo(new THREE.SphereGeometry(0.014, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), 'wood'), mul(T(x, y, -0.052), RX(-Math.PI / 2))), 1));
  for (const y of [0.98]) for (let x = 0.09; x < W; x += W / 6) parts.push(ironize(xform(fromGeo(new THREE.SphereGeometry(0.014, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), 'wood'), mul(T(x, y, -0.04), RX(-Math.PI / 2))), 1));
  // 铰链轴（拱脚以下）+ 门环（带圆底座）
  parts.push(ironCyl(0.022, ySp - 0.1, T(0.012, (ySp - 0.1) / 2 + 0.04, 0), 6));
  parts.push(ironize(xform(fromGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.014, 10), 'wood'), mul(T(W - 0.16, 1.1, -0.044), RX(Math.PI / 2))), 1));
  parts.push(ironize(xform(fromGeo(new THREE.TorusGeometry(0.085, 0.014, 6, 18), 'wood'), mul(T(W - 0.16, 1.02, -0.06))), 1));
  IRON_REG = 'iron';
  const h = doorHinge();
  return finishAsset({
    name: 'env-lighthouse-ch1-door', parts, origin: [0, 0, 0], uv2Size: 256, collider: colliderFrom([colBox(W / 2, H / 2, 0, W, H, 0.08)]),
    placement: { translation: h.t.map((v) => +v.toFixed(4)), rotationY: +h.rotY.toFixed(6) },
    extras: { ticket: 'v0.1-020', note: '灯塔木门扇。原点在铰链线底端，向内开（绕 Y 转 0 → -100°）。挂在 env-lighthouse-ch1 的 door-s3-hinge-socket', originAt: 'hinge', openDeg: -100 },
    helpers: [{ name: 'door-handle', t: [W - 0.16, 1.05, -0.06] }],
  });
}

// =====================================================================================
// env-lighthouse-ch1-interior：底层机房、内壁、螺旋楼梯、两层平台与导光镜支架
// =====================================================================================
function buildInterior() {
  const parts = [], R = rng(3001), tw = TOWER;
  // 内壁（石砌，开洞与外观一致）
  const angs = [...Array(97).keys()].map((i) => i * 360 / 96), ys = [tw.floorY];
  for (let y = 0.5; y < tw.slabBot; y += 0.5) ys.push(y); ys.push(tw.slabBot);
  for (const o of OPENINGS) { angs.push(...opCut(o, tw.rIn)); ys.push(o.y0, o.y1); }
  parts.push(orientRadial(shell(() => tw.rIn, angs, ys, OPENINGS, true, 'masonry'), false));
  // 地面铺石（y 0.2）
  paving(parts, -3.15, 3.15, -3.15, 3.15, tw.floorY, 301, { thick: 0.16, skip: (x, z) => Math.hypot(x, z) > 3.25 });
  // 螺旋楼梯：悬挑石踏步（每级嵌进墙 5 cm、与上一级搭接 1°）
  for (let k = 1; k <= STAIR.n; k++) {
    const [a0, a1] = treadSpan(k), top = treadTop(k), land = !!LAND[k];
    parts.push(sector(STAIR.r0, STAIR.r1 + 0.05, a0 - 1.0, a1, top - (land ? 0.3 : 0.26), top, 'masonry', land ? Math.ceil((a1 - a0) / 4) : 2, { uvOff: [R(), R()] }));
  }
  // 内侧铁扶手：每级一根立柱 + 螺旋扶手（高 0.95）
  const railPts = [];
  for (let k = 1; k <= STAIR.n; k++) {
    const [a0, a1] = treadSpan(k), top = treadTop(k);
    const steps = Math.max(1, Math.round((a1 - a0) / 6));
    for (let s = 0; s < steps; s++) {
      const a = a0 + (s + 0.5) * (a1 - a0) / steps;
      parts.push(ironCyl(0.016, 0.95, T(...polar(2.06, a, top + 0.475)), 5));
      railPts.push(polar(2.06, a, top + 0.95 + (steps === 1 ? 0 : 0)));
    }
  }
  railPts.push(polar(2.06, FLOOR_ARRIVE - 3, 22.95));
  for (let i = 0; i < railPts.length - 1; i += 40) parts.push(ironTube(railPts.slice(i, Math.min(railPts.length, i + 41)), 0.024, Math.min(40, railPts.length - 1 - i) * 3, 6));
  // 导光镜支架：平台内缘立柱 → 水平铁臂伸进楼梯井（臂在镜子外侧，不挡来光 / 去光）+ 斜撑
  for (const m of [MIR.a, MIR.b]) {
    const L = 2.06 - (m.r + 0.17), rm = (2.06 + m.r + 0.17) / 2;
    parts.push(ironCyl(0.03, 1.1, T(...polar(2.06, m.th, m.y - 0.05)), 6));
    parts.push(ironBox(L, 0.06, 0.05, mul(radial(rm, m.th, m.y), T(0, 0, 0))));
    parts.push(ironBox(0.05, 0.22, 0.14, radial(m.r + 0.17, m.th, m.y)));
    const b0 = polar(m.r + 0.3, m.th, m.y - 0.03), b1 = polar(2.06, m.th, m.y - 0.5);
    parts.push(ironTube([b0, b1.map((v, i) => (b0[i] + v) / 2), b1], 0.018, 2, 5));
  }
  // 返工 1029：y 5.0 窗边平台上的旧木凳（无文字、无交互；在墙边 r 2.7，不进光路 r < 1.9）
  {
    const th = treadSpan(WIN5.k)[1] - 7, y = treadTop(WIN5.k), m = mul(T(...polar(2.68, th, y)), RY(-th * D2R + 0.35));
    parts.push(xform(plank(0.36, 0.3, 0.045, 'shed', { uLen: 1 }), mul(m, T(0, 0.425, 0))));
    for (const [lx, lz] of [[-0.14, -0.11], [0.14, -0.11], [-0.14, 0.11], [0.14, 0.11]]) parts.push(xform(plank(0.04, 0.04, 0.405, 'shed', { uLen: 1 }), mul(m, T(lx, 0.2025, lz))));
  }
  // 西窗镜石座（窗台 1.0 内侧，台面 1.0）
  {
    const b = stoneBlock(0.62, 0.8, 0.72, 0.035, 401, 0.006); parts.push(boxUV(xform(b, radial(MIR.window.r, MIR.window.th, 0.6)), 2, [0.3, 0.6]));
    const cap = stoneBlock(0.7, 0.08, 0.8, 0.02, 403, 0.004); parts.push(boxUV(xform(cap, radial(MIR.window.r, MIR.window.th, 0.96)), 2, [0.7, 0.1]));
  }
  // 机房：油箱 + 油管（箱 → 阀门座 → 沿墙上到灯室）+ 管卡；油阀本体是 022 道具
  const OIL = { th: 70, r: 2.9, y: 0.9 };
  const tankAt = polar(2.3, 40, 0);
  parts.push(latheIron([[0.001, 0.3], [0.4, 0.3], [0.44, 0.34], [0.44, 1.36], [0.4, 1.42], [0.12, 1.46], [0.12, 1.54], [0.001, 1.54]].map(([r, y]) => [r, y]), 24, 3).pos && xform(latheIron([[0.001, 0.3], [0.4, 0.3], [0.44, 0.34], [0.44, 1.36], [0.4, 1.42], [0.12, 1.46], [0.12, 1.54], [0.001, 1.54]], 24, 3), T(tankAt[0], 0, tankAt[2])));
  for (const [dx, dz] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) parts.push(ironBox(0.06, 0.12, 0.06, T(tankAt[0] + dx, 0.26, tankAt[2] + dz)));
  for (const y of [0.55, 1.15]) parts.push(ironize(xform(fromGeo(new THREE.TorusGeometry(0.445, 0.014, 4, 32), 'wood'), mul(T(tankAt[0], y, tankAt[2]), RX(Math.PI / 2))), 4));
  const pipe = [polar(2.3, 40, 1.2), polar(2.62, 44, 1.2), polar(2.93, 52, 1.05), polar(2.94, 62, 0.9), polar(2.94, OIL.th - 3, 0.9)];
  parts.push(ironTube(pipe, 0.022, 16, 6));
  parts.push(ironTube([polar(2.94, OIL.th + 3, 0.9), polar(2.94, OIL.th + 5, 1.1), polar(2.94, OIL.th + 5, 21.72)], 0.022, 60, 6));
  for (let y = 2.0; y < 21.5; y += 2.0) parts.push(ironBox(0.05, 0.06, 0.09, radial(2.965, OIL.th + 5, y)));
  // 木箱（机房角落）、值班簿小木架（门内平台旁墙上）
  { const c = plank(0.62, 0.55, 0.5, 'shed', { uLen: 2 }); parts.push(xform(c, mul(T(...polar(2.45, 300, 0.45)), RY(0.4)))); }
  { const c = plank(0.5, 0.45, 0.42, 'shed', { uLen: 2, uOff: 0.4 }); parts.push(xform(c, mul(T(...polar(2.3, 318, 0.41)), RY(1.3)))); }
  const LOG = { th: 206, y: 3.35 };
  parts.push(xform(plank(0.56, 0.3, 0.04, 'deck', { uLen: 2, uOff: 0.2 }), mul(radial(2.83, LOG.th, LOG.y), RY(Math.PI / 2))));
  for (const s of [-1, 1]) parts.push(ironBox(0.26, 0.04, 0.03, mul(radial(2.85, LOG.th, LOG.y - 0.1), T(0, 0, s * 0.22), RZ(0.7))));
  // 室内风化：涨潮线（y 1.6 处一道明显潮痕）、水渍、近地面苔
  for (let i = 0; i < 16; i++) { const th = i * 22.5 + 11.25; const p = cylDecal('tide', th, 22.5 * D2R * tw.rIn, 2.2, 2.0, { rFn: () => tw.rIn, inward: true, off: 0.012, nu: 6, nv: 6 }); if (p) parts.push(p); }
  for (let i = 0; i < 10; i++) { const p = cylDecal('stain', R() * 360, 0.8 + R() * 0.8, 4 + R() * 16, 1.5 + R() * 2.5, { rFn: () => tw.rIn, inward: true, off: 0.014 + (i % 3) * 0.002, nu: 3, nv: 5 }); if (p) parts.push(p); }
  for (let i = 0; i < 5; i++) { const p = cylDecal('moss', R() * 360, 0.7 + R() * 0.6, 0.75, 0.5, { rFn: () => tw.rIn, inward: true, off: 0.02, nu: 3, nv: 2 }); if (p) parts.push(p); }

  // ---- 碰撞
  const col = [], walls = [];
  for (const [y0, y1, cut] of [[tw.floorY, DOOR.y0, false], [DOOR.y0, DOOR.y1, true], [DOOR.y1, tw.slabBot, false]]) col.push(...colRing(tw.rIn, tw.rIn + 0.3, y0, y1, 32, cut ? [opCut(DOOR, tw.rIn)] : []));
  for (let i = 0; i < 16; i++) col.push(colArc(0, tw.rIn + 0.1, i * 22.5, (i + 1) * 22.5, tw.floorY - 0.3, tw.floorY));
  // 楼梯：每级一块斜坡凸包（踏面前缘连线，角色控制器不用跨台阶）
  const rampHull = (a0, a1, yA, yB) => {
    const pts = [], n = Math.max(1, Math.ceil((a1 - a0) / 8));
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n), y = lerp(yA, yB, i / n); for (const r of [STAIR.r0, STAIR.r1]) pts.push(polar(r, a, y), polar(r, a, y - 0.35)); }
    return hull(pts);
  };
  col.push(rampHull(STAIR.start - 6, STAIR.start, tw.floorY, treadTop(1)));
  for (let k = 1; k <= STAIR.n; k++) {
    const [a0, a1] = treadSpan(k), top = treadTop(k), nx = k < STAIR.n ? treadTop(k + 1) : tw.slabTop;
    if (LAND[k]) { col.push(rampHull(a0, a1 - 6, top, top)); col.push(rampHull(a1 - 6, a1, top, nx)); } else col.push(rampHull(a0, a1, top, nx));
    if (k >= 4) walls.push(colArc(1.96, 2.04, a0, a1, top, top + 1.15));
  }
  col.push(colArc(MIR.window.r - 0.3, MIR.window.r + 0.3, -6.5, 6.5, tw.floorY, 1.0));
  col.push(colBox(tankAt[0], 0.88, tankAt[2], 0.88, 1.2, 0.88, -40 * D2R));
  walls.push(colArc(tw.rIn - 0.05, tw.rIn + 0.4, ...opCut(WWIN, tw.rIn), WWIN.y0, WWIN.y1));

  const look = [0, 1.6, 0];
  const camFor = (c, from) => ({ t: from, r: quatLookAt(from, c) });
  const cW = camFor(MIR.window.center, [0.2, 2.5, -1.4]), cA = camFor(MIR.a.center, polar(2.4, MIR.a.th + 32, MIR.a.y + 1.0)), cB = camFor(MIR.b.center, polar(2.4, MIR.b.th - 32, MIR.b.y + 1.0));
  const crit = (prop, extra = {}) => ({ forPuzzle: prop, propPuzzleCritical: true, propTicket: 'v0.1-022', ...extra });
  return finishAsset({
    name: 'env-lighthouse-ch1-interior', parts, origin: [0, 0, 0], uv2Size: 2048, collider: colliderFrom(col), walls,
    extras: {
      ticket: 'v0.1-020',
      note: '灯塔内部：机房地面 y 0.2、内半径 3.0；涨潮水深 1.4 m（海水面 y 1.6，内墙有对应潮痕）。螺旋石阶沿内壁 r 2.0–3.0，每级 0.2 m、6°，共 108 级 + 灯室地面；'
        + '门内平台 = 第 11 级（y 2.4），平台 A = 第 49 级（y 10），平台 B = 第 79 级（y 16）。楼梯井中间是空的（r < 2.0），三段光路都在 r < 1.6 内。谜题 5 安装位都在这件里（插槽 extras propPuzzleCritical = 装上去的 022 道具才是 puzzleCritical；本件不标，按正常 LOD 切换，塔内距离近始终是 LOD0）',
      waterline: { low: 0.0, high: 1.6, floor: tw.floorY, radius: tw.rIn },
    },
    helpers: [
      { name: 'oil-valve-s3-socket', t: polar(OIL.r, OIL.th, OIL.y), r: quatLookY(-(OIL.th + 180) * D2R + Math.PI / 2), extras: crit('oil-valve-s3', { holdSec: 2, note: '阀门中心 y 0.9，贴墙；油管已接好' }) },
      { name: 'guide-mirror-s3-window-socket', t: [MIR.window.r, MIR.window.seatTop, 0], extras: crit('guide-mirror-s3-window', { axes: 2, stepDeg: 15, mirrorCenter: MIR.window.center }) },
      { name: 'guide-mirror-s3-mid-a-socket', t: MIR.a.center, extras: crit('guide-mirror-s3-mid-a', { axes: 1, puzzle: 5, role: '导光镜 1', fixedPitchDeg: GUIDE_TILT.a, solvedYawDeg: lpHit.yawA, platformY: treadTop(49), note: '铁臂末端枢轴；臂从外侧（靠墙）伸来' }) },
      { name: 'guide-mirror-s3-mid-b-socket', t: MIR.b.center, extras: crit('guide-mirror-s3-mid-b', { axes: 1, puzzle: 5, role: '导光镜 2', fixedPitchDeg: GUIDE_TILT.b, solvedYawDeg: lpHit.yawB, platformY: treadTop(79) }) },
      { name: 'guide-mirror-s3-window-cam', t: cW.t, r: cW.r, extras: { camera: true, fovDeg: 50, for: 'guide-mirror-s3-window' } },
      { name: 'guide-mirror-s3-mid-a-cam', t: cA.t, r: cA.r, extras: { camera: true, fovDeg: 55, for: 'guide-mirror-s3-mid-a' } },
      { name: 'guide-mirror-s3-mid-b-cam', t: cB.t, r: cB.r, extras: { camera: true, fovDeg: 55, for: 'guide-mirror-s3-mid-b' } },
      { name: 'logbook-s3-read', t: polar(2.8, LOG.th, LOG.y + 0.03), extras: { readPoint: true, note: '门内墙上的值班簿（小木架）' } },
      { name: 'look-up-point', t: look, extras: { note: '底层中心仰视：能看到两层平台、两只镜臂和顶上的点火口' } },
      { name: 'machine-room-water', t: [0, 1.6, 0], extras: { water: true, low: 0.0, high: 1.6, radius: tw.rIn, note: '机房海水面（程序做，随 uTideLevel）' } },
      { name: 'stair-bottom', t: polar(2.5, STAIR.start - 4, tw.floorY) },
      { name: 'stair-door-landing', t: polar(2.5, DOOR.th, treadTop(11)) },
      { name: 'platform-a', t: polar(2.5, MIR.a.th, treadTop(49)) },
      { name: 'platform-b', t: polar(2.5, MIR.b.th, treadTop(79)) },
      { name: 'stair-top', t: polar(2.5, FLOOR_ARRIVE - 4, treadTop(STAIR.n)) },
      ...LIGHT_PATH.map((p, i) => ({ name: `lightpath-${i}`, t: p, extras: { lightPath: true, order: i, note: ['西窗外天光入口（占位）', '底层窗口镜（谜题 5）', '导光镜 1（谜题 5，A，θ140 y 10.6）', '导光镜 2（谜题 5，B，θ350 y 16.6）', '点火口（判定半径 0.3）'][i] } })),
    ],
  });
}

// =====================================================================================
// env-lamp-room-ch1：灯室（地面 y 22、楼梯口、主灯机构、点火口、穹顶内面）
// =====================================================================================
// 木件（同 S2 build-env-s2.mjs 的 woodPiece）：c = 中心，size = [x, y, z]，grain = 纹理方向 'x' | 'y' | 'z'
function woodPiece(parts, c, size, reg, grain = 'x', rotY = 0, opt = {}) {
  const [sx, sy, sz] = size; let p, R;
  if (grain === 'x') { p = plank(sx, sz, sy, reg, { cup: 0, ...opt }); R = new THREE.Matrix4(); }
  else if (grain === 'z') { p = plank(sz, sx, sy, reg, { cup: 0, ...opt }); R = RY(-Math.PI / 2); }
  else { p = plank(sy, sz, sx, reg, { cup: 0, ...opt }); R = RZ(Math.PI / 2); }
  parts.push(xform(p, mul(T(...c), RY(rotY), R)));
  return p;
}
// 017 第 3 批：灯室书桌 + 椅子（结尾 xi-sit-write / xi-stand-gaze）。θ 从 +X 逆时针；u = 径向朝外，t = 切向（逆时针）
// 035：座高 0.45 → 0.40、桌高 0.75 → 0.68（汐 1.51 m；xi-sit-write 同步改）
const LAMP_FURN = { th: 315, deskR: 2.69, deskW: 0.9, deskD: 0.5, deskTop: 0.68, chairR: 2.22, seatTop: 0.40, gazeR: 2.55, gazeTh: GAZE_TARGET.thDeg };   // 返工 1029：gazeTh 290 → 朝远处灯塔 F2
function buildLampRoom() {
  const parts = [], tw = TOWER, Y = tw.slabTop, YB = tw.slabBot, HOLE = 0.22;
  const [h0, h1] = HATCH;
  // 石地板：上表面 / 下表面（楼梯口与中心点火孔开洞）+ 洞口侧面
  parts.push(annulus(HOLE, STAIR.r0, Y, 'masonry', 90, true), annulus(STAIR.r0, tw.rIn, Y, 'masonry', 75, true, h1, h0 + 360));
  parts.push(annulus(HOLE, STAIR.r0, YB, 'masonry', 90, false), annulus(STAIR.r0, tw.rIn, YB, 'masonry', 75, false, h1, h0 + 360));
  parts.push(orientRadial(latheW([[STAIR.r0, YB], [STAIR.r0, Y]].map(([r, y]) => [r, y]), 90, 'masonry'), true).pos ? (() => { const s = shell(() => STAIR.r0, [h0, h0 + 16, h0 + 32, h0 + 48, h1], [YB, Y], [], false, 'masonry'); return orientRadial(s, true); })() : null);
  for (const a of [h0, h1]) { const q = quad4(polar(STAIR.r0, a, YB), polar(tw.rIn, a, YB), polar(tw.rIn, a, Y), polar(STAIR.r0, a, Y), 'masonry'); fixFacing(q, null, { th: (h0 + h1) / 2, y0: YB, y1: Y }); parts.push(boxUV(q, 2)); }
  parts.push(inwardLathe(latheW([[HOLE, YB], [HOLE, Y]], 24, 'masonry')));
  // 点火口铁圈（从楼梯井仰视能看到）
  parts.push(latheIron([[HOLE, YB + 0.02], [0.34, YB - 0.02], [0.36, YB - 0.1], [0.3, YB - 0.14], [HOLE - 0.02, YB - 0.1]], 32));
  // 矮墙内面（刷白）
  parts.push(inwardLathe(latheW([[tw.murIn, Y], [tw.murIn, tw.murTop + 0.02]], 96, 'masonry')));
  // 穹顶内面
  IRON_REG = 'ironDark';   // 020 打磨：穹顶内面换匀色深铁（原迷彩铁纹在大面积上是噪点）
  parts.push(inwardLathe(latheIron([[3.1, tw.glassTop + 0.01], [3.15, tw.eaveTop - 0.02], [2.65, 24.57], [1.95, 24.74], [1.15, 24.88], [0.55, 24.95], [0.001, 24.97]], 96, 4)));
  IRON_REG = 'iron';
  // 楼梯口护栏（沿 r 2.0 弧 + 88° 一侧；160° 一侧是上楼口）
  const hr = [];
  for (let a = h0; a <= h1 - 10; a += 9) { parts.push(ironCyl(0.018, 1.0, T(...polar(STAIR.r0 - 0.05, a, Y + 0.5)), 5)); hr.push(polar(STAIR.r0 - 0.05, a, Y + 1.0)); }
  for (const r of [2.45, 2.9]) parts.push(ironCyl(0.018, 1.0, T(...polar(r, h0 - 0.5, Y + 0.5)), 5));
  parts.push(ironTube([polar(2.95, h0 - 0.5, Y + 1.0), polar(2.45, h0 - 0.5, Y + 1.0), polar(STAIR.r0 - 0.05, h0, Y + 1.0), ...hr.slice(1)], 0.024, 40, 6));
  // 主灯机构：铸铁底座 → 旋转台（滚轮）→ 透镜座；侧面钟表机匣
  parts.push(latheIron([[0.001, Y], [0.62, Y], [0.62, Y + 0.06], [0.42, Y + 0.12], [0.3, Y + 0.2], [0.27, Y + 0.5], [0.33, Y + 0.56], [0.62, Y + 0.62], [0.64, Y + 0.7], [0.56, Y + 0.74], [0.56, Y + 0.85], [0.001, Y + 0.85]], 40, 3));
  for (let i = 0; i < 8; i++) parts.push(ironize(xform(fromGeo(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), 'wood'), mul(T(...polar(0.6, i * 45 + 22.5, Y + 0.75)), RZ(Math.PI / 2))), 1));
  parts.push(ironBox(0.42, 0.36, 0.32, radial(0.45, 200, Y + 0.32)), ironCyl(0.012, 0.3, mul(T(...polar(0.69, 200, Y + 0.38)), RZ(Math.PI / 2)), 6));
  parts.push(ironize(xform(fromGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), 'wood'), mul(T(...polar(0.84, 200, Y + 0.38)), RZ(Math.PI / 2))), 1));
  // 纸条小铁盘（点火口旁地板上）
  parts.push(ironBox(0.3, 0.02, 0.22, mul(T(...polar(0.95, 172, Y + 0.012)), RY(0.3))));

  // ---- 017 第 3 批：书桌（靠西南矮墙）+ 椅子（面朝玻璃）。和 S2 二层书桌 / 椅子同一套做法（木件 + 车削桌腿），木材图集 beam / shed 区
  const LF = LAMP_FURN, fth = LF.th * D2R, fu = [Math.cos(fth), 0, Math.sin(fth)], fyaw = -fth - Math.PI / 2;   // fyaw：局部 −Z → 径向朝外
  const fAt = (r, dt, y) => [fu[0] * r - fu[2] * dt, y, fu[2] * r + fu[0] * dt];                                // 径向 r + 切向 dt
  { const sub = [], h = LF.deskTop, w = LF.deskW, d = LF.deskD;          // 局部：−Z = 朝外（墙），+Z = 朝里（椅子那边），X = 切向
    woodPiece(sub, [0, h - 0.02, 0], [w, 0.04, d], 'shed', 'x', 0, { uOff: 0.37 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = lathePart([[0.026, 0], [0.028, 0.08], [0.023, 0.3], [0.027, h - 0.15], [0.027, h - 0.04], [0.001, h - 0.04]], 8, 'wood');
      mapUVRegion(leg, 'beam', (x, y, z, u, v) => [u * 0.15 + (sx + 1) * 0.2, v * 0.7]); sub.push(xform(leg, T(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06))));
    }
    woodPiece(sub, [0, h - 0.075, -d / 2 + 0.06], [w - 0.16, 0.07, 0.02], 'beam', 'x'); woodPiece(sub, [0, h - 0.075, d / 2 - 0.06], [w - 0.16, 0.07, 0.02], 'beam', 'x');
    for (const sx of [-1, 1]) woodPiece(sub, [sx * (w / 2 - 0.06), h - 0.075, 0], [0.02, 0.07, d - 0.16], 'beam', 'z');
    woodPiece(sub, [-0.16, h - 0.078, d / 2 - 0.045], [0.34, 0.052, 0.012], 'shed', 'x', 0, { uOff: 0.71 });   // 抽屉面（偏左手边，不挡膝盖）
    sub.push(ironBox(0.07, 0.014, 0.018, T(-0.16, h - 0.078, d / 2 - 0.03)));
    const m = mul(T(...fAt(LF.deskR, 0, Y)), RY(fyaw)); for (const q of sub) parts.push(xform(q, m));
  }
  { const sub = [], st = LF.seatTop, sc = st - 0.0175, bt = st + 0.36;    // 椅子：座面上表面 0.40；局部 −Z = 坐着朝前（朝桌 / 玻璃）
    // 035：原来是成人高背梯式椅（座 0.45、背 0.91、背上三道横档 + 0.14 拉档，从背后看像梯子 / 高脚凳）→ 矮一点的厚实木椅：
    // 腿 0.042 粗、靠背只到 0.76（座面上 0.36），一道宽顶档 + 两根竖背条；拉档只在左右两侧（从背后看是端头，不再一层层横杠）
    woodPiece(sub, [0, sc, 0], [0.42, 0.035, 0.4], 'beam', 'x', 0, { uOff: 0.13 });
    for (const [sx, sz, hh] of [[-1, -1, sc], [1, -1, sc], [-1, 1, bt], [1, 1, bt]]) woodPiece(sub, [sx * 0.178, hh / 2, sz * 0.168], [0.042, hh, 0.042], 'beam', 'y');
    woodPiece(sub, [0, bt - 0.045, 0.17], [0.40, 0.09, 0.03], 'beam', 'x');                                   // 宽顶档（略压过两根后腿）
    for (const sx of [-1, 1]) woodPiece(sub, [sx * 0.065, (st + bt - 0.09) / 2, 0.172], [0.05, bt - 0.09 - st, 0.016], 'beam', 'y');   // 竖背条
    for (const sx of [-1, 1]) woodPiece(sub, [sx * 0.178, 0.15, 0], [0.026, 0.026, 0.3], 'beam', 'z');          // 左右侧拉档
    const m = mul(T(...fAt(LF.chairR, 0, Y)), RY(fyaw)); for (const q of sub) parts.push(xform(q, m));
  }

  const col = [], walls = [];
  for (let i = 0; i < 16; i++) { const a0 = i * 22.5, a1 = a0 + 22.5; col.push(colArc(HOLE, STAIR.r0, a0, a1, YB, Y)); }
  for (const [a0, a1] of [[h1, 270], [270, 360], [0, h0]]) for (let a = a0; a < a1; a += 20) col.push(colArc(STAIR.r0, tw.rIn + 0.05, a, Math.min(a + 20, a1), YB, Y));
  col.push(colBox(0, Y + 0.42, 0, 1.2, 0.85, 1.2), ...colRing(tw.murIn, tw.murOut, Y, tw.murTop, 24), ...colRing(3.02, 3.16, tw.murTop, tw.glassTop, 24));
  for (let a = h0; a < h1 - 8; a += 12) walls.push(colArc(STAIR.r0 - 0.09, STAIR.r0 - 0.01, a, Math.min(a + 12, h1 - 8), Y, Y + 1.1));
  walls.push(colArc(2.0, 3.0, h0 - 1.5, h0 + 0.5, Y, Y + 1.1));
  col.push(colBox(...fAt(LF.deskR, 0, Y + LF.deskTop / 2), LF.deskW, LF.deskTop, LF.deskD, fyaw), colBox(...fAt(LF.chairR, 0, Y + (LF.seatTop + 0.36) / 2), 0.45, LF.seatTop + 0.36, 0.45, fyaw));
  return finishAsset({
    name: 'env-lamp-room-ch1', parts, origin: [0, 0, 0], uv2Size: 1024, collider: colliderFrom(col), walls,
    extras: {
      ticket: 'v0.1-020',
      note: '灯室：地面 y 22.0（石板，厚 0.25），楼梯口在 θ' + HATCH.map(Math.round).join('–') + '；中心点火孔 r 0.22 朝下开进楼梯井，口下有铁圈。主灯机构 = 铸铁底座 + 旋转台 + 钟表机匣，透镜坐在 lens 座上（prop-fresnel-lens-ch1）。'
        + '没有任何自发光 / 光源，点火后的暖光与旋转光束全部由程序动态光做',
    },
    helpers: [
      { name: 'ignition-port-s3-socket', t: IGNITION, r: [1, 0, 0, 0], extras: { forPuzzle: 'ignition-port-s3', propPuzzleCritical: true, propTicket: 'v0.1-022', facing: '-Y', note: '开口朝下进楼梯井（节点 +Y 翻成 -Y）；光从导光镜 2（谜题 5）射上来' } },
      { name: 'fresnel-lens-socket', t: [0, Y + 0.85, 0], extras: { file: 'models/props/prop-fresnel-lens-ch1.glb', forceLod0: true, note: '透镜不是 puzzleCritical，但在灯室里要始终 LOD0：请程序在加载后对它调用运行时强制 LOD0 标记' } },
      { name: 'lamp-light-origin', t: [0, 23.55, 0], extras: { forProgrammer: '灯室暖光 / 旋转光束原点（动态光，点火前不亮）= 透镜焦点', color: '#FFB25E', defaultOn: false } },
      { name: 'ignite-lever-socket', t: LEVER.pivot.map((v) => +v.toFixed(3)), r: quatLookY(LEVER.yaw), extras: { propTicket: 'v0.1-022', forPuzzle: 'ignite-lever', originAt: 'lever-pivot', leverLen: LEVER.len, pullDeg: LEVER.pullDeg, pullAxis: '节点局部 +X', gripRest: LEVER.gripRest.map((v) => +v.toFixed(3)), gripPulled: LEVER.gripPulled.map((v) => +v.toFixed(3)), note: '返工 1029：点火拉杆枢轴（点火口 +X 侧，纸条对面）。节点 +Z = 汐面朝方向；静止杆向汐倾（握点高出枢轴 0.26、近 0.15），拉下 = 绕局部 +X 转 −60° 到水平朝汐。拉杆本体与底座属 022 道具' } },
      { name: 'ignite-lever-interact', t: LEVER.interact, r: quatLookY(LEVER.yaw), extras: { interact: true, anim: 'xi-ignite-lever', forPuzzle: 'ignite-lever', promptRadius: 1.8, promptHalfAngleDeg: 60, note: '返工 1029：拉杆交互点（地面，+Z 朝灯机 / 世界 −X）' } },
      { name: 'ignition-note-read', t: polar(0.95, 172, Y + 0.03), extras: { readPoint: true, note: '点火口旁的纸条（小铁盘上）' } },
      { name: 'lamp-room-arrive', t: polar(2.5, h1 + 8, Y), extras: { note: '楼梯上来落脚点' } },
      { name: 'lamp-room-desk-interact', t: fAt(LF.chairR, 0, Y + LF.seatTop + 0.3), r: quatLookY(Math.PI / 2 - fth), extras: { interact: true, note: '017 第 3 批：灯室书桌（结尾写日志）。交互提示点在椅子座面上方 0.3 m' } },
      { name: 'lamp-room-sit-write', t: fAt(LF.chairR, 0, Y), r: quatLookY(Math.PI / 2 - fth), extras: { anim: 'xi-sit-write', seatTop: LF.seatTop, deskTop: LF.deskTop, deskFrontAheadM: +(LF.deskR - LF.deskD / 2 - LF.chairR).toFixed(3), note: '汐坐姿 clip 的根节点放这里：地面上、椅子座面中心正下方，节点 +Z = 汐面朝方向（朝桌 / 玻璃）。xi-sit-write 的根 = 这个点，不要再加偏移' } },
      { name: 'lamp-room-journal-socket', t: fAt(LF.chairR + 0.38, 0, Y + LF.deskTop), r: quatLookY(Math.PI / 2 - fth), extras: { socket: '027 父亲日志（摊开，书脊沿切向）', note: '桌面上、汐正前方 0.38 m（离桌前沿 0.16 m）；+Z = 朝外（书的上沿朝玻璃）' } },
      { name: 'lamp-room-lantern-socket', t: fAt(LF.deskR - 0.05, -0.3, Y + LF.deskTop), r: quatLookY(Math.PI / 2 - fth), extras: { socket: '汐的风灯（坐下写字时放在桌面左手边）', note: '桌面左后角（汐的左手边）' } },
      { name: 'lamp-room-stand-gaze', t: polar(LF.gazeR, LF.gazeTh, Y), r: quatLookY(Math.PI / 2 - LF.gazeTh * D2R), extras: { anim: 'xi-stand-gaze', target: GAZE_TARGET.id, targetWorld: GAZE_TARGET.world, targetThDeg: GAZE_TARGET.thDeg, targetDistM: GAZE_TARGET.dist, note: '结尾眺望站位：矮墙内面前 0.45 m，+Z 朝外 = 朝远处灯塔剪影 ' + GAZE_TARGET.id + '（返工 1029，按 layout.ts 的 S3 世界坐标系 rot 135° 计算；原 θ290 占位）。矮墙顶 0.7 m、玻璃 0.7–2.3 m' } },
      { name: 'lamp-room-cam', t: polar(2.6, 250, Y + 1.7), r: quatLookAt(polar(2.6, 250, Y + 1.7), [0, Y + 1.0, 0]), extras: { camera: true, fovDeg: 60 } },
    ],
  });
}

// =====================================================================================
// prop-fresnel-lens-ch1：菲涅尔透镜（八面牛眼透镜鼓 + 上下反射棱环 + 黄铜框）
// =====================================================================================
const brassify = (p, us = 1) => { for (let i = 0; i < p.uv.length; i += 2) { const [u, v] = inReg('brass', Math.abs(p.uv[i] * us) % 1, 1 - clamp(Math.abs(p.uv[i + 1]) % 1, 0, 1)); p.uv[i] = u; p.uv[i + 1] = v; } p.mat = 'brass'; return p; };
const lensUV = (p) => { for (let i = 0; i < p.pos.length / 3; i++) { p.uv[i * 2] = p.pos[i * 3] * 0.5 + 0.5; p.uv[i * 2 + 1] = p.pos[i * 3 + 1] * 0.5; } p.mat = 'lens'; return p; };
function buildLens() {
  const parts = [], NF = 8, rA = 0.48, y0 = 0.39, y1 = 1.01, yc = 0.7;
  // 透镜鼓：8 块平板 + 牛眼同心棱环
  for (let i = 0; i < NF; i++) {
    const am = i * 45, w = 2 * rA * Math.tan(Math.PI / NF);
    const pane = lensUV(xform(fromGeo(new THREE.BoxGeometry(0.02, y1 - y0, w - 0.03), 'lens'), radial(rA - 0.01, am, yc)));
    parts.push(pane);
    const prof = [[0.001, 0.07], [0.05, 0.062], [0.075, 0.045], [0.075, 0.02], [0.12, 0.042], [0.12, 0.016], [0.165, 0.036], [0.165, 0.012], [0.21, 0.03], [0.21, 0.008], [0.26, 0.022], [0.26, 0.0]];
    let eye = fromGeo(new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), 40), 'lens');
    eye = hardEdgeNormals(eye, 25);
    parts.push(lensUV(xform(eye, mul(radial(rA, am, yc), RZ(-Math.PI / 2)))));
  }
  // 上 / 下反射棱环（锯齿剖面的旋转体，硬边 → 阶梯高光）
  const saw = (ra, ya, rb, yb, n, out = 0.035) => { const pr = []; for (let i = 0; i <= n; i++) { const t = i / n, r = lerp(ra, rb, t), y = lerp(ya, yb, t); pr.push([r, y]); if (i < n) { const t2 = (i + 0.55) / n; pr.push([lerp(ra, rb, t2) + out, lerp(ya, yb, t2)]); } } return pr; };
  parts.push(lensUV(hardEdgeNormals(lathePart(saw(rA + 0.01, y1 + 0.02, 0.17, 1.33, 9), 64, 'lens'), 25)));
  parts.push(lensUV(hardEdgeNormals(lathePart(saw(0.2, 0.08, rA + 0.01, y0 - 0.02, 7).reverse(), 64, 'lens'), 25)));
  // 黄铜框：底环、中环 ×2、顶环、8 根竖肋、顶冠
  parts.push(brassify(lathePart([[0.001, 0], [0.56, 0], [0.56, 0.05], [0.5, 0.08], [0.22, 0.08]], 48, 'brass'), 3));
  for (const y of [y0 - 0.015, y1 + 0.015]) parts.push(brassify(xform(fromGeo(new THREE.TorusGeometry(rA + 0.035, 0.018, 6, 48), 'brass'), mul(T(0, y, 0), RX(Math.PI / 2))), 4));
  for (let i = 0; i < NF; i++) {
    const a = i * 45 + 22.5, rv = rA / Math.cos(Math.PI / NF);
    parts.push(brassify(xform(fromGeo(new THREE.BoxGeometry(0.03, y1 - y0 + 0.04, 0.03), 'brass'), mul(T(...polar(rv, a, yc)), RY(-a * D2R))), 1));
    const top = saw(rA + 0.01, y1 + 0.02, 0.17, 1.33, 1).filter((_, j) => j % 2 === 0);
    parts.push(brassify(tubePart([polar(rv + 0.01, a, y1), polar(0.38, a, 1.2), polar(0.19, a, 1.35)], 0.012, 6, 4, 'brass'), 1));
    parts.push(brassify(tubePart([polar(rv + 0.01, a, y0), polar(0.4, a, 0.22), polar(0.22, a, 0.08)], 0.012, 6, 4, 'brass'), 1)); void top;
  }
  parts.push(brassify(lathePart([[0.2, 1.33], [0.24, 1.36], [0.2, 1.4], [0.12, 1.42], [0.001, 1.43]], 32, 'brass'), 2));
  // 灯芯座（透镜中心）
  parts.push(brassify(lathePart([[0.001, 0.08], [0.05, 0.08], [0.035, 0.55], [0.06, 0.6], [0.06, 0.66], [0.001, 0.66]], 16, 'brass'), 2));
  return finishAsset({
    name: 'prop-fresnel-lens-ch1', parts, origin: [0, 0, 0], uv2Size: 512, outDir: join(ART, 'models/props'),
    placement: { translation: [0, TOWER.slabTop + 0.85, 0], rotationY: 0, parent: 'env-lamp-room-ch1/fresnel-lens-socket' },
    collider: colliderFrom([hull([0, 45, 90, 135, 180, 225, 270, 315].flatMap((a) => [polar(0.56, a, 0), polar(0.56, a, 1.0), polar(0.2, a, 1.43)]))]),
    extras: {
      ticket: 'v0.1-020', forceLod0: true, puzzleCritical: false,
      note: '菲涅尔透镜（高 1.43 m，直径 1.12）。棱环是硬边几何 → 阶梯高光。不是 puzzleCritical，但在灯室里必须始终显示 LOD0：GLTF 加载器只对 puzzleCritical 强制 LOD0，'
        + '请程序加载后调用运行时强制 LOD0 标记函数（extras.forceLod0 = true 作为标记）。无自发光；点亮后的暖色由程序动态光 + 材质参数做',
    },
    helpers: [{ name: 'lens-focus', t: [0, yc, 0], extras: { note: '焦点 = lamp-light-origin（y 23.55）' } }],
  });
}

// =====================================================================================
// env-rock-islet-a：灯塔所在礁岛（约 21 × 21 m）+ 门外石台（y 2.4）+ 上桥台阶
// =====================================================================================
let TERR_XF = null;
function isletH(x, z) {
  const d0 = Math.hypot(x, z), th = Math.atan2(z, x) / D2R;
  const warp = 1 + (fbm(x * 0.09 + 3, 1.7, z * 0.09, 3) - 0.5) * 0.45;
  const d = d0 * warp;
  const bias = 0.85 * Math.cos((th - 115) * D2R);                                   // 东北高、西侧低（西侧礁石接天光）
  let h = 1.7 + bias - 0.55 * sstep(4.5, 9.5, d) * 2.2 - 2.4 * sstep(8.5, 11.5, d);
  h += (ridged(x * 0.35, 0.3, z * 0.35, 3) - 0.6) * 0.55 + (fbm(x * 1.3, 2.1, z * 1.3, 3) - 0.5) * 0.18;
  const terr = Math.floor(h / 0.45), f = h / 0.45 - terr; h = (terr + sstep(0.25, 0.75, f)) * 0.45 * 0.6 + h * 0.4; // 层状台阶感
  // 塔脚：塔周 4–5.5 m 内压到塔基底座以下（西窗外 ≤ 0.6）
  const near = 1 - sstep(4.3, 6.0, d0), west = Math.max(0, Math.cos(th * D2R));
  h = lerp(h, Math.min(h, 0.5 - 0.4 * west), near);
  h = Math.min(h, 0.6 + 2.5 * sstep(4.2, 9, d0) * (1 - west * 0.6));
  return h;
}
function terrainAt(x, z) { if (TERR_XF) { const v = V3(x, 0, z).applyMatrix4(TERR_XF); return { h: isletH(v.x, v.z) }; } return { h: isletH(x, z) }; }
const seM = new THREE.Matrix4().makeRotationY(135 * D2R);   // 局部 (s, y, t) → 世界：s 朝东南、t 朝西南
function buildIslet() {
  const parts = [], R = rng(5001), X = 11.2;
  // 高度场（台地 / 门外平台 / 桥头下面都压低一点，避免穿出）
  const under = (x, z) => { const s = -(x + z) * Math.SQRT1_2, t = (x - z) * Math.SQRT1_2; return s > PLAT.s0 - 0.5 && s < 12 && Math.abs(t) < (s < PLAT.s1 + 0.3 ? 2.6 : 1.4); };
  // fix-r2（029 程序回报）：原「塔脚」公式 h ≤ 0.5 − 0.4·cos θ 只把西侧（+X）压到 0.10，东侧仍 0.50 → 塔内 0.5 高平台穿出 y 0.2 地板。
  //   可见网格：r < 3.6 的高度场点统一压到 ≤ 0.10（地板铺石底 0.04 / 顶 0.2，石面只从石缝里露出）。动到的三角形最远到 r 3.6 + 0.29 < 塔基 4.0 / 底座 4.15，
  //   都被塔基挡住 → 塔外可见形状、法线不变。碰撞：塔下（三个点都在 r < 4.0 内）的三角形直接挖掉，塔内由室内地板碰撞（y 0.2）、塔基环（3.05–4.15）接住，塔外碰撞逐三角形不变。
  const TOWER_IN = { rClamp: 3.6, hMax: 0.10, rColDig: 4.0, rLock: 4.0 };
  const Hraw = (x, z) => { let h = isletH(x, z); if (under(x, z)) h = Math.min(h, 1.9); return h; };
  const H = (x, z) => { const h = Hraw(x, z); return Math.hypot(x, z) < TOWER_IN.rClamp ? Math.min(h, TOWER_IN.hMax) : h; };
  const N = 112;
  const tg = grid(N, N, (u, v) => { const x = lerp(-X, X, u), z = lerp(-X, X, v); return [x, H(x, z), z]; }, 'rock');
  orientUp(tg); boxUV(tg, 2.0); parts.push(hardEdgeNormals(boxUV(tg, MATS.rock.tile, [0.2, 0.7]), 50));
  // fix-r2：LOD1/2 减面时锁住塔下（r < rLock）的岩石点：塔内保持 LOD0 的压低形状（≤ 0.10），不会被大三角形拉回 0.5 / 0.9（改前 LOD2 塔内最高 0.99）。
  //   锁的点只在墙厚以内，塔外照常减面（同 simplifyPrim 的目标比例 / 误差档）。
  const simplifyLocked = (p, ratio) => {
    if (p.mat !== 'rock') return simplifyPrim(p, ratio, {});
    const nv = p.pos.length / 3, lock = new Uint8Array(nv); for (let i = 0; i < nv; i++) lock[i] = Math.hypot(p.pos[i * 3], p.pos[i * 3 + 2]) < TOWER_IN.rLock || Math.max(Math.abs(p.pos[i * 3]), Math.abs(p.pos[i * 3 + 2])) > X - 1e-3 ? 1 : 0; // 塔下 + 高度场外框（外框不锁会把海床一角塌掉）
    const target = Math.max(3, Math.floor((p.idx.length * ratio) / 3) * 3); let best = p.idx;
    for (const err of [0.001, 0.002, 0.004, 0.008, 0.016, 0.03, 0.06, 0.12]) { const [idx] = MeshoptSimplifier.simplifyWithAttributes(p.idx, p.pos, 3, new Float32Array(0), 0, [], lock, target, err, ['Prune']); best = idx; if (idx.length <= target * 1.04) break; }
    return compact(p, best);
  };
  // 礁石块（切面多面体）：散布在岛上，避开门外平台、桥头、西窗外光斑区
  const rocks = [];
  for (let i = 0; i < 40 && rocks.length < 24; i++) {
    const a = R() * 360, d = 4.8 + R() * 5.2, x = d * Math.cos(a * D2R), z = d * Math.sin(a * D2R);
    if (under(x, z) || (Math.abs(angDiff(a, 0)) < 25 && d < 9)) continue;
    const big = R() < 0.35, sc = big ? 1.4 + R() * 1.2 : 0.6 + R() * 0.7;
    const c = { size: [sc * (0.9 + R() * 0.6), sc * (0.45 + R() * 0.4), sc * (0.8 + R() * 0.5)], seed: 900 + i * 7, planes: 9 + Math.floor(R() * 5), strata: 0.18 + R() * 0.1, detail: big ? 14 : 10 };
    if (R() < 0.5) Object.assign(c, { top: 0.55 + R() * 0.15, tilt: 0.06 });
    const { prim } = makeRockC(c, { tile: 2.0 / Math.max(1, sc) });
    xform(prim, mul(T(x, H(x, z) - c.size[1] * 0.25, z), RY(R() * 6.28)));
    parts.push(prim); rocks.push({ x, z, r: Math.max(c.size[0], c.size[2]) * 0.5, top: H(x, z) + c.size[1] * 0.75 });
  }
  // 门外石台（y 2.4，石砌 + 铺石；靠塔一侧不砌墙，铺石到塔墙为止）
  TERR_XF = seM;
  const loc = [], jag = [];
  masonryPlatform(loc, PLAT.s0, PLAT.s1, PLAT.t0, PLAT.t1, -1.0, PLAT.top, 511, { sides: ['s', 'n', 'w'], paveSkip: (x, z) => Math.hypot(x, z) < rOut(2.4) - 0.02 });
  // 上桥台阶 3 级（2.4 → 3.0）
  // 020 打磨：每级拆成 2–3 块旧石（宽窄不一、略错位、大倒角、踏面中间踩凹）
  for (let i = 1; i <= 3; i++) {
    const L = BRIDGE.s0 - (PLAT.s1 - 0.3 + 0.3 * i), Hh = 0.2 * i + 0.4, Wt = BRIDGE.w + 0.1, nb = i === 2 ? 2 : 3;
    const cuts = [0]; for (let q = 1; q < nb; q++) cuts.push(q / nb + (R() - 0.5) * 0.12); cuts.push(1);
    for (let q = 0; q < nb; q++) {
      const t0 = -Wt / 2 + cuts[q] * Wt, t1 = -Wt / 2 + cuts[q + 1] * Wt, wq = t1 - t0 - 0.02, dh = (R() - 0.5) * 0.03;
      const b = stoneBlock(L - 0.01 - R() * 0.04, Hh + dh, wq, 0.045, 520 + i * 7 + q, 0.014);
      for (let v = 0; v < b.pos.length; v += 3) if (b.pos[v + 1] > Hh / 2 - 0.06) b.pos[v + 1] -= 0.03 * Math.exp(-(((t0 + t1) / 2 + b.pos[v + 2]) ** 2) / 0.12) * (1 - Math.abs(b.pos[v] / L) * 1.4);
      smoothNormals(b);
      xform(b, mul(T((PLAT.s1 - 0.3 + 0.3 * i + BRIDGE.s0) / 2 + (R() - 0.5) * 0.03, PLAT.top + 0.2 * i - Hh / 2 + dh / 2, (t0 + t1) / 2), RY((R() - 0.5) * 0.04)));
      loc.push(boxUV(b, 2, [R(), R()]));
    }
  }
  // 020 打磨：门外平台两侧、上桥台阶两侧的尖礁石（切面多、不压平顶），离走道 ≥ 0.25 m
  {
    const RJ = rng(5301), spots = [[4.2, 3.0, 1.1], [5.6, 3.3, 1.5], [7.0, 2.95, 1.2], [4.6, -3.1, 1.3], [6.3, -3.0, 1.0], [7.9, 1.55, 0.9], [8.2, -1.55, 1.0], [3.9, -2.9, 0.8]];
    for (const [s0, t0, sc] of spots) {
      const c = { size: [sc * (0.8 + RJ() * 0.3), sc * (1.0 + RJ() * 0.5), sc * (0.7 + RJ() * 0.3)], seed: 1300 + Math.round(s0 * 10 + t0), planes: 12 + Math.floor(RJ() * 4), strata: 0.14, detail: 8, cracks: 4 };
      const { prim } = makeRockC(c, { tile: 2.0 / Math.max(1, sc) });
      const [x, z] = seXZ(s0, t0), yb = Math.min(isletH(x, z), PLAT.top - 0.3);
      xform(prim, mul(T(s0, yb - c.size[1] * 0.2, t0), RY(RJ() * 6.28), RZ((RJ() - 0.5) * 0.3)));
      // 把朝走道一侧的点推回去，保证不压走道
      const lim = Math.abs(t0) > 2.6 ? 2.65 : 1.1;
      for (let v = 0; v < prim.pos.length; v += 3) { const tt = prim.pos[v + 2]; if (Math.abs(tt) < lim && Math.sign(tt) === Math.sign(t0)) prim.pos[v + 2] = Math.sign(t0) * lim; }
      loc.push(prim); jag.push([s0, t0, sc]);
    }
  }
  // 系船铁环 / 钟台小石墩（钟本体是 022 道具）
  // 返工 1029：小潮钟不再缩放、去掉 0.35 m 小石墩——钟架直接立在门外平台（y 2.4）上，与 S1 钟同尺寸
  loc.push(ironize(xform(fromGeo(new THREE.TorusGeometry(0.1, 0.018, 5, 14), 'wood'), mul(T(PLAT.s1 - 0.2, PLAT.top - 0.35, PLAT.t1 + 0.03))), 1));
  TERR_XF = null;
  for (const p of loc) parts.push(xform(p, seM));
  // 碰撞：粗高度场（0.5 m）+ 平台 + 台阶坡 + 大石块
  const cN = 44, cg = grid(cN, cN, (u, v) => { const x = lerp(-X, X, u), z = lerp(-X, X, v); return [x, Hraw(x, z), z]; }, 'x');
  { // fix-r2：挖掉塔下碰撞（见上 TOWER_IN）
    const keep = [], rr = (i) => Math.hypot(cg.pos[i * 3], cg.pos[i * 3 + 2]);
    for (let t = 0; t < cg.idx.length; t += 3) { const a = cg.idx[t], b = cg.idx[t + 1], c = cg.idx[t + 2]; if (rr(a) < TOWER_IN.rColDig && rr(b) < TOWER_IN.rColDig && rr(c) < TOWER_IN.rColDig) continue; keep.push(a, b, c); }
    cg.idx = new Uint32Array(keep);
  }
  const col = [cg, xform(colBox((PLAT.s0 + PLAT.s1) / 2, (PLAT.top - 1.5) / 2, 0, PLAT.s1 - PLAT.s0, PLAT.top + 1.5, PLAT.t1 - PLAT.t0), seM)];
  col.push(xform(hull([[PLAT.s1 - 0.1, PLAT.top, -0.8], [PLAT.s1 - 0.1, PLAT.top, 0.8], [BRIDGE.s0, BRIDGE.deck, -0.8], [BRIDGE.s0, BRIDGE.deck, 0.8], [PLAT.s1 - 0.1, PLAT.top - 0.6, -0.8], [PLAT.s1 - 0.1, PLAT.top - 0.6, 0.8], [BRIDGE.s0, PLAT.top - 0.6, -0.8], [BRIDGE.s0, PLAT.top - 0.6, 0.8]]), seM));
  for (const r of rocks) if (r.r > 0.7) col.push(colBox(r.x, r.top / 2 - 0.5, r.z, r.r * 1.5, r.top + 1, r.r * 1.5));
  for (const [s0, t0, sc] of jag) col.push(xform(colBox(s0, PLAT.top / 2, t0 + Math.sign(t0) * 0.15, sc * 0.8, PLAT.top + sc, sc * 0.6), seM));
  const P = (s, t, y) => { const [x, z] = seXZ(s, t); return [x, y, z]; };
  const skyY = isletH(7.2, 1.2);
  return finishAsset({
    name: 'env-rock-islet-a', parts, lods: (() => { const l0 = mergeParts(parts); return [l0, l0.map((p) => simplifyLocked(p, 0.5)), l0.map((p) => simplifyLocked(p, 0.25))]; })(), origin: [0, 0, 0], uv2Size: 2048, collider: colliderFrom(col),
    extras: { ticket: 'v0.1-020', note: '灯塔礁岛约 22 × 22 m（东北高 ≈3 m、西侧低，退潮时露出、涨潮 1.6 时大半淹没）。门外石台 y 2.4（东南，对门）= 送回安全点 + 小潮钟位；石台东南端 3 级台阶上桥（y 3.0）', tide: { low: 0, high: 1.6 } },
    helpers: [
      { name: 'respawn-s3-door-platform', t: P(5.8, -0.6, PLAT.top), r: quatLookY(Math.atan2(-P(5.8, -0.6, 0)[0], -P(5.8, -0.6, 0)[2])), extras: { respawn: true, note: '涨潮落水 / 失败送回点（门外平台）' } },
      ...(() => {
        // 钟心 (s 5.6, t 1.7)；+Z 朝平台中心（−t）；汐交互点在钟心前 0.98 m（017 / 021：触点 = Xi 局部 [−0.04, 1.10, 0.72]，钟口半径 ≈ 0.26）
        const yaw = Math.atan2(-SE.vx, -SE.vz), c = Math.cos(yaw + Math.PI), sn = Math.sin(yaw + Math.PI), BELL = { s: 5.6, t: 1.7 }, AHEAD = 0.98;
        const bell = P(BELL.s, BELL.t, PLAT.top), it = P(BELL.s, BELL.t - AHEAD, PLAT.top);
        const xi = (v) => [it[0] + v[0] * c + v[2] * sn, it[1] + v[1], it[2] - v[0] * sn + v[2] * c];
        const contact = xi([-0.04, 1.10, 0.72]).map((v) => +v.toFixed(3));
        return [
          { name: 'tide-bell-s3-socket', t: bell, r: quatLookY(yaw), extras: { forPuzzle: 'tide-bell-s3', originAt: '钟轴正下方站台面点 = prop-tide-bell 根原点（021：根节点直接对齐本挂点，不加偏移、不缩放）', propPuzzleCritical: true, propTicket: 'v0.1-022 / 021', scale: 1, standY: PLAT.top, contactAboveStand: 1.10, contactWorldLocal: contact, interactAheadM: AHEAD, note: '返工 1029：潮钟与 S1 同尺寸（去掉 scale 0.7 与 0.35 m 石墩）；钟架根立在门外平台 y 2.4 上，+Z 朝平台中心 / 汐。敲击触点高出平台 1.10（021 道具负责：触点 Xi 局部 [−0.04, 1.10, 0.72]、r ≈ 0.26、钟心在交互点前 0.98；bell-swing 原点 = 吊点）。原 y 2.75 / scale 0.7' } },
          { name: 'tide-bell-s3-interact', t: it, r: quatLookY(yaw + Math.PI), extras: { interact: true, anim: 'xi-ring-bell', forPuzzle: 'tide-bell-s3', contact, note: '返工 1029：敲钟站位（地面，+Z 朝钟），钟心前 0.98 m' } },
        ];
      })(),
      { name: 'door-platform-center', t: P((PLAT.s0 + PLAT.s1) / 2 + 0.5, 0, PLAT.top) },
      { name: 'sky-beam-preview-target', t: [7.2, skyY, 1.2], extras: { note: '天光柱（015：从西来、冷白）落在塔西侧礁石上的预示光斑占位；光由程序做' } },
      { name: 'sky-beam-emitter', t: [40, 30, 2], extras: { forProgrammer: '天光发射器占位（西方高处，冷白 #DCE6EE），照向 west-window-outer', target: [rOut(1.6) + 0.05, 1.6, 0] } },
    ],
  });
}

// =====================================================================================
// env-stone-bridge-s3：石桥（宽 1.5，桥面 y 3.0，四孔半圆拱），东南方向接 S2 崖径
// =====================================================================================
function buildBridge() {
  const loc = [], R = rng(6001), B = BRIDGE, half = B.w / 2 + B.parapetW, Ytop = B.deck - 0.14, Ybot = -2.6;
  const spans = [[9.3, 13.4], [14.6, 18.9], [20.1, 24.4], [25.6, 29.7]];
  // 桥身：侧立面挤出（拱洞），厚 = 桥面 + 两侧栏墙
  const sh = new THREE.Shape(); sh.moveTo(B.s0, Ybot); sh.lineTo(B.s0, Ytop); sh.lineTo(B.s1, Ytop); sh.lineTo(B.s1, Ybot);
  for (const [a, b] of [...spans].reverse()) { const r = (b - a) / 2, c = (a + b) / 2; sh.lineTo(b, Ybot); sh.lineTo(b, B.spring); sh.absarc(c, B.spring, r, 0, Math.PI, false); sh.lineTo(a, Ybot); }
  sh.lineTo(B.s0, Ybot);
  const eg = new THREE.ExtrudeGeometry(sh, { depth: 2 * half - 0.04, bevelEnabled: false, curveSegments: 24 });
  eg.translate(0, 0, -half + 0.02);
  loc.push(boxUV(fromGeo(eg.toNonIndexed(), 'masonry'), 2.0, [0.13, 0.41]));
  // 拱圈券石（两侧立面，凸出 4 cm）
  for (const [a, b] of spans) {
    const r = (b - a) / 2, c = (a + b) / 2, n = 15;
    for (let i = 0; i < n; i++) {
      const ang = Math.PI * (i + 0.5) / n, x = c + Math.cos(ang) * (r + 0.22), y = B.spring + Math.sin(ang) * (r + 0.22);
      for (const s of [-1, 1]) { const v = stoneBlock(0.44, (Math.PI * (r + 0.22)) / n - 0.02, 0.12, 0.02, 600 + i + a, 0.006); xform(v, mul(T(x, y, s * (half + 0.0)), RZ(ang - Math.PI / 2))); loc.push(boxUV(v, 2, [R(), R()])); }
    }
  }
  // 桥墩分水尖（两侧）
  for (const s of B.piers) for (const side of [-1, 1]) {
    const g = new ConvexGeometry([[s - 0.6, Ybot, side * half], [s + 0.6, Ybot, side * half], [s, Ybot, side * (half + 0.8)], [s - 0.6, 1.0, side * half], [s + 0.6, 1.0, side * half], [s, 0.9, side * (half + 0.8)], [s, 1.6, side * half]].map((p) => V3(...p)));
    loc.push(boxUV(fromGeo(g, 'masonry'), 2, [R(), R()]));
  }
  // 束带石 + 栏墙（两侧成层砌块）+ 桥面铺石
  for (const sd of [-1, 1]) {
    const b = box(B.s1 - B.s0, 0.14, 0.1, 'masonry'); xform(b, T((B.s0 + B.s1) / 2, Ytop - 0.07, sd * (half + 0.03))); loc.push(boxUV(b, 2));
    const z = sd * half;
    courseWall(loc, sd > 0 ? [B.s0, z] : [B.s1, z], sd > 0 ? [B.s1, z] : [B.s0, z], B.deck - 0.14, B.deck + B.parapetH, sd > 0 ? [0, 1] : [0, -1], 640 + sd, { depth: B.parapetW, course: 0.32 });
  }
  paving(loc, B.s0, B.s1, -B.w / 2, B.w / 2, B.deck, 650, { thick: 0.14 });
  // 桥尾（接 S2 崖径）：一块大礁盘托住桥尾
  { const c = { size: [4.5, 4.2, 3.8], seed: 671, planes: 12, top: 0.72, tilt: 0.04, strata: 0.2, detail: 26 }; const { prim } = makeRockC(c, { tile: 1.2 }); xform(prim, mul(T(B.s1 + 0.1, -2.8, 0), RY(0.4))); loc.push(prim); }
  const parts = loc.map((p) => xform(p, seM));
  const col = [colBox((B.s0 + B.s1) / 2, B.deck - 0.3, 0, B.s1 - B.s0, 0.6, B.w + 2 * B.parapetW)];
  for (const sd of [-1, 1]) col.push(colBox((B.s0 + B.s1) / 2, B.deck + B.parapetH / 2, sd * (B.w / 2 + B.parapetW / 2), B.s1 - B.s0, B.parapetH, B.parapetW));
  for (const s of B.piers) col.push(colBox(s, (Ybot + 1) / 2, 0, 1.2, 1 - Ybot, 2 * half + 1.6));
  const walls = [-1, 1].map((sd) => colBox((B.s0 + B.s1) / 2, B.deck + 0.75, sd * (B.w / 2 + 0.15), B.s1 - B.s0, 1.5, 0.08)).map((p) => xform(p, seM));
  const P = (s, t, y) => { const [x, z] = seXZ(s, t); return [x, y, z]; };
  const yawToTower = Math.atan2(-seXZ(1, 0)[0], -seXZ(1, 0)[1]);
  return finishAsset({
    name: 'env-stone-bridge-s3', parts, origin: [0, 0, 0], uv2Size: 1024, collider: colliderFrom(col.map((p) => xform(p, seM))), walls,
    extras: { ticket: 'v0.1-020', note: `石桥：净宽 1.5 m、桥面 y 3.0、两侧栏墙高 0.5（空气墙到 1.5）。从门外平台（s ${B.s0}）沿东南方向 ${(B.s1 - B.s0).toFixed(1)} m 到 S2 崖径接口；四孔半圆拱，拱脚 y 0.2，涨潮时桥墩泡水`, axis: { from: P(B.s0, 0, B.deck), to: P(B.s1, 0, B.deck) } },
    helpers: [
      { name: 'spawn-from-s2', t: P(B.s1 - 1.0, 0, B.deck), r: quatLookY(yawToTower), extras: { spawn: true, note: '从 S2 过来的出生点（桥尾，面朝灯塔）' } },
      { name: 'bridge-to-s2-exit', t: P(B.s1 - 0.1, 0, B.deck), extras: { sceneExit: 's2-keeper-house', note: '回 S2 的出口触发位置（占位）' } },
      { name: 'bridge-head', t: P(B.s0, 0, B.deck) },
    ],
  });
}

// =====================================================================================
// 主流程
// =====================================================================================
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
mkdirSync(OUT_ENV, { recursive: true }); mkdirSync(join(ART, 'models/props'), { recursive: true });
const want = (n) => !ONLY.length || ONLY.some((o) => n === o);
const T0 = Date.now();
if (want('env-lighthouse-ch1')) buildExterior();
if (want('env-lighthouse-ch1-door')) buildDoor();
if (want('env-lighthouse-ch1-interior')) buildInterior();
if (want('env-lamp-room-ch1')) buildLampRoom();
if (want('prop-fresnel-lens-ch1')) buildLens();
if (want('env-rock-islet-a')) buildIslet();
if (want('env-stone-bridge-s3')) buildBridge();
// 光路检查：每段采样，离楼梯井轴 r ≥ 1.9 的点报出来（楼梯 / 扶手在 r 2.0–3.0）
const lpCheck = [];
for (let i = 1; i < LIGHT_PATH.length - 1; i++) { const a = LIGHT_PATH[i], b = LIGHT_PATH[i + 1]; let maxR = 0; for (let s = 0.02; s <= 0.98; s += 0.01) { const p = a.map((v, k) => lerp(v, b[k], s)); maxR = Math.max(maxR, Math.hypot(p[0], p[2])); } lpCheck.push({ seg: `${i}->${i + 1}`, maxR: +maxR.toFixed(3) }); }
console.log('光路段最大半径（< 1.9 = 不碰楼梯 / 扶手；附加检查）：', JSON.stringify(lpCheck));
const total = [0, 1, 2].map((l) => REPORT.reduce((s, r) => s + r.tris[l], 0));
LAYOUT.note = '020 占位布局（015 白盒 blockout-s3-lighthouse.glb 未交付）：坐标由美术按 020 / 015 / GDD 文字推定，白盒到了按白盒对位（误差 ≤ 5 cm）。S3 局部原点 = 灯塔中心，y 0 = 退潮海面。+Z 北、东 = -X、西 = +X。所有 S3 件 translation 都是 [0,0,0]（同一坐标系建模）。';
LAYOUT.axes = { north: '+Z', east: '-X', west: '+X', up: '+Y', units: 'm', angle: 'θ 从 +X（西）逆时针：90 北 / 180 东 / 270 南' };
LAYOUT.placeholders = {
  why: '015 白盒 blockout-s3-lighthouse.glb 未交付、013 未定 S3 世界坐标：以下全部是按 020 / 015 文字推的占位，白盒到了以后对位（误差 ≤ 5 cm）',
  items: ['S3 在世界里的位置 / 朝向（本文件全是 S3 局部坐标，塔中心 = 原点）', '门朝向 θ225（东南）与石桥方向', '螺旋楼梯起始角 θ152、平台角度区间', '西窗 θ0、窗口镜石座位置', '镜 A / 镜 B 位置（r 1.3，y 10.6 / 16.6）', '油阀 θ70 y 0.9', '点火口 (0,21.85,0)', '潮钟座（门外平台）', '石桥长度 / 跨数 / S2 端点 spawn-from-s2', '礁岛轮廓'],
};
function lampFurnLayout() {
  const LF = LAMP_FURN, th = LF.th * D2R, u = [Math.cos(th), Math.sin(th)], Y = TOWER.slabTop, r4 = (v) => v.map((x) => +x.toFixed(3));
  const at = (r, dt, y) => r4([u[0] * r - u[1] * dt, y, u[1] * r + u[0] * dt]);
  return { note: '017 第 3 批加的书桌 + 椅子（灯室西南，θ315，靠矮墙）。θ 从 +X 逆时针；facing = 汐坐下 / 站立时面朝的方向（S3 局部，径向朝外）', thDeg: LF.th,
    desk: { center: at(LF.deskR, 0, Y), top: +(Y + LF.deskTop).toFixed(3), size: [LF.deskW, LF.deskTop, LF.deskD], sizeNote: '[切向宽, 高, 径向深]', frontEdgeR: +(LF.deskR - LF.deskD / 2).toFixed(3), backEdgeR: +(LF.deskR + LF.deskD / 2).toFixed(3) },
    chair: { center: at(LF.chairR, 0, Y), seatTop: +(Y + LF.seatTop).toFixed(3), seatSize: [0.42, 0.4], backRestToward: 'tower center' },
    facing: r4([u[0], 0, u[1]]), sitWrite: at(LF.chairR, 0, Y), journal: at(LF.chairR + 0.38, 0, Y + LF.deskTop), lanternOnDesk: at(LF.deskR - 0.05, -0.3, Y + LF.deskTop),
    standGaze: { at: polar(LF.gazeR, LF.gazeTh, Y).map((x) => +x.toFixed(3)), facing: r4([Math.cos(LF.gazeTh * D2R), 0, Math.sin(LF.gazeTh * D2R)]) } };
}
LAYOUT.keyHeights = { lowTide: 0, highTide: 1.6, groundFloor: TOWER.floorY, oilValve: 0.9, westWindowSill: WWIN.y0, doorThreshold: DOOR.y0, doorPlatform: PLAT.top, bridgeDeck: BRIDGE.deck, platformA: treadTop(49), platformB: treadTop(79), lampRoomFloor: TOWER.slabTop, ignitionPort: IGNITION[1], lampRoomDeskTop: TOWER.slabTop + LAMP_FURN.deskTop, lampRoomChairSeat: TOWER.slabTop + LAMP_FURN.seatTop, lensCenter: 23.55, domeTop: TOWER.domeTop, vaneTop: TOWER.vaneTop, stairRise: STAIR.rise, stairWidth: STAIR.r1 - STAIR.r0 };
LAYOUT.points = {
  tower: { center: [0, 0, 0], rBase: TOWER.rBase, rTop: TOWER.rTop, rIn: TOWER.rIn }, door: DOOR, westWindow: WWIN, stairWindows: SWINS,
  stair: { r: [STAIR.r0, STAIR.r1], degPerTread: STAIR.a, treads: STAIR.n, firstTreadDeg: STAIR.start, landings: { door: { tread: 11, span: treadSpan(11) }, window5m: { tread: WIN5.k, span: treadSpan(WIN5.k), y: treadTop(WIN5.k), windowTh: SWIN5.th, sillY: SWIN5.y0, topY: SWIN5.y1, w: SWIN5.w, worldBearingDeg: (() => { const d = s3ToWorld(polar(1, SWIN5.th, 0)).map((v, i) => v - S3_WORLD.pos[i]); return +((Math.atan2(-d[0], d[2]) / D2R + 360) % 360).toFixed(1); })(), bearingNote: '方位角：0 = 世界北（+Z），90 = 东（−X）' }, A: { tread: 49, span: treadSpan(49) }, B: { tread: 79, span: treadSpan(79) } }, hatchDeg: HATCH },
  lampRoomFurniture: lampFurnLayout(),
  mirrors: MIR, ignitionPort: IGNITION, lightPath: LIGHT_PATH, lightPathCheck: { method: '返工 1029：打到点火口判定半径 0.3 m（窗口镜双轴直达导光镜 1 镜心；导光镜单轴，固定俯仰，yaw 最优）', guideMirrorTiltDeg: { guide1_A: GUIDE_TILT.a, guide2_B: GUIDE_TILT.b }, result: lpHit, guide1Vertical: lpHitAVertical, tiltToleranceDeg: lpTolerance, stairwellMaxR: lpCheck }, doorPlatform: PLAT, bridge: BRIDGE,
  igniteLever: { interact: LEVER.interact, facing: [-1, 0, 0], pivot: LEVER.pivot.map((v) => +v.toFixed(3)), gripRest: LEVER.gripRest.map((v) => +v.toFixed(3)), gripPulled: LEVER.gripPulled.map((v) => +v.toFixed(3)), len: LEVER.len, pullDeg: LEVER.pullDeg, pullAxis: 'pivot 节点局部 +X（= 世界 +Z）', xiLocal: { pivot: LEVER.pivotXi, gripRest: LEVER.gripRestXi, gripPulled: LEVER.gripPulledXi },
    distToNoteRead: { pivot: +Math.hypot(...LEVER.pivot.map((v, i) => v - polar(0.95, 172, TOWER.slabTop + 0.03)[i])).toFixed(3), interact: +Math.hypot(...LEVER.interact.map((v, i) => v - polar(0.95, 172, TOWER.slabTop + 0.03)[i])).toFixed(3), min: 1.5 } },
};
// 返工 1029：S3 世界坐标系（权威 game/src/levels/s1/layout.ts）与远处灯塔剪影（S3 局部）
LAYOUT.worldFrame = { authority: 'game/src/levels/s1/layout.ts S3_WORLD_FRAME', pos: S3_WORLD.pos, rotY: S3_WORLD.rotY, rotYDeg: S3_WORLD.rotYDeg, formula: 'world = R_y(rotY)·local + pos（three.js R_y：x\' = x·cos + z·sin，z\' = −x·sin + z·cos）',
  towerBaseY: { s3Scene: 0, s1Socket: S3_WORLD.socketYInS1, note: '015 注意：S3 场景塔基 y 0（低潮 0）；S1 远景插槽里同一座塔的实例底在 y 6.6（远景摆位，非同一套潮位）。两处不要混用' } };
LAYOUT.silhouettes = FAR_LH.map((f) => ({ ...f, note: f.id === GAZE_TARGET.id ? 'lamp-room-stand-gaze 朝向此塔' : '另一座（备选眺望目标）' }));
LAYOUT.triangles = { lod: total, budget: [4_000_000, 2_300_000, 1_000_000] };
if (!ONLY.length) writeFileSync(join(ART, 'source/env/s3-layout.json'), JSON.stringify(LAYOUT, null, 1));
console.log('\n资产                              LOD0 / LOD1 / LOD2           材质  碰撞面  大小');
for (const r of REPORT) console.log(`${r.name.padEnd(34)}${r.tris.map((t) => String(t).padStart(8)).join(' /')}   ${r.mats.length}   ${String(r.colliderTris).padStart(6)}   ${(r.bytes / 1024).toFixed(0)} KB  ${r.mats.join(',')}`);
console.log(`S3 合计：${total.join(' / ')}（预算 4M / 2.3M / 1M）`);
console.log(`用时 ${((Date.now() - T0) / 1000).toFixed(0)} s`);
