// v0.1-029 截图：光照贴图前后对比（?lightmap=0 = 烘焙前，照旧半球光；默认 = 烘焙后），机位照美术预览页
//   art/tools/preview/lightmap029.html（S1）/ lightmap029-s23.html（S2 / S3），1600×900 → ../docs/tasks/shots-029/
//   另：地窖钥匙从入口看（cellarentry：下楼梯第 9 级眼高，钥匙描边 + 点光开着）、S3 塔门关着的塔底（门角压暗 ×0.6）。
// 用法：npm run build && node --import ./scripts/register-ts-paths.mjs scripts/shots-029.mjs [s1,s2,s3] [lm0,lm1]
// 每个场景 × 模式只进一次场景，机位挨个摆（盒子上 SwiftShader 很慢）；单张失败只记进 shots-029.json。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '../docs/tasks/shots-029');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;

// [眼, 看向, fov]（关卡坐标，与预览页一致）
const SCENES = {
  s1: {
    query: 'autostart=1', sceneName: 's1-ebb-shore', g: '__s1',
    views: {
      opening: [[-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40],
      cliff: [[1, 3.5, 1], [4, 4.5, 17], 60],
      ledge: [[-18.2, 6.4, -12.6], [-6, 0.4, -0.5], 50],
      pier: [[2.5, 3.2, -3.5], [-5, 0.6, -11], 50],
      shed: [[10, 3.5, 4], [18.7, 1.2, 1.5], 50],
    },
  },
  s2: {
    query: 'debug=1&scene=s2', sceneName: 's2-keeper-house', g: '__s2',
    views: {
      entry: [[0, 1.6, -12.5], [-2, 2.5, 1], 55],
      court: [[-14, 3, -9], [-6, 1, 0], 55],
      clifftop: [[18, 8, -14], [0, 0, 6], 55],
      room: [[-4.1, 1.6, -1.0], [0.5, 1.0, 3], 75],
      upper: [[-5, 4.6, -1], [1, 3.8, 3], 75],
      // 以下开地窖门之后
      cellar: [[0.8, -1.2, 0.0], [-2.35, -1.6, 1.6], 75],
      cellarentry: [[0.6, -0.25, 1.0], [-2.35, -1.3, 1.35], 60],
    },
  },
  s3: {
    query: 'debug=1&scene=s3', sceneName: 's3-lighthouse', g: '__s3',
    views: {
      bridge: [[-22.6, 4.6, -22.6], [0, 9, 0], 50],
      islet: [[-12, 6, 12], [2, 1, -2], 55],
      'room-doorclosed': [[-2, 3.8, -1.6], [2, 2.6, 1.6], 80],
      // 礁岛石面（y 0.5）盖过塔内地板（y 0.2）：角色站在楼梯起点旁，看脚
      floor: [[0.6, 1.5, -0.6], [-1.6, 0.4, 0.9], 70],
      // 以下开塔门之后
      room: [[-2, 3.8, -1.6], [2, 2.6, 1.6], 80],
      mid: [[-2.4, 11.6, 0.3], [2, 10.4, 0], 80],
      lamp: [[-2.2, 23.4, -1.2], [2, 22.4, 1.2], 80],
    },
  },
};
const onlyScenes = process.argv[2]?.split(',').filter(Boolean) ?? Object.keys(SCENES);
const onlyModes = process.argv[3]?.split(',').filter(Boolean) ?? ['lm0', 'lm1'];

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high`;
const profile = mkdtempSync(join(tmpdir(), 'shots029-chrome-'));
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
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
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
const until = async (expr, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
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

const reportFile = join(OUT, 'shots-029.json');
const prev = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {};
const report = { shots: prev.shots ?? [], failed: [], errors };
const keep = (name) => { report.shots = report.shots.filter((x) => x.name !== name); };

for (const sc of onlyScenes) {
  const S = SCENES[sc];
  for (const mode of onlyModes) {
    const g = S.g;
    try {
      console.log('  …', sc, mode);
      await setView(...SMALL);
      await send('Page.navigate', { url: `${base}&${S.query}${mode === 'lm0' ? '&lightmap=0' : ''}` }, sessionId);
      await sleep(500);
      if (!(await until(`!!window.${g}?.rig && window.__game.scenes.current.name === '${S.sceneName}'`, 400000))) throw new Error(`${sc} 没就绪`);
      await until(`!!${g}.art`, 200000);
      await evaluate(`(() => {
        const s = ${g};
        s.cameraFollow.update = () => {};
        s.rig.entity.object3D.visible = false;
        s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets(0);
        document.getElementById('ui-root').style.display = 'none';
        ${sc === 's1' ? "s.puzzles.tide.set('low', { instant: true });" : ''}
        return 1;
      })()`);
      await waitGame(1);
      const lmInfo = await evaluate(`${g}.lightmaps.map((h) => (h.root.userData.name ?? h.root.name) + '×' + h.scale.toFixed(2)).join(' ')`);
      console.log('   光照贴图', lmInfo || '（无）');
      for (const [view, [eye, at, fov]] of Object.entries(S.views)) {
        const name = `${sc}-${view}-${mode}`;
        try {
          if (sc === 's2' && view === 'cellar') {
            // 开地窖门（光感锁受光 → 门转 1.4 s）
            await evaluate(`(() => { const s = __s2; s.game.events.emit('receiver:activated', { id: s.puzzles.beam.lock.id }); return 1; })()`);
            await waitGame(2);
            await until(`__s2.puzzles.state.doorOpen >= 1`, 200000);
          }
          if (sc === 's2' && view.startsWith('cellar')) {
            // 角色（隐藏）放到机位脚下：地窖判定 → 钥匙点光 / 描边
            await evaluate(`(() => { const b = __s2.rig.body; b.teleport(b.position.clone().set(${eye[0]}, ${eye[1] - 1.55}, ${eye[2]})); return 1; })()`);
          }
          if (sc === 's3' && view === 'room') {
            await evaluate(`(() => { __s3.game.events.emit('interact:used', { id: 'door-s3', kind: 'use' }); return 1; })()`);
            await waitGame(2);
            await until(`__s3.puzzles.state.doorOpen >= 1`, 200000);
          }
          if (sc === 's3' && view === 'floor') {
            await evaluate(`(() => { const s = __s3; const b = s.rig.body; b.teleport(s.frame.localToWorld(b.position.clone().set(-1.6, 0.25, 0.9))); s.rig.entity.object3D.visible = true; return 1; })()`);
            await waitGame(1);
          }
          // S3 是世界坐标摆的（s3-frame = S3_FRAME 平移 + 转 135°），机位 / 站位按 S3 局部给，进 frame 换算
          await evaluate(`(() => { const s = ${g}; const c = s.camera; const V = c.position.constructor; const W = (x, y, z) => (s.frame ? s.frame.localToWorld(new V(x, y, z)) : new V(x, y, z));
            c.position.copy(W(${eye})); c.fov = ${fov}; c.lookAt(W(${at})); c.updateProjectionMatrix(); return 1; })()`);
          await waitGame(0.6);
          await setView(W, H);
          await until(`innerWidth === ${W}`, 60000);
          await waitFrames(3);
          const info = await evaluate(`(() => { const s = ${g}; const o = { lm: s.lightmaps.map((h) => (h.root.userData.name ?? h.root.name) + '×' + h.scale.toFixed(2)).join(' '), hemi: s.hemi.intensity };
            if (s.puzzles?.keyLight) { o.keyLight = s.puzzles.keyLight.light.intensity; o.keyHL = s.puzzles.keyHighlighted; }
            if (s.puzzles?.state && 'doorOpen' in s.puzzles.state) o.door = s.puzzles.state.doorOpen;
            if (s.rig) o.player = (s.frame ? s.frame.worldToLocal(s.rig.body.position.clone()) : s.rig.body.position).toArray().map((v) => +v.toFixed(3));
            if (s.puzzles?.mirrorHighlighted) o.mirrorHL = s.puzzles.mirrorHighlighted;
            return o; })()`);
          const file = await shot(`${name}.png`);
          keep(name);
          report.shots.push({ name, scene: sc, view, mode, eye, at, fov, file, info });
          console.log('  ✓', name, JSON.stringify(info));
          await setView(...SMALL);
          if (view === 'floor') await evaluate(`${g}.rig.entity.object3D.visible = false`);
        } catch (e) {
          report.failed.push({ name, error: String(e?.message ?? e) });
          console.log('  ✗', name, e?.message ?? e);
          await setView(...SMALL).catch(() => {});
        }
        writeFileSync(reportFile, JSON.stringify(report, null, 2));
      }
    } catch (e) {
      report.failed.push({ name: `${sc}-${mode}`, error: String(e?.message ?? e) });
      console.log('  ✗', sc, mode, e?.message ?? e);
    }
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
}
writeFileSync(reportFile, JSON.stringify(report, null, 2));
if (errors.length) console.log('  页面错误：', errors.slice(0, 5));
ws.close();
chrome.kill('SIGKILL');
await new Promise((r) => server.httpServer.close(r));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT);
