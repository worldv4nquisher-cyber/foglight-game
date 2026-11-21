#!/usr/bin/env node
// v0.1-027 剧情物件与场景小物：程序化建模 → GLB（共用图集 tex-props-dressing-ch1，单材质；植被一个 cutout 材质）
//   node art/tools/build-props-dressing-ch1.mjs [--only=a,b] [--png]
//   之后：node art/tools/glb-pack-ktx2.mjs <glb...>（贴图换外置 KTX2 + meshopt 量化）
// 每件按「细节档 q = 0/1/2」参数化重建出 _lod0/_lod1/_lod2（≤1k 的纸类只出 LOD0+LOD1）；三角面每级约减半。
// 坐标：1 单位 = 1 m，+Y 上，正面 +Z，原点在底面中心（海鸟例外：原点在身体中心）。
// 图集分区见 art/source/props/gen_tex_props_dressing_ch1.py（REGION 必须一致，v 向下）。
import * as THREE from '../../game/node_modules/three/build/three.module.js';
import { MeshoptEncoder } from '../../game/node_modules/meshoptimizer/index.js';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = join(ART, 'source/textures');
const USE_PNG = process.argv.includes('--png');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=').slice(7).split(',').filter(Boolean);
const REGION = JSON.parse(readFileSync(join(ART, 'source/props/props-dressing-ch1.regions.json'), 'utf8'));
const SET = 'tex-props-dressing-ch1';
const PAD = 6 / 2048;
const MAT = 0, MAT_VEG = 1;

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a) => new THREE.Matrix4().makeRotationX(a);
const RY = (a) => new THREE.Matrix4().makeRotationY(a);
const RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
const mul = (...ms) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4());
const V2 = (r, y) => new THREE.Vector2(Math.max(r, 1e-5), y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = (seed) => { let x = seed >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); };

// ---------- Builder：UV 0..1 → 图集分区（sub = 分区内子矩形 [u0,v0,w,h]，v 向下） ----------
class Builder {
  constructor() { this.parts = []; }
  add(geom, region, matrix = null, { sub = [0, 0, 1, 1], mat = MAT, flipV = false } = {}) {
    let g = geom.index ? geom : geom.setIndex([...Array(geom.attributes.position.count).keys()]);
    if (matrix) g.applyMatrix4(matrix);
    const uv = g.attributes.uv, [u0, v0, w, h] = REGION[region];
    const pu = PAD / w, pv = PAD / h;
    for (let i = 0; i < uv.count; i++) {
      let u = uv.getX(i), v = 1 - uv.getY(i); if (flipV) v = 1 - v;                      // three UV v 向上 → 图像 v 向下
      u = sub[0] + u * sub[2]; v = sub[1] + v * sub[3];
      u = Math.min(1 - pu, Math.max(pu, u)); v = Math.min(1 - pv, Math.max(pv, v));
      uv.setXY(i, u0 + u * w, v0 + v * h);
    }
    this.parts.push({ g, mat }); return this;
  }
  build() {
    const mats = [...new Set(this.parts.map((p) => p.mat))].sort();
    return mats.map((mat) => {
      const P = [], N = [], U = [], I = [];
      for (const { g, mat: m } of this.parts) {
        if (m !== mat) continue;
        const base = P.length / 3; P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); U.push(...g.attributes.uv.array);
        for (const i of g.index.array) I.push(base + i);
      }
      return { mat, pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx: new Uint32Array(I) };
    });
  }
}
const tris = (prims) => prims.reduce((s, p) => s + p.idx.length / 3, 0);

// ---------- 几何工具 ----------
function rbox(w, h, d, r, n) {           // 圆角盒：BoxGeometry 细分后往内核夹紧再外推 r
  const g = new THREE.BoxGeometry(w, h, d, n, n, n); const p = g.attributes.position, v = V3(), c = V3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const dlt = v.clone().sub(c); if (dlt.lengthSq() > 1e-12) dlt.setLength(r); p.setXYZ(i, c.x + dlt.x, c.y + dlt.y, c.z + dlt.z);
  }
  g.computeVertexNormals(); return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const lathe = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), seg); g.computeVertexNormals(); return g; };
const cyl = (rt, rb, h, seg, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
function tubeG(pts, r, seg, rad, closed = false) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, r, rad, closed); }
// 纸：XZ 平面，正面 +Y；文字顶边朝 −Z；lift(x,z) 抬起量（卷角 / 弯曲）；背面另一张反向
function sheet(b, w, d, nx, nz, region, back, lift = () => 0, { thick = 0.0004, sub, backSub } = {}) {
  for (const side of [1, -1]) {
    const g = new THREE.PlaneGeometry(w, d, nx, nz); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, lift(x, z) + (side > 0 ? thick : 0)); }
    if (side < 0) { const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; } const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
    g.computeVertexNormals();
    b.add(g, side > 0 ? region : back, null, { sub: side > 0 ? sub : backSub });
  }
}
// 平面上的通用变换：把在 XZ 上做好的纸立起来（贴墙）：绕 X 转 +90°，正面朝 +Z
const UPRIGHT = RX(Math.PI / 2);

// =====================================================================================
// 纸类
// =====================================================================================
const curlCorners = (w, d, amt, seed) => { const r = rnd(seed); const k = [r(), r(), r(), r()].map((v) => v * amt);
  return (x, z) => { const u = x / w + 0.5, v = z / d + 0.5; const e = (a, b) => Math.max(0, 1 - Math.hypot(a, b) / 0.35) ** 2;
    return k[0] * e(u, v) + k[1] * e(1 - u, v) + k[2] * e(u, 1 - v) + k[3] * e(1 - u, 1 - v) + 0.0015 * Math.sin(u * 3.1) * Math.sin(v * 2.3); }; };

function letterA(q) {   // 平放信纸 0.18 × 0.24
  const b = new Builder(), n = [[8, 10], [4, 5]][q];
  sheet(b, 0.18, 0.24, n[0], n[1], 'letter', 'paperBack', curlCorners(0.18, 0.24, 0.012, 3));
  return b.build();
}
function letterB(q) {   // 钉着的纸 0.15 × 0.21：上沿两颗图钉（铁），下角翘起。默认平放（XZ），贴墙用时绕 X 转 +90°
  const b = new Builder(), n = [[6, 8], [3, 4]][q], w = 0.15, d = 0.21;
  sheet(b, w, d, n[0], n[1], 'letter', 'paperBack', (x, z) => { const v = z / d + 0.5; return 0.01 * Math.max(0, v - 0.6) ** 2 * 6 * (0.6 + 0.4 * Math.sin(x * 20)); });
  for (const sx of [-1, 1]) {
    b.add(cyl(0.006, 0.0065, 0.002, [10, 6][q]), 'iron', T(sx * (w / 2 - 0.018), 0.0015, -d / 2 + 0.018));
    b.add(cyl(0.0012, 0.0012, 0.004, 4), 'iron', T(sx * (w / 2 - 0.018), -0.0015, -d / 2 + 0.018));
  }
  return b.build();
}
function letterC(q) {   // 对折小纸条：展开 0.15 × 0.20，对折后 0.15 × 0.10；上页自由边微微翘起 ~8°
  const b = new Builder(), n = [[6, 4], [3, 2]][q], w = 0.15, d = 0.1;
  // 下页：平放，外面朝下（paperBack），里面朝上（字的下半）
  sheet(b, w, d, n[0], n[1], 'letter', 'paperBack', () => 0, { sub: [0, 0.5, 1, 0.5], thick: 0.0003 });
  // 上页：铰在 −Z 边（折线），向 +Z 盖下，自由边抬起 8°；里面朝下（看不见），外面朝上（空白）
  const top = new Builder();
  sheet(top, w, d, n[0], n[1], 'paperBack', 'letter', (x, z) => 0, { sub: [0, 0, 1, 1], backSub: [0, 0, 1, 0.5], thick: 0.0003 });
  const m = mul(T(0, 0.0012, -d / 2), RX(-8 * Math.PI / 180), T(0, 0, d / 2));
  for (const p of top.parts) { p.g.applyMatrix4(m); b.parts.push(p); }
  b.add(cyl(0.0012, 0.0012, w, [6, 4][q], true), 'paperBack', mul(T(0, 0.0012, -d / 2), RZ(Math.PI / 2)));   // 折线圆边
  return b.build();
}
function sketch(q) {    // 父亲草图 0.21 × 0.30，地窖木架上平放，卷角
  const b = new Builder(), n = [[10, 14], [5, 7]][q];
  sheet(b, 0.21, 0.30, n[0], n[1], 'sketch', 'paperBack', curlCorners(0.21, 0.3, 0.016, 7));
  return b.build();
}

// =====================================================================================
// 书：父亲日志（合上 / 打开）、值班簿
// =====================================================================================
function bookClosed(b, q, { w = 0.22, h = 0.03, d = 0.3, cover = 'leather', strap = true } = {}) {
  const ct = 0.004, n = [3, 2, 1][q], rs = [12, 6, 4][q];
  const pb = h - 2 * ct;
  b.add(rbox(w - 0.008, pb, d - 0.012, 0.002, n), 'pageEdge', T(0.003, ct + pb / 2, 0));               // 书页块
  for (const y of [ct / 2, h - ct / 2]) b.add(rbox(w, ct, d, 0.0015, n), cover, T(0, y, 0));           // 前后封皮
  b.add(new THREE.CylinderGeometry(h / 2, h / 2, d, rs, 1, true, Math.PI, Math.PI), cover, mul(T(-w / 2 + 0.002, h / 2, 0), RX(Math.PI / 2)));  // 书脊（−X）
  if (strap) {   // 皮绳绕一圈 + 结
    const r = 0.0022, x = w / 2 - 0.03;
    b.add(tubeG([V3(x, -0.0008, -d / 2 - 0.0015), V3(x, h + 0.0012, -d / 2 - 0.0015), V3(x, h + 0.0012, d / 2 + 0.0015), V3(x, -0.0008, d / 2 + 0.0015)], r, [24, 12, 6][q], [5, 4, 3][q]), cover);
    b.add(new THREE.SphereGeometry(0.005, [8, 6, 4][q], [5, 4, 2][q]), cover, T(x, h + 0.002, 0.06));
  }
}
function bookOpen(b, q, { w = 0.22, d = 0.3, cover = 'leather' } = {}) {   // 摊开：两封皮平放，书页两摞中缝下凹
  const ct = 0.004, n = [3, 2, 1][q], nx = [12, 6, 3][q], nz = [6, 3, 2][q];
  for (const s of [-1, 1]) {
    b.add(rbox(w, ct, d, 0.0015, n), cover, T(s * (w / 2 + 0.004), ct / 2, 0));
    b.add(rbox(w - 0.012, 0.008, d - 0.012, 0.0015, n), 'pageEdge', T(s * (w / 2 - 0.002), ct + 0.004, 0));
    const g = new THREE.PlaneGeometry(w - 0.012, d - 0.012, nx, nz); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (w - 0.012) / 2, t = x / (w - 0.012); const tt = s > 0 ? t : 1 - t;
      p.setY(i, ct + 0.008 + 0.012 * Math.sin(Math.min(1, tt * 1.6) * Math.PI / 2) - 0.004 * tt * tt); }   // 中缝低、向外鼓起再略垂
    g.computeVertexNormals();
    b.add(g, 'pages', T(s * (w / 2 - 0.002), 0, 0), { sub: s < 0 ? [0, 0, 0.5, 1] : [0.5, 0, 0.5, 1] });
  }
  b.add(new THREE.CylinderGeometry(0.012, 0.012, d, [8, 4, 3][q], 1, true, 0, Math.PI), cover, mul(T(0, 0.002, 0), RX(Math.PI / 2), RZ(Math.PI)));  // 书脊在下
}
function journalClosed(q) { const b = new Builder(); bookClosed(b, q); return b.build(); }
function journalOpen(q) { const b = new Builder(); bookOpen(b, q); return b.build(); }
function logbook(q) {   // 值班簿：灰蓝布面硬皮 0.22 × 0.04 × 0.30，封面标签 + 绳拴铅笔
  const b = new Builder();
  bookClosed(b, q, { w: 0.22, h: 0.04, d: 0.3, cover: 'cloth', strap: false });
  sheet(b, 0.09, 0.05, 1, 1, 'paperBack', 'paperBack', () => 0, { thick: 0.0003 });
  b.parts.slice(-2).forEach((p) => p.g.applyMatrix4(T(0.02, 0.0402, -0.06)));
  const pr = [6, 6, 4][q];
  b.add(cyl(0.0035, 0.0035, 0.15, pr), 'pencil', mul(T(0.13, 0.0035, 0.02), RX(Math.PI / 2)));
  b.add(cyl(0.0003, 0.0035, 0.012, pr), 'iron', mul(T(0.13, 0.0035, 0.101), RX(Math.PI / 2)));
  b.add(tubeG([V3(-0.11, 0.03, -0.14), V3(-0.08, 0.042, -0.155), V3(0.05, 0.04, -0.17), V3(0.12, 0.012, -0.12), V3(0.13, 0.0035, -0.055)], 0.0012, [20, 10, 6][q], [4, 3, 3][q]), 'rope');
  return b.build();
}

// =====================================================================================
// 码头告示牌：两根立柱 + 三块横板 + 顶上挡雨条 + 钉着的印刷告示（0.42 × 0.56）+ 一张撕剩的旧纸角
// 原点 = 码头板面（立柱底中心连线中点），牌面中心 y 1.2，正面 +Z
// =====================================================================================
const NB = { cy: 1.2, w: 0.9, h: 0.7, t: 0.035, post: 0.08, postH: 1.62 };
function noticeBoard(q) {
  const b = new Builder(), n = [3, 2, 1][q];
  for (const sx of [-1, 1]) b.add(rbox(NB.post, NB.postH, NB.post, 0.008, n), 'wood', mul(T(sx * (NB.w / 2 - 0.02), NB.postH / 2, -NB.post / 2 - NB.t / 2), RZ(Math.PI / 2)), { sub: [0, 0, 1, 0.25] });
  const ph = NB.h / 3;
  for (let i = 0; i < 3; i++) b.add(rbox(NB.w, ph - 0.006, NB.t, 0.005, n), 'wood', T(0, NB.cy - NB.h / 2 + ph * (i + 0.5), 0), { sub: [0, i * 0.25, 1, 0.25] });
  b.add(rbox(NB.w + 0.12, 0.03, 0.12, 0.006, n), 'wood', mul(T(0, NB.cy + NB.h / 2 + 0.03, 0.01), RX(0.12)), { sub: [0, 0.75, 1, 0.25] });
  // 告示纸：竖贴在板面 z = t/2，四角图钉，下角被风掀起
  const pw = 0.42, pd = 0.56, nn = [[8, 10], [4, 5], [2, 3]][q];
  const nb = new Builder();
  sheet(nb, pw, pd, nn[0], nn[1], 'notice', 'paperBack', (x, z) => { const v = z / pd + 0.5, u = x / pw + 0.5; return 0.03 * Math.max(0, v - 0.75) ** 2 * 16 * Math.max(0, u - 0.5) * 2 + 0.002 * Math.sin(u * 5) ; });
  const m = mul(T(-0.06, NB.cy, NB.t / 2 + 0.001), UPRIGHT);
  for (const p of nb.parts) { p.g.applyMatrix4(m); b.parts.push(p); }
  for (const [x, y] of [[-pw / 2 + 0.02, pd / 2 - 0.02], [pw / 2 - 0.02, pd / 2 - 0.02], [-pw / 2 + 0.02, -pd / 2 + 0.06]])
    b.add(cyl(0.007, 0.008, 0.003, [8, 6, 4][q]), 'iron', mul(T(-0.06 + x, NB.cy + y, NB.t / 2 + 0.003), RX(Math.PI / 2)));
  // 撕剩的旧告示纸角（右侧）
  const ob = new Builder(); sheet(ob, 0.12, 0.16, 2, 2, 'paperBack', 'paperBack', (x, z) => 0.004 * Math.max(0, z / 0.16 + 0.2) ** 2);
  const m2 = mul(T(0.32, NB.cy + 0.12, NB.t / 2 + 0.001), UPRIGHT, RY(0.15));
  for (const p of ob.parts) { p.g.applyMatrix4(m2); b.parts.push(p); }
  b.add(cyl(0.007, 0.008, 0.003, [8, 6, 4][q]), 'iron', mul(T(0.31, NB.cy + 0.18, NB.t / 2 + 0.003), RX(Math.PI / 2)));
  return b.build();
}

// =====================================================================================
// 杯子（旧搪瓷铁皮杯）：r 0.04，高 0.085。倒扣姿态 = 绕 X 转 180°、y 抬高 0.085
// =====================================================================================
function cupInto(b, q, m = new THREE.Matrix4()) {
  const seg = [20, 10, 6][q], r = 0.04, h = 0.085, t = 0.002;
  b.add(lathe([[0.0, 0], [r - 0.004, 0], [r, 0.004], [r, h - 0.002], [r - t / 2, h], [r - t, h - 0.002], [r - t, t + 0.004], [r - t - 0.004, t], [0.0, t]], seg), 'tin', m);
  b.add(new THREE.TorusGeometry(0.026, 0.004, [6, 4, 3][q], [12, 6, 4][q], Math.PI), 'tin', mul(m, T(r - 0.002, h / 2 + 0.002, 0), RZ(-Math.PI / 2)), { sub: [0, 0.2, 1, 0.6] });
}
function cup(q) { const b = new Builder(); cupInto(b, q); return b.build(); }

// =====================================================================================
// 餐桌小物（≤10k）：水壶、面包板 + 面包 + 刀、两只叠放的旧盘子 + 一只单盘、盐罐
// 原点 = 桌面中心（S2 table c [-2.6, 0.75, 1.6]）；局部 (+0.05, 0) 周围 0.18 m 留给两只杯子（cups 点）
// =====================================================================================
function plate(b, q, m) { b.add(lathe([[0, 0], [0.07, 0], [0.075, 0.004], [0.112, 0.016], [0.115, 0.019], [0.11, 0.019], [0.072, 0.008], [0.0, 0.007]], [24, 12, 8][q]), 'ceramic', m, { sub: [0, 0, 1, 1] }); }
function kitchenSet(q) {
  const b = new Builder(), rs = [20, 10, 6][q];
  // 水壶（铁皮搪瓷）局部 (-0.42, 0, -0.1)
  const K = T(-0.42, 0, -0.12);
  b.add(lathe([[0, 0], [0.085, 0], [0.095, 0.02], [0.1, 0.07], [0.085, 0.13], [0.055, 0.155], [0.05, 0.165], [0.0, 0.165]], rs), 'tin', K);
  b.add(lathe([[0, 0.165], [0.052, 0.165], [0.045, 0.178], [0.012, 0.185], [0.012, 0.2], [0.0, 0.205]], rs), 'tin', K);
  b.add(tubeG([V3(0.08, 0.06, 0), V3(0.13, 0.1, 0), V3(0.16, 0.15, 0), V3(0.175, 0.165, 0)], 0.011, [10, 6, 3][q], [8, 5, 4][q]), 'tin', K, { sub: [0, 0.3, 1, 0.4] });
  b.add(tubeG([V3(-0.05, 0.158, 0), V3(-0.045, 0.24, 0), V3(0.0, 0.265, 0), V3(0.045, 0.24, 0), V3(0.05, 0.158, 0)], 0.004, [14, 8, 4][q], [5, 4, 3][q]), 'iron', mul(K, RY(Math.PI / 2)));
  // 面包板 + 面包 + 刀，局部 (0.38, 0, 0.08)
  const P = mul(T(0.36, 0, 0.06), RY(-0.25));
  b.add(rbox(0.36, 0.022, 0.22, 0.006, [3, 2, 1][q]), 'wood', mul(P, T(0, 0.011, 0)), { sub: [0, 0.5, 0.35, 0.25] });
  const loaf = new THREE.SphereGeometry(1, [16, 8, 6][q], [10, 6, 4][q]); const lp = loaf.attributes.position, rr = rnd(5);
  const bump = Array.from({ length: 12 }, () => [rr() * 6, rr() * 6, rr() * 0.06]);
  for (let i = 0; i < lp.count; i++) { let x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i); const k = 1 + bump.reduce((s, [a, c, amp]) => s + amp * Math.sin(x * a + z * c), 0);
    y = y < 0 ? y * 0.15 : y; lp.setXYZ(i, x * 0.11 * k, y * 0.065 * k, z * 0.06 * k); }
  loaf.computeVertexNormals(); b.add(loaf, 'bread', mul(P, T(-0.03, 0.03, -0.01)));
  b.add(box(0.13, 0.0015, 0.022), 'iron', mul(P, T(0.07, 0.0235, 0.075), RY(0.3)));
  b.add(rbox(0.09, 0.014, 0.018, 0.004, [2, 1, 1][q]), 'wood', mul(P, T(0.07, 0.03, 0.075), RY(0.3), T(-0.11, 0, 0)), { sub: [0.6, 0.1, 0.2, 0.2] });
  // 盘子：叠两只（局部 (-0.2, 0, 0.22)）+ 一只单放（局部 (-0.3, 0, -0.27)... 留开杯子）
  plate(b, q, T(-0.2, 0, 0.2)); plate(b, q, mul(T(-0.2, 0.012, 0.2), RY(0.7)));
  plate(b, q, T(0.36, 0, -0.24));
  // 盐罐（旧铁皮罐）
  b.add(lathe([[0, 0], [0.032, 0], [0.032, 0.09], [0.028, 0.095], [0.0, 0.095]], [14, 8, 6][q]), 'tin', T(-0.48, 0, 0.17), { sub: [0.3, 0.1, 0.4, 0.8] });
  return b.build();
}

// =====================================================================================
// 书桌小物（≤10k）：航海图（两端卷起）、罗盘（木盒）、油灯（不点亮：无火焰、无发光）、蘸水笔 + 墨水瓶
// 原点 = 书桌面中心（S2 desk x [-5.4,-4.8] z [-0.85,0.25] top 3.75 → (-5.1, 3.75, -0.3)），书桌朝 +X（玩家站 deskInteract 一侧）
// 避开：日志 journalSocket 局部 (0.1, 0.32)、汐纸条 局部 (-0.05, -0.38)（纸条压在航海图上）、风灯 lanternSocket 局部 (0.05, -0.05)
// =====================================================================================
function deskSet(q) {
  const b = new Builder();
  // 航海图 0.30（X）× 0.42（Z），两端卷起；纸条落在上面
  const cw = 0.3, cd = 0.42, cb = new Builder();
  sheet(cb, cd, cw, [16, 8, 4][q], [6, 3, 2][q], 'chart', 'paperBack', (x) => { const u = Math.abs(x) / (cd / 2); return 0.018 * Math.max(0, u - 0.82) ** 2 * 30; }, { thick: 0.0004 });
  const cm = mul(T(-0.1, 0.0005, -0.36), RY(Math.PI / 2 + 0.06));
  for (const p of cb.parts) { p.g.applyMatrix4(cm); b.parts.push(p); }
  // 罗盘：木盒 + 黄铜碗 + 玻璃面 + 指针（局部 (-0.18, 0, 0.08)）
  const C = mul(T(-0.18, 0, 0.1), RY(0.35)), rs = [20, 10, 6][q];
  b.add(rbox(0.12, 0.04, 0.12, 0.006, [3, 2, 1][q]), 'wood', mul(C, T(0, 0.02, 0)), { sub: [0.4, 0.25, 0.25, 0.25] });
  b.add(lathe([[0, 0.03], [0.048, 0.03], [0.052, 0.046], [0.046, 0.05], [0.0, 0.04]], rs), 'brass', C);
  b.add(cyl(0.045, 0.045, 0.002, rs), 'glass', mul(C, T(0, 0.047, 0)));
  b.add(box(0.07, 0.0015, 0.006), 'iron', mul(C, T(0, 0.044, 0), RY(0.6)));
  // 油灯（不点亮）：铁皮底座 + 黄铜油壶 + 灯头 + 烟熏玻璃罩，局部 (-0.2, 0, 0.42)
  const L = T(-0.2, 0, 0.42);
  b.add(lathe([[0, 0], [0.075, 0], [0.078, 0.008], [0.06, 0.02], [0.03, 0.05], [0.026, 0.07], [0.0, 0.07]], rs), 'tin', L);
  b.add(lathe([[0, 0.07], [0.04, 0.07], [0.062, 0.1], [0.06, 0.13], [0.03, 0.15], [0.02, 0.16], [0.0, 0.16]], rs), 'brass', L);
  b.add(lathe([[0, 0.16], [0.03, 0.16], [0.034, 0.175], [0.03, 0.19], [0.0, 0.19]], [14, 8, 6][q]), 'brass', L);
  b.add(lathe([[0.03, 0.188], [0.034, 0.2], [0.045, 0.24], [0.046, 0.27], [0.03, 0.31], [0.026, 0.37], [0.024, 0.372]], rs), 'glass', L);
  b.add(box(0.012, 0.008, 0.003), 'pencil', mul(L, T(0, 0.195, 0)));                          // 灯芯（黑，未点）
  // 蘸水笔 + 墨水瓶
  const pr = [6, 6, 4][q];
  b.add(cyl(0.0045, 0.0035, 0.15, pr), 'pencil', mul(T(0.25, 0.0045, 0.3), RX(Math.PI / 2), RZ(0.05)));
  b.add(cyl(0.0004, 0.003, 0.02, pr), 'brass', mul(T(0.25, 0.0045, 0.385), RX(Math.PI / 2)));
  b.add(lathe([[0, 0], [0.025, 0], [0.026, 0.035], [0.012, 0.045], [0.012, 0.055], [0.0, 0.055]], [12, 8, 5][q]), 'iron', T(-0.22, 0, 0.24));
  return b.build();
}

// =====================================================================================
// 通用装饰（InstancedMesh 友好：单网格、单材质、原点在底面中心）
// =====================================================================================
function ropeCoil(q) {   // 地上一盘麻绳：4 圈平螺旋 + 一圈压在上面 + 散开的绳头。绳径 0.03
  const b = new Builder(), r = 0.015, rad = [6, 5, 4][q], perM = [26, 16, 8][q];
  const pts = [];
  for (let t = 0; t <= 4 * 2 * Math.PI; t += 0.12) { const rr = 0.09 + 0.032 * t / (2 * Math.PI); pts.push(V3(rr * Math.cos(t), r + 0.002 * Math.sin(t * 3), rr * Math.sin(t))); }
  for (let t = 0; t <= 1.6 * Math.PI; t += 0.12) { const rr = 0.2 - 0.01 * t; pts.push(V3(rr * Math.cos(t + 0.3), r * 2.6 + 0.004 * Math.sin(t * 2), rr * Math.sin(t + 0.3))); }
  const last = pts[pts.length - 1]; for (let k = 1; k <= 4; k++) pts.push(V3(last.x + k * 0.08, Math.max(r, last.y - k * 0.012), last.z + k * 0.05 + 0.02 * Math.sin(k)));
  // 按 ~0.5 m 一段切分，每段 UV 0..1（绳纹不被拉长）
  const curve = new THREE.CatmullRomCurve3(pts), L = curve.getLength(), segs = Math.ceil(L / 0.5);
  for (let i = 0; i < segs; i++) {
    const sp = Array.from({ length: 9 }, (_, k) => curve.getPointAt(Math.min(1, (i + k / 8) / segs)));
    b.add(tubeG(sp, r, Math.max(2, Math.round(perM * L / segs)), rad), 'rope');
  }
  return b.build();
}
function netPile(q) {    // 渔网堆 0.9 × 0.32 × 0.7：鼓包噪声变形的半球 + 挂下的一角网
  const b = new Builder(), [ws, hs] = [[32, 16], [22, 11], [16, 8]][q];
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2); const p = g.attributes.position, r = rnd(11);
  const bumps = Array.from({ length: 14 }, () => [r() * 2 - 1, r() * 2 - 1, 0.12 + r() * 0.2, r() * 0.25]);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 1 + bumps.reduce((s, [bx, bz, w, a]) => s + a * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / w), 0);
    k += 0.05 * Math.sin(x * 9 + z * 7) * y;
    p.setXYZ(i, x * 0.45 * k, Math.max(0, y * 0.32 * k * (0.75 + 0.25 * Math.cos(x * 2))), z * 0.35 * k); }
  g.computeVertexNormals(); b.add(g, 'net');
  // 一个浮子挂在网上（软木，用浮球区）
  b.add(new THREE.SphereGeometry(0.045, [10, 6, 4][q], [6, 4, 3][q]), 'buoy', mul(T(0.22, 0.2, 0.18), S(1, 0.7, 1)));
  return b.build();
}
function buoy(q) {       // 浮球 ⌀0.32 + 顶上铁环 + 一截绳
  const b = new Builder(), rs = [18, 10, 6][q];
  const prof = []; for (let k = 0; k <= [10, 6, 4][q]; k++) { const a = -Math.PI / 2 + Math.PI * k / [10, 6, 4][q]; prof.push([0.16 * Math.cos(a) * (k === 0 || k === [10, 6, 4][q] ? 0 : 1), 0.16 + 0.16 * Math.sin(a)]); }
  b.add(lathe(prof, rs), 'buoy');
  b.add(new THREE.TorusGeometry(0.03, 0.006, [6, 4, 3][q], [12, 6, 4][q]), 'iron', T(0, 0.345, 0));
  b.add(tubeG([V3(0, 0.33, 0), V3(0.06, 0.37, 0.02), V3(0.14, 0.3, 0.05), V3(0.2, 0.05, 0.08), V3(0.3, 0.012, 0.12)], 0.009, [14, 8, 4][q], [5, 4, 3][q]), 'rope');
  return b.build();
}
function barrel(q) {     // 木桶 h 0.85，鼓腰 r 0.27 / 两端 0.23；三道铁箍；桶盖
  const b = new Builder(), rs = [16, 10, 6][q], h = 0.85;
  const prof = []; const nv = [8, 5, 3][q]; for (let k = 0; k <= nv; k++) { const y = h * k / nv; prof.push([0.23 + 0.04 * Math.sin(Math.PI * y / h), y]); }
  for (const half of [0, 1]) {   // 两个半圆各贴一遍木纹（竖纹：交换 UV），= 8 块桶板
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => V2(r, y)), rs / 2, half * Math.PI, Math.PI); g.computeVertexNormals();
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
    b.add(g, 'wood');
  }
  for (const y of [0.1, h / 2, h - 0.1]) { const r0 = 0.23 + 0.04 * Math.sin(Math.PI * y / h) + 0.004;
    b.add(cyl(r0, r0, 0.035, rs, true), 'iron', T(0, y, 0)); }
  b.add(cyl(0.225, 0.225, 0.01, rs), 'wood', T(0, h - 0.02, 0), { sub: [0, 0, 0.4, 1] });
  return b.build();
}
function crate(q) {      // 木箱 0.6 × 0.42 × 0.42：四根角柱 + 每面两块横板 + 顶两块盖板
  const b = new Builder(), W = 0.6, H = 0.42, D = 0.42, t = 0.02, n = [2, 1, 1][q], r = 0.003;
  const P = (w, h, d) => (q === 2 ? box(w, h, d) : rbox(w, h, d, r, n));
  if (q === 2) { b.add(box(W, H, D), 'wood', T(0, H / 2, 0), { sub: [0, 0, 1, 0.5] }); return b.build(); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(P(0.04, H, 0.04), 'wood', T(sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02)), { sub: [0, 0, 1, 0.25] });
  for (const y of [0.11, 0.31]) {
    for (const sz of [-1, 1]) b.add(P(W - 0.01, 0.17, t), 'wood', T(0, y, sz * (D / 2 - t / 2)), { sub: [0, (y > 0.2 ? 0.25 : 0.5), 0.6, 0.25] });
    for (const sx of [-1, 1]) b.add(P(t, 0.17, D - 0.05), 'wood', T(sx * (W / 2 - t / 2), y, 0), { sub: [0.6, 0.5, 0.4, 0.25] });
  }
  for (const z of [-0.1, 0.1]) b.add(P(W, t, 0.19), 'wood', T(0, H - t / 2 + 0.002, z), { sub: [0, 0.75, 1, 0.25] });
  b.add(P(W - 0.06, 0.01, D - 0.06), 'wood', T(0, 0.005, 0), { sub: [0, 0, 1, 0.25] });
  return b.build();
}

// =====================================================================================
// 植被（env-，mat-env-vegetation-ch1：alpha 剪影、双面；风摆权重 = 局部 y / heightM，程序在顶点着色器里做）
// =====================================================================================
function cards(b, region, n, w, h, segs, seed, { lean = 0.05, droop = 0, ry0 = 0 } = {}) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w * (0.8 + 0.3 * r()), h * (0.75 + 0.35 * r()), 1, segs); const p = g.attributes.position, hh = g.parameters.height;
    const ln = (r() - 0.5) * 2 * lean;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k) + hh / 2, s = y / hh; p.setY(k, y * (1 - droop * s)); p.setZ(k, ln * s * s * hh + droop * s * s * hh * 0.8); }
    g.computeVertexNormals(); const a = ry0 + i * Math.PI / n + (r() - 0.5) * 0.3;
    b.add(g, region, mul(RY(a), T((r() - 0.5) * 0.04, 0, 0)), { sub: [r() * 0.5, 0, 0.5, 1], mat: MAT_VEG });
  }
}
function grassClump(q) {   // 低矮杂草一丛：5 张交叉卡片 ⌀0.35 × 高 0.28
  const b = new Builder(); cards(b, 'grass', 5, 0.35, 0.28, [4, 2, 1][q], 21, { lean: 0.25 }); return b.build();
}
function mossPatch(q) {    // 枯苔一片：贴地 0.4 × 0.4，轻微起伏
  const b = new Builder(), n = [4, 2, 1][q], g = new THREE.PlaneGeometry(0.4, 0.4, n, n); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.012 + 0.01 * Math.cos(x * 8) * Math.cos(z * 8)); }
  g.computeVertexNormals(); b.add(g, 'moss', null, { mat: MAT_VEG }); return b.build();
}
function seaweed(q) {      // 礁石上耷拉的海草：4 张卡片，高 0.22，向外垂
  const b = new Builder(); cards(b, 'seaweed', 4, 0.4, 0.3, [4, 2, 1][q], 31, { lean: 0.1, droop: 0.35 }); return b.build();
}

// =====================================================================================
// 远处单只海鸟（翼展 1.1 m，原点 = 身体中心，朝 +Z 飞）。morph 目标 flap-up / flap-down + 动画 seabird-flap（0.6 s 循环）
// =====================================================================================
function seabird(q) {
  const b = new Builder(), rs = [6, 4, 4][q];   // 身体 ≥ 4 段（3 段时车削接缝的平滑法线会反向）；LOD1 起翼只留 1 段
  b.add(lathe(q < 2 ? [[0, -0.2], [0.03, -0.14], [0.045, -0.02], [0.04, 0.08], [0.028, 0.14], [0.012, 0.19], [0, 0.205]] : [[0, -0.2], [0.045, -0.02], [0.03, 0.14], [0, 0.205]], rs), 'bird', RX(Math.PI / 2), { sub: [0, 0, 0.3, 1] });
  const wingSegs = [3, 1, 1][q];
  for (const s of [-1, 1]) {   // 翼：上下两面薄片，翼尖后掠
    const g = new THREE.PlaneGeometry(0.52, 0.16, wingSegs * 2, 1); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.26, z = p.getZ(i); const t = x / 0.52; p.setXYZ(i, s * (x + 0.03), 0.01 * Math.sin(t * Math.PI), z * (1 - 0.55 * t) - 0.08 * t * t - 0.01); }
    if (s < 0) { const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; } }
    g.computeVertexNormals(); const g2 = g.clone(); const ix2 = g2.index.array; for (let t = 0; t < ix2.length; t += 3) { const k = ix2[t + 1]; ix2[t + 1] = ix2[t + 2]; ix2[t + 2] = k; }
    const n2 = g2.attributes.normal; for (let i = 0; i < n2.count; i++) n2.setXYZ(i, -n2.getX(i), -n2.getY(i), -n2.getZ(i));
    b.add(g, 'bird', null, { sub: [0.3, 0, 0.7, 1] }); b.add(g2, 'bird', T(0, -0.002, 0), { sub: [0.3, 0, 0.7, 1] });
  }
  b.add(new THREE.ConeGeometry(0.03, 0.08, rs, 1, true), 'bird', mul(T(0, 0, -0.22), RX(-Math.PI / 2)), { sub: [0, 0, 0.3, 1] });   // 尾
  const prims = b.build();
  // morph：按 |x| 绕身体两侧的翼根（|x|=0.03）转动，外翼段再多弯一点
  const target = (deg, tipDeg) => prims.map((p) => { const n = p.pos.length / 3, d = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const x = p.pos[i * 3], y = p.pos[i * 3 + 1], ax = Math.abs(x); if (ax <= 0.031) continue;
      const s = Math.sign(x), t = Math.min(1, (ax - 0.03) / 0.52), a = (deg + tipDeg * Math.max(0, t - 0.45) / 0.55) * Math.PI / 180;
      const rr = ax - 0.03, nx = s * (0.03 + rr * Math.cos(a)) - s * 0, ny = y + rr * Math.sin(a);
      d[i * 3] = nx - x; d[i * 3 + 1] = ny - y; }
    return d; });
  prims.targets = [target(30, 12), target(-24, -10)];   // 远景扇翅：上 30°(+翼尖 12°) / 下 24°(+10°)
  return prims;
}

// =====================================================================================
// P3 结尾坐写的笔（prop-fountain-pen）：老式钢笔，深色胶木笔杆（leather 区深色角）+ 旧黄铜笔尖 / 箍 / 笔夹 / 尾钮，笔帽套在尾端（书写状态）
// 原点 = 握点 = 汐 hand_r_socket（程序直接挂到 socket 下，局部单位矩阵）；顶点已转到 socket 坐标系。
// 轴向：动画 extras 的 penTip0 / penTail0 那条线贴着掌心走（穿无名指 5 mm、指尖离笔 1.4–2.2 cm，不像握笔），改为在第 0 帧手指姿势里搜的三指握笔轴；验证 art/tools/measure-pen-sit-write.mjs
// =====================================================================================
const PEN = { tip: [-0.00668, -0.05389, -0.04696], tail: [0.04436, 0.07117, -0.01016], grip: [0.00845, -0.0168, -0.03605], side: [0.623, 0.3609, 0.694], len: 0.14 };   // tip / grip：第 0 帧手指静止相对 socket 求出——笔轴过拇指 / 食指指腹之间（不穿手、拇指贴住），笔尖竖直落到日志纸面，立起 47°；side = 世界朝上（笔尖正面 / 笔夹朝上）
function penBasis() {
  const t = V3(...PEN.tip), ey = V3(...PEN.tail).sub(t).normalize();
  const ex = V3(...PEN.side); ex.addScaledVector(ey, -ex.dot(ey)).normalize(); const ez = V3().crossVectors(ex, ey);
  return new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(t);   // 笔本地：+Y 从笔尖指向笔尾，+X 笔夹一侧（笔尖正面）
}
function fountainPen(q) {
  const b = new Builder(), M = penBasis(), seg = [12, 6, 4][q], DARK = [0.05, 0.55, 0.4, 0.4];
  const at = (m) => M.clone().multiply(m);
  const nib = lathe([[0, 0], [0.0007, 0.0012], [0.0024, 0.009], [0.0033, 0.016], [0.0034, 0.019]], [8, 4, 3][q]);
  b.add(nib, 'brass', at(S(0.5, 1, 1)));                                                         // 笔尖：压扁的黄铜锥，薄向 = X（正面朝笔夹）
  b.add(lathe([[0.0026, 0.014], [0.0039, 0.019], [0.0042, 0.03], [0.0047, 0.0405], [0.0047, 0.042]], seg), 'leather', at(new THREE.Matrix4()), { sub: DARK });   // 握位（笔颈）
  if (q < 2) b.add(cyl(0.0053, 0.0053, 0.0035, seg), 'brass', at(T(0, 0.0435, 0)));                  // 螺纹前黄铜箍（LOD2 省掉）
  b.add(lathe([[0.005, 0.045], [0.0056, 0.0462], [0.0057, 0.088], [0.0052, 0.0888]], seg), 'leather', at(new THREE.Matrix4()), { sub: DARK });   // 笔杆
  b.add(lathe([[0.0056, 0.0855], [0.0064, 0.0868], [0.0065, 0.128], [0.0059, 0.1335], [0.0037, 0.1362], [0.0001, 0.1365]], seg), 'leather', at(new THREE.Matrix4()), { sub: DARK });   // 套在尾端的笔帽
  b.add(cyl(0.0067, 0.0067, 0.0038, seg), 'brass', at(T(0, 0.0895, 0)));                            // 帽口黄铜箍
  b.add(lathe([[0.0001, 0.1355], [0.0032, 0.1355], [0.0026, 0.1388], [0.0001, 0.14]], [8, 4, 3][q]), 'brass', at(new THREE.Matrix4()));   // 尾钮
  if (q < 2) {                                                                                      // 笔夹：贴着帽身的黄铜片 + 顶部搭桥 + 末端小球
    b.add(box(0.0012, 0.034, 0.0024), 'brass', at(T(0.0074, 0.113, 0)));
    b.add(box(0.0022, 0.003, 0.0024), 'brass', at(T(0.0068, 0.1305, 0)));
    if (q === 0) b.add(new THREE.SphereGeometry(0.0012, 6, 4), 'brass', at(T(0.0076, 0.0965, 0)));
  }
  return b.build();
}

// =====================================================================================
// 清单
// =====================================================================================
const ROOT_X = (o) => ({ ticket: 'v0.1-027', puzzleCritical: false, ...o });
const ASSETS = [
  { name: 'prop-journal-father', cap: 3000, groups: [{ name: 'prop-journal-father-closed', make: journalClosed, levels: 3 }, { name: 'prop-journal-father-open', make: journalOpen, levels: 3 }],
    helpers: [{ suffix: '-interact', t: [0, 0.035, 0.0] }],
    extras: ROOT_X({ variants: { closed: 'prop-journal-father-closed', open: 'prop-journal-father-open' }, note: '父亲日志：同一文件两种状态，程序按场景只显示一个 LOD 组（S2 书桌 journalSocket 用 closed，S3 灯室 lamp-room-journal-socket 用 open，书脊沿节点切向）。合上 0.22 × 0.03 × 0.30，摊开 0.45 × 0.30；书脊在 −X' }) },
  { name: 'prop-letter-a', cap: 1000, make: letterA, levels: 2, extras: ROOT_X({ size: [0.18, 0.24], note: '平放信纸：S2 抽屉里父亲没寄出的信；S1 晾网架下压在石头下的纸条（石头用场景石块）。文字顶边朝 −Z' }) },
  { name: 'prop-letter-b', cap: 1000, make: letterB, levels: 2, extras: ROOT_X({ size: [0.15, 0.21], pinned: true, upright: 'rotX +90° 时贴墙，正面朝 +Z', note: 'S3 灯室点火口旁钉着的纸（ch1.s3.ignition_note.doc）。默认平放（与 020 的 ignition-note-read 小铁盘一致）；若改钉墙，绕 X 转 +90°。离拉杆 ≥ 1.5 m 由摆放点保证（见 README-027）' }) },
  { name: 'prop-letter-c', cap: 1000, make: letterC, levels: 2, extras: ROOT_X({ size: [0.15, 0.1], folded: true, note: 'S2 书桌上汐的对折小纸条（ch1.s2.xi_note.doc）。折线在 −Z，上页自由边朝 +Z 微翘' }) },
  { name: 'prop-notice-board-s1', cap: 3000, make: noticeBoard, levels: 3, helpers: [{ suffix: '-interact', t: [-0.06, NB.cy, 0.12] }],
    extras: ROOT_X({ boardCenterY: NB.cy, note: '码头告示牌：原点在码头板面（立柱底），牌面中心 y 1.2，正面 +Z。印刷告示 = ch1.s1.notice.doc' }) },
  { name: 'prop-logbook-s3', cap: 2000, make: logbook, levels: 3, helpers: [{ suffix: '-interact', t: [0, 0.045, 0] }],
    extras: ROOT_X({ note: '值班簿：灰蓝布面硬皮 0.22 × 0.04 × 0.30，平放在 020 门内墙小木架上（logbook-s3-read）；书脊 −X，铅笔用绳拴在书脊上' }) },
  { name: 'prop-sketch-window', cap: 1000, make: sketch, levels: 2, extras: ROOT_X({ size: [0.21, 0.3], note: '父亲草图（窗 + 光线 + 角度）：S2 地窖木架上平放（cellarSketch / env-cellar-s2-sketch-socket）' }) },
  { name: 'prop-cup-tin', cap: 1000, make: cup, levels: 3,
    extras: ROOT_X({ poses: { upright: { t: [0, 0, 0], r: [0, 0, 0, 1] }, upturned: { t: [0, 0.085, 0], r: [1, 0, 0, 0] } }, instanced: true, note: '旧搪瓷铁皮杯：餐桌上两只，一只正放一只倒扣（倒扣 = 绕 X 转 180° 并抬高 0.085）' }) },
  { name: 'prop-kitchen-set-a', cap: 10000, make: kitchenSet, levels: 3, extras: ROOT_X({ note: '餐桌小物组：原点 = S2 餐桌面中心 (-2.6, 0.75, 1.6)；局部 (+0.05, 0) 周围 0.18 m 空着给 prop-cup-tin ×2' }) },
  { name: 'prop-desk-set-a', cap: 10000, make: deskSet, levels: 3, extras: ROOT_X({ noWarmLight: true, note: '书桌小物组：原点 = S2 二层书桌面中心 (-5.1, 3.75, -0.3)。油灯不点亮：无火焰网格、无自发光、不挂灯光' }) },
  { name: 'prop-rope-coil-a', cap: 2000, make: ropeCoil, levels: 3, extras: ROOT_X({ instanced: true }) },
  { name: 'prop-net-pile-a', cap: 2000, make: netPile, levels: 3, extras: ROOT_X({ instanced: true }) },
  { name: 'prop-buoy-a', cap: 1000, make: buoy, levels: 3, extras: ROOT_X({ instanced: true }) },
  { name: 'prop-barrel-a', cap: 1500, make: barrel, levels: 3, extras: ROOT_X({ instanced: true }) },
  { name: 'prop-crate-a', cap: 1500, make: crate, levels: 3, extras: ROOT_X({ instanced: true }) },
  { name: 'env-grass-coastal-a', dir: 'env', cap: 200, groups: [{ name: 'env-grass-coastal-a', make: grassClump, levels: 3, extras: { windSway: { heightM: 0.3, weight: 'localY/heightM', strength: 1.0 } } }, { name: 'env-moss-dead-a', make: mossPatch, levels: 3, extras: { windSway: false } }],
    extras: ROOT_X({ instanced: true, density: 'grassDensity（style §8：1.0 / 0.7 / 0.4）', outline: false, note: '两个实例源：env-grass-coastal-a（低矮杂草丛）、env-moss-dead-a（贴地枯苔）。颜色发灰，不描边' }) },
  { name: 'env-seaweed-a', dir: 'env', cap: 200, make: seaweed, levels: 3, groupExtras: { windSway: { heightM: 0.25, weight: 'localY/heightM', strength: 0.4, note: '湿海草：摆幅小、慢' } },
    extras: ROOT_X({ instanced: true, density: 'grassDensity', outline: false, note: '礁石 / 潮线上的海草，退潮时贴着石头垂' }) },
  { name: 'prop-fountain-pen', cap: 1000, make: fountainPen, levels: 3, helpers: [{ suffix: '-tip', t: PEN.tip, extras: { note: '笔尖点（socket 局部）' } }, { suffix: '-grip', t: PEN.grip, extras: { note: '拇指 / 食指指腹夹笔处（socket 局部）' } }],
    extras: { ticket: 'P3-ending-pen', puzzleCritical: false, originAt: 'hand_r_socket（握笔手的掌心挂点；笔的几何已在 socket 坐标系里摆好）', attach: { socket: 'hand_r_socket', clip: 'xi-sit-write', localMatrix: 'identity' }, tipLocal: PEN.tip, tailLocal: PEN.tail, gripLocal: PEN.grip, lengthM: PEN.len,
      note: '结尾坐写时汐手里的钢笔：深色胶木杆 + 旧黄铜笔尖 / 箍 / 笔夹，笔帽套在尾端。挂到 char-xi 的 hand_r_socket 下、局部单位矩阵，不加偏移；顶点已在 socket 坐标系里：笔夹在拇指 / 食指指腹之间（-grip 节点，距笔尖 4.15 cm），笔尖 -tip 在 xi-sit-write 整段落在日志纸面上（P3 起该 clip 的笔尖路径跟纸面高度）。只在 xi-sit-write 用' } },
  { name: 'prop-seabird-far', cap: 300, make: seabird, levels: 3, anim: true,
    extras: ROOT_X({ originAt: 'body-center', single: true, flock: false, wingspan: 1.1, note: '远景单只海鸟（GDD 修订：零星单只，不做鸟群）。动画 seabird-flap 0.6 s 循环（morph flap-up / flap-down）；滑翔时程序把权重停在 0' }) },
];

// ---------- 描边平滑法线（COLOR_0）、meshopt reorder、GLB 写出 ----------
function outlineColors(prims) {
  const key = (p, i) => `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`;
  const acc = new Map(), a = V3(), b = V3(), c = V3(), ab = V3(), ac = V3();
  for (const { pos, idx } of prims) for (let t = 0; t < idx.length; t += 3) {
    a.fromArray(pos, idx[t] * 3); b.fromArray(pos, idx[t + 1] * 3); c.fromArray(pos, idx[t + 2] * 3);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    for (let k = 0; k < 3; k++) { const kk = key(pos, idx[t + k]); (acc.get(kk) ?? acc.set(kk, V3()).get(kk)).add(n); }
  }
  for (const p of prims) {
    const n = p.pos.length / 3, col = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = (acc.get(key(p.pos, i)) ?? V3(0, 1, 0)).clone(); if (v.lengthSq() < 1e-20) v.set(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]); v.normalize();
      col.set([Math.round((v.x * 0.5 + 0.5) * 255), Math.round((v.y * 0.5 + 0.5) * 255), Math.round((v.z * 0.5 + 0.5) * 255), 255], i * 4);
    }
    p.col = col;
  }
}
function reorder(p, targets) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(p.idx, true, true);
  const out = (src, k, Ty) => { const d = new Ty(unique * k); for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let j = 0; j < k; j++) d[remap[i] * k + j] = src[i * k + j]; return d; };
  p.pos = out(p.pos, 3, Float32Array); p.nrm = out(p.nrm, 3, Float32Array); p.uv = out(p.uv, 2, Float32Array); if (p.col) p.col = out(p.col, 4, Uint8Array);
  if (p.targets) p.targets = p.targets.map((d) => out(d, 3, Float32Array));
}
const srgbToLinear = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

function writeGlb(asset, groups, images, path) {
  const json = { asset: { version: '2.0', generator: 'game-studio art/tools/build-props-dressing-ch1.mjs' }, scene: 0, scenes: [{ name: asset.name, nodes: [0] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [], textures: [], images: [],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], extensionsUsed: [], extensionsRequired: [] };
  const chunks = []; let off = 0, fb = 0;
  const pushBin = (u8) => { const o = off; chunks.push(u8); off += u8.byteLength; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } return o; };
  const view = (u8, stride, count, mode, target) => {
    const bv = { buffer: 0, byteOffset: 0, byteLength: u8.byteLength }; if (stride && mode === 'ATTRIBUTES') bv.byteStride = stride; if (target) bv.target = target;
    if (mode) { const enc = MeshoptEncoder.encodeGltfBuffer(u8, count, stride, mode, 0); bv.buffer = 1; bv.byteOffset = fb; fb += Math.ceil(u8.byteLength / 4) * 4;
      bv.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: pushBin(enc), byteLength: enc.byteLength, byteStride: stride, count, mode } }; }
    else bv.byteOffset = pushBin(u8);
    return json.bufferViews.push(bv) - 1;
  };
  const acc = (o) => json.accessors.push(o) - 1;
  const u8 = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  const texIdx = {}, ext = USE_PNG ? null : 'EXT_texture_webp';
  for (const [k, file] of Object.entries(images)) {
    const data = readFileSync(file); const bv = json.bufferViews.push({ buffer: 0, byteOffset: pushBin(data), byteLength: data.byteLength }) - 1;
    const img = json.images.push({ name: `${SET}-${k}`, bufferView: bv, mimeType: USE_PNG ? 'image/png' : 'image/webp' }) - 1;
    texIdx[k] = json.textures.push(ext ? { sampler: 0, extensions: { [ext]: { source: img } } } : { sampler: 0, source: img }) - 1;
  }
  if (ext) { json.extensionsUsed.push(ext); json.extensionsRequired.push(ext); }
  const usedMats = [...new Set(groups.flatMap((g) => g.lods.flat().map((p) => p.mat)))].sort(), matIndex = {};
  for (const m of usedMats) {
    const base = { pbrMetallicRoughness: { baseColorTexture: { index: texIdx.albedo }, metallicRoughnessTexture: { index: texIdx.orm }, metallicFactor: 1, roughnessFactor: 1 },
      normalTexture: { index: texIdx.normal, scale: 1 }, occlusionTexture: { index: texIdx.orm, strength: 1 }, emissiveFactor: [0, 0, 0] };
    matIndex[m] = json.materials.push(m === MAT ? { name: 'mat-prop-dressing-ch1', ...base, extras: { atlas: SET, noEmissive: true, note: '027 剧情物件 / 场景小物共用图集；无自发光（style §0：不发暖光）' } }
      : { name: 'mat-env-vegetation-ch1', ...base, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true, extras: { atlas: SET, cutout: true, windSway: true, outline: false, note: '植被剪影卡片：风摆按节点 extras.windSway，颜色发灰' } }) - 1;
  }
  const meshPrim = (p) => {
    const n = p.pos.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.pos[i * 3 + k]); max[k] = Math.max(max[k], p.pos[i * 3 + k]); }
    const idx = n < 65536 ? new Uint16Array(p.idx) : p.idx;
    const attributes = {
      POSITION: acc({ bufferView: view(u8(p.pos), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3', min, max }),
      NORMAL: acc({ bufferView: view(u8(p.nrm), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3' }),
      TEXCOORD_0: acc({ bufferView: view(u8(p.uv), 8, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC2' }) };
    if (p.col) attributes.COLOR_0 = acc({ bufferView: view(u8(p.col), 4, n, 'ATTRIBUTES', 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
    const prim = { attributes, indices: acc({ bufferView: view(u8(idx), idx.BYTES_PER_ELEMENT, p.idx.length, 'TRIANGLES', 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' }), mode: 4, material: matIndex[p.mat] };
    if (p.targets) prim.targets = p.targets.map((d) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], d[i * 3 + k]); mx[k] = Math.max(mx[k], d[i * 3 + k]); }
      return { POSITION: acc({ bufferView: view(u8(d), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx }) }; });
    return prim;
  };
  const root = { name: asset.name, children: [], extras: asset.extras }; json.nodes.push(root);
  const lodNodes = [];
  for (const g of groups) g.lods.forEach((prims, i) => {
    const mesh = { name: `${g.name}_lod${i}`, primitives: prims.map(meshPrim) };
    if (prims[0].targets) { mesh.weights = prims[0].targets.map(() => 0); mesh.extras = { targetNames: ['flap-up', 'flap-down'] }; }
    const mi = json.meshes.push(mesh) - 1;
    const node = { name: `${g.name}_lod${i}`, mesh: mi }; if (g.extras) node.extras = g.extras;
    const ni = json.nodes.push(node) - 1; root.children.push(ni); lodNodes.push(ni);
  });
  for (const h of asset.helpers ?? []) root.children.push(json.nodes.push({ name: asset.name + h.suffix, translation: h.t, ...(h.extras ? { extras: h.extras } : {}) }) - 1);
  if (asset.anim) {   // seabird-flap：0 → 0.3 s 上 → 下，0.6 s 回到上；LINEAR
    const times = new Float32Array([0, 0.15, 0.3, 0.45, 0.6]), w = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, 0]);
    const ti = acc({ bufferView: view(u8(times)), componentType: 5126, count: times.length, type: 'SCALAR', min: [0], max: [0.6] });
    const wi = acc({ bufferView: view(u8(w)), componentType: 5126, count: w.length, type: 'SCALAR' });
    json.animations = [{ name: 'seabird-flap', samplers: [{ input: ti, output: wi, interpolation: 'LINEAR' }], channels: lodNodes.map((n) => ({ sampler: 0, target: { node: n, path: 'weights' } })) }];
  }
  json.extensionsUsed.push('EXT_meshopt_compression'); json.extensionsRequired.push('EXT_meshopt_compression');
  json.buffers.push({ byteLength: off }, { byteLength: fb, extensions: { EXT_meshopt_compression: { fallback: true } } });
  const bin = new Uint8Array(off); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length, hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(total, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  writeFileSync(path, Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), Buffer.from(bin)]));
}

// ---------- 主流程 ----------
await MeshoptEncoder.ready;
const tmp = mkdtempSync(join(tmpdir(), 'props-027-'));
const images = Object.fromEntries(['albedo', 'normal', 'orm'].map((k) => {
  const src = join(TEX, `${SET}-${k}.png`); if (USE_PNG) return [k, src];
  const dst = join(tmp, `${SET}-${k}.webp`);
  execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(src)}).save(${JSON.stringify(dst)}, 'WEBP', quality=${k === 'albedo' ? 90 : 95}, method=4${k === 'albedo' ? ', exact=True' : ''})`]);
  return [k, dst];
}));
let fail = false;
for (const a of ASSETS) {
  if (ONLY.length && !ONLY.includes(a.name)) continue;
  const groups = (a.groups ?? [{ name: a.name, make: a.make, levels: a.levels, extras: a.groupExtras }]).map((g) => ({ ...g, lods: Array.from({ length: g.levels }, (_, q) => g.make(q)) }));
  const veg = a.dir === 'env';
  for (const g of groups) for (const prims of g.lods) {
    if (prims.targets) prims.forEach((p, i) => { p.targets = prims.targets.map((t) => t[i]); });
    if (!veg) outlineColors(prims);
    prims.forEach((p) => reorder(p));
  }
  const outDir = join(ART, 'models', a.dir ?? 'props'); mkdirSync(outDir, { recursive: true });
  writeGlb(a, groups, images, join(outDir, `${a.name}.glb`));
  const per = groups.map((g) => g.lods.map(tris));
  const lod0 = per.reduce((s, l) => s + l[0], 0), ok = lod0 <= a.cap; fail ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${a.name}  LOD0 ${lod0} / ${a.cap}  (${groups.map((g, i) => `${g.name}: ${per[i].join(' / ')}`).join('；')})`);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
