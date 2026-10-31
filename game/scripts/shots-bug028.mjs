// BUG-028 #157 南沿窄缝相机贴头 前后对比 → ../docs/tasks/shots-bug028/（art=1、high）
//   同一机位：低潮（instant），汐站在窄缝（x 10.5，深水边界 z −8.95 往北 0.4 m），探索相机按游戏逻辑跑 1.5 s 稳定后冻结截图；
//   记录相机到头部跟随点（脚底 + pivotHeight 1.35）的距离、相机偏移 / 抬高 / 淡出不透明度（新 dist 才有）。
//   同一份 dist、同一次会话：before = 运行时把 BUG-028 新参数关掉模拟修前（shoulderSkin 0、不换肩、不抬高、不淡出；
//   Node 量测与修前代码逐行一致，见 measure-before.json），after = 默认参数。
// 用法：npx vite build && node --import ./scripts/register-ts-paths.mjs scripts/shots-bug028.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(root, process.env.SHOTS_DIST ?? 'dist');
const OUT = resolve(root, process.env.SHOTS_OUT ?? '../docs/tasks/shots-bug028');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error('先 npm run build');
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;
const ATMO = process.env.SHOTS_ATMO ?? '';
let EXTRA = '';

const server = await preview({ root, build: { outDir: DIST }, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high${ATMO ? '&atmo=' + ATMO : ''}`;
const WATCHDOG = setTimeout(() => { console.log('  ! 看门狗到点，强退'); try { chrome.kill('SIGKILL'); } catch { /* */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ } process.exit(2); }, +(process.env.SHOTS_WATCHDOG_MS ?? 1200000));
const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-shotsbug028-'));
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
  else if (m.method === 'Inspector.targetCrashed' || m.method === 'Target.targetCrashed') { crashed = true; console.log('  ! 页面崩溃（多半是 swiftshader 内存）'); for (const p of pending.values()) p.rej(new Error('页面崩溃')); pending.clear(); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
let wsClosed = false;
let crashed = false;
ws.addEventListener('close', () => { wsClosed = true; for (const p of pending.values()) p.rej(new Error('Chrome 连接断了')); pending.clear(); });
chrome.on('exit', (c, sig) => { console.log('  ! Chrome 退出', c, sig); try { ws.close(); } catch { /* */ } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { if (wsClosed) return rej(new Error('Chrome 连接断了')); if (crashed) return rej(new Error('页面崩溃')); const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Inspector.enable', {}, sessionId).catch(() => {});
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

const report = { atmo: ATMO || '(默认)', shots: [], failed: [], errors, loads: [], stats: [] };
// 只拍部分（argv[2]）时报告另存，不覆盖全量报告
const reportFile = join(OUT, 'shots-bug028.json');
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

/** 进 S1 并等全部 GLB / KTX2 加载完：有失败 / 占位就整页重进（负载高时 vite preview 偶发 Failed to fetch） */
async function enterS1() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await send('Page.navigate', { url: `${base}${EXTRA}&autostart=1` }, sessionId);
    await sleep(500);
    if (!(await until(`!!window.__s1?.rig && window.__game.scenes.current.name === 's1-ebb-shore'`, 400000))) throw new Error('S1 没就绪');
    await until('!!__s1.art && !!__s1.dressing', 200000);
    // 加载不是游戏逻辑等待，按墙钟兜底 10 min
    await until('__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)', 600000);
    // 美术分批发请求（?lightmap=0 时第一批更早完）：全部完成后再等 1 s 游戏时间，条目数不变才算加载完
    for (let k = 0; k < 20; k++) {
      const n0 = await evaluate('__game.assets.loadStats.length');
      await waitGame(1);
      await until('__game.assets.loadStats.every((x) => x.done)', 600000);
      if ((await evaluate('__game.assets.loadStats.length')) === n0) break;
    }
    const ls = await evaluate(`(() => { const s = __game.assets.loadStats; return { n: s.length, pending: s.filter((x) => !x.done).length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()), retried: s.filter((x) => x.attempts > 1).map((x) => x.url.split('/').pop() + '×' + x.attempts), degraded: document.documentElement.classList.contains('assets-fallback'), xi: s.filter((x) => /tex-xi-|char-xi/.test(x.url)).map((x) => x.url.split('/').pop() + (x.ok ? '' : ' ✗')) }; })()`);
    report.loads.push({ attempt, ...ls });
    console.log(`  加载 #${attempt}`, JSON.stringify(ls));
    if (!ls.pending && !ls.bad.length && !ls.degraded) return;
  }
  throw new Error('3 次进 S1 都有贴图 / 模型加载失败（占位），不截图');
}




const Z0 = -8.95;
const LEGACY = JSON.stringify({ shoulderSkin: 0, shoulderSwitchGain: 1e9, shoulderSwitchRatio: 0, lowSpaceLift: 0, nearFade: [-2, -1] });
const KEYS = JSON.stringify(Object.keys(JSON.parse(LEGACY)));
// [名, x, 离边界, yaw（度；0 = 朝 −z 即北看礁石，−90 = 朝东看）, 俯仰]
const VIEWS = [
  ['east', 10.5, 0.4, -90, -0.3],
  ['spin-66', 10.5, 0.4, -66, -0.3],
  ['north-rock', 10.5, 0.4, 0, -0.3],
];

async function run() {
  await enterS1();
  await evaluate(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
  await until(`__game.input.context === 'explore'`, 400000);
  await waitGame(1.5);
  const DEF = await evaluate(`JSON.stringify(Object.fromEntries(${KEYS}.map((k) => [k, __s1.cameraFollow.cfg[k]])))`);
  report.defaults = JSON.parse(DEF);
  for (const [view, x, dz, yawDeg, pitch] of VIEWS) for (const VARIANT of ['before', 'after']) {
    const name = `bug028-${view}-${VARIANT}`;
    try {
      await evaluate(`(() => { const c = __s1.cameraFollow.cfg; Object.assign(c, ${VARIANT === 'before' ? LEGACY : DEF}); return 1; })()`);
      await evaluate('(() => { __game.time.timeScale = 1; return 1; })()');
      // 先站到缝外开阔处再瞬移进缝：相机按真实逻辑收敛（含前拉 / 换肩 / 抬高平滑）
      await evaluate(`(() => { const s = __s1; s.puzzles.tide.set('low', { instant: true }); const b = s.rig.body.body; const y = ${(yawDeg * Math.PI) / 180}; b.teleport(b.position.clone().set(${x}, 0.25, ${Z0 + dz})); b.velocity.set(0, 0, 0); s.rig.controller.facing = y + Math.PI; s.cameraFollow.yaw = y; s.cameraFollow.pitch = ${pitch}; return 1; })()`);
      for (let k = 0; k < 6; k++) {
        await waitGame(0.25);
        await evaluate(`(() => { const s = __s1; s.cameraFollow.yaw = ${(yawDeg * Math.PI) / 180}; s.cameraFollow.pitch = ${pitch}; return 1; })()`);
      }
      await evaluate('(() => { __game.time.timeScale = 0; return 1; })()');
      await setView(W, H);
      await until(`innerWidth === ${W}`, 60000);
      await waitFrames(4);
      const st = await evaluate(`(() => { const s = __s1; const c = s.cameraFollow; const p = s.rig.body.body.position; const cam = s.camera.position; const head = p.clone(); head.y += 1.35; return { feet: [p.x, p.y, p.z].map((v) => +v.toFixed(3)), camHead: +cam.distanceTo(head).toFixed(3), shoulder: c.shoulder ?? null, lift: c.lift ?? null, headDistance: Number.isFinite(c.headDistance) ? +c.headDistance.toFixed(3) : null, xiAlpha: s.xiNearAlpha ?? null }; })()`);
      // 窄缝只在低潮可站（高潮会被潮水送回安全点 S1.safePoint）：脚不在缝里就算失败，不出图
      if (Math.abs(st.feet[0] - x) > 0.3 || Math.abs(st.feet[2] - (Z0 + dz)) > 0.3) throw new Error(`汐不在窄缝里（被送回？）feet ${st.feet}`);
      await shot(`${name}.png`);
      report.shots.push({ name, view, variant: VARIANT, ...st });
      console.log('  ✓', name, JSON.stringify(st));
      await setView(...SMALL);
    } catch (e) {
      report.failed.push({ name, error: String(e?.message ?? e) });
      console.log('  ✗', name, e?.message ?? e);
      await setView(...SMALL).catch(() => {});
    }
    save();
  }
}

try {
  await setView(...SMALL);
  await run();
} catch (e) {
  report.failed.push({ name: 'run', error: String(e?.message ?? e) });
  console.log('  ✗', e?.message ?? e);
}
save();
clearTimeout(WATCHDOG);
try { ws.close(); } catch { /* */ }
chrome.kill('SIGKILL');
await new Promise((r) => setTimeout(r, 500));
rmSync(profile, { recursive: true, force: true });
await new Promise((r) => server.httpServer.close(r));
console.log(report.failed.length ? `失败 ${report.failed.length} 项` : `完成 ${report.shots.length} 张 → ${OUT}`);
process.exit(report.failed.length ? 1 : 0);
