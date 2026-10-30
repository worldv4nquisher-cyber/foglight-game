// v0.1-031 / BUG-023 父亲接入自检（node，无浏览器）：
//  1. clip 表（src/entities/father/clips.ts）↔ char-father-anims.glb extras：3 个名字、帧数、循环、走路步幅、hand-on-head 事件帧与对位；
//  2. 真 GLTFLoader 解析 char-father.glb + anims：73 骨、3 档蒙皮 LOD → buildLods 组成托管 LOD，applyLodDistances 按画质档设距离（不再是占位 0/1000/2000）；
//     每条轨道按骨骼名绑得上；FatherActor 三段都能播（骨骼姿势随时间变）；
//  3. hand-on-head 与汐：父亲根 = 汐局部 (0, 0, 0.48) 绕 Y 180°（汐根任意摆位 / 朝向都成立）；两人同帧起播，汐 xi-stand-gaze 时间 = 父亲时间；
//     事件 reachStart 20 / handOn 56 / strokeA 66 / strokeB 98 / handOff 136 / armDown 170 按顺序各发一次；父亲停在末帧；
//     真模型：handOn–handOff 之间父亲右手掌心在汐头顶附近，抬手前 / 放下后离得远；
//  4. manifest：char-father / -anims 在 s3 组；size 分组规则把 tex-father-* 归 s3。
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as THREE from "three";
import {
  FATHER_CLIP_SPECS,
  FATHER_CLIP_NAMES,
  FATHER_FPS,
  FATHER_HAND_ON_HEAD,
  FATHER_MODES,
  fatherClipDuration,
  handOnHeadTimes,
  handOnHeadEventsBetween,
  parseFatherMode,
  walkDistance,
} from "@/entities/father/clips";
import {
  FatherActor,
  fatherInXiMatrix,
  FATHER_MODEL_KEY,
  FATHER_ANIMS_KEY,
} from "@/entities/father/FatherActor";
import { xiClipDuration } from "@/entities/xi/clips";
import { buildLods, applyLodDistances, describeLods } from "@/render/lod";
import { manifest as MANIFEST } from "@/assets/manifest";
import { guessGroup } from "./lib/size-groups.mjs";

const out = [];
const near = (a, b, tol, tag) =>
  assert.ok(Math.abs(a - b) <= tol, `${tag}：${a} vs ${b}（容差 ${tol}）`);
const ART = new URL("../../art/models/characters/", import.meta.url);
const glbJson = (file) => {
  const b = readFileSync(file);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
};
const EVENTS = {
  reachStart: 20,
  handOn: 56,
  strokeA: 66,
  strokeB: 98,
  handOff: 136,
  armDown: 170,
};

// ---- 纯逻辑
{
  assert.deepEqual(FATHER_CLIP_NAMES, [
    "father-stand-gaze",
    "father-walk-away",
    "father-hand-on-head",
  ]);
  assert.deepEqual(
    FATHER_CLIP_SPECS["father-hand-on-head"].events,
    EVENTS,
    "事件帧 = 美术 extras / 制作人给的 20/56/66/98/136/170",
  );
  assert.deepEqual(Object.keys(FATHER_MODES), ["gaze", "walk", "hand"]);
  assert.equal(parseFatherMode("hand"), "hand");
  assert.equal(parseFatherMode("toString"), null);
  assert.equal(parseFatherMode(null), null);
  near(
    fatherClipDuration("father-hand-on-head"),
    6,
    1e-9,
    "hand-on-head 6.0 s",
  );
  near(
    xiClipDuration("xi-stand-gaze"),
    6,
    1e-9,
    "xi-stand-gaze 6.0 s（181 帧，两段帧号一一对应）",
  );
  near(fatherClipDuration("father-stand-gaze"), 8, 1e-9, "stand-gaze 8.0 s");
  for (const t of [0, 0.5, 1.8667, 3, 5.99]) {
    const h = handOnHeadTimes(t);
    near(h.father, t, 1e-9, `t=${t} 父亲时间`);
    near(h.xi, t, 1e-9, `t=${t} 汐时间 = 父亲时间（同帧起播）`);
  }
  near(handOnHeadTimes(7.5).father, 6, 1e-9, "父亲 LoopOnce 停末帧");
  near(handOnHeadTimes(7.5).xi, 1.5, 1e-9, "汐 LoopRepeat 继续转");
  for (const [k, f] of Object.entries(EVENTS)) {
    assert.deepEqual(
      handOnHeadEventsBetween((f - 0.5) / 30, (f + 0.5) / 30),
      [k],
      `${k} 在第 ${f} 帧`,
    );
    assert.equal(handOnHeadTimes(f / 30).frame, f);
  }
  assert.deepEqual(
    handOnHeadEventsBetween(-1, 10),
    Object.keys(EVENTS),
    "全程 6 个事件按顺序",
  );
  near(walkDistance(2, 100), 2.6, 1e-9, "走路 1.3 m/s");
  near(walkDistance(10, 5), 3, 1e-9, "到头从起点重来");
  const m = fatherInXiMatrix();
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  near(p.z, 0.48, 1e-12, "父亲根在汐 +Z 0.48");
  const fwd = new THREE.Vector3(0, 0, 1).transformDirection(m);
  near(fwd.z, -1, 1e-12, "父亲面朝汐（−Z）");
  out.push("clip 表 / 事件帧 / 时间轴 / 对位矩阵（纯逻辑）✓");
}

// ---- manifest / 分包
{
  const e = (k) => MANIFEST.find((x) => x.key === k);
  for (const k of [FATHER_MODEL_KEY, FATHER_ANIMS_KEY]) {
    assert.equal(e(k)?.group, "s3", `${k} 在 s3 组`);
    assert.ok(e(k)?.art && e(k)?.optional, `${k} art + optional`);
  }
  for (const n of [
    "char-father.glb",
    "char-father-anims.glb",
    "tex-father-albedo.ktx2",
    "tex-father-normal.ktx2",
    "tex-father-orm.ktx2",
  ])
    assert.equal(guessGroup(n), "s3", `${n} 归 s3`);
  out.push(
    "manifest：char-father / char-father-anims 在 s3；tex-father-* 按规则归 s3 ✓",
  );
}

// ---- GLB extras ↔ clip 表
const animsFile = new URL("char-father-anims.glb", ART);
const modelFile = new URL("char-father.glb", ART);
if (existsSync(animsFile) && existsSync(modelFile)) {
  const j = glbJson(animsFile);
  assert.deepEqual(
    j.animations.map((a) => a.name).sort(),
    [...FATHER_CLIP_NAMES].sort(),
  );
  for (const a of j.animations) {
    const s = FATHER_CLIP_SPECS[a.name];
    assert.equal(a.extras.frames, s.frames, `${a.name} 帧数`);
    assert.equal(a.extras.loop, s.loop, `${a.name} 循环`);
    assert.equal(a.extras.fps, FATHER_FPS);
  }
  const w = j.animations.find((a) => a.name === "father-walk-away").extras;
  assert.equal(
    w.strideSpeed,
    FATHER_CLIP_SPECS["father-walk-away"].strideSpeed,
  );
  assert.equal(
    w.cycleFrames,
    FATHER_CLIP_SPECS["father-walk-away"].cycleFrames,
  );
  const h = j.animations.find((a) => a.name === "father-hand-on-head").extras;
  assert.deepEqual(h.eventFrames, EVENTS, "GLB eventFrames");
  const al = h.align.handOnHead;
  assert.equal(al.xiClip, FATHER_HAND_ON_HEAD.xiClip);
  assert.equal(al.xiStartFrame, FATHER_HAND_ON_HEAD.xiStartFrame);
  assert.deepEqual(al.fatherRootInXiSpace, [
    ...FATHER_HAND_ON_HEAD.fatherRootInXi,
  ]);
  assert.equal(al.fatherYawDegInXiSpace, FATHER_HAND_ON_HEAD.fatherYawDegInXi);
  assert.equal(al.fatherClipFrames, al.xiClipFrames);
  out.push(
    "clip 表 ↔ char-father-anims.glb extras：名字 / 帧数 / 循环 / 步幅 / 事件帧 / handOnHead 对位一致 ✓",
  );

  // ---- 真解析
  globalThis.self ??= globalThis;
  const { GLTFLoader } =
    await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { MeshoptDecoder } =
    await import("three/examples/jsm/libs/meshopt_decoder.module.js");
  const { clone: cloneSkinned } =
    await import("three/examples/jsm/utils/SkeletonUtils.js");
  const ktx2Stub = {
    load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)),
    detectSupport() {},
  };
  const parse = async (file) => {
    const buf = readFileSync(file);
    return new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(ktx2Stub)
      .parseAsync(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        "",
      );
  };
  const [model, anims] = await Promise.all([
    parse(modelFile),
    parse(animsFile),
  ]);
  const clips = anims.animations;
  const bones = [];
  model.scene.traverse((o) => o.isBone && bones.push(o));
  assert.equal(bones.length, 73, "char-father 73 骨");
  // LOD：与 AssetLoader 一样 buildLods（getModel 再 SkeletonUtils.clone），applyLodDistances 设档位距离
  buildLods(model.scene);
  const fatherModel = cloneSkinned(model.scene);
  const lods = [];
  fatherModel.traverse((o) => o.isLOD && lods.push(o));
  assert.equal(lods.length, 1, "一个托管 LOD");
  assert.equal(lods[0].levels.length, 3, "LOD0–2");
  assert.deepEqual(
    lods[0].levels.map((l) => l.distance),
    [0, 1000, 2000],
    "加载后是占位距离（BUG-023 实际现象）",
  );
  for (const l of lods[0].levels) {
    let sk = 0;
    l.object.traverse((o) => o.isSkinnedMesh && sk++);
    assert.ok(sk >= 1, "每档都是蒙皮网格");
  }
  const holder = new THREE.Group();
  holder.add(fatherModel);
  assert.equal(applyLodDistances(holder, [40, 100, 250]), 1);
  assert.deepEqual(
    lods[0].levels.map((l) => l.distance),
    [0, 40, 100],
    "applyLodDistances 后 = 画质档 high",
  );
  assert.equal(describeLods(holder)[0].critical, false);
  // 轨道按名字绑
  let tracks = 0;
  for (const c of clips)
    for (const t of c.tracks) {
      const pn = THREE.PropertyBinding.parseTrackName(t.name);
      assert.ok(
        THREE.PropertyBinding.findNode(fatherModel, pn.nodeName),
        `${c.name} 轨道 ${t.name} 绑不上`,
      );
      tracks++;
    }
  out.push(
    `真模型：73 骨、LOD0–2 蒙皮、applyLodDistances 设上（[0,1000,2000] → [0,40,100]）；${tracks} 条轨道都按骨骼名绑上 ✓`,
  );

  // 三段都能播：FatherActor
  const actor = new FatherActor(fatherModel, clips);
  assert.deepEqual(actor.missing, []);
  const scene = new THREE.Scene();
  scene.add(actor.root);
  const handR = fatherModel.getObjectByName("hand_r");
  const footL = fatherModel.getObjectByName("foot_l");
  const pose = (b) => b.getWorldPosition(new THREE.Vector3());
  const fatherBones = [];
  fatherModel.traverse((o) => o.isBone && fatherBones.push(o));
  // 动没动：全身骨骼局部旋转相对起播帧的最大转角（度）+ 采样骨相对根的最大位移
  const moved = (mode, start, sample) => {
    start();
    assert.equal(actor.mode, mode);
    assert.equal(actor.root.visible, true);
    actor.update(0);
    scene.updateMatrixWorld(true);
    const q0 = fatherBones.map((b) => b.quaternion.clone());
    const a0 = pose(sample).sub(actor.root.position);
    let max = 0;
    let rot = 0;
    for (let i = 0; i < 120; i++) {
      actor.update(1 / 30);
      scene.updateMatrixWorld(true);
      max = Math.max(max, pose(sample).sub(actor.root.position).distanceTo(a0));
      fatherBones.forEach(
        (b, k) =>
          (rot = Math.max(rot, (b.quaternion.angleTo(q0[k]) * 180) / Math.PI)),
      );
    }
    return { max, rot };
  };
  const gaze = moved(
    "gaze",
    () =>
      actor.playGaze({
        position: new THREE.Vector3(1, 22, 2),
        facing: new THREE.Vector3(0, 0, 1),
      }),
    handR,
  );
  assert.ok(gaze.rot > 1, `gaze 在动（骨骼最大转角 ${gaze.rot.toFixed(2)}°）`);
  near(actor.clipTime, 4, 0.02, "gaze 4 s 时 clip 时间");
  const walk = moved(
    "walk",
    () =>
      actor.playWalk(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 3, 50)),
    footL,
  );
  assert.ok(walk.max > 0.3, `walk 迈腿（左脚相对根 ${walk.max.toFixed(3)} m）`);
  near(actor.root.position.z, 4 * 1.3, 0.05, "walk 根按 1.3 m/s 前进");
  near(actor.root.rotation.y, 0, 1e-9, "walk 面朝 +Z（to 的方向）");
  actor.hide();
  assert.equal(actor.root.visible, false);
  assert.equal(actor.mode, null);
  out.push(
    `三段都能播：gaze 骨骼最大转角 ${gaze.rot.toFixed(2)}°、walk 左脚相对根 ${walk.max.toFixed(3)} m 且根 1.3 m/s、hand 见下 ✓`,
  );

  // ---- hand-on-head × 汐
  const xiModelFile = new URL("char-xi.glb", ART);
  const xiAnimsFile = new URL("char-xi-anims.glb", ART);
  const [xm, xa] = await Promise.all([parse(xiModelFile), parse(xiAnimsFile)]);
  buildLods(xm.scene);
  const xiModel = cloneSkinned(xm.scene);
  // 汐挂在一个任意摆位 / 朝向的父节点下（模拟 S3 frame 135° + 角色朝向）
  const xiParent = new THREE.Group();
  xiParent.position.set(39.73, 22.02, -122.75);
  xiParent.rotation.y = 2.1;
  xiParent.add(xiModel);
  const frame = new THREE.Group();
  frame.position.set(39.73, 0, -122.75);
  frame.rotation.y = (135 * Math.PI) / 180;
  scene.add(frame, xiParent);
  frame.add(actor.root);
  const xiMixer = new THREE.AnimationMixer(xiModel);
  const xiGaze = xiMixer.clipAction(
    xa.animations.find((c) => c.name === "xi-stand-gaze"),
  );
  xiGaze.play();
  xiGaze.timeScale = 0;
  const poses = [];
  const fakeAnimator = {
    has: (n) => n === "xi-stand-gaze",
    setPose: (n, t) => poses.push([n, t]),
    clearPose: () => poses.push(["clear"]),
  };
  const events = [];
  actor.onEvent = (e) => events.push([e, Math.round(actor.time * 30)]);
  actor.playHandOnHead({ model: xiModel, animator: fakeAnimator });
  assert.deepEqual(poses[0], ["xi-stand-gaze", 0], "汐同帧从第 0 帧起播");
  const xiHead = xiModel.getObjectByName("head");
  assert.ok(xiHead, "汐 head 骨");
  const palm = () => {
    // 掌心 ≈ 手骨与中指根的中点
    const a = pose(handR);
    const b = fatherModel.getObjectByName("middle_01_r");
    return b ? a.add(pose(b)).multiplyScalar(0.5) : a;
  };
  const dist = [];
  let maxAlignErr = 0;
  let maxSyncErr = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 7.5 * 60; i++) {
    actor.update(dt);
    const [, xt] = poses.at(-1);
    xiGaze.time = xt; // 汐那边由 XiAnimator.setPose 取；这里直接写
    xiMixer.update(0);
    scene.updateMatrixWorld(true);
    // 对位：父亲根世界矩阵 = 汐根世界矩阵 · T(0,0,0.48)·R_y(180°)
    const want = xiModel.matrixWorld.clone().multiply(fatherInXiMatrix());
    const got = actor.root.matrixWorld;
    for (let k = 0; k < 16; k++)
      maxAlignErr = Math.max(
        maxAlignErr,
        Math.abs(want.elements[k] - got.elements[k]),
      );
    if (actor.time < 6)
      maxSyncErr = Math.max(maxSyncErr, Math.abs(xt - actor.clipTime));
    // 头顶：head 骨往上 ~0.13 m 的头顶点（汐局部 +Y）
    const crown = pose(xiHead).add(
      new THREE.Vector3(0, 0.13, 0).applyQuaternion(
        xiModel.getWorldQuaternion(new THREE.Quaternion()),
      ),
    );
    dist.push([
      Math.round(Math.min(actor.time, 6) * 30),
      palm().distanceTo(crown),
    ]);
  }
  assert.ok(maxAlignErr < 1e-5, `父亲根对位误差 ${maxAlignErr}`);
  assert.ok(maxSyncErr < 1e-9, `汐 / 父亲时间差 ${maxSyncErr}`);
  assert.deepEqual(events, Object.entries(EVENTS), "事件按帧各发一次");
  near(actor.clipTime, 6, 1e-9, "父亲停在末帧");
  const at = (lo, hi) =>
    dist.filter(([f]) => f >= lo && f <= hi).map(([, d]) => d);
  const on = at(EVENTS.handOn, EVENTS.handOff);
  const before = at(0, EVENTS.reachStart);
  const after = at(EVENTS.armDown, 180);
  const maxOn = Math.max(...on);
  const minOff = Math.min(...before, ...after);
  assert.ok(
    maxOn < 0.12,
    `handOn–handOff 掌心离汐头顶 ≤ ${maxOn.toFixed(3)} m（< 0.12）`,
  );
  assert.ok(
    minOff > 0.3,
    `抬手前 / 放下后掌心离汐头顶 ≥ ${minOff.toFixed(3)} m（> 0.3）`,
  );
  actor.hide();
  assert.deepEqual(poses.at(-1), ["clear"], "hide 放掉汐的姿势");
  out.push(
    `hand-on-head：父亲根 = 汐根·T(0,0,0.48)·R_y(180°)（误差 ${maxAlignErr.toExponential(1)}）；汐时间 = 父亲时间；事件 ${events.map(([e, f]) => `${e}@${f}`).join(" ")}；` +
      `掌心到汐头顶 handOn–handOff 最大 ${maxOn.toFixed(3)} m / 抬手前·放下后最小 ${minOff.toFixed(3)} m ✓`,
  );
} else {
  out.push("（art/ 下没有 char-father*.glb，跳过 GLB 检查）");
}

for (const l of out) console.log("✓ " + l);
