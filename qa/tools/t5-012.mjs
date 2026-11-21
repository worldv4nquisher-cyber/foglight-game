import { open, sleep, SH } from './b5lib.mjs';
const T = 'v0.1-012';
const P = await open(5261);
const { page, ev, must, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['receiver:activated','receiver:blocked','receiver:reset','beam:emitter','puzzle:partRotated','puzzle:partSelected','puzzle:enter','puzzle:exit','beam:skyAlwaysOn','beam:setColor','hint:solved','hint:show','hint:available'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick }));
  } }); })();`);
await page.goto(url('?smoke=1&debug=1&beamDebug=1&scene=testbed'));
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

await step(T, 'F4 光路行 + 初始光路', async () => {
  await page.tap('F4'); await sleep(800);
  const s = await st(); const l = await ev(`(() => { const t = document.body.innerText.split('\\n').find(l => /^光路/.test(l.trim())); return t ?? null; })()`);
  await tp(-16.5, 0.05, 2, 0); await ev(`__testbed.cameraFollow.yaw = Math.PI; 1`); await waitSec(0.8);
  await page.screenshot(`${SH}/012-initial-beam.png`);
  rec(T, 'F4 光路行 + 初始光路', /光路/.test(l ?? '') && s.lampEnd && s.lock.s !== 'activated' ? 'PASS' : 'FAIL', `${JSON.stringify(s)}；F4「${l}」`);
});

await step(T, '提示区（H）', async () => {
  await tp(-16.5, 0.05, 5.5, 0); await waitSec(1);
  const before = await ev(`({ hud: [...document.querySelectorAll('[class*=hint]')].filter(e => !e.hidden && e.offsetParent).map(e => e.className + ':' + e.textContent.trim().slice(0, 40)), zone: __testbed.hints?.zoneId ?? __testbed.hints?.activeId ?? null })`);
  await page.tap('KeyH'); await sleep(1500);
  const after = await ev(`[...document.querySelectorAll('[class*=hint]')].filter(e => !e.hidden && e.offsetParent).map(e => e.className + ':' + e.textContent.trim().slice(0, 60))`);
  await page.screenshot(`${SH}/012-hint-zone.png`);
  rec(T, '提示区内按 H 出光路谜题提示', after.some((x) => x.length > 20) ? 'PASS' : 'FAIL', `进区前后 ${JSON.stringify(before)}；按 H 后 ${JSON.stringify(after)}`);
  await page.tap('KeyH'); await sleep(500); await page.tap('Escape'); await sleep(800);
  if ((await ev('__game.input.context')) !== 'explore') { await page.tap('Escape'); await sleep(800); }
});

await step(T, '机关台 E 进入 + 转镜光路实时更新 + 1.5 s 触发光感锁', async () => {
  await tp(-16.5, 0.05, 6.2, 0); await waitSec(0.6);
  const cand = await ev(`__testbed.interaction.current?.id ?? null`);
  await page.tap('KeyE'); await must(`__game.input.context === 'puzzle'`, 60000, 'puzzle');
  await waitSec(0.5);
  const log = [];
  // 镜 A：先 D 一档看方向
  let r = await rotate('KeyD'); let s = await st(); log.push([...r, s.lampEnd, s.lampMirrors.join('>'), s.traces]);
  const key = r[2] > r[1] ? 'KeyA' : 'KeyD';
  while ((await ev(`${B}.mirrorA.part.angles[0]`)) !== 0) { r = await rotate(key); s = await st(); log.push([...r, s.lampEnd, s.lampMirrors.join('>'), s.traces]); if (log.length > 12) break; }
  await page.screenshot(`${SH}/012-mirror-a-aligned.png`);
  // 切到镜 B（E = partNext）
  await page.tap('KeyE'); await must(`${B}.puzzle.current.id === 'beam-mirror-b'`, 60000, 'select B');
  // 镜 B 先转开一档再转回，同时测进度归零
  r = await rotate('KeyD'); s = await st(); log.push([...r, s.lampEnd, s.lampMirrors.join('>'), s.traces, s.lock.p]);
  const back = r[2] > r[1] ? 'KeyA' : 'KeyD';
  r = await rotate(back); const tOn = await ft(); s = await st(); log.push([...r, s.lampEnd, s.lampMirrors.join('>'), s.lampRecv, s.lock.s]);
  await waitSec(0.7); const mid = await st();
  r = await rotate(back); await waitSec(0.2); const off = await st(); log.push([...r, off.lampEnd, off.lock.s, off.lock.p]);
  const resets = await ev(`__ev.filter(x => x.n === 'receiver:reset' && x.e.id === 'beam-lock').length`);
  const fwd = back === 'KeyA' ? 'KeyD' : 'KeyA';
  r = await rotate(fwd); const t1 = await ft(); await page.screenshot(`${SH}/012-lock-charging.png`);
  await must(`__ev.some(x => x.n === 'receiver:activated' && x.e.id === 'beam-lock')`, 300000, 'lock');
  const act = await ev(`__ev.find(x => x.n === 'receiver:activated' && x.e.id === 'beam-lock').ft`);
  await waitSec(0.5); const fin = await st();
  await page.screenshot(`${SH}/012-lock-activated.png`);
  rec(T, '机关台 E 进入 + 转镜光路实时更新 + 1.5 s 触发光感锁', cand === 'beam-console' && fin.lock.s === 'activated' && Math.abs((act - t1) / 60 - 1.5) < 0.1 && mid.lock.s === 'charging' && off.lock.p === 0 ? 'PASS' : 'FAIL',
    `候选 ${cand}；转镜日志 [部件, 前角, 后角, 光终点, 经过镜子, 重算次数…] ${JSON.stringify(log)}；对准后 0.7 s 进度 ${JSON.stringify(mid.lock)}，转开后 ${JSON.stringify(off.lock)}（receiver:reset ${resets} 次）；转回后 ${((act - t1) / 60).toFixed(2)} s 触发 receiver:activated；最终 ${JSON.stringify({ A: fin.A, B: fin.Bm, end: fin.lampEnd, refl: fin.lampRefl, lock: fin.lock })}`);
});

await step(T, '镜子背面挡光', async () => {
  const sel = await ev(`${B}.puzzle.current.id`);
  const res = [];
  for (let i = 0; i < 24; i++) { const r = await rotate('KeyD'); const s = await st(); res.push([r[2], s.lampEnd, s.lampMirrors.join('>')]); if (s.lampEnd === 'mirrorBack') break; }
  const hit = res.find((x) => x[1] === 'mirrorBack');
  if (hit) await page.screenshot(`${SH}/012-mirror-back-blocked.png`);
  const lockAfter = (await st()).lock;
  rec(T, '镜子背面挡光（真实转镜找背面）', hit ? 'PASS' : 'FAIL', `转 ${sel}：${JSON.stringify(res)}；光感锁已触发后保持 ${JSON.stringify(lockAfter)}`);
  await page.tap('Tab'); await must(`__game.input.context === 'explore'`, 60000, 'exit');
});

await step(T, '提示区在光感锁触发后消失', async () => {
  const solved = await ev(`__ev.filter(x => x.n === 'hint:solved').map(x => x.e)`);
  await tp(-16.5, 0.05, 5.5, 0); await waitSec(1); await page.tap('KeyH'); await sleep(1200);
  const vis = await ev(`[...document.querySelectorAll('[class*=hint]')].filter(e => !e.hidden && e.offsetParent).map(e => e.className + ':' + e.textContent.trim().slice(0, 60))`);
  const ring = await ev(`(() => { const o = __game.scenes.current.scene?.getObjectByName?.('hint-zone-test-beam') ?? __testbed.scene?.getObjectByName?.('hint-zone-test-beam'); return o ? o.visible : 'n/a'; })()`);
  await page.screenshot(`${SH}/012-hint-after-lock.png`);
  rec(T, '提示区在光感锁触发后消失', solved.length && !vis.some((x) => x.length > 20) ? 'PASS' : 'FAIL', `hint:solved ${JSON.stringify(solved)}；区内按 H 后可见提示元素 ${JSON.stringify(vis)}；地面圈 visible=${ring}`);
  await page.tap('Escape'); await sleep(500); if ((await ev('__game.input.context')) !== 'explore') { await page.tap('Escape'); await sleep(800); }
});

await step(T, '天光周期 40 s / 亮 25 s', async () => {
  // 等到至少看到一次 灭→亮 与 亮→灭
  await must(`(() => { const e = __ev.filter(x => x.n === 'beam:emitter' && x.e.id === 'beam-sky'); return e.some(x => x.e.lit) && e.some(x => !x.e.lit) && e.length >= 3; })()`, 700000, 'sky cycle');
  const e = await ev(`__ev.filter(x => x.n === 'beam:emitter' && x.e.id === 'beam-sky').map(x => [x.e.lit, x.ft])`);
  const offT = e.filter((x) => !x[0]).map((x) => x[1]); const onT = e.filter((x) => x[0]).map((x) => x[1]);
  const diffs = []; for (let i = 1; i < e.length; i++) diffs.push([e[i - 1][0] ? '亮持续' : '灭持续', +((e[i][1] - e[i - 1][1]) / 60).toFixed(2)]);
  const s = await st();
  const okLit = diffs.filter((d) => d[0] === '亮持续').every((d) => Math.abs(d[1] - 25) < 0.3); const okOff = diffs.filter((d) => d[0] === '灭持续').every((d) => Math.abs(d[1] - 15) < 0.3);
  rec(T, '天光周期 40 s / 亮 25 s（1 s 淡入淡出）', diffs.length >= 2 && okLit && okOff ? 'PASS' : 'FAIL', `beam:emitter(beam-sky) [lit, fixedTick] ${JSON.stringify(e)}；间隔 ${JSON.stringify(diffs)}（lit 以强度 0.5 为界，淡入淡出各 1 s，所以亮/灭时长约 25/15 s）；${JSON.stringify(s.sky)}`);
});

await step(T, '点火口：无油阀只发红光；U 开油阀 → 天光常亮，命中 2 s 点燃，天光转暖', async () => {
  await must(`${B}.sky.lit`, 700000, 'sky lit');
  await waitSec(0.5);
  const s0 = await st(); const blockedN = await ev(`__ev.filter(x => x.n === 'receiver:blocked' && x.e.id === 'beam-igniter').length`);
  await tp(-19, 0.05, 12.5, 0); await ev(`__testbed.cameraFollow.yaw = Math.PI; 1`); await waitSec(0.8);
  await page.screenshot(`${SH}/012-igniter-blocked-red.png`);
  const t0 = await ft(); await page.tap('KeyU');
  await must(`__ev.some(x => x.n === 'receiver:activated' && x.e.id === 'beam-igniter')`, 300000, 'ign');
  const act = await ev(`__ev.find(x => x.n === 'receiver:activated' && x.e.id === 'beam-igniter').ft`);
  await waitSec(1.5); const s1 = await st();
  await page.screenshot(`${SH}/012-igniter-lit-warm.png`);
  rec(T, '点火口：无油阀只发红光；U 开油阀 → 天光常亮，命中 2 s 点燃，天光转暖', s0.ign.s === 'blocked' && blockedN >= 1 && s0.ign.c && Math.abs((act - t0) / 60 - 2) < 0.15 && s1.sky.always && s1.ign.s === 'activated' && s1.sky.color === 'warm' ? 'PASS' : 'FAIL',
    `开阀前 天光 ${JSON.stringify(s0.sky)} 终点 ${s0.skyEnd}/${s0.skyRecv}，点火口 ${JSON.stringify(s0.ign)}，receiver:blocked ${blockedN} 次；按 U 后 ${((act - t0) / 60).toFixed(2)} s receiver:activated；之后 天光 ${JSON.stringify(s1.sky)} 油阀 ${s1.oil} 点火口 ${JSON.stringify(s1.ign)}`);
});

await step(T, 'O 切换暖光 / 冷白', async () => {
  await tp(-16.5, 0.05, 2, 0); await ev(`__testbed.cameraFollow.yaw = Math.PI; 1`); await waitSec(0.5);
  const c0 = (await st()).lamp; await page.tap('KeyO'); await waitSec(0.5); const c1 = (await st()).lamp;
  await page.screenshot(`${SH}/012-lamp-cold.png`);
  const lockC = (await st()).lock; await page.tap('KeyO'); await waitSec(0.5); const c2 = (await st()).lamp;
  rec(T, 'O 切换暖光 / 冷白', c0.color === 'warm' && c1.color === 'coldWhite' && c2.color === 'warm' ? 'PASS' : 'FAIL', `${JSON.stringify([c0, c1, c2])}；冷白时光感锁 ${JSON.stringify(lockC)}`);
});

await step(T, 'F4 光路行最终 + 重算耗时（不评判）', async () => {
  const l = await ev(`(() => document.body.innerText.split('\\n').find(l => /^光路/.test(l.trim())) ?? null)()`);
  const s = await st();
  rec(T, 'F4 光路行最终 + 重算耗时（SwiftShader，不评判）', /光路/.test(l ?? '') ? 'PASS' : 'FAIL', `「${l}」；traceCount ${s.traces}，lastMs ${s.ms}`);
});
P.save('b5-012'); console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
