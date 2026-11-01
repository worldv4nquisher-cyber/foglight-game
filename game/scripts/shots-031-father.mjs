// batch15 D（BUG-023 / 031）：父亲接入 S3 的截图 —— 每段动画一张 + hand-on-head 摸头特写，art=1、quality=high、1600×900 → ../docs/tasks/shots-031/
//   每段都用 dev 开关 ?father=gaze|walk|hand 进 S3（同时验开关生效），等资源全部加载、建立镜头交还 explore 后再 __s3.playFather(mode) 从头播一次对时；
//   hand：在 strokeA–strokeB 之间（第 80 帧）定格两人（timeScale 不动，按游戏时间等到帧）拍全身侧面 + 头部特写，并量父亲掌心到汐头顶的距离。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/shots-031-father.mjs [gaze,walk,hand]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 汐头顶点：char-father-anims.glb extras.align.handOnHead.xiCrownRest（汐根局部、静止姿势）——不写死，随美术资源走
const XI_CROWN_REST = (() => {
  const b = readFileSync(resolve(root, '../art/models/characters/char-father-anims.glb'));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  const v = j.animations.find((a) => a.name === 'father-hand-on-head')?.extras?.align?.handOnHead?.xiCrownRest;
  if (!Array.isArray(v) || v.length !== 3) throw new Error('char-father-anims.glb 没有 xiCrownRest');
  return v;
})();
const OUT = resolve(root, '../docs/tasks/shots-031');
mkdirSync(OUT, { recursive: true });
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;
const only = process.argv[2]?.split(',').filter(Boolean) ?? null;
// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high&debug=1&scene=s3`;
const profile = mkdtempSync(join(tmpdir(), 'shots031f-chrome-'));
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

const report = { shots: [], failed: [], errors, loads: [], measure: {} };
const reportFile = join(OUT, `shots-031-father${only ? '-' + only.join('+') : ''}.json`); // 只拍部分时另存
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

async function enterS3(mode) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await send('Page.navigate', { url: `${base}&father=${mode}` }, sessionId);
    await sleep(500);
    if (!(await until(`!!window.__s3?.rig?.animator && __game.scenes.current.name === 's3-lighthouse'`, 400000))) throw new Error('S3 没就绪');
    await until('__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)', 600000);
    const ls = await evaluate(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()), degraded: document.documentElement.classList.contains('assets-fallback'), father: s.filter((x) => /father/.test(x.url)).map((x) => x.url.split('/').pop() + (x.ok ? '' : ' ✗')) }; })()`);
    report.loads.push({ mode, attempt, ...ls });
    console.log(`  加载 ${mode} #${attempt}`, JSON.stringify(ls));
    if (!ls.bad.length && !ls.degraded) return;
  }
  throw new Error('3 次进 S3 都有加载失败');
}

/** 父亲 / 汐 关键点（世界） */
const PTS = `(() => { const s = __s3, f = s.father; const V = s.scene.position.constructor; const r = f.root; r.updateMatrixWorld(true);
  const wp = (o, n) => o.getObjectByName(n)?.getWorldPosition(new V());
  const xi = s.rig.animator.model; xi.updateMatrixWorld(true);
  const fwd = new V(0, 0, 1).transformDirection(r.matrixWorld).setY(0).normalize();
  const palm = wp(r, 'hand_r').add(wp(r, 'middle_01_r') ?? wp(r, 'hand_r')).multiplyScalar(0.5);
  // 头顶点 = xiCrownRest 在静止姿势下换到 head 骨局部（取一份没播动画的新克隆），再跟当前 head 骨走
  const rest = __game.assets.getModel('char-xi'); rest.updateMatrixWorld(true);
  const crownInHead = rest.getObjectByName('head').worldToLocal(rest.localToWorld(new V(${XI_CROWN_REST.join(',')})));
  const crown = xi.getObjectByName('head').localToWorld(crownInHead.clone());
  // 汐头 r2：按蒙皮后的真网格量——head 骨 0.35 m 内 LOD0 顶点的最高点（网格头顶）和离掌心最近的顶点（掌心到头发表面）
  const hb = wp(xi, 'head'); let meshCrown = null, near = Infinity; const v = new V();
  xi.traverse((o) => { if (!o.isSkinnedMesh || /_lod[12]/.test(o.name + (o.parent?.name ?? ''))) return; const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.distanceTo(hb) > 0.35) continue;
      if (!meshCrown || v.y > meshCrown.y) meshCrown = v.clone(); near = Math.min(near, v.distanceTo(palm)); } });
  // BUG-024 袖口：手腕往前臂 18% 处为袖口中心；机位在外侧、略高、偏肘侧斜看上沿
  const cuffs = {}; for (const sd of ['l', 'r']) { const h = wp(r, 'hand_' + sd), e = wp(r, 'lower_arm_' + sd); if (!h || !e) continue; const c = h.clone().lerp(e, 0.18);
    const out = c.clone().sub(r.getWorldPosition(new V())).setY(0).normalize(); const toE = e.clone().sub(c).normalize();
    cuffs[sd] = { at: c.toArray(), eye: c.clone().addScaledVector(out, 0.42).addScaledVector(toE, 0.18).add(new V(0, 0.12, 0)).toArray() }; }
  return { cuffs, meshCrown: meshCrown?.toArray(), palmMeshCrown: meshCrown ? palm.distanceTo(meshCrown) : null, palmSurface: near, crownBoneVsMesh: meshCrown ? meshCrown.y - crown.y : null, root: r.getWorldPosition(new V()).toArray(), fwd: fwd.toArray(), head: wp(r, 'head').toArray(), chest: (wp(r, 'spine_03') ?? wp(r, 'head')).toArray(), palm: palm.toArray(), crown: crown.toArray(), aim: wp(xi, 'head').add(new V(0, 0.13, 0)).toArray(), palmCrown: palm.distanceTo(crown),
    xiRoot: xi.getWorldPosition(new V()).toArray(), mode: f.mode, frame: Math.round(f.clipTime * 30), visible: r.visible,
    lods: (() => { const out = []; r.traverse((o) => o.isLOD && out.push(o.levels.map((l) => l.distance))); return out; })() }; })()`;
const camTo = (eye, at, fov) => evaluate(`(() => { const c = __s3.camera; c.position.set(${eye.join(',')}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); return 1; })()`);
const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
const side = (f) => [f[2], 0, -f[0]]; // 水平右手方向

async function big(name, extra) {
  await setView(W, H);
  await until(`innerWidth === ${W}`, 60000);
  await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
  const pts = await evaluate(PTS);
  const file = await shot(`${name}.png`);
  report.shots.push({ name, file, frame: pts.frame, palmCrown: +pts.palmCrown.toFixed(3), palmMeshCrown: pts.palmMeshCrown == null ? null : +pts.palmMeshCrown.toFixed(3), palmSurface: +(+pts.palmSurface).toFixed(3), crownBoneVsMesh: pts.crownBoneVsMesh == null ? null : +pts.crownBoneVsMesh.toFixed(3), ...extra });
  console.log('  ✓', name, 'frame', pts.frame, 'palm→crown', pts.palmCrown.toFixed(3), 'palm→meshCrown', pts.palmMeshCrown?.toFixed(3), 'palm→surface', (+pts.palmSurface).toFixed(3), 'meshCrown−crownRest', pts.crownBoneVsMesh?.toFixed(3));
  await setView(...SMALL);
  return pts;
}

const cuffShots = async (p, tag) => {
  for (const sd of ['l', 'r']) {
    const c = p.cuffs?.[sd]; if (!c) continue;
    await camTo(c.eye, c.at, 35);
    await big(`s3-father-cuff-${sd}-${tag}`, { mode: tag, cuff: sd });
  }
};

const MODES = ['gaze', 'walk', 'hand'];
try {
  for (const mode of MODES) {
    if (only && !only.includes(mode)) continue;
    try {
      await setView(...SMALL);
      await enterS3(mode);
      // 开关生效：进场即在播
      const sw = await evaluate(`({ has: !!__s3.father, mode: __s3.father?.mode, visible: __s3.father?.visible })`);
      report.measure[mode + '-switch'] = sw;
      if (!sw.has || sw.mode !== mode || !sw.visible) throw new Error(`?father=${mode} 没生效 ` + JSON.stringify(sw));
      await until(`__game.input.context === 'explore'`, 400000);
      await evaluate(`(() => { const s = __s3; s.cameraFollow.update = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
      await evaluate(`(async () => { __s3.hideFather(); await __s3.playFather('${mode}'); return 1; })()`);
      if (mode === 'gaze') {
        await waitGame(2);
        const p = await evaluate(PTS);
        report.measure.gaze = p;
        // 正面稍偏右、略俯：父亲面朝 +Z（灯室外），相机在他前方 2.6 m
        const eye = add(add(add(p.root, p.fwd, 2.6), side(p.fwd), 0.9), [0, 1.55, 0]);
        await camTo(eye, add(p.root, [0, 1.15, 0]), 45);
        await big('s3-father-gaze', { mode, eye });
        await cuffShots(p, 'gaze');
      } else if (mode === 'walk') {
        await waitGame(3);
        const p = await evaluate(PTS);
        report.measure.walk = p;
        // 背影 + 侧面：桥上斜后方 5 m
        const eye = add(add(add(p.root, p.fwd, -4.2), side(p.fwd), 2.4), [0, 1.9, 0]);
        await camTo(eye, add(p.root, [0, 1.0, 0]), 45);
        await big('s3-father-walk', { mode, eye });
      } else {
        // 等到第 80 帧（strokeA 66 – strokeB 98 之间）定格：两人都按 clip 时间驱动，__game.freeze() 冻住（渲染照常）再拍
        await until(`__s3.father.clipTime * 30 >= 80`, 400000);
        await evaluate(`(() => { window.__unfreeze = __game.freeze(); return 1; })()`);
        const p = await evaluate(PTS);
        report.measure.hand = p;
        const mid = p.root.map((v, i) => (v + p.xiRoot[i]) / 2);
        const s = side(p.fwd);
        // 全身：父亲背对海站在汐和玻璃之间、面朝灯室里（fwd 指向室内）→ 机位放室内汐身后斜 25°（正侧面会被灯室立柱挡住）
        await camTo(add(add(add(mid, p.fwd, 2.2), s, 1.0), [0, 1.5, 0]), add(mid, [0, 1.1, 0]), 50);
        await big('s3-father-hand', { mode });
        // 机位仍按 head 骨 +0.13 m（和 r2 / r3 前的特写同一构图，便于对比）
        await camTo(add(add(add(p.aim, s, 0.95), p.fwd, -0.25), [0, 0.12, 0]), add(p.aim, [0, -0.04, 0]), 40);
        await big('s3-father-hand-closeup', { mode });
        await cuffShots(p, 'hand80');
        await evaluate(`(() => { __unfreeze(); return 1; })()`);
        // 全程事件 / 收尾：再播一遍记事件帧
        await evaluate(`(async () => { window.__fev = []; __s3.father.onEvent = (e) => __fev.push([e, Math.round(__s3.father.clipTime * 30)]); __s3.hideFather(); await __s3.playFather('hand'); return 1; })()`);
        await until(`__s3.father.time >= 6.3`, 400000);
        report.measure.handEvents = await evaluate('__fev');
        console.log('  事件', JSON.stringify(report.measure.handEvents));
      }
    } catch (e) {
      report.failed.push({ name: mode, error: String(e?.message ?? e) });
      console.log('  ✗', mode, e?.message ?? e);
      await setView(...SMALL).catch(() => {});
    }
    save();
  }
} catch (e) {
  report.failed.push({ name: 's3', error: String(e?.message ?? e) });
}
save();
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await game.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT, report.failed.length ? `（${report.failed.length} 段失败）` : '');
process.exit(0);
