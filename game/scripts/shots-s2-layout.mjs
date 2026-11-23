// S2 守灯人小屋重建：同机位前后对照截图（机位在 S2 局部坐标）。
// 用法：SHOTS_OUT=目录 node --import ./scripts/register-ts-paths.mjs scripts/shots-s2-layout.mjs [s2] [lm1] [机位,…]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.SHOTS_OUT ?? join(tmpdir(), 'shots-s2'));
mkdirSync(OUT, { recursive: true });
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
const W = 1600, H = 900;

// [眼, 看向, fov]（关卡坐标，与预览页一致）
const SCENES = {
  s2: {
    query: 'debug=1&scene=s2', sceneName: 's2-keeper-house', g: '__s2',
    views: {
      approach: [[0.5, 1.7, -13.2], [-2.5, 2.2, 1], 60],
      overview: [[14, 22, -22], [-4, 0, 2], 50],
      yard: [[-11, 2.2, -9.5], [-9, 0.8, 4], 60],
      yardnorth: [[-14, 2.4, 9.5], [-8, 0.6, -2], 60],
      behind: [[-11, 1.8, 10.5], [-1, 1, 3.5], 60],
      northgate: [[4.2, 1.7, 5], [4.2, 1.4, 20], 60],
      west: [[9, 2.2, -6], [-1, 2.5, 3], 60],
      westview: [[0.95, 4.35, 1.0], [18, 0.2, 1], 30],
      room: [[-0.6, 1.6, -1.2], [-4.5, 1.0, 2.5], 75],
      upper: [[-1, 4.6, -1], [-5, 3.6, 2], 75],
      cellar: [[0.8, -1.2, 0.0], [-2.35, -1.6, 1.6], 75],
    },
  },
};
const onlyScenes = process.argv[2]?.split(',').filter(Boolean) ?? Object.keys(SCENES);
const onlyModes = process.argv[3]?.split(',').filter(Boolean) ?? ['lm1'];
// 可选第 4 个参数：只截这些机位（逗号分隔，如 floor,room,islet）；有依赖的机位（room 开门、cellar 开地窖门）在自己那张里做，单截也成立
const onlyViews = process.argv[4]?.split(',').filter(Boolean) ?? null;

// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=${process.env.SHOTS_QUALITY ?? 'high'}`;
const profile = mkdtempSync(join(tmpdir(), 'shotss2-chrome-'));
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

const reportFile = join(OUT, 'shots-s2.json');
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
        if (onlyViews && !onlyViews.includes(view)) continue;
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
await game.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
console.log('完成 →', OUT);
process.exit(0); // vite preview 留着句柄，不显式退出会一直挂着
