import { open, sleep, SH } from './b4lib.mjs';
const T = 'v0.1-010';
const P = await open(5246);
const { page, ev, must, clickSel, url, rec, step } = P;
const waitScene = (n, ms = 180000) => must(`window.__game?.scenes.current?.name === '${n}' && !!__game.scenes.current.rig && !__game.flow.transitioning`, ms, n);
const res = () => ev(`performance.getEntriesByType('resource').map(e => ({ n: e.name.replace(location.origin + '/', '').replace(/^static\\//, ''), t: e.transferSize, b: e.encodedBodySize, s: Math.round(e.startTime) }))`);
const fmt = (l) => l.map((x) => `${x.n} ${(x.b / 1024).toFixed(1)}kB`).join('，');
const sumB = (l) => l.reduce((s, x) => s + x.b, 0);

await step(T, '冷启动主菜单阶段网络请求（首次访问、无缓存）', async () => {
  await page.goto(url('?smoke=1'));
  await must(`window.__game?.scenes.current?.name === 'menu'`, 90000); await sleep(1500);
  const r = await res(); const tim = await ev(`({ menu: __game.flow.menuReadyMs, nav: performance.getEntriesByType('navigation')[0].transferSize, dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd) })`);
  rec(T, '冷启动主菜单阶段网络请求（首次访问、无缓存）', 'INFO', `index.html ${tim.nav} B + ${r.length} 个资源，解压前合计 ${(sumB(r) / 1024).toFixed(1)} kB：${fmt(r)}；DCL ${tim.dcl} ms，menuReadyMs ${tim.menu?.toFixed(0)} ms`);
});

await step(T, '?slowLoad=1500：新游戏加载页进度条', async () => {
  await ev('localStorage.clear()');
  await page.goto(url('?smoke=1&slowLoad=1500'));
  await must(`window.__game?.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 90000); await sleep(800);
  const samp = ev(`__qa.sample(() => [Math.round(performance.now()), document.querySelector('.loading-screen').hidden, document.querySelector('.loading-bar').style.width, document.querySelector('.loading-label').textContent], 6000)`);
  await clickSel('.main-menu [data-act="new"]');
  await sleep(700); await page.screenshot(`${SH}/010-slowload-loading.png`);
  const s = await samp;
  const vis = s.filter((x) => !x[1]); const widths = [...new Set(vis.map((x) => x[2]))];
  rec(T, '?slowLoad=1500：新游戏加载页进度条', vis.length && widths.length > 2 ? 'PASS' : 'FAIL', `加载页可见 ${vis.length ? vis.at(-1)[0] - vis[0][0] : 0} ms（采样窗口内），进度宽度依次 ${widths.slice(0, 12).join(' → ')}${widths.length > 12 ? ' …' : ''}`);
});

await step(T, '?slowLoad=1500：未预加载完就出 S1 → 黑场细线进度', async () => {
  await must(`window.__game?.scenes.current?.name === 's1-ebb-shore' && !!__game.scenes.current.rig`, 180000, 'S1');
  const pre = await ev(`__game.assets.isGroupLoaded('s2')`);
  const samp = ev(`__qa.sample(() => [Math.round(performance.now()), __game.ui.fade.opacity, !document.querySelector('.screen-fade-progress').hidden, document.querySelector('.screen-fade-bar').style.width || getComputedStyle(document.querySelector('.screen-fade-bar')).transform, __game.scenes.current?.name], 9000)`);
  await ev(`(() => { const r = __game.scenes.current.rig; const p = r.body.position.clone(); p.set(-10, 0.01, -12); r.body.teleport(p); })()`);
  let shot = false;
  for (let i = 0; i < 120 && !shot; i++) { await sleep(50); if (await ev(`!document.querySelector('.screen-fade-progress').hidden`)) { await page.screenshot(`${SH}/010-slowload-black-progress.png`); shot = true; } }
  const s = await samp;
  await waitScene('s2-keeper-house');
  const lt = await ev('__game.flow.lastTransition');
  const prog = s.filter((x) => x[2]);
  const sceneWhileBlackNotLoaded = s.filter((x) => x[4] === 's2-keeper-house' && x[1] < 0.99 && x[2]);
  rec(T, '?slowLoad=1500：未预加载完就出 S1 → 黑场细线进度', !pre && lt?.waitedForLoad && lt?.progressShown && prog.length > 0 && sceneWhileBlackNotLoaded.length === 0 ? 'PASS' : 'FAIL',
    `出口时 s2 已加载=${pre}；waitedForLoad=${lt?.waitedForLoad} progressShown=${lt?.progressShown}；细线可见采样 ${prog.length} 帧，进度值 ${[...new Set(prog.map((x) => x[3]))].slice(0, 8).join(' → ')}；进度显示时的不透明度 ${[...new Set(prog.map((x) => x[1]))].join(',')}；新场景在未全黑时露出且仍显示进度：${sceneWhileBlackNotLoaded.length} 帧；phases ${JSON.stringify(lt?.phases)}；截图 ${shot}`);
});

await step(T, 'S3 点灯 → 章节结束页（真实 E）', async () => {
  await ev('localStorage.clear()');
  await page.goto(url('?smoke=1&debug=1&scene=s3'));
  await must(`window.__game?.scenes.current?.name === 's3-lighthouse' && !!__game.scenes.current.rig && __game.input.context === 'explore'`, 180000, 'S3 可操作');
  const onAtEnter = await ev(`__game.scenes.current.lighthouse.on`);
  await ev(`(() => { const r = __game.scenes.current.rig; const p = r.body.position.clone(); p.set(0, 0.01, -2.4); r.body.teleport(p); r.controller.facing = Math.PI; })()`);
  await must(`__game.scenes.current.interaction.current?.id === 's3-lamp'`, 30000, '灯塔交互');
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent`);
  await page.screenshot(`${SH}/010-s3-lamp-prompt.png`);
  const t0 = Date.now();
  await page.tap('KeyE');
  const end = await page.waitFor(`__game.scenes.current?.name === 'chapter-end' && !document.querySelector('.chapter-end').hidden`, 30000, 50);
  const dt = Date.now() - t0;
  await sleep(1200);
  const txt = await ev(`document.querySelector('.chapter-end')?.innerText ?? null`);
  const save = await ev(`JSON.parse(localStorage.getItem('foglight.save.v1'))`);
  await page.screenshot(`${SH}/010-chapter-end.png`);
  rec(T, 'S3 点灯 → 章节结束页（真实 E）', end ? 'PASS' : 'FAIL', `进场时灯已亮=${onAtEnter}；提示「${prompt}」；E → 结束页 ${end}（墙钟 ${dt} ms，代码延时 1.5 s）；文字「${(txt || '').replace(/\s*\n\s*/g, ' | ')}」；存档 chapterComplete=${save?.chapterComplete} groups=${await ev('__game.assets.loadedGroups.join(",")')}`);
});

P.save('b4-010b');
console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
