#!/usr/bin/env node
// 017 汐动画：Blender 导出的原始动画 GLB（/tmp/xi/char-xi-anims-raw.glb）→ 交付 art/models/characters/char-xi-anims.glb
//   - 只留骨架节点 + 动画（无网格；Blender 带出来的空 skin 删掉）
//   - 去掉「整段都等于该骨骼静止 TRS」的通道（three.js AnimationMixer 对没动画的属性会还原到静止值，所以只能删等于静止值的）
//   - 线性关键帧重采样去冗余（首尾帧保留 → 循环首尾严格相等不受影响）
//   - EXT_meshopt_compression（§5.7）
//   - extras：根节点 { skeleton, fps, inPlace, swingBones, bakedSecondary:true }；每个动画 { loop, frames, strideSpeed, footsteps, rootMotion… }
// 元数据来自 art/source/characters/char-xi-anims.meta.json（build_xi_anims.py 写）。
// 用法：node art/tools/finish-xi-anims.mjs [raw.glb] [out.glb] [--no-fix | --fix=xi-ponytail-hood-fix.json]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample, prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const RAW = ARGS[0] ?? '/tmp/xi/char-xi-anims-raw.glb';
const OUT = ARGS[1] ?? path.resolve(HERE, '../models/characters/char-xi-anims.glb');
// r5：马尾×兜帽纠正（solve-xi-ponytail-hood.mjs 求出的逐帧角度）。--no-fix 不写回（求解器要用未纠正的动画当输入）
const FIX_FILE = process.argv.find((a) => a.startsWith('--fix='))?.slice(6) ?? path.resolve(HERE, '../source/characters/xi-ponytail-hood-fix.json');
const FIX = process.argv.includes('--no-fix') || !fs.existsSync(FIX_FILE) ? null : JSON.parse(fs.readFileSync(FIX_FILE, 'utf8'));
const META = JSON.parse(fs.readFileSync(path.resolve(HERE, '../source/characters/char-xi-anims.meta.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(RAW);
const root = doc.getRoot();
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMeshes()) m.dispose();

// 纠正写回：和求解器同一公式——轴在链根父骨空间给定，逐级换到各骨父空间：q_k' = R(conj(q_0'…q_{k-1}')·axis, a_k) · q_k（四元数 xyzw）
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = (a) => [-a[0], -a[1], -a[2], a[3]];
const qrot = (q, v) => qmul(qmul(q, [...v, 0]), qconj(q)).slice(0, 3);
const qaxis = (v, ang) => { const l = Math.hypot(...v), s = Math.sin(ang / 2) / l; return [v[0] * s, v[1] * s, v[2] * s, Math.cos(ang / 2)]; };
const FIX_CHAINS = [[['hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03'], ['t1', 't2', 't2']], [['hood_01', 'hood_02'], ['h1', 'h2']]];
const fixed = [];
if (FIX) for (const anim of root.listAnimations()) {
  const fc = FIX.clips[anim.getName()]; if (!fc) continue;
  const rot = new Map(anim.listChannels().filter((c) => c.getTargetPath() === 'rotation').map((c) => [c.getTargetNode().getName(), c.getSampler()]));
  for (const [bones, keys] of FIX_CHAINS) {
    const smp = bones.map((b) => rot.get(b));
    if (smp.some((x) => !x)) throw new Error(`纠正：${anim.getName()} 缺 ${bones.join('/')} 的旋转轨道`);
    const outs = smp.map((x) => x.getOutput().getArray().slice()), ins = smp.map((x) => x.getInput().getArray());
    for (let k = 0; k < bones.length; k++) if (ins[k].length !== fc.frames || Math.abs(ins[k][1] - ins[k][0] - 1 / META.fps) > 1e-4) throw new Error(`纠正：${anim.getName()} ${bones[k]} 不是逐帧关键帧（${ins[k].length} 帧，fix ${fc.frames}）`);
    for (let f = 0; f < fc.frames; f++) {
      let acc = [0, 0, 0, 1];
      for (let k = 0; k < bones.length; k++) {
        const q = Array.from(outs[k].subarray(f * 4, f * 4 + 4)), a = fc[keys[k]][f];
        const q2 = a ? qmul(qaxis(qrot(qconj(acc), FIX.axis), a), q) : q;
        outs[k].set(q2, f * 4); acc = qmul(acc, q2);
      }
    }
    smp.forEach((x, k) => x.getOutput().setArray(outs[k]));
  }
  fixed.push(anim.getName());
}
if (FIX) console.log(`马尾×兜帽纠正写回 ${fixed.length} 个 clip：${fixed.join(' ')}`);

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
sceneRoot.setExtras({ skeleton: 'char-xi', fps: META.fps, inPlace: true, forward: '+Z', swingBones: META.swingBones, bakedSecondary: true,
  note: '头发/兜帽/雨衣下摆的轻量摆动已烘焙进各 clip（bakedSecondary）。要换物理：对 swingBones 里的骨骼忽略动画轨道（或把它们从 clip 里过滤掉）再挂弹簧骨骼。见 art/models/characters/README.md。' });
const footsteps = (c) => Object.fromEntries(Object.entries(c ?? {}).map(([s, str]) => [s, [...str].flatMap((ch, i) => (ch !== '-' && str[(i - 1 + str.length) % str.length] === '-' ? [i] : []))]));
for (const anim of root.listAnimations()) {
  const m = META.clips[anim.getName()];
  if (!m) throw new Error('meta 缺 clip ' + anim.getName());
  const ex = { loop: m.loop, frames: m.frames, durationS: m.durationS, fps: META.fps, bakedSecondary: true };
  if (m.gait) Object.assign(ex, { strideSpeed: m.gait.v, strideM: m.strideM, cycleFrames: m.cycleFrames, footsteps: footsteps(m.contacts) });
  if (m.stairs) Object.assign(ex, { strideSpeed: m.horizSpeed, vertSpeed: m.vertSpeed, stairs: { rise: m.stairs.rise, tread: m.stairs.tread, up: m.stairs.up }, footsteps: footsteps(m.contacts) });
  if (m.rootMotion) ex.rootMotion = m.rootMotion;
  if (m.events) {
    if (m.batch >= 2) { ex.events = Object.fromEntries(Object.entries(m.events).map(([k, f]) => [k, +(f / META.fps).toFixed(4)])); ex.eventFrames = m.events; }
    else ex.events = m.events;
  }
  for (const k of ['align', 'gap', 'lanternWorld', 'endsAt', 'startsAt']) if (m[k] != null) ex[k] = m[k];
  if (m.batch >= 2 && m.plant && !m.gait) ex.footsteps = Object.fromEntries(Object.entries(m.plant).map(([s, str]) => [s, [...str].flatMap((c, i) => (i > 0 && c !== '-' && str[i - 1] === '-' ? [i] : []))])); // 第 2 批：从离地（-）到任何触地（F/B/H）的那一帧算一步
  if (fixed.includes(anim.getName())) ex.ponytailHoodFix = true;   // r5：马尾/兜帽轨道含纠正（仍是 bakedSecondary 的一部分）
  if (anim.getName().includes('lantern') || m.lantern) ex.prop = { name: 'prop-lantern-brass', socket: 'hand_r_socket' };
  anim.setExtras(ex);
}
// §5.7：GLB 用 Meshopt（EXT_meshopt_compression，动画数据走 meshopt 的 buffer 压缩，数值无损）
await MeshoptEncoder.ready;
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const sz = fs.statSync(OUT).size;
console.log(`channels kept ${kept}, dropped ${dropped} (= 静止值)`);
console.log(`${OUT}: ${(sz / 1024).toFixed(0)} KB, ${root.listAnimations().length} clips`);
