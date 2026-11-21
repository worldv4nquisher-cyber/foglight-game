import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5240);
const { page, ev, must, clickSel, url, rec, step } = P;
const frames = async (n = 4) => { const f0 = await ev(`__game.time.frame`); await must(`__game.time.frame >= ${f0 + n}`, 120000, 'frames'); };
const errs = [];

await step('BUG-002', '进 S1 前手动选档（跳过）', async () => {
  await page.goto(url('?smoke=1')); await must(`!!window.__game`, 120000); await ev(`localStorage.clear()`);
  await page.goto(url('?smoke=1')); await must(`__game?.scenes.current?.name === 'menu' && !!document.querySelector('.main-menu [data-act="settings"]')`, 120000, 'menu');
  await sleep(1500);
  await clickSel('.main-menu [data-act="settings"]'); await sleep(800);
  await clickSel('.main-menu [data-tier="high"]'); await sleep(800);
  await page.tap('Escape'); await sleep(1200); const view = await ev(`__game.ui.mainMenu.view`); if (view !== 'home') throw new Error('view ' + view);
  await clickSel('.main-menu [data-act="new"]');
  await must(`__game.scenes.current?.name === 'main'`, 240000, 'main');
  await frames(10);
  const a = await ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, det: __game.settings.get('qualityDetected'), detTier: __game.settings.get('qualityDetectedTier') })`);
  await must(`!__game.scenes.current.rig.controller.locked && __game.input.context === 'explore'`, 240000, 'explore');
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 60000, 'pause');
  await clickSel('.pause-menu [data-act="settings"]'); await sleep(800);
  const status = await ev(`document.querySelector('.pause-menu [data-role="quality-status"]').textContent`);
  await page.screenshot(`${SH}/bug002-skipped-status.png`);
  rec('BUG-002', '跳过检测 → 「尚未自动检测」', a.st === 'skipped' && /尚未自动检测/.test(status) ? 'PASS' : 'FAIL', `${JSON.stringify(a)}；状态行「${status}」`);
  errs.push(['skip', [...page.errors]]);
});


await step('BUG-002', 'F3 检测进度文字', async () => {
  await page.goto(url('?smoke=1')); await must(`!!window.__game`, 120000);
  await ev(`localStorage.clear()`);
  await page.goto(url('?simulateFps=40&autostart=1&debug=1&smoke=1'));
  await must(`__game?.scenes.current?.name === 'main' && __game.benchmark.state === 'running'`, 240000, 'running');
  await must(`!!document.querySelector('.fps-counter')`, 60000); const v0 = await ev(`__game.ui.fps.visible`); if (!v0) { await page.tap('F3'); await page.waitFor(`__game.ui.fps.visible`, 30000, 200); }
  const seen = ['F3 前 visible=' + v0]; let shot = 0;
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const s = await ev(`({ st: __game.benchmark.state, vis: __game.ui.fps.visible, txt: document.querySelector('.fps-counter')?.innerText ?? null, hidden: document.querySelector('.fps-counter')?.hidden })`);
    const k = s.st + ' vis=' + s.vis + ' ' + (s.txt || '').replace(/\n/g, ' | ').replace(/[\d.]+ ?(FPS|ms)/g, '#$1').replace(/\d+(\.\d+)?k?/g, '#');
    if (seen.at(-1) !== k) seen.push(k);
    if (s.st === 'running' && shot < 3 && s.vis) { await page.screenshot(`${SH}/bug002-f3-progress-${shot}.png`); shot++; }
    if (s.st !== 'running') break;
    await sleep(1500);
  }
  rec('BUG-002', 'F3 面板检测进度', 'CHECK', JSON.stringify(seen));
  const tx = await ev(`document.querySelector('.fps-counter')?.innerText`);
  rec('BUG-002', 'F3 结束后', 'INFO', tx);
});

console.log('ERRS', JSON.stringify(page.errors));
P.save('b3-misc3');
await P.done(); process.exit(0);
