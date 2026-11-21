import { open, sleep, SH } from './b5lib.mjs';
const T = 'v0.1-012';
const P = await open(5262);
const { page, ev, must, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['receiver:activated','receiver:blocked','receiver:reset','beam:emitter','puzzle:partRotated','puzzle:partSelected','puzzle:enter','puzzle:exit','beam:skyAlwaysOn','beam:setColor','hint:solved','hint:show','hint:available'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick }));
  } }); })();`);
await page.goto(url('?smoke=1&debug=1&beamDebug=1&hintScale=0.02&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed?.beamArea && __game.input.context === 'explore'`, 180000, 'testbed');
await sleep(1000); await page.click(640, 400); await sleep(500);
const B = `__testbed.beamArea`;
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 400000, 'wait ' + s); };
const tp = (x, y, z, f) => ev(`(() => { const tb = __testbed; tb.rig.body.teleport(new tb.rig.body.position.constructor(${x}, ${y}, ${z})); ${f !== undefined ? `tb.rig.controller.facing = ${f};` : ''} return 1; })()`);
const st = () => ev(`(() => { const a = ${B}; const lp = a.tracer.paths.find(p => p.emitter.id === 'beam-lamp'); const sp = a.tracer.paths.find(p => p.emitter.id === 'beam-sky');
  const r = (x) => ({ s: x.state, p: +x.progress.toFixed(2), c: x.hitColor });
  return { A: a.mirrorA.part.angles[0], Bm: a.mirrorB.part.angles[0], lampEnd: lp && lp.end, lampRefl: lp && lp.reflections, lampMirrors: lp && lp.mirrors.map(m => m.id ?? m), lampRecv: lp && (lp.receiver?.id ?? null), skyEnd: sp && sp.end, skyRecv: sp && (sp.receiver?.id ?? null),
    lock: r(a.lock), ign: r(a.igniter), sky: { lit: a.sky.lit, color: a.sky.color, t: +a.sky.skyTime.toFixed(1), always: a.sky.alwaysOn }, lamp: { lit: a.lamp.lit, color: a.lamp.color }, oil: a.oilOpen, traces: a.tracer.traceCount, ms: +a.tracer.lastMs.toFixed(3), ctx: __game.input.context }; })()`);
const f4 = () => ev(`(() => { const e = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && /^光路/.test(x.textContent || '')); const p = e?.parentElement; return p ? p.innerText.replace(/\\s+/g, ' ') : null; })()`);
const rotate = async (key) => { const a0 = await ev(`${B}.puzzle.current.angles[0]`); const id = await ev(`${B}.puzzle.current.id`); await page.keyDown(key); await must(`${B}.puzzle.current.angles[0] !== ${a0}`, 60000, 'rot'); await page.keyUp(key); await waitSec(0.15); return [id, a0, await ev(`${B}.puzzle.current.angles[0]`)]; };


const H = `__testbed.hints`;
const panel = () => ev(`(() => { const p = document.querySelector('.hint-panel'); return p && p.offsetParent ? p.innerText.replace(/\s+/g, ' ') : null; })()`);
const icon = () => ev(`(() => { const e = document.querySelector('.hint-lantern'); return !!e && !!e.offsetParent && getComputedStyle(e).opacity !== '0' && !e.classList.contains('is-hidden'); })()`);
await step(T, '提示：区内一级解锁 → 光感锁触发后失效', async () => {
  await tp(-16.5, 0.05, 5.5, 0);
  await must(`${H}.level('test-beam') >= 1`, 300000, 'lv1');
  await waitSec(0.5);
  const b = { cur: await ev(`${H}.currentId`), icon: await ev(`${H}.iconVisible`), domIcon: await icon() };
  await page.tap('KeyH'); await sleep(1500); const p1 = await panel();
  await page.screenshot(`${SH}/012-hint-before-lock.png`);
  await page.tap('KeyH'); await sleep(800); if ((await ev('__game.input.context')) !== 'explore') { await page.tap('Escape'); await sleep(800); }
  // 真实解谜：E 进机关台，镜 A 30 → 0（A 键两档），镜 B 本来 0
  await tp(-16.5, 0.05, 6.2, 0); await waitSec(0.6);
  await page.tap('KeyE'); await must(`__game.input.context === 'puzzle'`, 60000, 'puzzle');
  await waitSec(0.4);
  await rotate('KeyA'); await rotate('KeyA');
  const rot = await ev(`__ev.filter(x => x.n === 'puzzle:partRotated').map(x => x.ft)`);
  await must(`__ev.some(x => x.n === 'receiver:activated' && x.e.id === 'beam-lock')`, 300000, 'lock');
  const act = await ev(`__ev.find(x => x.n === 'receiver:activated' && x.e.id === 'beam-lock').ft`);
  const lastRot = rot[rot.length - 1];
  rec(T, '光感锁：对准后持续命中到触发的时长（按 puzzle:partRotated 事件计）', Math.abs((act - lastRot) / 60 - 1.5) < 0.05 ? 'PASS' : 'FAIL', `最后一次转动 fixedTick ${lastRot}，receiver:activated ${act}，间隔 ${((act - lastRot) / 60).toFixed(3)} s`);
  await page.tap('Tab'); await must(`__game.input.context === 'explore'`, 60000, 'exit');
  await tp(-16.5, 0.05, 5.5, 0); await waitSec(1);
  const a = { solved: await ev(`${H}.isSolved('test-beam')`), cur: await ev(`${H}.currentId`), icon: await ev(`${H}.iconVisible`), domIcon: await icon() };
  await page.tap('KeyH'); await sleep(1500); const p2 = await panel();
  await page.screenshot(`${SH}/012-hint-after-lock.png`);
  await page.tap('KeyH'); await sleep(800); if ((await ev('__game.input.context')) !== 'explore') { await page.tap('Escape'); await sleep(800); }
  rec(T, '提示：区内一级解锁 → 光感锁触发后失效', b.cur === 'test-beam' && b.icon && a.solved && a.cur !== 'test-beam' && !a.icon && (p2 ?? '') !== (p1 ?? '') ? 'PASS' : 'FAIL', `解锁前 ${JSON.stringify(b)}，H 面板「${p1}」；触发后 ${JSON.stringify(a)}，H 面板「${p2}」。地面圈是 TestbedScene 画的固定标记，不会随解谜消失（属于测试场标记，不判断）`);
});
await step(T, '点火口（干净时序）：天光灭时开油阀 → 天光淡入 → 命中满 2 s 点燃', async () => {
  await must(`!${B}.sky.lit && ${B}.sky.intensity === 0`, 700000, 'sky off');
  const s0 = await st();
  const samp = ev(`__qa.sample(() => [__game.time.fixedTick, +__testbed.beamArea.sky.intensity.toFixed(2), __testbed.beamArea.igniter.state, +__testbed.beamArea.igniter.progress.toFixed(2)], 30000)`);
  const t0 = await ft(); await page.tap('KeyU');
  await must(`__ev.some(x => x.n === 'receiver:activated' && x.e.id === 'beam-igniter')`, 300000, 'ign');
  const act = await ev(`__ev.find(x => x.n === 'receiver:activated' && x.e.id === 'beam-igniter').ft`);
  const uT = await ev(`(__ev.find(x => x.n === 'beam:skyAlwaysOn') || {}).ft`);
  const s = await samp; const firstHit = s.find((x) => x[0] >= t0 && (x[2] === 'charging'));
  await waitSec(1); const s1 = await st();
  rec(T, '点火口（干净时序）：天光灭时开油阀 → 天光淡入 → 命中满 2 s 点燃', firstHit && Math.abs((act - firstHit[0]) / 60 - 2) < 0.25 && s1.sky.color === 'warm' && s1.sky.always ? 'PASS' : 'FAIL',
    `开阀前 ${JSON.stringify({ sky: s0.sky, ign: s0.ign })}；beam:skyAlwaysOn 于 ${uT}，首个 charging 采样 ${JSON.stringify(firstHit)}，activated ${act}（U→点燃 ${((act - uT) / 60).toFixed(2)} s；首见命中→点燃 ${firstHit ? ((act - firstHit[0]) / 60).toFixed(2) : '?'} s，采样间隔约一帧）；之后 ${JSON.stringify({ sky: s1.sky, ign: s1.ign })}`);
});
P.save('b5-012b'); console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
