import { open, sleep, SH } from './b4lib.mjs';
const T = 'v0.1-010';
const P = await open(5250);
const { page, ev, must, clickSel, url, rec, step } = P;
const waitScene = (n, ms = 180000) => must(`window.__game?.scenes.current?.name === '${n}' && !!__game.scenes.current.rig && !__game.flow.transitioning`, ms, n);
const res = () => ev(`performance.getEntriesByType('resource').map(e => ({ n: e.name.replace(location.origin + '/', '').replace(/^static\\//, ''), t: e.transferSize, b: e.encodedBodySize, s: Math.round(e.startTime) }))`);
const fmt = (l) => l.map((x) => `${x.n} ${(x.b / 1024).toFixed(1)}kB`).join('，');
const sumB = (l) => l.reduce((s, x) => s + x.b, 0);

await step(T, '?slowLoad=12000：新游戏加载页进度条', async () => {
  await page.goto(url('?smoke=1')); await must('!!window.__game'); await ev('localStorage.clear()');
  await page.goto(url('?smoke=1&slowLoad=12000'));
  await must(`window.__game?.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 90000); await sleep(800);
  const samp = ev(`__qa.sample(() => [Math.round(performance.now()), document.querySelector('.loading-screen').hidden, document.querySelector('.loading-bar').style.width, document.querySelector('.loading-label').textContent], 16000)`);
  await clickSel('.main-menu [data-act="new"]');
  await sleep(700); await page.screenshot(`${SH}/010-slowload-loading.png`);
  const s = await samp;
  const vis = s.filter((x) => !x[1]); const widths = [...new Set(vis.map((x) => x[2]))];
  rec(T, '?slowLoad=12000：新游戏加载页进度条', vis.length && widths.length > 2 ? 'PASS' : 'FAIL', `加载页可见 ${vis.length ? vis.at(-1)[0] - vis[0][0] : 0} ms（采样窗口内），进度宽度依次 ${widths.slice(0, 12).join(' → ')}${widths.length > 12 ? ' …' : ''}`);
});

await step(T, '?slowLoad=12000：未预加载完就出 S1 → 黑场细线进度', async () => {
  await must(`window.__game?.scenes.current?.name === 's1-ebb-shore' && !!__game.scenes.current.rig`, 180000, 'S1');
  const pre = await ev(`__game.assets.isGroupLoaded('s2')`);
  const samp = ev(`__qa.sample(() => [Math.round(performance.now()), __game.ui.fade.opacity, !document.querySelector('.screen-fade-progress').hidden, document.querySelector('.screen-fade-bar').style.width || getComputedStyle(document.querySelector('.screen-fade-bar')).transform, __game.scenes.current?.name], 30000)`);
  await ev(`(() => { const r = __game.scenes.current.rig; const p = r.body.position.clone(); p.set(-10, 0.01, -12); r.body.teleport(p); })()`);
  let shot = false;
  for (let i = 0; i < 400 && !shot; i++) { await sleep(50); if (await ev(`!document.querySelector('.screen-fade-progress').hidden`)) { await page.screenshot(`${SH}/010-slowload-black-progress.png`); shot = true; } }
  const s = await samp;
  await waitScene('s2-keeper-house');
  const lt = await ev('__game.flow.lastTransition');
  const prog = s.filter((x) => x[2]);
  const sceneWhileBlackNotLoaded = s.filter((x) => x[4] === 's2-keeper-house' && x[1] < 0.99 && x[2]);
  rec(T, '?slowLoad=12000：未预加载完就出 S1 → 黑场细线进度', !pre && lt?.waitedForLoad && lt?.progressShown && prog.length > 0 && sceneWhileBlackNotLoaded.length === 0 ? 'PASS' : 'FAIL',
    `出口时 s2 已加载=${pre}；waitedForLoad=${lt?.waitedForLoad} progressShown=${lt?.progressShown}；细线可见采样 ${prog.length} 帧，进度值 ${[...new Set(prog.map((x) => x[3]))].slice(0, 8).join(' → ')}；进度显示时的不透明度 ${[...new Set(prog.map((x) => x[1]))].join(',')}；新场景在未全黑时露出且仍显示进度：${sceneWhileBlackNotLoaded.length} 帧；phases ${JSON.stringify(lt?.phases)}；截图 ${shot}`);
});

P.save('b4-010c');
console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
