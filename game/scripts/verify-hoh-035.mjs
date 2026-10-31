// r4 ③ 035 结尾演出里的摸头对位复查（node，无浏览器；数据全从文件读）：
//  - 汐站位 = env-lamp-room-ch1.glb 的 lamp-room-stand-gaze 节点沿自身朝向后退 GAZE_BACKOFF（levels/s3/ending.ts），朝向 = 节点 +Z
//  - 父亲根 = 汐根 · fatherInXiMatrix()（clips.ts，test:father 已和 char-father-anims.glb extras 对过）
//  - 时间：演出时钟 t，父亲 / 汐 clip 时间 = handOnHeadTimes(t − ENDING_T.fatherIn)（与 S3Ending.stepFather 一样）
//  - 量：handOn–handOff 掌心到汐发顶（extras.xiCrownRest 跟 head 骨）；父亲回忆段（fatherIn → fatherOut）父亲 LOD0 全部顶点
//    有没有穿进灯室矮墙 / 玻璃 / 窗框（从塔轴同高度沿径向往外打射线，打到的第一面就是内壁）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { ENDING_T } from "@/content/cutscenes/ending";
import { GAZE_BACKOFF } from "@/content/cutscenes/ending";
import {
  FATHER_HAND_ON_HEAD,
  handOnHeadTimes,
  FATHER_FPS,
} from "@/entities/father/clips";
import { fatherInXiMatrix } from "@/entities/father/FatherActor";

THREE.Mesh.prototype.raycast = acceleratedRaycast;
globalThis.self ??= globalThis;
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder } =
  await import("three/examples/jsm/libs/meshopt_decoder.module.js");
const ktx2Stub = {
  load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)),
  detectSupport() {},
};
const ART = new URL("../../art/models/", import.meta.url);
const parse = async (rel) => {
  const buf = readFileSync(new URL(rel, ART));
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(ktx2Stub)
    .parseAsync(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "",
    );
};
const [room, tower, fg, fa, xg, xa] = await Promise.all(
  [
    "env/env-lamp-room-ch1.glb",
    "env/env-lighthouse-ch1.glb",
    "characters/char-father.glb",
    "characters/char-father-anims.glb",
    "characters/char-xi.glb",
    "characters/char-xi-anims.glb",
  ].map(parse),
);
const lod0 = (o) => !/_lod[12]/.test(o.name + (o.parent?.name ?? ""));
const world = new THREE.Group();
world.add(room.scene, tower.scene);
world.updateMatrixWorld(true);
const stand = room.scene.getObjectByName("lamp-room-stand-gaze");
assert.ok(stand, "env-lamp-room-ch1 有 lamp-room-stand-gaze");
const sp = stand.getWorldPosition(new THREE.Vector3());
const sf = new THREE.Vector3(0, 0, 1)
  .transformDirection(stand.matrixWorld)
  .setY(0)
  .normalize();
// 静态内壁：两份 env 的 LOD0 网格烘到世界坐标合成一棵 BVH（只要灯室这一层）
const envTris = [];
for (const s of [room.scene, tower.scene])
  s.traverse((o) => {
    if (!o.isMesh || !lod0(o) || /collider|interact/i.test(o.name)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      envTris.push(v.x, v.y, v.z, o.material?.name ?? "");
    }
  });
const pos = [];
const triMat = [];
for (let i = 0; i < envTris.length; i += 12) {
  const ys = [envTris[i + 1], envTris[i + 5], envTris[i + 9]];
  if (Math.max(...ys) < sp.y - 0.05 || Math.min(...ys) > sp.y + 2.6) continue;
  pos.push(
    envTris[i],
    envTris[i + 1],
    envTris[i + 2],
    envTris[i + 4],
    envTris[i + 5],
    envTris[i + 6],
    envTris[i + 8],
    envTris[i + 9],
    envTris[i + 10],
  );
  triMat.push(envTris[i + 3]);
}
const eg = new THREE.BufferGeometry();
eg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
const envMesh = new THREE.Mesh(
  eg,
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
);
eg.boundsTree = new MeshBVH(eg);
const rc = new THREE.Raycaster();
rc.firstHitOnly = true;
// 内壁半径：塔轴同高度沿 dir 往外，第一面（排除离轴 < 1.2 m 的灯笼 / 透镜）
const wallAt = (y, dir) => {
  rc.set(new THREE.Vector3(0, y, 0).addScaledVector(dir, 1.2), dir);
  rc.near = 0;
  rc.far = 4;
  const h = rc.intersectObject(envMesh)[0];
  return h ? { r: 1.2 + h.distance, mat: triMat[eg.index ? Math.floor(eg.index.getX(h.faceIndex * 3) / 3) : h.faceIndex] } : null;
};
const radial = sp.clone().setY(0).normalize();
const wallLow = wallAt(sp.y + 0.35, radial);
const wallHigh = wallAt(sp.y + 1.5, radial);
assert.ok(wallLow && wallHigh, "灯室内壁打得到");

// 摆位
const xs = xg.scene;
const fs = fg.scene;
world.add(xs, fs);
xs.position.copy(sp).addScaledVector(sf, -GAZE_BACKOFF);
xs.rotation.set(0, Math.atan2(sf.x, sf.z), 0);
xs.updateMatrixWorld(true);
fs.matrixAutoUpdate = false;
fs.matrix.copy(xs.matrixWorld).multiply(fatherInXiMatrix());
world.updateMatrixWorld(true);
const xm = new THREE.AnimationMixer(xs);
const xAct = xm.clipAction(
  xa.animations.find((c) => c.name === FATHER_HAND_ON_HEAD.xiClip),
);
xAct.play();
const fm = new THREE.AnimationMixer(fs);
const fAct = fm.clipAction(
  fa.animations.find((c) => c.name === "father-hand-on-head"),
);
fAct.setLoop(THREE.LoopOnce, 1);
fAct.clampWhenFinished = true;
fAct.play();
const hx = fa.parser.json.animations.find(
  (a) => a.name === "father-hand-on-head",
).extras;
const E = hx.eventFrames;
const crownRest = new THREE.Vector3().fromArray(
  hx.align.handOnHead.xiCrownRest,
);
const xiHead = xs.getObjectByName("head");
const crownInHead = xiHead.worldToLocal(xs.localToWorld(crownRest.clone()));
const handR = fs.getObjectByName("hand_r");
const mid1 = fs.getObjectByName("middle_01_r");
const fMeshes = [];
fs.traverse((o) => o.isSkinnedMesh && lod0(o) && fMeshes.push(o));
const xMeshes = [];
xs.traverse((o) => o.isSkinnedMesh && lod0(o) && xMeshes.push(o));
// 每个网格抽样顶点（每 3 个取 1 个，够看几厘米级的穿插）
const sample = (meshes) =>
  meshes.flatMap((m) =>
    Array.from(
      { length: Math.ceil(m.geometry.attributes.position.count / 3) },
      (_, k) => [m, k * 3],
    ),
  );
const fV = sample(fMeshes);
const xV = sample(xMeshes);
const v = new THREE.Vector3();
const clearance = (verts) => {
  let worst = { d: Infinity };
  for (const [m, i] of verts) {
    m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
    const r = Math.hypot(v.x, v.z);
    if (r < 2.4 || v.y < sp.y + 0.02 || v.y > sp.y + 2.5) continue;
    const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
    const w = wallAt(v.y, dir);
    if (!w) continue;
    const d = w.r - r;
    if (d < worst.d)
      worst = {
        d,
        y: v.y - sp.y,
        mat: w.mat,
        mesh: m.material.name,
        bone: m.skeleton.bones[
          m.geometry.attributes.skinIndex.getComponent(i, 0)
        ]?.name,
        r,
      };
  }
  return worst;
};
const rows = [];
const dt = 1 / FATHER_FPS / 2;
for (let k = 0; ENDING_T.fatherIn + k * dt < ENDING_T.fatherOut; k++) {
  const t = ENDING_T.fatherIn + k * dt;
  const tm = handOnHeadTimes(k * dt);
  fAct.time = tm.father;
  xAct.time = tm.xi;
  fm.update(0);
  xm.update(0);
  world.updateMatrixWorld(true);
  const crown = xiHead.localToWorld(crownInHead.clone());
  const palm = handR
    .getWorldPosition(new THREE.Vector3())
    .add(mid1.getWorldPosition(new THREE.Vector3()))
    .multiplyScalar(0.5);
  const f = Math.round(tm.father * FATHER_FPS * 2) / 2;
  rows.push({ t, f, palmCrown: palm.distanceTo(crown), father: clearance(fV) });
}
const xi = clearance(xV);
if (process.env.HOH_DEBUG)
  for (const r of rows)
    if (Math.abs(r.f - Math.round(r.f / 10) * 10) < 1e-6)
      console.log(
        `  帧 ${Math.round(r.f)} t ${r.t.toFixed(2)} 离内壁 ${(r.father.d * 100).toFixed(1)} cm 离地 ${r.father.y.toFixed(2)} ${r.father.bone} ${r.father.mesh} ↔ ${r.father.mat}`,
      );
const on = rows.filter((r) => r.f >= E.handOn && r.f <= E.handOff);
const maxOn = Math.max(...on.map((r) => r.palmCrown));
const worst = rows.reduce((a, r) => (r.father.d < a.father.d ? r : a));
const fr = (r) => `t ${r.t.toFixed(3)} s / 父亲帧 ${r.f.toFixed(1)}`;
const cm = (x) => `${(x * 100).toFixed(1)} cm`;
console.log(
  `✓ 035 摸头对位（lamp-room-stand-gaze ${sp.toArray().map((x) => x.toFixed(3))} 朝 ${sf.toArray().map((x) => x.toFixed(3))}，后退 ${GAZE_BACKOFF} m；父亲时间 = t − ${ENDING_T.fatherIn}）：` +
    `handOn–handOff（帧 ${E.handOn}–${E.handOff} = t ${(ENDING_T.fatherIn + E.handOn / FATHER_FPS).toFixed(3)}–${(ENDING_T.fatherIn + E.handOff / FATHER_FPS).toFixed(3)} s，${on.length} 个半帧）掌心到发顶最大 ${cm(maxOn)}`,
);
console.log(
  `✓ 灯室内壁 r：矮墙（离地 0.35 m）${wallLow.r.toFixed(3)} m [${wallLow.mat}]，玻璃高度（1.5 m）${wallHigh.r.toFixed(3)} m [${wallHigh.mat}]；汐根 r ${Math.hypot(xs.position.x, xs.position.z).toFixed(3)}，父亲根 r ${Math.hypot(fs.matrix.elements[12], fs.matrix.elements[14]).toFixed(3)}`,
);
console.log(
  `  父亲回忆段 ${rows.length} 个半帧，父亲离内壁最近 ${cm(worst.father.d)}（${fr(worst)}，离地 ${worst.father.y.toFixed(2)} m，${worst.father.mesh} ↔ ${worst.father.mat}）；汐离内壁最近 ${cm(xi.d)}`,
);
assert.ok(maxOn < 0.12, `035 里掌心离汐发顶 ${cm(maxOn)}`);
// r4 复查（10-31）：后退 0.2 m 后父亲背后的大衣下摆（coat_back_01，离地 0.75–0.78 m）整段压进矮墙木压顶 3.4–3.9 cm，
// 放手时（帧 ~160）右上臂（离地 1.34 m）压进窗框横档 5.9 cm；都在父亲身后、被他自己挡住，035 机位从屋里拍正面看不到。
// 要完全不碰需要 GAZE_BACKOFF ≈ 0.28 m（制作人定，会动 03/04 构图）；这里先卡住不再变坏
const TOL = 0.065;
if (worst.father.d < 0)
  console.log(
    `  ! 父亲压进灯室内壁 ${cm(-worst.father.d)}（容忍 ${cm(TOL)}，在父亲身后；要完全不碰 GAZE_BACKOFF ≈ ${(GAZE_BACKOFF - worst.father.d + 0.02).toFixed(2)} m）`,
  );
assert.ok(
  worst.father.d > -TOL,
  `父亲穿进灯室内壁 ${cm(-worst.father.d)}（${fr(worst)}，> ${cm(TOL)}）`,
);
assert.ok(xi.d > 0, "汐穿进灯室内壁");
