// v0.1-017 汐动画自检（node，无浏览器）：
//  1. clip 表（src/entities/xi/clips.ts）↔ char-xi-anims.glb extras：31 个名字、帧数、循环、事件帧、步幅 / 楼梯 / 根运动参数；
//  2. 真 GLTFLoader 解析 char-xi.glb + anims.glb：每条轨道都绑得上模型骨骼、hand_r_socket 在、循环 clip 原地、
//     step-across 根运动实测 + 抵消、turn 第 34 帧 root 转满 ±90°、尾段抵消后偏航 ≈ 0；
//  3. 播放率 ↔ 速度：走 / 跑混合的脚下速度 = 实际速度（0.5–4 m/s），楼梯 / 推的播放率。
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import {
  XI_CLIP_SPECS,
  XI_CLIP_NAMES,
  XI_FPS,
  XI_CLIP_FALLBACK,
  xiClipDuration,
  xiEventSec,
  locoBlend,
  locoGroundSpeed,
  stairsRate,
  pushRate,
  stepAcrossRootZ,
  measureRootZ,
  asXiClip,
  nodeAnim,
  xiInteractEventSec,
  XI_KEY_BONE,
} from '@/entities/xi/clips';
import { findXiClip, makeTurnTail } from '@/entities/xi/XiAnimator';
import { xiActionTiming, XiActions } from '@/entities/xiActions';

const out = [];
const near = (a, b, tol, tag) => assert.ok(Math.abs(a - b) <= tol, `${tag}：${a} vs ${b}（容差 ${tol}）`);
const ART = new URL('../../art/models/characters/', import.meta.url);
const animsFile = new URL('char-xi-anims.glb', ART);
const modelFile = new URL('char-xi.glb', ART);

const glbJson = (file) => {
  const b = readFileSync(file);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
};

// ---- 3. 纯数学（不依赖美术文件）
{
  assert.equal(XI_CLIP_NAMES.length, 31, 'clip 表 31 条（30 + xi-pickup-shelf）');
  for (let s = 0.5; s <= 4.0001; s += 0.05) {
    const b = locoBlend(s);
    near(b.idle + b.walk + b.jog, 1, 1e-9, `速度 ${s.toFixed(2)} 权重和`);
    near(locoGroundSpeed(b), s, 1e-6, `速度 ${s.toFixed(2)} 脚下速度`);
    if (b.walk > 0 && b.jog > 0) {
      // 相位锁定的前提：两者每秒走过的「归一化周期」相同
      near(b.walkRate / xiClipDuration('xi-walk'), b.jogRate / xiClipDuration('xi-jog'), 1e-9, `速度 ${s.toFixed(2)} 走跑步频`);
    }
  }
  const w = locoBlend(1.6);
  assert.deepEqual([w.idle, w.walk, w.jog, w.walkRate], [0, 1, 0, 1], '1.6 m/s = 纯 walk、播放率 1');
  const j = locoBlend(3.2);
  assert.deepEqual([j.idle, j.walk, j.jog, j.jogRate], [0, 0, 1, 1], '3.2 m/s = 纯 jog、播放率 1');
  assert.equal(locoBlend(0).idle, 1, '静止 = idle');
  near(stairsRate(0.7091), 1, 1e-9, '楼梯水平 0.7091 m/s 播放率 1');
  near(stairsRate(0.5455 / (0.2 / 0.26)), 1, 2e-4, '级高 0.20 / 踏面 0.26 的楼梯上竖直 0.5455 → 播放率 1');
  near(pushRate(0.8), 1, 1e-9, 'push-loop 0.8 m/s 播放率 1');
  near(pushRate(0.812), 1.015, 1e-9, '004 实测 0.812 m/s → 1.015');
  near(stepAcrossRootZ(0), 0, 1e-9, 'step-across 根运动起点');
  near(stepAcrossRootZ(1.6), 0.85, 1e-9, 'step-across 根运动 0.85 m（README 值）');
  near(stepAcrossRootZ(0.8, 0.5), 0.25, 1e-9, 'step-across 中点 smoothstep');
  assert.equal(measureRootZ([0, 0, 0, 0, 0, 0.01]), 0, '< 2 cm 视为原地');
  assert.equal(XI_CLIP_FALLBACK['xi-pickup-shelf'], 'xi-pickup-table', 'pickup-shelf 缺失时用 pickup-table');
  assert.equal(xiEventSec('xi-pickup-shelf', 'grab'), 22 / 30, 'pickup-shelf grab 第 22 帧');
  // 交互动作时长 / 事件 ↔ clip 表
  for (const [name, ev] of [
    ['xi-ignite-lever', 'ignite'],
    ['xi-place-table', 'release'],
    ['xi-place', 'release'],
    ['xi-pickup', 'grab'],
    ['xi-pickup-table', 'grab'],
    ['xi-pickup-shelf', 'grab'],
    ['xi-ring-bell', 'ring'],
    ['xi-valve-hold', 'turnStart'],
  ]) {
    const tm = xiActionTiming(name);
    near(tm.duration, xiClipDuration(name), 1e-9, `${name} 时长`);
    near(tm.markerSec, xiEventSec(name, ev), 1e-9, `${name} 事件 ${ev}`);
  }
  near(xiInteractEventSec('xi-pickup-shelf'), 22 / 30, 1e-9, 'shelf 交互生效 = grab 22/30');
  near(xiInteractEventSec('xi-ring-bell'), 1.0, 1e-9, '敲钟 ring 第 30 帧 = 1.0 s');
  near(xiInteractEventSec('xi-place-table'), 34 / 30, 1e-9, '书桌放灯 release 第 34 帧');
  near(xiActionTiming('xi-place-table').duration, 54 / 30, 1e-9, 'xi-place-table 1.8 s（原占位 1.0 s）');
  near(xiEventSec('xi-valve-hold', 'turnEnd') - xiEventSec('xi-valve-hold', 'turnStart'), 2.0, 1e-9, '阀门 16–76 帧 = 圆环 2 s');
  // 节点 anim：别名 / 不认识 / fallback
  assert.equal(asXiClip('xi-pull-lever'), 'xi-ignite-lever', '旧名 xi-pull-lever → xi-ignite-lever');
  assert.equal(asXiClip('xi-unknown'), null);
  assert.equal(asXiClip(3), null);
  const fakeRoot = (anim) => ({ getObjectByName: (n) => (n === 'shelf' ? { userData: anim === undefined ? {} : { anim } } : undefined) });
  assert.equal(nodeAnim(fakeRoot('xi-pickup-shelf'), 'shelf', 'xi-pickup-table')(), 'xi-pickup-shelf', '节点 anim 优先');
  assert.equal(nodeAnim(fakeRoot(undefined), 'shelf', 'xi-pickup-table')(), 'xi-pickup-table', '节点没写 anim → fallback');
  assert.equal(nodeAnim(fakeRoot('bogus'), 'shelf', 'xi-pickup-shelf')(), 'xi-pickup-shelf', '节点 anim 不认识 → fallback');
  assert.equal(nodeAnim(null, 'shelf', 'xi-pickup-shelf')(), 'xi-pickup-shelf', '美术没加载 → fallback');
  // XiActions：按 clip 时长计时、事件帧回调、每步 setPose、结束 clearPose 解锁
  {
    const ctl = { locked: false, halt() {} };
    const log = { poses: [], cleared: 0 };
    const anim = { has: (c) => c === 'xi-place-table', setPose: (c, t) => log.poses.push([c, t]), clearPose: () => log.cleared++, setLoop() {} };
    const acts = new XiActions(ctl, anim);
    let markerAt = -1;
    let done = false;
    let t = 0;
    void acts.play('xi-place-table', { onMarker: () => (markerAt = t) }).then(() => (done = true));
    assert.equal(ctl.locked, true);
    const DT = 1 / 60;
    for (let i = 0; i < 200 && acts.playing; i++) {
      t += DT;
      acts.fixedUpdate(DT);
    }
    await Promise.resolve();
    assert.ok(done && !ctl.locked && log.cleared === 1, 'XiActions 播完解锁 + clearPose');
    near(markerAt, 34 / 30, DT + 1e-9, 'XiActions place-table release 第 34 帧');
    near(log.poses.at(-1)[1], 54 / 30, 1e-9, 'XiActions 播到末帧');
    near(t, 54 / 30, DT + 1e-9, 'XiActions 时长 1.8 s');
    const ctl2 = { locked: false, halt() {} };
    const plain = new XiActions(ctl2);
    void plain.play('xi-ignite-lever');
    for (let i = 0; i < 200 && plain.playing; i++) plain.fixedUpdate(DT);
    assert.equal(ctl2.locked, false, '没有动画（白盒）也按 clip 时长计时');
  }
  out.push('交互动作：事件帧（shelf grab 22、ring 30、place-table release 34、阀门 16–76 = 2 s）、节点 anim 优先 / 别名 / fallback、XiActions 计时 ✓');
  out.push('速度混合：0.5–4 m/s 脚下速度 = 实际速度、1.6 纯 walk / 3.2 纯 jog 播放率 1、走跑相位锁定；楼梯 0.7091→1、推 0.812→1.015 ✓');
}

// ---- 1. clip 表 ↔ GLB extras
if (!existsSync(animsFile)) {
  out.push('（../art 没有 char-xi-anims.glb，跳过 GLB 比对）');
} else {
  const j = glbJson(animsFile);
  const names = j.animations.map((a) => a.name);
  assert.equal(names.length, 31, 'anims.glb 31 个 clip');
  for (const n of XI_CLIP_NAMES) assert.ok(names.includes(n), `anims.glb 缺 ${n}`);
  for (const n of names) assert.ok(n in XI_CLIP_SPECS, `anims.glb 多出 ${n}（clip 表没有）`);
  for (const a of j.animations) {
    const s = XI_CLIP_SPECS[a.name];
    const ex = a.extras;
    assert.equal(ex.fps, XI_FPS, `${a.name} fps`);
    assert.equal(ex.frames, s.frames, `${a.name} 帧数`);
    assert.equal(ex.loop, s.loop, `${a.name} loop`);
    near(ex.durationS, xiClipDuration(a.name), 1e-3, `${a.name} 时长`);
    assert.deepEqual(ex.eventFrames ?? undefined, s.events ? { ...s.events } : undefined, `${a.name} 事件帧`);
    if (s.strideSpeed !== undefined) assert.equal(ex.strideSpeed, s.strideSpeed, `${a.name} strideSpeed`);
    if (s.strideM !== undefined) assert.equal(ex.strideM, s.strideM, `${a.name} strideM`);
    if (s.vertSpeed !== undefined) assert.equal(ex.vertSpeed, s.vertSpeed, `${a.name} vertSpeed`);
    if (s.rootYawDeg !== undefined) {
      assert.equal(ex.rootMotion.yawDeg, s.rootYawDeg, `${a.name} yaw`);
      assert.equal(ex.rootMotion.endFrame, s.rootYawEndFrame, `${a.name} endFrame`);
      assert.equal(ex.rootMotion.bone, 'root', `${a.name} 根骨`);
    }
    if (s.rootTranslateZ !== undefined) {
      assert.deepEqual(ex.rootMotion.translateM, [0, 0, s.rootTranslateZ], `${a.name} 根运动`);
      assert.equal(ex.rootMotion.profile, 'smoothstep', `${a.name} 根运动曲线`);
    }
    assert.equal(!!s.lantern, !!ex.prop, `${a.name} 提灯标记`);
  }
  const shelf = j.animations.find((a) => a.name === 'xi-pickup-shelf').extras.align.keyShelf;
  assert.equal(shelf.attachBone, XI_KEY_BONE, 'keyShelf 挂骨');
  assert.equal(shelf.attachAt, 'grab', 'keyShelf 挂在 grab 帧');
  assert.equal(shelf.interactNode, 'env-cellar-s2-shelf-interact', 'keyShelf 交互点节点名');
  // 美术交互点节点的 extras.anim（关卡按节点名读）
  const ENV = new URL('../../art/models/env/', import.meta.url);
  for (const [file, node, want] of [
    ['env-cellar-s2.glb', 'env-cellar-s2-shelf-interact', 'xi-pickup-shelf'],
    ['env-lamp-room-ch1.glb', 'ignite-lever-interact', 'xi-ignite-lever'],
    ['env-rock-islet-a.glb', 'tide-bell-s3-interact', 'xi-ring-bell'],
  ]) {
    const f = new URL(file, ENV);
    if (!existsSync(f)) continue;
    const nd = glbJson(f).nodes.find((n) => n.name === node);
    assert.ok(nd, `${file} 缺节点 ${node}`);
    assert.equal(asXiClip(nd.extras?.anim), want, `${node} anim`);
  }
  out.push('clip 表 ↔ anims.glb extras：31 个名字 / 帧数 / 循环 / 事件帧 / 步幅 / 楼梯 / 根运动 / 提灯一致 ✓');
}

// ---- 2. 真解析 + 绑定 + 姿势
if (existsSync(animsFile) && existsSync(modelFile)) {
  globalThis.self ??= globalThis;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)), detectSupport() {} };
  const parse = async (file) => {
    const buf = readFileSync(file);
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  };
  const [model, anims] = await Promise.all([parse(modelFile), parse(animsFile)]);
  const scene = model.scene;
  const clips = anims.animations;
  assert.equal(clips.length, 31);
  for (const n of XI_CLIP_NAMES) assert.ok(findXiClip(clips, n), `findXiClip ${n}`);
  const renamed = clips.map((c) => (c.name === 'xi-ignite-lever' ? Object.assign(c.clone(), { name: 'xi-pull-lever' }) : c));
  assert.equal(findXiClip(renamed, 'xi-ignite-lever')?.name, 'xi-pull-lever', '旧名 xi-pull-lever 别名');
  assert.equal(clips.find((c) => c.name === 'xi-step-across').userData?.eventFrames?.leftLand, 22, 'GLTFLoader 把 animation extras 放进 clip.userData');

  const bones = [];
  scene.traverse((o) => o.isBone && bones.push(o));
  assert.equal(bones.length, 73, 'char-xi 73 骨');
  assert.ok(scene.getObjectByName('hand_r_socket'), 'char-xi 有 hand_r_socket');
  assert.ok(scene.getObjectByName(XI_KEY_BONE)?.isBone, 'char-xi 有钥匙挂骨 middle_03_r');
  let skinned = 0;
  scene.traverse((o) => o.isSkinnedMesh && skinned++);
  assert.ok(skinned >= 3, 'LOD 三档都是蒙皮网格');

  let tracks = 0;
  for (const c of clips)
    for (const t of c.tracks) {
      const p = THREE.PropertyBinding.parseTrackName(t.name);
      assert.ok(THREE.PropertyBinding.findNode(scene, p.nodeName), `${c.name} 轨道 ${t.name} 在 char-xi 里找不到节点`);
      tracks++;
    }

  const mixer = new THREE.AnimationMixer(scene);
  const hips = scene.getObjectByName('hips');
  const root = scene.getObjectByName('root');
  assert.ok(hips && root, 'hips / root 骨');
  const sample = (clip, t) => {
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
    const a = mixer.clipAction(clip);
    a.reset().play();
    a.time = t;
    a.timeScale = 0;
    a.setEffectiveWeight(1);
    mixer.update(0);
    scene.updateMatrixWorld(true);
  };
  const hipsPos = () => hips.getWorldPosition(new THREE.Vector3());
  const rootYaw = () => {
    const e = new THREE.Euler().setFromQuaternion(root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    return (e.y * 180) / Math.PI;
  };
  const get = (n) => findXiClip(clips, n);

  for (const n of XI_CLIP_NAMES.filter((x) => XI_CLIP_SPECS[x].loop)) {
    sample(get(n), 0);
    const a = hipsPos();
    sample(get(n), xiClipDuration(n));
    const b = hipsPos();
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.01, `${n} 不是原地 / 首尾不接：${a.toArray()} → ${b.toArray()}`);
  }

  // step-across：README / extras 写「hips 沿 +Z 前进 0.85 m」，实测 hips 轨道首尾差 → 代码按实测值抵消；抵消后漂移 ≤ 6 cm（身体本身前后晃 ~4 cm）
  const sa = get('xi-step-across');
  const measured = measureRootZ(sa.tracks.find((t) => t.name === 'hips.position')?.values ?? null);
  sample(sa, 0);
  const h0 = hipsPos();
  let maxDrift = 0;
  for (let f = 0; f <= 48; f++) {
    sample(sa, f / 30);
    const h = hipsPos();
    maxDrift = Math.max(maxDrift, Math.abs(h.z - h0.z - stepAcrossRootZ(f / 30, measured)));
  }
  assert.ok(maxDrift <= 0.06, `step-across 根运动抵消后漂移 ${maxDrift.toFixed(3)} m`);
  const footL = scene.getObjectByName('foot_l');
  sample(sa, 0);
  const f0 = footL.getWorldPosition(new THREE.Vector3());
  sample(sa, 1.6);
  const f1 = footL.getWorldPosition(new THREE.Vector3());
  const stepNote =
    measured === 0
      ? `原地（hips 首尾差 0、左脚 48 帧回原位 ${(Math.abs(f1.z - f0.z) * 100).toFixed(1)} cm）≠ README「根运动 0.85 m」→ 不抵消，位移全由跨越路径给`
      : `根运动实测 ${measured.toFixed(3)} m，代码抵消`;

  for (const [n, yaw] of [
    ['xi-turn-l90', 90],
    ['xi-turn-r90', -90],
  ]) {
    const c = get(n);
    sample(c, 0);
    const y0 = rootYaw();
    sample(c, 34 / 30);
    near(rootYaw() - y0, yaw, 1.5, `${n} 第 34 帧 root 偏航`);
    const tail = makeTurnTail(c, yaw);
    near(tail.duration, 6 / 30, 1e-3, `${n} 尾段 6 帧`);
    sample(tail, 0);
    near(rootYaw() - y0, 0, 1.5, `${n} 尾段起点抵消`);
    sample(tail, tail.duration);
    near(rootYaw() - y0, 0, 1.5, `${n} 尾段终点抵消`);
  }
  out.push(
    `char-xi.glb 73 骨 / ${skinned} 个蒙皮网格 / hand_r_socket ✓；anims.glb ${tracks} 条轨道全部绑得上；循环 clip 原地（首尾 < 1 cm）；` +
      `step-across ${stepNote}（漂移 ${(maxDrift * 100).toFixed(1)} cm）；turn ±90° @34 帧、尾段抵消 ✓`,
  );
}

console.log('[verify-xi] ' + out.join('\n[verify-xi] '));
console.log('[verify-xi] 全部通过');
