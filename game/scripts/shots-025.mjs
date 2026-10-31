// 025 水面平面反射 前后对比 + 开销 → ../docs/tasks/shots-025/（art=1、high）
//   同一机位、同一游戏时刻（timeScale=0）：倒影关（reflection.enabled=false = 025 之前）vs 档位倍率 0.25 / 0.5（high 默认）/ 1.0；
//   每档记倒影 pass 的 draw call / 三角形 / CPU ms，以及 30 帧平均整帧墙钟（swiftshader，只看相对值）。
//   贴水面高度序列（相机离水 0.02 / 0.1 / 0.3 / 0.6 / 1.2 m）检查淡入不跳变。
// 用法：npx vite build && node --import ./scripts/register-ts-paths.mjs scripts/shots-025.mjs [views,逗号分隔]
//   SHOTS_WATCHDOG_MS（默认 20 min）到点强退并清理 Chrome 临时目录
// 037 强度变体：SHOTS_VARIANT=strength → 输出 shots-025/strength/，RT 分辨率固定 high 默认（reflections.planar = 0.5），
//   每机位三档强度 k0（= ?reflectK=0 = off）/ k05（= 默认 PLANAR_REFLECTION_STRENGTH 0.5）/ k1，运行时改 reflection.strength；另拍 k05-q1（强度 0.5 + RT 倍率 1）比清晰度
//   （与 URL ?reflectK= 同一入口，免得每档整页重进）；之后用 scripts/compose-025-strength.py 拼 1×4。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VARIANT = process.env.SHOTS_VARIANT ?? '';
const OUT = resolve(root, process.env.SHOTS_OUT ?? (VARIANT === 'strength' ? '../docs/tasks/shots-025/strength' : '../docs/tasks/shots-025'));
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;
const ATMO = process.env.SHOTS_ATMO ?? '';
let EXTRA = '';

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high${ATMO ? '&atmo=' + ATMO : ''}`;
const WATCHDOG = setTimeout(() => { console.log('  ! 看门狗到点，强退'); try { chrome.kill('SIGKILL'); } catch { /* */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ } process.exit(2); }, +(process.env.SHOTS_WATCHDOG_MS ?? 1200000));
const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-shots025-'));
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
const reportFile = join(OUT, `shots-025${VARIANT ? '-' + VARIANT : ''}${process.argv[2] ? '-' + process.argv[2].replace(/,/g, '+') : ''}.json`);
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



const VIEWS = {
  'pier': [[2.5, 3.2, -3.5], [-5, 0.6, -11], 50],
  'pier-low': [[-2.2, 2.3, -2.4], [-3.6, 1.2, -9.8], 55],
  'opening': [[-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40],
};
// SHOTS_SCALES=off,q025,q05 跳过 q1（swiftshader 下 1600×900 反射 RT 曾把页面撑崩）
const SCALES = [['off', 0], ['q025', 0.25], ['q05', 0.5], ['q1', 1]].filter(([n]) => !process.env.SHOTS_SCALES || process.env.SHOTS_SCALES.split(',').includes(n));
const SHOOT = new Set(['off', 'q05', 'q1']);
const SET_SCALE = (s) => `(() => { const r = __s1.reflection; if (!r) return 'no-reflection'; r.enabled = ${s} > 0; if (${s} > 0) r.scale = ${s}; return 1; })()`;
/** 037 强度变体：分辨率 = 画质档默认（high 0.5），只改强度；dist 里没有 strength 字段 = 旧 dist，直接报错 */
const SET_STRENGTH = (k) => `(() => { const r = __s1.reflection; if (!r) return 'no-reflection'; if (!('strength' in r)) throw new Error('dist 没有 reflectK 改动，先重建'); r.enabled = true; r.scale = __game.quality.preset.reflections.planar; r.strength = ${k}; return 1; })()`;
const frameMs = async (n) => evaluate(`new Promise((res) => { let k = 0; let t0 = 0; const f = (t) => { if (k === 0) t0 = t; if (++k > ${n}) return res(+((t - t0) / ${n}).toFixed(1)); requestAnimationFrame(f); }; requestAnimationFrame(f); })`);
const cam = (eye, at, fov) => evaluate(`(() => { const c = __s1.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`);

async function run(views) {
  await enterS1();
  await evaluate(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
  await until(`__game.input.context === 'explore'`, 400000);
  await evaluate(`(() => { const s = __s1; s.cameraFollow.update = () => {}; s.rig.entity.object3D.visible = ${process.env.SHOTS_HIDE_XI ? 'false' : 'true'}; return 1; })()`);
  await waitGame(1.5);
  report.water = await evaluate(`({ y: +__s1.water.position.y.toFixed(3), tide: String(__s1.puzzles?.tide?.state ?? '') })`).catch((e) => String(e));
  await evaluate('(() => { __game.time.timeScale = 0; return 1; })()');
  for (const view of views) {
    if (view === 'heights') {
      const y = await evaluate('__s1.water.position.y');
      for (const dh of [0.02, 0.1, 0.3, 0.6, 1.2]) {
        const name = `water-height-${String(dh).replace('.', 'p')}m`;
        try {
          await evaluate(SET_SCALE(0.5));
          await cam([-2.2, y + dh, -2.4], [-3.6, y + dh + 0.25, -9.8], 55);
          await setView(W, H);
          await until(`innerWidth === ${W}`, 60000);
          await waitFrames(4);
          const st = await evaluate('JSON.parse(JSON.stringify(__s1.reflectionStats))');
          await shot(`${name}.png`);
          report.shots.push({ name, dh, k: st?.k, rendered: st?.rendered, skip: st?.skip });
          console.log('  ✓', name, 'k', st?.k, st?.skip ?? '');
          await setView(...SMALL);
        } catch (e) {
          report.failed.push({ name, error: String(e?.message ?? e) });
          console.log('  ✗', name, e?.message ?? e);
          await setView(...SMALL).catch(() => {});
        }
        save();
      }
      continue;
    }
    const [eye, at, fov] = VIEWS[view];
    if (VARIANT === 'strength') {
      const def = await evaluate('__game.quality.preset.reflections.planarStrength');
      report.defaultStrength = def;
      report.planar = await evaluate('__game.quality.preset.reflections.planar');
      // k05-q1：同强度 0.5、RT 倍率 1（极致档原值），和 k05（0.5）比清晰度差
      for (const [kname, k, sc] of [['k0', 0], ['k05', 0.5], ['k1', 1], ['k05-q1', 0.5, 1]]) {
        const name = `s1-${view}-strength-${kname}`;
        try {
          await evaluate(SET_STRENGTH(k));
          if (sc) await evaluate(`(() => { __s1.reflection.scale = ${sc}; return 1; })()`);
          await cam(eye, at, fov);
          await setView(W, H);
          await until(`innerWidth === ${W}`, 60000);
          await waitFrames(4);
          const st = await evaluate('JSON.parse(JSON.stringify(__s1.reflectionStats))');
          await shot(`${name}.png`);
          report.shots.push({ name, view, strength: k, k: st?.k, rendered: st?.rendered, skip: st?.skip, rt: `${st?.width}x${st?.height}` });
          console.log('  ✓', name, JSON.stringify(report.shots.at(-1)));
          await setView(...SMALL);
        } catch (e) {
          report.failed.push({ name, error: String(e?.message ?? e) });
          console.log('  ✗', name, e?.message ?? e);
          await setView(...SMALL).catch(() => {});
        }
        save();
      }
      continue;
    }
    for (const [sname, s] of SCALES) {
      const name = `s1-${view}-reflect-${sname}`;
      try {
        await evaluate(SET_SCALE(s));
        await cam(eye, at, fov);
        await setView(W, H);
        await until(`innerWidth === ${W}`, 60000);
        await waitFrames(4);
        const st = await evaluate('JSON.parse(JSON.stringify(__s1.reflectionStats))');
        const info = await evaluate('({ calls: __game.renderer.info.render.calls, triangles: __game.renderer.info.render.triangles })');
        const ms = await frameMs(+(process.env.SHOTS_FRAMES ?? 30));
        report.stats.push({ view, scale: s, frameMs: ms, totalCalls: info.calls, totalTriangles: info.triangles, ...(s > 0 ? { reflCalls: st.calls, reflTriangles: st.triangles, reflCpuMs: +st.ms.toFixed(2), rt: `${st.width}x${st.height}`, k: st.k, rendered: st.rendered, skip: st.skip } : {}) });
        if (SHOOT.has(sname)) await shot(`${name}.png`);
        console.log('  ✓', name, JSON.stringify(report.stats.at(-1)));
        await setView(...SMALL);
      } catch (e) {
        report.failed.push({ name, error: String(e?.message ?? e) });
        console.log('  ✗', name, e?.message ?? e);
        await setView(...SMALL).catch(() => {});
      }
      save();
    }
  }
  if (VARIANT === 'strength') await evaluate(SET_STRENGTH('__game.quality.preset.reflections.planarStrength'));
  await evaluate(SET_SCALE(0.5));
  await evaluate('(() => { __game.time.timeScale = 1; return 1; })()');
}

try {
  await setView(...SMALL);
  await run((process.argv[2] ?? 'pier,pier-low,opening,heights').split(','));
} catch (e) {
  report.failed.push({ name: 'run', error: String(e?.message ?? e) });
  console.log('  ✗', e?.message ?? e);
}
save();
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await new Promise((r) => server.httpServer.close(r));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
clearTimeout(WATCHDOG);
console.log('完成 →', OUT, report.failed.length ? `（${report.failed.length} 张失败）` : '');
process.exit(0);
