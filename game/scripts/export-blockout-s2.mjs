// 导出 S2 白盒 GLB：art/source/blockout/blockout-s2-keeper-house.glb（v0.1-014 第 9 条）
// 内容：白盒（碰撞 / 墙 / 装饰 / 室内触发体 / 地窖门 / 拨盘铁门 / viewpoint-s2 空节点）+ 谜题 3 灯台 / 镜座 / 光感锁（镜子按正解角度）
// 坐标：S2 场景坐标（1 = 1 m，+Y 上）；viewpoint-s2 的 extras 写眼睛 / 目标 / FOV。用法：npm run export:blockout-s2
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { S2 } from '@/levels/s2/layout';
import { buildS2Greybox } from '@/levels/s2/greybox';
import { buildS2Beam } from '@/levels/s2/beam';

// GLTFExporter 二进制模式要 FileReader（Node 没有）
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => { this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(b).toString('base64'); this.onloadend?.(); });
  }
};

const scene = new THREE.Scene();
scene.name = 'blockout-s2-keeper-house';
const gb = buildS2Greybox();
for (const o of [...gb.colliders, ...gb.decor]) o.visible = true;
scene.add(gb.root);
const beam = buildS2Beam(null);
beam.solve?.();
scene.add(beam.root);
scene.traverse((o) => {
  if (o.name === 'viewpoint-s2') o.userData = { ...o.userData, eye: S2.viewpoint.eye, lookAt: S2.viewpoint.lookAt, fov: S2.viewpoint.fov, toleranceDeg: S2.viewpoint.toleranceDeg, fadeFromDeg: S2.viewpoint.fadeFromDeg };
});
scene.updateMatrixWorld(true);

const out = new URL('../../art/source/blockout/blockout-s2-keeper-house.glb', import.meta.url);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
mkdirSync(dirname(out.pathname), { recursive: true });
writeFileSync(out, Buffer.from(glb));
let n = 0;
scene.traverse(() => n++);
console.log(`✓ ${out.pathname}（${(glb.byteLength / 1024).toFixed(0)} KB，${n} 个节点，含 viewpoint-s2）`);
