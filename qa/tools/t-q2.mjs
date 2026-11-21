import { REPO_ROOT } from './paths.mjs';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER } from './common.mjs';
const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch2');
const out = {};
const dev = await startDev(5222);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
await page.addInit(`(() => { let g; window.__qlog = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    const push = (type) => (e) => window.__qlog.push({ type, tier: e?.tier, src: e?.source, now: Math.round(performance.now()), el: +v.time.elapsed.toFixed(2), scene: v.scenes.current?.name ?? null, cam: v.scenes.current?.cameraFollow?.modeName ?? null });
    v.events.on('quality:changed', push('changed')); v.events.on('quality:detected', push('detected')); v.events.on('scene:change', push('scene'));
  } }); })();`);
const url = (q = '') => dev.url + '/' + q;
const waitMain = () => page.waitFor(`window.__game?.scenes.current?.name === 'main' && __game.scenes.current.cameraFollow`, 90000);
const fresh = async (q) => { await page.goto(url(q)); await page.waitFor(`!!window.__game`, 60000); await ev(`localStorage.clear()`); await page.goto(url(q)); };
const run = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'ERROR ' + String(e?.message ?? e).split('\n')[0]; } console.log(name, JSON.stringify(out[name])); };

// A. 建立镜头 vs 检测时序：每 200ms 采样相机模式
await run('timing', async () => {
  await fresh('?simulateFps=40');
  await waitMain();
  return ev(`(async () => { const t0 = performance.now(); const s = []; let last = null;
    while (performance.now() - t0 < 25000) { const cf = __game.scenes.current.cameraFollow; const m = cf.modeName + '/' + __game.benchmark.state + '/' + __game.quality.tier;
      if (m !== last) { s.push([Math.round(performance.now() - t0), +__game.time.elapsed.toFixed(2), m]); last = m; } await __qa.sleep(100); }
    return { samples: s, log: __qlog }; })()`);
});
// B. 检测中直接调 quality.set('high')
await run('abortApi', async () => {
  await fresh('?simulateFps=40');
  await waitMain();
  await page.waitFor(`__game.benchmark.state === 'running'`, 20000);
  const before = await ev(`({ st: __game.benchmark.state, rounds: __game.benchmark.rounds.length, src: __game.settings.get('qualitySource') })`);
  const after = await ev(`(() => { __game.quality.set('high'); return { st: __game.benchmark.state, tier: __game.quality.tier, src: __game.settings.get('qualitySource') }; })()`);
  await sleep(12000);
  const later = await ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, rounds: __game.benchmark.rounds, set: JSON.parse(localStorage.getItem('foglight.settings.v1')), log: __qlog.filter(x => x.type !== 'scene') })`);
  return { before, after, later };
});
// C. 检测中通过暂停菜单真实点击
await run('abortClick', async () => {
  await fresh('?simulateFps=40');
  await waitMain();
  await page.waitFor(`__game.benchmark.state === 'running'`, 20000);
  const t0 = await ev(`({ st: __game.benchmark.state, rounds: __game.benchmark.rounds.length, t: Math.round(performance.now()) })`);
  await ev(`__game.pause('user')`); await sleep(500);
  const mid = await ev(`({ st: __game.benchmark.state, vis: !!document.querySelector('.pause-menu') && getComputedStyle(document.querySelector('.pause-menu')).display, t: Math.round(performance.now()) })`);
  const r = await ev(`(() => { const b = [...document.querySelectorAll('.pause-menu [data-role="quality"] button')].find(b => b.textContent === '高'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.click(r.x, r.y); await sleep(500);
  const after = await ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, src: __game.settings.get('qualitySource'), t: Math.round(performance.now()) })`);
  await ev(`__game.resume()`); await sleep(10000);
  const later = await ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, set: JSON.parse(localStorage.getItem('foglight.settings.v1')), log: __qlog.filter(x => x.type !== 'scene') })`);
  return { t0, mid, r, after, later };
});
// D. F3 面板随切档刷新（不经暂停菜单），每 300ms 采样
await run('f3', async () => {
  await page.tap('F3'); await sleep(1500);
  const res = [];
  for (const t of ['ultra', 'high', 'standard', 'ultra']) {
    res.push(await ev(`(async () => { __game.quality.set('${t}'); const t0 = performance.now(); const s = [];
      while (performance.now() - t0 < 4000) { const tx = document.querySelector('.fps-counter')?.innerText ?? ''; const m = tx.match(/draw call \\d+ \\/ (\\d+)/); const l = tx.match(/画质 (\\S+)/);
        s.push([Math.round(performance.now() - t0), m?.[1], l?.[1]]); await __qa.sleep(300); }
      return { set: '${t}', first: s[0], firstOk: s.find(x => x[1] === String(__game.quality.preset.maxDrawCalls))?.[0] ?? null, end: s[s.length - 1] }; })()`));
    await page.screenshot(`${SH}/009-f3-direct-${t}-${res.length}.png`);
  }
  // 经暂停菜单切档后：暂停期间面板是否冻结
  await ev(`__game.pause('user')`); await sleep(400);
  await ev(`__game.quality.set('high')`); await sleep(2000);
  const paused = await ev(`document.querySelector('.fps-counter')?.innerText`);
  await ev(`__game.resume()`);
  const afterResume = await ev(`(async () => { const t0 = performance.now(); const s = []; while (performance.now() - t0 < 5000) { const tx = document.querySelector('.fps-counter')?.innerText ?? ''; s.push([Math.round(performance.now() - t0), tx.match(/draw call \\d+ \\/ (\\d+)/)?.[1]]); await __qa.sleep(250); } return s; })()`);
  await page.tap('F3');
  return { res, paused, afterResume };
});
// E. URL ?quality=
await run('urlOverride', async () => {
  await fresh('?quality=high&simulateFps=40');
  await waitMain(); await sleep(8000);
  return ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, url: __game.quality.urlOverride, set: localStorage.getItem('foglight.settings.v1'), log: __qlog.filter(x => x.type !== 'scene').length })`);
});
out.errors = page.errors;
console.log('ERRORS', JSON.stringify(page.errors.slice(0, 10)));
(await import('node:fs')).writeFileSync('out/quality2.json', JSON.stringify(out, null, 1));
close(); await dev.close(); process.exit(0);
