// 主角「汐」（需求单 v0.1-016）第一步：程序化 blockout + look-dev → 带骨骼蒙皮的 GLB。无需 Blender。
//   node art/tools/build-char-xi.mjs [--no-meshopt] [--png]
// 输出：art/models/characters/char-xi.glb
// 约定：1 单位 = 1 m，+Y 向上，正面 +Z，原点在两脚之间地面；默认 A-pose（手臂下垂 45°）。
//   节点：char-xi（根）→ root（骨骼根）+ char-xi_lod0 / _lod1 / _lod2（同一套骨骼 skin 0）。
//   hand_r_socket：hand_r 的子节点 = 风灯原点（提环抓握点）；+Y 沿前臂指向手肘（手臂下垂时朝上），+X = 握拳轴（下垂时朝前）。
//   COLOR_0 = 平滑法线（RGBA8 归一化，n*0.5+0.5）给外扩描边；材质不要开 vertexColors。
//   材质 3 个：mat-char-xi-body（身体/衣服图集）、mat-char-xi-hair、mat-char-xi-face。
// 贴图来自 art/source/characters/gen_tex_char_xi.py（只做了 albedo，2048）；正式 4096 + normal/orm/sdf/ramp、KTX2 待 Blender 流程。
import * as THREE from '../../game/node_modules/three/build/three.module.js';
import { MeshoptEncoder } from '../../game/node_modules/meshoptimizer/index.js';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = join(ART, 'source/textures');
const OUT = join(ART, 'models/characters');
const USE_MESHOPT = !process.argv.includes('--no-meshopt');
const USE_PNG = process.argv.includes('--png');

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 图集分区（和 gen_tex_char_xi.py 一致；v 从图像顶部算） ----------
const REGION = {
  coat: [0, 0, 0.5, 0.5], sleeve_l: [0.5, 0, 0.25, 0.5], sleeve_r: [0.75, 0, 0.25, 0.5],
  hood: [0, 0.5, 0.25, 0.25], lining: [0.25, 0.5, 0.25, 0.25], sweater: [0.5, 0.5, 0.25, 0.25],
  pants: [0.75, 0.5, 0.25, 0.25], boots: [0, 0.75, 0.25, 0.25], skin: [0.25, 0.75, 0.25, 0.25], trim: [0.5, 0.75, 0.25, 0.25],
  hair: [0, 0, 1, 1],
};
const PAD = 0.012;
const MAT_BODY = 0, MAT_HAIR = 1, MAT_FACE = 2;
const MAT_NAMES = ['mat-char-xi-body', 'mat-char-xi-hair', 'mat-char-xi-face'];

// =====================================================================================
// 骨骼（绑定姿势下所有骨骼旋转为单位四元数，只有平移；名字小写英文 + 下划线）
// =====================================================================================
const BONES = []; const BI = {};
function bone(name, parent, pos, tail) { BI[name] = BONES.length; BONES.push({ name, parent, pos: pos.clone(), tail: tail.clone() }); }
const A_ANG = 45 * D2R;
const armDir = (s) => V3(s * Math.cos(A_ANG), -Math.sin(A_ANG), 0);
const palmN = (s) => V3(-s * Math.sin(A_ANG), -Math.cos(A_ANG), 0); // 掌心朝向（朝身体、朝下）
const W_AX = V3(0, 0, 1);                                             // 掌宽方向，拇指在 +Z（前）
const HEAD_C = V3(0, 1.37, -0.005), HEAD_R = V3(0.074, 0.112, 0.091);

bone('root', null, V3(0, 0, 0), V3(0, 0.1, 0));
bone('hips', 'root', V3(0, 0.82, 0), V3(0, 0.92, -0.005));
bone('spine_01', 'hips', V3(0, 0.92, -0.005), V3(0, 1.01, -0.01));
bone('spine_02', 'spine_01', V3(0, 1.01, -0.01), V3(0, 1.10, -0.012));
bone('chest', 'spine_02', V3(0, 1.10, -0.012), V3(0, 1.24, -0.018));
bone('neck', 'chest', V3(0, 1.24, -0.018), V3(0, 1.295, -0.01));
bone('head', 'neck', V3(0, 1.295, -0.01), V3(0, 1.47, -0.01));
const ARM = {};
for (const [s, sd] of [[1, 'l'], [-1, 'r']]) {
  const a = armDir(s), n = palmN(s);
  const sh = V3(s * 0.025, 1.19, -0.015), ua = V3(s * 0.155, 1.175, -0.015);
  const la = ua.clone().addScaledVector(a, 0.25), hd = la.clone().addScaledVector(a, 0.22);
  bone(`shoulder_${sd}`, 'chest', sh, ua);
  bone(`upper_arm_${sd}`, `shoulder_${sd}`, ua, la);
  bone(`lower_arm_${sd}`, `upper_arm_${sd}`, la, hd);
  bone(`hand_${sd}`, `lower_arm_${sd}`, hd, hd.clone().addScaledVector(a, 0.085));
  ARM[sd] = { s, a, n, sh, ua, la, hd, fingers: {} };
  // 手指：四指 3 节，基部在掌根往前 0.085 左右，略向掌心弯
  const FING = { index: [0.086, 0.023, [0.030, 0.022, 0.018], 0.06], middle: [0.090, 0.008, [0.033, 0.024, 0.019], 0],
    ring: [0.086, -0.007, [0.030, 0.022, 0.018], -0.05], pinky: [0.078, -0.021, [0.024, 0.017, 0.015], -0.12] };
  for (const [f, [k, wo, lens, spread]] of Object.entries(FING)) {
    let p = hd.clone().addScaledVector(a, k).addScaledVector(W_AX, wo);
    const joints = [p.clone()]; let curl = 0.12;
    for (const L of lens) {
      const d = a.clone().multiplyScalar(Math.cos(curl)).addScaledVector(n, Math.sin(curl)).addScaledVector(W_AX, spread).normalize();
      p = p.clone().addScaledVector(d, L); joints.push(p.clone()); curl += 0.2;
    }
    for (let i = 0; i < 3; i++) bone(`${f}_0${i + 1}_${sd}`, i ? `${f}_0${i}_${sd}` : `hand_${sd}`, joints[i], joints[i + 1]);
    ARM[sd].fingers[f] = joints;
  }
  { // 拇指
    let p = hd.clone().addScaledVector(a, 0.022).addScaledVector(W_AX, 0.019).addScaledVector(n, 0.008);
    const joints = [p.clone()];
    const dirs = [V3().copy(a).multiplyScalar(0.55).addScaledVector(W_AX, 0.7).addScaledVector(n, 0.45),
      V3().copy(a).multiplyScalar(0.8).addScaledVector(W_AX, 0.35).addScaledVector(n, 0.45),
      V3().copy(a).multiplyScalar(0.8).addScaledVector(W_AX, 0.15).addScaledVector(n, 0.55)];
    [0.032, 0.026, 0.021].forEach((L, i) => { p = p.clone().addScaledVector(dirs[i].normalize(), L); joints.push(p.clone()); });
    for (let i = 0; i < 3; i++) bone(`thumb_0${i + 1}_${sd}`, i ? `thumb_0${i}_${sd}` : `hand_${sd}`, joints[i], joints[i + 1]);
    ARM[sd].fingers.thumb = joints;
  }
}
for (const [s, sd] of [[1, 'l'], [-1, 'r']]) {
  bone(`thigh_${sd}`, 'hips', V3(s * 0.085, 0.77, 0), V3(s * 0.092, 0.425, 0.008));
  bone(`calf_${sd}`, `thigh_${sd}`, V3(s * 0.092, 0.425, 0.008), V3(s * 0.095, 0.075, -0.005));
  bone(`foot_${sd}`, `calf_${sd}`, V3(s * 0.095, 0.075, -0.005), V3(s * 0.097, 0.025, 0.12));
  bone(`toe_${sd}`, `foot_${sd}`, V3(s * 0.097, 0.025, 0.12), V3(s * 0.097, 0.025, 0.18));
}

// 头部形状（θ：0=+X 左侧，90=+Z 正面；φ：0=头顶）
function headPt(thDeg, phi) {
  const th = thDeg * D2R;
  const dx = Math.sin(phi) * Math.cos(th), dy = Math.cos(phi), dz = Math.sin(phi) * Math.sin(th);
  const low = Math.max(0, -dy);
  let x = dx * HEAD_R.x * (1 - 0.42 * low ** 1.5);                    // 下颌收窄（尖下巴，偏动漫）
  let y = dy * HEAD_R.y;
  let z = dz * HEAD_R.z * (dz > 0 ? 1 - 0.1 * Math.max(0, dz) ** 4 : 1 - 0.28 * low);  // 脸略平；后脑下方收向脖子
  if (dz > 0) {
    z += 0.012 * dz * low;                                                       // 下巴略往前
    z += 0.0105 * Math.exp(-((dx / 0.075) ** 2 + ((dy + 0.4) / 0.11) ** 2));    // 小鼻子
    z += 0.004 * Math.exp(-(((Math.abs(dx) - 0.45) / 0.18) ** 2) - ((dy + 0.32) / 0.15) ** 2); // 脸颊
    z -= 0.0035 * Math.exp(-(((Math.abs(dx) - 0.4) / 0.14) ** 2) - ((dy + 0.03) / 0.1) ** 2);  // 眼窝
  }
  if (dy > 0.2 && dz < 0.3) { x *= 1.02; z *= 1.03; }                            // 后脑勺饱满一点
  return V3(HEAD_C.x + x, HEAD_C.y + y, HEAD_C.z + z);
}
const capPt = (th, phi, off) => { const p = headPt(th, phi); return p.addScaledVector(p.clone().sub(HEAD_C).normalize(), off); };
const TIE = capPt(270, 2.0, 0.022);       // 低马尾扎发点（后颈上方）

bone('hair_bangs', 'head', V3(0, 1.45, 0.075), V3(0, 1.385, 0.1));
for (const [s, sd] of [[1, 'l'], [-1, 'r']]) {
  bone(`hair_side_${sd}_01`, 'head', V3(s * 0.074, 1.37, 0.03), V3(s * 0.082, 1.31, 0.035));
  bone(`hair_side_${sd}_02`, `hair_side_${sd}_01`, V3(s * 0.082, 1.31, 0.035), V3(s * 0.088, 1.245, 0.03));
}
const PT = [TIE, TIE.clone().add(V3(0, -0.04, -0.025)), TIE.clone().add(V3(0, -0.085, -0.03)), TIE.clone().add(V3(0, -0.13, -0.02))];
for (let i = 0; i < 3; i++) bone(`hair_ponytail_0${i + 1}`, i ? `hair_ponytail_0${i}` : 'head', PT[i], PT[i + 1]);

// ---------- 雨衣主体形状（t：0 领口 → 1 下摆）----------
//            t,    y,     rx,    rz,    前襟开口半角°, 超椭圆指数
const COAT = [[0.00, 1.262, 0.070, 0.064, 34, 2.0], [0.06, 1.240, 0.132, 0.088, 30, 2.3], [0.12, 1.200, 0.192, 0.110, 26, 2.8],
  [0.20, 1.130, 0.194, 0.122, 21, 2.7], [0.32, 1.040, 0.182, 0.126, 18, 2.5], [0.45, 0.940, 0.178, 0.124, 16, 2.4],
  [0.60, 0.830, 0.188, 0.131, 15, 2.3], [0.78, 0.700, 0.204, 0.141, 15, 2.2], [1.00, 0.548, 0.222, 0.154, 16, 2.2]];
function keyInterp(keys, t) { // 分段三次 Hermite（Catmull-Rom 切线），每列独立
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = clamp01((t - k1[0]) / (k2[0] - k1[0])), h = k2[0] - k1[0];
  const out = [];
  for (let c = 1; c < k1.length; c++) {
    const m1 = (k2[c] - k0[c]) / (k2[0] - k0[0] || 1) * h, m2 = (k3[c] - k1[c]) / (k3[0] - k1[0] || 1) * h;
    const u2 = u * u, u3 = u2 * u;
    out.push((2 * u3 - 3 * u2 + 1) * k1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[c] + (u3 - u2) * m2);
  }
  return out;
}
const sp = (c, p) => Math.sign(c) * Math.abs(c) ** (2 / p);
function coatPt(u, t, inset = 0) {
  const [y0, rx, rz, gap, p] = keyInterp(COAT, t);
  const thDeg = 90 + gap + u * (360 - 2 * gap), th = thDeg * D2R;
  const A = 0.012 + 0.036 * smooth(0.3, 1, t);
  const fold = A * (0.55 * Math.sin(7 * th + 1.3) + 0.3 * Math.sin(12 * th + 0.4) + 0.15 * Math.sin(19 * th + 2.0)) + 0.012 * (1 - t) * Math.sin(5 * th + 0.5) * smooth(0.1, 0.3, t);
  const k = 1 + fold;
  const y = y0 + 0.004 * smooth(0.93, 1, t) * (Math.sin(17 * th + 0.7) * 0.5 + Math.sin(7 * th + 2.1) * 0.3 + Math.sin(41 * th) * 0.2);
  return { p: V3(sp(Math.cos(th), p) * (rx * k - inset), y, -0.01 + sp(Math.sin(th), p) * (rz * k - inset)), texU: (((thDeg - 90) % 360) + 360) % 360 / 360 };
}
function coatAtY(y) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (keyInterp(COAT, m)[0] > y) lo = m; else hi = m; } return (lo + hi) / 2; }

bone('hood_01', 'chest', V3(0, 1.24, -0.10), V3(0, 1.14, -0.15));
bone('hood_02', 'hood_01', V3(0, 1.14, -0.15), V3(0, 1.03, -0.165));
for (const [nm, th] of [['front_l', 58], ['side_l', 5], ['back', 270], ['side_r', 175], ['front_r', 122]]) {
  const at = (t) => { const [y, rx, rz, , p] = keyInterp(COAT, t); return V3(sp(Math.cos(th * D2R), p) * rx, y, -0.01 + sp(Math.sin(th * D2R), p) * rz); };
  const t1 = coatAtY(0.80), t2 = coatAtY(0.67);
  bone(`coat_${nm}_01`, 'hips', at(t1), at(t2));
  bone(`coat_${nm}_02`, `coat_${nm}_01`, at(t2), at(1));
}

// hand_r_socket：风灯原点（提环抓握点）。在掌心一侧、四指弯过来握住的位置
const SOCKET = (() => {
  const { a, n, hd } = ARM.r;
  const pos = hd.clone().addScaledVector(a, 0.072).addScaledVector(n, 0.024);
  const X = W_AX.clone(), Y = a.clone().negate(), Z = X.clone().cross(Y);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  return { t: pos.sub(hd).toArray(), r: q.toArray() };
})();

// =====================================================================================
// 几何
// =====================================================================================
const segSel = (p, a, b) => { const ab = b.clone().sub(a), t = clamp01(p.clone().sub(a).dot(ab) / ab.lengthSq()); return p.distanceTo(a.clone().addScaledVector(ab, t)); };

class Part {
  constructor(mat, region, bones) { Object.assign(this, { mat, region, bones, pos: [], uv: [], idx: [] }); }
}
// 参数曲面：fn(u,v) → {p, uv?}；nu×nv 段；closedU 时 u 方向首尾在同一位置（UV 接缝复制顶点）
function surf(part, nu, nv, fn) {
  const base = part.pos.length;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const r = fn(i / nu, j / nv);
    part.pos.push(r.p); part.uv.push(r.uv ?? [i / nu, j / nv]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    part.idx.push(a, c, b, b, c, d);
  }
  return part;
}
// 沿中心线的管（截面椭圆）。samples: [{c, ra, rb}]；ref：截面 A 轴参考方向（向量或函数）；可封端
function tube(part, samples, nr, ref, { capStart = false, capEnd = false, uv = null, phase = 0 } = {}) {
  let S = samples.map((s) => ({ ...s }));
  const T = (i) => { const a = S[Math.max(0, i - 1)].c, b = S[Math.min(S.length - 1, i + 1)].c; return b.clone().sub(a).normalize(); };
  const capR = (s, t, sign) => [0.55, 0.85, 1].map((f, k) => ({ c: s.c.clone().addScaledVector(t, sign * Math.max(s.ra, s.rb) * f * 0.8), ra: s.ra * [0.83, 0.5, 0.02][k], rb: s.rb * [0.83, 0.5, 0.02][k], cap: true }));
  if (capStart) S = [...capR(S[0], T(0), -1).reverse(), ...S];
  if (capEnd) { const n = S.length - 1; S = [...S, ...capR(S[n], T(n), 1)]; }
  let L = 0; const acc = S.map((s, i) => (L += i ? s.c.distanceTo(S[i - 1].c) : 0));
  surf(part, nr, S.length - 1, (u, v) => {
    const i = Math.round(v * (S.length - 1)), s = S[i], t = T(i);
    const r = typeof ref === 'function' ? ref(s.c, i) : ref.clone();
    const A = r.sub(t.clone().multiplyScalar(r.dot(t))).normalize(), B = t.clone().cross(A);
    const ang = u * Math.PI * 2 + phase, w = s.wob ? s.wob(ang) : 1;
    const p = s.c.clone().addScaledVector(A, Math.cos(ang) * s.ra * w).addScaledVector(B, Math.sin(ang) * s.rb * w);
    return { p, uv: uv ? uv(u, acc[i] / L, p) : [u, acc[i] / L] };
  });
  return part;
}
const sampleCurve = (pts, n, radius) => {
  const cv = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return cv.getSpacedPoints(n).map((c, i) => { const t = i / n; const [ra, rb] = radius(t, c); return { c, ra, rb, t }; });
};

function buildCharacter(k) {
  const N = (n, min = 3) => Math.max(min, Math.round(n * k));
  const parts = [];
  const P = (mat, region, bones) => { const p = new Part(mat, region, bones); parts.push(p); return p; };
  const ALL_TORSO = ['hips', 'spine_01', 'spine_02', 'chest', 'shoulder_l', 'shoulder_r'];
  const COAT_B = [...ALL_TORSO, ...['front_l', 'side_l', 'back', 'side_r', 'front_r'].flatMap((n) => [`coat_${n}_01`, `coat_${n}_02`])];

  // ---- 头、耳、脖子（脸材质：正面平面投影 UV）----
  const faceUV = (p) => [0.5 + p.x / 0.18, (1.50 - p.y) / 0.26];
  surf(P(MAT_FACE, null, { head: 1 }), N(72, 12), N(56, 10), (u, v) => { const p = headPt(u * 360 + 90, v * Math.PI); return { p, uv: faceUV(p) }; });
  for (const s of [1, -1]) {
    const c = V3(s * 0.073, 1.352, -0.012);
    surf(P(MAT_FACE, null, { head: 1 }), N(14, 6), N(10, 4), (u, v) => {
      const th = u * Math.PI * 2, ph = v * Math.PI;
      const p = c.clone().add(V3(s * Math.abs(Math.sin(ph) * Math.cos(th)) * 0.009, Math.cos(ph) * 0.021, Math.sin(ph) * Math.sin(th) * 0.013));
      return { p, uv: faceUV(p) };
    });
  }
  tube(P(MAT_BODY, 'skin', ['chest', 'neck', 'head']), sampleCurve([V3(0, 1.20, -0.02), V3(0, 1.27, -0.015), V3(0, 1.33, -0.01)], N(8, 3), () => [0.036, 0.039]), N(24, 8), V3(1, 0, 0));

  // ---- 毛衣（藏青粗针织）：躯干 + 罗纹领 + 下摆罗纹 ----
  const SW = [[0, 1.262, 0.050, 0.046], [0.05, 1.24, 0.095, 0.07], [0.12, 1.19, 0.152, 0.088], [0.25, 1.10, 0.150, 0.100],
    [0.45, 0.98, 0.134, 0.093], [0.65, 0.87, 0.140, 0.096], [1, 0.72, 0.150, 0.102]];
  surf(P(MAT_BODY, 'sweater', [...ALL_TORSO, 'neck']), N(64, 12), N(48, 8), (u, v) => {
    const [y, rx, rz] = keyInterp(SW, v), th = u * Math.PI * 2;
    const bust = 0.012 * Math.exp(-(((y - 1.06) / 0.045) ** 2)) * Math.max(0, Math.sin(th)) ** 3;
    return { p: V3(sp(Math.cos(th), 2.3) * rx, y, -0.012 + sp(Math.sin(th), 2.3) * (rz + bust)) };
  });
  const ring = (part, cy, rx, rz, zc, r, nu, nv, ribs) => surf(part, nu, nv, (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI * 2, rr = r * (1 + 0.12 * Math.cos(th * ribs));
    return { p: V3(Math.cos(th) * (rx + Math.cos(ph) * rr), cy + Math.sin(ph) * rr * 1.6, zc + Math.sin(th) * (rz + Math.cos(ph) * rr)) };
  });
  ring(P(MAT_BODY, 'sweater', ['chest', 'neck']), 1.255, 0.054, 0.05, -0.014, 0.0095, N(48, 10), N(8, 4), 40);
  ring(P(MAT_BODY, 'sweater', ['hips', 'spine_01']), 0.775, 0.146, 0.101, -0.012, 0.009, N(48, 10), N(6, 4), 60);

  // ---- 裤子 + 雨靴 ----
  for (const [s, sd] of [[1, 'l'], [-1, 'r']]) {
    tube(P(MAT_BODY, 'pants', ['hips', `thigh_${sd}`, `calf_${sd}`]),
      sampleCurve([V3(s * 0.072, 0.86, -0.005), V3(s * 0.085, 0.77, 0), V3(s * 0.09, 0.6, 0.006), V3(s * 0.092, 0.425, 0.01), V3(s * 0.095, 0.30, 0.004)], N(36, 8),
        (t, c) => { const y = c.y; return [lerp(0.056, 0.084, smooth(0.42, 0.84, y)), lerp(0.054, 0.08, smooth(0.42, 0.84, y))]; }), N(28, 8), V3(1, 0, 0));
    const shaft = sampleCurve([V3(s * 0.095, 0.372, 0.008), V3(s * 0.095, 0.25, 0.006), V3(s * 0.096, 0.12, 0.0), V3(s * 0.096, 0.06, 0.0)], N(18, 5),
      (t, c) => [lerp(0.06, 0.05, smooth(0.36, 0.12, c.y)) + 0.004 * smooth(0.355, 0.372, c.y), lerp(0.066, 0.058, smooth(0.36, 0.12, c.y)) + 0.004 * smooth(0.355, 0.372, c.y)]);
    // 靴口：往里卷一圈，让开口有厚度
    shaft.unshift({ c: shaft[0].c.clone().add(V3(0, -0.012, 0)), ra: 0.054, rb: 0.06 });
    tube(P(MAT_BODY, 'boots', [`calf_${sd}`, `foot_${sd}`]), shaft, N(28, 8), V3(1, 0, 0));
    // 鞋头：沿 +Z 的管，底部压平到 y=0
    const foot = sampleCurve([V3(s * 0.096, 0.055, -0.058), V3(s * 0.096, 0.055, -0.01), V3(s * 0.097, 0.05, 0.06), V3(s * 0.097, 0.036, 0.142)], N(20, 6),
      (t) => [lerp(0.044, 0.05, smooth(0, 0.6, t)) * (1 - 0.25 * smooth(0.75, 1, t)), lerp(0.055, 0.056, t) * (1 - 0.4 * smooth(0.5, 1, t))]);
    const fp = P(MAT_BODY, 'boots', [`calf_${sd}`, `foot_${sd}`, `toe_${sd}`]);
    tube(fp, foot, N(28, 8), V3(1, 0, 0), { capStart: true, capEnd: true });
    for (const p of fp.pos) p.y = Math.max(p.y, 0);
  }

  // ---- 手臂：雨衣袖（宽大）+ 卷边袖口 + 毛衣袖口 + 手 ----
  for (const sd of ['l', 'r']) {
    const { s, a, n, ua, la, hd, fingers } = ARM[sd];
    const along = (L) => (L <= 0.25 ? ua.clone().addScaledVector(a, L) : la.clone().addScaledVector(a, L - 0.25));
    const sl = []; const NS = N(40, 8);
    for (let i = 0; i <= NS; i++) {
      const L = lerp(-0.045, 0.25 + 0.22 * 0.78, i / NS);
      const r = L < 0.02 ? lerp(0.066, 0.063, smooth(-0.045, 0.02, L)) : L < 0.25 ? lerp(0.063, 0.056, smooth(0.02, 0.25, L)) : lerp(0.056, 0.062, smooth(0.25, 0.42, L));
      const elbow = Math.exp(-(((L - 0.25) / 0.05) ** 2));
      sl.push({ c: along(L).addScaledVector(V3(0, 1, 0), L < 0 ? -L * 0.25 : 0), ra: r, rb: r * 0.95, wob: (ang) => 1 + 0.05 * elbow * Math.sin(ang * 3 + 1) + 0.025 * Math.sin(ang * 5 + L * 40) });
    }
    tube(P(MAT_BODY, `sleeve_${sd}`, [`shoulder_${sd}`, `upper_arm_${sd}`, `lower_arm_${sd}`]), sl, N(36, 8), W_AX);
    const c0 = 0.25 + 0.22 * 0.70, c1 = 0.25 + 0.22 * 0.80;
    tube(P(MAT_BODY, 'lining', [`lower_arm_${sd}`]), [
      { c: along(c0), ra: 0.064, rb: 0.061 }, { c: along((c0 + c1) / 2), ra: 0.069, rb: 0.066 }, { c: along(c1), ra: 0.066, rb: 0.063 },
      { c: along(c1 + 0.004), ra: 0.052, rb: 0.05 }, { c: along(c1 + 0.003), ra: 0.036, rb: 0.035 }], N(36, 8), W_AX);
    tube(P(MAT_BODY, 'sweater', [`lower_arm_${sd}`, `hand_${sd}`]), [
      { c: along(c0), ra: 0.037, rb: 0.035 }, { c: along(0.47 - 0.012), ra: 0.034, rb: 0.031 }, { c: along(0.47 - 0.004), ra: 0.028, rb: 0.024 }], N(24, 6), W_AX);
    const HB = [`lower_arm_${sd}`, `hand_${sd}`, ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}_${sd}`))];
    // 手掌（扁）
    tube(P(MAT_BODY, 'skin', HB), [0, 0.03, 0.06, 0.088].map((L, i) => ({ c: hd.clone().addScaledVector(a, L - 0.02), ra: [0.024, 0.032, 0.036, 0.035][i], rb: [0.017, 0.014, 0.012, 0.011][i] })),
      N(20, 6), W_AX, { capStart: true, capEnd: true });
    for (const [f, J] of Object.entries(fingers)) {
      const r0 = f === 'thumb' ? 0.0105 : f === 'pinky' ? 0.0072 : 0.0085;
      const start = f === 'thumb' ? J[0].clone().addScaledVector(a, -0.01) : J[0].clone().addScaledVector(J[1].clone().sub(J[0]).normalize(), -0.014);
      const pts = sampleCurve([start, ...J], N(10, 4), (t) => [r0 * (1 - 0.3 * t), r0 * 0.9 * (1 - 0.3 * t)]);
      tube(P(MAT_BODY, 'skin', HB), pts, N(10, 5), n.clone(), { capEnd: true });
    }
  }

  // ---- 雨衣主体：外层 + 里层 + 前襟/下摆包边 ----
  const NU = N(140, 20), NV = N(100, 14);
  surf(P(MAT_BODY, 'coat', COAT_B), NU, NV, (u, v) => { const r = coatPt(u, v); return { p: r.p, uv: [r.texU, v] }; });
  const inner = P(MAT_BODY, 'lining', COAT_B); inner.flip = true;
  surf(inner, N(70, 12), N(50, 8), (u, v) => ({ p: coatPt(u, v, 0.007).p }));
  const edge = [];
  const EN = N(60, 10);
  for (let i = 0; i <= EN; i++) edge.push(coatPt(0, i / EN, 0.0035).p);
  for (let i = 1; i <= N(140, 20); i++) edge.push(coatPt(i / N(140, 20), 1, 0.0035).p);
  for (let i = EN - 1; i >= 0; i--) edge.push(coatPt(1, i / EN, 0.0035).p);
  tube(P(MAT_BODY, 'hood', COAT_B), edge.map((c) => ({ c, ra: 0.0055, rb: 0.0055 })), N(8, 4), (c) => c.clone().setY(0).normalize());
  // 纽扣（右前襟 3 颗）
  for (const y of [1.06, 0.95, 0.84]) {
    const t = coatAtY(y), r = coatPt(0.985, t, -0.002).p, c = r.clone(), nrm = c.clone().setY(0).sub(V3(0, 0, -0.01)).normalize();
    tube(P(MAT_BODY, 'trim', ['spine_01', 'spine_02', 'chest']), [{ c: c.clone().addScaledVector(nrm, -0.002), ra: 0.009, rb: 0.009 }, { c: c.clone().addScaledVector(nrm, 0.004), ra: 0.009, rb: 0.009 }], N(12, 6), V3(0, 1, 0), { capEnd: true });
  }
  // 兜帽领边（兜帽口）：沿前襟上段 → 绕过后颈 → 另一侧前襟，贴着雨衣表面外侧
  const collarPts = [];
  const CT = 0.26, CN = N(16, 5), CR = N(30, 8);
  for (let i = CN; i >= 1; i--) collarPts.push(coatPt(0.004, (i / CN) * CT, -0.009).p);
  for (let i = 0; i <= CR; i++) collarPts.push(coatPt(i / CR, 0, -0.008).p.add(V3(0, 0.006, 0)));
  for (let i = 1; i <= CN; i++) collarPts.push(coatPt(0.996, (i / CN) * CT, -0.009).p);
  const nC = collarPts.length - 1;
  tube(P(MAT_BODY, 'hood', ['spine_02', 'chest', 'neck', 'hood_01']), collarPts.map((c, i) => {
    const e = smooth(0, 0.18, Math.min(i, nC - i) / nC); return { c, ra: 0.006 + 0.014 * e, rb: 0.005 + 0.009 * e };
  }), N(14, 6), (c) => V3(c.x, 0, c.z + 0.01).normalize(), { capStart: true, capEnd: true });
  // 放下的兜帽：贴在后背的扁"枕头"
  const hood = [];
  const HN = N(24, 6);
  for (let i = 0; i <= HN; i++) {
    const t = i / HN, y = lerp(1.268, 1.02, t), ct = coatAtY(y), [, , rz] = keyInterp(COAT, ct);
    const a = [0.075, 0.108, 0.105, 0.08, 0.045], b = [0.02, 0.034, 0.034, 0.026, 0.016];
    const f = t * 4, i0 = Math.min(3, Math.floor(f)), w = f - i0;
    const ra = lerp(a[i0], a[i0 + 1], w), rb = lerp(b[i0], b[i0 + 1], w);
    hood.push({ c: V3(0, y, -0.01 - rz - rb * 0.55 - (t < 0.15 ? 0.02 * (0.15 - t) / 0.15 : 0)), ra, rb, wob: (ang) => 1 + 0.06 * Math.sin(ang * 4 + t * 6) });
  }
  tube(P(MAT_BODY, 'hood', ['chest', 'hood_01', 'hood_02']), hood, N(28, 8), V3(1, 0, 0), { capEnd: true });

  // ---- 头发：头皮发壳 + 19 簇（刘海 5、脸侧 4、耳后 2、头顶→马尾 5、马尾 3）+ 发圈 ----
  const phiMax = (th) => { const f = Math.sin(th * D2R); return f > 0 ? lerp(1.95, 0.98, f ** 0.6) : lerp(1.95, 2.2, -f); };
  surf(P(MAT_HAIR, 'hair', { head: 1 }), N(64, 12), N(30, 6), (u, v) => {
    const th = u * 360 + 90, pm = phiMax(th), ph = v * pm;
    const back = Math.max(0, -Math.sin(th * D2R));
    return { p: capPt(th, ph, 0.011 + 0.007 * back * v), uv: [(u * 3) % 1.0001, v * 0.8] };
  });
  const HAIR_SEG = N(26, 6), HAIR_RAD = N(8, 4);
  const clump = (pts, W, Th, bones, { rootTaper = 0.7 } = {}) => {
    const S = sampleCurve(pts, HAIR_SEG, (t) => {
      const tip = t < 0.7 ? 1 : ((1 - t) / 0.3) ** 0.85;
      const root = rootTaper + (1 - rootTaper) * smooth(0, 0.15, t);
      return [Math.max(0.0008, W * 0.5 * tip * root * (1 - 0.15 * t)), Math.max(0.0006, Th * 0.5 * (0.35 + 0.65 * tip) * root)];
    });
    tube(P(MAT_HAIR, 'hair', bones), S, HAIR_RAD, (c, i) => {
      const t = S[Math.min(S.length - 1, i + 1)].c.clone().sub(S[Math.max(0, i - 1)].c).normalize();
      return t.clone().cross(c.clone().sub(HEAD_C).normalize());
    }, { uv: (u, v) => [u, v] });
  };
  const HB = ['head', 'hair_bangs'];
  const BANGS = [[-36, -6, 1.6, 0.03], [-19, -9, 1.5, 0.028], [-3, -11, 1.56, 0.024], [13, -10, 1.47, 0.03], [30, -6, 1.62, 0.032]];
  for (const [d, drift, tipPhi, w] of BANGS) {
    const th = 90 + d;
    clump([capPt(th, 0.22, 0.008), capPt(th, 0.7, 0.019), capPt(th + drift * 0.3, 1.05, 0.024), capPt(th + drift * 0.7, 1.32, 0.021), capPt(th + drift, tipPhi, 0.016)], w, 0.008, HB);
  }
  for (const [s, sd] of [[1, 'l'], [-1, 'r']]) {
    const SB = ['head', `hair_side_${sd}_01`, `hair_side_${sd}_02`];
    for (const [d, len, w] of [[50, 0.07, 0.03], [64, 0.1, 0.028]]) {
      const th = 90 - s * d;
      const p3 = capPt(th - s * 6, 1.62, 0.028);
      const out = V3(s, 0, 0.2).normalize();
      clump([capPt(th, 0.4, 0.012), capPt(th, 1.05, 0.024), p3, p3.clone().addScaledVector(out, 0.012).add(V3(0, -len * 0.5, 0.004)), p3.clone().addScaledVector(out, 0.016).add(V3(0, -len, -0.002))], w, 0.009, SB);
    }
    { // 耳后：齐肩的散发
      const th = s > 0 ? -8 : 188;
      const p3 = capPt(th, 1.75, 0.03);
      clump([capPt(th, 0.35, 0.012), capPt(th, 1.1, 0.026), p3, p3.clone().add(V3(s * 0.012, -0.06, -0.006)), p3.clone().add(V3(s * 0.016, -0.115, -0.004))], 0.036, 0.011, SB);
    }
  }
  for (const th of [20, 160, -25, 205, 270]) {
    const back = th < 90 && th > -90 ? -90 : 270, mid = lerp(th, back, 0.35);   // 往后脑中线（-90 ≡ 270）收拢，不能跨过脸
    clump([capPt(th, 0.12, 0.012), capPt(th, 0.85, 0.022), capPt(mid, 1.55, 0.024), capPt(lerp(mid, back, 0.6), 1.9, 0.023), TIE.clone().add(V3(Math.cos(th * D2R) * 0.006, 0.004, 0))],
      0.05, 0.012, ['head'], { rootTaper: 0.85 });
  }
  const PTB = ['head', 'hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03'];
  for (const dx of [-0.011, 0, 0.012]) {
    clump([TIE.clone().add(V3(dx * 0.3, 0.006, 0.01)), TIE.clone().add(V3(dx * 0.6, -0.03, -0.024)), TIE.clone().add(V3(dx * 1.2, -0.075, -0.034)), TIE.clone().add(V3(dx * 1.8, -0.125, -0.022 + Math.abs(dx)))],
      dx === 0 ? 0.034 : 0.026, 0.016, PTB, { rootTaper: 0.55 });
  }
  { // 发圈
    const ax = V3(0, -0.6, -0.8).normalize(), e1 = V3(1, 0, 0), e2 = ax.clone().cross(e1);
    surf(P(MAT_HAIR, 'hair', { hair_ponytail_01: 1 }), N(16, 6), N(6, 4), (u, v) => {
      const th = u * Math.PI * 2, ph = v * Math.PI * 2, R = 0.011, r = 0.0035;
      const radial = e1.clone().multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
      return { p: TIE.clone().addScaledVector(ax, -0.004 + Math.sin(ph) * r).addScaledVector(radial, R + Math.cos(ph) * r), uv: [u, 0.01] };
    });
  }
  return parts;
}

// =====================================================================================
// 法线、朝向、蒙皮、合并
// =====================================================================================
const keyOf = (p) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
const SEG = BONES.map((b) => [b.pos, b.tail]);
function finalize(part) {
  const n = part.pos.length;
  // 朝向：大多数三角形应背离本部件中心（里层反过来）
  const ctr = part.pos.reduce((s, p) => s.add(p), V3(0, 0, 0)).multiplyScalar(1 / n);
  let score = 0; const e1 = V3(), e2 = V3(), fn = V3();
  for (let t = 0; t < part.idx.length; t += 3) {
    const [a, b, c] = [part.pos[part.idx[t]], part.pos[part.idx[t + 1]], part.pos[part.idx[t + 2]]];
    fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    score += fn.dot(a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(ctr));
  }
  if ((score < 0) !== !!part.flip) for (let t = 0; t < part.idx.length; t += 3) [part.idx[t + 1], part.idx[t + 2]] = [part.idx[t + 2], part.idx[t + 1]];
  // 面积加权法线 + 同位置焊接（UV 接缝、极点处不出现硬边）
  const acc = new Map();
  for (let t = 0; t < part.idx.length; t += 3) {
    const [a, b, c] = [part.pos[part.idx[t]], part.pos[part.idx[t + 1]], part.pos[part.idx[t + 2]]];
    fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    for (let k = 0; k < 3; k++) { const kk = keyOf(part.pos[part.idx[t + k]]); (acc.get(kk) ?? acc.set(kk, V3()).get(kk)).add(fn); }
  }
  part.nrm = part.pos.map((p) => { const v = (acc.get(keyOf(p)) ?? V3(0, 1, 0)).clone(); return v.lengthSq() > 1e-24 ? v.normalize() : V3(0, 1, 0); });
  // 去掉零面积三角形（封端、极点处）
  const keep = [];
  for (let t = 0; t < part.idx.length; t += 3) {
    const [a, b, c] = [part.pos[part.idx[t]], part.pos[part.idx[t + 1]], part.pos[part.idx[t + 2]]];
    if (fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).lengthSq() > 1e-16) keep.push(part.idx[t], part.idx[t + 1], part.idx[t + 2]);
  }
  part.idx = keep;
  // UV → 图集
  if (part.region) {
    const [u0, v0, w, h] = REGION[part.region];
    part.uv = part.uv.map(([u, v]) => [u0 + PAD + clamp01(u) * (w - 2 * PAD), v0 + PAD + clamp01(v) * (h - 2 * PAD)]);
  }
  // 蒙皮：固定权重（对象）或按到骨段距离的反四次方（取前 4）
  part.skin = part.pos.map((p) => {
    let ws;
    if (!Array.isArray(part.bones)) ws = Object.entries(part.bones).map(([nm, w]) => [BI[nm], w]);
    else {
      ws = part.bones.map((nm) => { const i = BI[nm]; if (i === undefined) throw new Error('no bone ' + nm); return [i, 1 / (segSel(p, ...SEG[i]) + 0.004) ** 4]; });
      ws.sort((x, y) => y[1] - x[1]); ws = ws.slice(0, 4);
      const tot = ws.reduce((s, x) => s + x[1], 0); ws = ws.map(([i, w]) => [i, w / tot]).filter(([, w]) => w > 0.02);
    }
    const tot = ws.reduce((s, x) => s + x[1], 0); ws = ws.map(([i, w]) => [i, w / tot]);
    while (ws.length < 4) ws.push([0, 0]);
    return ws;
  });
}
function merge(parts) {
  return [MAT_BODY, MAT_HAIR, MAT_FACE].map((mat) => {
    const ps = parts.filter((p) => p.mat === mat);
    const nv = ps.reduce((s, p) => s + p.pos.length, 0), ni = ps.reduce((s, p) => s + p.idx.length, 0);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), jn = new Uint8Array(nv * 4), wt = new Float32Array(nv * 4), idx = new Uint32Array(ni);
    let v = 0, ii = 0;
    for (const p of ps) {
      for (const i of p.idx) idx[ii++] = i + v;
      p.pos.forEach((q, k) => {
        pos.set([q.x, q.y, q.z], (v + k) * 3); nrm.set([p.nrm[k].x, p.nrm[k].y, p.nrm[k].z], (v + k) * 3); uv.set(p.uv[k], (v + k) * 2);
        p.skin[k].forEach(([j, w], c) => { jn[(v + k) * 4 + c] = j; wt[(v + k) * 4 + c] = w; });
      });
      v += p.pos.length;
    }
    return { mat, pos, nrm, uv, jn, wt, idx };
  });
}
function outlineColors(prims) {
  const key = (p, i) => `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`;
  const acc = new Map(); const a = V3(), b = V3(), c = V3(), ab = V3(), ac = V3();
  for (const { pos, idx } of prims) for (let t = 0; t < idx.length; t += 3) {
    a.fromArray(pos, idx[t] * 3); b.fromArray(pos, idx[t + 1] * 3); c.fromArray(pos, idx[t + 2] * 3);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    for (let k = 0; k < 3; k++) { const kk = key(pos, idx[t + k]); (acc.get(kk) ?? acc.set(kk, V3()).get(kk)).add(n); }
  }
  for (const p of prims) {
    const n = p.pos.length / 3; p.col = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = (acc.get(key(p.pos, i)) ?? V3(0, 1, 0)).clone();
      if (v.lengthSq() < 1e-20) v.set(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]);
      v.normalize();
      p.col.set([Math.round((v.x * 0.5 + 0.5) * 255), Math.round((v.y * 0.5 + 0.5) * 255), Math.round((v.z * 0.5 + 0.5) * 255), 255], i * 4);
    }
  }
}
function reorder(p) {
  const [remap, unique] = MeshoptEncoder.reorderMesh(p.idx, true, true);
  const out = (src, k, T) => { const d = new T(unique * k); for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) for (let j = 0; j < k; j++) d[remap[i] * k + j] = src[i * k + j]; return d; };
  p.pos = out(p.pos, 3, Float32Array); p.nrm = out(p.nrm, 3, Float32Array); p.uv = out(p.uv, 2, Float32Array); p.col = out(p.col, 4, Uint8Array);
  p.jn = out(p.jn, 4, Uint8Array); p.wt = out(p.wt, 4, Float32Array);
}

// =====================================================================================
// GLB 写出（手写 JSON：skin + EXT_meshopt_compression + EXT_texture_webp）
// =====================================================================================
function writeGlb(lods, images, path) {
  const json = {
    asset: { version: '2.0', generator: 'game-studio art/tools/build-char-xi.mjs' },
    scene: 0, scenes: [{ name: 'char-xi', nodes: [0] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
    buffers: [], textures: [], images: [], skins: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    extensionsUsed: [], extensionsRequired: [],
  };
  const chunks = []; let off = 0;
  const pushBin = (u8) => { const o = off; chunks.push(u8); off += u8.byteLength; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } return o; };
  const fallback = { n: 0 };
  const view = (u8, stride, count, mode, target) => {
    const bv = { buffer: 0, byteOffset: 0, byteLength: u8.byteLength };
    if (stride && mode === 'ATTRIBUTES') bv.byteStride = stride;
    if (target) bv.target = target;
    if (USE_MESHOPT && mode) {
      const enc = MeshoptEncoder.encodeGltfBuffer(u8, count, stride, mode, 0);
      const fo = fallback.n; fallback.n += Math.ceil(u8.byteLength / 4) * 4;
      bv.buffer = 1; bv.byteOffset = fo;
      bv.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: pushBin(enc), byteLength: enc.byteLength, byteStride: stride, count, mode } };
    } else bv.byteOffset = pushBin(u8);
    json.bufferViews.push(bv); return json.bufferViews.length - 1;
  };
  const acc = (o) => json.accessors.push(o) - 1;
  const u8 = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);

  const ext = USE_PNG ? null : 'EXT_texture_webp';
  const texIdx = {};
  for (const [k, file] of Object.entries(images)) {
    const data = readFileSync(file);
    const bv = json.bufferViews.push({ buffer: 0, byteOffset: pushBin(data), byteLength: data.byteLength }) - 1;
    const img = json.images.push({ name: k, bufferView: bv, mimeType: USE_PNG ? 'image/png' : 'image/webp' }) - 1;
    texIdx[k] = json.textures.push(ext ? { sampler: 0, extensions: { [ext]: { source: img } } } : { sampler: 0, source: img }) - 1;
  }
  if (ext) { json.extensionsUsed.push(ext); json.extensionsRequired.push(ext); }
  json.materials.push(
    { name: MAT_NAMES[0], pbrMetallicRoughness: { baseColorTexture: { index: texIdx['tex-xi-albedo'] }, metallicFactor: 0, roughnessFactor: 0.85 }, extras: { toonRamp: 'tex-xi-ramp', wetMask: 'todo' } },
    { name: MAT_NAMES[1], pbrMetallicRoughness: { baseColorTexture: { index: texIdx['tex-xi-hair-albedo'] }, metallicFactor: 0, roughnessFactor: 0.6 } },
    { name: MAT_NAMES[2], pbrMetallicRoughness: { baseColorTexture: { index: texIdx['tex-xi-face-albedo'] }, metallicFactor: 0, roughnessFactor: 0.7 }, extras: { sdfFace: 'todo' } });

  // 骨骼节点
  json.nodes.push({ name: 'char-xi', children: [], extras: { heightM: 1.5, forward: '+Z', skeleton: 'char-xi' } });
  const boneNode = BONES.map((b) => {
    const par = b.parent ? BONES[BI[b.parent]].pos : V3(0, 0, 0);
    return json.nodes.push({ name: b.name, translation: b.pos.clone().sub(par).toArray().map((v) => +v.toFixed(6)) }) - 1;
  });
  BONES.forEach((b, i) => { if (b.parent) (json.nodes[boneNode[BI[b.parent]]].children ??= []).push(boneNode[i]); });
  json.nodes[0].children.push(boneNode[0]);
  const sock = json.nodes.push({ name: 'hand_r_socket', translation: SOCKET.t.map((v) => +v.toFixed(6)), rotation: SOCKET.r.map((v) => +v.toFixed(6)) }) - 1;
  (json.nodes[boneNode[BI.hand_r]].children ??= []).push(sock);
  const ibm = new Float32Array(BONES.length * 16);
  BONES.forEach((b, i) => ibm.set(new THREE.Matrix4().makeTranslation(-b.pos.x, -b.pos.y, -b.pos.z).elements, i * 16));
  const ibmAcc = acc({ bufferView: json.bufferViews.push({ buffer: 0, byteOffset: pushBin(u8(ibm)), byteLength: ibm.byteLength }) - 1, componentType: 5126, count: BONES.length, type: 'MAT4' });
  json.skins.push({ name: 'char-xi-skeleton', joints: boneNode, inverseBindMatrices: ibmAcc, skeleton: boneNode[0] });

  lods.forEach((prims, li) => {
    const primitives = prims.map((p) => {
      const n = p.pos.length / 3;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.pos[i * 3 + k]); max[k] = Math.max(max[k], p.pos[i * 3 + k]); }
      const idx = n < 65536 ? new Uint16Array(p.idx) : p.idx;
      return {
        attributes: {
          POSITION: acc({ bufferView: view(u8(p.pos), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3', min, max }),
          NORMAL: acc({ bufferView: view(u8(p.nrm), 12, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC3' }),
          TEXCOORD_0: acc({ bufferView: view(u8(p.uv), 8, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC2' }),
          COLOR_0: acc({ bufferView: view(u8(p.col), 4, n, 'ATTRIBUTES', 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' }),
          JOINTS_0: acc({ bufferView: view(u8(p.jn), 4, n, 'ATTRIBUTES', 34962), componentType: 5121, count: n, type: 'VEC4' }),
          WEIGHTS_0: acc({ bufferView: view(u8(p.wt), 16, n, 'ATTRIBUTES', 34962), componentType: 5126, count: n, type: 'VEC4' }),
        },
        indices: acc({ bufferView: view(u8(idx), idx.BYTES_PER_ELEMENT, p.idx.length, 'TRIANGLES', 34963), componentType: idx instanceof Uint16Array ? 5123 : 5125, count: p.idx.length, type: 'SCALAR' }),
        material: p.mat, mode: 4,
      };
    });
    const mi = json.meshes.push({ name: `char-xi_lod${li}`, primitives }) - 1;
    json.nodes[0].children.push(json.nodes.push({ name: `char-xi_lod${li}`, mesh: mi, skin: 0 }) - 1);
  });

  if (USE_MESHOPT) {
    json.extensionsUsed.push('EXT_meshopt_compression'); json.extensionsRequired.push('EXT_meshopt_compression');
    json.buffers.push({ byteLength: off }, { byteLength: fallback.n, extensions: { EXT_meshopt_compression: { fallback: true } } });
  } else json.buffers.push({ byteLength: off });
  if (!json.extensionsUsed.length) { delete json.extensionsUsed; delete json.extensionsRequired; }
  const bin = new Uint8Array(off); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const hdr = Buffer.alloc(12); hdr.writeUInt32LE(0x46546c67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(total, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  writeFileSync(path, Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), Buffer.from(bin)]));
  return total;
}

// =====================================================================================
await MeshoptEncoder.ready;
mkdirSync(OUT, { recursive: true });
const LOD_K = [1, 0.62, 0.42], LIMIT = [120000, 50000, 25000];
// --dump-base FILE：给 Blender 版（art/source/characters/build_char_xi.py）导出骨骼、socket 和可复用的身体部件（毛衣/裤子/手/袖子/袖口）
{ const di = process.argv.indexOf('--dump-base'); if (di > 0) {
  const ps = buildCharacter(1).map((p, i) => ({ i, mat: MAT_NAMES[p.mat], region: p.region, bones: Array.isArray(p.bones) ? p.bones : Object.keys(p.bones ?? {}),
    pos: p.pos.flatMap((v) => v.toArray().map((x) => +x.toFixed(5))), uv: p.uv.flat().map((x) => +(+x).toFixed(5)), idx: p.idx, flip: !!p.flip }));
  writeFileSync(process.argv[di + 1], JSON.stringify({ bones: BONES.map((b) => ({ name: b.name, parent: b.parent, head: b.pos.toArray(), tail: b.tail.toArray() })), socket: SOCKET,
    arm: Object.fromEntries(Object.entries(ARM).map(([k, v]) => [k, { a: v.a.toArray(), n: v.n.toArray(), hd: v.hd.toArray() }])), parts: ps }));
  console.log(`dumped ${ps.length} parts`); process.exit(0);
} }
const lods = LOD_K.map((k) => { const parts = buildCharacter(k); parts.forEach(finalize); const prims = merge(parts); outlineColors(prims); return prims; });
let fail = false;
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); fail ||= !ok; };
lods.forEach((prims, i) => {
  const tris = prims.reduce((s, p) => s + p.idx.length / 3, 0);
  let lo = Infinity, hi = -Infinity; for (const p of prims) for (let j = 1; j < p.pos.length; j += 3) { lo = Math.min(lo, p.pos[j]); hi = Math.max(hi, p.pos[j]); }
  check(tris <= LIMIT[i], `char-xi_lod${i}: ${tris} 三角面 (≤ ${LIMIT[i]})  [${prims.map((p) => `${MAT_NAMES[p.mat]} ${p.idx.length / 3}`).join(', ')}]  y ∈ [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  if (i === 0) check(Math.abs(hi - lo - 1.5) <= 0.02 && Math.abs(lo) < 0.002, `身高 ${(hi - lo).toFixed(3)} m（要求 1.50 ± 0.02，脚底 y=0）`);
});
check(BONES.length <= 80, `骨骼 ${BONES.length} 根（≤ 80）`);
check(BONES.every((b) => /^[a-z][a-z0-9_]*$/.test(b.name)), '骨骼名全部小写英文 + 下划线');
if (USE_MESHOPT) lods.forEach((ps) => ps.forEach(reorder));
const tmp = mkdtempSync(join(tmpdir(), 'char-xi-'));
const images = {};
for (const k of ['tex-xi-albedo', 'tex-xi-hair-albedo', 'tex-xi-face-albedo']) {
  const src = join(TEX, `${k}.png`);
  if (USE_PNG) { images[k] = src; continue; }
  images[k] = join(tmp, `${k}.webp`);
  execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(src)}).convert('RGB').save(${JSON.stringify(images[k])}, 'WEBP', quality=90, method=6)`]);
}
const file = join(OUT, 'char-xi.glb');
const bytes = writeGlb(lods, images, file);
rmSync(tmp, { recursive: true, force: true });
console.log(`→ ${file}  ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  hand_r_socket t=[${SOCKET.t.map((v) => v.toFixed(3))}] r=[${SOCKET.r.map((v) => v.toFixed(3))}]`);
process.exit(fail ? 1 : 0);
