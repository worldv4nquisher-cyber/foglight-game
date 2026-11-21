#!/usr/bin/env node
// 031 父亲动画：Blender 导出的原始动画 GLB（/tmp/father/anim/char-father-anims-raw.glb）→ 交付 art/models/characters/char-father-anims.glb
//   做法同 finish-xi-anims.mjs（汐的规范）：只留骨架节点 + 动画；删「整段等于静止 TRS」的通道；线性重采样；EXT_meshopt_compression
//   extras：根节点 { skeleton:'char-xi', rig:'char-father', fps, inPlace, forward:'+Z', swingBones, bakedSecondary:true }
//           每个 clip { loop, frames, durationS, fps, bakedSecondary, strideSpeed/strideM/cycleFrames/footsteps（走路）, events(秒)/eventFrames, align }
// 元数据来自 art/source/characters/char-father-anims.meta.json（build_father_anims.py 写）。
// 用法：node art/tools/finish-father-anims.mjs [raw.glb] [out.glb]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = process.argv[2] ?? '/tmp/father/anim/char-father-anims-raw.glb';
const OUT = process.argv[3] ?? path.resolve(HERE, '../models/characters/char-father-anims.glb');
const META = JSON.parse(fs.readFileSync(path.resolve(HERE, '../source/characters/char-father-anims.meta.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(RAW);
const root = doc.getRoot();
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMeshes()) m.dispose();

const EPS = { translation: 1e-5, rotation: 1e-5, scale: 1e-5 };
let dropped = 0, kept = 0;
for (const anim of root.listAnimations()) {
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), p = ch.getTargetPath(), out = ch.getSampler().getOutput().getArray();
    const rest = p === 'translation' ? node.getTranslation() : p === 'rotation' ? node.getRotation() : p === 'scale' ? node.getScale() : null;
    if (!rest) continue;
    const n = rest.length; let same = true;
    for (let i = 0; i < out.length && same; i += n) {
      let d = 0, dn = 0;
      for (let k = 0; k < n; k++) { d = Math.max(d, Math.abs(out[i + k] - rest[k])); dn = Math.max(dn, Math.abs(out[i + k] + rest[k])); }
      if (Math.min(d, p === 'rotation' ? dn : d) > EPS[p]) same = false;
    }
    if (same) { ch.getSampler().dispose(); ch.dispose(); dropped++; } else kept++;
  }
}
await doc.transform(resample({ tolerance: 1e-5 }), dedup(), prune({ keepLeaves: true, keepAttributes: false }));

const sceneRoot = root.listScenes()[0].listChildren()[0];
sceneRoot.setExtras({ skeleton: 'char-xi', rig: 'char-father', fps: META.fps, inPlace: true, forward: '+Z', swingBones: META.swingBones, bakedSecondary: true,
  note: '父亲骨架 = 汐的 73 骨命名（比例不同，静止 TRS 以 char-father.glb 为准，只能绑 char-father.glb）。雨衣片/兜帽的摆动和「雨衣跟腿」已烘焙进各 clip。见 art/models/characters/README-031.md。' });
const footsteps = (c) => Object.fromEntries(Object.entries(c ?? {}).map(([s, str]) => [s, [...str].flatMap((ch, i) => (ch !== '-' && str[(i - 1 + str.length) % str.length] === '-' ? [i] : []))]));
for (const anim of root.listAnimations()) {
  const m = META.clips[anim.getName()];
  if (!m) throw new Error('meta 缺 clip ' + anim.getName());
  const ex = { loop: m.loop, frames: m.frames, durationS: m.durationS, fps: META.fps, bakedSecondary: true };
  if (m.gait) Object.assign(ex, { strideSpeed: m.gait.v, strideM: m.strideM, cycleFrames: m.cycleFrames, footsteps: footsteps(m.contacts) });
  if (m.events) { ex.events = Object.fromEntries(Object.entries(m.events).map(([k, f]) => [k, +(f / META.fps).toFixed(4)])); ex.eventFrames = m.events; }
  if (m.align) ex.align = m.align;
  anim.setExtras(ex);
}
await MeshoptEncoder.ready;
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const sz = fs.statSync(OUT).size;
console.log(`channels kept ${kept}, dropped ${dropped} (= 静止值)`);
console.log(`${OUT}: ${(sz / 1024).toFixed(0)} KB, ${root.listAnimations().length} clips`);
