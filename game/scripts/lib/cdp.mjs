// 无头 Chrome（swiftshader）+ CDP 小工具（037：verify-budget / verify-load 共用；写法同 shots-025 / smoke-browser）。
// 只清理自己起的 Chrome 和临时 profile；看门狗到点强退。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ width?: number, height?: number, tag?: string, watchdogMs?: number, evalMs?: number, onWatchdog?: () => void }} o
 */
export async function launchChrome(o = {}) {
  const W = o.width ?? 1280;
  const H = o.height ?? 720;
  const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
  if (!chromePath) throw new Error('找不到 Chrome（设 CHROME=…）');
  const profile = mkdtempSync(join(tmpdir(), `smoke-chrome-${o.tag ?? 'cdp'}-`));
  const chrome = spawn(
    chromePath,
    ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { chrome.kill('SIGKILL'); } catch { /* */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
  };
  // 被 timeout / Ctrl-C 结束时也收掉自己的 Chrome 和 profile
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); });
  const watchdog = setTimeout(() => {
    console.log('  ! 看门狗到点，强退');
    o.onWatchdog?.();
    cleanup();
    process.exit(2);
  }, o.watchdogMs ?? 30 * 60_000);
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('Chrome 启动超时')), 30000);
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(t); res(m[1]); }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  const listeners = new Set();
  let wsClosed = false;
  let crashed = false;
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
      return;
    }
    if (m.method === 'Inspector.targetCrashed' || m.method === 'Target.targetCrashed') {
      crashed = true;
      console.log('  ! 页面崩溃（多半是 swiftshader 内存）');
      for (const p of pending.values()) p.rej(new Error('页面崩溃'));
      pending.clear();
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    for (const f of listeners) f(m);
  });
  ws.addEventListener('close', () => {
    wsClosed = true;
    for (const p of pending.values()) p.rej(new Error('Chrome 连接断了'));
    pending.clear();
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      if (wsClosed) return rej(new Error('Chrome 连接断了'));
      if (crashed) return rej(new Error('页面崩溃'));
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params = {}) => send(method, params, sessionId);
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Inspector.enable').catch(() => {});
  const EVAL_MS = o.evalMs ?? 600_000;
  const evaluate = async (expression) => {
    const r = await Promise.race([
      s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate 超时（页面无响应）')), EVAL_MS)),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expr, ms = 120_000, step = 250) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (wsClosed || crashed) throw new Error('Chrome 连接断了 / 页面崩溃');
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(step);
    }
    return false;
  };
  const setView = (w, h) => s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const shot = async (file, w = W, h = H) => {
    const { data } = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };
  const close = () => {
    clearTimeout(watchdog);
    try { ws.close(); } catch { /* */ }
    cleanup();
  };
  process.once('exit', cleanup);
  return { send: s, evaluate, until, setView, shot, close, errors, on: (f) => listeners.add(f), off: (f) => listeners.delete(f), get crashed() { return crashed; } };
}
