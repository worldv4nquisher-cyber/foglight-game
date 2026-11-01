// batch15 B：S1 沙地「新礁石背后的深色多边形斑」排查对比图 → ../docs/tasks/shots-031/sand/
//   同一机位、同一游戏时刻（timeScale=0 冻住水面 / 雨）逐项关：基准、关贴花、关阴影（sun.castShadow=false）、关水面（water.visible=false）；
//   再整页重进 ?lightmap=0 拍基准 / 关水面。另记沙面高度 vs 水面高度探针（probes）。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/shots-031-sand.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 1031：SHOTS_OUT 另存目录、SHOTS_EXTRA 追加 URL 参数（如 &seabed=0）、SHOTS_TAG 文件名后缀、SHOTS_VARIANTS 只拍部分变体（逗号分隔）
const OUT = resolve(root, process.env.SHOTS_OUT ?? '../docs/tasks/shots-031/sand');
const URL_EXTRA = process.env.SHOTS_EXTRA ?? '';
const TAG = process.env.SHOTS_TAG ?? '';
const ONLY = process.env.SHOTS_VARIANTS ? new Set(process.env.SHOTS_VARIANTS.split(',')) : null;
mkdirSync(OUT, { recursive: true });
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;
const ATMO = process.env.SHOTS_ATMO ?? '';
let EXTRA = '';

// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high${ATMO ? '&atmo=' + ATMO : ''}`;
const WATCHDOG = setTimeout(() => { console.log('  ! 看门狗到点，强退'); try { chrome.kill('SIGKILL'); } catch { /* */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ } process.exit(2); }, +(process.env.SHOTS_WATCHDOG_MS ?? 1800000));
const profile = mkdtempSync(join(tmpdir(), 'shots031sand-chrome-'));
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

const report = { atmo: ATMO || '(默认)', shots: [], failed: [], errors, loads: [], probes: {} };
// 只拍部分（argv[2]）时报告另存，不覆盖全量报告
const reportFile = join(OUT, `sand-compare${process.argv[2] ? '-' + process.argv[2].replace(/,/g, '+') : ''}${TAG}.json`);
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

/** 进 S1 并等全部 GLB / KTX2 加载完：有失败 / 占位就整页重进（负载高时 vite preview 偶发 Failed to fetch） */
async function enterS1() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await send('Page.navigate', { url: `${base}${EXTRA}${URL_EXTRA}&autostart=1` }, sessionId);
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


// 机位：开场（同 shots-031 s1-opening-low）+ 新礁石南侧俯视（礁石 x 6.4–12、z −3.8…−6.6，深水边界 z −8.95）
const VIEWS = [
  ['opening', [-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40],
  ['rocks-top', [8.5, 9.0, 2.0], [8.5, 0.0, -7.0], 50],
];
const VARIANTS = [
  ['base', 'x => 1'],
  ['nodecal', 'x => { if (__s1.dressing.decal) __s1.dressing.decal.visible = false; return 1; }'],
  ['noshadow', 'x => { __s1.sun.castShadow = false; return 1; }'],
  ['nowater', 'x => { __s1.water.visible = false; return 1; }'],
];
const RESET = `(() => { const s = __s1; if (s.dressing.decal) s.dressing.decal.visible = true; s.sun.castShadow = true; s.water.visible = true; return 1; })()`;
// 沙面（向下射线打场景里非水面的网格）vs 水面高度：新礁石南侧一圈点
const PROBE_FN = `(() => { const s = __s1; const T = s.camera.position.constructor; const Ray = __game.__THREE?.Raycaster; const out = [];
  const wy = s.water.position.y; const wl = s.puzzles.tide.level;
  return { waterMeshY: +wy.toFixed(3), tideLevel: +(+wl).toFixed(3) }; })()`;

async function pass(tag, variants) {
  await enterS1();
  await evaluate(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
  await until(`__game.input.context === 'explore'`, 400000);
  await evaluate(`(() => { const s = __s1; s.puzzles.tide.set('low', { instant: true }); s.cameraFollow.update = () => {}; s.rig.entity.object3D.visible = false; return 1; })()`);
  await waitGame(1.5);
  report.probes[tag] = await evaluate(PROBE_FN).catch((e) => ({ err: String(e) }));
  // 冻住游戏时间：水面波浪 / 雨停在同一刻，各变体只差开关
  await evaluate('(() => { __game.time.timeScale = 0; return 1; })()');
  // SHOTS_WATER_T：把海面相位钉在同一时刻（不同页面加载之间前后对比用）
  if (process.env.SHOTS_WATER_T) await evaluate(`(() => { const u = __s1.water?.uniforms; if (u) u.uTime.value = ${+process.env.SHOTS_WATER_T}; return 1; })()`);
  for (const [view, eye, at, fov] of VIEWS) {
    for (const [vname, fn] of variants) {
      if (ONLY && !ONLY.has(vname)) continue;
      const name = `sand-${view}-${tag}-${vname}${TAG}`;
      try {
        await evaluate(RESET);
        await evaluate(`(${fn})()`);
        await evaluate(`(() => { const c = __s1.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); return 1; })()`);
        await setView(W, H);
        await until(`innerWidth === ${W}`, 60000);
        await waitFrames(4);
        const file = await shot(`${name}.png`);
        report.shots.push({ name, view, tag, variant: vname, eye, at, fov, file, elapsed: await evaluate('__game.time.elapsed') });
        console.log('  ✓', name);
        await setView(...SMALL);
      } catch (e) {
        report.failed.push({ name, error: String(e?.message ?? e) });
        console.log('  ✗', name, e?.message ?? e);
        await setView(...SMALL).catch(() => {});
      }
      save();
    }
  }
  await evaluate('(() => { __game.time.timeScale = 1; return 1; })()');
}

try {
  await setView(...SMALL);
  const passes = (process.argv[2] ?? 'lm1,lm0').split(',');
  EXTRA = '';
  if (passes.includes('lm1')) await pass('lm1', VARIANTS);
  EXTRA = '&lightmap=0';
  if (passes.includes('lm0')) await pass('lm0', [VARIANTS[0], VARIANTS[3]]);
} catch (e) {
  report.failed.push({ name: 'run', error: String(e?.message ?? e) });
  console.log('  ✗', e?.message ?? e);
}
save();
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await game.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
clearTimeout(WATCHDOG);
console.log('完成 →', OUT, report.failed.length ? `（${report.failed.length} 张失败）` : '');
process.exit(0);
