#!/usr/bin/env node
// 017 汐动画自检：用 three.js 的 GLTFLoader + AnimationMixer（与游戏同一套）把 char-xi.glb 和 char-xi-anims.glb 一起加载，逐 clip 检查：
//   1. clip 名与工单一致（按批次）；2. 每条轨道都能绑定到 char-xi.glb 里的同名节点；3. 两个文件里同名关节的静止 TRS 一致；
//   4. 没有 NaN；5. 循环 clip 首尾姿势相同；6. 走/跑：从鞋跟/前掌触地点实测速度（与 extras.strideSpeed 比）、支撑相滑移；
//   7. 风灯 clip：hand_r_socket 相对臀部的平移范围（稳不稳）、挂点下垂方向与竖直的夹角（摆幅）；8. 蒙皮网格包围盒正常（脚底贴地）。
// 用法：node art/tools/verify-xi-anims.mjs [--batch=1]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const THREE_DIR = path.resolve(HERE, '../../game/node_modules/three');
const THREE = await import(path.join(THREE_DIR, 'build/three.module.js'));
const { GLTFLoader } = await import(path.join(THREE_DIR, 'examples/jsm/loaders/GLTFLoader.js'));
const CHAR = path.resolve(HERE, '../models/characters/char-xi.glb');
const ANIMS = path.resolve(HERE, '../models/characters/char-xi-anims.glb');
const BATCH = Number((process.argv.find((a) => a.startsWith('--batch=')) ?? '--batch=1').split('=')[1]);
const TICKET = {
  1: ['xi-idle', 'xi-idle-lantern', 'xi-walk', 'xi-walk-lantern', 'xi-jog', 'xi-jog-lantern', 'xi-turn-l90', 'xi-turn-r90', 'xi-stairs-up', 'xi-stairs-down'],
  2: ['xi-step-across', 'xi-push-loop', 'xi-push-start', 'xi-push-end', 'xi-ring-bell', 'xi-pickup', 'xi-place', 'xi-operate-loop', 'xi-valve-hold', 'xi-ignite-lever'],
  3: ['xi-read-loop', 'xi-look-up', 'xi-observe', 'xi-shiver', 'xi-row-boat', 'xi-tie-boat', 'xi-sit-write', 'xi-stand-gaze'],
};
// 工单外、经说明后额外提供的 clip（README 里写了原因）
const EXTRA_OK = { 2: ['xi-pickup-table', 'xi-place-table', 'xi-pickup-shelf'] };
let errors = 0, warns = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { errors++; console.log('  ✗ ' + m); }, warn = (m) => { warns++; console.log('  ! ' + m); };

// char-xi.glb 的贴图是外置 KTX2，Node 里不解码：用 gltf-transform 读进来、去掉贴图后再交给 GLTFLoader
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
async function loadGltf(file, stripTextures) {
  const doc = await io.read(file);
  if (stripTextures) { for (const t of doc.getRoot().listTextures()) t.dispose(); for (const e of doc.getRoot().listExtensionsUsed()) if (/texture_basisu/i.test(e.extensionName)) e.dispose(); }
  for (const e of doc.getRoot().listExtensionsUsed()) if (/meshopt/i.test(e.extensionName)) e.dispose();   // 已解码，写回时不再压缩
  const glb = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}
const cg = await loadGltf(CHAR, true), ag = await loadGltf(ANIMS, false);
const c = cg.scene, a = ag.scene;
console.log(`■ ${path.relative(process.cwd(), ANIMS)}（${(fs.statSync(ANIMS).size / 1024 / 1024).toFixed(2)} MB）+ char-xi.glb`);

// 1. 名字
const names = ag.animations.map((x) => x.name);
const want = Object.entries(TICKET).filter(([b]) => +b <= BATCH).flatMap(([, v]) => v);
const missing = want.filter((n) => !names.includes(n)), extra = names.filter((n) => !Object.values(TICKET).flat().includes(n) && !Object.entries(EXTRA_OK).some(([b, v]) => +b <= BATCH && v.includes(n)));
const extraOk = names.filter((n) => Object.values(EXTRA_OK).flat().includes(n));
missing.length ? bad('缺 clip：' + missing.join(', ')) : ok(`clip 名与工单一致（batch ≤ ${BATCH}，${want.length} 个）`);
if (extra.length) bad('工单里没有的 clip：' + extra.join(', '));
if (extraOk.length) ok('额外 clip（已在 README 说明）：' + extraOk.join(', '));
// batch 2：事件 / 对位参数
const exOf = (n) => ag.parser.json.animations.find((x) => x.name === n)?.extras ?? {};
if (BATCH >= 2) {
  const need = { 'xi-ignite-lever': ['ignite'], 'xi-valve-hold': ['turnStart', 'turnEnd'], 'xi-ring-bell': ['ring'], 'xi-pickup': ['grab'], 'xi-place': ['release'],
    'xi-pickup-table': ['grab'], 'xi-pickup-shelf': ['grab', 'lift'], 'xi-place-table': ['release'], 'xi-push-start': ['handsOn'], 'xi-push-end': ['handsOff'] };
  for (const [n, evs] of Object.entries(need)) {
    const ex = exOf(n);
    for (const e of evs) (ex.events && ex.events[e] >= 0 && ex.events[e] <= ex.durationS + 1e-6 && ex.eventFrames?.[e] != null) ? null : bad(`${n}: 缺事件 ${e}`);
  }
  const lv = exOf('xi-ignite-lever');
  lv.align?.igniteLever?.pullDeg === 60 && lv.align.igniteLever.angleDegPerFrame[lv.eventFrames.ignite] === 60 ? ok(`xi-ignite-lever：ignite @ ${lv.events.ignite}s（第 ${lv.eventFrames.ignite} 帧），拉杆正好到底 60°`) : bad('xi-ignite-lever：ignite 帧拉杆不在 60°');
  const vh = exOf('xi-valve-hold'); const hold = vh.events.turnEnd - vh.events.turnStart;
  Math.abs(hold - 2) < 0.02 ? ok(`xi-valve-hold：转动 ${hold.toFixed(2)} s`) : bad(`xi-valve-hold：转动 ${hold} s ≠ 2 s`);
  const vc = vh.align?.valveWheel?.center?.[1]; // 返工 2026-10-29：阀心离站立面 0.70 m
  Math.abs(vc - 0.7) < 0.005 ? ok(`xi-valve-hold：阀心高 ${vc} m`) : bad(`xi-valve-hold：阀心高 ${vc} ≠ 0.70 m`);
  const sa = exOf('xi-step-across');
  sa.rootMotion?.translateM?.[2] > 0 && sa.rootMotion.inPlace === true ? ok(`xi-step-across：原地，游戏沿跨越路径前移 ${sa.rootMotion.translateM[2]} m / ${sa.durationS}s（${sa.rootMotion.profile}）`) : bad('xi-step-across 缺 rootMotion.translateM / inPlace');
}
for (const n of ['xi-stairs-up', 'xi-stairs-down']) { // 返工 2026-10-29：楼梯竖直 ≈ 0.55 m/s
  const e = exOf(n), vv = Math.abs(e.vertSpeed ?? e.stairs?.vertSpeed ?? NaN);
  Math.abs(vv - 0.55) <= 0.01 ? ok(`${n}：竖直 ${vv} m/s、水平 ${e.strideSpeed} m/s`) : bad(`${n}：竖直 ${vv} m/s，应 ≈ 0.55`);
}
if (BATCH >= 3) {
  const need = { 'xi-look-up': ['upReached', 'lookDown'], 'xi-shiver': ['shiverStart', 'shiverEnd'], 'xi-row-boat': ['catch', 'finish', 'bladeOut', 'bladeIn'],
    'xi-tie-boat': ['ropeAround1', 'ropeAround2', 'hitch', 'tug', 'tied'], 'xi-sit-write': ['penDown1', 'penUp1', 'penDown2', 'penUp2'] };
  for (const [n, evs] of Object.entries(need)) {
    const ex = exOf(n);
    for (const e of evs) (ex.events && ex.events[e] >= 0 && ex.events[e] <= ex.durationS + 1e-6 && ex.eventFrames?.[e] != null) ? null : bad(`${n}: 缺事件 ${e}`);
  }
  const loops = { 'xi-read-loop': true, 'xi-look-up': false, 'xi-observe': true, 'xi-shiver': false, 'xi-row-boat': true, 'xi-tie-boat': false, 'xi-sit-write': true, 'xi-stand-gaze': true };
  const wrongLoop = Object.entries(loops).filter(([n, l]) => !!exOf(n).loop !== l).map(([n]) => n);
  wrongLoop.length ? bad('batch 3 循环标记与工单不符：' + wrongLoop.join(', ')) : ok('batch 3 循环 / 非循环与工单一致');
  const rw = exOf('xi-row-boat').align?.rowing;
  rw && rw.seatTop === 0.35 && rw.yawDegPerFrame?.length === exOf('xi-row-boat').frames && rw.oarlockL && rw.oarlockR ? ok(`xi-row-boat：座高 ${rw.seatTop}、桨架 ${JSON.stringify(rw.oarlockL)}、桨长 ${rw.oarLengthM} m、逐帧桨角 ${rw.yawDegPerFrame.length} 帧`) : bad('xi-row-boat：缺座高 0.35 / 桨架 / 逐帧桨角');
  const sw = exOf('xi-sit-write').align?.sitWrite;
  sw && sw.seatTop === 0.4 && sw.deskTop === 0.68 ? ok(`xi-sit-write：座高 ${sw.seatTop}、桌面 ${sw.deskTop}、桌前沿 ${sw.deskFrontAheadM} m`) : bad('xi-sit-write：座高 / 桌高不是 0.40 / 0.68（035 按汐 1.51 m 降低）');
  const ws = exOf('xi-observe').align?.windowSill; ws?.sillTopY === 0.9 ? ok('xi-observe：窗台 0.90 m（S2 二层西窗）') : bad('xi-observe：缺窗台对位');
  const mp = exOf('xi-tie-boat').align?.mooringPost; mp?.radiusM === 0.16 ? ok(`xi-tie-boat：系船桩 r ${mp.radiusM}、中心 ${JSON.stringify(mp.center)}`) : bad('xi-tie-boat：缺系船桩对位');
}
let meshCount = 0; a.traverse((o) => { if (o.isMesh) meshCount++; });
meshCount ? bad(`动画文件里有 ${meshCount} 个网格`) : ok('动画文件无网格');
fs.statSync(ANIMS).size <= 15 * 1024 * 1024 ? ok('≤ 15 MB') : bad('超过 15 MB');

// 3. 静止 TRS
const byName = (root) => { const m = new Map(); root.traverse((o) => { if (o.name) m.set(o.name, o); }); return m; };
const cn = byName(c), an = byName(a);
let joints = 0, trsBad = [];
const skinned = []; c.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
const boneNames = new Set(skinned[0].skeleton.bones.map((b) => b.name));
for (const n of boneNames) {
  const x = cn.get(n), y = an.get(n);
  if (!y) { trsBad.push(n + '（动画文件里没有）'); continue; }
  joints++;
  const d = Math.max(x.position.distanceTo(y.position), 1 - Math.abs(x.quaternion.dot(y.quaternion)), x.scale.distanceTo(y.scale));
  if (d > 1e-4) trsBad.push(`${n} Δ${d.toExponential(1)}`);
}
trsBad.length ? bad('静止 TRS 不一致：' + trsBad.slice(0, 6).join(', ')) : ok(`${joints} 个关节静止 TRS 与 char-xi.glb 一致（同一骨架）`);
const sk = an.get('hand_r_socket'), skc = cn.get('hand_r_socket');
sk && skc && sk.parent.name === skc.parent.name && sk.position.distanceTo(skc.position) < 1e-4 ? ok('hand_r_socket 两边一致') : bad('hand_r_socket 不一致');

// 2. 绑定、NaN
const mixer = new THREE.AnimationMixer(c);
for (const clip of ag.animations) {
  let unbound = [], nan = 0;
  for (const t of clip.tracks) {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(t.name);
    if (!THREE.PropertyBinding.findNode(c, nodeName)) unbound.push(nodeName);
    for (const v of t.values) if (!Number.isFinite(v)) nan++;
    for (const v of t.times) if (!Number.isFinite(v)) nan++;
  }
  if (unbound.length) bad(`${clip.name}: ${unbound.length} 条轨道绑不上 (${unbound.slice(0, 3)})`);
  if (nan) bad(`${clip.name}: ${nan} 个 NaN`);
}
if (!errors) ok(`${ag.animations.reduce((s, x) => s + x.tracks.length, 0)} 条轨道全部绑定到 char-xi.glb 的节点，无 NaN`);

// 逐 clip 采样
const bones = Object.fromEntries(['foot_l', 'foot_r', 'hips', 'hand_r_socket', 'root'].map((n) => [n, cn.get(n)]));
c.updateMatrixWorld(true);
// 脚底参考点：静止时鞋跟/前掌（相对踝关节 = foot 骨原点，glTF 轴：前 = +Z）
const contactLocal = {};
for (const s of ['l', 'r']) {
  const inv = bones['foot_' + s].matrixWorld.clone().invert(), ank = new THREE.Vector3().setFromMatrixPosition(bones['foot_' + s].matrixWorld);
  contactLocal[s] = { heel: ank.clone().add(new THREE.Vector3(0, -0.075, -0.065)).applyMatrix4(inv), ball: ank.clone().add(new THREE.Vector3(0, -0.075, 0.125)).applyMatrix4(inv) };
}
const sockDown0 = new THREE.Vector3(0, -1, 0);   // 挂点局部 −Y（glTF）= 灯的下垂方向
const rows = [];
for (const clip of ag.animations) {
  const ex = ag.parser.json.animations.find((x) => x.name === clip.name).extras ?? {};
  mixer.stopAllAction(); const act = mixer.clipAction(clip); act.setLoop(ex.loop ? THREE.LoopRepeat : THREE.LoopOnce); act.clampWhenFinished = true; act.play();
  const nf = ex.frames, fps = ex.fps ?? 30, n = ex.loop ? nf - 1 : nf;
  const S = [];
  for (let f = 0; f < nf; f++) {
    act.time = Math.min(f / fps, clip.duration - (ex.loop && f === nf - 1 ? 0 : 0)); if (ex.loop && f === nf - 1) act.time = clip.duration - 1e-9;
    mixer.update(0); c.updateMatrixWorld(true);
    const s = { q: new Map() };
    for (const b of boneNames) s.q.set(b, cn.get(b).quaternion.clone());
    for (const side of ['l', 'r']) for (const k of ['heel', 'ball']) s[side + k] = contactLocal[side][k].clone().applyMatrix4(bones['foot_' + side].matrixWorld);
    s.hips = new THREE.Vector3().setFromMatrixPosition(bones.hips.matrixWorld);
    s.sock = new THREE.Vector3().setFromMatrixPosition(bones.hand_r_socket.matrixWorld);
    s.down = sockDown0.clone().transformDirection(bones.hand_r_socket.matrixWorld);
    if (f % 6 === 0 || f === nf - 1) { skinned[0].computeBoundingBox(); s.box = skinned[0].boundingBox.clone(); }
    S.push(s);
  }
  const r = { name: clip.name, frames: nf, loop: !!ex.loop };
  // 5. 循环首尾
  if (ex.loop) {
    let d = 0; for (const b of boneNames) d = Math.max(d, 1 - Math.abs(S[0].q.get(b).dot(S[nf - 1].q.get(b))));
    r.loopDiff = d; d < 1e-6 ? null : bad(`${clip.name}: 循环首尾不一致 ${d}`);
  }
  // 6. 触地速度：每只脚取最低的参考点，两帧都 < 3 mm 视为踩地（离地那一帧不算）
  if (ex.strideSpeed && !ex.stairs) {
    const v = [], slide = [];
    for (const side of ['l', 'r']) for (let f = 0; f < n; f++) {
      const p0 = S[f], p1 = S[f + 1];
      for (const k of ['heel', 'ball']) {
        const a0 = p0[side + k], a1 = p1[side + k];
        if (a0.y < 0.003 && a1.y < 0.003) { const vel = a1.clone().sub(a0).multiplyScalar(fps); v.push(-vel.z); slide.push(Math.hypot(vel.x, vel.z + ex.strideSpeed)); if (process.env.DBG && Math.hypot(vel.x, vel.z + ex.strideSpeed) > 0.05) console.log(clip.name, side, k, f, a0.toArray().map((x) => x.toFixed(3)), vel.toArray().map((x) => x.toFixed(3))); }
      }
    }
    v.sort((x, y) => x - y); r.contactSpeed = v[v.length >> 1]; r.slideP95 = slide.sort((x, y) => x - y)[Math.floor(slide.length * 0.95)];
    Math.abs(r.contactSpeed - ex.strideSpeed) < 0.02 ? null : bad(`${clip.name}: 触地速度 ${r.contactSpeed.toFixed(3)} ≠ ${ex.strideSpeed}`);
  }
  // 7. 风灯
  if (clip.name.includes('lantern') || (ex.prop && !ex.lanternWorld)) {
    const rel = S.map((s) => s.sock.clone().sub(s.hips));
    const ax = ['x', 'y', 'z'].map((k) => Math.max(...rel.map((p) => p[k])) - Math.min(...rel.map((p) => p[k])));
    r.sockRangeCm = ax.map((x) => +(x * 100).toFixed(1)); r.lanternTiltDeg = Math.max(...S.map((s) => THREE.MathUtils.radToDeg(s.down.angleTo(new THREE.Vector3(0, -1, 0)))));
    r.sockMinX = Math.min(...S.map((s) => s.sock.x));
  }
  // 8. 包围盒
  const boxes = S.filter((s) => s.box).map((s) => s.box);
  r.minY = Math.min(...boxes.map((b) => b.min.y)); r.maxY = Math.max(...boxes.map((b) => b.max.y));
  if (!ex.stairs && (r.minY < -0.02 || r.minY > 0.12)) warn(`${clip.name}: 网格最低点 ${r.minY.toFixed(3)} m`);
  rows.push(r);
}
console.log('\n  clip                 帧   循环  触地速度(实测/标称)  滑移P95  首尾差    风灯挂点相对臀部范围(cm)  灯倾角   网格 y 范围');
for (const r of rows) {
  const ex = ag.parser.json.animations.find((x) => x.name === r.name).extras;
  console.log('  ' + r.name.padEnd(20) + String(r.frames).padStart(4) + (r.loop ? '   是  ' : '   否  ') +
    (r.contactSpeed != null ? `${r.contactSpeed.toFixed(3)}/${ex.strideSpeed}`.padEnd(20) : (ex.strideSpeed ? `楼梯 ${ex.strideSpeed}(水平)`.padEnd(20) : ''.padEnd(20))) +
    (r.slideP95 != null ? r.slideP95.toFixed(3).padEnd(9) : ''.padEnd(9)) + (r.loopDiff != null ? r.loopDiff.toExponential(0).padEnd(9) : ''.padEnd(9)) +
    (r.sockRangeCm ? r.sockRangeCm.join('/').padEnd(26) : ''.padEnd(26)) + (r.lanternTiltDeg != null ? r.lanternTiltDeg.toFixed(1).padEnd(8) : ''.padEnd(8)) + `${r.minY.toFixed(3)}…${r.maxY.toFixed(3)}`);
}
console.log(`\n${errors ? '✗ 有错误 ' + errors : '✓ 全部通过'}${warns ? `（警告 ${warns}）` : ''}`);
process.exit(errors ? 1 : 0);
