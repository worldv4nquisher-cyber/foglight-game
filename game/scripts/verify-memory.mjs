// 037 内存 / 显存（npm run check:release 的一环；用测试构建 --mode smoke，见 scripts/lib/test-server.mjs）：模拟一次完整通关的场景切换，看资源有没有持续增长。
//   主菜单 → 进 S1 → S2 → S3 → 回主菜单 → 新进 S1（都走 GameFlow.goToLevel / toMenu，和玩家一样的切换路径）
//   每站：加载完、停 3 s、强制 GC 后量 ——
//     - renderer.info.memory（几何体 / 贴图数）、renderer.info.programs 数；
//     - 估算显存：页面启动前包住 WebGL2 的 texStorage / texImage / compressedTexImage / bufferData / renderbufferStorage 和对应 delete，按格式每像素字节累加（近似值，不含驱动开销）；
//     - JS 堆（CDP Runtime.getHeapUsage，GC 后）；再拍堆快照拆成「对象堆」和 V8 代码区（字节码 / JIT 码，首次跑到的函数只增不减，不算泄漏）。
//   验收：通关回到 S1 后，估算显存 / 几何体 / 贴图数 / 着色器程序数 / JS 对象堆（不含 V8 代码区）都在第一次进 S1 时的 ±10% 以内；
//         回主菜单时估算显存 ≤ 第一次进 S1 的 MENU_MAX（关卡资源 / 阴影 RT / 骨骼纹理都该释放掉，菜单只剩公共资源）。
//   每站另记活着的 GL 纹理数和最大的几张（尺寸 / 格式 / 创建于哪一站），以及 GC 后仍活着的旧场景对象，泄漏时直接看是谁没释放。
//   box 上是 swiftshader，显存是「WebGL 分配量」的估算；实机显存（任务管理器 / about:gpu）由制作人桌面复测。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/verify-memory.mjs    结果 → ../docs/releases/perf/verify-memory.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';
import { launchChrome, sleep } from './lib/cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, process.env.MEMORY_OUT ?? '../docs/releases/perf');
mkdirSync(OUT, { recursive: true });
const TIER = process.env.MEMORY_TIER ?? 'ultra';
const TOL = 0.1;
const MENU_MAX = 0.5;

// 估算显存：按 WebGL 对象记字节（重复分配覆盖旧值，delete 扣掉）
const GL_TRACK = `(() => {
  const P = WebGL2RenderingContext.prototype;
  const M = (window.__glMem = { tex: 0, buf: 0, rb: 0 });
  const sizes = new WeakMap();
  const bound = { tex: new WeakMap() };
  // 每像素字节（压缩格式按块折算）
  const BPP = { 0x8058: 4, 0x8051: 3, 0x881A: 8, 0x8814: 16, 0x822E: 4, 0x822D: 2, 0x8229: 1, 0x822B: 2, 0x8C43: 4, 0x8C41: 3, 0x81A5: 2, 0x81A6: 3, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8C3A: 4, 0x8C3D: 4, 0x8D62: 2,
    0x83F0: 0.5, 0x83F1: 0.5, 0x83F2: 1, 0x83F3: 1, 0x8E8C: 1, 0x8E8D: 1, 0x9274: 0.5, 0x9275: 0.5, 0x9278: 1, 0x9279: 1, 0x93B0: 1, 0x93D0: 1, 0x8C4C: 0.5, 0x8C4F: 1, 0x8DBB: 0.5, 0x8DBD: 1 };
  const bpp = (f) => BPP[f] ?? 4;
  const first = (t, level) => level === 0 && (t === 0x0DE1 || t === 0x8515); // 2D 的 0 级 / 立方体 +X 面 0 级 = 重新分配，其余累加
  // 绑定按「纹理单元 × target」记（three 的 state 缓存按单元跳过重复 bind，只记 target 会把上传算到别的单元的纹理上）
  const curTex = new WeakMap(); // gl → {unit → {target → tex}}
  const unitOf = new WeakMap(); // gl → 当前 activeTexture 单元
  const texOf = (gl, target) => { const m = curTex.get(gl)?.[unitOf.get(gl) ?? 0]; return m ? m[target === 0x8513 || (target >= 0x8515 && target <= 0x851A) ? 0x8513 : target] : null; };
  const live = (window.__glTexLive = new Map()); // tex → {phase, w, h, fmt}
  window.__glPhase = 'boot';
  const note = (tex, w, h, fmt) => { const e = tex && live.get(tex); if (e) { e.w = Math.max(e.w, w); e.h = Math.max(e.h, h); e.fmt = fmt; } };
  const add = (obj, kind, bytes, replace) => { if (!obj) return; const prev = sizes.get(obj); if (replace && prev) M[prev.kind] -= prev.bytes; const nb = replace || !prev ? bytes : prev.bytes + bytes; sizes.set(obj, { kind, bytes: nb }); M[kind] += replace || !prev ? bytes : bytes; };
  const wrap = (name, fn) => { const o = P[name]; if (!o) return; P[name] = function (...a) { const r = o.apply(this, a); try { fn.call(this, a, r); } catch (e) { /* */ } return r; }; };
  wrap('activeTexture', function ([u]) { unitOf.set(this, u - 0x84C0); });
  wrap('createTexture', function (a, r) { if (r) live.set(r, { phase: window.__glPhase, w: 0, h: 0, fmt: 0 }); });
  wrap('bindTexture', function (a) { let m = curTex.get(this); if (!m) curTex.set(this, (m = {})); const u = unitOf.get(this) ?? 0; (m[u] ??= {})[a[0]] = a[1]; });
  wrap('texStorage2D', function ([t, levels, fmt, w, h]) { let s = 0; for (let i = 0; i < levels; i++) s += Math.max(1, w >> i) * Math.max(1, h >> i); add(texOf(this, t), 'tex', s * bpp(fmt) * (t === 0x8513 ? 6 : 1), true); note(texOf(this, t), w, h, fmt); });
  wrap('texStorage3D', function ([t, levels, fmt, w, h, d]) { let s = 0; for (let i = 0; i < levels; i++) s += Math.max(1, w >> i) * Math.max(1, h >> i) * (t === 0x8C1A ? d : Math.max(1, d >> i)); add(texOf(this, t), 'tex', s * bpp(fmt), true); note(texOf(this, t), w, h, fmt); });
  wrap('texImage2D', function (a) { if (a.length < 9 && typeof a[3] !== 'number') { const img = a[5]; add(texOf(this, a[0]), 'tex', (img?.width ?? 0) * (img?.height ?? 0) * 4, first(a[0], a[1])); return; } add(texOf(this, a[0]), 'tex', a[3] * a[4] * bpp(a[2]), first(a[0], a[1])); note(texOf(this, a[0]), a[3], a[4], a[2]); });
  wrap('compressedTexImage2D', function (a) { note(texOf(this, a[0]), a[3], a[4], a[2]); add(texOf(this, a[0]), 'tex', a[3] * a[4] * bpp(a[2]), first(a[0], a[1])); });
  wrap('texImage3D', function (a) { add(texOf(this, a[0]), 'tex', a[3] * a[4] * a[5] * bpp(a[2]), a[1] === 0); });
  wrap('deleteTexture', function ([t]) { live.delete(t); const s = t && sizes.get(t); if (s) { M[s.kind] -= s.bytes; sizes.delete(t); } });
  const curBuf = new WeakMap();
  wrap('bindBuffer', function ([target, b]) { let m = curBuf.get(this); if (!m) curBuf.set(this, (m = {})); m[target] = b; });
  wrap('bufferData', function ([target, d]) { const b = curBuf.get(this)?.[target]; add(b, 'buf', typeof d === 'number' ? d : d?.byteLength ?? 0, true); });
  wrap('deleteBuffer', function ([b]) { const s = b && sizes.get(b); if (s) { M[s.kind] -= s.bytes; sizes.delete(b); } });
  let curRb = null;
  wrap('bindRenderbuffer', function ([, r]) { curRb = r; });
  wrap('renderbufferStorage', function ([, fmt, w, h]) { add(curRb, 'rb', w * h * bpp(fmt), true); });
  wrap('renderbufferStorageMultisample', function ([, samples, fmt, w, h]) { add(curRb, 'rb', w * h * bpp(fmt) * Math.max(1, samples), true); });
  wrap('deleteRenderbuffer', function ([r]) { const s = r && sizes.get(r); if (s) { M[s.kind] -= s.bytes; sizes.delete(r); } });
})();`;

// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&debug=1&art=1&quality=${TIER}`;
const report = { at: new Date().toISOString(), tier: TIER, renderer: 'headless Chrome + swiftshader', tolerance: TOL, steps: [], failures: [] };
const reportFile = join(OUT, 'verify-memory.json');
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

const cdp = await launchChrome({ width: 960, height: 540, tag: 'memory', watchdogMs: +(process.env.MEMORY_WATCHDOG_MS ?? 60 * 60_000) });
const { send, evaluate, until } = cdp;
const MB = (b) => +(b / 1048576).toFixed(1);

// JS 堆里 V8 自己的代码区（字节码 / JIT 机器码 / 反馈向量，type = code 的节点）随「第一次跑到 S2 / S3 的函数」只增不减（有上限），
// 不是游戏对象泄漏；拍一张堆快照把它分出来，±10% 比的是「对象堆」= Runtime.getHeapUsage 的 usedSize − 代码区，总堆照样记。
// 注意不能用「快照 self_size 总和 − 代码区」：快照把 ArrayBuffer 后备存储（贴图 mip / 几何体数组，S1 极致 ~500 MB）也算成 native 节点，
// 那样 JS 对象的增减会被淹没（bad3643 第一版就是这么算的，00:32 那轮的 objHeapMB 509.7 → 509.9 不可用）。
let snapChunks = [];
cdp.on((msg) => { if (msg.method === 'HeapProfiler.addHeapSnapshotChunk') snapChunks.push(msg.params.chunk); });
async function heapSplit() {
  snapChunks = [];
  await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  const snap = JSON.parse(snapChunks.join(''));
  snapChunks = [];
  const meta = snap.snapshot.meta, NF = meta.node_fields.length, T = meta.node_types[0];
  const iT = meta.node_fields.indexOf('type'), iS = meta.node_fields.indexOf('self_size');
  let total = 0, code = 0;
  for (let i = 0; i < snap.nodes.length; i += NF) { const sz = snap.nodes[i + iS]; total += sz; if (T[snap.nodes[i + iT]] === 'code') code += sz; }
  return { total, code };
}

async function settle(label, sceneName) {
  await evaluate(`(window.__glPhase = ${JSON.stringify(label)}, 1)`);
  if (sceneName) {
    if (!(await until(`__game.scenes.current?.name === '${sceneName}' && !__game.flow.transitioning`, 900_000, 500))) throw new Error(`${label}：没进 ${sceneName}`);
    await until('__game.assets.loadStats.every((x) => x.done)', 900_000, 500);
  }
  await sleep(3000);
  const f0 = await evaluate('__game.time.frame');
  await until(`__game.time.frame >= ${f0 + 5}`, 300_000, 200);
  await send('HeapProfiler.collectGarbage');
  await sleep(500);
  await send('HeapProfiler.collectGarbage');
  const heap = await send('Runtime.getHeapUsage');
  const split = await heapSplit();
  // 已离开的场景对象 GC 后还活着 = JS 侧泄漏（事件监听 / 闭包挂着旧场景）；记下来，泄漏时直接看是哪一站
  await evaluate(`((window.__sceneRefs ??= []).push([${JSON.stringify(label)}, new WeakRef(__game.scenes.current)]), 1)`);
  await send('HeapProfiler.collectGarbage');
  const m = await evaluate(`(() => { const i = __game.renderer.info;
    const staleScenes = window.__sceneRefs.filter(([, r]) => r.deref() && r.deref() !== __game.scenes.current).map(([l]) => l);
    const big = [...window.__glTexLive.values()].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 6).map((e) => e.w + 'x' + e.h + ' 0x' + e.fmt.toString(16) + ' @' + e.phase);
    return { scene: __game.scenes.current?.name ?? null, staleScenes, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, glTextures: window.__glTexLive.size, bigTextures: big, gl: { ...window.__glMem } }; })()`);
  const row = { label, ...m, glMB: MB(m.gl.tex + m.gl.buf + m.gl.rb), texMB: MB(m.gl.tex), bufMB: MB(m.gl.buf), rbMB: MB(m.gl.rb), heapMB: MB(heap.usedSize), objHeapMB: MB(heap.usedSize - split.code), codeHeapMB: MB(split.code) };
  report.steps.push(row);
  save();
  console.log(`  ${label.padEnd(14)} ${String(row.scene).padEnd(16)} 估算显存 ${row.glMB} MB（贴图 ${row.texMB} / 缓冲 ${row.bufMB} / RB ${row.rbMB}）几何体 ${row.geometries} 贴图 ${row.textures}（GL ${row.glTextures}）着色器 ${row.programs} JS 堆 ${row.heapMB} MB（对象 ${row.objHeapMB} / 代码 ${row.codeHeapMB}）${row.staleScenes.length ? `（旧场景未回收：${row.staleScenes.join('、')}）` : ''}`);
  return row;
}

let ok = false;
try {
  await send('HeapProfiler.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: GL_TRACK });
  // 第一次进 S1 也从主菜单走 goToLevel（和玩家点「新游戏」、和后面「再进 S1」同一条路径）。
  // 之前用 ?scene=s1 直接进：不经过切场景的着色器预编译，基线比「再进 S1」少 ~10 个程序 / 2 MB 堆，比的不是同一种状态（v0.1-037）
  await send('Page.navigate', { url: base });
  await until('!!document.querySelector(\'.main-menu [data-act="new"]\')?.checkVisibility()', 300_000, 500);
  await evaluate(`(window.__glPhase = '进 S1', __game.flow.goToLevel('s1'), 1)`);
  await sleep(1000);
  const s1a = await settle('进 S1', 's1-ebb-shore');
  for (const [id, name] of [['s2', 's2-keeper-house'], ['s3', 's3-lighthouse']]) {
    await evaluate(`(window.__glPhase = '切到 ${id.toUpperCase()}', __game.flow.goToLevel('${id}'), 1)`);
    await sleep(1000);
    await settle(`切到 ${id.toUpperCase()}`, name);
  }
  await evaluate(`(window.__glPhase = '回主菜单', __game.flow.toMenu(), 1)`);
  await until('!__game.flow.transitioning && !!document.querySelector(\'.main-menu [data-act="new"]\')?.checkVisibility()', 300_000, 500);
  const menu = await settle('回主菜单', null);
  const menuRatio = menu.glMB / Math.max(1e-9, s1a.glMB);
  report.menu = { glMB: menu.glMB, firstS1: s1a.glMB, ratio: +menuRatio.toFixed(3), max: MENU_MAX, ok: menuRatio <= MENU_MAX };
  if (!report.menu.ok) report.failures.push(`回主菜单估算显存 ${menu.glMB} MB = 第一次进 S1 的 ×${menuRatio.toFixed(2)}（应 ≤ ×${MENU_MAX}，关卡资源没释放）；最大的活纹理：${menu.bigTextures.join('；')}`);
  await evaluate(`(window.__glPhase = '再进 S1', __game.flow.goToLevel('s1'), 1)`);
  await sleep(1000);
  const s1b = await settle('再进 S1', 's1-ebb-shore');
  const cmp = {};
  for (const k of ['glMB', 'geometries', 'textures', 'programs', 'objHeapMB']) {
    const r = s1b[k] / Math.max(1e-9, s1a[k]);
    cmp[k] = { first: s1a[k], again: s1b[k], ratio: +r.toFixed(3), ok: Math.abs(r - 1) <= TOL };
    if (!cmp[k].ok) report.failures.push(`${k}：第一次进 S1 ${s1a[k]} → 通关回 S1 ${s1b[k]}（×${r.toFixed(2)}，超出 ±${TOL * 100}%）`);
  }
  report.compare = cmp;
  ok = !report.failures.length;
} catch (e) {
  report.failures.push(String(e?.message ?? e));
} finally {
  report.errors = cdp.errors.slice(0, 20);
  save();
  cdp.close();
  await game.close();
}
console.log(`\n内存校验${ok ? '通过' : `：${report.failures.length} 项不通过`} → ${reportFile}`);
for (const f of report.failures) console.log('  ✗', f);
process.exit(ok ? 0 : 1);
