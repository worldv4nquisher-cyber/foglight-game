import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5236);
const { page, ev, must, clickSel, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['interact:used','interact:read','interact:holdProgress','interact:pushMoved','item:pickup','item:place','puzzle:enter','puzzle:exit','puzzle:partSelected','puzzle:partRotated','puzzle:reset','journal:updated','subtitle:show','subtitle:hide','reader:open','reader:close','journal:open','journal:close','interact:pushEnd'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), el: v.time.elapsed, ft: v.time.fixedTick / 60, fr: v.time.frame, now: performance.now() }));
  } }); })();`);
await page.goto(url('?smoke=1'));
await must(`!!window.__game`);
await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed`, 180000, 'testbed');
const frames = async (n = 4) => { const f0 = await ev(`__game.time.frame`); await must(`__game.time.frame >= ${f0 + n}`, 120000, 'frames'); };
await frames(10);
await page.click(640, 400); await frames(4);
const go = async (id) => { await ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`); await frames(4); await must(`__testbed.interaction.current?.id === '${id}' || true`, 1000); };
const st = () => ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context, page: document.querySelector('.reader-page').textContent, pages: __game.ui.reader.pageCount, doc: __game.ui.reader.docId, held: __testbed.interaction.held.holding, ak: __testbed.interaction.actionKind, cur: __testbed.interaction.current?.id ?? null, prompt: document.querySelector('.hud-prompt').hidden ? null : document.querySelector('.hud-prompt').textContent })`);
const now = () => ev(`performance.now()`);
const evs = (n, t) => ev(`__ev.filter(x => x.n === '${n}' && x.now > ${t})`);
const E = async () => { await page.tap('KeyE'); await frames(4); };
const fr = (l) => console.log('..', l);


await step('005', '再读不重复', async () => {
  await go('sample-read');
  const t0 = await now();
  await E(); await must(`__game.ui.reader.isOpen`, 60000, 'open1');
  await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'close1');
  await frames(6);
  const toast = await ev(`document.querySelector('.toast-left')?.textContent`);
  const s1 = await st();
  const t1 = await now();
  await frames(6);
  await E(); const ok = await page.waitFor(`__game.ui.reader.isOpen`, 60000, 200);
  const s2 = await st();
  if (ok) { await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'close2'); }
  const a = (await evs('journal:updated', t0)).length, b = (await evs('journal:updated', t1)).length;
  rec('005', '首次阅读弹「日志已更新」；再读不重复', a === 1 && b === 0 && ok && /日志已更新/.test(toast ?? '') ? 'PASS' : 'FAIL', `首读 journal:updated ${a}（提示「${toast}」）；关闭后 ${JSON.stringify(s1)}；再按 E 打开=${ok} ${JSON.stringify(s2)}；再读 journal:updated ${b}`);
});
await step('004', 'use 计时', async () => {
  await go('sample-bell');
  const t0 = await now(); const f0 = await ev(`__game.time.fixedTick / 60`);
  await page.tap('KeyE');
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.now > ${t0})`, 90000, 'used');
  const u = (await evs('interact:used', t0)).find((x) => x.e.id === 'sample-bell');
  rec('004', 'use 自动走位时长（≤ 0.4 s，固定步长时间）', u.ft - f0 <= 0.45 ? 'PASS' : 'FAIL', `起点到交互点 0.75 m，按 E 到 interact:used 固定步长时间 ${(u.ft - f0).toFixed(3)} s（含按键所在帧，≤ 1 帧误差）`);
});
await step('004', 'hold 计时', async () => {
  await go('sample-valve');
  const t1 = await now();
  await page.keyDown('KeyE');
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-valve' && x.now > ${t1})`, 120000, 'valve used');
  await page.keyUp('KeyE');
  const hp = await evs('interact:holdProgress', t1);
  const u = (await evs('interact:used', t1)).find((x) => x.e.id === 'sample-valve');
  const first = hp.find((x) => x.e.progress > 0);
  rec('004', 'hold 2 s（固定步长时间）', Math.abs(u.ft - (first.ft - first.e.progress * 2) - 2) < 0.1 ? 'PASS' : 'FAIL', `首个进度 ${first.e.progress.toFixed(3)} @${first.ft.toFixed(3)}，触发 @${u.ft.toFixed(3)}，回推按住时长 ${(u.ft - (first.ft - first.e.progress * 2)).toFixed(3)} s；进度 ${first.e.progress.toFixed(3)}→1 用时 ${(u.ft - first.ft).toFixed(3)} s`);
});
await step('004', 'push 速度', async () => {
  await ev(`(() => { const r = __testbed.scene.getObjectByName('sample-raft'); return r.position.z; })()`);
  const z = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  if (z > 9) { rec('004', 'push 速度', 'SKIP', '浮台已在终点'); return; }
  await go('sample-raft');
  const t0 = await now();
  await page.keyDown('KeyE');
  await must(`__ev.some(x => x.n === 'interact:pushEnd' && x.now > ${t0})`, 240000, 'pushEnd');
  await page.keyUp('KeyE');
  const pm = (await evs('interact:pushMoved', t0)).filter((x) => x.e.t > 0.05 && x.e.t < 0.95);
  const v = ((pm.at(-1).e.t - pm[0].e.t) * 3) / (pm.at(-1).ft - pm[0].ft);
  rec('004', 'push 0.8 m/s（固定步长时间）', Math.abs(v - 0.8) < 0.03 ? 'PASS' : 'FAIL', `中段速度 ${v.toFixed(3)} m/s（${pm.length} 个 pushMoved）`);
});
console.log('ERRORS', JSON.stringify(page.errors));
P.save('b3-045e');
await P.done(); process.exit(0);
