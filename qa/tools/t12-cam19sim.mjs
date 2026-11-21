// batch12 裁定 19：60 Hz 固定步复算（与游戏同一函数 cameraHeightCapDistance + s2CameraHeightCaps；无物理碰撞）
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { S2, s2CameraHeightCaps, slopeY } from '@/levels/s2/layout';
import { cameraHeightCapDistance } from '@/systems/CameraFollowSystem';
const cfg = gameplay.camera;
const caps = s2CameraHeightCaps({ x: 0.95, y: 4.35, z: 1 }, { x: 0.95 + 0.9543876579245467 * 20, y: 4.35 - 0.2985702570605802 * 20, z: 1 });
const smooth = (x) => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); };
function run(name, path, speed, yaw, pitch = -35) {
  const dt = 1 / 60, q = new THREE.Quaternion(), e = new THREE.Euler(pitch * Math.PI / 180, yaw, 0, 'YXZ'); q.setFromEuler(e);
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  let cur = null, rec = null, prev = null, maxStep = 0, maxDrop = 0, at = null, capFrames = 0, n = 0;
  const L = path.len;
  for (let d = 0; d <= L; d += speed * dt, n++) {
    const p = path.at(d); const pivot = new THREE.Vector3(p.x, slopeY(p.x) + cfg.pivotHeight, p.z).addScaledVector(right, cfg.shoulderOffset);
    let maxD = cfg.maxDistance;
    const capD = cameraHeightCapDistance(caps, pivot, back, maxD); if (capD < maxD - 1e-4) capFrames++;
    maxD = Math.max(Math.min(maxD, cfg.minCollisionDistance), capD);
    if (cur == null || maxD < cur - 1e-4) { cur = maxD; rec = null; } else if (maxD > cur + 1e-4) { rec ??= { from: cur, t: 0 }; rec.t += dt; const k = smooth(rec.t / cfg.recoverTime); cur = k >= 1 ? maxD : rec.from + (maxD - rec.from) * k; if (k >= 1) rec = null; } else { cur = maxD; rec = null; }
    const cam = pivot.clone().addScaledVector(back, cur);
    if (prev) { const s = cam.distanceTo(prev.cam); if (s > maxStep) { maxStep = s; at = { d: +d.toFixed(2), dist: +cur.toFixed(2), prevDist: +prev.cur.toFixed(2) }; } maxDrop = Math.max(maxDrop, prev.cur - cur); }
    prev = { cam, cur };
  }
  console.log(name, JSON.stringify({ speed, frames: n, capFrames, maxCamStepPerFrame_m: +maxStep.toFixed(3), maxDistDropPerFrame_m: +maxDrop.toFixed(3), at }));
}
const c = caps[0];
const along = (s0, s1, lat = 0) => ({ len: Math.abs(s1 - s0), at: (d) => ({ x: c.origin.x + (s0 + Math.sign(s1 - s0) * d), z: c.origin.z + lat }) });
const side = (s, l0, l1) => ({ len: Math.abs(l1 - l0), at: (d) => ({ x: c.origin.x + s, z: c.origin.z + l0 + Math.sign(l1 - l0) * d }) });
const yawBackPlusX = Math.PI / 2; // back = +x（相机在玩家 +x 侧，朝房子看）
for (const sp of [gameplay.player?.walkSpeed ?? 1.6, 3.2]) {
  run('沿视线走向房子 s 13→2', along(13, 2), sp, yawBackPlusX);
  run('沿视线离开 s 2→13', along(2, 13), sp, yawBackPlusX);
  run('横穿出带 lat 0→5（s 5.5）', side(5.5, 0, 5), sp, yawBackPlusX);
  run('横穿入带 lat 5→0（s 5.5）', side(5.5, 5, 0), sp, yawBackPlusX);
  run('横穿入带 lat 5→0，相机在身后 +z 侧', side(5.5, 5, 0), sp, 0);
}
console.log('caps', JSON.stringify(caps));
