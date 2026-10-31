// v0.1-035 结尾演出截图：art=1、quality=high、1600×900 → ../docs/tasks/shots-035/
//   进 S3 等资源全部到、点燃，演出时钟换成可停的后备时钟（截图时停住，画面 / 姿势 / 镜头都定在目标 t），按 t 从前往后 seek 拍：
//   雾口 / 剪影 / 父亲摸头（hand 第 80 帧）/ 「那边没有亮。」/ 写日志 / 后拉。
// 用法：npm run build && node --import ./scripts/register-ts-paths.mjs scripts/shots-035.mjs
//   SHOTS_ONLY=03,04      只拍编号匹配的几张
//   SHOTS_BEAM_COMPARE=1  每张另拍一张 *-beam-before.png（同帧旧灯束），另加 00 点火后 3 s；SHOTS_REPORT 改报告文件名
//   SHOTS_FAR=1           另拍镜头 02 塔外远景（far-exterior，lens 4 s → fog_open 14 s）t = 8 / 12 s 两张（文件名带 -02-，SHOTS_ONLY=02 时一起拍）
//   SHOTS_BOOST_COMPARE=1 每张另拍一张 *-boost-before.png：关掉镜头 02 灯束加强（beamBoostEnabled=false），timeScale=0 冻住灯束旋转、同一帧对比
//   SHOTS_PEN=1           P3 钢笔：只拍 05（坐写第 60 / 72 / 18 帧三个时刻）+ 每个时刻两张手部特写（拇指侧 / 右侧，对照 art/models/props/preview/prop-fountain-pen-*.png），
//                         每张记钢笔状态（显隐 / suppress / 笔尖高出桌面），最后跳过演出、核对笔立即藏；默认输出 shots-035/pen、报告 shots-035-pen.json
//   SHOTS_COMPARE=1       每张另拍一张 *-before.png：关掉裁定 25 的两项（父亲深度预写、04 镜头关玻璃反射），同一构建同一帧对比
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// SHOTS_OUT=目录（相对仓库上一级）改输出目录（默认 docs/tasks/shots-035）；SHOTS_QUERY='&hull=0' 追加 URL 参数
const OUT = resolve(root, '..', process.env.SHOTS_OUT ?? (process.env.SHOTS_PEN === '1' ? 'docs/tasks/shots-035/pen' : 'docs/tasks/shots-035'));
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
  else if (m.method === 'Inspector.targetCrashed') { crashed = true; console.log('  ! 页面崩溃（多半是盒子内存 OOM）'); for (const p of pending.values()) p.rej(new Error('页面崩溃')); pending.clear(); }
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
// 超时可配（裁定 25 接手：box 负载高时 seek 曾卡 10 min）：SHOTS_EVAL_MS 单次 evaluate、SHOTS_STEP_MS 每张等演出走到目标 t、SHOTS_TOTAL_MS 整体看门狗（到点杀 Chrome、删临时目录、退出码 3）
const EVAL_MS = +(process.env.SHOTS_EVAL_MS ?? 600000);
const STEP_MS = +(process.env.SHOTS_STEP_MS ?? 400000);
if (process.env.SHOTS_TOTAL_MS) setTimeout(() => { console.log('  ✗ 总超时，强退'); try { chrome.kill('SIGKILL'); } catch { /* */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ } process.exit(3); }, +process.env.SHOTS_TOTAL_MS).unref();
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时（页面无响应）')), EVAL_MS)),
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (expr, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (wsClosed) throw new Error('Chrome 连接断了'); if (crashed) throw new Error('页面崩溃'); if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
const shot = async (file) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } }, sessionId);
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
  return join(OUT, file);
};


const report = { shots: [], failed: [], errors, loads: [] };

const SHOTS = [
  ['s3-ending-01-fog-open', 20],
  ['s3-ending-02-silhouette', 28],
  ['s3-ending-03-father-hand', 36 + 80 / 30],
  ['s3-ending-04-no-answer', 51.2],
  ['s3-ending-05-journal-write', 68],
  ['s3-ending-06-pull-back-room', 78],
  ['s3-ending-07-pull-back-sea', 91],
];

// 裁定 25：SHOTS_BEAM_COMPARE=1 → 每张另拍一张同帧旧灯束（015 MeshBasic 圆锥，lamp.setStyle('legacy')）`-beam-before`，并加拍点火后 3 s 的探索镜头
const BEAM_COMPARE = process.env.SHOTS_BEAM_COMPARE === '1';
if (BEAM_COMPARE) SHOTS.unshift(['s3-ending-00-ignite-beam', 3]);
// 1031 镜头 02 灯束加强：塔外远景两张（seek 只能往前 → 放在 01 之前）
if (process.env.SHOTS_FAR === '1') SHOTS.splice(BEAM_COMPARE ? 1 : 0, 0, ['s3-ending-02-far-exterior-t08', 8], ['s3-ending-02-far-exterior-t12', 12]);
const PEN = process.env.SHOTS_PEN === '1';
if (PEN) {
  // 坐写 58 s 起，clip 4 s 循环：68 = 第 60 帧（第二笔落笔中）、68.4 = 第 72 帧（预览 -in-hand-top）、70.6 = 第 18 帧（预览 -in-hand / -cam05-proxy）
  SHOTS.splice(0, SHOTS.length, ['s3-ending-04-no-answer', 51.2], ['s3-ending-05-journal-write', 68], ['s3-ending-05-journal-write-f72', 68.4], ['s3-ending-05-journal-write-f18', 70.6]);
}
const PEN_STATE = `(() => { const p = __s3.pen, an = __s3.rig?.animator; if (!p) return { pen: null, error: __s3.penError ?? null };
  const tip = p.root.getObjectByName('prop-fountain-pen-tip'); const v = tip.getWorldPosition(p.root.position.clone());
  const j = __s3.scene.getObjectByName('prop-journal-father-s3'); const jy = j ? j.getWorldPosition(p.root.position.clone()).y : null;
  return { visible: p.root.visible, suppressed: p.isSuppressed, socket: p.socket.name, clip: p.clip, posing: an?.posing ?? null, w: +(an?.weightOf(p.clip) ?? 0).toFixed(3),
    frame: an ? (window.__penFrame ?? Math.round(((__s3.endingCutscene.t - 58) % 4) * 30)) : null, tipAboveJournalSocketCm: jy === null ? null : +((v.y - jy) * 100).toFixed(2),
    xiLod: (() => { let l = null; __s3.scene.traverse((o) => { if (o.isLOD && o.name === 'char-xi') l = o.getCurrentLevel(); }); return l; })() }; })()`;
// 手部特写：每帧在演出写完镜头之后改机位（step 是 JS 里可替换的实例方法）
const CLOSE = (side) => `(() => { const c = __s3.endingCutscene; if (!c.__step0) c.__step0 = c.step; const p = __s3.pen; const xi = __s3.rig.animator.model;
  c.step = function (t) { c.__step0.call(c, t); const V = p.root.position.constructor; const grip = p.root.getObjectByName('prop-fountain-pen-grip').getWorldPosition(new V());
    const q = xi.getWorldQuaternion(p.root.quaternion.clone()); const fwd = new V(0, 0, 1).applyQuaternion(q), right = new V(-1, 0, 0).applyQuaternion(q);
    const eye = grip.clone().addScaledVector(right, ${side === 'thumb' ? -0.2 : 0.22}).addScaledVector(fwd, ${side === 'thumb' ? 0.1 : -0.02}).add(new V(0, ${side === 'thumb' ? 0.06 : 0.12}, 0));
    c.cam.position.copy(eye); c.cam.fov = 35; c.cam.updateProjectionMatrix(); c.cam.lookAt(grip); c.cam.updateMatrixWorld(true); };
  return 1; })()`;
// 拍笔：box 慢时 seek 会冲过目标几十帧（首轮 68 拍成了第 109 帧）→ 演出 step 之后把坐写钉在指定帧（只改截图，不改游戏）
const PEN_FRAME = { 's3-ending-05-journal-write': 60, 's3-ending-05-journal-write-f72': 72, 's3-ending-05-journal-write-f18': 18 };
const PEN_PIN = `(() => { const c = __s3.endingCutscene; if (c.__pin) return 1; c.__pin = true; const s0 = c.step;
  c.step = function (t) { s0.call(c, t); const an = __s3.rig?.animator; if (window.__penFrame != null && an?.posing === 'xi-sit-write') an.setPose('xi-sit-write', window.__penFrame / 30); };
  return 1; })()`;
const CLOSE_OFF = `(() => { const c = __s3.endingCutscene; if (c.__step0) { c.step = c.__step0; delete c.__step0; } return 1; })()`;
const BOOST_COMPARE = process.env.SHOTS_BOOST_COMPARE === '1';
const ONLY = (process.env.SHOTS_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const COMPARE = process.env.SHOTS_COMPARE === '1';
const reportFile = join(OUT, process.env.SHOTS_REPORT ?? (process.env.SHOTS_PEN === '1' ? 'shots-035-pen.json' : process.env.SHOTS_ONLY || COMPARE ? 'shots-035-r25.json' : 'shots-035.json'));
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));
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
  if (PEN) await evaluate(PEN_PIN);
  for (const [name, T] of SHOTS) {
    if (PEN) await evaluate(`(window.__penFrame = ${PEN_FRAME[name] ?? 'null'}, 1)`);
    if (ONLY.length && !ONLY.some((k) => name.includes(`-${k}-`))) continue;
    try {
      await evaluate(`(() => { window.__hold = false; __s3.endingCutscene.seek(${T - 0.4}); return 1; })()`);
      if (!(await until(`__s3.endingCutscene.t >= ${T}`, STEP_MS))) throw new Error('演出没走到 ' + T);
      await evaluate(`(() => { window.__hold = true; return 1; })()`);
      await setView(W, H);
      await until(`innerWidth === ${W}`, 60000);
      await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
      const st = await evaluate(STATE);
      const fix = await evaluate(FIX(true));
      await frames3();
      const file = await shot(`${name}.png`);
      // 05 过肩：日志入画 / 遮挡 / 头顶留白（ending.frameReport）
      const frame = st.shot === 'over-shoulder' ? await evaluate(`__s3.endingCutscene.frameReport(${H})`) : undefined;
      report.shots.push({ name, file, target: +T.toFixed(3), ...st, fix, ...(frame ? { frame } : {}) });
      console.log('  ✓', name, JSON.stringify(st), JSON.stringify(fix), frame ? JSON.stringify(frame) : '');
      if (PEN) {
        const ps = await evaluate(PEN_STATE);
        report.shots.at(-1).pen = ps;
        console.log('    笔', JSON.stringify(ps));
        if (name.includes('-05-')) {
          for (const side of ['thumb', 'right']) {
            await evaluate(CLOSE(side));
            await frames3();
            const fc = await shot(`${name}-close-${side}.png`);
            report.shots.push({ name: `${name}-close-${side}`, file: fc, target: +T.toFixed(3), pen: await evaluate(PEN_STATE) });
            console.log('  ✓', `${name}-close-${side}`);
          }
          await evaluate(CLOSE_OFF);
          await frames3();
        }
      }
      if (BEAM_COMPARE) {
        await evaluate(`(__s3.puzzles.lamp.setStyle('legacy'), 1)`);
        await frames3();
        const fl = await shot(`${name}-beam-before.png`);
        await evaluate(`(__s3.puzzles.lamp.setStyle('volume'), 1)`);
        await frames3();
        report.shots.push({ name: `${name}-beam-before`, file: fl, target: +T.toFixed(3), ...st, beam: 'legacy' });
        console.log('  ✓', `${name}-beam-before`);
      }
      if (BOOST_COMPARE) {
        // 冻住灯束旋转（lamp.update 走游戏 dt），关加强拍一张，再开回来
        const bb = await evaluate(`(() => { __game.time.timeScale = 0; const c = __s3.endingCutscene; c.beamBoostEnabled = false; __s3.puzzles.lamp.beam.setBoost(1); return { boost: __s3.puzzles.lamp.beam.boost, rotY: +__s3.puzzles.lamp.beam.beams.rotation.y.toFixed(4) }; })()`);
        await frames3();
        const fb = await shot(`${name}-boost-before.png`);
        await evaluate(`(() => { __s3.endingCutscene.beamBoostEnabled = true; return 1; })()`);
        await frames3();
        const fa = await shot(`${name}.png`);
        const ba = await evaluate(`(() => { const r = { boost: __s3.puzzles.lamp.beam.boost, rotY: +__s3.puzzles.lamp.beam.beams.rotation.y.toFixed(4) }; __game.time.timeScale = 1; return r; })()`);
        report.shots.push({ name: `${name}-boost-before`, file: fb, target: +T.toFixed(3), ...st, beam: bb }, { name: `${name}-boost-after`, file: fa, target: +T.toFixed(3), ...st, beam: ba });
        console.log('  ✓', `${name}-boost-before / after`, JSON.stringify(bb), JSON.stringify(ba));
      }
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
  if (PEN) {
    // 跳过：坐写还在播（姿势不收），笔要立即藏
    const before = await evaluate(PEN_STATE);
    await evaluate(`(() => { window.__hold = false; return __s3.endingCutscene.skip(); })()`);
    await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
    const after = await evaluate(PEN_STATE);
    report.penSkip = { before, after, endedBy: await evaluate('__s3.endingCutscene.endedBy') };
    console.log('  跳过：', JSON.stringify(report.penSkip));
    if (after?.visible !== false) report.failed.push({ name: 'pen-skip', error: '跳过后笔还显示' });
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
