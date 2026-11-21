// 第一章解谜道具（需求单 021）程序化建模 → GLB。无需 Blender，只用 game/node_modules 里已有的 three 与 meshoptimizer。
//   node art/tools/build-props-ch1.mjs [--no-meshopt] [--png] [--only=prop-key-cellar-s2,…]
// 输出：art/models/props/prop-lantern-brass.glb、prop-lantern-stand-s2.glb、prop-key-cellar-s2.glb、prop-tide-bell.glb（--only 只重建列出的道具）
// 约定（v0.1-index §5）：1 单位 = 1 m，+Y 向上，正面朝 +Z；风灯 / 灯台根节点 extras.puzzleCritical=true、只有 LOD0；
//   地窖钥匙按 2026-10-30 需求带 LOD0/1/2（_lod0/_lod1/_lod2），所以根节点不标 puzzleCritical（标了游戏载入时会丢掉 LOD1/2）；
//   COLOR_0 = 平滑法线（网格本地 glTF 空间，n*0.5+0.5，RGBA8 归一化），给外扩描边用——材质不要开 vertexColors。
// 贴图：art/source/textures/tex-props-puzzle-ch1-*.png（共用图集），默认转 WebP 内嵌（EXT_texture_webp）；--png 则内嵌 PNG。
//   正式交付前仍需转 KTX2（art/tools/tex-to-ktx2.sh），见 README。
import * as THREE from '../../game/node_modules/three/build/three.module.js';
import { MeshoptEncoder } from '../../game/node_modules/meshoptimizer/index.js';
import { mergeGeometries, mergeVertices } from '../../game/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = join(ART, 'source/textures');
const OUT = join(ART, 'models/props');
const USE_MESHOPT = !process.argv.includes('--no-meshopt');
const USE_PNG = process.argv.includes('--png');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=').slice(7).split(',').filter(Boolean);

// ---------- 图集分区（glTF UV：v=0 在图像顶部） ----------
// [u0, v0, 宽, 高]。铁皮象限左右各半：tinCold = 风灯冷灰蓝铁皮（少量锈斑），tin = 灯台旧铁（立柱/罩壳/支臂）
const REGION = { brass: [0, 0.5, 0.5, 0.5], tinCold: [0.5, 0.5, 0.25, 0.5], tin: [0.75, 0.5, 0.25, 0.5], stone: [0, 0, 0.5, 0.5], reflector: [0.5, 0, 0.5, 0.5],
  // 潮汐钟专用贴图 tex-prop-tide-bell（MAT_BELL）：钟体 / 石柱 / 熟铁 / 刻度板，见 art/source/props/gen_tex_tide_bell.py
  tbBronze: [0, 0, 1, 0.5], tbStone: [0, 0.5, 0.75, 0.375], tbIron: [0.75, 0.5, 0.25, 0.375], tbScale: [0, 0.875, 1, 0.125] };
const PAD = 0.012;

// ---------- 几何工具 ----------
const V2 = (r, y) => new THREE.Vector2(r, y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const MAT_ATLAS = 0, MAT_GLOW = 1, MAT_BELL = 2, MAT_RAFT = 3;
const MAT_TEXSET = { [MAT_ATLAS]: 'tex-props-puzzle-ch1', [MAT_BELL]: 'tex-prop-tide-bell', [MAT_RAFT]: 'tex-prop-raft-s1' };

class Builder {
  constructor() { this.parts = []; }
  add(geom, region, mat = MAT_ATLAS, matrix = null, uvScale = [1, 1]) {
    const g = geom.index ? geom : geom.setIndex([...Array(geom.attributes.position.count).keys()]);
    if (matrix) g.applyMatrix4(matrix);
    const uv = g.attributes.uv;
    if (region) {
      const [u0, v0, w, h] = REGION[region];
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i) * uvScale[0], v = uv.getY(i) * uvScale[1]; // uvScale ≤ 1：按比例压短边，避免拉伸（图集内不能平铺）
        uv.setXY(i, u0 + PAD + u * (w - 2 * PAD), v0 + PAD + (1 - v) * (h - 2 * PAD));
      }
    } else for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.99, 0.99);
    this.parts.push({ g, mat });
    return this;
  }
  // UV 已是最终图集坐标（木筏按物理尺寸直接写像素 UV），不再映射分区
  addRaw(geom, mat, matrix = null) {
    const g = geom.index ? geom : geom.setIndex([...Array(geom.attributes.position.count).keys()]);
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push({ g, mat });
    return this;
  }
  // 合并成按材质分组的 primitives
  build() {
    const mats = [...new Set(this.parts.map((p) => p.mat))].sort();
    return mats.map((mat) => {
      const P = [], N = [], U = [], I = [];
      for (const { g, mat: m } of this.parts) {
        if (m !== mat) continue;
        const base = P.length / 3;
        P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); U.push(...g.attributes.uv.array);
        for (const i of g.index.array) I.push(base + i);
      }
      return { mat, pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx: new Uint32Array(I) };
    });
  }
}
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(Math.max(r, 1e-5), y)), seg);
const tube = (pts, r, seg = 24, rad = 8, curveType = 'catmullrom') =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V3(...p)), false, curveType, 0.5), seg, r, rad, false);
// 两端加半球封口的管子（不露空心管口）
function cappedTube(b, pts, r, seg, rad, region, uvScale, mat = MAT_ATLAS) {
  b.add(tube(pts, r, seg, rad), region, mat, null, uvScale);
  for (const p of [pts[0], pts[pts.length - 1]]) b.add(new THREE.SphereGeometry(r, rad, 4), region, mat, T(...p));
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a) => new THREE.Matrix4().makeRotationX(a);
const RY = (a) => new THREE.Matrix4().makeRotationY(a);
const RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const mul = (...ms) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4());

// ---------- 风灯 prop-lantern-brass：原点 = 提环抓握点，底部 y = -0.28 ----------
const LANTERN_H = 0.28;
const FLAME_Y = -0.162;
function lantern() {
  const b = new Builder();
  // 油箱（发暗铁皮）
  b.add(lathe([[0, -0.28], [0.06, -0.28], [0.066, -0.278], [0.071, -0.272], [0.074, -0.262], [0.074, -0.247],
    [0.07, -0.234], [0.06, -0.224], [0.046, -0.218], [0.036, -0.215], [0, -0.215]], 32), 'tinCold', MAT_ATLAS, null, [1, 0.18]);
  // 油箱底边加强圈
  b.add(new THREE.TorusGeometry(0.062, 0.003, 6, 32), 'tinCold', MAT_ATLAS, mul(T(0, -0.279, 0), RX(Math.PI / 2)));
  // 加油口（黄铜小盖）
  b.add(lathe([[0, -0.222], [0.009, -0.222], [0.01, -0.214], [0.008, -0.21], [0, -0.21]], 12), 'brass', MAT_ATLAS, T(0.048, 0.0, 0.018));
  // 灯头座 + 拨芯轮（黄铜）
  b.add(lathe([[0.036, -0.215], [0.041, -0.213], [0.041, -0.202], [0.036, -0.198], [0.034, -0.192], [0.031, -0.19], [0.026, -0.19]], 28), 'brass');
  b.add(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16), 'brass', MAT_ATLAS, mul(T(0.0, -0.205, 0.046), RX(Math.PI / 2)));
  b.add(new THREE.CylinderGeometry(0.002, 0.002, 0.012, 6), 'brass', MAT_ATLAS, mul(T(0.0, -0.205, 0.04), RX(Math.PI / 2)));
  // 玻璃罩（发光材质，烟熏玻璃）+ 火苗
  b.add(lathe([[0.03, -0.19], [0.04, -0.183], [0.049, -0.17], [0.054, -0.155], [0.055, -0.142], [0.052, -0.126],
    [0.044, -0.111], [0.035, -0.1], [0.03, -0.095]], 32), null, MAT_GLOW);
  b.add(lathe([[0, -0.18], [0.004, -0.178], [0.007, -0.17], [0.0075, -0.163], [0.005, -0.153], [0.002, -0.146], [0, -0.142]], 12), null, MAT_GLOW);
  // 玻璃罩上下压圈（铁皮）
  b.add(new THREE.TorusGeometry(0.033, 0.0028, 6, 32), 'tinCold', MAT_ATLAS, mul(T(0, -0.19, 0), RX(Math.PI / 2)));
  b.add(new THREE.TorusGeometry(0.032, 0.0028, 6, 32), 'tinCold', MAT_ATLAS, mul(T(0, -0.096, 0), RX(Math.PI / 2)));
  // 护丝：4 根竖丝贴着玻璃外形 + 2 道横箍（铁皮）
  const prof = [[0.042, -0.19], [0.05, -0.182], [0.059, -0.168], [0.064, -0.152], [0.064, -0.138], [0.06, -0.122], [0.05, -0.106], [0.04, -0.097]];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    b.add(tube(prof.map(([r, y]) => [r * Math.cos(a), y, r * Math.sin(a)]), 0.0018, 18, 5), 'tinCold', MAT_ATLAS, null, [1, 0.1]);
  }
  b.add(new THREE.TorusGeometry(0.0645, 0.0018, 6, 40), 'tinCold', MAT_ATLAS, mul(T(0, -0.148, 0), RX(Math.PI / 2)));
  b.add(new THREE.TorusGeometry(0.057, 0.0018, 6, 40), 'tinCold', MAT_ATLAS, mul(T(0, -0.118, 0), RX(Math.PI / 2)));
  // 两侧风管（铁皮框）：从油箱肩部直上到顶盖，顶端挂耳
  for (const s of [-1, 1]) {
    b.add(tube([[s * 0.064, -0.236, 0], [s * 0.071, -0.226, 0], [s * 0.072, -0.2, 0], [s * 0.072, -0.12, 0],
      [s * 0.071, -0.088, 0], [s * 0.07, -0.074, 0]], 0.0048, 20, 8), 'tinCold', MAT_ATLAS, null, [1, 0.18]);
    b.add(new THREE.TorusGeometry(0.0055, 0.0018, 6, 12), 'brass', MAT_ATLAS, mul(T(s * 0.0715, -0.069, 0), RY(Math.PI / 2)));
    // 风管与顶盖之间的横撑（铁皮）
    cappedTube(b, [[s * 0.07, -0.09, 0], [s * 0.064, -0.09, 0]], 0.0025, 2, 6, 'tinCold');
  }
  // 顶盖（旧黄铜）：外沿 → 斜顶 → 烟囱 → 小帽
  b.add(lathe([[0.029, -0.097], [0.05, -0.096], [0.063, -0.093], [0.066, -0.089], [0.062, -0.084], [0.05, -0.077],
    [0.036, -0.068], [0.026, -0.061], [0.021, -0.058], [0.021, -0.05], [0.027, -0.049], [0.028, -0.046], [0.022, -0.044],
    [0.012, -0.042], [0, -0.041]], 32), 'brass', MAT_ATLAS, null, [1, 0.45]);
  // 提环（旧黄铜）：上半圆，顶点 = 原点
  b.add(new THREE.TorusGeometry(0.0715, 0.0024, 6, 40, Math.PI), 'brass', MAT_ATLAS, T(0, -0.0715, 0), [1, 0.07]);
  // 握把套（黄铜管），以原点为中心
  b.add(lathe([[0.0042, -0.022], [0.0058, -0.02], [0.0058, 0.02], [0.0042, 0.022]], 16), 'brass', MAT_ATLAS, RZ(Math.PI / 2));
  return {
    name: 'prop-lantern-brass',
    prims: b.build(),
    collider: new THREE.CylinderGeometry(0.075, 0.075, LANTERN_H, 12).applyMatrix4(T(0, -LANTERN_H / 2, 0)),
    helpers: [
      { suffix: '-interact', t: [0, -LANTERN_H, 0.6], r: [0, 1, 0, 0] }, // 站在正前方 0.6 m，+Z 朝向风灯
      { suffix: '-emitter', t: [0, FLAME_Y, 0] },
    ],
  };
}

// ---------- 灯台 prop-lantern-stand-s2：原点 = 底面中心，高约 1.0 m，聚光罩开口朝 +Z ----------
const TRAY_TOP = 0.728;
const SOCKET_Y = TRAY_TOP + LANTERN_H; // 风灯提环抓握点（风灯原点）放这里
const BEAM_Y = SOCKET_Y + FLAME_Y;
function stand() {
  const b = new Builder();
  // 石座：两层倒角方墩
  const stoneBlock = (w, h, d, y, bev) => {
    const g = new THREE.BoxGeometry(w, h, d, 2, 1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - bev)); p.setZ(i, p.getZ(i) * (1 - bev)); }
    g.computeVertexNormals();
    b.add(g, 'stone', MAT_ATLAS, T(0, y, 0));
  };
  stoneBlock(0.38, 0.09, 0.38, 0.045, 0.06);
  stoneBlock(0.27, 0.06, 0.27, 0.12, 0.1);
  // 铁立柱（铁皮区）：底座法兰 + 柱身 + 顶部承口
  b.add(lathe([[0, 0.15], [0.055, 0.15], [0.055, 0.158], [0.04, 0.166], [0.03, 0.18], [0.025, 0.21], [0.022, 0.25],
    [0.021, 0.6], [0.023, 0.66], [0.03, 0.676], [0.03, 0.686], [0.024, 0.692], [0.02, 0.7]], 24), 'tin', MAT_ATLAS, null, [0.4, 1]);
  for (const y of [0.3, 0.45]) b.add(new THREE.TorusGeometry(0.023, 0.004, 6, 24), 'tin', MAT_ATLAS, mul(T(0, y, 0), RX(Math.PI / 2)));
  // 托盘
  b.add(lathe([[0.018, 0.698], [0.05, 0.706], [0.088, 0.712], [0.1, 0.717], [0.103, 0.722], [0.103, 0.735],
    [0.098, 0.737], [0.096, 0.73], [0.088, TRAY_TOP], [0, TRAY_TOP]], 32), 'tin');
  // 聚光罩：抛物面 z = Z0 + r²/(4f)，绕 +Z 轴 240°（下方 120° 留空给立柱和托盘）
  const R = 0.17, Z0 = -0.14, F4 = 0.24, RINGS = 12, SEG = 48, A0 = (-2 * Math.PI) / 3, A1 = (2 * Math.PI) / 3;
  const zOf = (r) => Z0 + (r * r) / F4;
  const dish = (offset, flip, region) => {
    const pos = [], uv = [], idx = [];
    const ptOf = (r, a) => {
      // 抛物面法线（朝 +Z/焦点一侧）：(-r/2f·dir, 1)
      const n = V3((-2 * r / F4) * Math.sin(a), (-2 * r / F4) * Math.cos(a), 1).normalize();
      return V3(r * Math.sin(a), BEAM_Y + r * Math.cos(a), zOf(r)).addScaledVector(n, offset);
    };
    for (let i = 0; i <= RINGS; i++) for (let j = 0; j <= SEG; j++) {
      const r = (R * i) / RINGS, a = A0 + ((A1 - A0) * j) / SEG, p = ptOf(r, a);
      pos.push(p.x, p.y, p.z); uv.push(j / SEG, i / RINGS);
    }
    const w = SEG + 1;
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
      const a = i * w + j, c = a + w;
      const tris = i === 0 ? [[a, c, c + 1]] : [[a, c, c + 1], [a, c + 1, a + 1]];
      for (const t of tris) idx.push(...(flip ? [t[0], t[2], t[1]] : t));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    b.add(g, region);
  };
  dish(0, true, 'reflector'); // 内面：正面朝 +Z（焦点）
  dish(-0.004, false, 'tin'); // 外壳
  // 罩沿卷边 + 两条开口侧边
  const rim = [];
  for (let j = 0; j <= 64; j++) { const a = A0 + ((A1 - A0) * j) / 64; rim.push([R * Math.sin(a), BEAM_Y + R * Math.cos(a), zOf(R) - 0.002]); }
  cappedTube(b, rim, 0.0042, 96, 8, 'tin', [1, 0.05]);
  for (const a of [A0, A1]) {
    const edge = [];
    for (let i = 0; i <= 8; i++) { const r = (R * i) / 8; edge.push([r * Math.sin(a), BEAM_Y + r * Math.cos(a), zOf(r) - 0.002]); }
    cappedTube(b, edge, 0.0032, 16, 6, 'tin');
  }
  // 罩背加强筋 + 顶部提钮
  for (const a of [-Math.PI / 3, 0, Math.PI / 3]) {
    const rib = [];
    for (let i = 1; i <= 8; i++) { const r = (R * i) / 8; rib.push([r * Math.sin(a), BEAM_Y + r * Math.cos(a), zOf(r) - 0.006]); }
    cappedTube(b, rib, 0.003, 16, 6, 'tin');
  }
  b.add(lathe([[0, -0.012], [0.012, -0.012], [0.014, -0.008], [0.01, 0.0], [0, 0.004]], 16), 'tin', MAT_ATLAS,
    mul(T(0, BEAM_Y, Z0 - 0.004), RX(-Math.PI / 2)));
  // 两根支臂：从托盘下方的立柱出发，绕到托盘外沿之外再上行，收进罩背（壳体背面），不出罩沿、不穿托盘
  const backOf = (r, a, back = 0.006) => [r * Math.sin(a), BEAM_Y + r * Math.cos(a), zOf(r) - back];
  for (const s of [-1, 1]) {
    cappedTube(b, [[s * 0.016, 0.664, -0.012], [s * 0.04, 0.672, -0.08], [s * 0.055, 0.7, -0.128], [s * 0.06, 0.76, -0.136],
      backOf(0.07, s * (115 * Math.PI) / 180, 0.009)], 0.0055, 32, 8, 'tin', [1, 0.15]);
  }
  // 背撑：立柱 → 托盘外沿下方 → 罩背中心
  cappedTube(b, [[0, 0.664, -0.016], [0, 0.69, -0.13], [0, 0.78, -0.158], [0, BEAM_Y - 0.01, Z0 - 0.012]], 0.0065, 28, 8, 'tin');
  return {
    name: 'prop-lantern-stand-s2',
    prims: b.build(),
    collider: new THREE.BoxGeometry(0.38, 1.02, 0.38).applyMatrix4(T(0, 0.51, -0.02)),
    helpers: [
      { suffix: '-socket', t: [0, SOCKET_Y, 0] }, // 风灯原点（提环抓握点）对齐到这里
      { suffix: '-emitter-dir', t: [0, BEAM_Y, 0] }, // 单位旋转：+Z = 出光方向
      { suffix: '-interact', t: [0, 0, -0.65] }, // 站在灯台背后，+Z 朝向灯台，不挡光（返工 2026-10-29：原 -0.70，灯台向汐挪 5 cm，对齐 017 xi-place/xi-pickup）
    ],
  };
}

// ---------- 地窖钥匙 prop-key-cellar-s2（S2，2026-10-30）：旧黄铜钥匙，长 9.5 cm、厚 6 mm ----------
// 原点 = 握点：钥匙底面上、中指 / 食指指腹压住的那一点（杆身上，环与齿之间）。
// 平放姿态 = 根节点直接放在 env-cellar-s2-key-socket（socket 的 +Y 朝上、+Z = 汐面朝木架的前方、+X = 汐的左手边）：
//   长边沿本地 X，环（bow）在 -X（汐的右手边）、齿（bit）在 +X，齿朝 -Z（朝她）伸出；底面 y = 0 贴架面，最高 6 mm。
// 挂手：xi-pickup-shelf grab 第 22 帧挂到 middle_03_r，偏移见 KEY_ATTACH（art/tools/key-attach-offset.mjs 按 char-xi + char-xi-anims 算出）。
// v0.1-029 钥匙材质（制作人 10-30 同意 S2 方案 C 后）：单独材质 mat-prop-key-brass，仍用 tex-props-puzzle-ch1 图集黄铜区（不加贴图），只改系数：
//   金属度 ×KEY_MAT.metal（图集黄铜 = 1 → 旧黄铜带氧化层，一部分按非金属吃到光照贴图 / 半球光的漫反射，暗处不再纯黑）；
//   粗糙度 ×KEY_MAT.rough（图集中位 0.52 → 约 0.23，点光下高光集中成一点闪光）。不自发光（emissive 0），不是发光道具。
const MAT_KEY = 14;
const KEY_MAT = { metal: 0.6, rough: 0.45 };
MAT_TEXSET[MAT_KEY] = 'tex-props-puzzle-ch1';
const KEY_T = 0.003; // 杆 / 环管半径 → 厚 6 mm
// 由 `node art/tools/key-attach-offset.mjs` 生成（钥匙根在 middle_03_r 骨骼空间的固定偏移）
const KEY_ATTACH = {"bone": "middle_03_r", "clip": "xi-pickup-shelf", "atFrame": 22, "atTimeS": 0.7333, "translation": [-0.00843, 0.02492, 0.00414], "rotation": [0.04513, -0.26586, 0.96208, 0.04104], "note": "xi-pickup-shelf grab 第 22 帧把钥匙挂到 middle_03_r，之后固定：key.matrix = middle_03_r.matrixWorld × (translation, rotation)，缩放 1；这一帧算出来的钥匙正好在 key-socket 上不跳。只挂 hand_r 的话在同一帧按 inverse(hand_r) × socket 现算"};
function keyCellar(name = 'prop-key-cellar-s2') {
  const lh = name === 'prop-key-lighthouse';
  const lod = (torSeg, torRad, cylSeg, collar, teeth) => {
    const b = new Builder();
    // 环（bow）：平躺的圆环，中心 x -0.0335，环中心线半径 12.5 mm
    b.add(new THREE.TorusGeometry(0.0125, KEY_T, torRad, torSeg), 'brass', MAT_KEY, mul(T(-0.0335, KEY_T, 0), RX(Math.PI / 2)), [1, 0.25]);
    // 杆（shank）：x -0.021 → 0.046
    b.add(new THREE.CylinderGeometry(KEY_T, KEY_T, 0.067, cylSeg, 1), 'brass', MAT_KEY, mul(T(0.0125, KEY_T, 0), RZ(Math.PI / 2)), [0.3, 1]);
    // 颈箍（collar）：环和杆交接处一道略粗的箍，底面仍贴 y = 0
    if (collar) b.add(new THREE.CylinderGeometry(0.0038, 0.0038, 0.004, cylSeg, 1), 'brass', MAT_KEY, mul(T(-0.017, 0.0038, 0), RZ(Math.PI / 2)), [0.3, 0.3]);
    // 齿（bit）：x 0.030–0.044，朝 -Z 伸出 14 mm，厚 5 mm；LOD0 中间开一道槽（两齿）
    const box = (x0, x1, z0, z1) => b.add(new THREE.BoxGeometry(x1 - x0, 0.005, z1 - z0), 'brass', MAT_KEY, T((x0 + x1) / 2, 0.003, (z0 + z1) / 2), [0.3, 0.3]);
    if (teeth) { box(0.030, 0.035, -0.017, -0.001); box(0.039, 0.044, -0.017, -0.001); box(0.035, 0.039, -0.009, -0.001); }
    else box(0.030, 0.044, -0.017, -0.001);
    return b.build();
  };
  return {
    name,
    lods: lh ? [lod(16, 6, 8, true, true)] : [lod(16, 6, 8, true, true), lod(10, 4, 6, true, false), lod(8, 3, 4, false, false)],
    collider: new THREE.BoxGeometry(0.095, 0.0065, 0.032).applyMatrix4(T(-0.0015, 0.00325, -0.0005)),
    helpers: lh ? [{ suffix: '-interact', t: [0, 0.01, -0.005], extras: { interact: true, pickup: true, note: '§5.4 puzzleCritical 必须有交互点：拾取提示点 = 钥匙中心上方 1 cm（地窖钥匙没有这个节点，其余节点 / attach 不变）' } }] : [],
    rootExtras: {
      pickup: true,
      restNode: 'env-cellar-s2-key-socket',
      rest: '平放：根节点直接对齐 env-cellar-s2-key-socket（位置 + 旋转，不加偏移）即贴在 1.10 m 架面上，环在汐右手边、齿在左手边、齿朝她',
      lengthM: 0.095, thicknessM: 0.006,
      ...(KEY_ATTACH ? { attach: KEY_ATTACH } : {}),
      ...(lh ? { puzzleCritical: true, ticket: 'v0.1-022', sameModelAs: 'prop-key-cellar-s2', lods: 1, note: '灯塔钥匙正式文件（美术回复 10-30 第 1 条）：和地窖钥匙同一模型、同节点、同 attach，只交 LOD0（puzzleCritical）。程序入口优先它，缺失回退 prop-key-cellar-s2' } : {}),
    },
  };
}

// ---------- 潮汐钟 prop-tide-bell（需求单 021；S1 / S3 同一模型、同尺寸、不缩放） ----------
// 原点 = 钟轴正下方的台面点（y 0 = 站台面）；+Z = 正面（朝汐 / 交互点）；石柱在 -X（汐面对钟时的左手边）。
// puzzleCritical：只交 LOD0（需求单「潮汐钟 puzzleCritical = 是」、index §5.4、style-guide §8）。
// 节点：prop-tide-bell（根）→ prop-tide-bell_lod0（石柱 + 刻度板 + 熟铁支臂 / 叉板 / 销，静止）
//                         → bell-swing（空节点，原点 = 吊点 = 销轴中心）→ bell-swing-mesh（钟体）、bell-clapper（空，原点 = 锤环吊点）→ bell-clapper-mesh
//                         → prop-tide-bell-collider、prop-tide-bell-interact、prop-tide-bell-contact
// 摆动：bell-swing / bell-clapper 都绕本地 +X 轴转（销沿 X）；正角 = 钟口往 -Z 摆（被汐推开的方向）。
const TB_PROF = JSON.parse(readFileSync(join(ART, 'source/props/prop-tide-bell.profile.json'), 'utf8'));
const TB = {
  pivotY: TB_PROF.pivotY, clapperY: 1.52, pillarX: -0.66, pillarBot: 0.16, pillarTop: 2.02, halfBot: 0.16, halfTop: 0.14,
  contact: [0.04, 1.10, 0.26], interactZ: 0.98,
  // 钟锤锤头（10-30 方案 A 修正：相对钟体约 0.055 rad 碰内壁）：扁球 半径 R、半高 hh，中心在锤环吊点下 L；hitRad = 实际 GLB 网格实测（/workspace/b3/clapper-hit.mjs）
  clapHead: { R: 0.227, hh: 0.06, L: 0.53 }, clapperHitRad: 0.0537, armY: 1.935, braceY: 1.45, tablet: { y0: 0.40, y1: 1.90, w: 0.20, t: 0.03 },
};
const tbHalf = (y) => TB.halfBot + (TB.halfTop - TB.halfBot) * (y - TB.pillarBot) / (TB.pillarTop - TB.pillarBot);
const swapUV = (g) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, 1 - u); } return g; };
// 方截面台体（4 段圆柱，thetaStart π/4 → 各面对齐坐标轴，正面 +Z 不落在接缝上）；UV 转置：列 = 高度
// 把几何 UV 压进 [u0,u1]×[v0,v1]（再交给 Builder 映射到分区），用于小零件取分区里指定的一块
const uvFit = (g, u0, u1, v0, v1) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); return g; };
const sqFrustum = (hb, ht, h) => swapUV(new THREE.CylinderGeometry(ht * Math.SQRT2, hb * Math.SQRT2, h, 4, 1, false, Math.PI / 4));

function bellLathe(seg) {
  const pts = [...TB_PROF.outer, ...TB_PROF.inner];
  const s = [0];
  for (let j = 1; j < pts.length; j++) s.push(s[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  const S = s[s.length - 1];
  // three 的 Lathe 要求剖面自下而上才朝外：反过来排（内壁顶心 → 钟口 → 外壁顶心）
  const rev = pts.slice().reverse(), vRev = s.slice().reverse().map((x) => 1 - x / S);
  const g = new THREE.LatheGeometry(rev.map(([r, y]) => V2(Math.max(r, 1e-5), y - TB.pivotY)), seg, Math.PI, Math.PI * 2);
  const uv = g.attributes.uv, n = rev.length;
  for (let i = 0; i <= seg; i++) for (let j = 0; j < n; j++) uv.setY(i * n + j, vRev[j]);
  return g;
}

function tideBell() {
  const PI = Math.PI;
  // ---- 静止部分：石柱、柱帽、刻度板、铁箍、支臂、斜撑、叉板、销
  const st = new Builder();
  const px = TB.pillarX;
  st.add(sqFrustum(0.245, 0.225, 0.16), 'tbStone', MAT_BELL, T(px, 0.08, 0));                               // 底座
  st.add(sqFrustum(TB.halfBot, TB.halfTop, TB.pillarTop - TB.pillarBot), 'tbStone', MAT_BELL, T(px, (TB.pillarBot + TB.pillarTop) / 2, 0)); // 柱身（微收分）
  st.add(sqFrustum(0.172, 0.19, 0.025), 'tbStone', MAT_BELL, T(px, 2.0325, 0), [1, 0.3]);                   // 柱帽：倒角
  st.add(sqFrustum(0.19, 0.19, 0.05), 'tbStone', MAT_BELL, T(px, 2.07, 0), [1, 0.3]);
  st.add(sqFrustum(0.19, 0.045, 0.11), 'tbStone', MAT_BELL, T(px, 2.15, 0), [1, 0.5]);                       // 四坡顶
  // 刻度板（父亲修整过的一块面，凸出 2.5 cm，随柱身收分略后仰）
  const tb = TB.tablet, tyc = (tb.y0 + tb.y1) / 2, lean = Math.atan((TB.halfBot - TB.halfTop) / (TB.pillarTop - TB.pillarBot));
  st.add(swapUV(new THREE.BoxGeometry(tb.w, tb.y1 - tb.y0, tb.t)), 'tbScale', MAT_BELL, mul(T(px, tyc, tbHalf(tyc) + tb.t / 2 - 0.005), RX(-lean)));
  // 铁箍：支臂处一道、斜撑脚一道
  for (const [y, h] of [[TB.armY, 0.075], [TB.braceY, 0.06]]) {
    const hw = tbHalf(y) + 0.006, L = 2 * hw + 0.012;
    for (const s of [-1, 1]) {
      st.add(new THREE.BoxGeometry(L, h, 0.012), 'tbIron', MAT_BELL, T(px, y, s * hw), [1, 0.2]);
      st.add(new THREE.BoxGeometry(0.012, h, L), 'tbIron', MAT_BELL, T(px + s * hw, y, 0), [1, 0.2]);
    }
    for (const z of [-0.07, 0.07]) st.add(new THREE.CylinderGeometry(0.011, 0.013, 0.012, 8), 'tbIron', MAT_BELL, mul(T(px - hw - 0.012, y, z), RZ(PI / 2)), [0.1, 0.1]); // 背面铆钉头
  }
  // 支臂：扁铁，从柱面伸到钟轴上方再往前一点，端头卷一个涡卷
  const ax0 = px + tbHalf(TB.armY) + 0.012, ax1 = 0.13;
  st.add(new THREE.BoxGeometry(ax1 - ax0, 0.045, 0.028), 'tbIron', MAT_BELL, T((ax0 + ax1) / 2, TB.armY, 0), [1, 0.15]);
  const curl = []; const A = 1.75 * PI;
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * A, R = 0.04 * (1 - 0.55 * a / A); curl.push([ax1 + R * Math.sin(a), TB.armY - 0.04 + R * Math.cos(a), 0]); }
  cappedTube(st, curl, 0.011, 40, 8, 'tbIron', [1, 0.15], MAT_BELL);
  // 斜撑：圆铁，从下铁箍弯上去托住支臂
  cappedTube(st, [[px + tbHalf(TB.braceY) + 0.008, TB.braceY, 0], [-0.43, 1.60, 0], [-0.32, 1.76, 0], [-0.21, 1.885, 0], [-0.15, TB.armY - 0.02, 0]], 0.012, 32, 8, 'tbIron', [1, 0.15], MAT_BELL);
  // 叉板 + 销（销沿 X，销心 = 吊点 = bell-swing 原点）
  for (const s of [-1, 1]) {
    st.add(new THREE.BoxGeometry(0.014, 0.135, 0.05), 'tbIron', MAT_BELL, T(s * 0.06, (TB.armY - 0.022 + TB.pivotY - 0.03) / 2, 0), [0.2, 0.3]);
    st.add(new THREE.CylinderGeometry(0.025, 0.025, 0.014, 14), 'tbIron', MAT_BELL, mul(T(s * 0.06, TB.pivotY, 0), RZ(PI / 2)), [0.1, 0.1]); // 叉板下端圆头
    st.add(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 12), 'tbIron', MAT_BELL, mul(T(s * 0.072, TB.pivotY, 0), RZ(PI / 2)), [0.1, 0.1]);  // 销头
  }
  st.add(new THREE.CylinderGeometry(0.011, 0.011, 0.15, 12), 'tbIron', MAT_BELL, mul(T(0, TB.pivotY, 0), RZ(PI / 2)), [0.2, 0.1]);

  // ---- bell-swing：钟体（几何在吊点局部空间，y 已减 pivotY）
  const bb = new Builder();
  bb.add(bellLathe(112), 'tbBronze', MAT_BELL);
  const neck = [[0.062, 1.568], [0.046, 1.585], [0.037, 1.61], [0.034, 1.70], [0.036, 1.735], [0.03, 1.748]];
  bb.add(uvFit(new THREE.LatheGeometry(neck.map(([r, y]) => V2(r, y - TB.pivotY)), 28), 0.2, 0.5, 0.86, 0.97), 'tbBronze', MAT_BELL); // 取钟肩那一带的铜色
  // 钟钮环：套在销上（环心比销心低 1.9 cm → 销压在环的上内沿）
  bb.add(uvFit(new THREE.TorusGeometry(0.045, 0.015, 12, 28), 0.55, 0.8, 0.86, 0.97), 'tbBronze', MAT_BELL, mul(T(0, -0.019, 0), RY(PI / 2)));
  // 内顶吊锤的 U 形铁鼻
  bb.add(new THREE.TorusGeometry(0.016, 0.005, 6, 14, PI), 'tbIron', MAT_BELL, mul(T(0, TB.clapperY + 0.016 - TB.pivotY, 0), RY(PI / 2), RZ(PI)), [0.1, 0.1]);

  // ---- bell-clapper：钟锤（原点 = 锤环吊点，y = 1.52）
  const cb = new Builder();
  cb.add(new THREE.TorusGeometry(0.018, 0.006, 6, 16), 'tbIron', MAT_BELL, RX(PI / 2), [0.1, 0.1]);
  cb.add(new THREE.CylinderGeometry(0.010, 0.012, 0.47, 10), 'tbIron', MAT_BELL, T(0, -0.035 - 0.235, 0), [0.15, 0.6]);
  const CH = TB.clapHead;   // 扁球锤头（铁坨）：钟口 0.892 以上，正常视角只露锤尖
  cb.add(new THREE.SphereGeometry(1, 32, 14).scale(CH.R, CH.hh, CH.R), 'tbIron', MAT_BELL, T(0, -CH.L, 0), [0.3, 0.3]);
  cb.add(new THREE.CylinderGeometry(0.008, 0.013, 0.08, 10), 'tbIron', MAT_BELL, T(0, -CH.L - CH.hh - 0.035, 0), [0.1, 0.2]);

  // ---- 碰撞：石柱一块 + 钟一块（钟下不让钻）
  const collider = mergeGeometries([
    new THREE.BoxGeometry(0.50, 2.20, 0.50).translate(px, 1.10, 0),
    new THREE.BoxGeometry(0.66, 1.96, 0.66).translate(0, 0.98, 0),
  ].map((g) => g.toNonIndexed()));

  const cz = TB.contact;
  const swingExtras = {
    swing: true, originAt: '吊点 = 销轴中心（节点原点即转轴）', originModel: [0, TB.pivotY, 0], axis: [1, 0, 0],
    positive: '正角 = 钟口往 -Z 摆（被汐从 +Z 推开的方向）',
    contactRadiusM: +(TB.pivotY - cz[1]).toFixed(3),
    pushM: 0.07, pushRad: +Math.asin(0.07 / (TB.pivotY - cz[1])).toFixed(4),
    ringAmplitudeRad: 0.2, ringPeriodS: 1.5, ringDecayS: 1.2,
    idleWindRad: 0.01, idleWindPeriodS: 2.4,
    clearanceRad: 0.35,
    note: 'xi-ring-bell：touch 帧(22)起钟跟着手掌转（角度 = asin(手掌前推量 / 0.70)，到 ring 帧(30) ≈ +0.10 rad），ring 帧离手后按 θ(t) = 0.2·e^(−t/1.2)·sin(2πt/1.5 + asin(0.5)) 自由摆；±0.35 rad 内不碰石柱 / 叉板',
  };
  return {
    name: 'prop-tide-bell',
    lods: [st.build()],
    texSet: 'tex-prop-tide-bell',
    tree: [{
      // 可动节点本身不挂网格（glb-pack 的 Meshopt 量化会把反量化缩放 / 平移写进挂网格的节点，转轴就偏了），网格挂在 -mesh 子节点上
      name: 'bell-swing', t: [0, TB.pivotY, 0], extras: swingExtras,
      children: [{ name: 'bell-swing-mesh', prims: bb.build() }, { name: 'bell-clapper', t: [0, TB.clapperY - TB.pivotY, 0], children: [{ name: 'bell-clapper-mesh', prims: cb.build() }],
        extras: { swing: true, originAt: '锤环吊点（节点原点即转轴）', originModel: [0, TB.clapperY, 0], axis: [1, 0, 0], lengthM: TB.clapHead.L, strikeRad: TB.clapperHitRad,
          headRadiusM: TB.clapHead.R, restGapM: 0.030,
          note: `钟锤：相对 bell-swing 绕本地 +X 摆，|相对角| 到 ${TB.clapperHitRad} rad 时锤头碰内壁（网格实测；= 根 extras.clapperHitRad）。按程序实测：滞后 0.12 s 跟摆时相对角最大 0.061（钟 0.161），所以一敲碰 1 次` } }],
    }],
    collider,
    helpers: [
      { suffix: '-interact', t: [0, 0, TB.interactZ], r: [0, 1, 0, 0],
        extras: { interact: true, anim: 'xi-ring-bell', events: { touch: 22, ring: 30 }, contact: [-0.04, 1.10, 0.72],
          note: '汐站位（台面上，+Z 朝钟），钟轴前 0.98 m；对齐后右手掌心在 touch 帧贴到 prop-tide-bell-contact' } },
      { suffix: '-contact', t: cz, extras: { note: '掌心触点（钟静止时，钟腰外壁，离台面 1.10 m、偏汐右手 4 cm；此处钟外半径 0.2635）' } },
    ],
    rootExtras: {
      puzzleCritical: true,
      puzzle: 'tide-bell', ticket: 'v0.1-021', sameModel: ['S1 tide-bell-s1', 'S3 tide-bell-s3'], scale: 1,
      originAt: '钟轴正下方的站台面点（y 0 = 台面）；对齐场景 socket / bellAnchor 时直接放根节点，不加偏移',
      front: '+Z = 正面（朝汐）；石柱在 -X（汐的左手边）',
      contact: cz, contactAboveStand: 1.10, interactAheadM: TB.interactZ,
      swingNode: 'bell-swing', clapperNode: 'bell-clapper', focus: [0, 1.35, 0],
      heightM: 2.205, bellLipY: 0.892, bellLipRadiusM: 0.314, hangPointY: TB.pivotY,
      clapperHitRad: TB.clapperHitRad,
      clapperHitNote: '钟锤相对钟体（bell-clapper 相对 bell-swing）转到这个角度时锤头碰内壁：实际 GLB 网格实测（锤头扁球 R 0.227、静止离内壁约 3 cm），程序按它补碰壁音',
    },
  };
}

// ---------- 021 浮台 prop-raft-s1（S1 搁浅木筏，推到石槽当桥） ----------
// 本地坐标 = 白盒 raft-s1 根：原点 = 甲板顶面中心，y 0 = 甲板顶（layout raft.home y 0.4 = 搁浅时甲板顶），轴向同世界（挂 raft-s1 下不旋转）。
// 外形 2.0 (x) × 3.0 (z) × 0.3 (y 0 → −0.30)；全部几何在 |x| ≤ 1.0、|z| ≤ 1.5 内，只有 +X 侧（推的一侧）有推把 / 系船环 / 绳头伸出——石槽 x −1.9..0.62 / 挡坎 z 8.5–8.9 与 12.1–12.5 都不碰。
// UV：直接写 tex-prop-raft-s1 图集像素坐标（分区见 art/source/props/gen_tex_raft.py），按物理尺寸 683 px/m（板 / 原木）不拉伸。
const RF = {
  W: 2.0, L: 3.0, H: 0.3, plankW: 0.215, plankGap: 0.007, plankT: 0.05,
  beamZ: [-1.2, 0, 1.2], beamW: 0.14, beamY0: -0.13, beamY1: -0.05,
  logX: [-0.72, -0.24, 0.24, 0.72], logR: 0.085, logY: -0.215,
  rail: { x0: 0.91, x1: 0.97, y0: 0.24, y1: 0.32, z: 0.42, postZ: 0.33 },
  interact: [1.45, -0.30, 0], palmY: 0.32, palmZ: 0.17, waterline: -0.25, standZ: 1.18, takeoffZ: 1.35,
  ring: [1.04, -0.135, -1.2],
};
const RF_PX = 2048;
const rfRand = (seed) => { let x = seed >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); };
class RfGeo {
  constructor() { this.P = []; this.N = []; this.U = []; this.I = []; }
  v(p, n, uv) { this.P.push(...p); this.N.push(...n); this.U.push(uv[0] / RF_PX, uv[1] / RF_PX); return this.P.length / 3 - 1; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setIndex(this.I); return g;
  }
}
// 凸截面 prof（从 +z 看逆时针）沿 z 拉伸；每条边平面着色；uvEdge(i, x, y, z) / uvCap(x, y, end) 返回像素坐标
function rfExtrude(R, prof, z0, z1, segs, uvEdge, uvCap, yOff = () => 0) {
  const n = prof.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = prof[i], [bx, by] = prof[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay), nx = (by - ay) / len, ny = -(bx - ax) / len;
    const base = R.P.length / 3;
    for (let j = 0; j <= segs; j++) {
      const z = z0 + (z1 - z0) * j / segs, dy = yOff(z);
      R.v([ax, ay + dy, z], [nx, ny, 0], uvEdge(i, ax, ay, z)); R.v([bx, by + dy, z], [nx, ny, 0], uvEdge(i, bx, by, z));
    }
    for (let j = 0; j < segs; j++) { const a = base + j * 2; R.I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  for (const [z, s] of [[z0, -1], [z1, 1]]) {
    const dy = yOff(z), base = R.P.length / 3;
    for (const [x, y] of prof) R.v([x, y + dy, z], [0, 0, s], uvCap(x, y, s));
    for (let i = 1; i < n - 1; i++) s > 0 ? R.I.push(base, base + i, base + i + 1) : R.I.push(base, base + i + 1, base + i);
  }
}
// 几何自带 0..1 UV → 图集像素矩形（v 翻转：几何 v=1 在矩形顶）
const rfRect = (g, x0, y0, w, h) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * w) / RF_PX, (y0 + (1 - uv.getY(i)) * h) / RF_PX); return g; };
const RF_SIDE = (u, v) => [1024 + 6 + ((u % 1.46) + 1.46) % 1.46 * 683, 1536 + 6 + ((v % 0.72) + 0.72) % 0.72 * 683]; // 板侧 / 板底 / 端头：泡水深色旧木（1024×512 = 1.5 × 0.75 m）
const RF_IRON = [4, 1540, 504, 504], RF_ROPE = [1540, 1284, 504, 248];

function raft() {
  const b = new Builder(), M = MAT_RAFT, rnd = rfRand(2101);
  const R = new RfGeo();
  // ---- 甲板：9 块板顺 z 铺（走向 = 跨越方向），顶面 ≤ 0，上缘倒角 8 mm，轻微翘曲只往下
  const pitch = RF.plankW + RF.plankGap, c = 0.008;
  for (let k = 0; k < 9; k++) {
    const cx = (k - 4) * pitch, x0 = cx - RF.plankW / 2, x1 = cx + RF.plankW / 2;
    const top = k === 0 || k === 8 ? 0 : -rnd() * 0.004, yb = top - RF.plankT;
    const outer = k === 0 || k === 8;
    const zA = -1.495 + (outer ? 0 : rnd() * 0.02), zB = 1.495 - (outer ? 0 : rnd() * 0.02);
    const strip = k >= 3 && k <= 5 ? 0 : 1 + (k * 3) % 5, flip = rnd() < 0.5, row = strip * 128;
    const cup = 0.002 + rnd() * 0.002, ph = rnd() * 6.28;
    const yOff = (z) => -cup * (0.5 + 0.5 * Math.sin(z * 1.9 + ph));
    const prof = [[x0, yb], [x1, yb], [x1, top - c], [x1 - c, top], [x0 + c, top], [x0, top - c]];
    const uz = (z) => (flip ? 1.5 - z : z + 1.5) / 3 * 2048;
    rfExtrude(R, prof, zA, zB, 12, (i, x, y, z) => {
      if (i >= 2 && i <= 4) return [uz(z), row + 3 + (x - x0) / RF.plankW * 122];             // 顶面 + 倒角
      if (i === 0) return RF_SIDE(z + 1.5, 0.3 + k * 0.03 + (x - x0));                          // 板底
      return RF_SIDE(z + 1.5, k * 0.07 + (top - y));                                             // 板侧
    }, (x, y, s) => RF_SIDE(1.3 + (x - x0) * 0.6, 0.5 + k * 0.02 + (top - y)), yOff);
  }
  // ---- 3 道横梁（顺 x，压在原木上、托住甲板板）
  for (const [bi, bz] of RF.beamZ.entries()) {
    const hw = RF.beamW / 2, cb = 0.01, BR = new RfGeo();
    const prof = [[-hw + cb, RF.beamY0], [hw - cb, RF.beamY0], [hw, RF.beamY0 + cb], [hw, RF.beamY1], [-hw, RF.beamY1], [-hw, RF.beamY0 + cb]];
    rfExtrude(BR, prof, -1.0, 1.0, 1, (i, x, y, t) => {
      const u = 4 + (t + 1) / 2 * 1016;
      if (i === 3) return [u, 1280 + 4 + bi * 40 + (y - RF.beamY0) / 0.08 * 41];     // 侧面（世界 ∓z）
      if (i === 5) return [u, 1280 + 66 + bi * 20 + (y - RF.beamY0) / 0.08 * 41];
      return [u, 1408 + 4 + (x + hw) / RF.beamW * 72 + (i === 4 ? 40 : 0)];         // 底 / 顶 / 倒角
    }, (x, y, s) => RF_SIDE(0.2 + bi * 0.3 + x, 0.1 + y), () => 0);
    b.addRaw(BR.geo(), M, mul(T(0, 0, bz), RY(Math.PI / 2)));
  }
  // ---- 4 根原木浮筒（顺 z，顶贴横梁底 −0.13，底 −0.30）；半径带噪声但只往里收；端面年轮 + 中心微凸
  RF.logX.forEach((lx, li) => {
    const rad = 20, segs = 24, L = new RfGeo(), rl = rfRand(2200 + li), ph = [rl() * 6.28, rl() * 6.28, rl() * 6.28];
    const z0 = -1.493 + rl() * 0.025, z1 = 1.493 - rl() * 0.025, strip = li % 2;   // 端面微凸 6 mm 后仍 ≤ ±1.5
    const rr = (th, z) => RF.logR * (1 - 0.035 * (0.5 + 0.5 * Math.sin(z * 2.3 + ph[0])) - 0.02 * (0.5 + 0.5 * Math.sin(3 * th + z * 1.7 + ph[1])) - 0.012 * (0.5 + 0.5 * Math.sin(5 * th + ph[2])));
    for (let j = 0; j <= segs; j++) {
      const z = z0 + (z1 - z0) * j / segs;
      for (let i = 0; i <= rad; i++) {
        const th = 2 * Math.PI * i / rad, r = rr(th, z);                                         // θ 从 +Y（顶）往 +X 转；接缝在顶上（压在横梁 / 甲板下）
        L.v([lx + r * Math.sin(th), RF.logY + r * Math.cos(th), z], [Math.sin(th), Math.cos(th), 0], [4 + (z + 1.5) / 3 * 2040, 768 + strip * 256 + 3 + i / rad * 250]);
      }
    }
    for (let j = 0; j < segs; j++) for (let i = 0; i < rad; i++) {
      const a = j * (rad + 1) + i, bb = a + 1, d = a + rad + 1, cc = d + 1;
      L.I.push(a, d, cc, a, cc, bb);
    }
    for (const [z, s] of [[z0, -1], [z1, 1]]) {
      const base = L.P.length / 3, rot = rl() * 6.28;
      L.v([lx, RF.logY, z + s * 0.006], [0, 0, s], [768, 1792]);
      for (let i = 0; i <= rad; i++) {
        const th = 2 * Math.PI * i / rad, r = rr(th, z), sx = Math.sin(th), cy = Math.cos(th);
        const a = th + rot;
        L.v([lx + r * sx, RF.logY + r * cy, z], [0, 0, s], [768 + Math.sin(a) * 226 * r / RF.logR, 1792 - Math.cos(a) * 226 * r / RF.logR]);
      }
      for (let i = 1; i <= rad; i++) s > 0 ? L.I.push(base, base + i + 1, base + i) : L.I.push(base, base + i, base + i + 1);
    }
    b.addRaw(L.geo(), M);
  });
  // ---- 麻绳捆扎：外侧两根原木，每道横梁两边各两圈
  for (const lx of [-0.72, 0.72]) for (const bz of RF.beamZ) for (const s of [-1, 1]) for (const [k, dz] of [[0, 0.082], [1, 0.098]]) {
    const g = rfRect(new THREE.TorusGeometry(RF.logR + 0.006 + k * 0.002, 0.0075, 6, 18), ...RF_ROPE);
    b.addRaw(g, M, mul(T(lx, RF.logY, bz + s * dz), new THREE.Matrix4().makeScale(1, 0.84, 1), RZ(k * 0.4 + (bz + s) * 0.7)));   // 竖向压扁：绳底不低于 −0.30（贴沙不穿）
  }
  // ---- 四角铁包角（压住外侧板头）+ 钉头
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (0.9955 - 0.07);
    b.addRaw(rfRect(new THREE.BoxGeometry(0.14, 0.004, 0.1), 4, 1540, 140, 100), M, T(x, 0.002, sz * 1.445));
    b.addRaw(rfRect(new THREE.BoxGeometry(0.14, 0.055, 0.004), 150, 1540, 140, 55), M, T(x, -0.0255, sz * 1.497));
    for (const dx of [-0.04, 0.04]) b.addRaw(rfRect(new THREE.CylinderGeometry(0.009, 0.01, 0.004, 8), 300, 1700, 30, 30), M, T(x + dx, 0.006, sz * 1.44));
  }
  // ---- 推把（+X 长边）：前面 x 0.97 = 掌心贴合面，顶 y 0.32（离沙 0.62），长 0.84；两立柱 + 向内斜撑（斜撑最内到 x 0.74，不挡中线跨越）
  const rl_ = RF.rail, rc = 0.01, RR = new RfGeo();
  const rprof = [[rl_.x0, rl_.y0], [rl_.x1, rl_.y0], [rl_.x1, rl_.y1 - rc], [rl_.x1 - rc, rl_.y1], [rl_.x0 + rc, rl_.y1], [rl_.x0, rl_.y1 - rc]];
  const ru = (z) => 1024 + 4 + (z + rl_.z) / (2 * rl_.z) * 504;
  rfExtrude(RR, rprof, -rl_.z, rl_.z, 8, (i, x, y, z) => {
    if (i >= 2 && i <= 4) return [ru(z), 1280 + (x - rl_.x0) / 0.06 * 55];                 // 顶（掌心区，手磨）
    if (i === 1) return [ru(z), 1280 + 55 + (rl_.y1 - rc - y) / 0.07 * 73];                // 前面（+X，掌根）
    if (i === 0) return [ru(z), 1280 + 128 + (rl_.x1 - x) / 0.06 * 55];                    // 底
    return [ru(z), 1280 + 183 + (y - rl_.y0) / 0.07 * 70];                                  // 后
  }, (x, y, s) => RF_SIDE(1.1 + x - 0.9, 0.62 + y - 0.24));
  b.addRaw(RR.geo(), M);
  for (const pz of [-rl_.postZ, rl_.postZ]) {
    b.addRaw(rfRect(swapUV(new THREE.BoxGeometry(0.05, 0.245, 0.05)), 300, 1412, 125, 26), M, T(0.94, 0.1225, pz));
    b.addRaw(rfRect(swapUV(new THREE.BoxGeometry(0.04, 0.26, 0.04)), 500, 1452, 133, 21), M, mul(T(0.83, 0.088, pz), RZ(-Math.PI / 4)));
    b.addRaw(rfRect(new THREE.CylinderGeometry(0.008, 0.009, 0.006, 8), 300, 1760, 30, 30), M, mul(T(0.973, 0.28, pz), RZ(Math.PI / 2)));
  }
  // ---- 系船环（+X 端头那道横梁，z −1.2）：眼板 + 吊环 + 一截泡过水的断缆，只往 +X 伸
  const [rx, ry, rz] = RF.ring;
  b.addRaw(rfRect(new THREE.BoxGeometry(0.006, 0.06, 0.07), 340, 1560, 70, 60), M, T(1.003, -0.09, rz));
  b.addRaw(rfRect(new THREE.TorusGeometry(0.016, 0.0055, 6, 12), 340, 1640, 80, 40), M, T(1.022, -0.09, rz));
  b.addRaw(rfRect(new THREE.TorusGeometry(0.045, 0.007, 8, 24), 4, 1700, 280, 60), M, mul(T(rx, ry, rz), RY(Math.PI / 2)));
  const ropePts = [[rx, ry - 0.05, rz], [rx + 0.03, -0.235, rz - 0.01], [rx + 0.1, -0.283, rz - 0.04], [rx + 0.22, -0.288, rz - 0.03], [rx + 0.3, -0.287, rz + 0.04]];
  b.addRaw(rfRect(tube(ropePts, 0.012, 28, 8), ...RF_ROPE), M);
  b.addRaw(rfRect(new THREE.TorusGeometry(0.014, 0.008, 6, 12), ...RF_ROPE), M, T(rx, ry - 0.05, rz));        // 绳结
  const fr = rfRand(2301), endP = ropePts[4];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * 2 * Math.PI + fr();
    b.addRaw(rfRect(tube([endP, [endP[0] + 0.04, endP[1] + Math.sin(a) * 0.006, endP[2] + 0.02 + Math.cos(a) * 0.012], [endP[0] + 0.07 + fr() * 0.03, -0.296, endP[2] + 0.03 + Math.cos(a) * 0.03]], 0.0035, 6, 4), ...RF_ROPE), M);
  }
  b.addRaw(R.geo(), M);

  const collider = new THREE.BoxGeometry(RF.W, RF.H, RF.L).translate(0, -RF.H / 2, 0);   // 顶面平 y 0；推把不进碰撞（白盒同）
  const iq = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];
  return {
    name: 'prop-raft-s1',
    lods: [b.build()],
    texSet: 'tex-prop-raft-s1',
    collider,
    helpers: [
      { suffix: '-waterline', t: [0, RF.waterline, 0], extras: { note: '吃水线：漂浮时水面在本节点高度（甲板顶高出水面 0.25 = layout floatOffset）' } },
      { suffix: '-interact', t: RF.interact, r: iq,
        extras: { interact: true, anims: { start: 'xi-push-start', loop: 'xi-push-loop', end: 'xi-push-end' }, events: { handsOn: 26, handsOff: 6 },
          speedMps: 0.8, pushDir: [-1, 0, 0], pushFaceAheadM: 0.48, palms: ['prop-raft-s1-palm-l', 'prop-raft-s1-palm-r'],
          note: '汐站位（+X 长边外 0.45 m，沙面高度 = 甲板下 0.30；+Z 朝木筏 = 推的方向 −X）；与白盒 raft-s1-interact 同位同向。对齐后 start 第 26 帧双手掌心贴到 palm-l / palm-r' } },
      { suffix: '-palm-l', t: [RF.rail.x1, RF.palmY, RF.palmZ], extras: { note: '左手掌心触点（推把前面上缘，离沙 0.62）；汐左手 = 本地 +Z' } },
      { suffix: '-palm-r', t: [RF.rail.x1, RF.palmY, -RF.palmZ], extras: { note: '右手掌心触点；汐右手 = 本地 −Z' } },
      { suffix: '-stand-s', t: [0, 0, -RF.standZ], extras: { stand: true, takeoff: [0, 0, -RF.takeoffZ], note: '跨越落脚点（从岸 / −Z 跨上来，XI_STEP_ACROSS 平移 0.85）；离开时起跳点 takeoff z −1.35' } },
      { suffix: '-stand-n', t: [0, 0, RF.standZ], extras: { stand: true, takeoff: [0, 0, RF.takeoffZ], note: '跨越落脚点（从台阶 / +Z 跨上来）；离开时起跳点 takeoff z +1.35' } },
      { suffix: '-ring', t: [RF.ring[0], RF.ring[1], RF.ring[2]], extras: { ropeAttach: true, note: '系船环中心（可接缆绳 / 漂浮时的系留）；现在只有一截断缆躺在沙上，不参与逻辑' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'raft-s1', ticket: 'v0.1-021', lodNote: '解谜关键件，只有 LOD0（需求单 021）',
      originAt: '甲板顶面中心（= 白盒 raft-s1 根；layout raft.home y 0.4 = 搁浅时甲板顶）；挂 raft-s1 下零变换、不缩放',
      sizeM: [RF.W, RF.H, RF.L], deckGroundedY: 0.4, deckFloatY: 1.85, floatOffset: 0.25,
      front: '+X 长边 = 推把 / 交互侧；沿 −X 推（home x 9.1 → slot x −0.9）；跨越方向 = ±Z（中线 x 0 无遮挡）',
      clearance: '几何全在 |x| ≤ 1.0、|z| ≤ 1.5（石槽 / 挡坎不碰）；+X 侧伸出：推把到 x 0.97、系船环 1.09、断缆 1.45（贴沙）',
      wetWood: true,
    },
  };
}

// =====================================================================================
// 021 / 022 解谜道具（2026-10-30）：立镜 ×2、导光镜 ×2（两个变体）、拨盘铁门。全部用共用图集 tex-props-puzzle-ch1。
// 可动节点不挂网格（同潮汐钟：glb-pack 量化会把反量化变换写进挂网格的节点），网格挂在 *-mesh 子节点。
// =====================================================================================
const Q = (m) => new THREE.Quaternion().setFromRotationMatrix(m).toArray().map((v) => +v.toFixed(7));
// 倒角方墩：顶面收 bev
function bevBox(w, h, d, bev, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, 1, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - bev)); p.setZ(i, p.getZ(i) * (1 - bev)); }
  g.computeVertexNormals();
  return g;
}
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rivet = (b, x, y, z, m = null, r = 0.007, region = 'tin') => b.add(new THREE.SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), region, MAT_ATLAS, mul(m ?? new THREE.Matrix4(), T(x, y, z), RX(-Math.PI / 2)));
// 反射镜（镜面在本地 z = 0、法线 +Z；宽 w × 高 h）：抛光镜板（reflector 区）+ 深色背板（tinCold，不反光）+ 铆接铁框 + 背筋
function mirrorPanel(b, w, h, fr = 0.035) {
  b.add(new THREE.PlaneGeometry(w, h), 'reflector');
  b.add(boxG(w + 0.02, h + 0.02, 0.012), 'tinCold', MAT_ATLAS, T(0, 0, -0.008));
  for (const s of [-1, 1]) {
    b.add(boxG(w + 2 * fr, fr, 0.04), 'tin', MAT_ATLAS, T(0, s * (h / 2 + fr / 2), -0.01), [1, 0.1]);
    b.add(boxG(fr, h, 0.04), 'tin', MAT_ATLAS, T(s * (w / 2 + fr / 2), 0, -0.01), [0.1, 1]);
  }
  for (const y of [-h / 4, h / 4]) b.add(boxG(w, 0.03, 0.018), 'tinCold', MAT_ATLAS, T(0, y, -0.023), [1, 0.1]);
  b.add(boxG(0.03, h, 0.018), 'tinCold', MAT_ATLAS, T(0, 0, -0.023), [0.1, 1]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) rivet(b, sx * (w / 2 + fr / 2), sy * (h / 2 + fr / 2), 0.01);
  for (const s of [-1, 1]) { rivet(b, 0, s * (h / 2 + fr / 2), 0.01); rivet(b, s * (w / 2 + fr / 2), 0, 0.01); }
}

// ---------- 021 立镜 prop-mirror-stand-s2（S2 小院 ×2，同一模型）----------
// 根 = 石座底面中心（y 0 = 铺地顶面，挂 env-courtyard-wall-s2-mirror-a/b-socket）；mirror-pivot 在竖轴上、镜心高 0.85；
// 镜面过竖轴（-mirror-plane 就在 pivot 原点）⇒ 转多少度光都打在同一点。把手 / -interact 随镜子转（推把手转镜）。
const MS = { cy: 0.85, w: 0.70, h: 0.80, fr: 0.035, yokeX: 0.44, barY: 0.385 };
function mirrorStand() {
  const st = new Builder();
  st.add(bevBox(0.56, 0.31, 0.56, 0.05), 'stone', MAT_ATLAS, T(0, 0.105, 0));             // 石座 y −0.05 → 0.26
  st.add(bevBox(0.46, 0.06, 0.46, 0.08), 'stone', MAT_ATLAS, T(0, 0.29, 0));              // 压顶 → 0.32
  st.add(lathe([[0.17, 0.32], [0.23, 0.32], [0.23, 0.326], [0.17, 0.326]], 48), 'brass');   // 铜刻度环
  for (let i = 0; i < 24; i++) { const a = (i * Math.PI) / 12; st.add(boxG(0.005, 0.004, i % 6 ? 0.018 : 0.03), 'brass', MAT_ATLAS, mul(RY(a), T(0, 0.328, 0.205 + (i % 6 ? 0 : 0.006)))); } // 每 15° 一刻（= 白盒档位）
  st.add(lathe([[0, 0.32], [0.06, 0.32], [0.06, 0.336], [0, 0.336]], 16), 'tin');
  const rot = new Builder(), y0 = -MS.cy; // pivot 本地：y 0 = 镜心
  rot.add(lathe([[0.02, y0 + 0.326], [0.17, y0 + 0.326], [0.17, y0 + 0.356], [0.15, y0 + 0.362], [0.03, y0 + 0.366], [0.025, y0 + 0.39]], 32), 'tin', MAT_ATLAS, null, [0.5, 1]); // 转盘
  rot.add(new THREE.ConeGeometry(0.012, 0.03, 3), 'brass', MAT_ATLAS, mul(T(0, y0 + 0.341, 0.183), RX(Math.PI / 2)));   // 指针（正面 +Z）
  rot.add(boxG(2 * MS.yokeX + 0.04, 0.035, 0.05), 'tin', MAT_ATLAS, T(0, MS.barY - MS.cy, -0.03), [1, 0.08]);            // 叉架横梁
  for (const s of [-1, 1]) {
    const h = MS.cy + 0.06 - MS.barY;
    rot.add(boxG(0.04, h, 0.05), 'tin', MAT_ATLAS, T(s * MS.yokeX, MS.barY - MS.cy + h / 2, -0.03), [0.1, 1]);           // 叉架立柱
    rot.add(new THREE.CylinderGeometry(0.018, 0.018, MS.yokeX - (MS.w / 2 + MS.fr) + 0.03, 10), 'tin', MAT_ATLAS, mul(T(s * (MS.w / 2 + MS.fr + (MS.yokeX - MS.w / 2 - MS.fr) / 2), 0, 0), RZ(Math.PI / 2))); // 耳轴
    rot.add(lathe([[0, 0], [0.03, 0], [0.03, 0.012], [0.02, 0.018], [0, 0.018]], 12), 'tin', MAT_ATLAS, mul(T(s * (MS.yokeX + 0.02), 0, 0), RZ(-s * Math.PI / 2)));  // 耳轴螺母
    // 背后一对竖向把手（中心离地 1.05，在 -interact 局部 [±0.27, 1.05, 0.40]）+ 撑杆
    cappedTube(rot, [[s * 0.27, 1.05 - MS.cy - 0.15, -0.25], [s * 0.27, 1.05 - MS.cy + 0.15, -0.25]], 0.014, 4, 10, 'tin', [1, 0.3]);
    for (const y of [1.05 - MS.cy - 0.12, 1.05 - MS.cy + 0.12]) cappedTube(rot, [[s * 0.27, y, -0.03], [s * 0.27, y, -0.25]], 0.01, 4, 8, 'tin', [1, 0.2]);
  }
  rot.add(new THREE.CylinderGeometry(0.025, 0.025, MS.barY - MS.cy - (y0 + 0.39) + 0.01, 10), 'tin', MAT_ATLAS, T(0, (y0 + 0.39 + MS.barY - MS.cy) / 2, -0.01));
  const mir = new Builder(); mirrorPanel(mir, MS.w, MS.h, MS.fr);
  return {
    name: 'prop-mirror-stand-s2',
    lods: [st.build()],
    collider: new THREE.BoxGeometry(0.56, 0.42, 0.56).translate(0, 0.21, 0),
    tree: [{
      name: 'mirror-pivot', t: [0, MS.cy, 0],
      extras: { rotates: 'y', originAt: '竖轴上、镜心高度（镜面过竖轴）', yawZero: '单位旋转 = 镜面法线 +Z（与白盒 yaw 0 同约定）', drive: 'artSlots world：世界旋转 = 白盒 mirror-stand-s2-a/b-yaw', stepDeg: 15 },
      children: [
        { name: 'mirror-pivot-mesh', prims: rot.build() },
        { name: 'mirror-pivot-mirror-mesh', prims: mir.build() },
        { name: 'prop-mirror-stand-s2-mirror-plane', t: [0, 0, 0], extras: { mirrorPlane: true, normal: '+Z', sizeM: [MS.w, MS.h], centerAboveGround: MS.cy, note: '镜面中心（抛光面在本地 z 0），+Z = 法线；背面深色铁背板不反光' } },
        { name: 'prop-mirror-stand-s2-interact', t: [0, -MS.cy, -0.65],
          extras: { interact: true, anim: 'xi-operate-loop', handles: [[-0.27, 1.05, 0.4], [0.27, 1.05, 0.4]], note: '汐站位（地面，+Z 朝镜子）：站在镜背后推把手；随 mirror-pivot 转（yaw 0 时在石座正后方 0.65 m）' } },
      ],
    }],
    helpers: [],
    rootExtras: {
      puzzleCritical: true, puzzle: 'mirror-stands-s2', ticket: 'v0.1-021', sameModel: ['mirror-stand-s2-a', 'mirror-stand-s2-b'], scale: 1,
      originAt: '石座底面中心，y 0 = 铺地顶面；挂 env-courtyard-wall-s2-mirror-a/b-socket（缺失时挂白盒 mirror-stand-s2-a/b）',
      mirrorCenterY: MS.cy, mirrorSizeM: [MS.w, MS.h], beamPlaneY: 0.85, pivotNode: 'mirror-pivot', planeNode: 'prop-mirror-stand-s2-mirror-plane',
      baseTopY: 0.336, mirrorBottomY: +(MS.cy - MS.h / 2 - MS.fr).toFixed(3), swingRadiusM: 0.48,
      note: '石座 / 刻度环静止；转盘、叉架、镜子、背后把手都在 mirror-pivot 下。刻度环每 15° 一刻（对白盒档位），转盘前沿铜指针',
    },
  };
}

// ---------- 022 导光镜 prop-guide-mirror-wall-s3-a / -b（S3 楼梯井，两个变体）----------
// 两处支架相对楼梯井一样（都在 r 1.3、平台踏步正中、镜心比平台高 0.6），但朝向（θ140 / θ350）和固定俯仰（−1.1° / +4.4°）不同；
// 程序现行挂法是根挂白盒 guide-mirror-s3-mid-a/b（S3 局部朝向）+ copy 偏航 + 对齐镜面，所以做成两个变体文件：轴向 = S3 局部，俯仰烘进 mirror-pitch。
// 根 = 镜心（= 020 guide-mirror-s3-mid-a/b-socket）；mirror-pivot 在竖轴上（根原点）；mirror-pitch 固定（不由程序转）。
const GM = {
  a: { theta: 140, pitch: -1.1, center: [-0.9958577760546713, 10.6, 0.8356238925925014], platformY: 10, artYawDeg: -19.777, landing: 'A（踏步 49，θ122–158）' },
  b: { theta: 350, pitch: 4.4, center: [1.2802500789158704, 16.6, -0.2257426309670095], platformY: 16, artYawDeg: 160.755, landing: 'B（踏步 79，θ332–8）' },
  half: 0.35, fr: 0.035, colR: 2.08, handR: 2.2, interactR: 2.6, r: 1.3,
};
function guideMirrorWall(k) {
  const g = GM[k], th = (g.theta * Math.PI) / 180;
  const alpha = Math.atan2(-Math.cos(th), -Math.sin(th)); // F 系（−Z = 径向朝外）→ S3：RY(alpha)
  const F = RY(alpha), dy = g.platformY - g.center[1];      // 平台面 = −0.6
  const zc = -(GM.colR - GM.r), zh = -(GM.handR - GM.r), zi = -(GM.interactR - GM.r);
  const fx = (m) => mul(F.clone(), m);
  const st = new Builder();
  // 平台边的转柄柱（底法兰螺栓固定在平台内沿 r 2.08）+ 一对竖向把手（中心离平台 1.05）
  st.add(lathe([[0, dy], [0.085, dy], [0.085, dy + 0.02], [0.045, dy + 0.035], [0.036, dy + 0.08], [0.034, dy + 1.1], [0.045, dy + 1.12], [0.045, dy + 1.15], [0, dy + 1.16]], 16), 'tin', MAT_ATLAS, fx(T(0, 0, zc)), [0.4, 1]);
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; st.add(lathe([[0, 0], [0.012, 0], [0.012, 0.01], [0, 0.014]], 6), 'tin', MAT_ATLAS, fx(T(Math.cos(a) * 0.065, dy + 0.02, zc + Math.sin(a) * 0.065))); }
  for (const s of [-1, 1]) {
    cappedTube(st, [[s * 0.27, dy + 0.9, zh], [s * 0.27, dy + 1.2, zh]].map((p) => V3(...p).applyMatrix4(F).toArray()), 0.014, 4, 10, 'tin', [1, 0.3]);
    for (const y of [dy + 0.93, dy + 1.17]) cappedTube(st, [[s * 0.27, y, zh], [s * 0.1, y, zc - 0.02], [0, y, zc]].map((p) => V3(...p).applyMatrix4(F).toArray()), 0.01, 8, 8, 'tin', [1, 0.2]);
  }
  // 伸进楼梯井的铁臂（镜子下方、背面一侧）+ 传动轴 + 斜撑 + 轴承座
  const armY = -0.52, armZ0 = zc, armZ1 = 0.05, armL = armZ1 - armZ0;
  st.add(boxG(0.05, 0.05, armL), 'tin', MAT_ATLAS, fx(T(0, armY, (armZ0 + armZ1) / 2)), [0.1, 1]);
  cappedTube(st, [[0, armY + 0.04, zc], [0, armY + 0.04, -0.02]].map((p) => V3(...p).applyMatrix4(F).toArray()), 0.011, 4, 8, 'tinCold');
  cappedTube(st, [[0, dy + 0.55, zc - 0.005], [0, armY + 0.02, -0.5]].map((p) => V3(...p).applyMatrix4(F).toArray()), 0.014, 4, 8, 'tin');
  st.add(lathe([[0, armY + 0.025], [0.045, armY + 0.025], [0.045, armY + 0.05], [0.03, armY + 0.06], [0, armY + 0.06]], 16), 'tin', MAT_ATLAS, F.clone());
  st.add(boxG(0.09, 0.06, 0.07), 'tinCold', MAT_ATLAS, fx(T(0, armY + 0.04, zc + 0.02)));   // 柱脚齿轮箱
  // 转动件（S3 轴向；偏航 0 = 法线 +Z）：转轴 + 叉架 + 俯仰夹板
  const rot = new Builder();
  rot.add(new THREE.CylinderGeometry(0.02, 0.02, -0.43 - (armY + 0.05), 10), 'tin', MAT_ATLAS, T(0, (armY + 0.05 - 0.43) / 2, 0));   // 转轴：轴承座顶 → 叉架横梁
  rot.add(boxG(2 * 0.44 + 0.04, 0.035, 0.05), 'tin', MAT_ATLAS, T(0, -0.445, -0.03), [1, 0.08]);
  for (const s of [-1, 1]) {
    rot.add(boxG(0.04, 0.505, 0.05), 'tin', MAT_ATLAS, T(s * 0.44, -0.445 + 0.2525, -0.03), [0.1, 1]);
    rot.add(new THREE.CylinderGeometry(0.018, 0.018, 0.44 - (GM.half + GM.fr) + 0.03, 10), 'tin', MAT_ATLAS, mul(T(s * (GM.half + GM.fr + (0.44 - GM.half - GM.fr) / 2), 0, 0), RZ(Math.PI / 2)));
    rot.add(new THREE.CylinderGeometry(0.065, 0.065, 0.008, 20, 1, false, Math.PI * 0.25, Math.PI * 1.5), 'brass', MAT_ATLAS, mul(T(s * 0.464, 0, 0), RZ(Math.PI / 2)));   // 俯仰夹板（扇形）
    rot.add(lathe([[0, 0], [0.022, 0], [0.022, 0.014], [0, 0.016]], 6), 'tin', MAT_ATLAS, mul(T(s * 0.468, 0.045 * Math.sign(g.pitch || 1), 0), RZ(-s * Math.PI / 2)));     // 锁紧螺栓
  }
  const mir = new Builder(); mirrorPanel(mir, GM.half * 2, GM.half * 2, GM.fr);
  const name = `prop-guide-mirror-wall-s3-${k}`;
  const qI = Q(F);
  return {
    name,
    lods: [st.build()],
    collider: new THREE.BoxGeometry(0.7, 1.2, 0.36).applyMatrix4(mul(F.clone(), T(0, dy + 0.6, (zc + zh) / 2 - 0.02))),
    tree: [{
      name: 'mirror-pivot', t: [0, 0, 0],
      extras: { rotates: 'y', originAt: '竖轴上、镜心（= 根原点）', yawZero: '单位旋转 = 法线 +Z（S3 局部），与白盒 guide-mirror-s3-mid-' + k + '-yaw 同约定', drive: 'artSlots copy：局部旋转 = 白盒 yaw', solvedPsiDeg: +(90 - g.artYawDeg).toFixed(3), solvedNote: `正解：绕 +Y 转 ${+(90 - g.artYawDeg).toFixed(3)}°（ψ 从 +Z 往 +X 量，= 白盒 yaw.rotation.y）；layout artYawDeg ${g.artYawDeg} 是同一条法线从 +X 往 +Z 量` },
      children: [
        { name: 'mirror-pivot-mesh', prims: rot.build() },
        { name: 'mirror-pitch', r: Q(RX((-g.pitch * Math.PI) / 180)),
          extras: { fixed: true, pitchDeg: g.pitch, rotationXDeg: -g.pitch, note: `俯仰固定 ${g.pitch > 0 ? '+' : ''}${g.pitch}°（正 = 法线上仰），烘在节点旋转里（= 白盒 -pitch rotation.x）；程序不要转它` },
          children: [
            { name: 'mirror-pitch-mesh', prims: mir.build() },
            { name: `${name}-mirror-plane`, t: [0, 0, 0], extras: { mirrorPlane: true, normal: '+Z', sizeM: [GM.half * 2, GM.half * 2], note: '镜面中心（抛光面在本地 z 0）' } },
          ] },
      ],
    }],
    helpers: [
      { suffix: '-interact', t: V3(0, dy, zi).applyMatrix4(F).toArray().map((v) => +v.toFixed(4)), r: qI,
        extras: { interact: true, anim: 'xi-operate-loop', handles: [[-0.27, 1.05, 0.4], [0.27, 1.05, 0.4]], note: `汐站位（平台 ${g.landing} 面、r ${GM.interactR}），+Z 朝楼梯井 / 转柄柱；把手在平台边转柄柱上，镜子在铁臂末端（够不到）` } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'lighthouse-beam-s3', ticket: 'v0.1-022', variant: k, variantOf: 'prop-guide-mirror-wall-s3', scale: 1,
      originAt: `镜心 = S3 局部 ${JSON.stringify(g.center)}（= 020 guide-mirror-s3-mid-${k}-socket）；轴向 = S3 局部（不旋转），挂白盒 guide-mirror-s3-mid-${k} / socket 都行，对齐 -mirror-plane`,
      thetaDeg: g.theta, fixedPitchDeg: g.pitch, artYawDeg: g.artYawDeg, solvedPsiDeg: +(90 - g.artYawDeg).toFixed(3), mirrorCenterS3: g.center, platformY: g.platformY, mirrorAbovePlatform: 0.6, mirrorSizeM: [GM.half * 2, GM.half * 2],
      bracket: `转柄柱 r ${GM.colR}（平台内沿）→ 铁臂沿径向伸进楼梯井到 r ${GM.r}（镜下 0.52）；臂 / 柱都在镜背面一侧（径向朝外），光路在镜面一侧`,
      pivotNode: 'mirror-pivot', pitchNode: 'mirror-pitch', planeNode: `${name}-mirror-plane`,
    },
  };
}

// ---------- 021 拨盘铁门 prop-dial-gate-s2（S2 北墙门洞 1.6）----------
// 根 = 门洞中心地面（= env-clifftop-s2-gate-socket，+Z 北 = 门外崖径）；gate-door 原点在铰链（门洞东侧 x +0.8，= 白盒 s2-dial-gate-hinge），门扇沿本地 −X、绕 +Y 转 +78° 向北开（程序核对定稿 78°，95° 会擦西门柱）；
// 三个拨盘在门扇南面（朝汐），dial-0/1/2 = 从南面看左→右（世界 x 4.65 / 4.2 / 3.75 = 白盒 dial-1/2/3），原点在转轴，绕本地 Z 转；每 36° 一个数字，0 朝上（指针），
// 数字从南面看顺时针排（与白盒一致：拨盘逆时针转 36k° 后数字 k 到指针下）。
const DG = { w: 1.6, h: 1.9, dialY: 1.15, dialX: [-0.35, -0.8, -1.25], dialR: 0.12, plate: { x0: -1.47, x1: -0.13, y0: 0.86, y1: 1.42 }, faceZ: -0.027 };
const SEG7 = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digitGlyph(b, n, m, W = 0.019, H = 0.032, t = 0.0045, d = 0.004) {
  // 字形在 (u 右, v 上) 平面，朝 −Z（看的人在南面：右手 = 世界 −X ⇒ x = −u）
  const segs = { a: [0, H / 2, W, t], d: [0, -H / 2, W, t], g: [0, 0, W, t], b: [W / 2, H / 4, t, H / 2], c: [W / 2, -H / 4, t, H / 2], e: [-W / 2, -H / 4, t, H / 2], f: [-W / 2, H / 4, t, H / 2] };
  for (const s of SEG7[n]) { const [u, v, w, h] = segs[s]; b.add(boxG(w, h, d), 'brass', MAT_ATLAS, mul(m.clone(), T(-u, v, -d / 2)), [0.1, 0.1]); }
}
function dialGate() {
  const st = new Builder();
  // 静止件：两侧门柱上的铰链座 / 门闩扣（埋进门柱面）
  for (const y of [0.35, 1.55]) st.add(boxG(0.1, 0.06, 0.05), 'tin', MAT_ATLAS, T(0.84, y - 0.07, 0), [0.2, 0.1]);
  st.add(boxG(0.08, 0.1, 0.06), 'tin', MAT_ATLAS, T(-0.83, 1.0, 0), [0.2, 0.2]);
  const door = new Builder();
  const X0 = -DG.w + 0.02, X1 = -0.03;
  door.add(boxG(0.05, 1.83, 0.03), 'tin', MAT_ATLAS, T(-0.055, 0.05 + 0.915, 0), [0.1, 1]);               // 铰链侧竖框
  door.add(boxG(0.05, 1.83, 0.03), 'tin', MAT_ATLAS, T(X0 + 0.025, 0.05 + 0.915, 0), [0.1, 1]);           // 门闩侧竖框
  for (const y of [0.1, 0.8, 1.45, 1.84]) door.add(boxG(X1 - X0, 0.045, 0.03), 'tin', MAT_ATLAS, T((X0 + X1) / 2, y, 0), [1, 0.08]);
  for (let x = -0.16; x > X0 + 0.08; x -= 0.13) {
    door.add(new THREE.CylinderGeometry(0.011, 0.011, 1.74, 8), 'tin', MAT_ATLAS, T(x, 0.1 + 0.87, 0), [0.1, 1]);
    door.add(new THREE.ConeGeometry(0.017, 0.045, 4), 'tin', MAT_ATLAS, T(x, 1.8625 + 0.0225, 0));         // 矛尖 → 1.885
  }
  for (const y of [0.35, 1.55]) {                                                                           // 铰链套筒 + 门板铰链带
    door.add(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 12), 'tin', MAT_ATLAS, T(0, y, 0));
    door.add(boxG(0.32, 0.05, 0.034), 'tin', MAT_ATLAS, T(-0.17, y, 0), [0.4, 0.1]);
  }
  door.add(boxG(0.1, 0.05, 0.05), 'tinCold', MAT_ATLAS, T(X0 - 0.02, 1.0, 0));                              // 门闩舌
  // 锁板（南面）+ 铆钉 + 三个指针 + 两侧竖向把手
  const P = DG.plate, pw = P.x1 - P.x0, ph = P.y1 - P.y0;
  door.add(boxG(pw, ph, 0.01), 'tinCold', MAT_ATLAS, T((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, -0.022), [1, 0.4]);
  for (const x of [P.x0 + 0.03, (P.x0 + P.x1) / 2, P.x1 - 0.03]) for (const y of [P.y0 + 0.03, P.y1 - 0.03]) rivet(door, x, y, -0.027, mul(RX(Math.PI / 2)).invert(), 0.008);
  for (const x of DG.dialX) door.add(new THREE.ConeGeometry(0.014, 0.03, 3), 'brass', MAT_ATLAS, mul(T(x, DG.dialY + DG.dialR + 0.03, DG.faceZ - 0.006), RX(Math.PI)));
  const hx = (DG.dialX[0] + DG.dialX[2]) / 2, gripZ = -0.085;
  for (const s of [-1, 1]) {
    cappedTube(door, [[hx + s * 0.27, 0.9, gripZ], [hx + s * 0.27, 1.2, gripZ]], 0.013, 4, 10, 'tin', [1, 0.3]);
    for (const y of [0.93, 1.17]) cappedTube(door, [[hx + s * 0.27, y, DG.faceZ], [hx + s * 0.27, y, gripZ]], 0.009, 4, 8, 'tin', [1, 0.15]);
  }
  // 拨盘（本地：原点在转轴、盘面朝 −Z）：滚花铜圈 + 深色铁盘面 + 凸铜数字 + 中心握钮
  const dialTree = (i) => {
    const b = new Builder(), toZ = RX(-Math.PI / 2); // lathe 的 +Y → −Z
    const R = DG.dialR, rim = [];
    for (let j = 0; j <= 4; j++) rim.push([R - 0.012 + (j % 2 ? 0.004 : 0), -0.002 - j * 0.006]);
    b.add(lathe([[0.02, 0], [R, 0], ...rim.map(([r, y]) => [r + 0.012, y - 0.004]), [R, -0.028], [R - 0.016, -0.028], [R - 0.018, -0.024]], 60), 'brass', MAT_ATLAS, toZ);
    b.add(lathe([[0, -0.022], [R - 0.017, -0.022], [R - 0.017, -0.024], [0, -0.024]], 48), 'tinCold', MAT_ATLAS, toZ);
    b.add(lathe([[0, -0.024], [0.032, -0.024], [0.032, -0.03], [0.026, -0.05], [0.028, -0.056], [0.02, -0.062], [0, -0.063]], 20), 'brass', MAT_ATLAS, toZ);
    for (let j = 0; j < 4; j++) b.add(boxG(0.006, 0.05, 0.026), 'brass', MAT_ATLAS, mul(RZ((j * Math.PI) / 4), T(0, 0, -0.045)));  // 握钮十字筋
    for (let n = 0; n < 10; n++) {
      const phi = (36 * n * Math.PI) / 180, rr = 0.077;
      digitGlyph(b, n, mul(T(-Math.sin(phi) * rr, Math.cos(phi) * rr, -0.024), RZ(phi)));
      b.add(boxG(0.004, 0.012, 0.004), 'brass', MAT_ATLAS, mul(RZ(phi + Math.PI / 10), T(0, R - 0.024, -0.026)));  // 档位刻线（两数字之间）
    }
    return { name: `dial-${i}`, t: [DG.dialX[i], DG.dialY, DG.faceZ - 0.001],
      extras: { rotates: 'z', originAt: '拨盘转轴（盘面中心）', digitStepDeg: 36, zeroUp: true, digitsClockwiseFromSouth: true, greybox: `dial-gate-s2-dial-${i + 1}`, worldX: +(5.0 + DG.dialX[i]).toFixed(2), code: [3, 1, 7][i],
        note: '从南面看：数字 k 在正上方顺时针 36k°；拨盘绕转轴逆时针（从南面看）转 36k° ⇒ 数字 k 到指针下（与白盒同）。程序 delta 驱动（世界增量）' },
      children: [{ name: `dial-${i}-mesh`, prims: b.build() }] };
  };
  return {
    name: 'prop-dial-gate-s2',
    lods: [st.build()],
    collider: null,
    tree: [{
      name: 'gate-door', t: [DG.w / 2, 0, 0],
      extras: { rotates: 'y', originAt: '铰链轴（门洞东侧 = 世界 x 5.0，= 白盒 s2-dial-gate-hinge）', openDeg: 78, openDir: '+Y 正转 = 向北（门外）开', leafAlong: '−X', size: [DG.w, DG.h] },
      children: [{ name: 'gate-door-mesh', prims: door.build() }, ...[0, 1, 2].map(dialTree),
        { name: 'prop-dial-gate-s2-collider', colliderGeom: new THREE.BoxGeometry(DG.w - 0.02, 1.85, 0.1).translate(-DG.w / 2, 0.05 + 0.925, 0) }],
    }],
    helpers: [
      { suffix: '-interact', t: [hx + DG.w / 2, 0, +(gripZ - 0.4).toFixed(3)], extras: { interact: true, anim: 'xi-operate-loop', handles: [[-0.27, 1.05, 0.4], [0.27, 1.05, 0.4]], note: '汐站位（门南面地面，+Z 朝门）；把手在中间拨盘两侧，装在锁板上（随门扇动，门开后不再交互）' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'dial-gate-s2', ticket: 'v0.1-021', scale: 1, code: '317', codeDials: { 'dial-0': 3, 'dial-1': 1, 'dial-2': 7 },
      originAt: '门洞中心地面 = env-clifftop-s2-gate-socket（S2 (4.2, 0, 11.75)，+Z 北）；gate-door 在本地 x +0.8 = 白盒铰链 (5.0, 0, 11.75)',
      size: [DG.w, DG.h], dialY: DG.dialY, dialWorldX: [4.65, 4.2, 3.75], dialRadiusM: DG.dialR, dialFace: '南（−Z，朝汐）',
      note: '门扇外框 + 竖栏 + 矛尖（顶 1.885 ≤ 1.9）；锁板 / 拨盘 / 把手都在门扇南面、gate-door 下；-collider 在 gate-door 下（跟门转）',
    },
  };
}

// =====================================================================================
// 10-30 第 3 批：021 光感锁 + 022 油阀 / 窗口镜 / 点火口 + 拉杆（发光材质由程序控制，见 GLOW）
const MAT_LOCK_LENS = 10, MAT_IGN_GLOW = 11;
const GLOW = {
  [MAT_LOCK_LENS]: { name: 'mat-prop-light-lock-lens', base: '#3E4C52', rough: 0.08,
    extras: { programDriven: true, glowColor: '#F4C978', intensityAtProgress1: 1.6, drive: 'progress 0–1：material.emissive = glowColor，emissiveIntensity = progress × 1.6（three.js）；glTF 默认 emissiveFactor 0 = 未受光', note: '光感锁透镜单独材质（需求单 021）：深色玻璃，受光时按进度提亮' } },
  [MAT_IGN_GLOW]: { name: 'mat-prop-ignition-glow', base: '#2E2A26', rough: 0.1,
    extras: { programDriven: true, defaultState: 'off', drive: 'material.emissive = color，emissiveIntensity = intensity（three.js）；glTF 默认 emissiveFactor 0 = off',
      states: { off: { intensity: 0 }, noOil: { color: '#C8382A', intensity: 0.6, mode: 'steady' }, cold: { color: '#DCE6EE', intensity: [0.15, 0.35], mode: 'breathe', periodS: 4, entryPulse: true },
        lit: { color: '#FFB25E', intensity: 2.0, mode: 'steady', plus: 'lamp-light-origin 动态光' } },
      usedBy: ['ignition-glow-lens（灯室地板下朝下的透镜，楼梯井仰视可见）', 'ignition-glow-sight（拉杆机匣上的观察窗，灯室里可见）'], note: 'README-s3-layout 四态（关 / 红 / 冷白 / 暖），两处共用这一个材质' } },
};
REGION.tbBronzeB = [0.04, 0.1, 0.3, 0.22];   // 潮汐钟铜图背面一块（无刻线）：湿铜 + 铜绿
const FZ = RX(Math.PI / 2);                   // 车削轴 +Y → +Z
const rivetZ = (b, x, y, z, r = 0.007, region = 'tin', mat = MAT_ATLAS) => b.add(new THREE.SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), region, mat, mul(T(x, y, z), FZ));
const sphCap = (a, h, seg = 32) => { const R = (a * a + h * h) / (2 * h); return { R, g: new THREE.SphereGeometry(R, seg, 6, 0, Math.PI * 2, 0, Math.asin(Math.min(1, a / R))) }; };

// ---------- 021 光感锁 prop-light-lock-s2（S2 守塔人小屋北墙外面）----------
// 根 = env-keeper-house-ch1-light-lock-socket = 白盒 light-lock-s2-receiver 球心（墙外表面上，透镜中心高 0.85）；+Z = 朝外（北），+X = 从北面看右手边。
// -receiver 就在根原点（透镜光轴与墙面的交点），align 零位移；透镜从墙面鼓出 0.105。
const LL = { w: 0.6, h: 0.7, lensR: 0.1, lensBase: 0.055, lensApex: 0.105, gaugeY: 0.2, gaugeR: 0.1, boltY: -0.235 };
function lightLock() {
  const st = new Builder();
  st.add(bevBox(LL.w, 0.05, LL.h, 0.04), 'stone', MAT_ATLAS, mul(T(0, 0, 0.015), FZ));                 // 石框 z −0.01 → 0.04
  st.add(boxG(0.46, 0.6, 0.012), 'tin', MAT_ATLAS, T(0, -0.005, 0.046), [0.8, 1]);                       // 铁面板
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) rivetZ(st, sx * 0.2, -0.005 + sy * 0.27, 0.052, 0.009);
  st.add(lathe([[0.098, 0.052], [0.128, 0.052], [0.134, 0.06], [0.13, 0.07], [0.112, 0.074], [0.1, 0.066]], 40), 'brass', MAT_ATLAS, FZ);   // 透镜铜框
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + Math.PI / 6; rivetZ(st, Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.052, 0.008, 'brass'); }
  st.add(new THREE.CircleGeometry(LL.lensR, 32), 'tinCold', MAT_ATLAS, T(0, 0, 0.053));                 // 透镜后面的暗腔
  // 进度表：铜半圆表盘 + 7 道刻（−60° → +60°），指针 light-lock-needle 程序转
  st.add(new THREE.CylinderGeometry(0.11, 0.11, 0.006, 32, 1, false, Math.PI / 2, Math.PI), 'brass', MAT_ATLAS, mul(T(0, LL.gaugeY - 0.01, 0.055), FZ));
  for (let i = 0; i <= 6; i++) { const a = ((60 - i * 20) * Math.PI) / 180; st.add(boxG(0.005, i % 3 ? 0.014 : 0.022, 0.003), 'tinCold', MAT_ATLAS, mul(T(0, LL.gaugeY - 0.01, 0.059), RZ(a), T(0, 0.085, 0))); }
  // 门闩导槽（门闩 light-lock-bolt 可选：受光完成后程序往 +X 滑 0.08）
  for (const x of [-0.13, 0.05]) st.add(boxG(0.04, 0.05, 0.03), 'tin', MAT_ATLAS, T(x, LL.boltY, 0.066), [0.2, 0.2]);
  const lens = new Builder(), cap = sphCap(LL.lensR, LL.lensApex - LL.lensBase);
  lens.add(cap.g, null, MAT_LOCK_LENS, mul(T(0, 0, LL.lensApex - cap.R), FZ));
  const ndl = new Builder();
  ndl.add(boxG(0.007, 0.075, 0.003), 'tinCold', MAT_ATLAS, T(0, 0.04, 0));
  ndl.add(new THREE.ConeGeometry(0.008, 0.016, 4), 'tinCold', MAT_ATLAS, T(0, 0.085, 0));
  ndl.add(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 12), 'brass', MAT_ATLAS, FZ);
  const bolt = new Builder();
  bolt.add(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), 'tin', MAT_ATLAS, mul(T(-0.04, 0, 0), RZ(Math.PI / 2)), [1, 0.3]);
  bolt.add(new THREE.SphereGeometry(0.022, 10, 6), 'brass', MAT_ATLAS, T(0.12, 0, 0));
  return {
    name: 'prop-light-lock-s2',
    lods: [st.build()],
    collider: new THREE.BoxGeometry(LL.w, LL.h, 0.115).translate(0, 0, 0.0475),
    tree: [
      { name: 'light-lock-lens', prims: lens.build(), extras: { glowNode: true, material: 'mat-prop-light-lock-lens', note: '透镜（只有这一块用透镜材质）；程序按受光进度 0–1 提亮，见材质 extras' } },
      { name: 'light-lock-needle', t: [0, LL.gaugeY - 0.01, 0.062], r: Q(RZ(Math.PI / 3)),
        extras: { statusNode: true, rotates: 'z', originAt: '表盘轴心', progress0RotZDeg: 60, progress1RotZDeg: -60, drive: '可选：rotation.z = (60 − 120 × progress)°（从北面看由左扫到右）' },
        children: [{ name: 'light-lock-needle-mesh', prims: ndl.build() }] },
      { name: 'light-lock-bolt', t: [0, LL.boltY, 0.066],
        extras: { statusNode: true, slides: '+X', openOffsetM: 0.08, drive: '可选：解锁时 position.x 0 → 0.08（0.3 s）' },
        children: [{ name: 'light-lock-bolt-mesh', prims: bolt.build() }] },
    ],
    helpers: [
      { suffix: '-receiver', t: [0, 0, 0], extras: { receiver: true, note: '透镜中心 = 光轴与墙面交点 = 根原点 = 白盒 light-lock-s2-receiver（align 零位移）；透镜从这里朝 +Z 鼓出 0.105' } },
      { suffix: '-interact', t: [0, -0.85, 0.8], r: Q(RY(Math.PI)), extras: { interact: true, inspectOnly: true, note: '§5.4 puzzleCritical 必须有交互点：光感锁本身没有操作（光打上来就算），这里只是锁正前方 0.8 m 地面的查看提示点，+Z 朝锁；程序可忽略' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'light-lock-s2', ticket: 'v0.1-021', scale: 1,
      originAt: '透镜中心（墙外表面，世界高 0.85）= env-keeper-house-ch1-light-lock-socket（S2 (−4.8, 0.85, 4.0)），+Z 朝北（墙外）',
      lensCenterY: 0.85, lensRadiusM: LL.lensR, lensProtrudeM: LL.lensApex, frameSizeM: [LL.w, LL.h], frameDepthM: 0.05,
      glowNode: 'light-lock-lens', glowMaterial: 'mat-prop-light-lock-lens', statusNodes: ['light-lock-needle', 'light-lock-bolt'],
      note: '石框 + 铁面板 + 铜框透镜 + 上方进度表（指针可选）+ 下方门闩（可选）。没有操作（光打上来就算），-interact 只是查看提示点。-collider 盒 0.6 × 0.7 × 0.115（墙面 −0.01 → +0.105）',
    },
  };
}

// ---------- 022 油阀 prop-oil-valve-s3（S3 底层机房墙边，涨潮淹没）----------
// 根 = 手轮中心 = env oil-valve-s3-socket（S3 (0.9919, 0.9, 2.7251)，阀心离机房地面 0.70）；+Z = 朝站位 / 塔中心，墙在 z ≈ −0.10；y −0.70 = 地面。
// valve-wheel 原点在轴上（= 根原点），轴 = 本地 Z（水平、指向站位）；开 = 从站位看逆时针 90° = 绕 +Z 转 +90°。
const OV = { R: 0.15, tube: 0.013, floorY: -0.7, pz: -0.072, pr: 0.026, tideY: 0.7, top: 1.15 };
function oilValve() {
  const st = new Builder(), M = MAT_BELL, brz = 'tbBronzeB', irn = 'tbIron';
  const cyl = (r0, r1, y0, y1, seg, region, x = 0, z = OV.pz) => st.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg), region, M, T(x, (y0 + y1) / 2, z), [0.25, 1]);
  cyl(OV.pr, OV.pr, OV.floorY - 0.02, OV.top, 14, irn);                                             // 竖油管：地面 → 阀体 → 上方
  st.add(tube([[0, OV.top - 0.01, OV.pz], [0, OV.top + 0.06, OV.pz], [0, OV.top + 0.09, OV.pz - 0.03], [0, OV.top + 0.09, -0.15]], OV.pr, 10, 12), irn, M, null, [1, 0.3]);  // 弯进墙
  for (const [y, r] of [[OV.floorY + 0.01, 0.075], [-0.12, 0.05], [0.12, 0.05], [0.95, 0.05]]) {
    cyl(r, r, y - 0.012, y + 0.012, 16, brz);
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; st.add(new THREE.CylinderGeometry(0.008, 0.008, 0.032, 6), irn, M, T(Math.cos(a) * (r - 0.012), y, OV.pz + Math.sin(a) * (r - 0.012))); }
  }
  st.add(new THREE.SphereGeometry(0.06, 16, 12), brz, M, T(0, 0, OV.pz));                          // 阀体
  st.add(new THREE.CylinderGeometry(0.034, 0.044, 0.04, 14), brz, M, mul(T(0, 0, -0.03), FZ));      // 阀盖
  st.add(new THREE.CylinderGeometry(0.027, 0.027, 0.014, 6), irn, M, mul(T(0, 0, -0.006), FZ));     // 压盖螺母
  for (const y of [-0.45, 0.6]) {                                                                    // 墙卡箍
    st.add(new THREE.TorusGeometry(OV.pr + 0.006, 0.008, 6, 16, Math.PI), irn, M, mul(T(0, y, OV.pz), RX(Math.PI / 2), RZ(Math.PI)));
    for (const s of [-1, 1]) st.add(boxG(0.03, 0.03, 0.04), irn, M, T(s * 0.045, y, -0.085));
  }
  // 水淹湿痕：潮线（y 0.70 = S3 海水面 1.6）以下的管子 / 法兰上长藤壶，地面法兰一圈最密
  const R = rfRand(23);
  for (let i = 0; i < 46; i++) {
    const low = i < 18, y = low ? OV.floorY + 0.02 + R() * 0.03 : OV.floorY + 0.05 + R() ** 1.6 * (OV.tideY - OV.floorY - 0.1);
    const a = Math.PI * (0.15 + R() * 0.7) * (R() < 0.5 ? 1 : -1) + Math.PI / 2, rr = low ? 0.06 + R() * 0.02 : OV.pr, s = 0.006 + R() * 0.007;
    const dir = V3(Math.cos(a), 0, Math.sin(a)), p = V3(dir.x * rr, y, OV.pz + dir.z * rr);
    const q = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), low ? V3(dir.x * 0.4, 1, dir.z * 0.4).normalize() : dir));
    st.add(new THREE.CylinderGeometry(s * 0.45, s, s * 0.9, 6, 1, true), 'tbStone', M, mul(T(p.x, p.y, p.z), q, T(0, s * 0.4, 0)));
  }
  const wh = new Builder();
  wh.add(new THREE.TorusGeometry(OV.R, OV.tube, 8, 40), brz, M, null, [1, 0.2]);                    // 轮缘（XY 平面，轴 Z）
  for (let i = 0; i < 5; i++) { const a = (i * 2 * Math.PI) / 5 + Math.PI / 2; wh.add(new THREE.CylinderGeometry(0.008, 0.01, OV.R - 0.03, 6), brz, M, mul(RZ(a - Math.PI / 2), T(0, 0.025 + (OV.R - 0.03) / 2, 0))); }
  wh.add(new THREE.CylinderGeometry(0.03, 0.03, 0.034, 14), brz, M, FZ);                            // 轮毂
  wh.add(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8), irn, M, mul(T(0, 0, -0.03), FZ));      // 阀杆
  wh.add(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 6), irn, M, mul(T(0, 0, 0.022), FZ));     // 轮毂螺母
  wh.add(new THREE.ConeGeometry(0.012, 0.03, 3), irn, M, mul(T(Math.cos(Math.PI * 0.75) * OV.R, Math.sin(Math.PI * 0.75) * OV.R, 0.016), RZ(Math.PI * 0.75)));   // 轮缘上的开向箭头（逆时针）
  return {
    name: 'prop-oil-valve-s3',
    lods: [st.build()],
    collider: new THREE.BoxGeometry(0.34, OV.top + 0.1 - OV.floorY, 0.15).translate(0, (OV.top + 0.1 + OV.floorY) / 2, -0.035),
    tree: [{
      name: 'valve-wheel', t: [0, 0, 0],
      extras: { rotates: 'z', originAt: '手轮轴心（= 根原点 = 阀心）', axis: '本地 +Z（水平，指向站位）', wheelRadiusM: OV.R, openDeg: 90, openSense: '从站位看逆时针 = 绕本地 +Z 转 +90°', drive: 'artSlots delta ← oil-valve-s3-wheel', hands: '手在轮缘 165°（左）/ 15°（右），从汐看' },
      children: [{ name: 'valve-wheel-mesh', prims: wh.build() }],
    }],
    helpers: [
      { suffix: '-interact', t: [0, OV.floorY, 0.4], r: Q(RY(Math.PI)),
        extras: { interact: true, anim: 'xi-valve-hold', holdSec: 2, note: '汐站位：手轮中心正前方 0.40 m 的地面上，+Z 朝手轮（= 角色 README 阀轮 [0, 0.70, 0.40]）' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'oil-valve-s3', ticket: 'v0.1-022', scale: 1,
      originAt: '手轮中心 = env-lighthouse-ch1-interior oil-valve-s3-socket（S3 (0.9919, 0.9, 2.7251)，离机房地面 0.70）；+Z 朝站位（塔中心），−Z 是墙',
      valveCenterAboveFloor: 0.7, wheelRadiusM: OV.R, floorLocalY: OV.floorY, wallLocalZ: -0.1,
      tideLineLocalY: OV.tideY, wet: '涨潮整件淹没（海水面 S3 y 1.6 = 本地 0.70）：湿铜 / 湿铁贴图（潮汐钟同一组，wetMetal），潮线以下长藤壶',
      note: '竖油管从地面上来，过阀体，上到 1.24 弯进墙；两道墙卡箍；手轮 5 辐，轮缘上有逆时针开向箭头',
    },
  };
}

// ---------- 022 窗口镜 prop-guide-mirror-window-s3（S3 底层西窗前，双轴）----------
// 根 = 石座顶面中心 = guide-mirror-s3-window-socket（S3 (2.35, 1.0, 0)，轴向 = S3 局部，不旋转）；石座从机房地面（本地 −0.8）起。
// mirror-yaw（镜心，本地 (0, 0.35, 0)，绕 +Y）→ mirror-pitch（同原点，绕本地 +X）→ -mirror-plane（+Z 法线）。单位旋转 = 镜面竖直、法线 +Z（与白盒同约定）。
const WM = { cy: 0.35, half: 0.3, fr: 0.025, yokeX: 0.4, floor: -0.8, hx: -0.5, hz: 0.27 };
function guideMirrorWindow() {
  const st = new Builder();
  st.add(bevBox(0.5, 0.76, 0.5, 0.04), 'stone', MAT_ATLAS, T(0, WM.floor + 0.38, 0));            // 石座 −0.8 → −0.04
  st.add(bevBox(0.56, 0.04, 0.56, 0.06), 'stone', MAT_ATLAS, T(0, -0.02, 0));                     // 压顶 → 0
  st.add(lathe([[0.3, 0], [0.34, 0], [0.34, 0.006], [0.3, 0.006]], 48), 'brass');                // 铜刻度环（每 15°）
  for (let i = 0; i < 24; i++) st.add(boxG(0.005, 0.004, i % 6 ? 0.016 : 0.028), 'brass', MAT_ATLAS, mul(RY((i * Math.PI) / 12), T(0, 0.008, 0.32)));
  // 把手：石座前（−X，朝站位）一对铁立柱，从地面起，上段是竖向握把（中心高 1.05 = 本地 0.25），下面一道横撑连石座
  for (const s of [-1, 1]) {
    const z = s * WM.hz;
    st.add(lathe([[0, WM.floor], [0.05, WM.floor], [0.05, WM.floor + 0.015], [0.026, WM.floor + 0.03], [0.02, WM.floor + 0.08], [0.018, 0.08], [0.024, 0.09]], 12), 'tin', MAT_ATLAS, T(WM.hx, 0, z), [0.3, 1]);
    cappedTube(st, [[WM.hx, 0.1, z], [WM.hx, 0.4, z]], 0.016, 4, 10, 'tin', [1, 0.3]);
    st.add(boxG(0.25, 0.03, 0.03), 'tin', MAT_ATLAS, T((WM.hx - 0.25) / 2, -0.45, z), [1, 0.1]);
  }
  st.add(boxG(0.03, 0.03, 2 * WM.hz), 'tin', MAT_ATLAS, T(WM.hx, -0.45, 0), [1, 0.1]);
  const yaw = new Builder(), y0 = -WM.cy;   // yaw 本地：y 0 = 镜心
  yaw.add(lathe([[0.36, y0 + 0.006], [0.44, y0 + 0.006], [0.44, y0 + 0.03], [0.36, y0 + 0.03]], 40), 'tin', MAT_ATLAS, null, [1, 0.2]);   // 转盘环
  yaw.add(boxG(0.74, 0.012, 0.04), 'tin', MAT_ATLAS, T(0, y0 + 0.012, 0), [1, 0.05]);                                        // 十字撑（镜子最低 −0.325，撑顶 −0.332）
  yaw.add(boxG(0.04, 0.012, 0.74), 'tin', MAT_ATLAS, T(0, y0 + 0.012, 0), [0.05, 1]);
  yaw.add(new THREE.CylinderGeometry(0.05, 0.06, 0.012, 16), 'tin', MAT_ATLAS, T(0, y0 + 0.012, 0));
  yaw.add(new THREE.ConeGeometry(0.012, 0.03, 3), 'brass', MAT_ATLAS, mul(T(0, y0 + 0.018, 0.455), RX(Math.PI / 2)));      // 偏航指针（+Z）
  for (const s of [-1, 1]) {
    yaw.add(boxG(0.04, 0.35, 0.05), 'tin', MAT_ATLAS, T(s * WM.yokeX, y0 + 0.03 + 0.175, 0), [0.1, 1]);                     // 叉架立柱
    yaw.add(lathe([[0, 0], [0.03, 0], [0.03, 0.012], [0.02, 0.018], [0, 0.018]], 12), 'tin', MAT_ATLAS, mul(T(s * (WM.yokeX + 0.02), 0, 0), RZ(-s * Math.PI / 2)));
  }
  yaw.add(new THREE.CylinderGeometry(0.09, 0.09, 0.006, 24, 1, false, 0, Math.PI), 'brass', MAT_ATLAS, mul(T(WM.yokeX + 0.03, 0, 0), RZ(-Math.PI / 2)));   // 俯仰刻度扇（+X 侧）
  for (let i = 0; i <= 12; i++) { const a = ((i * 15 - 90) * Math.PI) / 180; yaw.add(boxG(0.003, 0.004, i % 3 ? 0.012 : 0.02), 'tinCold', MAT_ATLAS, mul(T(WM.yokeX + 0.034, 0, 0), RX(a), T(0, 0, -0.075))); }
  const pit = new Builder();
  mirrorPanel(pit, WM.half * 2, WM.half * 2, WM.fr);
  for (const s of [-1, 1]) pit.add(new THREE.CylinderGeometry(0.018, 0.018, WM.yokeX - WM.half - WM.fr + 0.03, 10), 'tin', MAT_ATLAS, mul(T(s * (WM.half + WM.fr + (WM.yokeX - WM.half - WM.fr) / 2), 0, 0), RZ(Math.PI / 2)));
  pit.add(new THREE.ConeGeometry(0.01, 0.06, 3), 'brass', MAT_ATLAS, mul(T(WM.yokeX + 0.04, 0, -0.05), RX(-Math.PI / 2)));   // 俯仰指针（跟镜子转）
  const name = 'prop-guide-mirror-window-s3';
  return {
    name,
    lods: [st.build()],
    collider: new THREE.BoxGeometry(0.85, 0.8, 0.6).translate(-0.135, WM.floor / 2, 0),
    tree: [{
      name: 'mirror-yaw', t: [0, WM.cy, 0],
      extras: { rotates: 'y', originAt: '镜心（S3 (2.35, 1.35, 0)）', yawZero: '单位旋转 = 法线 +Z（S3 局部），与白盒 guide-mirror-s3-window-yaw 同约定', drive: 'artSlots copy ← guide-mirror-s3-window-yaw', stepDeg: 15, plannedYawDeg: 15.8 },
      children: [
        { name: 'mirror-yaw-mesh', prims: yaw.build() },
        { name: 'mirror-pitch',
          extras: { rotates: 'x', originAt: '镜心（耳轴线）', pitchZero: '单位旋转 = 镜面竖直', drive: 'artSlots copy ← guide-mirror-s3-window-pitch', plannedPitchDeg: 66.3, independent: '与 mirror-yaw 独立（俯仰只转本节点）' },
          children: [
            { name: 'mirror-pitch-mesh', prims: pit.build() },
            { name: `${name}-mirror-plane`, t: [0, 0, 0], extras: { mirrorPlane: true, normal: '+Z', sizeM: [WM.half * 2, WM.half * 2], note: '镜面中心（抛光面在本地 z 0）' } },
          ] },
      ],
    }],
    helpers: [
      { suffix: '-interact', t: [-0.9, WM.floor, 0], r: Q(RY(Math.PI / 2)),
        extras: { interact: true, anim: 'xi-operate-loop', handles: [[-WM.hz, 1.05, 0.4], [WM.hz, 1.05, 0.4]], note: '汐站位 = 白盒 S3 (1.45, 0.2, 0)（地面），+Z 朝镜子（+X）；把手是石座前两根铁立柱的上段（不随镜子转）' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'lighthouse-beam-s3', ticket: 'v0.1-022', scale: 1,
      originAt: '石座顶面中心 = guide-mirror-s3-window-socket（S3 (2.35, 1.0, 0)），轴向 = S3 局部；石座从机房地面（本地 −0.8 = S3 0.2）起',
      mirrorCenterS3: [2.35, 1.35, 0], mirrorSizeM: [WM.half * 2, WM.half * 2], seatTopY: 0, floorLocalY: WM.floor,
      yawNode: 'mirror-yaw', pitchNode: 'mirror-pitch', planeNode: `${name}-mirror-plane`,
      sweep: '镜子任意偏航 / 俯仰的扫掠半径 0.46（含框）；转盘十字撑顶面在镜子最低点下 7 mm，把手立柱在扫掠半径外（0.57）',
    },
  };
}

// ---------- 022 点火口 + 拉杆 prop-ignition-port-s3（S3 灯室）----------
// 根 = ignition-port-s3-socket（S3 (0, 21.85, 0)，节点翻转：本地 +Y = 世界 −Y，本地 +Z = 世界 −Z）。下面几何先按「世界轴向、原点 = socket」(W 系) 写，最后整体乘 FL = RX(π)。
// -receiver = 根原点 = 透镜中心（白盒 ignition-port-s3-receiver，align 零位移）。拉杆 ignite-lever 原点在枢轴 S3 (0.9, 22.74, 0)。
const IP = { floorW: 0.15, slabBotW: -0.1, pivot: [0.9, 0.89, 0], lensA: 0.17, lensTopW: 0.01, lensApexW: -0.05, lever: 0.3, restTiltDeg: 30 };
function ignitionPort() {
  const FL = RX(Math.PI), st = new Builder(), P = IP.pivot;
  // 点火口：铜套嵌在地板洞里（r 0.215 < 洞 0.22），下沿铜法兰（env 铁圈里面）
  st.add(lathe([[0.19, IP.slabBotW - 0.01], [0.215, IP.slabBotW - 0.01], [0.215, 0.14], [0.19, 0.14]], 32), 'brass', MAT_ATLAS, null, [1, 0.3]);
  st.add(lathe([[0.15, -0.125], [0.197, -0.125], [0.197, IP.slabBotW], [0.15, IP.slabBotW]], 32), 'brass');
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; st.add(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6), 'tin', MAT_ATLAS, T(Math.cos(a) * 0.175, -0.13, Math.sin(a) * 0.175)); }
  st.add(lathe([[0.17, IP.lensTopW], [0.19, IP.lensTopW], [0.19, IP.lensTopW + 0.02], [0.17, IP.lensTopW + 0.02]], 32), 'tin');   // 透镜压圈
  st.add(new THREE.CircleGeometry(0.19, 32), 'tinCold', MAT_ATLAS, mul(T(0, IP.lensTopW + 0.03, 0), RX(Math.PI / 2)));          // 透镜后暗腔（朝下）
  // 油管：拉杆机匣 → 穿地板 → 贴楼板底 → 接进 env 铁圈外沿（避开光路：光从下方 r < 0.05 进洞）
  st.add(tube([[P[0], IP.slabBotW + 0.02, 0], [P[0] - 0.02, -0.125, 0], [0.6, -0.128, 0], [0.42, -0.15, 0], [0.365, -0.18, 0]], 0.014, 16, 8), 'brass', MAT_ATLAS, null, [1, 0.2]);
  for (const x of [0.75, 0.55]) st.add(boxG(0.03, 0.02, 0.05), 'tin', MAT_ATLAS, T(x, IP.slabBotW - 0.01, 0));
  // 拉杆机匣（枢轴正下方，地面起）：底板 + 机匣（+X 面有观察窗）+ 立柱 + 叉板 + 轴 + 刻度扇
  st.add(bevBox(0.28, 0.03, 0.22, 0.1), 'tin', MAT_ATLAS, T(P[0], IP.floorW + 0.015, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 6), 'tin', MAT_ATLAS, T(P[0] + sx * 0.11, IP.floorW + 0.036, sz * 0.08));
  st.add(bevBox(0.15, 0.32, 0.14, 0.06), 'tin', MAT_ATLAS, T(P[0], IP.floorW + 0.03 + 0.16, 0), [0.5, 1]);
  st.add(lathe([[0.05, 0], [0.034, 0.03], [0.03, 0.2], [0.04, 0.24], [0.04, 0.27]], 14), 'tin', MAT_ATLAS, T(P[0], IP.floorW + 0.35, 0), [0.3, 1]);   // 立柱 → 0.77
  st.add(boxG(0.1, 0.03, 0.12), 'tin', MAT_ATLAS, T(P[0], 0.785, 0));
  for (const s of [-1, 1]) {
    st.add(boxG(0.1, 0.16, 0.012), 'tin', MAT_ATLAS, T(P[0], 0.85, s * 0.046), [0.4, 0.6]);                 // 叉板
    st.add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 6), 'tin', MAT_ATLAS, mul(T(P[0], P[1], s * 0.062), RX(Math.PI / 2)));   // 轴端螺母
  }
  st.add(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), 'tinCold', MAT_ATLAS, mul(T(P[0], P[1], 0), RX(Math.PI / 2)));   // 枢轴
  // 刻度扇（+Z 叉板外面）：静止（倾 30°）与拉到底（水平）两道刻
  st.add(new THREE.CylinderGeometry(0.075, 0.075, 0.005, 16, 1, false, Math.PI * 0.5, Math.PI * 0.5), 'brass', MAT_ATLAS, mul(T(P[0], P[1], 0.0545), RX(Math.PI / 2)));
  for (const a of [IP.restTiltDeg, 90]) st.add(boxG(0.004, 0.03, 0.003), 'tinCold', MAT_ATLAS, mul(T(P[0], P[1], 0.058), RZ((-a * Math.PI) / 180), T(0, 0.055, 0)));
  // 观察窗铜框（机匣 +X 面，离地 0.33；汐站位能看到）
  st.add(lathe([[0.032, 0], [0.045, 0], [0.045, 0.008], [0.036, 0.014], [0.032, 0.01]], 20), 'brass', MAT_ATLAS, mul(T(P[0] + 0.075, IP.floorW + 0.33, 0), RZ(-Math.PI / 2)));
  // 发光件（共用 mat-prop-ignition-glow）
  const lens = new Builder(), cap = sphCap(IP.lensA, IP.lensTopW - IP.lensApexW);
  lens.add(cap.g, null, MAT_IGN_GLOW, mul(T(0, IP.lensApexW + cap.R, 0), RX(Math.PI)));
  const sight = new Builder(), sc = sphCap(0.033, 0.008, 16);
  sight.add(sc.g, null, MAT_IGN_GLOW, mul(T(P[0] + 0.083 - sc.R, IP.floorW + 0.33, 0), RZ(-Math.PI / 2)));
  // 拉杆（拉杆本地：+X = 枢轴方向（世界 +Z），+Z = 汐面朝方向（世界 −X）；握点静止 (0, 0.26, −0.15)，绕 +X 转 −60° 到 (0, 0, −0.30)）
  const lv = new Builder(), tilt = RX((-IP.restTiltDeg * Math.PI) / 180);
  lv.add(new THREE.CylinderGeometry(0.028, 0.028, 0.07, 14), 'tin', MAT_ATLAS, RZ(Math.PI / 2));                          // 轮毂
  lv.add(new THREE.CylinderGeometry(0.012, 0.016, 0.27, 8), 'tin', MAT_ATLAS, mul(tilt, T(0, 0.135, 0)), [0.2, 1]);       // 杆
  cappedTube(lv, [[-0.055, 0, 0], [0.055, 0, 0]].map((p) => V3(...p).applyMatrix4(mul(tilt, T(0, IP.lever, 0))).toArray()), 0.018, 4, 10, 'brass', [1, 0.3]);   // 横握把（掌心 = 握点）
  lv.add(new THREE.CylinderGeometry(0.01, 0.01, 0.06, 6), 'tin', MAT_ATLAS, mul(tilt, T(0, -0.03, 0)));
  lv.add(new THREE.SphereGeometry(0.03, 10, 6), 'tin', MAT_ATLAS, mul(tilt, T(0, -0.065, 0)));                            // 配重球
  const flip = (prims) => { for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) { p.pos[i + 1] *= -1; p.pos[i + 2] *= -1; p.nrm[i + 1] *= -1; p.nrm[i + 2] *= -1; } return prims; };
  const fT = (t) => [t[0], -t[1], -t[2]].map((v) => +v.toFixed(5) + 0);
  const leverW = RY(-Math.PI / 2);
  const gripRestW = V3(0, IP.lever, 0).applyMatrix4(mul(T(...P), leverW, tilt));
  const gripPulledW = V3(0, IP.lever, 0).applyMatrix4(mul(T(...P), leverW, RX((-60 * Math.PI) / 180), tilt));
  const S = [0, 21.85, 0], w = (v) => [v.x + S[0], v.y + S[1], v.z + S[2]].map((x) => +x.toFixed(4));
  console.log(`  ignite-lever 握点：静止 ${JSON.stringify(w(gripRestW))}（要 [1.05,23,0]）拉到底 ${JSON.stringify(w(gripPulledW))}（要 [1.2,22.74,0]）`);
  return {
    name: 'prop-ignition-port-s3',
    lods: [flip(st.build())],
    collider: new THREE.BoxGeometry(0.28, 0.74, 0.22).translate(P[0], IP.floorW + 0.37, 0).applyMatrix4(FL),
    tree: [
      { name: 'ignition-glow-lens', prims: flip(lens.build()), extras: { glowNode: true, material: 'mat-prop-ignition-glow', note: '点火口透镜（朝下，楼梯井仰视可见）；四态见材质 extras' } },
      { name: 'ignition-glow-sight', prims: flip(sight.build()), extras: { glowNode: true, material: 'mat-prop-ignition-glow', note: '拉杆机匣 +X 面观察窗（灯室里汐站位正对），和透镜同一材质同步' } },
      { name: 'ignite-lever', t: fT(P), r: Q(mul(FL.clone(), leverW)),
        extras: { rotates: 'x', originAt: '枢轴 S3 (0.9, 22.74, 0)', pullAxis: '节点本地 +X（= 世界 +Z）', pullDeg: -60, leverLenM: IP.lever, gripRestS3: w(gripRestW), gripPulledS3: w(gripPulledW),
          worldRotation: '世界旋转 = RY(−90°)（与白盒 ignite-lever-s3 / ignite-lever-socket 同向；根是翻转的 socket，所以本地旋转 = RX(180°)·RY(−90°)）', drive: 'artSlots delta ← ignite-lever-s3-swing；或按 xi-ignite-lever extras.align.igniteLever.angleDegPerFrame 逐帧设 rotation.x（第 34 帧 = −60°）' },
        children: [{ name: 'ignite-lever-mesh', prims: lv.build() }] },
    ],
    helpers: [
      { suffix: '-receiver', t: [0, 0, 0], extras: { receiver: true, note: '透镜中心 = 根原点 = S3 (0, 21.85, 0)（白盒 ignition-port-s3-receiver，align 零位移）；透镜朝下鼓出 0.05' } },
      { suffix: '-interact', t: fT([1.45, IP.floorW, -0.15]), r: Q(mul(FL.clone(), RY(-Math.PI / 2))),
        extras: { interact: true, anim: 'xi-ignite-lever', forPuzzle: 'ignite-lever', note: '= env ignite-lever-interact S3 (1.45, 22, −0.15)，世界 +Z 朝向 = −X（朝拉杆 / 灯机）' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'ignition-port-s3', ticket: 'v0.1-022', scale: 1,
      originAt: '透镜中心 = ignition-port-s3-socket S3 (0, 21.85, 0)；节点是翻转的（本地 +Y = 世界朝下），模型按这个翻转做好，挂上去即正',
      glowMaterial: 'mat-prop-ignition-glow', glowNodes: ['ignition-glow-lens', 'ignition-glow-sight'], leverNode: 'ignite-lever',
      leverPivotS3: [0.9, 22.74, 0], leverToNoteM: +Math.hypot(0.9 + 0.9408, 22.74 - 22.03, -0.1322).toFixed(3),
      note: '灯室地板中心的点火孔被主灯铸铁底座盖住，所以四态灯光除了洞里朝下的透镜，拉杆机匣上再开一个观察窗（同一材质）。油管从机匣下穿楼板、贴板底接到 env 点火口铁圈',
    },
  };
}

// ---------- 平滑法线 → COLOR_0 ----------
// ---------- 014 白石组 prop-white-stones-s2（S2 崖顶西坡，裁定 15 / 16：地面透视拼合「3 1 7」）----------
// 根 = 崖顶局部原点（= S2 局部，挂 env-clifftop-s2 根零变换），石块直接按崖顶坐标摆，贴实际地形（white-stones-s2-terrain.json）。
// 观察：固定第一人称眼位 WS.eye 看向 WS.lookAt，竖直 FOV 30°。屏幕切平面坐标 X = d·r / d·f（右 = 北 +Z）、Y = d·u / d·f（上）。
// 字高 4.5°、字宽 0.55 h、笔画 0.16 h、字中心距 = 字高 × 1.9 / 2.2；「1」居中在自己的格里。
// 横笔（a / g / d）= 两块低卧石；竖笔（b / c）= 一块顺视线方向立着的石板。每块石头数值拟合到笔画矩形（投影包围盒）。
// 装饰石：投影落在数字组外面（留边）。暗石：藏在立石板身后视线阴影里，眼位看不见，偏开以后冒出来把笔画搅乱。
const WS = { eye: [0.95, 4.35, 1.0], lookAt: [18, 0.2, 1], fovDeg: 30, digitDeg: 4.5, centerDeg: [0, -3.7], area: { x0: 14, x1: 22, z0: -2.5, z1: 4.5 } };
const MAT_WS_DIGIT = 12, MAT_WS_DECOR = 13;
MAT_TEXSET[MAT_WS_DIGIT] = MAT_TEXSET[MAT_WS_DECOR] = 'tex-prop-white-stones-s2';
const WS_MATS = {
  [MAT_WS_DIGIT]: { name: 'mat-prop-white-stones-digit-s2', extras: { programDriven: true, highlightTarget: true,
    drive: '对准度 0–1（ViewpointTarget）：material.emissive = #F2EEE4，emissiveIntensity = 对准度 × 0.35；描边加粗 / 提亮也只对这个材质做。glTF 默认 emissiveFactor 0 = 不亮',
    note: '构成「3 1 7」的白石（white-stones-digit-3 / -1 / -7 组下全部石块）；默认外观与装饰石完全一样' } },
  [MAT_WS_DECOR]: { name: 'mat-prop-white-stones-decor-s2', extras: { note: '散落装饰石 + 暗石（white-stones-decor / white-stones-hidden），不参与加亮；外观与数字石相同' } },
};
const wsTerrain = JSON.parse(readFileSync(join(ART, 'source/props/white-stones-s2-terrain.json'), 'utf8'));
function wsGround(x, z) {
  const T = wsTerrain, fi = (x - T.x0) / T.step, fj = (z - T.z0) / T.step;
  const i = Math.max(0, Math.min(T.nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(T.nz - 2, Math.floor(fj))), u = fi - i, v = fj - j;
  const y = (a, b) => T.y[(j + b) * T.nx + i + a];
  return (y(0, 0) * (1 - u) + y(1, 0) * u) * (1 - v) + (y(0, 1) * (1 - u) + y(1, 1) * u) * v;
}
function wsCam(eye = WS.eye, look = WS.lookAt) {
  const E = V3(...eye), f = V3(...look).sub(E).normalize(), r = new THREE.Vector3().crossVectors(f, V3(0, 1, 0)).normalize(), u = new THREE.Vector3().crossVectors(r, f);
  return { E, f, r, u, proj: (p) => { const d = new THREE.Vector3().subVectors(p, E); const z = d.dot(f); return [d.dot(r) / z, d.dot(u) / z]; } };
}
function wsRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 单位石块：x 深（顺视线）、z 横、y 0…1（底平），圆角方块 + 低频鼓包
function wsUnitStone(seed, kind) {
  const R = wsRng(seed), waves = [...Array(5)].map(() => ({ k: V3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize().multiplyScalar(1.5 + R() * 2.5), ph: R() * 6.28, a: 0.03 + R() * 0.05 }));
  let g = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
  const p = g.attributes.position, s = new THREE.Vector3(), boxy = kind === 'slab' ? 0.45 : 0.55;
  const taper = kind === 'slab' ? 0.18 + R() * 0.12 : 0.1 + R() * 0.15, lean = kind === 'slab' ? 0.55 + R() * 0.1 : (R() - 0.5) * 0.12;   // 立石板顶往远处仰 ~24°：朝眼位的面多吃天光，竖笔不发黑
  for (let i = 0; i < p.count; i++) {
    s.fromBufferAttribute(p, i);
    let n = 0; for (const w of waves) n += Math.sin(s.dot(w.k) + w.ph) * w.a;
    const q = V3(Math.sign(s.x) * Math.abs(s.x) ** boxy, Math.sign(s.y) * Math.abs(s.y) ** boxy, Math.sign(s.z) * Math.abs(s.z) ** boxy).multiplyScalar(1 + n);
    let y = (q.y + 1) / 2; y = Math.max(y, 0.06) - 0.06; y /= 0.94 + 0.15;                     // 底削平
    const k = 1 - taper * y;                                                                    // 往上收
    p.setXYZ(i, (q.x * 0.5 * k) + lean * y, Math.max(0, y), q.z * 0.5 * k);
  }
  const bb = new THREE.Box3().setFromBufferAttribute(p), sz = bb.getSize(new THREE.Vector3());
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.scale(1 / sz.x, 1 / sz.y, 1 / sz.z);
  return g;
}
// 放一块石头：中心地面点 (px, pz)，横向朝向 = 垂直于眼位视线方位；dims = [深, 高, 横]
function wsPlace(unit, px, pz, dims, cam) {
  const az = Math.atan2(px - cam.E.x, pz - cam.E.z);                                              // 视线方位
  const half = Math.hypot(dims[0], dims[2]) / 2;
  let gy = Infinity; for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) gy = Math.min(gy, wsGround(px + a * half * 0.7, pz + b * half * 0.7));
  const sink = 0.03 + 0.05 * dims[1];
  const M = mul(T(px, gy - sink, pz), RY(az - Math.PI / 2), new THREE.Matrix4().makeScale(dims[0], dims[1] + sink, dims[2]));
  return { g: unit.clone().applyMatrix4(M), M, base: [px, gy, pz], az };
}
const wsBox = (g, cam) => { const p = g.attributes.position, v = new THREE.Vector3(); let b = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < p.count; i++) { const [X, Y] = cam.proj(v.fromBufferAttribute(p, i)); b = [Math.min(b[0], X), Math.max(b[1], X), Math.min(b[2], Y), Math.max(b[3], Y)]; } return b; };
// 拟合：投影包围盒 → 目标矩形 [X0, X1, Y0, Y1]
function wsFit(unit, rect, kind, cam) {
  const [X0, X1, Y0, Y1] = rect, Xc = (X0 + X1) / 2, Yc = (Y0 + Y1) / 2;
  // 初值：矩形底边中点那条射线落地处
  const rayGround = (X, Y) => { const d = cam.f.clone().addScaledVector(cam.r, X).addScaledVector(cam.u, Y).normalize(); let lo = 0, hi = 60;
    for (let q = 0; q < 50; q++) { const m = (lo + hi) / 2, p = cam.E.clone().addScaledVector(d, m); if (p.y > wsGround(p.x, p.z)) lo = m; else hi = m; } return cam.E.clone().addScaledVector(d, lo); };
  let c = rayGround(Xc, Y0), dist = c.distanceTo(cam.E);
  let depth = kind === 'slab' ? 0.42 : 0.34, w = (X1 - X0) * dist, h = kind === 'slab' ? (Y1 - Y0) * dist : 0.14;
  const fwd = V3(c.x - cam.E.x, 0, c.z - cam.E.z).normalize(), lat = V3(fwd.z, 0, -fwd.x).multiplyScalar(-1);
  let px = c.x, pz = c.z, out;
  for (let it = 0; it < 60; it++) {
    out = wsPlace(unit, px, pz, [depth, h, w], cam);
    const b = wsBox(out.g, cam); dist = Math.hypot(px - cam.E.x, pz - cam.E.z);
    // 横向：中心 + 宽度
    const ex = (b[0] + b[1]) / 2 - Xc; px -= lat.x * ex * dist; pz -= lat.z * ex * dist;
    w *= Math.min(1.3, Math.max(0.75, (X1 - X0) / (b[1] - b[0])));
    // 竖向：底边对 Y0（往远 = 抬高），顶边靠高度
    const ey = b[2] - Y0, step = -ey * dist * dist / Math.max(0.5, cam.E.y - out.base[1]) * 0.8;
    px += fwd.x * step; pz += fwd.z * step;
    const span = Y1 - Y0, got = b[3] - b[2];
    h *= Math.min(1.3, Math.max(0.75, span / got));
    if (kind !== 'slab' && h < 0.07) { h = 0.07; depth *= 0.85; }
  }
  const b = wsBox(out.g, cam);
  return { ...out, dims: [depth, h, w], box: b, err: Math.max(Math.abs(b[0] - X0), Math.abs(b[1] - X1), Math.abs(b[2] - Y0), Math.abs(b[3] - Y1)) };
}
// 平面投影 UV（按面法线选投影面），按石块尺寸归一化到 [0.02, 0.98] 内的一块（clamp sampler）
function wsUV(g, local, R) {
  g = g.toNonIndexed(); const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  const lp = local.toNonIndexed().attributes.position;
  const sc = 0.5 + R() * 0.45, ou = 0.02 + R() * (0.96 - sc), ov = 0.02 + R() * (0.96 - sc);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(lp, t); b.fromBufferAttribute(lp, t + 1); c.fromBufferAttribute(lp, t + 2);
    fn.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)); const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) { const q = [a, b, c][k];
      let u, v; if (ay >= ax && ay >= az) { u = q.z + 0.5; v = q.x + 0.5; } else if (ax >= az) { u = q.z + 0.5; v = 1 - q.y; } else { u = q.x + 0.5; v = 1 - q.y; }
      uv[(t + k) * 2] = ou + Math.min(1, Math.max(0, u)) * sc; uv[(t + k) * 2 + 1] = ov + Math.min(1, Math.max(0, v)) * sc; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return mergeVertices(g, 1e-5);                                                                 // 同位置同 UV 的顶点焊回去
}
function whiteStones() {
  const cam = wsCam(), D = (d) => Math.tan((d * Math.PI) / 180);
  const H = D(WS.digitDeg), Wd = H * 0.55, t = H * 0.16, step = H * 1.9 / 2.2, [cx, cy] = WS.centerDeg.map(D);
  const segs = { a: [-Wd / 2, Wd / 2, H / 2 - t, H / 2], g: [-Wd / 2, Wd / 2, -t / 2, t / 2], d: [-Wd / 2, Wd / 2, -H / 2, -H / 2 + t],
    b: [Wd / 2 - t, Wd / 2, 0, H / 2], c: [Wd / 2 - t, Wd / 2, -H / 2, 0] };
  const digits = [{ n: 3, segs: 'agdbc', dx: 0 }, { n: 1, segs: 'bc', dx: -(Wd / 2 - t / 2) }, { n: 7, segs: 'abc', dx: 0 }];
  const R = wsRng(317), groups = [], allBoxes = [], placed = [];
  let seed = 100, stoneCount = 0;
  const stoneNode = (name, fit, mat, collider) => {
    const local = fit.g.clone().applyMatrix4(T(-fit.base[0], -fit.base[1], -fit.base[2]));
    local.computeVertexNormals();
    const unitLocal = fit.g.clone().applyMatrix4(new THREE.Matrix4().copy(fit.M).invert());
    const g = wsUV(local, unitLocal, R), b = new Builder(); b.addRaw(g, mat);
    const kids = [];
    if (collider) { const [dd, hh, ww] = fit.dims; kids.push({ name: `${name}-collider`, colliderGeom: new THREE.BoxGeometry(dd * 0.8, hh, ww * 0.8).applyMatrix4(mul(RY(fit.az - Math.PI / 2), T(0, hh / 2 - 0.03, 0))) }); }
    stoneCount++;
    for (const k of kids) k.colliderGeom.applyMatrix4(T(...fit.base));                    // 碰撞体做同组兄弟节点（零变换，世界坐标）
    return [{ name, t: fit.base.map((v) => +v.toFixed(4)), prims: b.build(),
      extras: { sizeM: { width: +fit.dims[2].toFixed(3), height: +fit.dims[1].toFixed(3), depth: +fit.dims[0].toFixed(3) }, ...(kids.length ? { collider: `${name}-collider` } : {}) } }, ...kids];
  };
  const report = [];
  digits.forEach((dg, k) => {
    const x0 = cx + (k - 1) * step + dg.dx, kids = [];
    for (const s of dg.segs) {
      const [a, b, c, d] = segs[s], rect = [x0 + a, x0 + b, cy + c, cy + d];
      const parts = 'agd'.includes(s) ? [[rect[0], rect[0] + (rect[1] - rect[0]) * 0.52], [rect[0] + (rect[1] - rect[0]) * 0.52, rect[1]]] : [[rect[0], rect[1]]];
      parts.forEach(([p0, p1], i) => {
        const kind = 'agd'.includes(s) ? 'lie' : 'slab', unit = wsUnitStone(seed++, kind);
        const fit = wsFit(unit, [p0, p1, rect[2], rect[3]], kind, cam);
        placed.push({ ...fit, kind, digit: dg.n, seg: s });
        allBoxes.push(fit.box);
        report.push(`${dg.n}${s}${i} ${kind} 底 (${fit.base.map((v) => v.toFixed(2)).join(',')}) 尺寸 深${fit.dims[0].toFixed(2)} 高${fit.dims[1].toFixed(2)} 横${fit.dims[2].toFixed(2)} 拟合误差 ${(Math.atan(fit.err) * 180 / Math.PI).toFixed(2)}°`);
        kids.push(...stoneNode(`white-stone-d${dg.n}-${s}${parts.length > 1 ? i : ''}`, fit, MAT_WS_DIGIT, kind === 'slab' || fit.dims[2] > 0.5));
      });
    }
    groups.push({ name: `white-stones-digit-${dg.n}`, extras: { digit: dg.n, readOrder: k, highlightMaterial: 'mat-prop-white-stones-digit-s2', note: `「${dg.n}」：从眼位看从左（南）到右（北）第 ${k + 1} 个` }, children: kids });
  });
  // 暗石：立石板身后、视线阴影里
  const hidden = [];
  for (const s of placed.filter((p) => p.kind === 'slab')) {
    const top = s.box[3], fwd = V3(s.base[0] - cam.E.x, 0, s.base[2] - cam.E.z).normalize();
    for (let i = 0; i < 2; i++) {
      const back = s.dims[0] / 2 + 0.25 + i * 0.55, px = s.base[0] + fwd.x * back, pz = s.base[2] + fwd.z * back;
      const dist = Math.hypot(px - cam.E.x, pz - cam.E.z);
      // 这点上视线（过石板顶边）的高度：沿视线方向，屏幕 Y = top 的射线
      const dir = cam.f.clone().addScaledVector(cam.u, top).normalize(), tt = dist / Math.hypot(dir.x, dir.z), lineY = cam.E.y + dir.y * tt;
      const room = lineY - wsGround(px, pz) - 0.06;
      if (room < 0.1) continue;
      const unit = wsUnitStone(seed++, 'lie'), w = (s.box[1] - s.box[0]) * dist * 0.6;
      const fit = wsPlace(unit, px, pz, [0.3, Math.min(room * 0.8, 0.3), w], cam);
      hidden.push({ ...fit, dims: [0.3, Math.min(room * 0.8, 0.3), w] });
    }
  }
  // 装饰石：投影在数字组外（留 0.8°），石块之间不重叠，都在 stonesArea 里
  const gb = allBoxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])]);
  const m = D(1.6), A = WS.area, decor = [];
  const clear = (x, z, r) => [...placed, ...hidden, ...decor].every((p) => Math.hypot(p.base[0] - x, p.base[2] - z) > r + 0.45);
  for (let tries = 0; decor.length < 12 && tries < 4000; tries++) {
    const x = A.x0 + 0.4 + R() * (A.x1 - A.x0 - 0.8), z = A.z0 + 0.4 + R() * (A.z1 - A.z0 - 0.8), big = R() < 0.3;
    const dims = big ? [0.45 + R() * 0.3, 0.3 + R() * 0.25, 0.5 + R() * 0.35] : [0.22 + R() * 0.2, 0.1 + R() * 0.12, 0.25 + R() * 0.25];
    if (!clear(x, z, Math.max(dims[0], dims[2]) / 2)) continue;
    const unit = wsUnitStone(seed + 1000 + tries, big ? 'slab' : 'lie'), fit = wsPlace(unit, x, z, dims, cam), b = wsBox(fit.g, cam);
    if (!(b[1] < gb[0] - m || b[0] > gb[1] + m || b[3] < gb[2] - m || b[2] > gb[3] + m)) continue;
    decor.push({ ...fit, dims, big });
  }
  for (const p of [...placed, ...hidden, ...decor]) { const bb = new THREE.Box3().setFromBufferAttribute(p.g.attributes.position);
    if (bb.min.x < A.x0 || bb.max.x > A.x1 || bb.min.z < A.z0 || bb.max.z > A.z1) throw new Error(`白石出界 ${p.base}`); }
  groups.push({ name: 'white-stones-decor', extras: { decor: true, note: '散落装饰石：眼位看在数字组外（≥ 1.6°），不参与加亮' },
    children: decor.flatMap((f, i) => stoneNode(`white-stone-decor-${String(i).padStart(2, '0')}`, f, MAT_WS_DECOR, f.big)) });
  groups.push({ name: 'white-stones-hidden', extras: { decor: true, hiddenFromViewpoint: true, note: '暗石：藏在立石板身后视线阴影里，眼位看不见；离开眼位后冒出来，让笔画散开读不出。不参与加亮' },
    children: hidden.flatMap((f, i) => stoneNode(`white-stone-hidden-${String(i).padStart(2, '0')}`, f, MAT_WS_DECOR, false)) });
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.E, V3(...WS.lookAt), V3(0, 1, 0)));
  console.log(report.join('\n') + `\n  数字石 ${placed.length}、装饰 ${decor.length}、暗石 ${hidden.length}；数字组屏幕范围 X ${(Math.atan(gb[0]) * 57.3).toFixed(2)}…${(Math.atan(gb[1]) * 57.3).toFixed(2)}° Y ${(Math.atan(gb[2]) * 57.3).toFixed(2)}…${(Math.atan(gb[3]) * 57.3).toFixed(2)}°`);
  return {
    name: 'prop-white-stones-s2', lods: [],
    tree: groups,
    helpers: [
      { suffix: '-viewpoint', t: WS.eye, r: [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(6)), extras: { camera: true, fovDeg: WS.fovDeg, lookAt: WS.lookAt, note: '裁定 16：观察模式固定第一人称眼位；−Z 朝 lookAt（glTF 相机约定），= 白盒 viewpoint-s2' } },
    ],
    rootExtras: {
      puzzleCritical: true, puzzle: 'white-stones-s2', ticket: 'v0.1-014 / 021，裁定 15 / 16', scale: 1, readsAs: '3 1 7', readOrder: '眼位看从左（南）到右（北）',
      originAt: '崖顶局部原点（= S2 局部）：挂 env-clifftop-s2 根，零变换；石块按崖顶坐标摆，贴实际地形',
      viewpoint: { eye: WS.eye, lookAt: WS.lookAt, fovDeg: WS.fovDeg, toleranceDeg: 6, fadeFromDeg: 12 },
      screenLayout: { digitHeightDeg: WS.digitDeg, centerDeg: WS.centerDeg, digitWidthRatio: 0.55, strokeRatio: 0.16, spacingRatio: 1.9 / 2.2 },
      stonesArea: [A.x0, A.x1, A.z0, A.z1],
      digitGroups: ['white-stones-digit-3', 'white-stones-digit-1', 'white-stones-digit-7'], digitMaterial: 'mat-prop-white-stones-digit-s2',
      decorGroups: ['white-stones-decor', 'white-stones-hidden'], decorMaterial: 'mat-prop-white-stones-decor-s2',
      note: '对准渐显改为给 digitMaterial 加亮 / 描边（程序关掉七段贴片）。每块石头一个节点；立石板与大石有 -collider（盒），小卧石没有',
    },
  };
}

function outlineColors(prims) {
  const key = (p, i) => `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`;
  const acc = new Map();
  const a = V3(), b = V3(), c = V3(), ab = V3(), ac = V3();
  for (const { pos, idx } of prims) for (let t = 0; t < idx.length; t += 3) {
    a.fromArray(pos, idx[t] * 3); b.fromArray(pos, idx[t + 1] * 3); c.fromArray(pos, idx[t + 2] * 3);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a)); // 长度 = 2×面积 → 面积加权
    for (let k = 0; k < 3; k++) {
      const kk = key(pos, idx[t + k]);
      const v = acc.get(kk) ?? acc.set(kk, V3()).get(kk);
      v.add(n);
    }
  }
  for (const p of prims) {
    const n = p.pos.length / 3, col = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = (acc.get(key(p.pos, i)) ?? V3(0, 1, 0)).clone();
      if (v.lengthSq() < 1e-20) v.set(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]);
      v.normalize();
      col[i * 4] = Math.round((v.x * 0.5 + 0.5) * 255); col[i * 4 + 1] = Math.round((v.y * 0.5 + 0.5) * 255);
      col[i * 4 + 2] = Math.round((v.z * 0.5 + 0.5) * 255); col[i * 4 + 3] = 255;
    }
    p.col = col;
  }
}

// ---------- 顶点缓存优化（meshopt reorder） ----------
function reorder(p) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(p.idx, true, true);
  const out = (src, k, T) => { const d = new T(unique * k); for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let j = 0; j < k; j++) d[remap[i] * k + j] = src[i * k + j]; return d; };
  p.pos = out(p.pos, 3, Float32Array); p.nrm = out(p.nrm, 3, Float32Array); p.uv = out(p.uv, 2, Float32Array); p.col = out(p.col, 4, Uint8Array);
}

// ---------- GLB 写出（手写 JSON，支持 EXT_meshopt_compression / EXT_texture_webp） ----------
const srgbToLinear = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

function writeGlb(prop, images, path) {
  const json = {
    asset: { version: '2.0', generator: 'game-studio art/tools/build-props-ch1.mjs' },
    scene: 0, scenes: [{ name: prop.name, nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
    buffers: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    extensionsUsed: [], extensionsRequired: [],
  };
  const chunks = []; let off = 0;
  const pushBin = (u8) => { const o = off; chunks.push(u8); off += u8.byteLength; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } return o; };
  const mo = USE_MESHOPT;
  const fallbackLen = { n: 0 };
  const view = (u8, stride, count, mode, target) => {
    const bv = { buffer: 0, byteOffset: 0, byteLength: u8.byteLength };
    if (stride && mode === 'ATTRIBUTES') bv.byteStride = stride;
    if (target) bv.target = target;
    if (mo && mode) {
      const enc = MeshoptEncoder.encodeGltfBuffer(u8, count, stride, mode, 0);
      const fo = fallbackLen.n; fallbackLen.n += Math.ceil(u8.byteLength / 4) * 4;
      bv.buffer = 1; bv.byteOffset = fo;
      bv.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: pushBin(enc), byteLength: enc.byteLength, byteStride: stride, count, mode } };
    } else bv.byteOffset = pushBin(u8);
    json.bufferViews.push(bv); return json.bufferViews.length - 1;
  };
  const acc = (o) => { json.accessors.push(o); return json.accessors.length - 1; };
  const u8 = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);

  // 贴图 + 材质（只嵌本件用到的贴图组：图集 tex-props-puzzle-ch1 / 潮汐钟 tex-prop-tide-bell）
  const treePrims = (nodes) => (nodes ?? []).flatMap((n) => [...(n.prims ?? []), ...treePrims(n.children)]);
  const allPrims = [...(prop.lods ?? [prop.prims]).flat(), ...treePrims(prop.tree)];
  const usedMats = [...new Set(allPrims.map((p) => p.mat))].sort();
  const texIdx = {};
  const ext = USE_PNG ? null : 'EXT_texture_webp';
  for (const set of [...new Set(usedMats.map((m) => MAT_TEXSET[m]).filter(Boolean))]) {
    for (const [k, file] of Object.entries(images(set))) {
      const bv = json.bufferViews.push({ buffer: 0, byteOffset: pushBin(readFileSync(file)), byteLength: readFileSync(file).byteLength }) - 1;
      json.images.push({ name: `${set}-${k}`, bufferView: bv, mimeType: USE_PNG ? 'image/png' : 'image/webp' });
      const img = json.images.length - 1;
      json.textures.push(ext ? { sampler: 0, extensions: { [ext]: { source: img } } } : { sampler: 0, source: img });
      texIdx[`${set}-${k}`] = json.textures.length - 1;
    }
  }
  if (ext && json.images.length) { json.extensionsUsed.push(ext); json.extensionsRequired.push(ext); }
  const matIndex = {};
  const pbrTex = (set, name, extras) => {
    const m = { name, pbrMetallicRoughness: { baseColorTexture: { index: texIdx[`${set}-albedo`] }, metallicRoughnessTexture: { index: texIdx[`${set}-orm`] }, metallicFactor: 1, roughnessFactor: 1 },
      normalTexture: { index: texIdx[`${set}-normal`], scale: 1 }, occlusionTexture: { index: texIdx[`${set}-orm`], strength: 1 } };
    if (extras) m.extras = extras;
    return m;
  };
  for (const mat of usedMats) {
    if (mat === MAT_ATLAS) json.materials.push(pbrTex(MAT_TEXSET[mat], 'mat-prop-puzzle-ch1'));
    else if (mat === MAT_KEY) { const m = pbrTex(MAT_TEXSET[mat], 'mat-prop-key-brass', { ticket: 'v0.1-029', note: '略反光的旧黄铜：图集黄铜区 × metallicFactor / roughnessFactor；不自发光。配合程序交互高亮 + 地窖兜底点光（#C4D2DE 0.4 cd）在地窖入口能看到一点金属闪光' });
      m.pbrMetallicRoughness.metallicFactor = KEY_MAT.metal; m.pbrMetallicRoughness.roughnessFactor = KEY_MAT.rough; json.materials.push(m); }
    else if (mat === MAT_BELL) json.materials.push(pbrTex(MAT_TEXSET[mat], 'mat-prop-tide-bell', {
      wetMetal: true, specStepped: true, specColor: '#DCE1E4', specTint: '#D2E3E6',
      note: '湿铜（GDD §6 S1 / 需求单 021）：阴天也要有一道明显的冷色阶梯高光，颜色接近雾白 #DCE1E4、略偏青；023 toon 替换时按 wetMetal 处理。石柱 / 熟铁共用这张贴图（ORM 金属度 0），高光只在铜上明显',
    }));
    else if (mat === MAT_RAFT) json.materials.push(pbrTex(MAT_TEXSET[mat], 'mat-prop-raft-s1', {
      wetWood: true, note: '泡过海水的旧木 + 少量熟铁 / 麻绳共用一张图（ORM 金属度只在铁件上）；推把掌心处手磨油亮（粗糙度低）；原木吃水线以下藻 + 藤壶',
    }));
    else if (WS_MATS[mat]) json.materials.push(pbrTex(MAT_TEXSET[mat], WS_MATS[mat].name, WS_MATS[mat].extras));
    else if (GLOW[mat]) { const g = GLOW[mat]; json.materials.push({ name: g.name, pbrMetallicRoughness: { baseColorFactor: [...srgbToLinear(g.base), 1], metallicFactor: 0, roughnessFactor: g.rough }, emissiveFactor: [0, 0, 0], extras: g.extras }); }
    else json.materials.push({ name: 'mat-prop-lantern-glow', alphaMode: 'BLEND', doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [...srgbToLinear('#8A6A44'), 0.55], metallicFactor: 0, roughnessFactor: 0.12 },
      emissiveFactor: srgbToLinear('#E8A24A'), extras: { glowDefault: 1.0, glowColor: '#E8A24A' } });
    matIndex[mat] = json.materials.length - 1;
  }

  const meshPrim = (p) => {
    const n = p.pos.length / 3;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.pos[i * 3 + k]); max[k] = Math.max(max[k], p.pos[i * 3 + k]); }
    const idx = n < 65536 ? new Uint16Array(p.idx) : p.idx;
    const attributes = {
      POSITION: acc({ bufferView: view(u8(p.pos), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3', min, max }),
      NORMAL: acc({ bufferView: view(u8(p.nrm), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3' }),
      TEXCOORD_0: acc({ bufferView: view(u8(p.uv), 8, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC2' }),
    };
    if (p.col) attributes.COLOR_0 = acc({ bufferView: view(u8(p.col), 4, n, 'ATTRIBUTES', 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
    const indices = acc({ bufferView: view(u8(idx), idx.BYTES_PER_ELEMENT, p.idx.length, 'TRIANGLES', 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' });
    const prim = { attributes, indices, mode: 4 };
    if (p.mat !== undefined) prim.material = matIndex[p.mat];
    return prim;
  };

  // 节点：根（extras.puzzleCritical）→ _lod0 网格、-collider、辅助空节点
  const root = { name: prop.name, children: [], extras: prop.rootExtras ?? { puzzleCritical: true } };
  json.nodes.push(root);
  const lods = prop.lods ?? [prop.prims];
  lods.forEach((prims, i) => {
    json.meshes.push({ name: `${prop.name}_lod${i}`, primitives: prims.map(meshPrim) });
    root.children.push(json.nodes.push({ name: `${prop.name}_lod${i}`, mesh: json.meshes.length - 1 }) - 1);
  });
  const colPrim = (geo) => { const cg = geo.toNonIndexed(); return { pos: new Float32Array(cg.attributes.position.array), nrm: new Float32Array(cg.attributes.normal.array), uv: new Float32Array(cg.attributes.uv.array), idx: new Uint32Array([...Array(cg.attributes.position.count).keys()]) }; };
  if (prop.collider) { // 可动件的碰撞（例：拨盘铁门跟门扇转）放在子节点树里（spec.colliderGeom）
    json.meshes.push({ name: `${prop.name}-collider`, primitives: [meshPrim(colPrim(prop.collider))] });
    root.children.push(json.nodes.push({ name: `${prop.name}-collider`, mesh: json.meshes.length - 1, extras: { collider: true } }) - 1);
  }
  for (const h of prop.helpers) {
    const node = { name: prop.name + h.suffix, translation: h.t };
    if (h.r) node.rotation = h.r;
    if (h.extras) node.extras = h.extras;
    root.children.push(json.nodes.push(node) - 1);
  }
  // 可动子节点树（例：潮汐钟 bell-swing → bell-clapper）：节点自带网格（网格名 = 节点名），渲染时各级都显示，计入 LOD0
  const addTree = (spec, parentNode) => {
    const node = { name: spec.name };
    if (spec.t) node.translation = spec.t;
    if (spec.r) node.rotation = spec.r;
    if (spec.extras) node.extras = spec.extras;
    if (spec.prims) { json.meshes.push({ name: spec.name, primitives: spec.prims.map(meshPrim) }); node.mesh = json.meshes.length - 1; }
    if (spec.colliderGeom) { json.meshes.push({ name: spec.name, primitives: [meshPrim(colPrim(spec.colliderGeom))] }); node.mesh = json.meshes.length - 1; node.extras = { collider: true, ...(spec.extras ?? {}) }; }
    const idx = json.nodes.push(node) - 1;
    (parentNode.children ??= []).push(idx);
    for (const c of spec.children ?? []) addTree(c, node);
  };
  for (const spec of prop.tree ?? []) addTree(spec, root);

  if (mo) {
    json.extensionsUsed.push('EXT_meshopt_compression'); json.extensionsRequired.push('EXT_meshopt_compression');
    json.buffers.push({ byteLength: off }, { byteLength: fallbackLen.n, extensions: { EXT_meshopt_compression: { fallback: true } } });
  } else json.buffers.push({ byteLength: off });
  if (!json.extensionsUsed.length) { delete json.extensionsUsed; delete json.extensionsRequired; }

  const bin = new Uint8Array(off); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(total, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  writeFileSync(path, Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), Buffer.from(bin)]));
  const treeTris = treePrims(prop.tree).reduce((s, p) => s + p.idx.length / 3, 0);
  const lodTris = lods.length ? lods.map((l) => l.reduce((s, p) => s + p.idx.length / 3, 0) + treeTris) : [treeTris];   // 白石组：全部网格都在节点树里
  return { triangles: lodTris[0], lodTris, treeTris, bytes: total };
}

// ---------- 主流程 ----------
await MeshoptEncoder.ready;
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'props-ch1-'));
const imgCache = {};
// 贴图组 → { albedo, normal, orm } 文件（WebP 中间格式；正式交付 glb-pack-ktx2 按图像名换成 art/textures/<名>.ktx2）
const images = (set) => imgCache[set] ??= Object.fromEntries(['albedo', 'normal', 'orm'].map((k) => {
  const src = join(TEX, `${set}-${k}.png`);
  if (USE_PNG) return [k, src];
  const dst = join(tmp, `${set}-${k}.webp`);
  const q = k === 'albedo' ? 90 : 95;
  execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(src)}).save(${JSON.stringify(dst)}, 'WEBP', quality=${q}, method=6)`]);
  return [k, dst];
}));
const LIMIT = { 'prop-lantern-brass': 8000, 'prop-lantern-stand-s2': 15000, 'prop-key-cellar-s2': 400, 'prop-tide-bell': 20000, 'prop-raft-s1': 15000,
  'prop-mirror-stand-s2': 15000, 'prop-guide-mirror-wall-s3-a': 15000, 'prop-guide-mirror-wall-s3-b': 15000, 'prop-dial-gate-s2': 15000,
  'prop-light-lock-s2': 15000, 'prop-oil-valve-s3': 15000, 'prop-guide-mirror-window-s3': 15000, 'prop-ignition-port-s3': 15000, 'prop-key-lighthouse': 3000, 'prop-white-stones-s2': 20000 };
let fail = false;
for (const make of [lantern, stand, keyCellar, tideBell, raft, mirrorStand, () => guideMirrorWall('a'), () => guideMirrorWall('b'), dialGate,
  lightLock, oilValve, guideMirrorWindow, ignitionPort, () => keyCellar('prop-key-lighthouse'), whiteStones]) {
  const prop = make();
  if (ONLY.length && !ONLY.includes(prop.name)) continue;
  const treeMeshes = (nodes) => (nodes ?? []).flatMap((n) => [...(n.prims ? [n.prims] : []), ...treeMeshes(n.children)]);
  for (const prims of [...(prop.lods ?? [prop.prims]), ...treeMeshes(prop.tree)]) { outlineColors(prims); if (USE_MESHOPT) prims.forEach(reorder); }
  const file = join(OUT, `${prop.name}.glb`);
  const { triangles, lodTris, treeTris, bytes } = writeGlb(prop, images, file);
  const ok = triangles <= LIMIT[prop.name];
  fail ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${file}  三角面 ${triangles} / ${LIMIT[prop.name]}${lodTris.length > 1 ? `（LOD ${lodTris.join(' / ')}）` : ''}${treeTris ? `（含可动子节点 ${treeTris}）` : ''}  ${(bytes / 1024).toFixed(0)} KB`);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
