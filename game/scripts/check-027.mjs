// v0.1-027 剧情物件运行时检查（真浏览器 + 美术）：S1 / S2 / S3 各进一次，读 dressing 挂载结果（挂点、桌面实测偏差）、交互焦点是否改读美术 -interact、
// 白盒载体是否隐身、脚印贴花 / 海鸟；每件物件拍一张近景（960×540，standard 档）到 docs/tasks/shots-027/。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/check-027.mjs（自动建临时测试构建；SMOKE_DIST=已建好的测试构建 可选）
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '../docs/tasks/shots-027');
mkdirSync(OUT, { recursive: true });
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 960, H = 540;

const only = process.argv[2]; // 只跑名字以此开头的场景，例：s2

// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&autostart=1&art=1&quality=standard`;
const profile = mkdtempSync(join(tmpdir(), 'shots-chrome-'));
const chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('Chrome 启动超时')), 20000);
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
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
// SwiftShader 1600×900 极致档一帧要好几秒：进场 / 建立镜头用小视口跑，摆好机位再切到 1600×900 出图
const setView = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
const SMALL = [480, 270];
await setView(...SMALL);
const evaluate = async (expression) => {
  // 墙钟兜底 300 s：SwiftShader GPU 进程崩掉重启时 Runtime.evaluate 会一直不回
  const r = await Promise.race([send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId), new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时 300 s')), 300000))]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expr, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, sessionId);
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  return join(OUT, file);
};
/** 等游戏时间前进 sec 秒（无头单帧截断 0.25 s） */
const waitGame = async (sec) => {
  const t0 = await evaluate('__game.time.elapsed');
  await until(`__game.time.elapsed >= ${t0 + sec}`, 300000);
};


// 只跑部分场景时和上次的结果合并
const prev = (() => { try { return JSON.parse(readFileSync(join(OUT, 'check-027.json'), 'utf8')); } catch { return null; } })();
const report = { scenes: { ...(prev?.scenes ?? {}) }, errors };
const SCENES = [
  { q: '', name: 's1-ebb-shore', focus: [['s1-notice', 'prop-notice-board-s1']], props: ['prop-notice-board-s1', 'prop-letter-a-s1', 's1-footprints-decal'] },
  { q: 'debug=1&scene=s2', name: 's2-keeper-house', focus: [['journal-s2', 'prop-journal-father-s2']], props: ['prop-journal-father-s2', 'prop-letter-c-s2', 'prop-desk-set-a-s2', 'prop-kitchen-set-a-s2', 'prop-cup-tin-s2-a', 'prop-sketch-sheet-s2'] },
  { q: 'debug=1&scene=s3', name: 's3-lighthouse', focus: [['logbook-s3', 'prop-logbook-s3']], props: ['prop-logbook-s3', 'prop-letter-b-s3', 'prop-journal-father-s3'] },
];
for (const sc of SCENES.filter((x) => !only || x.name.startsWith(only))) {
  try {
  console.log('  …', sc.name);
  await setView(...SMALL);
  await send('Page.navigate', { url: `${base}${sc.q ? '&' + sc.q : ''}` }, sessionId);
  await sleep(500);
  if (!(await until(`(() => { const s = __game.scenes.current; return !!s && s.name.startsWith('${sc.name.slice(0, 2)}') && !!s.rig && !!s.art; })()`, 240000))) {
    report.scenes[sc.name] = { error: '没就绪 ' + (await evaluate('__game.scenes.current?.name').catch(() => '?')) };
    console.log('  ✗', sc.name, '没就绪');
    continue;
  }
  const info = await evaluate(`(() => {
    const s = __game.scenes.current;
    const mounted = s.dressing?.mounted ?? s.dressing ?? [];
    const out = { scene: s.name, mounted: mounted.map((m) => ({ id: m.id, at: m.at, parent: m.model.parent?.name, surfaceOffset: m.surfaceOffset == null ? m.surfaceOffset : +m.surfaceOffset.toFixed(4), snapped: m.snapped, pos: m.model.getWorldPosition(new m.model.position.constructor()).toArray().map((v) => +v.toFixed(3)), visibleMeshes: (() => { let n = 0; m.model.traverse((o) => { if (!o.isMesh) return; let v = true; for (let x = o; x; x = x.parent) if (!x.visible) v = false; if (v) n++; }); return n; })() })) };
    out.focus = ${JSON.stringify(sc.focus)}.map(([iid, did]) => {
      const it = s.interaction.get(iid);
      const m = mounted.find((x) => x.id === did);
      if (!it || !m) return { iid, missing: !it ? 'interactable' : 'dressing' };
      const f = it.focus();
      let node = null; m.model.traverse((o) => { if (/-interact$/.test(o.name)) node = o; });
      return { iid, focus: f.toArray().map((v) => +v.toFixed(3)), fromArt: !!node && node.getWorldPosition(f.clone()).distanceTo(f) < 1e-4 };
    });
    out.carriers = []; s.scene.traverse((o) => { if (o.userData.dressingCarrier) out.carriers.push(o.name + (o.material.visible ? ' 可见!' : '')); });
    if (s.dressing?.decals?.length) out.decal = s.dressing.decals.map((d) => ({ name: d.name, pos: d.position.toArray().map((v) => +v.toFixed(3)), rot: [d.rotation.x, d.rotation.y].map((v) => +v.toFixed(3)), map: !!d.material.map, roughness: d.material.roughness }));
    if (s.dressing && 'seabird' in s.dressing) out.seabird = s.dressing.seabird ? { visible: s.dressing.seabird.object.visible, action: !!s.dressing.seabird.action, morph: (() => { let n = 0; s.dressing.seabird.object.traverse((o) => o.morphTargetInfluences && n++); return n; })() } : null;
    return out;
  })()`);
  report.scenes[sc.name] = info;
  console.log('  ✓', sc.name, JSON.stringify(info));
  // 近景：挂件上方 0.5 m、后 0.7 m 看过去（隐藏角色，接管相机）
  for (const id of sc.props) {
    const ok = await evaluate(`(() => {
      const s = __game.scenes.current;
      const o = s.scene.getObjectByName('${id}');
      if (!o) return false;
      s.cameraFollow.update = () => {};
      if (s.rig) s.rig.entity.object3D.visible = false;
      if (!/lens=1/.test(location.search)) { s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); }
      const V = o.position.constructor;
      const p = o.getWorldPosition(new V());
      let r = 0.35; o.traverse((m) => { if (m.isMesh && m.geometry) { m.geometry.computeBoundingSphere(); r = Math.max(r, m.geometry.boundingSphere.radius); } });
      const big = /notice|decal/.test('${id}');
      const c = s.camera;
      const back = new V(0.25, big ? 0.9 : 0.75, big ? 1 : 0.65).normalize().multiplyScalar(big ? Math.max(3, r * 2.2) : Math.max(0.55, r * 2.6));
      const q = o.getWorldQuaternion(new c.quaternion.constructor());
      const eye = p.clone().add(back.applyQuaternion(q));
      c.position.copy(eye); c.fov = 45; c.lookAt(p.clone().add(new V(0, big && /notice/.test('${id}') ? 1.1 : 0.02, 0))); c.updateProjectionMatrix();
      return true;
    })()`);
    if (!ok) { console.log('    · 没有', id); continue; }
    await waitGame(0.5);
    await setView(W, H);
    const fr = await evaluate('__game.time.frame');
    await until(`__game.time.frame >= ${fr + 2} && innerWidth === ${W}`, 600000);
    console.log('    📷', await shot(`${sc.name}-${id}.png`));
    await setView(...SMALL);
  }
  } catch (e) {
    report.scenes[sc.name] = { ...(report.scenes[sc.name] ?? {}), error: String(e.message ?? e) };
    console.log('  ✗', sc.name, e.message ?? e);
  }
}
writeFileSync(join(OUT, 'check-027.json'), JSON.stringify(report, null, 2));
if (errors.length) console.log('  页面错误：', errors.slice(0, 8));
ws.close();
chrome.kill('SIGKILL');
await game.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT);
