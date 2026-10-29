// 导出 S3 白盒 GLB：art/source/blockout/blockout-s3-lighthouse.glb（v0.1-015 交付物）
// 内容：白盒（塔壁 / 108 级楼梯 / 灯室地板 + 矮墙 / 门外平台 / 石桥 / 空气墙 / 室内触发体 / 塔门合页 + 门扇）
//      + 谜题 5 三面镜子（按正解角度）/ 点火口 + 关键空节点（光路、站位、交互点，名字同美术 020）
// 坐标：S3 局部（塔心 = 原点，1 = 1 m，+Y 上；世界摆位见 layout.ts S3_FRAME），方便美术直接和 020 的 GLB 叠在一起对位。
// 用法：npm run export:blockout-s3
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { S3 } from '@/levels/s3/layout';
import { buildS3Greybox, defaultS3GreyboxMaterials } from '@/levels/s3/greybox';
import { buildS3Beam } from '@/levels/s3/beam';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => { this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(b).toString('base64'); this.onloadend?.(); });
  }
};

const scene = new THREE.Scene();
scene.name = 'blockout-s3-lighthouse';
const gb = buildS3Greybox(defaultS3GreyboxMaterials());
for (const o of [...gb.colliders, ...gb.decor]) o.visible = true;
scene.add(gb.root);
const beam = buildS3Beam(null, scene);
beam.solve();
const P = S3.points;
const nodes = {
  'spawn-from-s2': P.spawnFromS2,
  'bridge-head': P.bridgeHead,
  'tide-bell-s3-socket': P.bellSocket,
  'tide-bell-s3-interact': P.bellInteract,
  'oil-valve-s3-socket': P.oilValve,
  'logbook-s3-read': P.logbookRead,
  'look-up-point': P.lookUp,
  'stair-platform-5m-view': P.view5m,
  'platform-a': P.platformA,
  'platform-b': P.platformB,
  'stair-top': P.stairTop,
  'lamp-room-arrive': P.lampRoomArrive,
  'ignite-lever-socket': S3.igniteLever.pivot,
  'ignite-lever-interact': S3.igniteLever.interact,
  'ignition-note-read': P.noteRead,
  'lamp-light-origin': P.lampLightOrigin,
  'fresnel-lens-socket': P.lensSocket,
  ...Object.fromEntries(S3.lightPath.map((p, i) => [`lightpath-${i}`, p])),
};
const marks = new THREE.Group();
marks.name = 's3-nodes';
for (const [name, p] of Object.entries(nodes)) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(p[0], p[1], p[2]);
  marks.add(o);
}
scene.add(marks);
scene.updateMatrixWorld(true);

const out = new URL('../../art/source/blockout/blockout-s3-lighthouse.glb', import.meta.url);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
mkdirSync(dirname(out.pathname), { recursive: true });
writeFileSync(out, Buffer.from(glb));
let n = 0;
scene.traverse(() => n++);
console.log(`✓ ${out.pathname}（${(glb.byteLength / 1024).toFixed(0)} KB，${n} 个节点）`);
