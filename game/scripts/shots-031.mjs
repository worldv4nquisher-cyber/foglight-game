// batch15 截图（031）：S1 开场 涨 / 退潮、开场跟随相机、小径尽头、码头、涨潮码头倒影、汐下摆 / 袖口特写，art=1、quality=high，1600×900 → ../docs/tasks/shots-031/
//   开场机位照美术预览页 art/tools/preview/env.html（opening：眼 (−0.9, 4.2, 9.5)、俯仰 0、fov 40）；对照 art/models/env/preview/s1-opening-*-polish-compare.png、
//   art/models/characters/preview/char-xi-hem-polish-closeup.png、char-xi-cuff-polish-closeup.png。
//   另做遮挡检查：018 新加的 9 块前景礁石（rocks.ts 第 156–164 项）在 开场 / 小径尽头 / 初始跟随 三个机位里，相机 → 脚印 T1–T4（包围盒角点 + 中心）
//   和 小径尽头 → 浮台 路线（地面 + 身体高度）的视线是否被挡（逐三角形求交，LOD0）→ shots-031.json 的 occlusion。
// 用法：npm run build && node --import ./scripts/register-ts-paths.mjs scripts/shots-031.mjs [名字前缀,…]；SHOTS_ATMO=预设名 → 加 &atmo=，文件名加后缀
// 只进一次场景，机位挨个摆；截图前等 GLB / KTX2 全部加载完且无占位（有占位就整页重进，最多 3 次）；场景内等待按游戏时间 / 帧数；平时小窗，截图时切 1600×900。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { S1_ROCKS } from '../src/levels/s1/rocks.ts';
import { S1 } from '../src/levels/s1/layout.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '../docs/tasks/shots-031');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;
const only = process.argv[2]?.split(',').filter(Boolean) ?? null;
const ATMO = process.env.SHOTS_ATMO ?? '';
const SUFFIX = ATMO ? `-${ATMO}` : '';
// 018 新加的 9 块（rocks.ts 第 155 项之后）
const NEW_ROCKS = S1_ROCKS.slice(155).map((r) => r.translation);
if (NEW_ROCKS.length !== 9) throw new Error('rocks.ts 新礁石不是 9 块：' + NEW_ROCKS.length);

const OPENING = [[-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40];
const PATHEND = [[1.2, 2.3, 2.2], [6.8, 0.1, 8.4], 60];
// [名字, 潮位, 眼, 看向, fov, 是否显示汐, 特殊]；眼 = null 时按 特殊 现算
const VIEWS = [
  ['s1-opening-high', 'high', ...OPENING, true],
  ['s1-opening-low', 'low', ...OPENING, true],
  ['s1-follow-start-low', 'low', null, null, null, true, 'follow'],
  ['s1-pathend-low', 'low', ...PATHEND, false],
  ['s1-pier-high', 'high', [2.5, 3.2, -3.5], [-5, 0.6, -11], 50, true],
  ['s1-pier-low', 'low', [2.5, 3.2, -3.5], [-5, 0.6, -11], 50, true],
  // 涨潮码头倒影：码头北侧、贴水 0.7 m 看码头中段（码头中点 (−3.39, −9.8)，甲板 2.2，水位 1.6）；美术同款构图看 s1-opening-high
  ['s1-pier-reflection-high', 'high', [-2.2, 2.3, -2.4], [-3.6, 1.2, -9.8], 55, true],
  ['s1-xi-hem', 'high', null, null, 35, true, 'hem'],
  ['s1-xi-cuff-r', 'high', null, null, 35, true, 'cuff-r'],
  ['s1-xi-cuff-l', 'high', null, null, 35, true, 'cuff-l'],
  ['s1-xi-cuff-side', 'high', null, null, 35, true, 'cuff-side'],
  // 汐头部精修 r2：正脸 / 侧脸近景（对照 art/models/characters/preview/char-xi-head-r2-*-compare.png）
  ['s1-xi-face-front', 'high', null, null, 30, true, 'face-front'],
  ['s1-xi-face-side', 'high', null, null, 30, true, 'face-side'],
];

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high${ATMO ? '&atmo=' + ATMO : ''}`;
const profile = mkdtempSync(join(tmpdir(), 'shots031-chrome-'));
const chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('Chrome 启动超时')), 30000);
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } });
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
let wsClosed = false;
ws.addEventListener('close', () => { wsClosed = true; for (const p of pending.values()) p.rej(new Error('Chrome 连接断了')); pending.clear(); });
chrome.on('exit', (c, sig) => { console.log('  ! Chrome 退出', c, sig); try { ws.close(); } catch { /* */ } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { if (wsClosed) return rej(new Error('Chrome 连接断了')); const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
const setView = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
const SMALL = [480, 270];
const EVAL_MS = 600000;
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时（页面无响应）')), EVAL_MS)),
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expr, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (wsClosed) throw new Error('Chrome 连接断了'); if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, sessionId);
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  return join(OUT, file);
};
/** 等游戏时间前进 sec 秒 */
const waitGame = async (sec) => {
  const t0 = await evaluate('__game.time.elapsed');
  await until(`__game.time.elapsed >= ${t0 + sec}`, 400000);
};
const waitFrames = async (n) => {
  const fr = await evaluate('__game.time.frame');
  await until(`__game.time.frame >= ${fr + n}`, 600000);
};

const report = { atmo: ATMO || '(默认)', shots: [], failed: [], errors, loads: [], occlusion: {} };
// 只拍部分（argv[2]）时报告另存，不覆盖全量报告
const reportFile = join(OUT, `shots-031${SUFFIX}${only ? '-' + only.join('+') : ''}.json`);
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

/** 进 S1 并等全部 GLB / KTX2 加载完：有失败 / 占位就整页重进（负载高时 vite preview 偶发 Failed to fetch） */
async function enterS1() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await send('Page.navigate', { url: `${base}&autostart=1` }, sessionId);
    await sleep(500);
    if (!(await until(`!!window.__s1?.rig && window.__game.scenes.current.name === 's1-ebb-shore'`, 400000))) throw new Error('S1 没就绪');
    await until('!!__s1.art && !!__s1.dressing', 200000);
    // 加载不是游戏逻辑等待，按墙钟兜底 10 min
    await until('__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)', 600000);
    const ls = await evaluate(`(() => { const s = __game.assets.loadStats; return { n: s.length, pending: s.filter((x) => !x.done).length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()), retried: s.filter((x) => x.attempts > 1).map((x) => x.url.split('/').pop() + '×' + x.attempts), degraded: document.documentElement.classList.contains('assets-fallback'), xi: s.filter((x) => /tex-xi-|char-xi/.test(x.url)).map((x) => x.url.split('/').pop() + (x.ok ? '' : ' ✗')) }; })()`);
    report.loads.push({ attempt, ...ls });
    console.log(`  加载 #${attempt}`, JSON.stringify(ls));
    if (!ls.pending && !ls.bad.length && !ls.degraded) return;
  }
  throw new Error('3 次进 S1 都有贴图 / 模型加载失败（占位），不截图');
}

// 页面内：相机 → 目标点 的视线有没有被 018 新加的 9 块礁石挡住（LOD0 网格逐三角形求交，局部空间）
const OCCLUDE_FN = `(cam, targets, newRocks) => {
  const s = __s1; const sets = s.art.rocks; const V = s.camera.position.constructor;
  const inst = [];
  for (const set of sets) {
    const geo = set.levels[0].mesh.geometry; if (!geo.boundingBox) geo.computeBoundingBox();
    set.placements.forEach((m, k) => {
      const t = new V().setFromMatrixPosition(m);
      const idx = newRocks.findIndex((r) => Math.hypot(r[0] - t.x, r[1] - t.y, r[2] - t.z) < 0.01);
      if (idx < 0) return;
      const w = set.instanceMatrix(k, 0); inst.push({ id: set.name + '#' + k + '(新' + (idx + 1) + ')', inv: w.clone().invert(), geo });
    });
  }
  const hitSeg = (it, a, b) => {
    const A = a.clone().applyMatrix4(it.inv), B = b.clone().applyMatrix4(it.inv); const d = B.clone().sub(A); const L = d.length(); d.divideScalar(L);
    const bb = it.geo.boundingBox; // 先粗筛：线段 vs 局部包围盒（slab）
    let t0 = 0, t1 = L; for (const ax of ['x', 'y', 'z']) { const inv = 1 / d[ax]; let ta = (bb.min[ax] - A[ax]) * inv, tb = (bb.max[ax] - A[ax]) * inv; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false; }
    const pos = it.geo.attributes.position, ix = it.geo.index; const n = ix ? ix.count : pos.count;
    const p0 = new V(), p1 = new V(), p2 = new V(), e1 = new V(), e2 = new V(), h = new V(), q = new V(), sv = new V();
    for (let i = 0; i < n; i += 3) {
      p0.fromBufferAttribute(pos, ix ? ix.getX(i) : i); p1.fromBufferAttribute(pos, ix ? ix.getX(i + 1) : i + 1); p2.fromBufferAttribute(pos, ix ? ix.getX(i + 2) : i + 2);
      e1.subVectors(p1, p0); e2.subVectors(p2, p0); h.crossVectors(d, e2); const det = e1.dot(h); if (Math.abs(det) < 1e-9) continue;
      const f = 1 / det; sv.subVectors(A, p0); const u = f * sv.dot(h); if (u < 0 || u > 1) continue; q.crossVectors(sv, e1); const v = f * d.dot(q); if (v < 0 || u + v > 1) continue;
      const t = f * e2.dot(q); if (t > 1e-4 && t < L - 0.05) return true;
    }
    return false;
  };
  const c = new V(...cam); const cm = s.camera; cm.updateMatrixWorld(true);
  const res = [];
  for (const [label, p] of targets) {
    const P = new V(...p); const ndc = P.clone().project(cm); const inView = ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    const by = inst.filter((it) => hitSeg(it, c, P)).map((it) => it.id);
    res.push({ label, inView, blockedByNew: by });
  }
  return { newRockInstances: inst.length, res };
}`;
async function occlusion(name) {
  // 目标：T1–T4 贴花包围盒 8 角 + 中心；小径尽头 → 浮台路线 11 点 × 地面 / 身体 1.0 m
  const decals = await evaluate(`(() => { const out = []; for (const m of __s1.dressing.decals) { m.updateMatrixWorld(true); const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; const V = m.position.constructor;
    out.push([m.name.replace('s1-footprints-decal-', '') + ' 中心', m.getWorldPosition(new V()).toArray()]);
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push([m.name.replace('s1-footprints-decal-', '') + ' 角', new V(x, y, z).applyMatrix4(m.matrixWorld).toArray()]); }
    return out; })()`);
  const a = S1.reefPathEnd, h = S1.raft.home, route = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; const p = [a[0] + (h[0] - a[0]) * t, a[1] + (h[1] - a[1]) * t, a[2] + (h[2] - a[2]) * t]; route.push([`路线 ${i}/10 地面`, [p[0], p[1] + 0.15, p[2]]], [`路线 ${i}/10 身体`, [p[0], p[1] + 1.0, p[2]]]); }
  const cam = await evaluate('__s1.camera.position.toArray()');
  const r = await evaluate(`(${OCCLUDE_FN})(${JSON.stringify(cam)}, ${JSON.stringify([...decals, ...route])}, ${JSON.stringify(NEW_ROCKS)})`);
  const blocked = r.res.filter((x) => x.blockedByNew.length);
  const sum = { cam: cam.map((v) => +v.toFixed(2)), newRockInstances: r.newRockInstances, targets: r.res.length, inView: r.res.filter((x) => x.inView).length,
    footprintsInView: r.res.filter((x) => x.inView && /^T\d/.test(x.label)).length, routeInView: r.res.filter((x) => x.inView && /^路线/.test(x.label)).length,
    blockedByNew: blocked.length, blocked: blocked.map((x) => `${x.label}${x.inView ? '' : '（画外）'} ← ${x.blockedByNew.join(',')}`) };
  report.occlusion[name] = sum;
  console.log(`  遮挡 ${name}：新礁石实例 ${sum.newRockInstances}，目标 ${sum.targets}（画内 ${sum.inView}：脚印点 ${sum.footprintsInView}、路线点 ${sum.routeInView}），被新礁石挡 ${sum.blockedByNew}`, sum.blocked.slice(0, 6).join(' | '));
}

/**
 * 汐特写机位：正面按骨骼现算——两脚 foot → toe 的水平方向平均（脚尖朝向 = 身体正面）；没有脚骨时退回 coat_back → coat_front。
 * batch15 修：原来取实体根节点 +Z，但 PlayerController 转的是子节点 visual（根节点不转），按出生朝向转了约 90° 后
 * s1-xi-hem 拍成了腰侧。xiCam 返回 front / rootFront 夹角，报告里能看出两者是否一致。
 */
const xiCam = (kind, fov) => `(() => { const s = __s1; const o = s.rig.entity.object3D; o.updateMatrixWorld(true); const V = o.position.constructor;
  const p = o.getWorldPosition(new V()); const wp = (n) => o.getObjectByName(n)?.getWorldPosition(new V()) ?? null;
  const rootF = o.getWorldDirection(new V()).setY(0).normalize();
  let f = null; const tl = wp('toe_l'), fl = wp('foot_l'), tr = wp('toe_r'), fr = wp('foot_r');
  if (tl && fl && tr && fr) f = tl.clone().sub(fl).add(tr.clone().sub(fr)).setY(0);
  if (!f || f.lengthSq() < 1e-6) { const cf = wp('coat_front_l_01'), cb = wp('coat_back_01'); if (cf && cb) f = cf.sub(cb).setY(0); }
  if (!f || f.lengthSq() < 1e-6) f = rootF.clone();
  f.normalize(); const frontVsRootDeg = +(Math.acos(Math.max(-1, Math.min(1, f.dot(rootF)))) * 180 / Math.PI).toFixed(1);
  const up = new V(0, 1, 0); const c = s.camera; let eye, at;
  const cuff = (sd) => { const hand = o.getObjectByName('hand_' + sd), el = o.getObjectByName('lower_arm_' + sd); const w = hand.getWorldPosition(new V()); return w.lerp(el.getWorldPosition(new V()), 0.18); };
  let headFwd = null, headVsBodyDeg = null;
  if ('${kind}' === 'face-front' || '${kind}' === 'face-side') {
    // 脸朝向按 head 骨现在的世界旋转算（idle 时头会偏转 / 低头，脚尖方向不准）：bind 时模型面朝 +Z → head 骨局部的「前」= inv(bind 旋转)·+Z
    let sm = null; o.traverse((m) => { if (!sm && m.isSkinnedMesh && m.skeleton.bones.some((b) => b.name === 'head')) sm = m; });
    const Q = c.quaternion.constructor; const hb = sm.skeleton.bones.find((b) => b.name === 'head');
    const bindQ = new Q(); { const M = sm.skeleton.boneInverses[sm.skeleton.bones.indexOf(hb)].clone().invert(); const pp = new V(), ss = new V(); M.decompose(pp, bindQ, ss); }
    headFwd = new V(0, 0, 1).applyQuaternion(bindQ.clone().invert()).applyQuaternion(hb.getWorldQuaternion(new Q())).setY(0).normalize();
    headVsBodyDeg = +(Math.acos(Math.max(-1, Math.min(1, headFwd.dot(f)))) * 180 / Math.PI).toFixed(1);
    const hs = new V().crossVectors(up, headFwd).normalize();
    const hd = hb.getWorldPosition(new V()); at = hd.clone().add(new V(0, 0.07, 0)).addScaledVector(headFwd, 0.05);
    eye = at.clone().addScaledVector('${kind}' === 'face-front' ? headFwd : hs, 0.75).add(new V(0, 0.02, 0));
  }
  else if ('${kind}' === 'hem') { at = new V(p.x, p.y + 0.85, p.z); eye = at.clone().addScaledVector(f, 1.0).add(new V(0, 0.08, 0)); }
  else if ('${kind}' === 'cuff-side') { at = cuff('r'); const out = at.clone().sub(p).setY(0).normalize(); eye = at.clone().addScaledVector(out, 0.55).add(new V(0, 0.05, 0)); }
  else { const sd = '${kind}'.slice(-1); at = cuff(sd); const out = at.clone().sub(p).setY(0).normalize(); eye = at.clone().addScaledVector(f, 0.55).addScaledVector(out, 0.18).add(new V(0, 0.06, 0)); }
  c.position.copy(eye); c.fov = ${fov}; c.lookAt(at); c.updateProjectionMatrix(); return { eye: eye.toArray().map((v) => +v.toFixed(3)), at: at.toArray().map((v) => +v.toFixed(3)), front: f.toArray().map((v) => +v.toFixed(3)), frontVsRootDeg, headFwd: headFwd?.toArray().map((v) => +v.toFixed(3)) ?? null, headVsBodyDeg }; })()`;

try {
  await setView(...SMALL);
  await enterS1();
  await evaluate(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
  // 等建立镜头 / 演出交还 explore，跟随相机才是游戏本身的状态
  await until(`__game.input.context === 'explore'`, 400000);
  await evaluate(`(() => { const f = __s1.cameraFollow; f.__u = f.update; return 1; })()`);
  await waitGame(1);
  for (const [name0, tide, eye, at, fov, showXi, special] of VIEWS) {
    const name = name0 + SUFFIX;
    if (only && !only.some((o) => name0.startsWith(o))) continue;
    try {
      await evaluate(`(() => { const s = __s1; s.puzzles.tide.set('${tide}', { instant: true }); s.rig.entity.object3D.visible = ${showXi}; return 1; })()`);
      let cam = null;
      if (special === 'follow') {
        // 初始跟随：角色放回起点，相机 yaw / pitch 用出生点的值，跟随系统照常跑
        await evaluate(`(() => { const s = __s1; s.cameraFollow.update = s.cameraFollow.__u; const sp = s.spawns.get('start'); const b = s.rig.body; b.teleport(b.position.clone().set(sp.position.x, sp.position.y + 0.02, sp.position.z)); s.rig.controller.facing = sp.yaw + Math.PI; s.cameraFollow.yaw = sp.yaw; s.cameraFollow.pitch = sp.pitch ?? -0.22; return 1; })()`);
        await waitGame(2);
      } else {
        await evaluate(`(() => { const f = __s1.cameraFollow; f.update = () => {}; return 1; })()`);
        await waitGame(1);
        if (eye) await evaluate(`(() => { const c = __s1.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); return 1; })()`);
        else cam = await evaluate(xiCam(special, fov));
      }
      await waitGame(0.6);
      await setView(W, H);
      await until(`innerWidth === ${W}`, 60000);
      await waitFrames(3);
      if (/opening-low|follow-start|pathend/.test(name0)) await occlusion(name0);
      const info = await evaluate(`(() => { const s = __s1; return { tide: s.puzzles.tide.state, level: +s.puzzles.tide.level?.toFixed?.(2), cam: s.camera.position.toArray().map((v) => +v.toFixed(2)), fov: s.camera.fov, player: s.rig.body.position.toArray().map((v) => +v.toFixed(2)) }; })()`).catch((e) => ({ err: String(e) }));
      const file = await shot(`${name}.png`);
      report.shots.push({ name, tide, eye, at, fov, special, xiCam: cam, file, info });
      console.log('  ✓', name, JSON.stringify(info));
      await setView(...SMALL);
    } catch (e) {
      report.failed.push({ name, error: String(e?.message ?? e) });
      console.log('  ✗', name, e?.message ?? e);
      await setView(...SMALL).catch(() => {});
    }
    save();
  }
} catch (e) {
  report.failed.push({ name: 's1', error: String(e?.message ?? e) });
  console.log('  ✗', e?.message ?? e);
}
save();
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await new Promise((r) => server.httpServer.close(r));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT, report.failed.length ? `（${report.failed.length} 张失败）` : '');
process.exit(0); // vite preview 留着句柄，不显式退出会一直挂着
