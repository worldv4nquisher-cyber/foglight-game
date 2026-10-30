// 制作人裁定 17 抽样（可选）：观察模式外，从玩家可到达的任何第三人称位置都读不出「317」。
// 纯几何：数字石块（white-stones-digit-3/1/7 下每块石头的顶面中心）从相机投影成 2D 点集，
// 与固定眼位（viewpoint 节点、FOV 30）的投影做相似变换（平移 + 旋转 + 等比缩放）最优对齐，
// 残差 RMS / 字高 = 拼合误差。眼位上 = 0；石块错开超过笔画宽的一半字就散了。
// 可读 = 误差 < READ_ERR 且字高 ≥ MIN_PX（1080p）。可到达位置 = S2 白盒碰撞体顶面（法线朝上、不含屋顶）1 m 网格，
// 相机 = 与 CameraFollowSystem 同约定：头部支点 + 肩后右偏、Euler(pitch, yaw, 'YXZ')、第三人称距离 [min, 默认, max]、俯仰 min..max 8 档、
// 偏航 = 正对字组 ±0/10/20°；字组须全部在画面内（出画 / 在相机后面 = 读不出）。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/sample-317.mjs（约 8 min；SAMPLE_CAM_NO_INDOOR=1 = 假设室外时相机不许进室内触发体）
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { gameplay } from '@/config/gameplay';
import { S2 } from '@/levels/s2/layout';
import { buildS2Greybox } from '@/levels/s2/greybox';
import { whiteStonesAim, WHITE_STONES_DIGIT_NODES } from '@/levels/s2/whiteStonesGlow';

/** 拼合误差阈值（字高的比例）：七段笔画宽 ≈ 字高 0.15–0.2，错开半个笔画就断 */
const READ_ERR = 0.08;
/** 1080p 下字高至少这么多像素才谈得上读 */
const MIN_PX = 12;

globalThis.self ??= globalThis;
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
const f = new URL('../../art/models/props/prop-white-stones-s2.glb', import.meta.url);
if (!existsSync(f)) {
  console.log('白石组美术不在（../art），跳过');
  process.exit(0);
}
const buf = readFileSync(f);
const ws = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
const world = new THREE.Scene();
const cliffPl = S2.artNodes['env-clifftop-s2'];
const holder = new THREE.Group();
holder.position.set(...cliffPl.translation);
holder.rotation.y = cliffPl.rotationY;
holder.add(ws);
world.add(holder);
const g2 = buildS2Greybox();
world.add(g2.root);
world.updateMatrixWorld(true);
const aim = whiteStonesAim(ws);
assert.ok(aim, '白石组缺 viewpoint / digit 节点');

// 数字石块采样点（顶面中心）
const pts = [];
for (const dn of WHITE_STONES_DIGIT_NODES) {
  ws.getObjectByName(dn).traverse((m) => {
    if (!m.isMesh || /collider/i.test(m.name)) return;
    const b = new THREE.Box3().setFromObject(m);
    pts.push(new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2));
  });
}
const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);

/** 投影到等比 2D（x 按宽高比展开）；在相机后面或出画（|ndc| > 1）的点记 null */
const projectCam = (cam) => {
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return pts.map((p) => {
    const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.05) return null; // 在相机后面
    const n = p.clone().project(cam);
    if (Math.abs(n.x) > 1 || Math.abs(n.y) > 1) return null; // 出画
    return [n.x * (16 / 9), n.y];
  });
};
const project = (eye, target, fov) => {
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 500);
  cam.position.copy(eye);
  cam.lookAt(target);
  return projectCam(cam);
};
const ref = project(aim.eye, aim.eye.clone().add(aim.center), aim.fov);
const refH = Math.max(...ref.map((p) => p[1])) - Math.min(...ref.map((p) => p[1]));

/** 2D 相似变换最优对齐（Umeyama）后的残差 RMS / 参考字高 */
function alignErr(a) {
  if (a.some((p) => !p)) return Infinity;
  const n = a.length;
  const ma = [0, 0], mb = [0, 0];
  for (let i = 0; i < n; i++) { ma[0] += a[i][0] / n; ma[1] += a[i][1] / n; mb[0] += ref[i][0] / n; mb[1] += ref[i][1] / n; }
  let sxx = 0, sxy = 0, va = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i][0] - ma[0], ay = a[i][1] - ma[1], bx = ref[i][0] - mb[0], by = ref[i][1] - mb[1];
    sxx += ax * bx + ay * by; // cos 项
    sxy += ax * by - ay * bx; // sin 项
    va += ax * ax + ay * ay;
  }
  const s = Math.hypot(sxx, sxy) / va, th = Math.atan2(sxy, sxx), c = Math.cos(th) * s, si = Math.sin(th) * s;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i][0] - ma[0], ay = a[i][1] - ma[1];
    const dx = c * ax - si * ay - (ref[i][0] - mb[0]), dy = si * ax + c * ay - (ref[i][1] - mb[1]);
    e += dx * dx + dy * dy;
  }
  return Math.sqrt(e / n) / refH;
}
/** 1080p 下字高像素 */
function digitPx(a, fov) {
  if (a.some((p) => !p)) return 0;
  const h = Math.max(...a.map((p) => p[1])) - Math.min(...a.map((p) => p[1]));
  void fov;
  return (h / 2) * 1080;
}

/** 两线段最短距离 */
function segSegDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

// 标定：眼位附近偏移多少还能读
const calib = [];
for (const d of [0, 0.1, 0.25, 0.5, 1, 2]) {
  let worst = 0;
  for (const dir of [[1, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], [0, 0, -1]]) {
    const e = aim.eye.clone().add(new THREE.Vector3(...dir).multiplyScalar(d));
    worst = Math.max(worst, alignErr(project(e, e.clone().add(aim.center), aim.fov)));
  }
  calib.push(`${d} m → ${worst.toFixed(3)}`);
}

// 可到达位置：白盒碰撞体顶面（法线朝上，不含屋顶）1 m 网格
const walk = g2.colliders.filter((m) => !/roof/i.test(m.name));
const box = new THREE.Box3();
for (const m of walk) box.expandByObject(m);
const rc = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const stand = [];
for (let x = Math.floor(box.min.x); x <= box.max.x; x += 1) {
  for (let z = Math.floor(box.min.z); z <= box.max.z; z += 1) {
    rc.set(new THREE.Vector3(x + 0.5, box.max.y + 1, z + 0.5), down);
    rc.far = box.max.y - box.min.y + 2;
    const hits = rc.intersectObjects(walk, false);
    for (const h of hits) {
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.y < 0.7) continue;
      const sp = h.point.clone();
      sp.userData = h.object.name;
      stand.push(sp);
    }
  }
}

// 遮挡体 = 白盒全部网格（不含 -indoor 体积）+ 有 ../art 时美术环境可见网格（art=1 时白盒除碰撞外不渲染，两者都算偏严）
const occ = [];
g2.root.traverse((o) => o.isMesh && !/indoor/i.test(o.name) && occ.push(o));
const artOcc = [];
for (const [k, pl] of Object.entries(S2.artNodes)) {
  const af = new URL(`../../art/models/env/${k}.glb`, import.meta.url);
  if (!existsSync(af)) continue;
  const b = readFileSync(af);
  const m = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene;
  m.position.set(...pl.translation);
  m.rotation.y = pl.rotationY;
  world.add(m);
  m.updateMatrixWorld(true);
  m.traverse((o) => o.isMesh && !/indoor|collider|_lod[1-9]/i.test(o.name) && artOcc.push(o));
}
const occArt = [...occ, ...artOcc];
const cam = gameplay.camera;
const DEG = Math.PI / 180;
const dists = [cam.minDistance, cam.distance, cam.maxDistance];
// 与 CameraFollowSystem 同约定：Euler(pitch, yaw, 0, 'YXZ')，负俯仰 = 往下看（相机在支点上方），范围 minPitchDeg..maxPitchDeg
const pitches = [cam.minPitchDeg, -20, -10, 0, 10, 20, 35, cam.maxPitchDeg].map((d) => d * DEG);
// 朝向：正对字组 ± 偏航（视线不必正对字组，字组只要在画面里）
const yawOffs = [-20, -10, 0, 10, 20].map((d) => d * DEG);
const gameCam = new THREE.PerspectiveCamera(cam.fov, 16 / 9, 0.05, 500);
// 室内触发体（-indoor）：角色在里面时相机距离 ≤ indoorMaxDistance（CameraFollowSystem 同逻辑，判定点 = 脚底 +0.5 m）
const indoorBoxes = g2.indoor.map((m) => new THREE.Box3().setFromObject(m));
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const NO_INDOOR = process.env.SAMPLE_CAM_NO_INDOOR === '1';
const tmpHit = new THREE.Vector3();
let n = 0, occluded = 0, best = { err: Infinity };
const readable = [];
for (const p of stand) {
  const head = p.clone().setY(p.y + cam.pivotHeight);
  const toC = center.clone().sub(head);
  // 相机朝向 −Z：yaw = atan2(−dx, −dz) 时正对字组
  const yaw0 = Math.atan2(-toC.x, -toC.z);
  const isIndoor = indoorBoxes.some((b) => b.containsPoint(p.clone().setY(p.y + 0.5)));
  for (const yo of yawOffs) {
    const yaw = yaw0 + yo;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const pivot = head.clone().addScaledVector(right, cam.shoulderOffset);
    // 室内三档距离都被压到 indoorMaxDistance，去重免得同一机位算三遍
    for (const dist of [...new Set(dists.map((d) => (isIndoor ? Math.min(d, cam.indoorMaxDistance) : d)))]) {
      for (const pitch of pitches) {
        euler.set(pitch, yaw, 0);
        gameCam.quaternion.setFromEuler(euler);
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(gameCam.quaternion);
        // 相机碰撞：支点 → 相机被挡就拉近（留 collisionRadius）
        rc.set(pivot, back);
        rc.far = dist;
        const hit = rc.intersectObjects(occ, false)[0];
        let d = hit ? Math.max(cam.minCollisionDistance, hit.distance - cam.collisionRadius) : dist;
        // 假设试验（SAMPLE_CAM_NO_INDOOR=1）：角色在室外时相机不许穿进室内触发体（比如从西窗钻进二层）
        if (NO_INDOOR && !isIndoor) {
          for (const b of indoorBoxes) {
            const hp = rc.ray.intersectBox(b, tmpHit);
            if (hp) d = Math.min(d, Math.max(cam.minCollisionDistance, hp.distanceTo(pivot) - cam.collisionRadius));
          }
        }
        const eye = pivot.clone().addScaledVector(back, d);
        gameCam.position.copy(eye);
        const a = projectCam(gameCam);
        const err = alignErr(a);
        const px = digitPx(a, cam.fov);
        n++;
        // 视线遮挡（只对接近拼合的机位算，省射线）：被墙 / 地形挡住的石块读不到（> 20% 被挡就不算能读）
        if (err < READ_ERR * 2) {
          let blocked = 0;
          for (const q of pts) {
            const v = q.clone().sub(eye);
            const L = v.length();
            rc.set(eye, v.normalize());
            rc.far = L - 0.15;
            if (rc.intersectObjects(occArt, false).length) blocked++;
          }
          if (blocked / pts.length > 0.2) {
            occluded++;
            continue;
          }
        }
        const rec = { err: +err.toFixed(3), px: +px.toFixed(0), eye: eye.toArray().map((v) => +v.toFixed(2)), stand: p.toArray().map((v) => +v.toFixed(2)), on: p.userData, dist: +d.toFixed(2), pitch: +(pitch / DEG).toFixed(0), yawOff: +(yo / DEG).toFixed(0) };
        if (err < best.err) best = rec;
        if (err < READ_ERR && px >= MIN_PX) {
          // 汐本身（第三人称时可见，胶囊 r 0.3、脚底 +0.2…+1.6 m）挡住的数字石块比例
          let body = 0;
          for (const q of pts) if (segSegDist(eye, q, p.clone().setY(p.y + 0.2), p.clone().setY(p.y + 1.6)) < 0.3) body++;
          rec.bodyBlocked = +(body / pts.length).toFixed(2);
          readable.push(rec);
        }
      }
    }
  }
}
console.log(`数字石块 ${pts.length} 块，眼位 (${aim.eye.toArray().map((v) => +v.toFixed(2)).join(', ')}) FOV ${aim.fov}，字高 ${(refH / 2 * 1080).toFixed(0)} px @1080p`);
console.log('标定（眼位偏移 → 最坏拼合误差 / 字高）：' + calib.join('，'));
console.log(`遮挡：白盒 ${occ.length} 个网格 + 美术环境 ${artOcc.length} 个网格（视线遮挡用两者，相机碰撞只用白盒碰撞体所在的白盒）`);
console.log(`可到达站位 ${stand.length} 个 × 相机 ${dists.length * pitches.length * yawOffs.length} 种（距离 ${dists.length} × 俯仰 ${pitches.length} × 偏航 ${yawOffs.length}）= ${n} 个第三人称机位（站位在室内触发体里时距离压到 indoorMaxDistance ${cam.indoorMaxDistance} m、去重）`);
console.log(`接近拼合（误差 < ${READ_ERR * 2}）但石块被挡的机位 ${occluded} 个`);
console.log(`最接近拼合：误差 ${best.err}（阈值 ${READ_ERR}），字高 ${best.px} px，站位 ${best.stand}，距离 ${best.dist}，俯仰 ${best.pitch}°，偏航 ${best.yawOff}°，相机 ${best.eye}`);
console.log('程序侧：数字石加亮 = onViewpoint && cameraFollow.observing ? alignment : 0（puzzles.ts update），非观察模式恒为 0，不显影；下面只看石块本身的几何拼合');
if (readable.length) {
  const st = [...new Set(readable.map((r) => r.stand.join(',')))];
  const ex = (k, i) => [Math.min(...readable.map((r) => r[k][i])), Math.max(...readable.map((r) => r[k][i]))].join('…');
  console.log(`  读得出的站位 ${st.length} 个：x ${ex('stand', 0)}、z ${ex('stand', 2)}；相机 x ${ex('eye', 0)}、y ${ex('eye', 1)}、z ${ex('eye', 2)}；俯仰 ${[...new Set(readable.map((r) => r.pitch))].join('/')}°`);
  const dEye = readable.map((r) => new THREE.Vector3(...r.eye).distanceTo(aim.eye));
  console.log(`  读得出的相机离固定眼位 ${Math.min(...dEye).toFixed(2)}…${Math.max(...dEye).toFixed(2)} m`);
  const clear = readable.filter((r) => r.bodyBlocked <= 0.2);
  console.log(`  其中汐身体挡住 > 20% 数字石块的 ${readable.length - clear.length} 个；不被汐挡的 ${clear.length} 个` + (clear.length ? '，例：' + JSON.stringify(clear.slice(0, 3)) : ''));
  const byOn = {};
  for (const r of readable) byOn[r.on] = (byOn[r.on] ?? 0) + 1;
  console.log('  按站立面：' + JSON.stringify(byOn));
  console.log(`✗ 裁定 17：${readable.length} 个机位读得出 317，例：${JSON.stringify(readable.slice(0, 5))}`);
  process.exit(1);
}
console.log('✓ 裁定 17：观察模式外没有机位读得出 317');
