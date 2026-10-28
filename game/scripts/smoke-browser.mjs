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
      const out = await evaluate(`(async () => { const g = window.__game; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${c.code} })()`);
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
