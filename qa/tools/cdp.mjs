// 最小 CDP 客户端（Node 内置 WebSocket），QA 用
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_ARGS = (w, h, profile) => [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${w},${h}`,
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...(process.env.QA_EXTRA ? process.env.QA_EXTRA.split(' ') : []), 'about:blank',
];

export const KEYCODES = { KeyE: 69, KeyY: 89, KeyU: 85, KeyO: 79, KeyQ: 81, KeyR: 82, KeyH: 72, KeyJ: 74, KeyG: 71, KeyT: 84, KeyC: 67, KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, Space: 32, Tab: 9, Escape: 27, F3: 114, F4: 115, ShiftLeft: 16 };
export const KEYS = { KeyE: 'e', KeyY: 'y', KeyU: 'u', KeyO: 'o', KeyQ: 'q', KeyR: 'r', KeyH: 'h', KeyJ: 'j', KeyG: 'g', KeyT: 't', KeyC: 'c', KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', Space: ' ', Tab: 'Tab', Escape: 'Escape', F3: 'F3', F4: 'F4', ShiftLeft: 'Shift' };

async function connect(width, height) {
  const profile = mkdtempSync(join(tmpdir(), 'qa-chrome-'));
  const chrome = spawn('/usr/bin/google-chrome', CHROME_ARGS(width, height, profile), { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const killAll = () => { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* */ } };
  process.on('exit', killAll);
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('chrome timeout: ' + buf.slice(0, 500))), 20000);
    chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  chrome.killAll = killAll;
  return { chrome, ws };
}

export async function launch({ width = 1280, height = 720 } = {}) {
  const { chrome, ws } = await connect(width, height);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  const errors = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const pg = makePage(s, errors); pg.onEvent = (fn) => listeners.push((m) => { if (m.sessionId === sessionId) fn(m); });
  return { page: pg, close: () => { try { ws.close(); } catch { /* */ } chrome.killAll(); } };
}

function makePage(s, errors) {
  const page = {
    send: s,
    errors,
    async evaluate(expression) {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) { await s('Page.navigate', { url }); },
    async addInit(source) { return s('Page.addScriptToEvaluateOnNewDocument', { source }); },
    async waitFor(expr, ms = 60000, step = 100) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try { if (await page.evaluate(expr)) return true; } catch { /* page loading */ }
        await sleep(step);
      }
      return false;
    },
    async screenshot(path) {
      const r = await s('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return path;
    },
    async mouse(type, x, y, button = 'none') {
      const buttons = { none: 0, left: 1, right: 2, middle: 4 }[button];
      await s('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' ? 0 : buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    },
    async click(x, y, button = 'left') {
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y, button);
      await page.mouse('mouseReleased', x, y, button);
    },
    async wheel(x, y, deltaY) { await s('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); },
    async keyDown(code) { await s('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: KEYS[code] ?? code, windowsVirtualKeyCode: KEYCODES[code] ?? 0, nativeVirtualKeyCode: KEYCODES[code] ?? 0 }); },
    async keyUp(code) { await s('Input.dispatchKeyEvent', { type: 'keyUp', code, key: KEYS[code] ?? code, windowsVirtualKeyCode: KEYCODES[code] ?? 0, nativeVirtualKeyCode: KEYCODES[code] ?? 0 }); },
    async tap(code) { await page.keyDown(code); await sleep(30); await page.keyUp(code); },
  };
  return page;
}
