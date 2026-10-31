// v0.1-035 结尾演出截图：art=1、quality=high、1600×900 → ../docs/tasks/shots-035/
//   进 S3 等资源全部到、点燃，演出时钟换成可停的后备时钟（截图时停住，画面 / 姿势 / 镜头都定在目标 t），按 t 从前往后 seek 拍：
//   雾口 / 剪影 / 父亲摸头（hand 第 80 帧）/ 「那边没有亮。」/ 写日志 / 后拉。
// 用法：npm run build && node --import ./scripts/register-ts-paths.mjs scripts/shots-035.mjs
//   SHOTS_ONLY=03,04      只拍编号匹配的几张
//   SHOTS_COMPARE=1       每张另拍一张 *-before.png：关掉裁定 25 的两项（父亲深度预写、04 镜头关玻璃反射），同一构建同一帧对比
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// SHOTS_OUT=目录（相对仓库上一级）改输出目录（默认 docs/tasks/shots-035）；SHOTS_QUERY='&hull=0' 追加 URL 参数
const OUT = resolve(root, '..', process.env.SHOTS_OUT ?? 'docs/tasks/shots-035');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high&debug=1&scene=s3${process.env.SHOTS_QUERY ?? ''}`;
const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-shots035-'));
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


const report = { shots: [], failed: [], errors, loads: [] };
const reportFile = join(OUT, process.env.SHOTS_ONLY || COMPARE ? 'shots-035-r25.json' : 'shots-035.json');
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

const SHOTS = [
  ['s3-ending-01-fog-open', 20],
  ['s3-ending-02-silhouette', 28],
  ['s3-ending-03-father-hand', 36 + 80 / 30],
  ['s3-ending-04-no-answer', 51.2],
  ['s3-ending-05-journal-write', 68],
  ['s3-ending-06-pull-back-room', 78],
  ['s3-ending-07-pull-back-sea', 91],
];

const ONLY = (process.env.SHOTS_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const COMPARE = process.env.SHOTS_COMPARE === '1';
const FIX = (on) => `(() => { const c = __s3.endingCutscene; c.glassGateEnabled = ${on}; c.glass.value = ${on} ? (c.t >= 42 && c.t < 58 ? 0 : 1) : 1; if (c.ghost) { c.ghost.prepassEnabled = ${on}; c.ghost.setOpacity(c.ghost.opacity); } return { glass: c.glass.value, glassMats: c.glass.materials.length, prepass: c.ghost ? c.ghost.prepasses.filter((p) => p.visible).length : null }; })()`;
const frames3 = () => evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');

const STATE = `(() => { const c = __s3.endingCutscene, f = __s3.father, an = __s3.rig?.animator; return { t: +c.t.toFixed(3), shot: c.shot, sub: __game.ui.subtitles.current?.id ?? null, xi: an?.posing ?? null,
  father: f ? { mode: f.mode, frame: Math.round(f.clipTime * 30), visible: f.visible } : null, fog: +(__s3.scene.fog?.density ?? 0).toFixed(5), sil: c.silhouette?.visible ?? null, fade: +__game.ui.fade.opacity.toFixed(3) }; })()`;

try {
  await setView(...SMALL);
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    await send('Page.navigate', { url: base }, sessionId);
    await sleep(500);
    if (!(await until(`!!window.__s3?.rig?.animator && __game.scenes.current.name === 's3-lighthouse'`, 400000))) throw new Error('S3 没就绪');
    await until('__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)', 600000);
    const ls = await evaluate(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()), degraded: document.documentElement.classList.contains('assets-fallback') }; })()`);
    report.loads.push({ attempt, ...ls });
    console.log(`  加载 #${attempt}`, JSON.stringify(ls));
    ok = !ls.bad.length && !ls.degraded;
  }
  if (!ok) throw new Error('3 次进 S3 都有加载失败');
  await until(`__game.input.context === 'explore' && !!__s3.father`, 400000);
  await evaluate(`(() => { __game.postfx.setLensDroplets?.(0); window.__hold = false; return 1; })()`);
  await evaluate(`__s3.lightTheLamp(), 1`);
  // 换成可停的后备时钟（演出逻辑不变，只是时钟来源）
  await evaluate(`(() => { const c = __s3.endingCutscene.clock; c.src = { audio: () => null, now: () => performance.now(), paused: () => window.__hold }; return 1; })()`);
  for (const [name, T] of SHOTS) {
    if (ONLY.length && !ONLY.some((k) => name.includes(`-${k}-`))) continue;
    try {
      await evaluate(`(() => { window.__hold = false; __s3.endingCutscene.seek(${T - 0.4}); return 1; })()`);
      if (!(await until(`__s3.endingCutscene.t >= ${T}`, 400000))) throw new Error('演出没走到 ' + T);
      await evaluate(`(() => { window.__hold = true; return 1; })()`);
      await setView(W, H);
      await until(`innerWidth === ${W}`, 60000);
      await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
      const st = await evaluate(STATE);
      const fix = await evaluate(FIX(true));
      await frames3();
      const file = await shot(`${name}.png`);
      report.shots.push({ name, file, target: +T.toFixed(3), ...st, fix });
      console.log('  ✓', name, JSON.stringify(st), JSON.stringify(fix));
      if (COMPARE) {
        const before = await evaluate(FIX(false));
        await frames3();
        const fb = await shot(`${name}-before.png`);
        report.shots.push({ name: `${name}-before`, file: fb, target: +T.toFixed(3), ...st, fix: before });
        console.log('  ✓', `${name}-before`, JSON.stringify(before));
        await evaluate(FIX(true));
      }
      await setView(...SMALL);
      save();
    } catch (e) {
      report.failed.push({ name, error: String(e?.message ?? e) });
      console.log('  ✗', name, e?.message ?? e);
      await setView(...SMALL).catch(() => {});
    }
  }
} catch (e) {
  report.failed.push({ name: 'setup', error: String(e?.message ?? e) });
  console.log('  ✗', e?.message ?? e);
} finally {
  save();
  try { chrome.kill('SIGKILL'); } catch { /* */ }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(profile, { recursive: true, force: true });
  await new Promise((r) => server.httpServer.close(r));
  console.log(`shots-035：${report.shots.length} 张、失败 ${report.failed.length}、页面错误 ${errors.length} → ${OUT}`);
  process.exit(report.failed.length ? 1 : 0);
}
