import { REPO_ROOT } from './paths.mjs';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER } from './common.mjs';
const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch2');
const out = {};
const dev = await startDev(5223);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
await page.addInit(`(() => { let g; window.__qlog = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    const push = (type) => (e) => window.__qlog.push({ type, tier: e?.tier, src: e?.source, now: Math.round(performance.now()), el: +v.time.elapsed.toFixed(2), bm: v.benchmark.state });
    v.events.on('quality:changed', push('changed')); v.events.on('quality:detected', push('detected'));
    if (sessionStorage.getItem('qaAbort')) {
      // 第一次自动降到「高」后：暂停 → 点暂停菜单「极致」按钮（DOM click，走按钮自身的 click 处理）
      const off = v.events.on('quality:changed', (e) => { if (e.source !== 'auto' || e.tier !== 'high') return; off?.();
        setTimeout(() => { v.pause('user'); setTimeout(() => {
          const b = [...document.querySelectorAll('.pause-menu [data-role="quality"] button')].find(b => b.textContent === '极致');
          window.__qaAbortAt = { before: v.benchmark.state, rounds: v.benchmark.rounds.length }; b.click();
          window.__qaAbortAt.after = v.benchmark.state; window.__qaAbortAt.tier = v.quality.tier;
          window.__qaAbortAt.note = document.querySelector('.pause-menu [data-role="quality-note"]')?.hidden;
          window.__qaAbortAt.foot = document.querySelector('.pause-menu .menu-foot')?.textContent;
          setTimeout(() => v.resume(), 500); }, 400); }, 200); });
    }
  } }); })();`);
const url = (q = '') => dev.url + '/' + q;
const must = async (expr, ms, what) => { if (!(await page.waitFor(expr, ms, 250))) throw new Error('等待超时：' + what); };
const waitMain = () => must(`window.__game?.scenes.current?.name === 'main' && !!__game.scenes.current.cameraFollow`, 120000, 'main');
const fresh = async (q) => { await page.goto(url(q)); await must(`!!window.__game`, 60000, 'game'); await ev(`localStorage.clear(); sessionStorage.clear()`); await page.goto(url(q)); };
const run = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'ERROR ' + String(e?.message ?? e).split('\n')[0]; } console.log(name, JSON.stringify(out[name])); };

await run('abort', async () => {
  await page.goto(url('')); await must(`!!window.__game`, 60000, 'game');
  await ev(`localStorage.clear(); sessionStorage.setItem('qaAbort', '1')`);
  await page.goto(url('?simulateFps=40'));
  await waitMain();
  await must(`!!window.__qaAbortAt`, 60000, 'abort hook');
  await sleep(15000);
  const r = await ev(`({ at: __qaAbortAt, st: __game.benchmark.state, tier: __game.quality.tier, rounds: __game.benchmark.rounds, set: JSON.parse(localStorage.getItem('foglight.settings.v1')), log: __qlog })`);
  await ev(`sessionStorage.clear()`);
  await page.goto(url('?simulateFps=40')); await waitMain(); await sleep(10000);
  const r2 = await ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, log: __qlog.length })`);
  return { r, r2 };
});
await run('f3', async () => {
  const vis0 = await ev(`({ visible: __game.ui.fps.visible, hidden: document.querySelector('.fps-counter').hidden, showFps: __game.settings.get('showFps') })`);
  if (!vis0.visible) await ev(`__game.ui.toggleFps()`);
  await sleep(1000);
  const res = [];
  for (const [t, dc, tri, label] of [['ultra', 2000, '6.00M', '极致'], ['high', 1200, '3.50M', '高'], ['standard', 600, '1.50M', '标准']]) {
    const r = await ev(`(async () => { __game.quality.set('${t}'); const t0 = performance.now(); let ok = null, tx = '';
      while (performance.now() - t0 < 8000) { tx = document.querySelector('.fps-counter').innerText; if (tx.includes('/ ${dc}') && tx.includes('/ ${tri}') && tx.includes('画质 ${label}')) { ok = Math.round(performance.now() - t0); break; } await __qa.sleep(100); }
      return { tier: '${t}', okAfterMs: ok, text: tx, visible: __game.ui.fps.visible }; })()`);
    await page.screenshot(`${SH}/009-f3-${t}.png`);
    res.push(r);
  }
  // 真实按键 F3：关 / 开
  await page.tap('F3'); await sleep(1500);
  const offK = await ev(`__game.ui.fps.visible`);
  await page.tap('F3'); await sleep(1500);
  const onK = await ev(`__game.ui.fps.visible`);
  return { vis0, res, f3KeyOff: offK, f3KeyOn: onK };
});
await run('escPause', async () => {
  // 真实 Esc 打开 / 关闭暂停菜单（已检测状态）
  await page.tap('Escape'); await sleep(1500);
  const a = await ev(`({ paused: __game.paused ?? null, menu: getComputedStyle(document.querySelector('.pause-menu')).display, foot: document.querySelector('.pause-menu .menu-foot')?.textContent, active: document.querySelector('.pause-menu .seg-btn.active')?.textContent })`);
  await page.screenshot(`${SH}/009-pause-menu-esc.png`);
  await page.tap('Escape'); await sleep(1500);
  const b = await ev(`({ paused: __game.paused ?? null, menu: getComputedStyle(document.querySelector('.pause-menu')).display })`);
  return { a, b };
});
await run('testbed', async () => {
  await fresh('?scene=testbed');
  await must(`window.__game?.scenes.current?.name === 'testbed'`, 120000, 'testbed');
  await sleep(3000);
  const e0 = page.errors.length;
  await page.keyDown('w'); await sleep(3000); await page.keyUp('w');
  for (const k of ['t', 'g', 'c', 'F3', 'F4', 'F4', 'F3']) { await page.tap(k); await sleep(800); }
  await page.tap('Escape'); await sleep(1200);
  const pm = await ev(`({ menu: getComputedStyle(document.querySelector('.pause-menu')).display, foot: document.querySelector('.pause-menu .menu-foot')?.textContent })`);
  for (const t of ['high', 'standard', 'ultra']) { await ev(`__game.quality.set('${t}')`); await sleep(1500); }
  await page.tap('Escape'); await sleep(1200);
  await page.keyDown('d'); await sleep(2000); await page.keyUp('d');
  await page.tap(' '); await sleep(2000);
  return { scene: await ev(`__game.scenes.current.name`), pm, newErrors: page.errors.slice(e0) };
});
out.errors = page.errors;
console.log('ERRORS', JSON.stringify(page.errors.slice(0, 10)));
(await import('node:fs')).writeFileSync('out/quality3.json', JSON.stringify(out, null, 1));
close(); await dev.close(); process.exit(0);
