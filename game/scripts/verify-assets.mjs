// 资源加载后处理校验（npm run test:assets）：
//  1. COLOR_0 = 描边平滑法线：GLTFLoader 解析带 COLOR_0 的 GLB → prepareOutlineNormals 关掉 vertexColors、保留 color 属性、校验数据；
//  2. GLB 交付自检（scripts/lib/glb-audit.mjs，node scripts/verify-lod.mjs <文件> 用的同一套）在内存生成的 GLB 上的判定。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { checkOutlineNormals, prepareOutlineNormals } from '../src/assets/vertexColors.ts';
import { auditGlb } from './lib/glb-audit.mjs';
import { guessGroup, sizeVerdict, BUDGET, WARN } from './lib/size-groups.mjs';
import { manifest } from '../src/assets/manifest.ts';
import { PAPER_FOR_DOC, UI_CSS_VARS, UI_ICON_KEYS } from '../src/ui/uiArt.ts';
import { readdirSync, statSync } from 'node:fs';

let passed = 0;
const ok = (msg) => {
  passed++;
  console.log(`  ✓ ${msg}`);
};

/** 用 gltf-transform 拼一个小 GLB。colorMode：'outline' 正确编码的平滑法线 / 'random' 普通顶点色 / null 不带 COLOR_0 */
/** collider / interact：true 挂在根节点下；'scene' 直接挂在场景根（puzzleCritical 子树外）；'orphan' 只建节点不挂任何父节点（BUG-001） */
async function makeGlb({ name = 'prop-test-crate', colorMode = 'outline', critical = true, collider = true, interact = true, lods = 1, tris = 12, extraRoot = null, rootExtras = null } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const root = doc.createNode(name);
  if (critical || rootExtras) root.setExtras({ ...(critical ? { puzzleCritical: true } : {}), ...(rootExtras ?? {}) });
  scene.addChild(root);
  const mat = doc.createMaterial('mat-prop-test').setBaseColorFactor([0.6, 0.5, 0.4, 1]);
  const addMesh = (nodeName, geo, withColor) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const pos = g.getAttribute('position').array;
    const nor = g.getAttribute('normal').array;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
      .setMaterial(mat);
    if (withColor) {
      const n = pos.length / 3;
      const col = new Uint8Array(n * 4);
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        // 球心出发的方向 = 盒子的「平滑法线」
        v.fromArray(pos, i * 3).normalize();
        const c = colorMode === 'random' ? [Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4] : [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, v.z * 0.5 + 0.5];
        col.set([...c.map((x) => Math.round(x * 255)), 255], i * 4);
      }
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setNormalized(true).setBuffer(buffer));
    }
    const node = doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim));
    root.addChild(node);
    return node;
  };
  /** 按 where 放置特殊节点 */
  const place = (node, where) => {
    if (where === true) return;
    root.removeChild(node);
    if (where === 'scene') scene.addChild(node);
    // 'orphan'：不挂任何父节点，只留在 nodes 数组里
  };
  const seg = Math.max(1, Math.round(Math.sqrt(tris / 12)));
  for (let l = 0; l < lods; l++) {
    const s = Math.max(1, seg >> l);
    addMesh(`${name}_lod${l}`, new THREE.BoxGeometry(1, 1, 1, s, s, s), colorMode !== null);
  }
  if (collider) place(addMesh(`${name}-collider`, new THREE.BoxGeometry(1, 1, 1), false), collider);
  if (interact) {
    const it = doc.createNode(`${name}-interact`).setTranslation([0, 0, 1]);
    root.addChild(it);
    place(it, interact);
  }
  if (extraRoot) {
    // 第二个 puzzleCritical 根（只有渲染网格；extraRoot.collider/interact 为 true 时各带一个）
    const r2 = doc.createNode(extraRoot.name).setExtras({ puzzleCritical: true });
    scene.addChild(r2);
    const box = addMesh(`${extraRoot.name}_lod0`, new THREE.BoxGeometry(1, 1, 1), colorMode !== null);
    root.removeChild(box);
    r2.addChild(box);
    if (extraRoot.collider) {
      const c = addMesh(`${extraRoot.name}-collider`, new THREE.BoxGeometry(1, 1, 1), false);
      root.removeChild(c);
      r2.addChild(c);
    }
    if (extraRoot.interact) r2.addChild(doc.createNode(`${extraRoot.name}-interact`));
  }
  return new NodeIO().writeBinary(doc);
}

// ---- 1. COLOR_0 → 关 vertexColors、保留属性、校验
globalThis.self ??= globalThis;
const parse = async (bytes) => (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;

{
  const scene = await parse(await makeGlb());
  const box = scene.getObjectByName('prop-test-crate_lod0');
  assert.equal(box.material.vertexColors, true, 'GLTFLoader 遇到 COLOR_0 会自动开 vertexColors（前提）');
  const stats = prepareOutlineNormals(scene);
  assert.deepEqual(stats, { meshes: 1, materialsFixed: 1, invalid: [] });
  assert.equal(box.material.vertexColors, false);
  assert.ok(box.material.version > 0, 'needsUpdate 已触发（重新编译着色器）');
  const color = box.geometry.getAttribute('color');
  assert.ok(color && color.itemSize === 4 && color.normalized, 'color 属性保留（RGBA8 归一化）');
  assert.equal(box.geometry.userData.outlineNormals, 'color');
  const collider = scene.getObjectByName('prop-test-crate-collider');
  assert.equal(collider.material.vertexColors, false);
  ok('COLOR_0 平滑法线：材质 vertexColors 关掉、几何 color 属性保留并标 userData.outlineNormals，校验通过');
  // 再跑一次是幂等的
  assert.deepEqual(prepareOutlineNormals(scene), { meshes: 1, materialsFixed: 0, invalid: [] });
  ok('prepareOutlineNormals 幂等（第二次没有材质要改）');
}
{
  const scene = await parse(await makeGlb());
  const box = scene.getObjectByName('prop-test-crate_lod0');
  assert.deepEqual(prepareOutlineNormals(scene, false), { meshes: 0, materialsFixed: 0, invalid: [] });
  assert.equal(box.material.vertexColors, true);
  ok("开关关闭（gameConfig.assets.vertexColorsAreOutlineNormals=false 或 manifest vertexColors:'color'）：vertexColors 保持开");
}
{
  const scene = await parse(await makeGlb({ colorMode: 'random' }));
  const stats = prepareOutlineNormals(scene);
  assert.equal(stats.invalid.length, 1);
  assert.match(stats.invalid[0][1], /不是单位向量/);
  assert.equal(scene.getObjectByName('prop-test-crate_lod0').material.vertexColors, false);
  ok(`普通顶点色被识别为「不像平滑法线」并告警（${stats.invalid[0][1]}），材质仍按约定关掉 vertexColors`);
}
{
  // 平滑法线编码对了但方向全反（例如坐标系没转）
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).toNonIndexed();
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize().negate();
    col.set([v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, v.z * 0.5 + 0.5], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const r = checkOutlineNormals(g);
  assert.equal(r.ok, false);
  assert.match(r.reason, /反向/);
  assert.equal(checkOutlineNormals(new THREE.BoxGeometry()).ok, false);
  ok('方向反了的平滑法线、没有 COLOR_0 的几何体都判为不通过');
}

// ---- 2. 交付自检判定
const dir = mkdtempSync(join(tmpdir(), 'glb-audit-'));
try {
  const write = async (file, opts) => {
    const p = join(dir, file);
    writeFileSync(p, await makeGlb(opts));
    return p;
  };
  let r = await auditGlb(await write('prop-test-crate.glb', {}));
  assert.deepEqual(r.errors, []);
  assert.equal(r.summary.puzzleCritical, true);
  assert.equal(r.summary.colliders, 1);
  assert.equal(r.summary.interacts, 1);
  assert.deepEqual(r.summary.levels, [12]);
  ok('合格的 puzzleCritical 道具：无错误，层级 [12] 三角面、-collider / -interact 各 1');

  r = await auditGlb(await write('prop-test-crate.glb', { colorMode: null, collider: false, interact: false }));
  assert.ok(r.errors.some((e) => /缺 -collider/.test(e)));
  assert.ok(r.errors.some((e) => /缺 -interact/.test(e)));
  assert.ok(r.errors.some((e) => /缺 COLOR_0/.test(e)));
  ok('puzzleCritical 缺 -collider / -interact / COLOR_0 → 错误');

  // BUG-001：按场景树判断特殊节点
  {
    // QA 用例的做法（mk-nocollider.mjs）：直接改 GLB JSON，把 -collider 从父节点 children / scene.nodes 里摘掉，节点本身留在 nodes 数组
    const bytes = Buffer.from(await makeGlb());
    const jsonLen = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
    const rest = bytes.subarray(20 + jsonLen);
    const idx = json.nodes.findIndex((n) => /-collider$/.test(n.name ?? ''));
    for (const n of json.nodes) if (n.children) n.children = n.children.filter((c) => c !== idx);
    for (const sc of json.scenes) sc.nodes = sc.nodes.filter((c) => c !== idx);
    let js = Buffer.from(JSON.stringify(json), 'utf8');
    js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const head = Buffer.alloc(20);
    head.write('glTF', 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + js.length + rest.length, 8);
    head.writeUInt32LE(js.length, 12);
    head.write('JSON', 16);
    const p = join(dir, 'prop-test-crate-detached.glb');
    writeFileSync(p, Buffer.concat([head, js, rest]));
    assert.ok(json.nodes[idx], '前提：节点仍在 nodes 数组里');
    r = await auditGlb(p);
    assert.ok(r.errors.includes('puzzleCritical 物体缺 -collider（§5.4 必须）'), r.errors.join('\n'));
    assert.ok(r.errors.some((e) => /prop-test-crate-collider：-collider 节点在 nodes 列表里但没挂在场景树上/.test(e)), r.errors.join('\n'));
    assert.equal(r.summary.colliders, 0);
  }
  r = await auditGlb(await write('prop-test-crate.glb', { collider: 'orphan', interact: 'orphan' }));
  assert.ok(r.errors.includes('puzzleCritical 物体缺 -collider（§5.4 必须）'), r.errors.join('\n'));
  assert.ok(r.errors.includes('puzzleCritical 物体缺 -interact 交互点（§5.4 必须）'), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /-interact 节点在 nodes 列表里但没挂在场景树上/.test(e)));
  assert.deepEqual([r.summary.colliders, r.summary.interacts], [0, 0]);
  ok('BUG-001：-collider / -interact 只在 nodes 数组里、没挂在场景树上（QA 改 JSON 的做法 + gltf-transform 孤立节点）→ 报「缺 -collider / -interact」并指出孤立节点');

  r = await auditGlb(await write('prop-test-crate.glb', { collider: 'scene', interact: 'scene' }));
  assert.ok(r.errors.includes('puzzleCritical 物体缺 -collider（§5.4 必须）'), r.errors.join('\n'));
  assert.ok(r.errors.includes('puzzleCritical 物体缺 -interact 交互点（§5.4 必须）'), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /prop-test-crate-collider：不在任何 puzzleCritical 根节点（prop-test-crate）的子树里/.test(e)), r.errors.join('\n'));
  r = await auditGlb(await write('prop-test-crate.glb', { extraRoot: { name: 'prop-test-crate-b', collider: false, interact: true } }));
  assert.ok(r.errors.includes('puzzleCritical 物体 prop-test-crate-b 缺 -collider（§5.4 必须）'), r.errors.join('\n'));
  assert.ok(!r.errors.some((e) => /prop-test-crate 缺|-interact 交互点/.test(e)), r.errors.join('\n'));
  r = await auditGlb(await write('prop-test-crate.glb', { extraRoot: { name: 'prop-test-crate-b', collider: true, interact: true } }));
  assert.deepEqual(r.errors, []);
  r = await auditGlb(await write('env-rock-test.glb', { critical: false, collider: 'orphan', interact: false }));
  assert.ok(r.errors.some((e) => /-collider 节点在 nodes 列表里但没挂在场景树上/.test(e)), '非关键物体的孤立 -collider 也报错（加载后没有碰撞）');
  ok('BUG-001：-collider / -interact 在场景树上但不在 puzzleCritical 根的子树里 → 错误；多个 puzzleCritical 根各自要有；非关键物体的孤立 -collider 也报错');

  // extras.pivot 拦截：GLTFLoader 会把带 pivot 的节点当枢轴容器（位置减 pivot、子节点归零），值不合法时位置变 NaN
  r = await auditGlb(await write('prop-test-crate.glb', { rootExtras: { pivot: 'bottom' } }));
  assert.ok(r.errors.some((e) => /prop-test-crate：节点 extras 里有键 pivot/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /加载后位置.*NaN/.test(e)), '字符串 pivot 加载后应出现 NaN：' + r.errors.join('\n'));
  r = await auditGlb(await write('prop-test-crate.glb', { rootExtras: { pivot: [0, 0, 0] } }));
  assert.ok(r.errors.some((e) => /节点 extras 里有键 pivot/.test(e)), '合法数组的 pivot 也拦（会被重建成枢轴容器）');
  r = await auditGlb(await write('prop-test-crate.glb', { rootExtras: { originAt: 'bottom' } }));
  assert.deepEqual(r.errors, [], 'originAt 不报错');
  ok('extras 键名 pivot → 错误（加载后 NaN 也报）；originAt 正常通过');

  r = await auditGlb(await write('prop-test-crate.glb', { colorMode: 'random' }));
  assert.ok(r.errors.some((e) => /COLOR_0 数据不像平滑法线/.test(e)));
  ok('COLOR_0 是普通颜色 → 错误（加载器同款抽样校验）');

  r = await auditGlb(await write('prop-key-test.glb', { tris: 4000 }));
  assert.ok(r.errors.some((e) => /超出预算（钥匙 ≤ 3k）/.test(e)), r.errors.join('\n'));
  r = await auditGlb(await write('prop-test-crate.glb', { tris: 4000 }), { budget: 100_000 });
  assert.deepEqual(r.errors, []);
  ok('按名字取预算（prop-key-* ≤ 3k 超出报错），--budget 可覆盖');

  r = await auditGlb(await write('prop-test-crate.glb', { lods: 3, tris: 800 }));
  assert.ok(r.warnings.some((w) => /只交 LOD0/.test(w)));
  assert.ok(r.info.some((l) => /固定 LOD0 1 个（解谜）\+ 0 个（forceLod0），丢弃低级 LOD 2 个/.test(l)), r.info.join('\n'));
  // extras.forceLod0（菲涅尔透镜）：固定 LOD0，但不是解谜物体，不要求 -collider / -interact
  r = await auditGlb(await write('prop-fresnel-lens.glb', { name: 'prop-fresnel-lens', critical: false, collider: false, interact: false, lods: 3, tris: 800, rootExtras: { forceLod0: true } }));
  assert.deepEqual(r.errors, [], r.errors.join('\n'));
  assert.ok(r.info.some((l) => /^forceLod0：prop-fresnel-lens/.test(l)), r.info.join('\n'));
  assert.ok(r.info.some((l) => /固定 LOD0 0 个（解谜）\+ 1 个（forceLod0），丢弃低级 LOD 2 个/.test(l)), r.info.join('\n'));
  ok('extras.forceLod0：交付自检报告、加载器固定 LOD0 并丢弃低级 LOD，不要求 -collider / -interact');
  r = await auditGlb(await write('env-rock-test.glb', { critical: false, collider: false, interact: false, lods: 3, tris: 800 }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.summary.levels.length, 3);
  assert.ok(r.info.some((l) => /THREE\.LOD 1 个/.test(l)));
  ok('LOD：关键物体带低级 LOD 警告并在加载器里丢弃；普通物体 3 级组装成 THREE.LOD、各级面数统计');
} finally {
  rmSync(dir, { recursive: true, force: true });
}


// BUG-005（工具）：package.json 里所有 node 脚本都带路径别名钩子（src 里出现 `@/` 运行时导入也能跑）；
// 美术直接 `npm run verify:glb -- <文件>` 可用，文件路径按调用 npm 时的目录（INIT_CWD）解析
{
  const { spawnSync } = await import('node:child_process');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const bare = Object.entries(pkg.scripts).flatMap(([k, v]) =>
    v.split('&&').map((c) => c.trim()).filter((c) => /^node\s/.test(c) && !c.includes('--import ./scripts/register-ts-paths.mjs')).map((c) => `${k}: ${c}`),
  );
  assert.deepEqual(bare, [], 'package.json 里这些 node 命令没带 --import ./scripts/register-ts-paths.mjs');
  const hook = spawnSync(process.execPath, ['--import', './scripts/register-ts-paths.mjs', '--input-type=module', '-e', "const m = await import('@/content/text'); if (typeof m.t !== 'function') process.exit(3);"], { cwd: root, encoding: 'utf8' });
  assert.equal(hook.status, 0, hook.stderr);
  const glb = join(root, 'public/assets/models/test-lod-puzzle-critical.glb');
  const r = spawnSync('npm', ['run', '-s', 'verify:glb', '--', 'public/assets/models/test-lod-puzzle-critical.glb'], { cwd: root, encoding: 'utf8', env: { ...process.env, INIT_CWD: root } });
  // 测试模型故意缺 -collider 等（退出码 1），这里只验证脚本能启动并出报告，没有模块解析错误
  assert.ok(existsSync(glb) && (r.status === 0 || r.status === 1) && /错误 \d+，警告 \d+/.test(r.stdout) && !/Cannot find|ERR_MODULE/.test(r.stderr), r.stdout + r.stderr);
  ok('package.json 的 node 脚本都带 register-ts-paths（@/ 别名），npm run verify:glb -- <文件> 可直接跑');
}

// ---- 字体加载（fontLoader.ts）：每个字体只下载一次、被取消可重试、全部失败回退系统字体
{
  const { loadFontOnce, forgetFont, fontStats } = await import('../src/assets/fontLoader.ts');
  const mk = (plan) => {
    const calls = [];
    const added = [];
    const fallbacks = [];
    return {
      calls, added, fallbacks,
      deps: {
        fetch: async (url, init) => {
          calls.push({ url, init });
          const r = plan[calls.length - 1] ?? 'ok';
          await new Promise((res) => setTimeout(res, 5));
          if (r === 'abort') throw new TypeError('Failed to fetch (net::ERR_ABORTED)');
          if (typeof r === 'number') return { ok: false, status: r, arrayBuffer: async () => new ArrayBuffer(0) };
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
        },
        makeFace: async (family) => ({ family }),
        addFace: (f) => added.push(f),
        onFallback: (family) => fallbacks.push(family),
        sleep: async () => {},
      },
    };
  };
  // 并发两次请求同一 URL（例：菜单组被两处同时请求）→ 只 fetch 一次、只注册一个 FontFace
  let m = mk([]);
  const [a, b] = await Promise.all([loadFontOnce('/f/a.woff2', 'A', m.deps), loadFontOnce('/f/a.woff2', 'A', m.deps)]);
  assert.equal(m.calls.length, 1);
  assert.equal(m.added.length, 1);
  assert.equal(a, b);
  assert.equal(m.calls[0].init.credentials, 'same-origin');
  // 加载过的再请求也不再下载
  await loadFontOnce('/f/a.woff2', 'A', m.deps);
  assert.equal(m.calls.length, 1);
  ok('同一字体并发 / 重复请求只下载一次、只注册一个 FontFace');
  // 卸载后可重新加载
  forgetFont('/f/a.woff2');
  await loadFontOnce('/f/a.woff2', 'A', m.deps);
  assert.equal(m.calls.length, 2);
  ok('卸载（forgetFont）后再请求会重新加载');
  // 第一次被取消（ERR_ABORTED）→ 重试成功
  m = mk(['abort']);
  assert.ok(await loadFontOnce('/f/b.woff2', 'B', m.deps));
  assert.equal(m.calls.length, 2);
  assert.deepEqual(fontStats.get('/f/b.woff2').attempts, 2);
  assert.equal(m.fallbacks.length, 0);
  ok('第一次 fetch 被取消 → 重试成功，不回退');
  // 一直被取消 → 最多 1+2 次，返回 null，回退系统字体（不抛）
  m = mk(['abort', 'abort', 'abort']);
  assert.equal(await loadFontOnce('/f/c.woff2', 'C', m.deps), null);
  assert.equal(m.calls.length, 3);
  assert.deepEqual(m.fallbacks, ['C']);
  assert.equal(fontStats.get('/f/c.woff2').ok, false);
  // 失败不缓存：之后再进菜单可再试
  m = mk([]);
  assert.ok(await loadFontOnce('/f/c.woff2', 'C', m.deps));
  ok('重试全部失败 → 返回 null 走系统字体回退（不抛错）；失败不缓存，下次可再试');
  // 404 不重试
  m = mk([404]);
  assert.equal(await loadFontOnce('/f/d.woff2', 'D', m.deps), null);
  assert.equal(m.calls.length, 1);
  ok('HTTP 404 不重试，直接回退');
  // CSS 回退栈：Foglight 之后必须有系统中文字体
  const css = readFileSync(resolve(root, 'src/ui/styles.css'), 'utf8');
  // 030：--ui-font / --ui-serif 是 --ui-font-body / --ui-font-title 的别名，顺着 var() 解到真正的字体栈
  const cssVar = (v, depth = 0) => {
    const line = new RegExp(`${v}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? '';
    const alias = /^var\((--[\w-]+)\)$/.exec(line);
    return alias && depth < 4 ? cssVar(alias[1], depth + 1) : line;
  };
  for (const v of ['--ui-font', '--ui-serif', '--ui-font-title', '--ui-font-body', '--ui-font-num']) {
    const line = cssVar(v);
    assert.ok(/^'Foglight/.test(line) && /(Microsoft YaHei|Songti SC|PingFang SC|Noto)/.test(line) && /(sans-serif|serif)\s*$/.test(line), v + ': ' + line);
  }
  // 唯一下载路径：index.html 不 preload 字体，CSS 不用 @font-face url() 再下一份
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert.ok(!/rel=["']?preload[^>]*woff2|woff2[^>]*rel=["']?preload/.test(html), 'index.html 不应 preload 字体');
  assert.ok(!/@font-face/.test(css), 'styles.css 不应再声明 @font-face（字体由 AssetLoader 注册）');
  ok('CSS 回退栈含系统中文字体；字体只有 AssetLoader 一条下载路径（无 preload / @font-face 重复）');
}

// ---- BUG-012：GLB / 外部 KTX2 网络重试（loadRetry.ts）：模拟浏览器取消（TypeError / AbortError）
{
  const { loadWithRetry, createSharedKtx2, shareInflight, stripFallbackTextures, isRetryableLoadError, assetStats, ASSET_RETRIES } = await import('../src/assets/loadRetry.ts');
  const abort = () => new TypeError('Failed to fetch (net::ERR_ABORTED)');
  const httpErr = (status) => Object.assign(new Error(`fetch for "x" responded with ${status}`), { response: { status } });
  assert.ok(isRetryableLoadError(abort()));
  assert.ok(isRetryableLoadError(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  assert.ok(isRetryableLoadError(httpErr(503)) && !isRetryableLoadError(httpErr(404)));
  assert.ok(!isRetryableLoadError(new Error('THREE.GLTFLoader: Unsupported asset')), '解析错误不重试');
  const sleeps = [];
  const deps = { sleep: async (ms) => void sleeps.push(ms) };
  // 第一次被取消 → 重试成功
  let n = 0;
  assert.equal(await loadWithRetry('/m/a.glb', 'glb', async () => (++n === 1 ? Promise.reject(abort()) : 'gltf'), deps), 'gltf');
  assert.equal(n, 2);
  assert.deepEqual({ a: assetStats.get('/m/a.glb').attempts, ok: assetStats.get('/m/a.glb').ok }, { a: 2, ok: true });
  // 一直被取消 → 1 + ASSET_RETRIES 次后抛出
  n = 0;
  await assert.rejects(loadWithRetry('/m/b.glb', 'glb', async () => (++n, Promise.reject(abort())), deps), TypeError);
  assert.equal(n, 1 + ASSET_RETRIES);
  assert.equal(ASSET_RETRIES, 2);
  assert.equal(assetStats.get('/m/b.glb').ok, false);
  assert.equal(assetStats.get('/m/b.glb').done, true);
  // 404 / 解析错误不重试
  n = 0;
  await assert.rejects(loadWithRetry('/m/c.glb', 'glb', async () => (++n, Promise.reject(httpErr(404))), deps));
  assert.equal(n, 1);
  ok('GLB / KTX2：被取消（TypeError / AbortError）、5xx 重试，最多 1+2 次；404 / 解析错误不重试；assetStats 记次数');
  // 并发共享：同 key 只一条在飞
  const inflight = new Map();
  n = 0;
  const slow = () => new Promise((r) => setTimeout(() => r(++n), 5));
  const [x, y] = await Promise.all([shareInflight(inflight, 'k', slow), shareInflight(inflight, 'k', slow)]);
  assert.equal(n, 1);
  assert.equal(x, y);
  ok('同一 URL 并发请求共用一次下载');

  // 共享 KTX2 加载器：两个 GLB 同时引用同一张贴图、第一次请求被取消 → 只发起 2 次请求（1 + 重试 1），两个都拿到同一张贴图
  const tex = new THREE.Texture();
  const mkShared = (plan, fallbacks) => {
    const calls = [];
    const cache = new Map();
    const shared = createSharedKtx2(cache, {
      ...deps,
      load: async (url) => {
        calls.push(url);
        await new Promise((r) => setTimeout(r, 5));
        const r = plan[calls.length - 1] ?? 'ok';
        if (r === 'abort') throw abort();
        return tex;
      },
      resolve: (url) => new URL(url, 'http://x/assets/art/models/env/').href,
      fallback: (url) => {
        fallbacks.push(url);
        return new THREE.Texture();
      },
    });
    const get = (url) => new Promise((res, rej) => shared.load(url, res, undefined, rej));
    return { calls, cache, get };
  };
  let fb = [];
  let s1 = mkShared(['abort'], fb);
  const [t1, t2] = await Promise.all([s1.get('../../textures/tex-wood.ktx2'), s1.get('../../textures/tex-wood.ktx2')]);
  assert.equal(s1.calls.length, 2, '取消一次 + 重试一次，第二个 GLB 不另发请求');
  assert.ok(t1 === tex && t2 === tex && fb.length === 0);
  assert.equal(assetStats.get('http://x/assets/art/textures/tex-wood.ktx2').attempts, 2);
  ok('外部 KTX2：两个 GLB 同时引用、第一次请求被取消 → 重试成功，总共 2 次请求、拿到同一张贴图，无占位');
  // 一直被取消 → 3 次后占位（标 assetFallback）、日志回调；占位不缓存，之后再请求会重新下载
  fb = [];
  s1 = mkShared(['abort', 'abort', 'abort'], fb);
  const t3 = await s1.get('../../textures/tex-rock.ktx2');
  assert.equal(s1.calls.length, 3);
  assert.deepEqual(fb, ['http://x/assets/art/textures/tex-rock.ktx2']);
  assert.ok(t3 !== tex && t3.userData.assetFallback);
  assert.equal(assetStats.get('http://x/assets/art/textures/tex-rock.ktx2').fallback, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s1.cache.size, 0, '失败的不留缓存');
  assert.equal(await s1.get('../../textures/tex-rock.ktx2'), tex);
  assert.equal(s1.calls.length, 4);
  ok('外部 KTX2：重试全部失败 → 棋盘格占位 + 失败回调（日志 / assets-fallback），失败不缓存，下次可再试');

  // 真 GLTFLoader（KHR_texture_basisu 外部 .ktx2，颜色 + 法线贴图同一张）：第一次被取消 → 材质最终有贴图；全部失败 → 只有 map 槽留占位
  const gltfJson = (img) => ({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_texture_basisu'],
    extensionsRequired: ['KHR_texture_basisu'],
    images: [{ uri: img }],
    textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
    materials: [{ name: 'mat-env-wood', pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 0 } }],
    meshes: [],
    nodes: [],
    scenes: [{ nodes: [] }],
    scene: 0,
  });
  const loadMat = async (shared) => {
    const loader = new GLTFLoader().setKTX2Loader(shared);
    const g = await loader.parseAsync(JSON.stringify(gltfJson('../../textures/tex-pier.ktx2')), 'http://x/assets/art/models/env/');
    const mat = await g.parser.getDependency('material', 0);
    const root = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    stripFallbackTextures(root);
    return mat;
  };
  {
    const calls = [];
    const shared = createSharedKtx2(new Map(), {
      ...deps,
      load: async (url) => (calls.push(url), calls.length === 1 ? Promise.reject(abort()) : new THREE.Texture()),
      resolve: (url) => url,
      fallback: () => new THREE.Texture(),
    });
    const mat = await loadMat(shared);
    assert.equal(calls.length, 2);
    assert.ok(mat.map && !mat.map.userData.assetFallback && mat.normalMap && !mat.normalMap.userData.assetFallback, '取消后重试：材质有贴图');
  }
  {
    const shared = createSharedKtx2(new Map(), { ...deps, load: async () => Promise.reject(abort()), resolve: (url) => url, fallback: () => new THREE.Texture() });
    const mat = await loadMat(shared);
    assert.ok(mat.map?.userData.assetFallback, '颜色槽是占位（可见降级）');
    assert.equal(mat.normalMap, null, '法线槽不放棋盘格');
  }
  ok('GLTFLoader 外部 KTX2：取消后重试 → 材质颜色 / 法线贴图都在；全部失败 → 颜色槽棋盘格占位、法线槽清空');
}

// ---- batch17 D2：冷启动那批请求取消落在 UI 音效 / 菜单曲 / UI 图片上 → 原来不重试、整局 missing
{
  const { loadImageWithRetry, loadAudioWithRetry, assetStats } = await import('../src/assets/loadRetry.ts');
  const deps = { sleep: async () => {} };
  const okRes = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
  const encErr = () => Object.assign(new Error('The source image cannot be decoded.'), { name: 'EncodingError' });
  // 图片：fetch 200、<img>.decode() 那次被掐（EncodingError）→ 重试成功
  let dn = 0;
  const u1 = await loadImageWithRetry('/d2/ui-icon-settings.svg', { ...deps, fetch: async () => okRes, decode: async () => { if (dn++ === 0) throw encErr(); } });
  assert.equal(u1, '/d2/ui-icon-settings.svg');
  assert.deepEqual([assetStats.get('/d2/ui-icon-settings.svg').attempts, assetStats.get('/d2/ui-icon-settings.svg').ok], [2, true], 'decode 被掐后重试成功');
  // 图片：fetch 被取消 → 重试
  let fn = 0;
  await loadImageWithRetry('/d2/ui-illust-loading.webp', { ...deps, fetch: async () => { if (fn++ === 0) throw new TypeError('Failed to fetch'); return okRes; }, decode: async () => {} });
  assert.equal(assetStats.get('/d2/ui-illust-loading.webp').attempts, 2);
  // 真坏图：每次 decode 都失败 → 1+2 次后失败（不无限重试）
  await assert.rejects(loadImageWithRetry('/d2/bad.webp', { ...deps, fetch: async () => okRes, decode: async () => { throw encErr(); } }), /EncodingError/);
  assert.equal(assetStats.get('/d2/bad.webp').attempts, 3);
  // 404 不重试、不 decode
  let decoded = false;
  await assert.rejects(loadImageWithRetry('/d2/none.webp', { ...deps, fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }), decode: async () => void (decoded = true) }));
  assert.deepEqual([assetStats.get('/d2/none.webp').attempts, decoded], [1, false]);
  // 音频：AudioLoader 的 fetch 被取消（TypeError: Failed to fetch，batch17 复现原文）→ 重试成功
  let an = 0;
  const buf = await loadAudioWithRetry('/d2/mus-menu.ogg', async () => { if (an++ === 0) throw new TypeError('Failed to fetch'); return { duration: 106.67 }; }, deps);
  assert.equal(buf.duration, 106.67);
  assert.deepEqual([assetStats.get('/d2/mus-menu.ogg').attempts, assetStats.get('/d2/mus-menu.ogg').kind], [2, 'audio']);
  // 音频解码错误（EncodingError 来自 decodeAudioData）不重试
  let dn2 = 0;
  await assert.rejects(loadAudioWithRetry('/d2/bad.ogg', async () => { dn2++; throw encErr(); }, deps));
  assert.equal(dn2, 1);
  // 接线：组加载的 audio / image、懒加载音频都走重试
  const src = readFileSync(new URL('../src/assets/AssetLoader.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("loadAudioWithRetry(url, () => this.audioLoader.loadAsync(url, prog))"), '组加载音频重试');
  assert.ok(src.includes("load: (url) => loadAudioWithRetry(url, () => this.audioLoader.loadAsync(url))"), '懒加载音频重试');
  assert.ok(src.includes('return loadImageWithRetry(url, {'), 'UI 图片 fetch + decode 一起重试');
  ok('batch17 D2：UI 图片 decode 被掐 / fetch 被取消、音频 fetch 被取消都重试（1+2 次），真坏图 / 解码错 / 404 不无限重试；组加载与懒加载都接上');
}

// ---- batch17 D4：check-size 140 MB 警戒线只警告、150 MB 以上才失败
{
  const M = 1024 * 1024;
  const v = (t, extra = {}) => sizeVerdict({ menuBytes: 5 * M, firstPackageBytes: t - 5 * M, firstTotalBytes: t, ...extra });
  assert.equal(WARN.firstTotalMB, 140);
  assert.equal(BUDGET.firstPackageMB, 150);
  assert.deepEqual(v(132.41 * M), { warnings: [], failures: [] }, 'batch17 实测 132.41 MB：不警告');
  assert.deepEqual(v(140 * M), { warnings: [], failures: [] }, '正好 140 不警告');
  let r = v(140.01 * M);
  assert.equal(r.warnings.length, 1, '超 140 警告');
  assert.equal(r.failures.length, 0, '超 140 不失败');
  r = v(150 * M);
  assert.deepEqual([r.warnings.length, r.failures.length], [1, 0], '正好 150 仍只是警告');
  r = v(150.01 * M);
  assert.equal(r.failures.length, 1, '超 150 失败');
  assert.ok(/硬上限/.test(r.failures[0]));
  assert.equal(r.warnings.length, 0, '超 150 直接报错，不再重复警告');
  assert.equal(v(100 * M, { menuBytes: 15.5 * M }).failures.length, 1, '主菜单包 > 15 MB 失败');
  ok('check-size 判定：首次总下载 ≤ 140 通过、140–150 只警告、> 150 失败（D4）');
}

// ---- 031 准备：check-size 对 art/ 里未登记资源的分组估算
{
  assert.equal(guessGroup('char-xi.glb'), 'common', 'char-* 默认常驻 common');
  assert.equal(guessGroup('char-xi-anims.glb'), 'common');
  assert.equal(guessGroup('char-ayan.glb'), 'common', '新角色默认 common');
  assert.equal(guessGroup('char-father.glb'), 's3', '父亲只在 S3');
  assert.equal(guessGroup('char-father-anims.glb'), 's3');
  assert.equal(guessGroup('char-father.ktx2'), 's3');
  assert.equal(guessGroup('char-fatherland.glb'), 'common', '前缀要整段匹配');
  assert.equal(guessGroup('env-cellar-s2.glb'), 's2');
  assert.equal(guessGroup('prop-lens-s3.glb'), 's3');
  assert.equal(guessGroup('tex-wood-planks.ktx2'), 'common');
  assert.equal(guessGroup('env-pier.glb'), 's1');
  // 033 配乐：主菜单曲算 menu，不进 common / s1；场景曲按 -s1 / -s3 归组
  assert.equal(guessGroup('mus-menu.ogg'), 'menu', 'mus-menu 属主菜单包');
  assert.equal(guessGroup('mus-menuet.ogg'), 's1', 'mus-menu 前缀要整段匹配');
  assert.equal(guessGroup('mus-s1-ebb-shore.ogg'), 's1');
  assert.equal(guessGroup('mus-s3-lighthouse.ogg'), 's3');
  assert.equal(guessGroup('mus-s3-lighthouse-upper.ogg'), 's3');
  // 1031：S2 场景曲、结尾曲（S3 点燃时起播）
  assert.equal(guessGroup('mus-s2-keeper-house.ogg'), 's2');
  assert.equal(guessGroup('mus-ending-ch1.ogg'), 's3', '结尾曲属 s3，不落进 s1');
  assert.equal(guessGroup('mus-endingx.ogg'), 's1', 'mus-ending 前缀要整段匹配');
  // 031 美术交付父亲（README-031）：两个 GLB + 三张贴图都算 s3，不进 common / s1
  const father = ['char-father.glb', 'char-father-anims.glb', 'tex-father-albedo.ktx2', 'tex-father-normal.ktx2', 'tex-father-orm.ktx2'];
  for (const f of father) assert.equal(guessGroup(f), 's3', `${f} 应算 s3`);
  assert.equal(guessGroup('tex-fatherland.ktx2'), 's1', 'tex-father 前缀也要整段匹配');
  const fatherFiles = [resolve(root, '../art/models/characters/char-father.glb'), resolve(root, '../art/models/characters/char-father-anims.glb'), ...['albedo', 'normal', 'orm'].map((k) => resolve(root, `../art/textures/tex-father-${k}.ktx2`))];
  if (fatherFiles.every((f) => existsSync(f))) for (const f of fatherFiles) assert.equal(guessGroup(basename(f)), 's3', f);
  ok('check-size 分组估算：char-* 默认 common，char-father / tex-father → s3，-s2/-s3 后缀按场景，其余 s1');
}

// ---- 030 UI：art/ui 的 21 个运行时文件全部登记；懒加载 / 分组 / 纸张映射
{
  const ui = manifest.filter((e) => e.url.startsWith('assets/art/ui/'));
  assert.equal(ui.length, 21, 'UI 文件 21 个');
  assert.ok(ui.every((e) => e.type === 'image' && e.art && e.optional), 'UI 图都是 image + art（?art=0 跳过）+ optional（缺了退纯色）');
  assert.equal(new Set(ui.map((e) => e.key)).size, 21, 'key 不重复');
  const artUi = resolve(root, '../art/ui');
  if (existsSync(artUi)) {
    const files = readdirSync(artUi).filter((f) => /\.(webp|png|svg)$/.test(f)).sort();
    assert.deepEqual(ui.map((e) => e.url.slice('assets/art/ui/'.length)).sort(), files, 'art/ui 下每个运行时文件都登记了，清单里没有多余文件');
    const total = files.reduce((n, f) => n + statSync(join(artUi, f)).size, 0);
    assert.ok(total < 5 * 1024 * 1024, `UI 运行时合计 ${total} B < 5 MB`);
  }
  const lazy = ui.filter((e) => e.lazy).map((e) => e.key).sort();
  assert.deepEqual(lazy, ['ui-illust-chapter1-end', 'ui-illust-menu', 'ui-panel-corner', 'ui-paper-journal', 'ui-paper-letter', 'ui-paper-logbook', 'ui-paper-note', 'ui-paper-notice', 'ui-paper-sketch'], '纸张 / 结尾插画 / 菜单兜底 / 备选角饰懒加载');
  for (const e of ui) {
    if (/^ui-paper-|chapter1-end/.test(e.key)) assert.equal(e.group, 'common', `${e.key} 进 common`);
    else assert.equal(e.group, 'menu', `${e.key} 进主菜单包`);
  }
  const byKey = new Map(ui.map((e) => [e.key, e]));
  for (const k of Object.keys(UI_CSS_VARS)) assert.ok(byKey.get(k) && !byKey.get(k).lazy && byKey.get(k).group === 'menu', `${k} 随主菜单包预加载`);
  for (const k of UI_ICON_KEYS) assert.ok(byKey.has(k) && byKey.get(k).url.endsWith('.svg'), `${k} 是 svg`);
  const docs = ['ch1.s1.neighbor_note.doc', 'ch1.s1.notice.doc', 'ch1.s2.journal.doc', 'ch1.s2.reply_draft.doc', 'ch1.s2.sketch.doc', 'ch1.s2.xi_note.doc', 'ch1.s3.ignition_note.doc', 'ch1.s3.logbook.doc'];
  assert.deepEqual(Object.keys(PAPER_FOR_DOC).sort(), docs, '8 份文档都有纸');
  assert.equal(new Set(Object.values(PAPER_FOR_DOC)).size, 6, '6 种纸');
  for (const k of Object.values(PAPER_FOR_DOC)) assert.ok(byKey.get(k)?.lazy, `${k} 已登记且懒加载`);
  assert.equal(PAPER_FOR_DOC['ch1.s2.reply_draft.doc'], 'ui-paper-letter', '划线信纸只给没寄出的信');
  for (const d of ['ch1.s1.neighbor_note.doc', 'ch1.s2.xi_note.doc', 'ch1.s3.ignition_note.doc']) assert.equal(PAPER_FOR_DOC[d], 'ui-paper-note');
  ok('030 UI：21 个文件全部登记（menu 14 / common 7），纸张 ×6 + 结尾插画 + 菜单兜底懒加载，8 份文档 → 6 种纸（README-030 §2.2）');
}

// ---- 030 UI：AssetLoader.loadImage 懒加载（ImageCache）（同 key 共享一次下载、失败返回 null 可重试、?art=0 不下载）
{
  const { ImageCache } = await import('../src/assets/imageCache.ts');
  const calls = [];
  let failNext = 0;
  let art = true;
  const failed = [];
  const cache = new ImageCache({
    lookup: (k) => (k.startsWith('ui-') ? { url: `assets/art/ui/${k}.webp`, art: true } : null),
    artEnabled: () => art,
    fetchImage: async (url) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, 5));
      if (failNext > 0) {
        failNext--;
        throw new Error('HTTP 404');
      }
      return url;
    },
    onFailed: (k) => failed.push(k),
  });
  const [a, b] = await Promise.all([cache.load('ui-paper-journal'), cache.load('ui-paper-journal')]);
  assert.equal(a, 'assets/art/ui/ui-paper-journal.webp');
  assert.equal(b, a);
  assert.equal(calls.length, 1, '并发两次只下一次');
  assert.equal(await cache.load('ui-paper-journal'), a);
  assert.equal(calls.length, 1, '已加载直接返回');
  assert.equal(cache.get('ui-paper-journal'), a);
  failNext = 1;
  assert.equal(await cache.load('ui-paper-letter'), null, '404 → null（退纯色纸底）');
  assert.deepEqual(failed, ['ui-paper-letter']);
  assert.equal(await cache.load('ui-paper-letter'), 'assets/art/ui/ui-paper-letter.webp', '下次再打开会重试');
  assert.equal(await cache.load('no-such-key'), null, '没登记 → null');
  art = false;
  const n = calls.length;
  assert.equal(await cache.load('ui-paper-note'), null, '?art=0 → null');
  assert.equal(calls.length, n, '?art=0 不发请求');
  ok('AssetLoader.loadImage：同 key 并发共享一次下载、已加载直接返回、404 → null 且可重试、未登记 / ?art=0 → null 不发请求');
}

// ---- BUG-030：KTX2 宽高非 4 倍数 → 运行时转未压缩 RGBA（ktx2Route.ts）；ramp 只留第 0 级
{
  const { readKtx2Size, isBlockAligned, createKtx2Router, disableCompressedTargets, stripToBaseLevel } = await import('../src/assets/ktx2Route.ts');
  // 文件头：真文件 256×1；非 KTX2 → null；高 0（1D）按 1
  const rampFile = resolve(root, '../art/textures/tex-xi-ramp.ktx2');
  if (existsSync(rampFile)) assert.deepEqual(readKtx2Size(readFileSync(rampFile)), { width: 256, height: 1 });
  const hdr = (w, h) => {
    const b = new Uint8Array(80);
    b.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(b.buffer);
    dv.setUint32(20, w, true);
    dv.setUint32(24, h, true);
    return b.buffer;
  };
  assert.deepEqual(readKtx2Size(hdr(512, 0)), { width: 512, height: 1 });
  assert.equal(readKtx2Size(new Uint8Array(80).buffer), null, '不是 KTX2');
  assert.equal(readKtx2Size(new Uint8Array(10).buffer), null, '太短');
  assert.ok(isBlockAligned(1024, 512) && isBlockAligned(4, 4));
  assert.ok(!isBlockAligned(256, 1) && !isBlockAligned(6, 8) && !isBlockAligned(8, 2));

  // 分流：256×1 → 未压缩；1024² → 压缩；未压缩 loader 第一次用到才建、只建一次；enabled=false（?rampfix=0）全走压缩
  const files = { 'ramp.ktx2': [256, 1], 'ramp2.ktx2': [16, 1], 'albedo.ktx2': [1024, 1024], 'odd.ktx2': [1022, 1024] };
  const mk = (enabled) => {
    const log = [];
    let rawMade = 0;
    const parser = (kind) => ({ parse: (buf, onLoad) => { log.push([kind, readKtx2Size(buf).width]); const t = new THREE.Texture(); t.userData.kind = kind; onLoad(t); } });
    const r = createKtx2Router({
      compressed: parser('bc7'),
      uncompressed: () => { rawMade++; return parser('rgba'); },
      fetch: async (url) => hdr(...files[url]),
      enabled,
    });
    return { r, log, raw: () => rawMade };
  };
  const a = mk(true);
  assert.equal((await a.r.loadAsync('albedo.ktx2')).userData.kind, 'bc7');
  assert.equal(a.raw(), 0, '没碰到非 4 倍数就不建未压缩 loader');
  const t = await a.r.loadAsync('ramp.ktx2');
  assert.equal(t.userData.kind, 'rgba');
  assert.equal(t.userData.ktx2Uncompressed, true);
  assert.equal((await a.r.loadAsync('ramp2.ktx2')).userData.kind, 'rgba');
  assert.equal((await a.r.loadAsync('odd.ktx2')).userData.kind, 'rgba', '通用规则：不只 ramp，宽 1022 也转');
  assert.equal(a.raw(), 1, '未压缩 loader 只建一次');
  assert.deepEqual([...a.r.uncompressedUrls].sort(), ['odd.ktx2', 'ramp.ktx2', 'ramp2.ktx2']);
  const b = mk(false);
  assert.equal((await b.r.loadAsync('ramp.ktx2')).userData.kind, 'bc7', '?rampfix=0：走原压缩路径');
  assert.equal(b.raw(), 0);
  // 解析失败要能被 loadWithRetry 看到（reject）
  const bad = createKtx2Router({ compressed: { parse: (_b, _l, onErr) => onErr(new Error('transcode')) }, uncompressed: () => null, fetch: async () => hdr(8, 8), enabled: true });
  await assert.rejects(bad.loadAsync('x.ktx2'), /transcode/);

  // workerConfig：关掉全部 *Supported → Basis 回落 RGBA32
  const cfg = disableCompressedTargets({ astcSupported: true, astcHDRSupported: false, etc1Supported: false, etc2Supported: true, dxtSupported: true, bptcSupported: true, pvrtcSupported: false });
  assert.ok(Object.values(cfg).every((v) => v === false));

  // ramp 只留第 0 级
  const lv = (w) => ({ data: new Uint8Array(w * 4), width: w, height: 1 });
  const ct = new THREE.CompressedTexture([lv(256), lv(128), lv(64), lv(1)], 256, 1, THREE.RGBAFormat);
  ct.minFilter = THREE.LinearMipmapLinearFilter;
  ct.generateMipmaps = true;
  const v0 = ct.version;
  stripToBaseLevel(ct);
  assert.equal(ct.mipmaps.length, 1);
  assert.equal(ct.mipmaps[0].width, 256);
  assert.equal(ct.minFilter, THREE.LinearFilter);
  assert.equal(ct.magFilter, THREE.LinearFilter);
  assert.equal(ct.generateMipmaps, false);
  assert.ok(ct.version > v0, 'needsUpdate');

  // 清单：四张 ramp 标了 ramp: true，且都是 ktx2
  const ramps = manifest.filter((e) => e.ramp).map((e) => e.key).sort();
  assert.deepEqual(ramps, ['tex-ramp-char', 'tex-ramp-env', 'tex-ramp-metal-wet', 'tex-xi-ramp']);
  assert.ok(manifest.filter((e) => e.ramp).every((e) => e.type === 'ktx2'));
  ok('BUG-030：KTX2 读头分流（非 4 倍数 → 未压缩 RGBA，通用；?rampfix=0 全压缩）、未压缩 loader 懒建一次、workerConfig 全关、ramp 只留第 0 级 + Linear');
}

// ---- BUG-030：资源校验规则——KTX2 宽高须为 4 的倍数，例外只有清单 ramp: true 且 ≤ 4096 texel（check-size 对 dist 用同一条）
{
  const { ktx2AlignmentVerdict, readKtx2Size, KTX2_UNALIGNED_MAX_TEXELS, rampMatcher, artRelPath } = await import('./lib/ktx2-rules.mjs');
  assert.equal(ktx2AlignmentVerdict({ name: 'a', width: 1024, height: 512, ramp: false }), null);
  assert.equal(ktx2AlignmentVerdict({ name: 'a', width: 1024, height: 512, ramp: true }), null);
  assert.match(ktx2AlignmentVerdict({ name: 'tex-x', width: 1022, height: 1024, ramp: false }), /4 的倍数/);
  assert.match(ktx2AlignmentVerdict({ name: 'tex-x', width: 256, height: 1, ramp: false }), /ramp: true/, '没标 ramp 的 256×1 也失败');
  assert.equal(ktx2AlignmentVerdict({ name: 'r', width: 256, height: 1, ramp: true }), null);
  assert.equal(ktx2AlignmentVerdict({ name: 'r', width: 4096, height: 1, ramp: true }), null);
  assert.match(ktx2AlignmentVerdict({ name: 'r', width: 4097, height: 1, ramp: true }), /≤ 4096/);
  assert.equal(KTX2_UNALIGNED_MAX_TEXELS, 4096);
  // M7：豁免按清单完整路径匹配，别的目录里的同名文件不放过
  {
    const m = rampMatcher([{ url: 'assets/art/textures/tex-xi-ramp.ktx2', ramp: true }, { url: 'assets/art/textures/tex-other.ktx2' }]);
    assert.equal(artRelPath('assets/art/textures/a.ktx2'), 'textures/a.ktx2');
    assert.equal(artRelPath('textures\\a.ktx2'), 'textures/a.ktx2');
    assert.equal(m('assets/art/textures/tex-xi-ramp.ktx2'), true, 'dist 相对路径命中');
    assert.equal(m('textures/tex-xi-ramp.ktx2'), true, '../art 相对路径命中');
    assert.equal(m('textures\\tex-xi-ramp.ktx2'), true, 'Windows 分隔符命中');
    assert.equal(m('assets/art/models/tex-xi-ramp.ktx2'), false, '别的目录同名文件不豁免');
    assert.equal(m('textures/sub/tex-xi-ramp.ktx2'), false, '子目录同名文件不豁免');
    assert.equal(m('tex-xi-ramp.ktx2'), false, '只有文件名不豁免');
    assert.equal(m('assets/art/textures/tex-other.ktx2'), false, '清单里没标 ramp 的不豁免');
    assert.match(ktx2AlignmentVerdict({ name: 'models/tex-xi-ramp.ktx2', width: 256, height: 1, ramp: m('models/tex-xi-ramp.ktx2') }), /ramp: true/);
    // batch25-5：同名拒绝时报错带完整路径（含目录）并指出清单里那张 ramp 在哪
    assert.equal(m.twin('assets/art/models/tex-xi-ramp.ktx2'), 'textures/tex-xi-ramp.ktx2', '别的目录同名 → twin');
    assert.equal(m.twin('/abs/art/textures/sub/tex-xi-ramp.ktx2'.replace('/abs/art/', '')), 'textures/tex-xi-ramp.ktx2', '子目录同名 → twin');
    assert.equal(m.twin('assets/art/textures/tex-xi-ramp.ktx2'), null, '清单 ramp 本身不是 twin');
    assert.equal(m.twin('textures/tex-unknown.ktx2'), null, '不同名 → null');
    const full = '/workspace/game-studio/art/models/props/tex-xi-ramp.ktx2';
    const msg = ktx2AlignmentVerdict({ name: full, width: 256, height: 1, ramp: m('models/props/tex-xi-ramp.ktx2'), twin: m.twin('models/props/tex-xi-ramp.ktx2') });
    assert.ok(msg.startsWith(full + ' 256×1'), '报错以完整路径开头：' + msg);
    assert.match(msg, /与清单 ramp「textures\/tex-xi-ramp\.ktx2」同名但不在同一目录/);
    const msgDist = ktx2AlignmentVerdict({ name: '/x/dist/assets/art/textures/sub/tex-xi-ramp.ktx2', width: 250, height: 1, ramp: false, twin: m.twin('assets/art/textures/sub/tex-xi-ramp.ktx2') });
    assert.match(msgDist, /^\/x\/dist\/assets\/art\/textures\/sub\/tex-xi-ramp\.ktx2 250×1：与清单 ramp「textures\/tex-xi-ramp\.ktx2」/);
    ok('KTX2 ramp 豁免按清单完整路径匹配：别的目录 / 子目录同名、只有文件名、清单未标 ramp 都不豁免；同名拒绝时报错带完整路径 + 清单 ramp 位置（batch25-5）');
  }
  // 真文件：../art 里全部 KTX2
  const isRamp = rampMatcher(manifest);
  const artRoot = resolve(root, '../art');
  const walkK = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walkK(p) : p.endsWith('.ktx2') ? [p] : []; }) : []);
  const files = walkK(artRoot);
  const problems = [];
  const unaligned = [];
  for (const f of files) {
    const sz = readKtx2Size(readFileSync(f));
    assert.ok(sz, `${f} 是 KTX2`);
    const rel = relative(artRoot, f);
    const why = ktx2AlignmentVerdict({ name: f, ...sz, ramp: isRamp(rel), twin: isRamp.twin(rel) }); // batch25-5：报完整路径
    if (why) problems.push(why);
    if (sz.width % 4 || sz.height % 4) unaligned.push(basename(f));
  }
  assert.deepEqual(problems, [], problems.join('\n'));
  ok(`BUG-030 资源校验：KTX2 宽高 4 的倍数或清单 ramp ≤ ${KTX2_UNALIGNED_MAX_TEXELS} texel；../art ${files.length} 张，非 4 倍数 ${unaligned.length} 张全是 ramp（${unaligned.sort().join(' / ')}）`);
}

console.log(`\n资源加载后处理 / 交付自检校验通过（${passed} 项）`);
