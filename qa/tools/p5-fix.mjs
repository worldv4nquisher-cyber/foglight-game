import { open, sleep, SH } from './b5lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5279);
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v; for (const n of ['interact:used','highlight:start','highlight:end']) v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed })); } }); })();`);
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`__game.scenes.current?.name === 'testbed' && !!window.__testbed?.rig && __game.input.context === 'explore'`, 240000, 'tb');
await sleep(1500);
const go = (id) => ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; tb.cameraFollow.yaw = s.facing + Math.PI; return 1; })()`);
await step('004', 'use 走位 ≤0.4 s（固定步长）', async () => {
  await ev(`(() => { const tb = __testbed; const p = tb.rig.body.position.clone(); p.set(16, 0.02, -2); tb.interaction.cancel(); tb.rig.body.teleport(p); tb.rig.controller.facing = -Math.PI / 2; tb.cameraFollow.yaw = Math.PI / 2; return 1; })()`);
  await sleep(1500);
  const f0 = await ev('__game.time.fixedTick'); const e0 = await ev('__game.time.elapsed');
  await page.tap('KeyE');
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.ft > ${f0})`, 60000, 'used');
  const u = await ev(`__ev.filter(x => x.n === 'interact:used' && x.ft > ${f0}).at(-1)`);
  const sec = (u.ft - f0) / 60;
  rec('004', 'use', sec <= 0.42 ? 'PASS' : 'FAIL', { fixedSec: +sec.toFixed(3), elapsedSec: +(u.el - e0).toFixed(3) });
});
await step('004', 'hold 2 s（固定步长）', async () => {
  await go('sample-valve'); await sleep(1500);
  const f0 = await ev('__game.time.fixedTick'); const e0 = await ev('__game.time.elapsed');
  await page.keyDown('KeyE');
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-valve' && x.ft > ${f0})`, 120000, 'hold used');
  await page.keyUp('KeyE');
  const u = await ev(`__ev.filter(x => x.n === 'interact:used' && x.e.id === 'sample-valve').at(-1)`);
  rec('004', 'hold', 'INFO', { fixedSec: +((u.ft - f0) / 60).toFixed(3), elapsedSec: +(u.el - e0).toFixed(3) });
});
await step('004', 'highlight 3 s 两种时间', async () => {
  const f0 = await ev('__game.time.fixedTick');
  await ev(`__testbed.interaction.highlight(['sample-bell'], 3); 1`);
  await must(`__ev.some(x => x.n === 'highlight:end' && x.ft >= ${f0})`, 60000, 'hl end');
  const s = await ev(`__ev.filter(x => x.n === 'highlight:start' && x.ft >= ${f0}).at(-1)`), e = await ev(`__ev.filter(x => x.n === 'highlight:end' && x.ft >= ${f0}).at(-1)`);
  rec('004', 'highlight', 'INFO', { fixedSec: +((e.ft - s.ft) / 60).toFixed(2), elapsedSec: +(e.el - s.el).toFixed(2) });
});
await step('005', '第 6 页', async () => {
  await ev(`__game.narrative.unlockOutroEntry()`); await sleep(500);
  await ev(`__game.ui.reader.open('ch1.s2.journal.doc')`); await sleep(1500);
  const labels = [];
  for (let i = 0; i < 7; i++) { await page.tap('KeyD'); await sleep(1500); labels.push(await ev(`document.querySelector('.reader-page').textContent`)); }
  const p6 = await ev(`({ pages: __game.ui.reader.pageCount, label: document.querySelector('.reader-page').textContent, body: document.querySelector('.reader-body').textContent.slice(0, 60) })`);
  await page.screenshot(`${SH}/005-journal-page6.png`);
  rec('005', '日志第 6 页', p6.pages === 6 && p6.label.startsWith('6') ? 'PASS' : 'FAIL', { labels, ...p6 });
  await page.tap('Tab'); await sleep(800);
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('PROBEDONE');
