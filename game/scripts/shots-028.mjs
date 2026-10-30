// v0.1-028 截图：无头 Chrome（SwiftShader）按预览机位 / 预设 / 档位出 1600×900 图到 ../docs/tasks/shots-028/，
// 另外：GPU 侧 LUT identity 对比（?lut=0 + 中性 grade vs lut-identity，同一帧冻结）、ultra 帧率（仅参考，SwiftShader）。
// 用法：npm run build && node --import ./scripts/register-ts-paths.mjs scripts/shots-028.mjs [job 名前缀,逗号分隔]
// 单张失败（盒子高负载下 SwiftShader GPU 进程崩 / 超时）只记进报告、接着跑下一张；shots-028.json 按 job 名合并（分批跑不丢前面的结果）。
// 机位照 art/tools/preview/env.html：opening / opening-low (-0.9,4.2,9.5) 朝 (0.187,0,-0.982) fov 40；channel (3.5,5.2,4.2)→(-3.5,1.2,11.5) fov 50。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '../docs/tasks/shots-028');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;

const VIEWS = {
  opening: { tide: 'high', eye: [-0.9, 4.2, 9.5], at: [-0.9 + 0.187 * 40, 4.2, 9.5 - 0.982 * 40], fov: 40 },
  'opening-low': { tide: 'low', eye: [-0.9, 4.2, 9.5], at: [-0.9 + 0.187 * 40, 4.2, 9.5 - 0.982 * 40], fov: 40 },
  channel: { tide: 'low', eye: [3.5, 5.2, 4.2], at: [-3.5, 1.2, 11.5], fov: 50 },
};
const JOBS = [
  { name: 's1-opening-c-028-ultra', view: 'opening', atmo: 'overcast-dusk', quality: 'ultra' },
  { name: 's1-opening-d-rain-night', view: 'opening', atmo: 'rain-night', quality: 'ultra' },
  { name: 's1-opening-d-overcast-after-rain', view: 'opening', atmo: 'overcast-after-rain', quality: 'ultra' },
  { name: 's1-opening-d-after-lit', view: 'opening', atmo: 'after-lit', quality: 'ultra' },
  { name: 's1-opening-low-c-028-ultra', view: 'opening-low', atmo: 'overcast-dusk', quality: 'ultra' },
  { name: 's1-channel-c-028-ultra', view: 'channel', atmo: 'overcast-dusk', quality: 'ultra' },
  { name: 's1-channel-c-028-high', view: 'channel', atmo: 'overcast-dusk', quality: 'high' },
  { name: 's1-channel-c-028-standard', view: 'channel', atmo: 'overcast-dusk', quality: 'standard' },
  { name: 's1-channel-x-lens-rain-night', view: 'channel', atmo: 'rain-night', quality: 'ultra', extra: 'lens=1' },
  { name: 's1-channel-x-no-fogcards', view: 'channel', atmo: 'overcast-dusk', quality: 'ultra', hide: 'fog028' },
  { name: 's1-channel-x-no-water', view: 'channel', atmo: 'overcast-dusk', quality: 'ultra', hide: 'water' },
  { name: 'lut-identity', view: 'opening', atmo: 'overcast-dusk', quality: 'ultra', lutPair: true },
  { name: 'fps-ultra', view: 'opening', atmo: 'overcast-dusk', quality: 'ultra', fps: true },
];
// 只跑部分：逗号分隔的 job 名前缀（例 s1-channel,lut）
const only = process.argv[2]?.split(',').filter(Boolean);

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&autostart=1&art=1`;
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
/** 单次 evaluate 墙钟上限：GPU 进程崩了页面会一直不回 */
const EVAL_MS = 300000;
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时（页面无响应）')), EVAL_MS)),
  ]);
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

const reportFile = join(OUT, 'shots-028.json');
const prev = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {};
const report = { shots: prev.shots ?? [], failed: [], lut: prev.lut ?? null, fps: prev.fps ?? null, errors };
const keep = (name) => { report.shots = report.shots.filter((x) => x.name !== name); };
for (const j of JOBS) {
  if (only && !only.some((o) => j.name.startsWith(o))) continue;
  try {
  const v = VIEWS[j.view];
  const url = `${base}&atmo=${j.atmo}&quality=${j.quality}${j.extra ? '&' + j.extra : ''}`;
  console.log('  …', j.name);
  await setView(...SMALL);
  await send('Page.navigate', { url }, sessionId);
  await sleep(500);
  if (!(await until(`!!window.__s1?.rig && window.__game.scenes.current.name === 's1-ebb-shore'`, 240000))) throw new Error(j.name + '：S1 没就绪');
  // 等建立镜头结束 + 预加载的美术件都到位
  // 不等 3 s 建立镜头（盒子上 SwiftShader 很慢）：美术到位就接管相机（cameraFollow.update 置空 = 建立镜头轨道也不再写相机）
  await until(`!!__s1.art`, 120000);
  await evaluate(`(() => {
    const s = __s1;
    s.puzzles.tide.set('${v.tide}', { instant: true });
    s.cameraFollow.update = () => {};
    s.rig.entity.object3D.visible = false;
    // 没等建立镜头结束（还在 cutscene）：过场镜头水滴只在 ?lens=1 的那张开
    if (!/lens=1/.test(location.search)) { s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0); }
    const c = s.camera; c.position.set(${v.eye}); c.fov = ${v.fov}; c.lookAt(${v.at}); c.updateProjectionMatrix();
    ${j.hide === 'fog028' ? 's.fog028.visible = false;' : ''}
    ${j.hide === 'water' ? 's.water.visible = false;' : ''}
    return 1;
  })()`);
  // 小视口先跑 3 s 游戏时间（雨 / 溅水 / 雾片进稳态），再切大视口等 3 帧（resize + 后处理重建）
  await waitGame(j.fps ? 0.5 : 2);
  await setView(W, H);
  const fr = await evaluate('__game.time.frame');
  await until(`__game.time.frame >= ${fr + 3} && innerWidth === ${W}`, 600000);
  if (j.fps) {
    const f0 = await evaluate('__game.time.frame'), t0 = Date.now();
    await sleep(15000);
    const f1 = await evaluate('__game.time.frame');
    report.fps = { frames: f1 - f0, sec: (Date.now() - t0) / 1000, fps: (f1 - f0) / ((Date.now() - t0) / 1000), rain: await evaluate('__s1.rain.dropCount + " " + __s1.rain.mode'), note: 'SwiftShader CPU 渲染，仅参考' };
    console.log('  fps', JSON.stringify(report.fps));
    continue;
  }
  if (j.lutPair) {
    // 冻结逻辑（雨 / 水 / 雾片不动），关颗粒，同一帧对比：LUT 关 + grade 中性 vs lut-identity
    await evaluate(`(() => { const p = __game.postfx; __shotsUnfreeze = __game.freeze(); p.noise.blendMode.opacity.value = 0; p.setLutOverride('0'); p.hueSat.hue = 0; p.hueSat.saturation = 0; p.brightContrast.brightness = 0; p.brightContrast.contrast = 0; return 1; })()`);
    await sleep(3000);
    const a = await shot('lut-gpu-off.png');
    await evaluate(`(() => { __game.postfx.setLutOverride('identity'); return __game.postfx.activeLut; })()`);
    await sleep(3000);
    const b = await shot('lut-gpu-identity.png');
    report.lut = { off: a, identity: b, active: await evaluate('__game.postfx.activeLut') };
    console.log('  lut pair', JSON.stringify(report.lut));
    continue;
  }
  const info = await evaluate(`({ atmo: __s1.atmosphere.id, lut: __game.postfx.activeLut, rain: __s1.rain ? __s1.rain.mode + ' ' + __s1.rain.dropCount : null, lens: __game.postfx.lensDroplets, fog: __s1.scene.fog?.density, tide: __s1.puzzles.tide.level })`);
  const file = await shot(j.name + '.png');
  keep(j.name);
  report.shots.push({ ...j, file, info });
  console.log('  ✓', j.name, JSON.stringify(info));
  } catch (e) {
    report.failed.push({ name: j.name, error: String(e?.message ?? e) });
    console.log('  ✗', j.name, e?.message ?? e);
  }
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
}
writeFileSync(reportFile, JSON.stringify(report, null, 2));
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await new Promise((r) => server.httpServer.close(r));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT);
