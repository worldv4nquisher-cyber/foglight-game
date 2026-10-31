// 037 预算校验（npm run check:release 的一环；需要先 npm run build）：
//   三个场景 × src/config/perf-spots.ts 里的机位 × 三档（极致 / 高 / 标准），无头 Chrome（swiftshader）里量：
//   - 主 pass（当前场景 scene + 场景相机那一次 renderer.render，扣掉其中的阴影贴图渲染）的三角面 / draw call ≤ style-guide §8（sceneVisibleTris / maxDrawCalls）；
//     整帧合计（含阴影、水面反射、后处理法线 / 深度 pass）只列出来，不判（§8 的是「可见场景总面数」）；
//   - 场景里所有 GLB 贴图尺寸：char- / prop- 物体 ≤ textureMaxSize，其余（环境）≤ textureMaxSizeEnv；
//   - 角色 LOD（裁定第 4 条）：汐能用到的最高一级面数 ≤ heroCharTris，父亲 ≤ npcCharTris；机位上实际显示的那一级也记下来；
//   - puzzleCritical 物体全是 LOD0（子树里没有能降级的 LOD）。
//   帧率不量（swiftshader 没意义；裁定第 8 条由用户 M8 实机填）。
// 用法：
//   node --import ./scripts/register-ts-paths.mjs scripts/verify-budget.mjs [s1,s2,s3]       校验（结果 → ../docs/releases/perf/verify-budget.json）
//   node --import ./scripts/register-ts-paths.mjs scripts/verify-budget.mjs --scan [s1,s2,s3] 扫最差机位（极致档；结果 → ../docs/releases/perf/scan-<场景>.json，挑 3 个抄进 perf-spots.ts）
//   BUDGET_SHOTS=1 每个机位极致档存一张 1280×720 截图；BUDGET_TIERS=ultra,high 只跑部分档位；BUDGET_WATCHDOG_MS 总超时（默认 60 min）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { launchChrome, sleep } from './lib/cdp.mjs';
import { PERF_SPOTS } from '../src/config/perf-spots.ts';
import { QUALITY_PRESETS } from '../src/config/quality.ts';
import { LEVELS } from '../src/scenes/levels.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, process.env.BUDGET_OUT ?? '../docs/releases/perf');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const args = process.argv.slice(2);
const SCAN = args.includes('--scan');
const scenes = (args.find((a) => !a.startsWith('--')) ?? 's1,s2,s3').split(',').filter((s) => s in LEVELS);
const TIERS = (process.env.BUDGET_TIERS ?? 'ultra,high,standard').split(',').filter((t) => t in QUALITY_PRESETS);
const SHOTS = process.env.BUDGET_SHOTS === '1';
const VIEW = [640, 360];

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&debug=1&art=1`;
const report = { at: new Date().toISOString(), mode: SCAN ? 'scan' : 'verify', view: VIEW, tiers: TIERS, scenes: {}, failures: [], errors: [] };
const reportFile = join(OUT, SCAN ? `scan-${scenes.join('+')}.json` : `verify-budget${process.argv[2] && !process.argv[2].startsWith('--') ? '-' + scenes.join('+') : ''}.json`);
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

// ---------------------------------------------------------------- 页面里的探针
/** 包一层 renderer.render / shadowMap.render：按调用栈分出每次 render 自己的 draw call / 三角面（嵌套的子 render、阴影各自扣掉） */
const PROBE = `(() => {
  if (window.__budgetProbe) return 1;
  const g = __game, r = g.renderer, info = r.info.render;
  const P = (window.__budgetProbe = { on: false, passes: [], stack: [] });
  const sm = r.shadowMap, sr = sm.render;
  sm.render = function (...a) {
    const c0 = info.calls, t0 = info.triangles;
    sr.apply(this, a);
    const top = P.stack[P.stack.length - 1];
    if (top) { top.shadowCalls += info.calls - c0; top.shadowTris += info.triangles - t0; }
  };
  const rr = r.render;
  r.render = function (scene, camera) {
    const fr = { c0: info.calls, t0: info.triangles, shadowCalls: 0, shadowTris: 0, childCalls: 0, childTris: 0 };
    P.stack.push(fr);
    try { rr.call(this, scene, camera); } finally { P.stack.pop(); }
    const totalCalls = info.calls - fr.c0, totalTris = info.triangles - fr.t0;
    const parent = P.stack[P.stack.length - 1];
    if (parent) { parent.childCalls += totalCalls; parent.childTris += totalTris; }
    if (!P.on) return;
    const cur = g.scenes.current;
    const rt = r.getRenderTarget();
    P.passes.push({
      main: scene === cur?.scene && camera === cur?.camera, override: !!scene.overrideMaterial, nested: !!parent,
      calls: totalCalls - fr.shadowCalls - fr.childCalls, tris: totalTris - fr.shadowTris - fr.childTris,
      shadowCalls: fr.shadowCalls, shadowTris: fr.shadowTris,
      target: rt ? (rt.texture?.name || rt.constructor.name) + ' ' + rt.width + 'x' + rt.height : 'screen',
    });
  };
  return 1;
})()`;

/** 量一帧：开 / 关探针各一个 rAF，正好包住游戏的一次 tick */
const MEASURE = `new Promise((res) => requestAnimationFrame(() => {
  const P = window.__budgetProbe; P.passes = []; P.on = true;
  requestAnimationFrame(() => {
    P.on = false;
    const ps = P.passes;
    const mains = ps.filter((p) => p.main && !p.override);
    const main = (mains.length ? mains : ps.filter((p) => p.main)).reduce((a, b) => (b.tris > (a?.tris ?? -1) ? b : a), null);
    const sum = (k) => ps.reduce((s, p) => s + p[k], 0);
    res({ main: main ? { calls: main.calls, tris: main.tris, target: main.target } : null,
      frame: { calls: sum('calls') + sum('shadowCalls'), tris: sum('tris') + sum('shadowTris'), shadowCalls: sum('shadowCalls'), shadowTris: sum('shadowTris'), passes: ps.length },
      passes: ps.map((p) => [p.main ? (p.override ? 'main-override' : 'main') : 'other', p.calls, p.tris, p.target, p.nested ? 'nested' : '']) });
  });
}))`;

/** 贴图尺寸 / 角色 LOD / puzzleCritical（与机位无关的部分只在每档第一次读） */
const ASSETS = `(() => {
  const g = __game, cur = g.scenes.current, q = g.quality.preset;
  const tex = new Map();
  cur.scene.traverse((o) => {
    if (!o.material) return;
    let cat = 'env';
    for (let p = o; p; p = p.parent) if (/^(char|prop)-/i.test(p.name)) { cat = 'char-prop'; break; }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      for (const k of Object.keys(m)) {
        const t = m[k];
        if (!t || !t.isTexture || t.isRenderTargetTexture) continue;
        if (!t.isCompressedTexture && !t.userData?.mimeType) continue; // 只看 GLB / KTX2 资源贴图（程序生成的 LUT / 噪声不算）
        const img = t.mipmaps?.[0] ?? t.image;
        const e = tex.get(t.uuid) ?? { name: t.name || '', w: img?.width ?? 0, h: img?.height ?? 0, compressed: !!t.isCompressedTexture, mips: t.mipmaps?.length ?? 0, cats: [], users: [] };
        if (!e.cats.includes(cat)) e.cats.push(cat);
        if (e.users.length < 3 && !e.users.includes(o.name)) e.users.push(o.name);
        tex.set(t.uuid, e);
      }
    }
  });
  const textures = [...tex.values()].map((e) => { const lim = e.cats.includes('char-prop') ? q.textureMaxSize : q.textureMaxSizeEnv; return { ...e, limit: lim, ok: Math.max(e.w, e.h) <= lim }; });
  const levelTris = (obj) => { let n = 0; obj.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.outlineHull && !o.userData.ghostPrepass) { const gg = o.geometry; n += gg.index ? gg.index.count / 3 : (gg.attributes.position?.count ?? 0) / 3; } }); return n; };
  const chars = [];
  cur.scene.traverse((o) => {
    if (!o.isLOD || !/^char-/i.test(o.name)) return;
    let top = 0;
    o.levels.forEach((l, i) => { if (i > 0 && l.distance <= 0) top = i; });
    const budget = /^char-xi$/i.test(o.name) ? q.heroCharTris : q.npcCharTris;
    const tris = o.levels.map((l) => levelTris(l.object));
    chars.push({ name: o.name, topLevel: top, topTris: tris[top], budget, tris, ok: tris[top] <= budget });
  });
  const critical = [];
  cur.scene.traverse((o) => {
    if (!(o.userData.puzzleCritical === true || o.userData.puzzleCritical === 1 || o.userData.puzzleCritical === 'true')) return;
    let bad = 0;
    o.traverse((c) => { if (c.isLOD && c.levels.length > 1 && c.levels.some((l, i) => i > 0 && Number.isFinite(l.distance))) bad++; });
    critical.push({ name: o.name, ok: bad === 0 });
  });
  return { tier: g.quality.tier ?? q.tier, textures, chars, critical };
})()`;

/** 主相机视锥里的网格按面数排前 12（按顶层有名字的祖先归并；LOD 只算当前级，instanced 乘实例数）—— 超预算时看是谁 */
const TOP = `(() => {
  const s = __game.scenes.current, cam = s.camera;
  const pm = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  const planes = []; const e = pm.elements;
  const mk = (a, b, c, d) => { const l = Math.hypot(a, b, c); planes.push([a / l, b / l, c / l, d / l]); };
  mk(e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]); mk(e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]);
  mk(e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]); mk(e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]);
  mk(e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]); mk(e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]);
  const by = new Map();
  const visibleChain = (o) => { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p.parent?.isLOD) { const L = p.parent; if (L.levels[L.getCurrentLevel()]?.object !== p) return false; } } return true; };
  s.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !visibleChain(o) || !o.layers.test(cam.layers)) return;
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    const c = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld); const r = g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
    if (o.frustumCulled !== false && planes.some((pl) => pl[0] * c.x + pl[1] * c.y + pl[2] * c.z + pl[3] < -r)) return;
    let n = (g.index ? g.index.count : g.attributes.position.count) / 3; if (g.drawRange.count !== Infinity) n = Math.min(n, g.drawRange.count / 3);
    if (o.isInstancedMesh) n *= o.count;
    let top = o; while (top.parent && top.parent !== s.scene) top = top.parent;
    const k = (top.name || top.type) + (top === o ? '' : ' › ' + (o.name || o.type));
    const key = top.name ? top.name : k;
    by.set(key, (by.get(key) ?? 0) + n);
  });
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v)]);
})()`;

const CHAR_LEVELS = `(() => { const out = {}; __game.scenes.current.scene.traverse((o) => { if (o.isLOD && /^char-/i.test(o.name)) out[o.name] = o.getCurrentLevel(); }); return out; })()`;

const setCam = (eye, at, fov) =>
  `(() => { const c = __game.scenes.current.camera; c.position.set(${eye.join(',')}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`;

// ---------------------------------------------------------------- 流程
const cdp = await launchChrome({ width: 1280, height: 720, tag: 'budget', watchdogMs: +(process.env.BUDGET_WATCHDOG_MS ?? 60 * 60_000) });
const { evaluate, until, setView } = cdp;
const waitFrames = async (n) => {
  const fr = await evaluate('__game.time.frame');
  return until(`__game.time.frame >= ${fr + n}`, 600_000);
};

async function enter(sid) {
  const name = LEVELS[sid].scene;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await cdp.send('Page.navigate', { url: `${base}&quality=ultra&scene=${sid}` });
    await sleep(500);
    if (!(await until(`window.__game?.scenes.current?.name === '${name}' && !__game.flow.transitioning`, 600_000, 500))) throw new Error(`${sid} 没进场`);
    await until('__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)', 600_000, 500);
    for (let k = 0; k < 20; k++) {
      const n0 = await evaluate('__game.assets.loadStats.length');
      await waitFrames(10);
      await until('__game.assets.loadStats.every((x) => x.done)', 600_000, 500);
      if ((await evaluate('__game.assets.loadStats.length')) === n0) break;
    }
    const ls = await evaluate(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
    console.log(`  ${sid} 加载 #${attempt}`, JSON.stringify(ls));
    if (!ls.bad.length) return ls;
  }
  throw new Error(`${sid}：3 次进场都有资源加载失败`);
}

async function freeze() {
  await evaluate(`(() => { const s = __game.scenes.current; if (s.cameraFollow) s.cameraFollow.update = () => {}; __game.time.timeScale = 0; const ui = document.getElementById('ui-root'); if (ui) ui.style.display = 'none'; return 1; })()`);
  await evaluate(PROBE);
}

async function setTier(tier) {
  await evaluate(`(() => { __game.quality.set('${tier}'); return 1; })()`);
  await waitFrames(4);
  const now = await evaluate('__game.quality.preset.tier');
  if (now !== tier) throw new Error(`切档失败：想要 ${tier}，实际 ${now}`);
}

async function verifyScene(sid) {
  const spots = PERF_SPOTS[sid] ?? [];
  const sr = (report.scenes[sid] = { load: await enter(sid), tiers: {} });
  await freeze();
  if (!spots.length) {
    report.failures.push(`${sid}：perf-spots.ts 里没有机位`);
    console.log(`  ✗ ${sid}：perf-spots.ts 里没有机位`);
    return;
  }
  for (const tier of TIERS) {
    await setTier(tier);
    const q = QUALITY_PRESETS[tier];
    const tr = (sr.tiers[tier] = { budget: { tris: q.sceneVisibleTris, calls: q.maxDrawCalls }, spots: [] });
    for (const sp of spots) {
      await evaluate(setCam(sp.eye, sp.at, sp.fov));
      await waitFrames(1);
      const m = await evaluate(MEASURE);
      const lv = await evaluate(CHAR_LEVELS);
      const top = await evaluate(TOP);
      const ok = !!m.main && m.main.tris <= q.sceneVisibleTris && m.main.calls <= q.maxDrawCalls;
      tr.spots.push({ id: sp.id, ok, main: m.main, frame: m.frame, charLevels: lv, top, passes: m.passes });
      if (!ok) report.failures.push(`${sid} ${tier} ${sp.id}：主 pass ${m.main?.tris} 面 / ${m.main?.calls} call 超过 ${q.sceneVisibleTris} / ${q.maxDrawCalls}`);
      console.log(`  ${ok ? '✓' : '✗'} ${sid} ${tier.padEnd(8)} ${sp.id.padEnd(16)} 主 pass ${m.main?.tris} 面 / ${m.main?.calls} call（整帧 ${m.frame.tris} / ${m.frame.calls}，阴影 ${m.frame.shadowTris} / ${m.frame.shadowCalls}）角色 LOD ${JSON.stringify(lv)}`);
      if (SHOTS && tier === TIERS[0]) {
        await setView(1280, 720);
        await waitFrames(2);
        await cdp.shot(join(OUT, `${sp.id}.png`), 1280, 720);
        await setView(...VIEW);
      }
      save();
    }
    const a = await evaluate(ASSETS);
    // 换档后（037 按档截 KTX2 mip、释放重传）这一档的机位都画过了：WebGL 不该有错误标志（尺寸 / 存储不匹配会在这里冒出来）
    const glErr = await evaluate('(() => { const gl = __game.renderer.getContext(); const e = []; for (let i = 0, x; i < 8 && (x = gl.getError()); i++) e.push(x); return e; })()');
    if (glErr.length) report.failures.push(`${sid} ${tier} WebGL 错误 ${glErr.map((x) => '0x' + x.toString(16)).join(', ')}`);
    const badTex = a.textures.filter((t) => !t.ok);
    const badChar = a.chars.filter((c) => !c.ok);
    const badCrit = a.critical.filter((c) => !c.ok);
    tr.textures = { count: a.textures.length, max: Math.max(0, ...a.textures.map((t) => Math.max(t.w, t.h))), compressed: a.textures.filter((t) => t.compressed).length, over: badTex };
    tr.chars = a.chars;
    tr.critical = { count: a.critical.length, bad: badCrit.map((c) => c.name) };
    for (const t of badTex) report.failures.push(`${sid} ${tier} 贴图 ${t.name || '(无名)'} ${t.w}×${t.h} > ${t.limit}（${t.cats.join('/')}：${t.users.join(', ')}）`);
    for (const c of badChar) report.failures.push(`${sid} ${tier} ${c.name} 最高可用 lod${c.topLevel} ${c.topTris} 面 > ${c.budget}`);
    for (const c of badCrit) report.failures.push(`${sid} ${tier} puzzleCritical ${c.name} 不是固定 LOD0`);
    console.log(`  ${badTex.length || badChar.length || badCrit.length ? '✗' : '✓'} ${sid} ${tier.padEnd(8)} 贴图 ${a.textures.length} 张（压缩 ${tr.textures.compressed}，最大 ${tr.textures.max}，超限 ${badTex.length}）· 角色 ${a.chars.map((c) => `${c.name} lod${c.topLevel} ${c.topTris}/${c.budget}`).join('，')} · puzzleCritical ${a.critical.length} 个（不合格 ${badCrit.length}）`);
    save();
  }
}

/** 扫机位：出生点（玩家当前位置）周围 8 个方向 + 每个可交互物周围 4 个方向的第三人称机位（后 4.5 m、高 2.2 m、看目标上方 1 m，fov 50）。
 *  LOD 在 renderer.render 里按当前相机选级，所以摆好相机后量的那一帧就是对的，不用多等（swiftshader 上一帧 10–20 s）。 */
async function scanScene(sid) {
  const sr = (report.scenes[sid] = { load: await enter(sid), candidates: [] });
  await freeze();
  await setTier('ultra');
  const pois = await evaluate(`(() => {
    const s = __game.scenes.current, V = s.camera.position.constructor, out = [];
    const p0 = s.rig?.entity?.object3D?.getWorldPosition(new V()); if (p0) out.push(['spawn', p0.toArray()]);
    for (const it of s.interaction?.items ?? []) { const p = it.object.getWorldPosition(new V()); if (p.lengthSq() > 1e-4) out.push([it.object.name || it.id || 'item', p.toArray()]); } // 挂在原点的代理物体（位置不代表实物）跳过
    return out; })()`);
  const cands = [];
  for (const [name, p] of pois) {
    const n = name === 'spawn' ? 8 : 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const eye = [p[0] - Math.sin(a) * 4.5, p[1] + 2.2, p[2] - Math.cos(a) * 4.5].map((x) => +x.toFixed(2));
      cands.push({ id: `${name}@${(k * 360) / n}`, eye, at: [p[0], p[1] + 1, p[2]].map((x) => +x.toFixed(2)), fov: 50 });
    }
  }
  console.log(`  ${sid}：${pois.length} 个兴趣点 → ${cands.length} 个候选机位`);
  for (const c of cands) {
    await evaluate(setCam(c.eye, c.at, c.fov));
    const m = await evaluate(MEASURE);
    sr.candidates.push({ ...c, tris: m.main?.tris ?? 0, calls: m.main?.calls ?? 0, frameTris: m.frame.tris, frameCalls: m.frame.calls });
    save();
  }
  const sorted = [...sr.candidates].sort((a, b) => b.tris - a.tris);
  const pick = [];
  for (const c of sorted) {
    if (pick.length >= 3) break;
    if (pick.every((p) => Math.hypot(p.eye[0] - c.eye[0], p.eye[2] - c.eye[2]) >= 4)) pick.push(c);
  }
  const byCalls = [...sr.candidates].sort((a, b) => b.calls - a.calls)[0];
  sr.pick = pick;
  sr.maxCalls = byCalls;
  console.log(`  ${sid} 面数最高 3 个：`);
  for (const c of pick) console.log(`    ${c.id}  ${c.tris} 面 / ${c.calls} call  eye ${JSON.stringify(c.eye)} at ${JSON.stringify(c.at)}`);
  console.log(`  ${sid} draw call 最多：${byCalls?.id} ${byCalls?.calls} call / ${byCalls?.tris} 面`);
}

try {
  await setView(...VIEW);
  for (const sid of scenes) {
    try {
      await (SCAN ? scanScene(sid) : verifyScene(sid));
    } catch (e) {
      report.failures.push(`${sid}：${e?.message ?? e}`);
      console.log(`  ✗ ${sid}`, e?.message ?? e);
    }
    save();
  }
} finally {
  report.errors = cdp.errors.slice(0, 20);
  save();
  cdp.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(`\n${SCAN ? '扫描' : '预算校验'}${report.failures.length ? `：${report.failures.length} 项不通过` : '通过'} → ${reportFile}`);
for (const f of report.failures) console.log('  ✗', f);
process.exit(SCAN ? 0 : report.failures.length ? 1 : 0);
