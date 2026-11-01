// 030 UI 截图：主菜单（008 实时背景 / 悬停 / 静态兜底）、设置、加载页、阅读 ×6 纸张（附格线对齐量测）、日志、暂停、章节结尾。
//   1920×1080 → ../docs/tasks/shots-030/，量测与懒加载请求记录在 shots-030.json。对照 art/source/ui/preview/030-ui-*.png。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/shots-030.mjs [名字前缀,…]
// 等待都用游戏时间 / 帧数；平时开小窗（480×270），只在截图时切 1920×1080（盒子上 SwiftShader 很慢）。截完显式退出。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, '../docs/tasks/shots-030');
mkdirSync(OUT, { recursive: true });
const chromePath = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));

// SHOTS_SIZE=1280x720 → 换分辨率，文件名 / 报告加 -720 后缀（默认 1920×1080 不加）
const [W, H] = (process.env.SHOTS_SIZE ?? '1920x1080').split('x').map(Number);
const SIZE_SUFFIX = H === 1080 ? '' : `-${H}`;
const only = process.argv[2]?.split(',').filter(Boolean) ?? null;
const want = (name) => !only || only.some((o) => name.startsWith(o));

// batch25：生产 dist 不含 __game 等钩子 → 用测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用）
const game = await startGameServer(root);
const server = game.server;
const base = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1&quality=high`;
const profile = mkdtempSync(join(tmpdir(), 'shots030-chrome-'));
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


const reportFile = join(OUT, `shots-030${only ? '-' + only.join('+') : ''}${SIZE_SUFFIX}.json`); // 只拍部分时另存，不覆盖全量报告
const report = { shots: [], failed: [], align: {}, errors };

const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none' }, sessionId);
/** 切到 1920×1080 截一张（截完回小窗，SwiftShader 下大窗每帧很慢） */
const big = async (name, info = {}, before = null) => {
  if (!want(name)) return;
  try {
    await setView(W, H);
    await until(`innerWidth === ${W}`, 60000);
    if (before) await before();
    await waitFrames(3);
    await sleep(400); // CSS 过渡（220 ms）走完
    const file = await shot(`${name}${SIZE_SUFFIX}.png`);
    report.shots.push({ name, file, ...info });
    console.log('  ✓', name, Object.keys(info).length ? JSON.stringify(info) : '');
  } catch (e) {
    report.failed.push({ name, error: String(e?.message ?? e) });
    console.log('  ✗', name, e?.message ?? e);
  }
  await setView(...SMALL).catch(() => {});
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
};
const rectOf = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

/**
 * 格线对齐量测：在页面里把纸张原图（2x）画到 canvas，取正文列（x 38.4–505.6 css）每行平均亮度，找比上下 6 px 都暗的行 = 格线；
 * 再用 Range.getClientRects 取正文每一行字的框（相对 .reader-paper），对比 README §2.2 的预测 y = 71.2 + 32.3·(k+1) − 1.5。
 */
const ALIGN = `(async () => {
  const paper = document.querySelector('.reader-paper');
  const pr = paper.getBoundingClientRect();
  const out = { paper: [Math.round(pr.width * 10) / 10, Math.round(pr.height * 10) / 10], state: paper.dataset.paper, key: paper.dataset.paperKey };
  const body = document.querySelector('.reader-body');
  const br = body.getBoundingClientRect();
  out.bodyTop = Math.round((br.top - pr.top) * 10) / 10;
  out.bodyX = [Math.round((br.left - pr.left) * 10) / 10, Math.round((br.right - pr.left) * 10) / 10];
  const lh = parseFloat(getComputedStyle(body).lineHeight);
  out.lineHeight = lh;
  const range = document.createRange();
  range.selectNodeContents(body);
  const rows = new Map();
  for (const r of range.getClientRects()) { if (r.width < 2) continue; const k = Math.round((r.top - br.top) / lh); const b = r.bottom - pr.top; rows.set(k, Math.max(rows.get(k) ?? 0, b)); }
  out.glyphBottoms = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => [k, Math.round(b * 10) / 10]);
  const m = /url\\("?([^")]+)"?\\)/.exec(paper.style.getPropertyValue('--paper'));
  if (m) {
    const img = new Image(); img.src = m[1]; await img.decode();
    const s = img.naturalWidth / pr.width;
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const x0 = Math.round(60 * s), x1 = Math.round(480 * s);
    const d = g.getImageData(x0, 0, x1 - x0, c.height).data;
    const lum = []; for (let y = 0; y < c.height; y++) { let t = 0; for (let x = 0; x < x1 - x0; x++) { const i = (y * (x1 - x0) + x) * 4; t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; } lum.push(t / (x1 - x0)); }
    const rules = [];
    for (let y = 8; y < lum.length - 8; y++) {
      const around = (lum[y - 7] + lum[y - 6] + lum[y + 6] + lum[y + 7]) / 4;
      if (around - lum[y] > 6 && lum[y] <= lum[y - 1] && lum[y] < lum[y + 1]) rules.push(Math.round((y / s) * 10) / 10);
    }
    out.rulesCss = rules.filter((y) => y > 60 && y < 640);
    const pred = []; for (let k = 0; k < 18; k++) pred.push(71.2 + lh * (k + 1) - 1.5);
    out.ruleDelta = out.rulesCss.length ? pred.filter((p) => p < 620).map((p) => { const n = out.rulesCss.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a)); return Math.round((n - p) * 10) / 10; }) : [];
    out.glyphToRule = out.glyphBottoms.map(([k, b]) => Math.round((71.2 + lh * (k + 1) - 1.5 - b) * 10) / 10);
  }
  // BUG-021 表格纸（值班簿）：每格字框 vs 纸面竖线（2x 原图 1088 宽 → css 544，按纸张实际宽度缩放）。
  //   左对齐列：字左 − (左线 + 5)；居中列：字中 − 两线中点；越界：字右超过右线；竖直：字中 − 两条格线中点（第 k 行在 rule k−1 与 rule k 之间）
  const cells = [...document.querySelectorAll('.reader-cell')];
  if (cells.length) {
    const EDGES = [29.5, 146, 178, 232, 515];
    const sc = pr.width / 544;
    const rule = (k) => (71.2 + lh * (k + 1) - 1.5) * sc;
    const errs = { start: [], center: [], overflow: [], vertical: [] };
    const sample = [];
    for (const c of cells) {
      const col = +c.dataset.col; const t = c.querySelector('.reader-cell-text') ?? c;
      const rg = document.createRange(); rg.selectNodeContents(t); const rs = [...rg.getClientRects()].filter((r) => r.width > 1); if (!rs.length) continue;
      const L = Math.min(...rs.map((r) => r.left)) - pr.left, R = Math.max(...rs.map((r) => r.right)) - pr.left;
      const T = Math.min(...rs.map((r) => r.top)) - pr.top, B = Math.max(...rs.map((r) => r.bottom)) - pr.top;
      const row = c.closest('.reader-row'); const k = [...row.parentElement.children].indexOf(row);
      const l = EDGES[col] * sc, r = EDGES[col + 1] * sc;
      const center = getComputedStyle(c).justifyContent === 'center' || col === 1 || col === 2;
      if (center) errs.center.push(Math.round(((L + R) / 2 - (l + r) / 2) * 10) / 10); else errs.start.push(Math.round((L - (l + 5 * sc)) * 10) / 10);
      if (R > r + 0.5 || L < l - 0.5) errs.overflow.push({ k, col, L: Math.round(L), R: Math.round(R), l: Math.round(l), r: Math.round(r) });
      const vc = (T + B) / 2 - (rule(k - 1) + rule(k)) / 2; errs.vertical.push(Math.round(vc * 10) / 10);
      if (sample.length < 8) sample.push({ k, col, text: t.textContent.slice(0, 8), L: Math.round(L * 10) / 10, R: Math.round(R * 10) / 10, fs: getComputedStyle(t).fontSize });
    }
    const st = (a) => (a.length ? { n: a.length, maxAbs: Math.max(...a.map(Math.abs)), mean: Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 } : null);
    out.table = { scale: Math.round(sc * 1000) / 1000, cells: cells.length, start: st(errs.start), center: st(errs.center), vertical: st(errs.vertical), overflow: errs.overflow, sample,
      titles: [...document.querySelectorAll('.reader-title, .reader-body h1, .reader-body h2')].map((e) => e.textContent.trim()).filter(Boolean) };
  }
  // BUG-022：翻页箭头 font 继承
  const arrow = document.querySelector('.reader-arrow');
  if (arrow) out.arrowFont = { arrow: getComputedStyle(arrow).fontFamily, body: getComputedStyle(body).fontFamily, ui: getComputedStyle(document.getElementById('ui-root') ?? document.body).fontFamily };
  return out;
})()`;

// ---------------- 主菜单（008 实时背景） ----------------
console.log('  … 主菜单');
await setView(...SMALL);
await send('Page.navigate', { url: base }, sessionId);
await sleep(500);
if (!(await until(`window.__game?.ui?.mainMenu?.isOpen && document.fonts.status === 'loaded'`, 400000))) throw new Error('主菜单没出来');
await until(`(() => { const i = document.querySelector('.ui-logo'); return !!i && i.complete; })()`, 60000);
const uiInfo = await evaluate(`(() => ({ classes: document.documentElement.className, vars: [...document.documentElement.style].filter((p) => p.startsWith('--ui-img')).length, favicon: document.querySelector('link[rel="icon"]')?.href?.slice(-22), logo: !!document.querySelector('.main-title.has-logo') }))()`);
console.log('   UI 美术：', JSON.stringify(uiInfo));
report.ui = uiInfo;
await waitGame(1);
await big('030-menu', { bg: '008 实时背景' });
await big('030-menu-hover-primary', {}, async () => { const p = await rectOf('.main-menu .menu-btn.primary'); await mouse('mouseMoved', p.x, p.y); });
await big('030-menu-hover-text', {}, async () => { const p = await rectOf('.main-menu .menu-btn[data-act="settings"]'); await mouse('mouseMoved', p.x, p.y); });
await mouse('mouseMoved', 5, 5);
await big('030-settings', {}, async () => { await evaluate(`(() => { __game.ui.mainMenu.openSettings(); return 1; })()`); });
await evaluate(`(() => { __game.ui.mainMenu.show(); return 1; })()`).catch(() => {});
await big('030-loading', {}, async () => { await evaluate(`(() => { __game.ui.loading.show(); __game.ui.loading.setProgress(0.42); return 1; })()`); await sleep(500); });
await evaluate(`(() => { __game.ui.loading.hide(); return 1; })()`);
await sleep(600);

// 静态兜底背景（?menuBg=illust）
if (want('030-menu-illust')) {
  await send('Page.navigate', { url: `${base}&menuBg=illust` }, sessionId);
  await sleep(500);
  await until(`window.__game?.ui?.mainMenu?.isOpen && document.querySelector('.main-menu').dataset.bg === 'illust'`, 400000);
  await big('030-menu-illust', { bg: 'ui-illust-menu.webp 兜底' });
}

// ---------------- S1：阅读 ×6、日志、暂停 ----------------
const needS1 = ['030-read', '030-journal', '030-pause', '030-end'].some((p) => want(p) || (only ?? []).some((o) => o.startsWith(p)));
if (needS1) {
  console.log('  … 进 S1');
  await send('Page.navigate', { url: `${base}&autostart=1` }, sessionId);
  await sleep(500);
  if (!(await until(`!!window.__s1?.rig && window.__game.scenes.current.name === 's1-ebb-shore'`, 600000))) throw new Error('S1 没就绪');
  await until(`!!__s1.art`, 300000);
  await waitGame(1);
  const reqBefore = await evaluate(`performance.getEntriesByType('resource').filter((e) => /ui-paper-|chapter1-end|ui-illust-menu/.test(e.name)).map((e) => e.name.split('/').pop())`);
  report.lazyBeforeReader = reqBefore;
  console.log('   进 S1 后懒加载图片请求：', reqBefore.length ? reqBefore : '无（正确）');
  const DOCS = [
    ['journal', 'ch1.s2.journal.doc'],
    ['letter', 'ch1.s2.reply_draft.doc'],
    ['note', 'ch1.s1.neighbor_note.doc'],
    ['sketch', 'ch1.s2.sketch.doc'],
    ['notice', 'ch1.s1.notice.doc'],
    ['logbook', 'ch1.s3.logbook.doc'],
  ];
  for (const [paper, doc] of DOCS) {
    const name = `030-read-${paper}`;
    await evaluate(`(() => { __game.ui.reader.open(${JSON.stringify(doc)}); return 1; })()`);
    await until(`['ready', 'fallback'].includes(document.querySelector('.reader-paper').dataset.paper)`, 60000);
    if (!want(name)) { await evaluate(`(() => { __game.ui.reader.close(false); return 1; })()`); continue; }
    await setView(W, H);
    await until(`innerWidth === ${W}`, 60000);
    const align = await evaluate(ALIGN).catch((e) => ({ error: String(e) }));
    report.align[paper] = align;
    console.log('   格线', paper, JSON.stringify({ state: align.state, bodyTop: align.bodyTop, rules: align.rulesCss?.slice(0, 4), ruleDelta: align.ruleDelta?.slice(0, 8), glyphToRule: align.glyphToRule?.slice(0, 6), table: align.table && { start: align.table.start, center: align.table.center, vertical: align.table.vertical, overflow: align.table.overflow.length }, arrowFont: align.arrowFont }));
    await big(name, { doc, state: align.state });
    await evaluate(`(() => { __game.ui.reader.close(false); return 1; })()`);
  }
  const reqAfter = await evaluate(`performance.getEntriesByType('resource').filter((e) => /ui-paper-/.test(e.name)).map((e) => e.name.split('/').pop())`);
  report.lazyAfterReader = reqAfter;
  console.log('   打开阅读后纸张请求：', reqAfter);
  await big('030-journal', {}, async () => { await evaluate(`(() => { __game.ui.journal.open(); return 1; })()`); });
  await evaluate(`(() => { __game.ui.journal.close?.(); return 1; })()`).catch(() => {});
  await big('030-pause', {}, async () => { await evaluate(`(() => { __game.pause('user'); return 1; })()`); });
  await evaluate(`(() => { __game.resume(); return 1; })()`).catch(() => {});

  // ---------------- 章节结尾 ----------------
  if (want('030-end')) {
    console.log('  … 章节结尾');
    await evaluate(`(() => { void __game.flow.completeChapter(); return 1; })()`);
    await until(`__game.ui.chapterEnd.isOpen && ['ready', 'fallback'].includes(document.querySelector('.chapter-end-art').dataset.art)`, 300000);
    const endInfo = await evaluate(`(() => { const a = document.querySelector('.chapter-end-art'); const r = a.getBoundingClientRect(); return { art: a.dataset.art, aria: a.getAttribute('aria-label'), labelShown: getComputedStyle(document.querySelector('.chapter-end-art-label')).display !== 'none', w: r.width, h: r.height }; })()`);
    await waitGame(1);
    await big('030-end', endInfo, async () => {
      const r = await evaluate(`(() => { const r = document.querySelector('.chapter-end-art').getBoundingClientRect(); return [r.width, r.height]; })()`);
      endInfo.w1080 = r;
    });
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
