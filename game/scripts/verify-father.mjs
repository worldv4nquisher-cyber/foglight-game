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
import { MeshBVH } from "three-mesh-bvh";

const out = [];
let xiCrownRest;
let palmPadM;
let hairRestTop;
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
  assert.ok(
    Array.isArray(al.xiCrownRest) &&
      al.xiCrownRest.length === 3 &&
      al.xiCrownRest.every(Number.isFinite),
    "extras.align.handOnHead.xiCrownRest 是三维点",
  );
  xiCrownRest = al.xiCrownRest;
  palmPadM = al.palmPadM ?? 0;
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
  // r3：头顶点读 char-father-anims.glb extras.align.handOnHead.xiCrownRest（汐根局部、绑定姿势），
  // 在绑定姿势下换到 head 骨局部，之后跟骨骼走
  const crownRest = new THREE.Vector3().fromArray(xiCrownRest);
  const xiSkinned = [];
  xiModel.traverse((o) => o.isSkinnedMesh && xiSkinned.push(o));
  const hairLod0 = xiSkinned.find(
    (o) =>
      o.material?.name === "mat-char-xi-hair" &&
      !/_lod[12]/.test(o.name + (o.parent?.name ?? "")),
  );
  assert.ok(hairLod0, "汐 LOD0 头发蒙皮网格（mat-char-xi-hair）");
  const headIdx = hairLod0.skeleton.bones.indexOf(
    hairLod0.skeleton.getBoneByName("head"),
  );
  assert.ok(headIdx >= 0, "头发网格绑了 head 骨");
  // 绑定（静止）姿势：mixer 还没 update，骨骼在 rest
  scene.updateMatrixWorld(true);
  const restHead = pose(xiHead);
  const crownInHead = xiHead.worldToLocal(
    xiModel.localToWorld(crownRest.clone()),
  );
  const skinnedWorld = (i, v = new THREE.Vector3()) =>
    hairLod0.getVertexPosition(i, v).applyMatrix4(hairLod0.matrixWorld);
  // 绑定姿势下头发网格的最高点 ≈ xiCrownRest（美术量的是同一个头）
  {
    const pos = hairLod0.geometry.attributes.position;
    let top = null;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      skinnedWorld(i, v);
      if (v.distanceTo(restHead) >= 0.35) continue;
      const l = xiModel.worldToLocal(v.clone());
      if (!top || l.y > top.y) top = l;
    }
    hairRestTop = top;
    assert.ok(
      Math.abs(top.y - crownRest.y) < 0.01 &&
        Math.hypot(top.x - crownRest.x, top.z - crownRest.z) < 0.03,
      `xiCrownRest ${crownRest.toArray().map((x) => x.toFixed(4))} 和绑定姿势头发最高点 ${top.toArray().map((x) => x.toFixed(4))} 对不上`,
    );
  }
  // 掌心到头发表面：蒙皮后的 LOD0 头发三角形（head 骨 0.35 m 内）最近点；带符号（按面法线，< 0 = 掌心点在头发里）
  const hairTris = (() => {
    const idx = hairLod0.geometry.index;
    const v = new THREE.Vector3();
    const keep = [];
    for (let t = 0; t < idx.count; t += 3)
      if (skinnedWorld(idx.getX(t), v).distanceTo(restHead) < 0.35)
        keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    return keep;
  })();
  // 父亲右手皮肤顶点（LOD0 skin 网格、主权重在右手 / 右手指骨上）
  const fatherSkin = [];
  fatherModel.traverse(
    (o) =>
      o.isSkinnedMesh &&
      o.material?.name === "mat-char-father-skin" &&
      !/_lod[12]/.test(o.name + (o.parent?.name ?? "")) &&
      fatherSkin.push(o),
  );
  assert.equal(fatherSkin.length, 1, "父亲 LOD0 皮肤蒙皮网格");
  const handMesh = fatherSkin[0];
  const handVerts = (() => {
    const HAND = /^(hand_r|(thumb|index|middle|ring|pinky)_\d+_r)$/;
    const bi = handMesh.geometry.attributes.skinIndex;
    const bw = handMesh.geometry.attributes.skinWeight;
    const keep = [];
    for (let i = 0; i < bi.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++)
        if (
          HAND.test(handMesh.skeleton.bones[bi.getComponent(i, k)]?.name ?? "")
        )
          w += bw.getComponent(i, k);
      if (w > 0.5) keep.push(i);
    }
    return keep;
  })();
  assert.ok(handVerts.length > 50, `父亲右手皮肤顶点 ${handVerts.length}`);
  // 汐 LOD0 皮肤（脸 / 头皮 primitive），量手有没有穿到头皮（美术 measure-father-hoh 同口径）
  const faceLod0 = xiSkinned.find(
    (o) =>
      /face/.test(o.material?.name ?? "") &&
      !/_lod[12]/.test(o.name + (o.parent?.name ?? "")),
  );
  const faceTris = (() => {
    if (!faceLod0) return [];
    const idx = faceLod0.geometry.index;
    const v = new THREE.Vector3();
    const keep = [];
    for (let t = 0; t < idx.count; t += 3)
      if (
        faceLod0
          .getVertexPosition(idx.getX(t), v)
          .applyMatrix4(faceLod0.matrixWorld)
          .distanceTo(restHead) < 0.35
      )
        keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    return keep;
  })();
  // r4 假负核对的头心：xiCrownRest 往下 9 cm（汐根局部、绑定姿势），换到 head 骨局部跟着走（美术 art/tools/measure-father-hoh.mjs 同口径）
  const headCenterInHead = xiHead.worldToLocal(
    xiModel.localToWorld(crownRest.clone().sub(new THREE.Vector3(0, 0.09, 0))),
  );
  // 一张蒙皮网格在 p 附近 R 内的三角形建 BVH：带符号最近距离（按最近三角形面法线，< 0 = 在面后面）+ 假负核对
  const surfaceNear = (mesh, tris, p, R = 0.15) => {
    const cache = new Map();
    const vp = (i) => {
      let w = cache.get(i);
      if (!w) {
        w = mesh
          .getVertexPosition(i, new THREE.Vector3())
          .applyMatrix4(mesh.matrixWorld);
        cache.set(i, w);
      }
      return w;
    };
    const near = [];
    for (let t = 0; t < tris.length; t += 3)
      if (vp(tris[t]).distanceTo(p) < R)
        near.push(tris[t], tris[t + 1], tris[t + 2]);
    if (!near.length) return null;
    const arr = new Float32Array(near.length * 3);
    near.forEach((i, k) => vp(i).toArray(arr, k * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const bvh = new MeshBVH(g);
    const tri = new THREE.Triangle();
    const n = new THREE.Vector3();
    const hit = {};
    const ray = new THREE.Ray();
    const signedTo = (x) => {
      bvh.closestPointToPoint(x, hit);
      const ix = g.index;
      const f = hit.faceIndex * 3;
      tri.a.fromArray(arr, ix ? ix.getX(f) * 3 : f * 3);
      tri.b.fromArray(arr, ix ? ix.getX(f + 1) * 3 : f * 3 + 3);
      tri.c.fromArray(arr, ix ? ix.getX(f + 2) * 3 : f * 3 + 6);
      tri.getNormal(n);
      return hit.distance * (n.dot(x.clone().sub(hit.point)) >= 0 ? 1 : -1);
    };
    // 假负核对（r4 美术）：按面法线定符号在发簇边缘 / 开口发片的边上会翻号。d < 0 的点从头心沿「头心 → 点」往外打一条
    // DoubleSide 射线，外面一层头发都没打到 = 点在全部头发外面 → 记 +|d|
    const checked = (x, d, cen) => {
      if (d >= 0) return d;
      ray.origin.copy(x);
      ray.direction.copy(x).sub(cen).normalize();
      return bvh.raycast(ray, THREE.DoubleSide).length === 0 ? -d : d;
    };
    return { signedTo, checked, dispose: () => g.dispose() };
  };
  const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
  const groupOf = (b) =>
    b === "hand_r"
      ? "palm"
      : (FINGERS.find((f) => b.startsWith(f + "_")) ?? "palm");
  const hairSurface = (p) => {
    hairLod0.updateMatrixWorld(true);
    handMesh.updateMatrixWorld(true);
    const cen = xiHead.localToWorld(headCenterInHead.clone());
    const hs = surfaceNear(hairLod0, hairTris, p);
    const fs = faceTris.length ? surfaceNear(faceLod0, faceTris, p) : null;
    const signedTo = hs.signedTo;
    const raw = {};
    const chk = {};
    for (const k of ["palm", ...FINGERS]) raw[k] = chk[k] = Infinity;
    let skinC = Infinity;
    let falseNeg = 0;
    let scalp = Infinity;
    const vv = new THREE.Vector3();
    const bi0 = handMesh.geometry.attributes.skinIndex;
    for (const i of handVerts) {
      handMesh.getVertexPosition(i, vv).applyMatrix4(handMesh.matrixWorld);
      if (vv.distanceTo(p) > 0.1) continue;
      const d = signedTo(vv);
      const k = groupOf(
        handMesh.skeleton.bones[bi0.getComponent(i, 0)]?.name ?? "",
      );
      const dc = hs.checked(vv, d, cen);
      if (dc !== d) falseNeg++;
      raw[k] = Math.min(raw[k], d);
      chk[k] = Math.min(chk[k], dc);
      skinC = Math.min(skinC, dc);
      if (fs) scalp = Math.min(scalp, fs.signedTo(vv));
    }
    fs?.dispose();
    const extra = { raw, chk, skinC, falseNeg, scalp };
    // r3 原口径（按面法线定符号、未核对）照旧算，作为「核对前」
    // 手皮肤顶点到头发表面带符号距离的最小值（< 0 = 压进头发）
    let skin = Infinity;
    let skinBone = "";
    let palmSkin = Infinity;
    const v = new THREE.Vector3();
    const bi = handMesh.geometry.attributes.skinIndex;
    for (const i of handVerts) {
      handMesh.getVertexPosition(i, v).applyMatrix4(handMesh.matrixWorld);
      if (v.distanceTo(p) > 0.1) continue;
      const d = signedTo(v);
      const bn = handMesh.skeleton.bones[bi.getComponent(i, 0)]?.name ?? "";
      if (bn === "hand_r") palmSkin = Math.min(palmSkin, d);
      if (d < skin) {
        skin = d;
        skinBone = handMesh.skeleton.bones[bi.getComponent(i, 0)]?.name ?? "";
      }
    }
    const r = { d: signedTo(p), skin, skinBone, palmSkin, ...extra };
    hs.dispose();
    return r;
  };
  const surf = new Map();
  const surfHalf = new Map();
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
    // 头顶：美术 extras 的 xiCrownRest（汐局部、绑定姿势）挂在 head 骨上跟着动（不再写死「head 骨 +0.13 m」）
    const crown = xiHead.localToWorld(crownInHead.clone());
    const fr = Math.round(Math.min(actor.time, 6) * 30);
    dist.push([fr, palm().distanceTo(crown)]);
    // 60 Hz 取样 = 整帧 + 半帧：第 i 步后父亲时间 (i+1)/60 s = 第 (i+1)/2 帧（整帧进 surf，半帧一起进 surfHalf）
    const fh = (i + 1) / 2;
    if (actor.time < 6 && fh >= EVENTS.handOn && fh <= EVENTS.handOff) {
      const r = hairSurface(palm());
      surfHalf.set(fh, r);
      if (Number.isInteger(fh)) surf.set(fh, r);
    }
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
  // 蒙皮网格：handOn–handOff 每帧掌心点到头发表面（带符号）；掌心点在手骨 / 中指根中点，皮肤厚度按 extras palmPadM
  const sv = [...surf.entries()].sort((a, b) => a[0] - b[0]);
  assert.equal(
    sv.length,
    EVENTS.handOff - EVENTS.handOn + 1,
    "handOn–handOff 每帧都量了",
  );
  const ds = sv.map(([, r]) => r.d);
  const sMin = Math.min(...ds);
  const sMax = Math.max(...ds);
  const fMin = sv.find(([, r]) => r.d === sMin)[0];
  const fMax = sv.find(([, r]) => r.d === sMax)[0];
  const inside = sv.filter(([, r]) => r.d < 0).length;
  const f80 = surf.get(80)?.d;
  const sk = sv.map(([, r]) => r.skin);
  const skMin = Math.min(...sk);
  const skMax = Math.max(...sk);
  const fSkMin = sv.find(([, r]) => r.skin === skMin)[0];
  const pk = sv.map(([, r]) => r.palmSkin);
  const pkMin = Math.min(...pk);
  const fPkMin = sv.find(([, r]) => r.palmSkin === pkMin)[0];
  const gapFrames = sv.filter(([, r]) => r.skin > 0.005).map(([f]) => f);
  // r4 假负核对：核对前（按面法线定符号）/ 核对后（射线确认在全部头发外面的取 +|d|），整帧和半帧各一份
  const fnSummary = (m) => {
    const rows = [...m.entries()].sort((a, b) => a[0] - b[0]);
    const deepest = (k, c) =>
      rows.reduce(
        (best, [f, r]) =>
          (c ? r.chk : r.raw)[k] < best.v
            ? { v: (c ? r.chk : r.raw)[k], f }
            : best,
        { v: Infinity, f: null },
      );
    const groups = Object.fromEntries(
      ["palm", ...FINGERS].map((k) => [
        k,
        { raw: deepest(k, false), chk: deepest(k, true) },
      ]),
    );
    return {
      n: rows.length,
      groups,
      gapRaw: rows.filter(([, r]) => r.skin > 0.005).length,
      gapChk: rows.filter(([, r]) => r.skinC > 0.005).length,
      falseNegFrames: rows.filter(([, r]) => r.falseNeg > 0).length,
      scalp: rows.filter(([, r]) => r.scalp < 0).length,
      skinChk: rows.reduce(
        (best, [f, r]) => (r.skinC < best.v ? { v: r.skinC, f } : best),
        { v: Infinity, f: null },
      ),
    };
  };
  const fnFull = fnSummary(surf);
  const fnHalf = fnSummary(surfHalf);
  assert.equal(
    fnHalf.n,
    2 * (EVENTS.handOff - EVENTS.handOn) + 1,
    "半帧取样数",
  );
  const cmf = (x) => `${(x.v * 100).toFixed(2)} cm @${x.f}`;
  const fnLine = (t, x) =>
    `${t} ${x.n} 帧：核对前 palm ${cmf(x.groups.palm.raw)} / thumb ${cmf(x.groups.thumb.raw)} → 核对后 palm ${cmf(x.groups.palm.chk)} / thumb ${cmf(x.groups.thumb.chk)}，` +
    `手皮肤最深（核对后）${cmf(x.skinChk)}；有缝帧 ${x.gapRaw}/${x.n} → ${x.gapChk}/${x.n}；有假负顶点的帧 ${x.falseNegFrames}/${x.n}；穿头皮帧 ${x.scalp}/${x.n}`;
  for (const [t, x] of [
    ["整帧", fnFull],
    ["半帧", fnHalf],
  ]) {
    assert.equal(
      x.gapChk,
      0,
      `${t}：核对后手皮肤离头发 > 5 mm 的帧 ${x.gapChk}/${x.n}——手没贴住`,
    );
    assert.equal(
      x.scalp,
      0,
      `${t}：手穿到汐头皮 / 脸皮肤的帧 ${x.scalp}/${x.n}`,
    );
    assert.ok(
      x.skinChk.v > -0.01,
      `${t}：核对后手皮肤压进头发 ${cmf(x.skinChk)}（> 1 cm）`,
    );
  }
  assert.ok(faceLod0, "汐 LOD0 皮肤（face）网格");
  assert.ok(
    sMax < 0.08,
    `掌心点离头发表面最远 ${sMax.toFixed(3)} m（@${fMax}）——手没贴住`,
  );
  assert.ok(
    sMin > -0.02,
    `掌心点进头发 ${(-sMin).toFixed(3)} m（@${fMin}）——穿进头里`,
  );
  actor.hide();
  assert.deepEqual(poses.at(-1), ["clear"], "hide 放掉汐的姿势");
  out.push(
    `hand-on-head 蒙皮网格（汐 LOD0 头发 ${hairTris.length / 3} 面）：xiCrownRest ${xiCrownRest.join(", ")} ↔ 绑定姿势头发最高点 ${hairRestTop
      .toArray()
      .map((x) => x.toFixed(4))
      .join(", ")}；` +
      `handOn–handOff ${sv.length} 帧 掌心点→头发表面 ${sMin.toFixed(3)}（@${fMin}）…${sMax.toFixed(3)} m（@${fMax}），第 80 帧 ${f80?.toFixed(3)} m，掌心点在头发里的帧 ${inside}/${sv.length}（palmPad ${palmPadM} m）；` +
      `右手皮肤 ${handVerts.length} 顶点→头发表面最小值 ${skMin.toFixed(3)}（@${fSkMin} ${surf.get(fSkMin).skinBone}，< 0 = 压进头发）…${skMax.toFixed(3)} m（其中手掌 hand_r 主权重顶点最深 ${pkMin.toFixed(3)} @${fPkMin}；带符号按最近三角形法线，发片交界处符号可能不准），皮肤离头发 > 5 mm 的帧 ${gapFrames.length}/${sv.length}${gapFrames.length ? "（" + gapFrames.join(",") + "）" : ""} ✓`,
  );
  out.push(
    `hand-on-head 假负核对（头心 = xiCrownRest 下 9 cm 跟 head 骨，DoubleSide 射线）：${fnLine("整帧", fnFull)}；${fnLine("半帧", fnHalf)} ✓`,
  );
  out.push(
    `hand-on-head：父亲根 = 汐根·T(0,0,0.48)·R_y(180°)（误差 ${maxAlignErr.toExponential(1)}）；汐时间 = 父亲时间；事件 ${events.map(([e, f]) => `${e}@${f}`).join(" ")}；` +
      `掌心到汐头顶 handOn–handOff 最大 ${maxOn.toFixed(3)} m / 抬手前·放下后最小 ${minOff.toFixed(3)} m ✓`,
  );
} else {
  out.push("（art/ 下没有 char-father*.glb，跳过 GLB 检查）");
}

for (const l of out) console.log("✓ " + l);
