// 地窖钥匙挂手偏移：xi-pickup-shelf 的 grab 帧（第 22 帧）把 prop-key-cellar-s2 挂到 middle_03_r 时，钥匙根节点在骨骼空间里的固定变换。
//   node art/tools/key-attach-offset.mjs   → 打印 JSON（贴进 build-props-ch1.mjs 的 KEY_ATTACH）
// 钥匙平放姿态 = 根节点对齐 env-cellar-s2-key-socket；socket 相对 shelf-interact（汐的根）在 glTF 本地 [keyRight→-X, 架面, 前方]，旋转相同。
// 读 char-xi-anims.glb（自带骨架），在 grab 帧求骨骼世界矩阵：offset = inverse(bone) × keyRoot。程序挂接时 key.matrix = bone.matrixWorld × offset。
import * as THREE from '../../game/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../../game/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ART = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ART, 'models/characters/char-xi-anims.glb'));
const g = await new Promise((ok, err) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', ok, err));
const CLIP = 'xi-pickup-shelf', BONE = 'middle_03_r';
const ex = g.parser.json.animations.find((a) => a.name === CLIP).extras;
const ks = ex.align.keyShelf, fps = ex.fps ?? 30, frame = ex.eventFrames?.grab ?? 22;
const key = ks.key; // 钥匙中心（架面上）在汐 glTF 本地，[x, 架面 y, z]
const mixer = new THREE.AnimationMixer(g.scene);
mixer.clipAction(g.animations.find((a) => a.name === CLIP)).play();
mixer.setTime(frame / fps);
g.scene.updateMatrixWorld(true);
const bone = g.scene.getObjectByName(BONE);
const keyRoot = new THREE.Matrix4().makeTranslation(key[0], ks.shelfTop ?? key[1], key[2]);
const off = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(keyRoot);
const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
off.decompose(t, q, s);
const r = (v, n = 5) => +v.toFixed(n);
console.log(JSON.stringify({ bone: BONE, clip: CLIP, frame, timeS: r(frame / fps, 4), translation: t.toArray().map((v) => r(v)), rotation: q.toArray().map((v) => r(v)), scale: s.toArray().map((v) => r(v, 4)),
  boneWorldAtGrab: new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).toArray().map((v) => r(v, 4)), keyRootAtGrab: [key[0], ks.shelfTop ?? key[1], key[2]] }));
