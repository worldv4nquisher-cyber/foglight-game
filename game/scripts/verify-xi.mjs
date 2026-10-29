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
  XI_KEY_ATTACH,
  XI_STEP_ACROSS,
  stepAcrossSpan,
  readKeyAttach,
} from '@/entities/xi/clips';
import { rowerSeat, tieBoatStand, oarlock, alignXiTo, rowingAngles, oarHandleDir, findArtNode, XI_BOAT_NODES } from '@/entities/xi/boatAlign';
import { TraversalLink } from '@/entities/components/TraversalLink';
import { s1StepLinks, S1 } from '@/levels/s1/layout';
import { buildLods, setForceLod0, applyLodDistances } from '@/render/lod';
import { findXiClip, makeTurnTail } from '@/entities/xi/XiAnimator';
import { xiActionTiming, XiActions } from '@/entities/xiActions';
import { applyXiMaterials, xiFaceSdfParams, xiFaceLit, xiWetColor, xiWetRoughness, xiMaterialKind, XI_SHADOW_TINT } from '@/render/xiMaterials';
import { stepWetness, xiWetTarget, isIndoor } from '@/entities/xi/XiLook';

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
  // 材质公式（art/tools/README §5）
  near(xiWetColor(1, 1), 0.78, 1e-9, '全湿颜色 ×0.78');
  near(xiWetColor(0.5, 0.5), 1 - 0.22 * 0.25, 1e-9, '湿痕颜色');
  near(xiWetRoughness(0.8, 1, 1), 0.28, 1e-9, '全湿粗糙度 0.28');
  near(xiWetRoughness(0.8, 0, 1), 0.8, 1e-9, '遮罩 0 不变');
  near(xiWetRoughness(0.8, 1, 0.5), 0.54, 1e-9, '半湿粗糙度');
  let sp = xiFaceSdfParams({ x: 0, y: 0, z: 1 });
  assert.ok(sp.theta === 0 && !sp.flipU, '正前方光 θ = 0');
  sp = xiFaceSdfParams({ x: -1, y: 0.3, z: 0 });
  near(sp.theta, 1, 1e-9, '右侧（−X）光 θ = 1');
  assert.equal(sp.flipU, false, '右侧光直接采样');
  sp = xiFaceSdfParams({ x: 1, y: 0, z: 1 });
  near(sp.theta, 0.5, 1e-9, '左前 45° θ = 0.5');
  assert.equal(sp.flipU, true, '左侧（+X）光 u → 1 − u');
  assert.ok(xiFaceSdfParams({ x: 0, y: 0, z: -1 }).theta > 1.99, '背光 θ = 2（全暗）');
  assert.ok(xiFaceLit(0.3, 0.5) && !xiFaceLit(0.6, 0.5), '亮 = θ ≤ sdf');
  assert.ok(XI_SHADOW_TINT[2] > XI_SHADOW_TINT[1] && XI_SHADOW_TINT[1] > XI_SHADOW_TINT[0], '暗部冷色（B > G > R），不偏暖');
  assert.equal(xiMaterialKind('mat-char-xi-face'), 'face');
  assert.equal(xiMaterialKind('mat-env-wood'), null);
  // 跨越几何（制作人拍板：落点离边沿 ≥ 0.30 m）：先把起跳点挪向缝沿（toe 骨仍在台面上），不够再按实际距离缩放路径位移；
  // 路径水平位移 = span · smoothstep(clip 帧 / 48)（XiAnimator 按跨越进度映射 clip 时间：clipT = u · 1.6 s）
  {
    const g = XI_STEP_ACROSS;
    // 美术原设缝 0.5 m：起跳离近沿 0.15 m（toe 骨离沿 ≥ 2.6 cm）、落点离远沿 0.32 m、span 0.97 m
    const sp = stepAcrossSpan(8.5, 1);
    near(sp.start, 8.35, 1e-9, '缝 0.5：起跳离近沿 0.15 m');
    near(sp.end, 9.32, 1e-9, '缝 0.5：落点离远沿 0.32 m');
    near(sp.scale, 0.97 / 0.85, 1e-9, '缝 0.5：位移缩放');
    near(stepAcrossSpan(9, -1, 8.5).end, 8.18, 1e-9, '反向');
    // 窄缝：不缩放（scale 1），起跳内缩不超过美术原设 0.2 m
    const narrow = stepAcrossSpan(0, 1, 0.2);
    near(narrow.scale, 1, 1e-9, '窄缝不缩放');
    near(narrow.takeoffInset, g.gapNearM, 1e-9, '窄缝起跳 0.2 m');
    assert.ok(narrow.landMargin >= g.landMarginM, '窄缝落点余量');
    const mid = stepAcrossSpan(0, 1, 0.35); // 0.85 − 0.35 − 0.32 = 0.18 → 起跳挪到 0.18 m、不缩放
    near(mid.scale, 1, 1e-9, '中缝不缩放');
    near(mid.takeoffInset, 0.18, 1e-9, '中缝起跳内缩');
    for (const gap of [0.1, 0.3, 0.5, 0.8, 1.2]) {
      for (const dir of [1, -1]) {
        const s = stepAcrossSpan(5, dir, 5 + dir * gap);
        assert.ok(s.landMargin >= g.landMarginM - 1e-9 && g.landMarginM >= 0.3, `缝 ${gap}：落点余量 ${s.landMargin}`);
        assert.ok(s.takeoffInset - g.toeLeadM >= g.takeoffToeMarginM - 1e-9, `缝 ${gap}：起跳 toe 悬空`);
        assert.ok(s.scale >= 1 - 1e-9, `缝 ${gap}：只放大不缩小`);
        near(Math.abs(s.end - s.start), g.translateM * s.scale, 1e-9, `缝 ${gap}：span = 0.85·scale`);
      }
    }
    const links = s1StepLinks();
    assert.equal(links.length, 4);
    const lx = S1.linkNear[0];
    const y = S1.nearPlatform.topY;
    let maxErr = 0;
    for (const l of links) {
      assert.ok(l.scale < 1.2, `S1 跨越缩放 ${l.scale} 过大（滑步明显）`);
      const P = (z) => new THREE.Vector3(lx, y, z);
      const tl = new TraversalLink({ start: P(l.start), end: P(l.end), path: [P((l.start + l.end) / 2).setY(y + 0.25)] });
      const v = new THREE.Vector3();
      for (let f = 0; f <= 48; f++) {
        const u = f / 48;
        tl.sample(u, v);
        const along = Math.abs(v.z - l.start);
        maxErr = Math.max(maxErr, Math.abs(along - l.scale * stepAcrossRootZ(u * xiClipDuration('xi-step-across'))));
      }
    }
    assert.ok(maxErr < 1e-6, `跨越路径水平位移偏离 span·smoothstep：${maxErr}`);
    // S1 缝沿：岸台北沿 → 浮台南沿 0.5 m、浮台北沿 → 台阶南沿 0.5 m（= gap.farM − gap.nearM）
    near(S1.raft.slot[2] - S1.raft.size[2] / 2 - S1.nearPlatform.max[1], XI_STEP_ACROSS.gapFarM - XI_STEP_ACROSS.gapNearM, 1e-9, 'S1 近缝宽');
    near(S1.farSteps.z0 - (S1.raft.slot[2] + S1.raft.size[2] / 2), XI_STEP_ACROSS.gapFarM - XI_STEP_ACROSS.gapNearM, 1e-9, 'S1 远缝宽');
    out.push(
      `step-across：缝 0.5 m → 起跳离近沿 0.15 m、落点离远沿 0.32 m、路径位移 ×${links[0].scale.toFixed(3)}（0.97 m）；窄缝不缩放 ✓；S1 四条路径位移 = span·smoothstep(帧/48)（偏差 < 1 µm）✓`,
    );
  }
  near(stepWetness(0, 1, 40), 1, 1e-9, '雨里 40 s 湿透');
  near(stepWetness(1, 0, 75), 0.5, 1e-9, '避雨 150 s 干透');
  {
    const room = [new THREE.Box3(new THREE.Vector3(0, -2.4, 0), new THREE.Vector3(4, 0, 4))];
    assert.ok(isIndoor({ x: 2, y: -2.4, z: 2 }, room), '站在室内地面（探测点脚底 +0.5）算室内');
    assert.equal(xiWetTarget(true, { x: 2, y: -2.4, z: 2 }, room), 0, '室内有雨不淋湿');
    assert.equal(xiWetTarget(true, { x: 6, y: 0, z: 2 }, room), 1, '室外有雨淋湿');
    assert.equal(xiWetTarget(false, { x: 6, y: 0, z: 2 }, room), 0, '无雨不湿');
    assert.equal(xiWetTarget(true, { x: 2, y: 0, z: 2 }, []), 1, '没有室内体积 = 全室外');
    // 室内照常变干：外面淋 20 s 再进屋 75 s
    let w = 0;
    for (let i = 0; i < 20 * 60; i++) w = stepWetness(w, xiWetTarget(true, { x: 6, y: 0, z: 2 }, room), 1 / 60);
    near(w, 0.5, 1e-6, '室外淋 20 s');
    for (let i = 0; i < 75 * 60; i++) w = stepWetness(w, xiWetTarget(true, { x: 2, y: -2.4, z: 2 }, room), 1 / 60);
    near(w, 0, 1e-6, '进室内 75 s 干透');
  }
  out.push('材质：湿痕 ×(1 − 0.22·wet) / 粗糙度 → 0.28、脸 SDF θ / 左右翻转、暗部冷色、淋湿 / 晾干 ✓');
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
  // step-across：美术改成 inPlace:true，保留 translateM 0.85 + smoothstep；缝 near 0.2 / far 0.7
  {
    const ex = j.animations.find((a) => a.name === 'xi-step-across').extras;
    assert.equal(ex.rootMotion.inPlace, true, 'step-across extras.rootMotion.inPlace');
    assert.deepEqual(ex.rootMotion.translateM, [0, 0, XI_STEP_ACROSS.translateM], 'translateM');
    assert.equal(ex.rootMotion.profile, 'smoothstep');
    assert.equal(ex.rootMotion.startFrame, 0);
    assert.equal(ex.rootMotion.endFrame, XI_CLIP_SPECS['xi-step-across'].frames - 1);
    near(ex.gap.nearM, XI_STEP_ACROSS.gapNearM, 1e-6, 'gap.nearM');
    near(ex.gap.farM, XI_STEP_ACROSS.gapFarM, 1e-6, 'gap.farM');
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

  // 材质补丁：真模型三种材质都换上、shader 注入点在 three 0.186 的 chunk 里都找得到、脸有 TEXCOORD_1
  {
    const look = applyXiMaterials(scene, { ramp: new THREE.DataTexture(new Uint8Array(4 * 4), 4, 1), sdf: new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2) });
    const kinds = new Set();
    let faceUv1 = false;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      const kind = xiMaterialKind(m.name);
      assert.ok(kind, `未识别的材质 ${m.name}`);
      kinds.add(kind);
      if (kind === 'face' && o.geometry.getAttribute('uv1')) faceUv1 = true;
      const L = THREE.ShaderLib.physical;
      const sh = { uniforms: {}, defines: {}, vertexShader: L.vertexShader, fragmentShader: L.fragmentShader };
      m.onBeforeCompile(sh);
      assert.ok(sh.fragmentShader.includes('#define RE_Direct RE_Direct_Xi'), `${m.name} ramp 光照注入`);
      assert.ok(sh.fragmentShader.includes('xiWet = texelRoughness.a'), `${m.name} 湿痕注入`);
      assert.ok(sh.uniforms.uXiWetness && sh.uniforms.uXiRamp, `${m.name} uniforms`);
      if (kind === 'face') assert.ok('XI_SDF_FACE' in sh.defines && sh.vertexShader.includes('vXiFaceUv = uv1'), '脸 SDF 注入');
    });
    assert.deepEqual([...kinds].sort(), ['body', 'face', 'hair']);
    assert.equal(look.patched, 3, '三个材质各克隆一份');
    assert.ok(faceUv1, '脸网格有 TEXCOORD_1（SDF UV）');
    look.wetness = 2;
    assert.equal(look.wetness, 1, 'wetness 夹到 [0,1]');
    scene.rotation.y = Math.PI / 2;
    look.update();
    out.push('材质补丁：body / face / hair 三个材质克隆后注入 ramp 光照 + 湿痕、脸 SDF（uv1）✓');
    scene.rotation.y = 0;
    scene.updateMatrixWorld(true);
  }

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
  // 起跳几何依赖第 0 帧前脚 toe 骨在根前 toeLeadM（stepAcrossSpan 用它决定起跳点能挪多近缝沿）
  for (const toe of ['toe_l', 'toe_r']) {
    const tz = scene.getObjectByName(toe).getWorldPosition(new THREE.Vector3()).z;
    assert.ok(tz <= XI_STEP_ACROSS.toeLeadM + 0.01, `step-across 第 0 帧 ${toe} 在根前 ${tz.toFixed(3)} m > toeLeadM`);
  }
  near(scene.getObjectByName('toe_l').getWorldPosition(new THREE.Vector3()).z, XI_STEP_ACROSS.toeLeadM, 0.01, 'step-across 第 0 帧 toe_l 前伸');
  sample(sa, 1.6);
  const f1 = footL.getWorldPosition(new THREE.Vector3());
  const stepNote =
    measured === 0
      ? `原地（extras inPlace:true、hips 首尾差 0、左脚 48 帧回原位 ${(Math.abs(f1.z - f0.z) * 100).toFixed(1)} cm）→ 不抵消，位移全由跨越路径按 span·smoothstep 给`
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
  // 地窖钥匙 prop-key-cellar-s2：extras.attach ↔ 缺省值；grab 帧 22 的 middle_03_r × attach 正好落在架上 socket（不跳）；拿在手里强制 LOD0
  {
    const keyFile = new URL('../../art/models/props/prop-key-cellar-s2.glb', import.meta.url);
    const cellarFile = new URL('../../art/models/env/env-cellar-s2.glb', import.meta.url);
    if (existsSync(keyFile) && existsSync(cellarFile)) {
      const [keyG, cellar] = await Promise.all([parse(keyFile), parse(cellarFile)]);
      const keyRoot = keyG.scene.children.find((o) => o.userData.name === 'prop-key-cellar-s2');
      assert.ok(keyRoot?.userData.attach, '钥匙根节点 prop-key-cellar-s2 带 extras.attach');
      const a = readKeyAttach(keyG.scene);
      assert.ok(a.fromGlb, 'extras.attach 读到');
      a.translation.forEach((v, i) => near(v, XI_KEY_ATTACH.translation[i], 1e-5, `attach.T[${i}]`));
      a.rotation.forEach((v, i) => near(v, XI_KEY_ATTACH.rotation[i], 1e-5, `attach.Q[${i}]`));
      assert.equal(keyRoot.userData.attach.bone, XI_KEY_BONE, 'attach.bone');
      near(keyRoot.userData.attach.atFrame, xiEventSec('xi-pickup-shelf', 'grab') * XI_FPS, 1e-6, 'attach.atFrame = grab 帧');
      assert.ok(!readKeyAttach({}).fromGlb && readKeyAttach({ attach: { translation: [1, 2] } }).translation === XI_KEY_ATTACH.translation, '缺 / 坏 extras → 缺省');
      assert.ok(keyG.scene.getObjectByName('prop-key-cellar-s2-collider'), '碰撞体');
      // LOD：三级组装成 THREE.LOD；setForceLod0 强制 0 级、放下恢复
      const st = buildLods(keyG.scene);
      assert.equal(st.lodGroups, 1, '钥匙 LOD 组');
      applyLodDistances(keyG.scene, [5, 15, 40]);
      let lod = null;
      keyG.scene.traverse((o) => o.isLOD && (lod = o));
      assert.equal(lod.levels.length, 3);
      const cam = new THREE.PerspectiveCamera();
      cam.position.set(0, 0, 30);
      cam.updateMatrixWorld(true);
      keyG.scene.updateMatrixWorld(true);
      lod.update(cam);
      assert.equal(lod.getCurrentLevel(), 2, '30 m 外本来是 LOD2');
      assert.equal(setForceLod0(keyG.scene, true), 1);
      lod.update(cam);
      assert.equal(lod.getCurrentLevel(), 0, 'forceLod0 → LOD0');
      setForceLod0(keyG.scene, false);
      lod.update(cam);
      assert.equal(lod.getCurrentLevel(), 2, '取消 forceLod0 恢复距离');
      // grab 帧：汐站在 shelf-interact（原点、朝 +Z），socket 在它的局部坐标里
      cellar.scene.updateMatrixWorld(true);
      const ix = cellar.scene.getObjectByName('env-cellar-s2-shelf-interact');
      const sock = cellar.scene.getObjectByName('env-cellar-s2-key-socket');
      const sockLocal = ix.matrixWorld.clone().invert().multiply(sock.matrixWorld);
      const grabT = xiInteractEventSec('xi-pickup-shelf');
      near(grabT * XI_FPS, 22, 1e-6, 'grab 帧 22');
      sample(get('xi-pickup-shelf'), grabT);
      const bone = scene.getObjectByName(XI_KEY_BONE);
      const att = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(a.translation), new THREE.Quaternion().fromArray(a.rotation), new THREE.Vector3(1, 1, 1));
      const inHand = bone.matrixWorld.clone().multiply(att);
      const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), p1 = new THREE.Vector3(), q1 = new THREE.Quaternion(), sc = new THREE.Vector3();
      sockLocal.decompose(p0, q0, sc);
      inHand.decompose(p1, q1, sc);
      const jump = p0.distanceTo(p1);
      const ang = (q0.angleTo(q1) * 180) / Math.PI;
      assert.ok(jump <= 0.02 && ang <= 5, `grab 帧钥匙跳动 ${(jump * 100).toFixed(1)} cm / ${ang.toFixed(1)}°`);
      out.push(`地窖钥匙：extras.attach = 缺省 T/Q ✓；grab 帧 22 middle_03_r × attach 对 socket 偏差 ${(jump * 1000).toFixed(1)} mm / ${ang.toFixed(2)}°；LOD 3 级，forceLod0 开 / 关 ✓`);
    }
  }

  // 小船对位（开场演出 035 用）：座位 = xi-row-boat 原点、桨架 = align.rowing、系船站位 = xi-tie-boat 根（桩中心前 0.37 m）
  {
    const boatFile = new URL('../../art/models/props/prop-boat-rowboat.glb', import.meta.url);
    const pierFile = new URL('../../art/models/env/env-pier-wood-ch1.glb', import.meta.url);
    if (existsSync(boatFile) && existsSync(pierFile)) {
      const [boatG, pierG] = await Promise.all([parse(boatFile), parse(pierFile)]);
      const row = clips.find((c) => c.name === 'xi-row-boat').userData.align.rowing;
      const tie = clips.find((c) => c.name === 'xi-tie-boat').userData.align.mooringPost;
      const boat = boatG.scene;
      // 船放到 S1 的摆位上测（世界变换不影响局部关系）
      boat.position.set(5.508, 1.36, -10.757);
      boat.rotation.y = -1.70407;
      boat.updateMatrixWorld(true);
      const seat = rowerSeat(boat);
      assert.ok(seat && oarlock(boat, 'l') && oarlock(boat, 'r') && findArtNode(boat, XI_BOAT_NODES.bowRing), '船上座位 / 桨架 / 船头环节点');
      const xi = new THREE.Group();
      new THREE.Group().add(xi);
      xi.parent.position.set(1, 2, 3);
      xi.parent.rotation.y = 0.4;
      alignXiTo(xi, seat);
      const inv = xi.matrixWorld.clone().invert();
      const toXi = (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      for (const [side, want] of [
        ['l', row.oarlockL],
        ['r', row.oarlockR],
      ]) {
        const p = toXi(oarlock(boat, side));
        p.toArray().forEach((v, i) => near(v, want[i], 0.011, `桨架 ${side} 汐局部[${i}]`));
      }
      near(seat.userData.seatTopAboveOrigin, row.seatTop, 1e-6, '座面高');
      // 汐面朝 +Z = 船尾（船朝 −Z）：船头环在她背后
      assert.ok(toXi(findArtNode(boat, XI_BOAT_NODES.bowRing)).z < -1, '船头在汐背后');
      // 桨角：91 帧、循环首尾一致、方向是单位向量、drive 段桨叶在水里（pitch > 0 = 手柄高）
      assert.equal(row.yawDegPerFrame.length, 91);
      const a0 = rowingAngles(row, 0);
      const a3 = rowingAngles(row, 3);
      near(a0.yawDeg, a3.yawDeg, 1e-9, '桨角循环');
      near(rowingAngles(row, 10 / 30).yawDeg, row.yawDegPerFrame[10], 1e-9, '整帧取值');
      near(rowingAngles(row, 10.5 / 30).pitchDeg, (row.pitchDegPerFrame[10] + row.pitchDegPerFrame[11]) / 2, 1e-9, '帧间插值');
      const d = oarHandleDir(30, 10, 'l');
      near(d.length(), 1, 1e-9, '手柄方向单位');
      assert.ok(d.x < 0 && oarHandleDir(30, 10, 'r').x > 0 && d.z > 0, '左桨手柄朝 −X（向内），右桨镜像，yaw 正 = 手柄朝她前方');
      // 系船：mooring 站位 → 桩中心在正前方 0.37 m、桩顶高出桥面 0.85
      const pier = pierG.scene;
      pier.updateMatrixWorld(true);
      const stand = tieBoatStand(pier);
      assert.ok(stand, '码头系船站位节点');
      alignXiTo(xi, stand);
      const invT = xi.matrixWorld.clone().invert();
      const post = findArtNode(pier, XI_BOAT_NODES.postTop).getWorldPosition(new THREE.Vector3()).applyMatrix4(invT);
      near(post.x, tie.center[0], 0.005, '桩中心 x');
      near(post.z, tie.center[2], 0.005, '桩中心前方 0.37');
      near(post.y, tie.heightAboveDeckM, 0.005, '桩顶高出桥面');
      out.push('小船对位：座位 = xi-row-boat 原点、桨架 = align.rowing ±0.56 / 0.525 / 0.22（≤ 1 cm）、桨角 91 帧循环 / 插值、系船站位桩中心前 0.37 m ✓');
    }
  }

  out.push(
    `char-xi.glb 73 骨 / ${skinned} 个蒙皮网格 / hand_r_socket ✓；anims.glb ${tracks} 条轨道全部绑得上；循环 clip 原地（首尾 < 1 cm）；` +
      `step-across ${stepNote}（漂移 ${(maxDrift * 100).toFixed(1)} cm）；turn ±90° @34 帧、尾段抵消 ✓`,
  );
}

console.log('[verify-xi] ' + out.join('\n[verify-xi] '));
console.log('[verify-xi] 全部通过');
