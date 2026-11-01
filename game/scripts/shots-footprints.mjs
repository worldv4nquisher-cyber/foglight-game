// 033 S1 脚印贴花截图：退潮，S1 开场（跟随相机）/ 码头俯看 / 小径尽头往浮台看（开 / 关贴花）/ 近景 / 俯视 T1–T4，
// 1600×900 → ../docs/tasks/shots-030/footprints-*.png，对照 art/models/props/preview/033-footprints-proposed-path.jpg。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/shots-footprints.mjs [机位,…]
// 只进一次场景，截完显式退出（vite preview 句柄 + Chrome 一起关）。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '../docs/tasks/shots-030');
mkdirSync(OUT, { recursive: true });
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;

// [眼, 看向, fov, 选项]（S1 世界坐标）。null 眼 = 游戏本身的第三人称跟随相机（开场站位）
const VIEWS = {
  // S1 开场：码头尽头起点，跟随相机（退潮，脚印露出来；涨潮 1.6 时整片湿沙在水下）
  opening: [null, null, null, { player: 'start' }],
  // 码头上往北看整段湿沙（T1–T4 + 小径尽头 + 浮台）
  pier: [[2.6, 4.0, -6.0], [5.0, 0.1, 6.0], 50],
  // 小径尽头往浮台看（对照美术 033-footprints-proposed-path.jpg 左上 / 右上）
  pathend: [[1.2, 2.3, 2.2], [6.8, 0.1, 8.4], 60],
  'pathend-off': [[1.2, 2.3, 2.2], [6.8, 0.1, 8.4], 60, { decalOff: true }],
  // 近景（对照左下）
  close: [[3.0, 1.55, 3.6], [6.0, 0.1, 6.6], 60],
  // 俯视 T1–T4（对照右下）
  top: [[5.3, 10.5, 5.6], [5.3, 0.1, 5.95], 55],
};
const onlyViews = process.argv[2]?.split(',').filter(Boolean) ?? null;

// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high&autostart=1`;
const profile = mkdtempSync(join(tmpdir(), 'shotsfp-chrome-'));
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

const reportFile = join(OUT, 'footprints.json');
const report = { shots: [], failed: [], errors };
try {
  await setView(...SMALL);
  await send('Page.navigate', { url: base }, sessionId);
  await sleep(500);
  if (!(await until(`!!window.__s1?.rig && window.__game.scenes.current.name === 's1-ebb-shore'`, 400000))) throw new Error('S1 没就绪');
  await until(`!!__s1.art && !!__s1.dressing`, 200000);
  // 退潮（脚印在潮间带）；等建立镜头 / 演出结束交还 explore
  await evaluate(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await until(`__game.input.context === 'explore'`, 400000);
  await waitGame(1);
  const deco = await evaluate(`(() => { const s = __s1; const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    return { decals: s.dressing.decals.map((m) => ({ name: m.name, p: m.position.toArray(), yaw: m.rotation.y, rough: m.material.roughness, vis: vis(m) })), greyboxFootprintsVisible: s.greybox.decor.filter((o) => /^s1-footprint-/.test(o.name) && vis(o)).length }; })()`);
  report.decals = deco;
  console.log('  贴花', JSON.stringify(deco));
  for (const [view, [eye, at, fov, opt = {}]] of Object.entries(VIEWS)) {
    if (onlyViews && !onlyViews.includes(view)) continue;
    const name = `footprints-${view}`;
    try {
      if (eye) {
        await evaluate(`(() => { const s = __s1; s.cameraFollow.update = s.cameraFollow.__u ?? s.cameraFollow.update; s.cameraFollow.__u = s.cameraFollow.update; s.cameraFollow.update = () => {}; s.rig.entity.object3D.visible = false;
          const c = s.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at[0]}, ${at[1]}, ${at[2]}); c.updateProjectionMatrix(); return 1; })()`);
      } else {
        // 跟随相机：角色放回起点、朝向陆地，相机 yaw 跟角色背后
        await evaluate(`(() => { const s = __s1; if (s.cameraFollow.__u) s.cameraFollow.update = s.cameraFollow.__u; s.rig.entity.object3D.visible = true; const sp = s.spawns.get('start'); const b = s.rig.body; b.teleport(b.position.clone().set(sp.position.x, sp.position.y + 0.02, sp.position.z)); s.rig.controller.facing = sp.yaw + Math.PI; s.cameraFollow.yaw = sp.yaw; s.cameraFollow.pitch = sp.pitch ?? -0.22; return 1; })()`);
        await waitGame(2);
      }
      await evaluate(`(() => { for (const m of __s1.dressing.decals) m.visible = ${opt.decalOff ? 'false' : 'true'}; return 1; })()`);
      await waitGame(0.6);
      await setView(W, H);
      await until(`innerWidth === ${W}`, 60000);
      await waitFrames(3);
      const info = await evaluate(`(() => { const c = __s1.camera; return { cam: c.position.toArray().map((v) => +v.toFixed(2)), fov: c.fov, tide: __s1.puzzles.tide.state, level: +__s1.puzzles.tide.level.toFixed(2) }; })()`);
      const file = await shot(`${name}.png`);
      report.shots.push({ name, view, eye, at, fov, file, info, ...opt });
      console.log('  ✓', name, JSON.stringify(info));
      await setView(...SMALL);
    } catch (e) {
      report.failed.push({ name, error: String(e?.message ?? e) });
      console.log('  ✗', name, e?.message ?? e);
      await setView(...SMALL).catch(() => {});
    }
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
  await evaluate(`(() => { for (const m of __s1.dressing.decals) m.visible = true; return 1; })()`).catch(() => {});
} catch (e) {
  report.failed.push({ name: 's1', error: String(e?.message ?? e) });
  console.log('  ✗ s1', e?.message ?? e);
}
writeFileSync(reportFile, JSON.stringify(report, null, 2));
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await game.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT, report.failed.length ? `（${report.failed.length} 张失败）` : '');
process.exit(report.failed.length ? 1 : 0); // vite preview 留着句柄，不显式退出会一直挂着
