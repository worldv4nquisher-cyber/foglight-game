import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5237);
const { page, ev, must, clickSel, url, rec, step } = P;
const frames = async (n = 4) => { const f0 = await ev(`__game.time.frame`); await must(`__game.time.frame >= ${f0 + n}`, 120000, 'frames'); };
const errs = [];

await step('008', '加载时间（首帧 / 主菜单）', async () => {
  await page.addInit(`(() => { if (!location.search.includes('timing')) return; localStorage.clear(); window.__t = {};
    const mark = (k) => { if (!(k in __t)) __t[k] = performance.now(); };
    const wrap = (proto) => { for (const fn of ['drawArrays', 'drawElements', 'drawElementsInstanced', 'drawArraysInstanced']) { const o = proto[fn]; if (!o) continue; proto[fn] = function (...a) { mark('firstDraw'); return o.apply(this, a); }; } };
    wrap(WebGL2RenderingContext.prototype); wrap(WebGLRenderingContext.prototype);
    const chk = () => { const m = document.querySelector('.main-menu'); if (m && !m.hidden && m.getClientRects().length && getComputedStyle(m).opacity !== '0' && m.querySelector('[data-act="new"]')) mark('menuVisible'); if (m && 'menuVisible' in __t && getComputedStyle(m).opacity === '1') mark('menuOpaque'); requestAnimationFrame(chk); };
    requestAnimationFrame(chk);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) mark(e.name); }).observe({ type: 'paint', buffered: true });
  })();`);
  const runs = [];
  for (let i = 0; i < 4; i++) {
    await page.goto(url(`?timing=${i}`));
    const ok = await page.waitFor(`window.__t && 'menuOpaque' in __t && 'firstDraw' in __t`, 180000, 100);
    const t = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { ok: true, dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round(__t['first-contentful-paint'] ?? -1), firstDraw: Math.round(__t.firstDraw ?? -1), menuVisible: Math.round(__t.menuVisible ?? -1), menuOpaque: Math.round(__t.menuOpaque ?? -1), transfer: performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) + (n.transferSize || 0), nres: performance.getEntriesByType('resource').length }; })()`);
    t.ok = ok; runs.push(t);
    await sleep(1500);
  }
  await page.screenshot(`${SH}/008-load-menu.png`);
  rec('008', '加载时间（SwiftShader，本机 preview，首次启动）', 'INFO', JSON.stringify(runs));
  errs.push(['timing', [...page.errors]]);
});

await step('008', '测试场景是否写存档', async () => {
  await page.goto(url('?smoke=1')); await must(`!!window.__game`, 120000);
  await ev(`localStorage.clear()`);
  await page.goto(url('?scene=testbed')); await page.waitFor(`document.querySelector('canvas') && performance.now() > 0`, 5000);
  await sleep(20000);
  const save = await ev(`localStorage.getItem('foglight.save.v1')`);
  await page.goto(url('')); await must(`!!document.querySelector('.main-menu [data-act="new"]')`, 120000, 'menu');
  await sleep(1500);
  const btns = await ev(`[...document.querySelectorAll('.main-menu [data-act]')].filter(b => b.getClientRects().length).map(b => b.textContent)`);
  await page.screenshot(`${SH}/008-menu-after-testbed.png`);
  rec('008', '只访问 /?scene=testbed 后主菜单', btns.includes('继续') ? 'FINDING' : 'PASS', `存档 ${save ? save.slice(0, 160) : 'null'}；主菜单按钮 ${JSON.stringify(btns)}`);
});

await step('008', '继续回到场景开头（真实移动）', async () => {
  await page.goto(url('?smoke=1')); await must(`!!window.__game`, 120000);
  await ev(`localStorage.clear()`);
  await page.goto(url('?smoke=1')); await must(`__game.scenes.current?.name === 'menu' && !!document.querySelector('.main-menu [data-act="new"]')`, 120000, 'menu');
  await sleep(1500);
  await clickSel('.main-menu [data-act="new"]');
  await must(`__game.scenes.current?.name === 'main' && __game.input.context === 'explore' && !__game.scenes.current.rig.controller.locked`, 240000, 'main explore');
  await frames(6);
  const p0 = await ev(`__game.scenes.current.rig.body.position.toArray()`);
  await page.click(640, 400); await frames(3);
  await page.keyDown('KeyW'); await frames(40); await page.keyUp('KeyW'); await frames(4);
  const p1 = await ev(`__game.scenes.current.rig.body.position.toArray()`);
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 60000, 'pause');
  await frames(3);
  const pz = await ev(`(() => { const m = document.querySelector('.pause-menu'); const cs = getComputedStyle(m); return { bf: cs.backdropFilter, wbf: cs.webkitBackdropFilter, bg: cs.backgroundColor, supports: CSS.supports('backdrop-filter', 'blur(6px)') }; })()`);
  await page.screenshot(`${SH}/008-pause-blur.png`);
  await clickSel('.pause-menu [data-act="to-menu"]'); await frames(3);
  await clickSel('.confirm-dialog [data-act="confirm"]');
  await must(`__game.scenes.current?.name === 'menu' && !!document.querySelector('.main-menu [data-act="continue"]')`, 240000, 'menu2');
  await sleep(1500);
  await clickSel('.main-menu [data-act="continue"]');
  await must(`__game.scenes.current?.name === 'main' && __game.input.context === 'explore'`, 240000, 'main2');
  await frames(6);
  const p2 = await ev(`__game.scenes.current.rig.body.position.toArray()`);
  rec('008', '「继续」回到最近场景开头', moved > 1 && Math.hypot(p2[0] - p0[0], p2[2] - p0[2]) < 0.3 ? 'PASS' : 'FAIL', `起点 ${p0.map(v => v.toFixed(2))}；按住 W 40 帧后 ${p1.map(v => v.toFixed(2))}（移动 ${moved.toFixed(2)} m）；回主菜单 → 继续 后 ${p2.map(v => v.toFixed(2))}`);
  rec('008', '暂停遮罩背景模糊（计算样式）', /blur/.test(pz.bf) ? 'PASS' : 'FAIL', JSON.stringify(pz));
  errs.push(['continue', [...page.errors]]);
});

await step('008', '按钮悬停琥珀描边', async () => {
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 60000, 'pause2');
  await frames(2);
  const r = await P.rect('.pause-menu [data-act="settings"]');
  await page.mouse('mouseMoved', r.x - 300, r.y); await sleep(300);
  await page.mouse('mouseMoved', r.x, r.y); await frames(4); await sleep(1000);
  const h = await ev(`(() => { const b = document.querySelector('.pause-menu [data-act="settings"]'); const cs = getComputedStyle(b); const rules = []; for (const s of document.styleSheets) { for (const ru of s.cssRules) { if (ru.selectorText && b.matches(ru.selectorText) && /border/.test(ru.style.cssText)) rules.push(ru.selectorText + ' {' + ru.style.cssText.slice(0, 120) + '}'); } } return { hover: b.matches(':hover'), cls: b.className, border: cs.borderTopColor, shadow: cs.boxShadow, bg: cs.backgroundColor, amber: getComputedStyle(document.documentElement).getPropertyValue('--ui-amber'), rules }; })()`);
  await page.screenshot(`${SH}/008-hover-pause-settings.png`);
  rec('008', '悬停描边变琥珀色并发光', /242, 176, 114|f2b072/i.test(h.border) ? 'PASS' : 'FINDING', JSON.stringify(h));
});

await step('BUG-002', '模拟 40 fps 检测（autostart）', async () => {
  await page.goto(url('?smoke=1')); await must(`!!window.__game`, 120000);
  await ev(`localStorage.clear()`);
  await page.addInit(`(() => { if (!location.search.includes('simulateFps')) return; let g; window.__q = [];
    Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v; v.events.on('quality:changed', (e) => __q.push({ ...e, el: v.time.elapsed, now: performance.now(), cam: v.scenes.current?.cameraFollow?.modeName ?? null, locked: v.scenes.current?.rig?.controller?.locked ?? null })); } }); })();`);
  await page.goto(url('?simulateFps=40&autostart=1&debug=1&smoke=1'));
  await must(`__game?.scenes.current?.name === 'main'`, 240000, 'main');
  const samples = [];
  let shot = 0;
  const end = Date.now() + 300000;
  while (Date.now() < end) {
    const s = await ev(`({ st: __game.benchmark.state, fpsVis: __game.ui.fps.visible, txt: document.querySelector('.fps-counter')?.innerText?.replace(/\\n/g, ' | ') ?? null, tier: __game.quality.tier, locked: __game.scenes.current?.rig?.controller?.locked ?? null })`);
    samples.push(s);
    if (s.st === 'running' && s.txt && /检测/.test(s.txt) && shot < 2) { await page.screenshot(`${SH}/bug002-f3-progress-${shot}.png`); shot++; }
    if (s.st !== 'running' && samples.some(x => x.st === 'running')) break;
    await sleep(700);
  }
  const q = await ev(`__q`);
  const set = await ev(`JSON.parse(localStorage.getItem('foglight.settings.v1'))`);
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 60000, 'pause');
  await clickSel('.pause-menu [data-act="settings"]'); await must(`!!document.querySelector('.pause-menu [data-role="quality-status"]')?.getClientRects().length`, 30000, 'status');
  const status = await ev(`document.querySelector('.pause-menu [data-role="quality-status"]').textContent`);
  await page.screenshot(`${SH}/bug002-status-detected.png`);
  // 恢复默认 → 检测结果
  await clickSel('.pause-menu [data-act="reset"]'); await sleep(1500);
  const afterReset = await ev(`({ tier: __game.quality.tier, src: __game.settings.get('qualitySource'), det: __game.settings.get('qualityDetectedTier'), status: document.querySelector('.pause-menu [data-role="quality-status"]').textContent })`);
  const uniq = []; for (const s of samples) { const k = s.st + ' ' + s.tier + ' ' + (s.txt || '').split(' | ').filter(x => /检测|档|tier|极致|高|标准/.test(x)).join(' / '); if (uniq.at(-1) !== k) uniq.push(k); }
  rec('BUG-002', 'simulateFps=40：极致→高→标准，F3 显示检测进度，状态「自动检测：标准」，恢复默认回检测结果', /标准/.test(status) && q.map(x => x.tier).join() === 'high,standard' || q.filter(x => x.source === 'auto').map(x => x.tier).slice(-2).join() === 'high,standard' ? 'PASS' : 'FAIL',
    `切档 ${JSON.stringify(q.map(x => `${x.previous}→${x.tier}(${x.source}) 镜头=${x.cam} 锁定=${x.locked}`))}；最终 settings qualityDetected=${set?.qualityDetected} tier=${set?.qualityDetectedTier} quality=${set?.quality}；状态行「${status}」；恢复默认 ${JSON.stringify(afterReset)}；F3 采样 ${JSON.stringify(uniq.slice(0, 14))}`);
  errs.push(['bug002', [...page.errors]]);
});

await step('BUG-002', '检测中手动改档（打断）', async () => {
  await ev(`localStorage.clear()`);
  await page.goto(url('?simulateFps=40&autostart=1&debug=1&smoke=1'));
  await must(`__game?.scenes.current?.name === 'main' && __game.benchmark.state === 'running'`, 240000, 'running');
  await must(`!__game.scenes.current.rig.controller.locked && __game.input.context === 'explore'`, 240000, 'explore');
  const st0 = await ev(`__game.benchmark.state`);
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 60000, 'pause');
  await clickSel('.pause-menu [data-act="settings"]'); await sleep(800);
  await clickSel('.pause-menu [data-tier="standard"]'); await sleep(1500);
  const a = await ev(`({ st: __game.benchmark.state, tier: __game.quality.tier, det: __game.settings.get('qualityDetected'), detTier: __game.settings.get('qualityDetectedTier'), status: document.querySelector('.pause-menu [data-role="quality-status"]').textContent })`);
  await page.screenshot(`${SH}/bug002-aborted-status.png`);
  await clickSel('.pause-menu [data-act="reset"]'); await sleep(1500);
  const b = await ev(`({ tier: __game.quality.tier, src: __game.settings.get('qualitySource'), detTier: __game.settings.get('qualityDetectedTier'), sens: __game.settings.get('mouseSensitivity') ?? __game.settings.get('sensitivity'), status: document.querySelector('.pause-menu [data-role="quality-status"]').textContent })`);
  rec('BUG-002', '检测中改「标准」→「尚未自动检测」；恢复默认 → 极致', st0 === 'running' && a.st === 'aborted' && /尚未自动检测/.test(a.status) && a.detTier == null && b.tier === 'ultra' && b.src === 'default' ? 'PASS' : 'FAIL', `改档前 ${st0}；改档后 ${JSON.stringify(a)}；恢复默认 ${JSON.stringify(b)}`);
  errs.push(['abort', [...page.errors]]);
});

await step('BUG-002', '进 S1 前手动选档（跳过）', async () => {
  await ev(`localStorage.clear()`);
  await page.goto(url('?smoke=1')); await must(`__game?.scenes.current?.name === 'menu' && !!document.querySelector('.main-menu [data-act="settings"]')`, 120000, 'menu');
  await sleep(1500);
  await clickSel('.main-menu [data-act="settings"]'); await sleep(800);
  await clickSel('.main-menu [data-tier="high"]'); await sleep(800);
  await clickSel('.main-menu [data-act="back"]'); await sleep(800);
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

console.log('ERRS', JSON.stringify(errs));
P.save('b3-misc');
await P.done(); process.exit(0);
