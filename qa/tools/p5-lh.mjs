import { open, sleep, SH } from './b5lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5276);
await step('lighthouse', 'S1 demo 灯塔 E 切换（smoke 15 s 等待）', async () => {
  await page.goto(url(`?smoke=1&debug=1&autostart=1`));
  await must(`__game.scenes.current?.name === 's1-ebb-shore' && !!__game.scenes.current.rig && __game.input.context === 'explore' && !__game.isPaused`, 240000, 'S1');
  const on0 = await ev(`__game.scenes.current.lighthouseOn`);
  await ev(`(() => { const s = __game.scenes.current; s.rig.body.teleport(new s.rig.body.position.constructor(11, 2.45, -8.3)); s.rig.controller.facing = Math.PI; return 1; })()`);
  const ok = await page.waitFor(`/E\\s*操作/.test(document.querySelector('.hud-prompt')?.hidden ? '' : document.querySelector('.hud-prompt')?.textContent ?? '')`, 10000, 200);
  const t0 = Date.now(); const f0 = await ev(`__game.time.fixedTick`);
  await page.tap('KeyE');
  const flipped = await page.waitFor(`__game.scenes.current.lighthouseOn !== ${on0}`, 15000, 100);
  const f1 = await ev(`__game.time.fixedTick`);
  await page.screenshot(`${SH}/s1-demo-lighthouse-toggle.png`);
  rec('lighthouse', 'S1 灯塔切换', ok && flipped ? 'PASS' : 'FAIL', { prompt: ok, on0, flipped, wallMs: Date.now() - t0, fixedSec: +((f1 - f0) / 60).toFixed(2) });
  // S1 1280 toast（emit 后立刻多次采样）
  await ev(`__game.events.emit('journal:updated', { docId: 'qa-probe' }); 1`);
  let r = null;
  for (let i = 0; i < 20 && !(r && r.toast); i++) { await sleep(150); r = await ev(`(() => { const R = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { toast: R('.toast-left'), hint: R('.hud-hint') }; })()`); }
  await page.screenshot(`${SH}/toast-s1-1280.png`);
  rec('toast', 'S1 1280x720', r.toast && r.toast[3] <= r.hint[1] ? 'PASS' : 'FAIL', r);
});
await step('007', 'hints 句柄', async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=testbed&hintScale=0.05`));
  await must(`__game.scenes.current?.name === 'testbed' && __game.input.context === 'explore'`, 240000, 'tb');
  rec('007', 'handle', 'INFO', await ev(`({ cur: typeof __game.scenes.current.hints, tb: typeof window.__testbed?.hints })`));
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('PROBEDONE');
