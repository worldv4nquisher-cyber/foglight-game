// 无头 Chrome 冒烟测试：构建产物（dist/）用 vite preview 起服务 → 无头 Chrome 打开 ?smoke=1 →
// 等主场景就绪 → 跑下面的 CHECKS → 汇总控制台错误 / 未捕获异常。任何一项失败退出码 1。
// 用法：npm run build && npm run smoke（需要本机有 Chrome/Chromium；路径可用 CHROME=/path 指定）
// 依赖：只用 Node 内置（child_process、WebSocket），不额外装 puppeteer。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(root, 'dist/index.html'))) {
  console.error('dist/ 不存在，先运行 npm run build');
  process.exit(1);
}
// 构建产物：DRACO 只应有 glTF 专用 wasm 一套（wrapper.js + .wasm），不应有通用版和纯 JS 回退
{
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(root, 'dist/static'));
  const draco = files.filter((f) => f.startsWith('draco_'));
  const basis = files.filter((f) => f.startsWith('basis_'));
  const okDraco = draco.length === 2 && draco.some((f) => /^draco_wasm_wrapper-.*\.js$/.test(f)) && draco.some((f) => /^draco_decoder-.*\.wasm$/.test(f));
  const okBasis = basis.length === 2 && basis.some((f) => f.endsWith('.js')) && basis.some((f) => f.endsWith('.wasm'));
  if (!okDraco || !okBasis) {
    console.error(`  ✗ dist 解码器文件不对：${[...draco, ...basis].join(', ')}`);
    process.exit(1);
  }
  console.log(`  ✓ dist 解码器各一套：${[...draco, ...basis].join(', ')}`);
}
const chromePath =
  process.env.CHROME ??
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
    (p) => existsSync(p),
  );
if (!chromePath) {
  console.error('找不到 Chrome，用 CHROME=/path/to/chrome 指定');
  process.exit(1);
}

/**
 * 页面内执行的检查（字符串形式的 async 函数体，可用 g = window.__game）。返回描述字符串；抛错即失败。
 * 各需求单的可自动校验项加在这里。
 */
const CHECKS = [
  {
    name: '主场景运行、渲染循环在走',
    code: `
      const f0 = g.time.frame; await sleep(500);
      if (g.time.frame <= f0) throw new Error('帧计数没有增加');
      return 'scene=' + g.scenes.current.name + ' frames+' + (g.time.frame - f0);`,
  },
  {
    name: 'DRACO glTF 专用 wasm 解码器可加载并运行',
    code: `
      const d = g.assets.draco;
      if (!/draco_wasm_wrapper/.test(d.decoderPaths.js) || !/draco_decoder.*\\.wasm/.test(d.decoderPaths.wasm)) throw new Error('decoderPaths 不对: ' + JSON.stringify(d.decoderPaths));
      if (d.decoderPaths.dep_js !== null) throw new Error('仍然保留了 JS 回退');
      // 喂一段无效数据：如果 wasm 成功实例化，worker 会返回解码器自己的错误（Unexpected geometry type / Decoding failed）
      const msg = await new Promise((res) => d.parse(new Uint8Array(64).buffer, () => res('意外成功'), (e) => res(String(e?.error ?? e?.message ?? e))));
      if (!/Unexpected geometry type|Decoding failed/.test(msg)) throw new Error('解码器未正常运行: ' + msg);
      return 'wasm=' + d.decoderPaths.wasm.split('/').pop() + '；无效数据 → ' + msg;`,
  },
  {
    name: 'KTX2 Basis 转码器（js 胶水 + wasm）可加载',
    code: `
      const k = g.assets.ktx2;
      await k.init();
      if (!k.workerSourceURL) throw new Error('转码器 worker 未建立');
      const files = performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /basis_transcoder/.test(n));
      if (files.length !== 2) throw new Error('应加载 basis_transcoder .js + .wasm 各一次，实际: ' + files.join(','));
      return files.join(' + ');`,
  },
  {
    name: 'v0.1-001 输入：键位按上下文映射、Esc 暂停压 menu、F4 调试面板',
    code: `
      const inp = g.input;
      const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      const tap = async (code) => { key(code, 'keydown'); key(code, 'keyup'); await sleep(50); };
      const last = () => inp.recent[0] && inp.recent[0].context + ':' + inp.recent[0].action;
      // SwiftShader 只有个位数帧率：按下要等下一帧 tick 才被 Game 消费，轮询等待
      const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); };
      if (inp.context !== 'explore') throw new Error('初始上下文 ' + inp.context);
      if (!document.querySelector('canvas').requestPointerLock) throw new Error('无 requestPointerLock');
      await tap('KeyE'); if (last() !== 'explore:interact') throw new Error('explore E → ' + last());
      await tap('Space'); if (last() !== 'explore:advance') throw new Error('explore Space → ' + last());
      const pop = inp.pushContext('puzzle');
      await tap('KeyE'); if (last() !== 'puzzle:partNext') throw new Error('puzzle E → ' + last());
      await tap('Tab'); if (last() !== 'puzzle:exitPuzzle') throw new Error('puzzle Tab → ' + last());
      pop();
      await tap('Escape'); await until(() => g.isPaused);
      if (!g.isPaused || inp.context !== 'menu') throw new Error('Esc 后 paused=' + g.isPaused + ' ctx=' + inp.context);
      if (document.querySelector('.pause-menu').hidden) throw new Error('暂停菜单没显示');
      await tap('Escape'); await until(() => !g.isPaused);
      if (g.isPaused || inp.context !== 'explore') throw new Error('再按 Esc 后 paused=' + g.isPaused + ' ctx=' + inp.context);
      await tap('F4'); await sleep(400);
      const panel = document.querySelector('.debug-panel');
      const shown = panel && panel.style.display !== 'none' && /上下文/.test(panel.textContent);
      return 'E/Space/Tab/Esc 映射正确；F4 调试面板=' + (shown ? '显示' : '未开启（非调试模式）');`,
  },
  {
    name: 'v0.1-001 指针锁定：点击画面锁定、移动直接转视角、Esc 暂停、继续后再点可重新锁定',
    async run({ evaluate, cdp, sleep }) {
      const state = () =>
        evaluate(`({ locked: document.pointerLockElement === document.querySelector('canvas'), paused: __game.isPaused, ctx: __game.input.context, yaw: __game.scenes.current.cameraFollow?.yaw ?? null })`);
      const waitFor = async (pred, ms = 3000) => {
        const end = Date.now() + ms;
        let s = await state();
        while (!pred(s) && Date.now() < end) {
          await sleep(100);
          s = await state();
        }
        return s;
      };
      await cdp.click(640, 400);
      await waitFor((s) => s.locked);
      let s = await state();
      if (!s.locked) throw new Error('点击画面后没有进入指针锁定 ' + JSON.stringify(s));
      const yaw0 = s.yaw;
      for (let i = 1; i <= 5; i++) await cdp.move(640 + i * 20, 400);
      await sleep(300);
      s = await state();
      const turned = yaw0 === null ? '（未暴露 yaw）' : Math.abs(s.yaw - yaw0) > 1e-3 ? '转动 ' + (s.yaw - yaw0).toFixed(3) + ' rad' : null;
      if (!turned) throw new Error('锁定后移动鼠标视角没变 ' + JSON.stringify(s));
      await cdp.key('Escape', 'Escape', 27);
      s = await waitFor((s) => s.paused && !s.locked);
      if (!s.paused || s.locked) throw new Error('Esc 后应解锁并暂停 ' + JSON.stringify(s));
      const r = await evaluate(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.click(r.x, r.y); // 真实点击「继续」
      await sleep(1300); // 浏览器：解锁后约 1 秒内不能重新锁定
      s = await state();
      if (s.paused) throw new Error('继续后仍是暂停');
      await cdp.click(640, 400);
      s = await waitFor((s) => s.locked);
      if (!s.locked) throw new Error('继续后再点画面没有重新锁定 ' + JSON.stringify(s));
      await evaluate(`document.exitPointerLock()`);
      s = await waitFor((s) => !s.locked && s.paused);
      if (s.paused) await evaluate('__game.resume()');
      return '锁定 ✓，视角' + turned + '，Esc→暂停 ✓，重新锁定 ✓';
    },
  },
  {
    name: 'v0.1-006 存档 / 设置：进场自动存档、设置刷新保留且立即生效、坏存档提示、旧画质键迁移',
    async run({ evaluate, cdp, sleep }) {
      const read = () =>
        evaluate(`({
          save: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null'),
          settings: JSON.parse(localStorage.getItem('foglight.settings.v1') || 'null'),
          legacy: localStorage.getItem('game.quality'),
          status: __game.save.status, startup: __game.save.startupNotice,
          sens: __game.input.lookSensitivity, inv: __game.input.invertY, tier: __game.quality.tier,
          toast: (() => { const t = document.querySelector('.hud-toast'); return t && !t.hidden ? t.textContent : null; })(),
        })`);
      let s = await read();
      if (!s.save || s.save.version !== 1 || s.save.sceneId !== 'main') throw new Error('进场没有自动存档：' + JSON.stringify(s.save));
      if (!s.settings || s.settings.qualityDetected !== true) throw new Error('首次启动没有记下画质检测：' + JSON.stringify(s.settings));
      // 修改设置立即生效
      await evaluate(`__game.settings.update({ mouseSensitivity: 2.5, invertY: true })`);
      s = await read();
      if (s.sens !== 2.5 || s.inv !== true) throw new Error('设置没有立即生效 ' + JSON.stringify(s));
      // 写坏存档 + 旧画质键（模拟老版本残留），刷新
      await evaluate(`localStorage.setItem('foglight.save.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('foglight.save.v1')), version: 0 })); 1`);
      await cdp.reload();
      await sleep(300);
      s = await read();
      if (s.sens !== 2.5 || s.inv !== true) throw new Error('刷新后设置没保留 ' + JSON.stringify(s));
      if (s.startup !== '存档无法读取，只能开始新游戏。') throw new Error('坏存档没有提示：' + s.startup);
      if (!s.toast || !/存档无法读取/.test(s.toast)) throw new Error('HUD 没显示坏存档提示：' + s.toast);
      if (!s.save || s.save.version !== 1) throw new Error('坏存档后新游戏没有重新存档');
      // 旧键迁移：清掉设置、写旧键，刷新
      await evaluate(`localStorage.removeItem('foglight.settings.v1'); localStorage.setItem('game.quality', 'high'); 1`);
      await cdp.reload();
      s = await read();
      if (s.legacy !== null || s.settings?.quality !== 'high' || s.tier !== 'high') throw new Error('旧画质键迁移不对 ' + JSON.stringify(s));
      // 恢复干净状态
      await evaluate(`localStorage.clear(); 1`);
      await cdp.reload();
      return '自动存档 ✓，设置即时生效 / 刷新保留 ✓，坏存档提示 ✓，旧键迁移 ✓';
    },
  },
  {
    name: 'v0.1-002 角色控制器：测试场地速度、dev 面板读数、自动跨越、黑场送回',
    code: `
      const until = async (pred, ms = 8000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); return pred(); };
      await g.scenes.change('testbed');
      if (!(await until(() => window.__testbed && window.__testbed.rig && g.scenes.current && g.scenes.current.name === 'testbed'))) throw new Error('测试场地没进去');
      const tb = window.__testbed;
      const body = tb.rig.body.body;
      const ctl = tb.rig.controller;
      const inp = g.input;
      const hv = () => Math.hypot(body.actualVelocity.x, body.actualVelocity.z);
      if (!(await until(() => body.onGround))) throw new Error('出生后没着地');
      // 慢走 / 小跑（速度按固定步计算，与帧率无关）
      // 往左走（这一排一直到场地边缘都是空的）
      inp.setRaw('smoke', 'KeyA', true);
      if (!(await until(() => Math.abs(hv() - 1.6) < 0.08))) throw new Error('慢走速度 ' + hv().toFixed(2));
      inp.setRaw('smoke', 'ShiftLeft', true);
      if (!(await until(() => Math.abs(hv() - 3.2) < 0.16))) throw new Error('小跑速度 ' + hv().toFixed(2));
      inp.setRaw('smoke', 'ShiftLeft', false);
      inp.setRaw('smoke', 'KeyA', false);
      g.ui.debug.setVisible(true);
      await until(() => /速度 .* m\\/s/.test(document.querySelector('.debug-panel').textContent) && /碰撞 .* ms/.test(document.querySelector('.debug-panel').textContent));
      const panel = document.querySelector('.debug-panel').textContent;
      g.ui.debug.setVisible(false);
      if (!/碰撞 [0-9.]+ ms/.test(panel)) throw new Error('dev 面板没有碰撞耗时：' + panel);
      // 自动跨越：站到起点按 E，跨越中按住 W 也不影响路径，结束在终点
      tb.rig.body.teleport(tb.link.start.clone().setY(tb.link.start.y + 0.02));
      await until(() => body.onGround);
      if (!(await until(() => ctl.nearLink === tb.link))) throw new Error('起点没有识别到跨越点');
      if (!/跨过/.test(document.querySelector('.hud-prompt')?.textContent ?? '')) throw new Error('没显示跨越提示');
      inp.setRaw('smoke', 'KeyE', true);
      const started = await until(() => ctl.busy, 3000);
      inp.setRaw('smoke', 'KeyE', false);
      if (!started) throw new Error('按 E 没有开始跨越');
      inp.setRaw('smoke', 'KeyD', true);
      await until(() => !ctl.busy, 20000);
      inp.setRaw('smoke', 'KeyD', false);
      const d = body.position.distanceTo(tb.link.end);
      if (d > 0.1) throw new Error('跨越终点偏差 ' + d.toFixed(2));
      // 黑场送回：黑场出现 → 回到出生点并着地 → 黑场消失
      let sawBlack = false;
      const done = ctl.teleportTo(tb.course.anchors.spawn);
      const poll = (async () => { while (ctl.busy) { if (g.ui.fade.opacity >= 1) sawBlack = true; await sleep(30); } })();
      await Promise.race([done, sleep(20000)]);
      await poll;
      if (!sawBlack) throw new Error('没有黑场');
      if (g.ui.fade.opacity !== 0) throw new Error('黑场没退');
      await until(() => body.onGround);
      if (body.position.distanceTo(tb.course.anchors.spawn) > 0.05 || !body.onGround) throw new Error('送回位置不对 ' + body.position.toArray());
      await g.scenes.change('main');
      await until(() => g.scenes.current && g.scenes.current.name === 'main');
      return '慢走 1.6 / 小跑 3.2 ✓，dev 面板读数 ✓，跨越（' + tb.link.duration.toFixed(2) + ' s）✓，黑场送回 ✓';`,
  },
];
const extra = process.env.SMOKE_ONLY ? CHECKS.filter((c) => c.name.includes(process.env.SMOKE_ONLY)) : CHECKS;

// ---------------------------------------------------------------- 起服务 + 浏览器
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/?smoke=1${process.env.SMOKE_QUERY ? '&' + process.env.SMOKE_QUERY : ''}`;
const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('Chrome 启动超时')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) {
      clearTimeout(t);
      res(m[1]);
    }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
  } else if (msg.method) for (const l of listeners) l(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const errors = [];
const warnings = [];
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(`未捕获异常: ${d.exception?.description ?? d.text}`);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error') errors.push(`console.error: ${text}`);
    else if (m.params.type === 'warning') warnings.push(text);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`浏览器: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  }
});
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url }, sessionId);

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

// 可信（isTrusted）输入：指针锁定等需要真实用户手势的功能用它测
const cdp = {
  async click(x, y, button = 'left') {
    const buttons = { left: 1, right: 2, middle: 4 }[button];
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 }, sessionId);
  },
  async move(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  },
  /** 刷新页面并等主场景就绪（存档 / 设置的「刷新后仍保留」用） */
  async reload() {
    await send('Page.reload', { ignoreCache: false }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(window.__game?.scenes?.current?.name === 'main')`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('刷新后 60 秒内主场景没有就绪');
  },
  async key(code, key = code, keyCode = 0) {
    const base = { code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
  },
};

let failed = 0;
const t0 = Date.now();
try {
  // 等主场景
  let ready = false;
  while (Date.now() - t0 < 60000) {
    ready = await evaluate(`Boolean(window.__game?.scenes?.current?.name === 'main')`).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    const diag = await evaluate(
      `JSON.stringify({ href: location.href, hasGame: !!window.__game, scene: window.__game?.scenes?.current?.name ?? null, body: document.body.innerText.slice(0, 200) })`,
    ).catch((e) => String(e));
    throw new Error('60 秒内主场景没有就绪：' + diag);
  }
  console.log(`  ✓ 主场景就绪（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  for (const c of extra) {
    try {
      const out = c.run
        ? await c.run({ evaluate, cdp, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
        : await evaluate(`(async () => { const g = window.__game; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${c.code} })()`);
      console.log(`  ✓ ${c.name}${out ? '：' + out : ''}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${c.name}：${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failed++;
  console.log(`  ✗ ${e.message}`);
}

// 预期内的噪音：无 GPU 环境的 WebGL 性能提示
// 以及 DRACO 检查里故意喂无效数据时 worker 打出的解码错误
const realErrors = errors.filter(
  (e) => !/GPU stall due to ReadPixels|GL_CLOSE_PATH_NV|WebGL.*performance|DRACOLoader: Decoding failed: Unsupported geometry type/i.test(e),
);
for (const e of realErrors) console.log(`  ✗ ${e}`);
if (warnings.length) console.log(`  （警告 ${warnings.length} 条，首条：${warnings[0]?.slice(0, 120)}）`);
failed += realErrors.length;

ws.close();
chrome.kill('SIGKILL');
await new Promise((r) => server.httpServer.close(r));
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* Chrome 可能还占着文件 */
}
console.log(failed ? `冒烟测试失败：${failed} 项` : '冒烟测试通过');
process.exit(failed ? 1 : 0);
