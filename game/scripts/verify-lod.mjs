// LOD / puzzleCritical 校验脚本：走真实 GLTFLoader 解析测试 GLB → buildLods → 三档距离逐一验证。
// 用法：npm run test:lod（需要 Node ≥ 22.18，直接导入 .ts 源码）
//
// 带文件参数时改为「GLB 交付自检」（美术交付前跑，规则见 docs/tasks/v0.1-index.md §5、scripts/lib/glb-audit.mjs）：
//   node scripts/verify-lod.mjs <a.glb> [b.glb ...] [--budget=8000] [--json]
//   检查 LOD 层级与各级三角面、puzzleCritical、-collider / -interact 等特殊节点、COLOR_0 平滑法线、面数预算、材质与贴图。
//   有错误退出码 1；只有警告退出码 0。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyLodDistances, buildLods, describeLods, isPuzzleCritical, markPuzzleCritical } from '../src/render/lod.ts';
import { QUALITY_PRESETS } from '../src/config/quality.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- 文件模式：node scripts/verify-lod.mjs <文件...>
const fileArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (fileArgs.length) {
  const { auditGlb, printReport } = await import('./lib/glb-audit.mjs');
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const budgetFlag = flags.find((f) => f.startsWith('--budget='));
  const budget = budgetFlag ? Number(budgetFlag.slice('--budget='.length)) : undefined;
  if (budgetFlag && !(budget > 0)) {
    console.error(`--budget 需要正整数：${budgetFlag}`);
    process.exit(2);
  }
  const unknown = flags.filter((f) => f !== '--json' && !f.startsWith('--budget='));
  if (unknown.length) {
    console.error(`未知参数：${unknown.join(' ')}（支持 --budget=N、--json）`);
    process.exit(2);
  }
  let allOk = true;
  const reports = [];
  for (const f of fileArgs) {
    try {
      const r = await auditGlb(resolve(process.env.INIT_CWD ?? process.cwd(), f), { budget });
      reports.push(r);
      if (!flags.includes('--json')) allOk = printReport(r) && allOk;
      else allOk = r.errors.length === 0 && allOk;
    } catch (err) {
      allOk = false;
      reports.push({ file: f, errors: [String(err?.message ?? err)], warnings: [], info: [] });
      if (!flags.includes('--json')) console.log(`\n■ ${f}\n  ✗ 读取失败：${err?.message ?? err}`);
    }
  }
  if (flags.includes('--json')) console.log(JSON.stringify(reports, null, 2));
  else console.log(`\n${allOk ? '全部通过' : '有不通过的文件'}（${fileArgs.length} 个）`);
  process.exit(allOk ? 0 : 1);
}
const file = resolve(root, 'public/assets/models/test-lod-puzzle-critical.glb');

const buf = readFileSync(file);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
let passed = 0;
const ok = (msg) => {
  passed++;
  console.log(`  ✓ ${msg}`);
};

// ---- 1. extras → userData
const ws = gltf.scene.getObjectByName('white-stone');
assert.equal(ws?.userData.puzzleCritical, true);
ok('glTF extras.puzzleCritical 读到 object.userData.puzzleCritical');

// ---- 2. 组装
const disposed = [];
const stats = buildLods(gltf.scene, (o) => disposed.push(o.name));
assert.deepEqual(stats, { lodGroups: 1, criticalGroups: 2, droppedLevels: 4 });
assert.deepEqual(disposed.sort(), ['tide-gauge_lod1', 'tide-gauge_lod2', 'white-stone_lod1', 'white-stone_lod2']);
ok(`buildLods: ${JSON.stringify(stats)}，丢弃的低级 LOD 已交给 dispose`);

const names = [];
gltf.scene.traverse((o) => names.push(o.name));
assert.ok(!names.some((n) => /white-stone_lod[12]|tide-gauge_lod[12]/.test(n)));
const white = gltf.scene.getObjectByName('white-stone_lod0');
const gauge = gltf.scene.getObjectByName('tide-gauge');
assert.ok(white && isPuzzleCritical(white) && !white.isLOD);
assert.ok(gauge && gauge.userData.puzzleCritical === true && !gauge.isLOD);
ok('白石（父级标记）与刻度柱（lod0 标记）只剩 LOD0，未生成 THREE.LOD');

const control = gltf.scene.getObjectByName('rock-control');
assert.ok(control?.isLOD && control.levels.length === 3);
assert.deepEqual(control.position.toArray(), [1.8, 0, 0]);
assert.ok(control.levels.every((l) => l.object.position.lengthSq() === 0));
ok('对照石组装为 3 级 THREE.LOD，位于 LOD0 原位置，层级相对变换归零');

// ---- 3. 三档距离（在 LOD 前方不同距离放相机，调用 update 看当前层级）
const camera = new THREE.PerspectiveCamera();
const scene = new THREE.Scene();
scene.add(gltf.scene);
function levelAt(lod, dist) {
  const p = new THREE.Vector3();
  lod.getWorldPosition(p);
  camera.position.set(p.x, p.y, p.z + dist);
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  // 从远处 / 近处各走一次，排除滞后（hysteresis）影响
  lod.update(camera);
  lod.update(camera);
  return lod.getCurrentLevel();
}
for (const tier of ['ultra', 'high', 'standard', 'ultra']) {
  const [d0, d1, d2] = QUALITY_PRESETS[tier].lodDistances;
  assert.equal(applyLodDistances(scene, QUALITY_PRESETS[tier].lodDistances), 1);
  assert.equal(levelAt(control, d0 * 0.8), 0);
  assert.equal(levelAt(control, d0 * 1.2), 1);
  assert.equal(levelAt(control, (d0 + d1) / 2), 1);
  assert.equal(levelAt(control, d1 * 1.2), 2);
  assert.equal(levelAt(control, d2 * 2), 2);
  // 关键物体任何距离都是 LOD0（场景里只剩 1 个网格）
  assert.ok(white.isMesh && gauge.isMesh);
  ok(`${tier.padEnd(8)} lodDistances=[${d0}, ${d1}, ${d2}]：对照石 0→1 于 ${d0}m、1→2 于 ${d1}m；关键物体保持 LOD0`);
}
assert.deepEqual(QUALITY_PRESETS.standard.lodDistances, [25, 60, 150]);
ok('standard 档 LOD0 = 25 m（style-guide §8）');

// ---- 4. 运行时标记 + 兜底
const clone = control.clone();
scene.add(clone);
clone.userData.puzzleCritical = true; // 只设标记、不折叠：applyLodDistances 兜底为无穷远
applyLodDistances(scene, QUALITY_PRESETS.standard.lodDistances);
assert.equal(levelAt(clone, 5000), 0);
ok('运行时在 LOD 上设 puzzleCritical：applyLodDistances 强制 LOD0（距离 = Infinity）');
const collapsed = markPuzzleCritical(clone);
assert.ok(!collapsed.isLOD && collapsed.parent === scene && collapsed.userData.puzzleCritical === true);
assert.deepEqual(collapsed.position.toArray(), [1.8, 0, 0]);
ok('markPuzzleCritical 把 LOD 折叠为 LOD0 并保留位置');

console.log(`\nLOD 校验通过（${passed} 项）`);
console.table(describeLods(scene));
