// batch26：A 生产 preview（5770）参数剔除 / 软件渲染提示 / 原生 structuredClone；B preview:smoke（5772）全屏真实 Esc + CDP
import { open, sleep, SH13 as SH } from './b26lib.mjs';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const D = `${SH}/hooks`; mkdirSync(D, { recursive: true }); const SHOT = `${SH}/shots`;
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = {}; const save = () => writeFileSync(`${D}/t26-hooks.json`, JSON.stringify(out, null, 1));
const pres = `(() => { const vis = (s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; };
  return { game: typeof window.__game, qaPuzzles: typeof window.__qa?.puzzles, perfSpot: typeof window.__perfSpot, s1: typeof window.__s1, s2: typeof window.__s2, s3: typeof window.__s3, testbed: typeof window.__testbed,
    menu: vis('.main-menu'), hud: vis('.hud'), loading: vis('.loading-screen') || vis('.loading'), debugPanel: !!document.querySelector('.debug-panel'), fpsDetailed: !!document.querySelector('.fps-counter.detailed'), fps: vis('.fps-counter'),
    sc: typeof structuredClone, scNative: /\\[native code\\]/.test(String(window.structuredClone)), scInline: !!document.getElementById('polyfill-structured-clone'),
    art: performance.getEntriesByType('resource').filter((r) => /\\/assets\\/art\\//.test(r.name)).length,
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120) }; })()`;
const notice = `(() => { const n = document.querySelector('.main-render-notice'); if (!n) return null; const r = n.getBoundingClientRect(); const cs = getComputedStyle(n);
  const btns = [...document.querySelectorAll('.main-menu .main-btn')].filter((b) => b.getClientRects().length).map((b) => { const q = b.getBoundingClientRect(); return { act: b.dataset.act, x: q.x, y: q.y, w: q.width, h: q.height }; });
  const overlap = btns.filter((b) => !(b.x + b.w <= r.x || r.x + r.width <= b.x || b.y + b.h <= r.y || r.y + r.height <= b.y)).map((b) => b.act);
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { hidden: n.hidden, vis: !n.hidden && r.width > 0, text: n.textContent, rect: [r.x, r.y, r.width, r.height].map(Math.round), pe: cs.pointerEvents, font: cs.fontFamily, hit: hit ? (hit.className || hit.tagName) : null, hitIsNotice: hit === n || n.contains(hit), overlap, btns: btns.length, focus: document.activeElement === n }; })()`;
const EXPECT = '浏览器的硬件加速没有打开，画面可能会卡顿。可以在浏览器设置里开启硬件加速，再重新打开游戏。';
const { page, ev, must, url, done, clickSel, rect } = await open(5770, { width: 1280, height: 720 });
const S = page.send;
const toMenu = async (q) => { await ev(`localStorage.clear(), 1`).catch(() => 0); await page.goto(url(q)); await sleep(1500); await must(`document.readyState === 'complete'`, 120000); await page.waitFor(`!!document.querySelector('.main-menu') || !!document.querySelector('.hud')`, 180000, 300); await sleep(8000); };
let smokeProc = null;
try {
  // A1 主菜单：软件渲染提示 + 字形实际用的字体（CDP CSS.getPlatformFontsForNode）+ 真实点击穿透
  await toMenu('');
  out.gpu = await ev(`(() => { try { const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'); const x = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(x.UNMASKED_RENDERER_WEBGL); } catch (e) { return String(e); } })()`);
  out.plain = await ev(pres); out.notice = await ev(notice); out.noticeExpectEq = out.notice?.text === EXPECT; log('plain', JSON.stringify(out.plain)); log('notice', JSON.stringify(out.notice), 'eq', out.noticeExpectEq, out.gpu);
  await page.screenshot(`${SHOT}/b26-software-notice-menu.png`);
  try {
    await S('DOM.enable'); await S('CSS.enable'); const { root } = await S('DOM.getDocument', { depth: -1 }); const { nodeId } = await S('DOM.querySelector', { nodeId: root.nodeId, selector: '.main-render-notice' });
    out.platformFonts = (await S('CSS.getPlatformFontsForNode', { nodeId })).fonts; log('platformFonts', JSON.stringify(out.platformFonts));
  } catch (e) { out.platformFonts = 'ERR ' + e.message; }
  out.fontsLoaded = await ev(`[...document.fonts].map((f) => f.family + ':' + f.status).join(', ')`);
  // 点在提示正中：应穿透（不触发任何按钮、提示不拿焦点）；再真实点「设置」→ 返回
  if (out.notice?.vis) { const [x, y, w, h] = out.notice.rect; await page.click(x + w / 2, y + h / 2); await sleep(500); out.clickThrough = await ev(`({ settings: !!document.querySelector('.settings-panel') && !document.querySelector('.settings-panel').closest('[hidden]') && document.querySelector('.settings-panel').getClientRects().length > 0, active: document.activeElement?.className || document.activeElement?.tagName })`); }
  await clickSel('.main-menu [data-act="settings"]'); await sleep(800);
  out.afterSettings = await ev(`({ settingsVis: (() => { const e = document.querySelector('.settings-panel'); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; })(), notice: ${notice} })`);
  await page.screenshot(`${SHOT}/b26-software-notice-settings.png`);
  await page.tap('Escape'); await sleep(800);
  out.afterBack = await ev(`({ menu: !!document.querySelector('.main-menu') && document.querySelector('.main-menu').getClientRects().length > 0, notice: ${notice} })`); log('settings', JSON.stringify(out.afterSettings), JSON.stringify(out.afterBack));
  // 进 S1（art=0 减负）：提示随主菜单隐藏
  await toMenu('?art=0');
  await clickSel('.main-menu [data-act="new"]'); await sleep(1000);
  await page.waitFor(`!document.querySelector('.main-menu') || document.querySelector('.main-menu').getClientRects().length === 0 || !!document.querySelector('.main-menu').closest('[hidden]')`, 60000, 300);
  await sleep(6000); out.inS1 = { pres: await ev(pres), notice: await ev(notice) }; log('inS1', JSON.stringify(out.inS1));
  await page.screenshot(`${SHOT}/b26-software-notice-s1-hidden.png`);
  // A2 生产参数：都应无效
  for (const q of ['?debug=1', '?debug=1&scene=s2&art=0', '?scene=s3', '?debug=1&scene=s3&art=0', '?scene=sandbox&debug=1', '?scene=testbed', '?hintScale=0.05&debug=1', '?father=gaze&debug=1', '?smoke=1&autostart=1']) {
    await toMenu(q); const r = await ev(pres); r.q = q;
    await page.tap('F3'); await sleep(800); r.afterF3 = await ev(`({ fps: !!document.querySelector('.fps-counter') && document.querySelector('.fps-counter').getClientRects().length > 0 && !document.querySelector('.fps-counter').closest('[hidden]'), detailed: !!document.querySelector('.fps-counter.detailed'), text: document.querySelector('.fps-counter')?.innerText?.slice(0, 120) })`);
    (out.prod ??= []).push(r); log('prod', q, JSON.stringify(r));
    await page.screenshot(`${D}/prod-${q.replace(/[^a-z0-9]+/gi, '_')}.png`).catch(() => 0);
  }
  // ?smoke=1 在生产包里不再默认关美术：点新游戏后应请求 assets/art/
  await toMenu('?smoke=1'); const a0 = (await ev(pres)).art;
  await clickSel('.main-menu [data-act="new"]');
  await page.waitFor(`performance.getEntriesByType('resource').filter((r) => /\\/assets\\/art\\//.test(r.name)).length > ${a0 + 5}`, 90000, 500);
  out.smokeArt = { menuArt: a0, afterNew: (await ev(pres)).art }; log('smokeArt', JSON.stringify(out.smokeArt));
  await page.goto('about:blank'); await sleep(2000);
  // B preview:smoke：全屏（真实 Esc + CDP）
  const G = process.env.QA_GAME; const before = readdirSync('/tmp').filter((n) => n.startsWith('foglight-smoke-dist-'));
  smokeProc = spawn('npm', ['run', 'preview:smoke'], { cwd: G, env: { ...process.env, PORT: '5772' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let sout = ''; smokeProc.stdout.on('data', (d) => (sout += d)); smokeProc.stderr.on('data', (d) => (sout += d));
  for (let k = 0; k < 180 && !/测试构建已起/.test(sout); k++) await sleep(1000);
  const mine = readdirSync('/tmp').filter((n) => n.startsWith('foglight-smoke-dist-') && !before.includes(n)); out.smokeDir = mine;
  const ST = `(() => { const g = __game, c = g.renderer.domElement, b = document.querySelector('.settings-panel [data-act="fullscreen"]');
    return { fs: g.fullscreen, doc: !!document.fullscreenElement, n: g.debugStats.fullscreenChanges, black: g.debugStats.resizeAfterRender, paused: g.isPaused, ctx: g.input.context, pauses: window.__p ?? -1, keys: window.__k ?? -1,
      cw: c.width, ch: c.height, win: [innerWidth, innerHeight], want: [g.container.clientWidth, g.container.clientHeight].map((v) => Math.floor(Math.max(1, v) * g.renderer.getPixelRatio())), btn: b ? { on: b.classList.contains('on'), aria: b.getAttribute('aria-pressed') } : null }; })()`;
  await page.goto(`http://127.0.0.1:5772/?smoke=1&debug=1&scene=s1&art=0`);
  await must(`!!window.__s1 && __game.input.context === 'explore'`, 600000, 's1 explore');
  await sleep(2000);
  await ev(`(() => { window.__p = 0; window.__k = 0; __game.events.on('game:pause', () => window.__p++); addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__k++; }, true); })()`);
  const gest = (e) => S('Runtime.evaluate', { expression: e, userGesture: true, awaitPromise: true, returnByValue: true });
  const fsr = (out.fs = {});
  fsr.s0 = await ev(ST);
  await gest('document.documentElement.requestFullscreen()'); await sleep(1500); fsr.in = await ev(ST);
  await page.tap('Escape'); await sleep(1500); fsr.realEsc = await ev(ST); log('fs realEsc', JSON.stringify(fsr.realEsc));
  if (fsr.realEsc.doc) { await ev('document.exitFullscreen()'); await sleep(1500); fsr.exitAfterEsc = await ev(ST); }
  // 未暂停时：浏览器退出（无 keydown）→ 补暂停一次
  if (await ev('__game.isPaused')) { await ev('__game.resume()'); await sleep(800); }
  await ev('window.__p = 0'); fsr.beforeExit2 = await ev(ST);
  await gest('document.documentElement.requestFullscreen()'); await sleep(1500); fsr.in2 = await ev(ST);
  await ev('document.exitFullscreen()'); await sleep(1500); fsr.browserExit = await ev(ST); log('fs browserExit', JSON.stringify(fsr.browserExit));
  // 设置面板开着：真实点击全屏按钮 → 按下态；真实 Esc → 状态
  await ev('__game.ui.pause.openSettings()'); await sleep(600);
  const r = await rect('.settings-panel [data-act="fullscreen"]'); fsr.btnRect = r;
  if (r?.vis) { await page.click(r.x, r.y); await sleep(1500); fsr.btnIn = await ev(ST); await page.tap('Escape'); await sleep(1500); fsr.btnEsc = await ev(ST); if (fsr.btnEsc.doc) { await ev('document.exitFullscreen()'); await sleep(1200); fsr.btnExit = await ev(ST); } }
  await page.screenshot(`${D}/fs-settings-after.png`).catch(() => 0);
  log('fs', JSON.stringify(fsr));
  process.kill(-smokeProc.pid, 'SIGINT'); await new Promise((r) => { smokeProc.on('exit', r); setTimeout(r, 15000); }); await sleep(1500);
  out.smokeDirAfterSigint = mine.map((n) => ({ n, exists: existsSync('/tmp/' + n) })); smokeProc = null;
  out.errors = page.errors.slice(0, 10); save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
if (smokeProc) { try { process.kill(-smokeProc.pid, 'SIGINT'); } catch {} await sleep(3000); }
await done(); process.exit(0);
