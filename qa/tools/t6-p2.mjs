import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5284);
const T = 'v0.1-013';
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  for (const n of ['interact:used','interact:pushEnd','tide:changed','tide:changing','float:state','subtitle:show','subtitle:hide','hint:solved','puzzle:solved','player:respawn','fade:start'])
    v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed, now: performance.now() }));
} }); })();`);
const S = '__s1';
const st = () => ev(`(() => { const s = ${S}, p = s.puzzles, b = s.rig.body.position, r = p.raft.object.position; const pr = document.querySelector('.hud-prompt'); return { ft: __game.time.fixedTick, tide: p.tide.state, level: +p.tide.level.toFixed(3), tr: p.tide.transitioning, raft: p.raft.state, raftPos: [r.x, r.y, r.z].map(v => +v.toFixed(3)), inAnchor: p.raft.inAnchor, pushT: +p.raftPush.pushT.toFixed(3), locked: p.raftPush.locked, p1: p.p1Solved, p2: p.p2Solved, pos: [b.x, b.y, b.z].map(v => +v.toFixed(3)), goal: __game.narrative.goal, busy: s.rig.controller.busy, ctx: __game.input.context, prompt: pr && !pr.hidden ? pr.textContent.trim() : null, sub: (() => { const e = document.querySelector('.subtitle, .hud-subtitle, .subtitles'); return e && !e.hidden ? e.textContent.trim() : null; })() }; })()`);
const tp = (x, y, z, facing) => ev(`(() => { const s = ${S}; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); ${facing !== undefined ? `s.rig.controller.facing = ${facing}; s.cameraFollow.yaw = ${facing} + Math.PI;` : ''} return 1; })()`);
const evs = (n, sinceFt) => ev(`__ev.filter(x => x.n === '${n}' && x.ft >= ${sinceFt})`);
// 真实走路：每 150 ms 把相机朝向对准下一个点、按住 W；固定步长 4 s 没前进 5 cm 判卡住
async function walk(points, { tol = 0.35, maxWall = 240000, label = '' } = {}) {
  await page.keyDown('KeyW');
  const trace = []; let stuck = null; const end = Date.now() + maxWall; let i = 0;
  let ref = await st(); let refFt = ref.ft;
  try {
    while (i < points.length && Date.now() < end) {
      const [tx, tz] = points[i];
      const s = await st();
      const d = Math.hypot(tx - s.pos[0], tz - s.pos[2]);
      if (d < tol) { i++; continue; }
      await ev(`(() => { const s = ${S}; s.cameraFollow.yaw = Math.atan2(-(${tx} - s.rig.body.position.x), -(${tz} - s.rig.body.position.z)); return 1; })()`);
      if (Math.hypot(s.pos[0] - ref.pos[0], s.pos[2] - ref.pos[2]) > 0.05) { ref = s; refFt = s.ft; }
      else if (s.ft - refFt > 240) { stuck = { at: s.pos, target: points[i], idx: i, tide: s.tide, level: s.level }; break; }
      if (trace.length === 0 || Math.hypot(s.pos[0] - trace.at(-1)[0], s.pos[2] - trace.at(-1)[2]) > 0.5) trace.push(s.pos);
      await sleep(150);
    }
  } finally { await page.keyUp('KeyW'); }
  const s = await st();
  return { reached: i >= points.length, stuck, final: s.pos, trace };
}
const waitTide = (state) => must(`${S}.puzzles.tide.state === '${state}' && !${S}.puzzles.tide.transitioning`, 400000, 'tide ' + state);
async function ringBell() {
  await tp(-13.9, 2.42, -6.2, -Math.PI / 2); // 钟交互点西侧 0.55 m，面朝东（−X）
  const ok = await page.waitFor(`/E/.test(document.querySelector('.hud-prompt')?.hidden ? '' : document.querySelector('.hud-prompt')?.textContent ?? '')`, 20000, 150);
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
  const f0 = (await st()).ft;
  await page.tap('KeyE');
  const used = await page.waitFor(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'tide-bell-s1' && x.ft >= ${f0})`, 60000, 100);
  return { ok, prompt, used };
}


await page.goto(url('?smoke=1&debug=1&autostart=1'));
await must(`!!(window.__s1 && __s1.puzzles) && __game.input.context === 'explore' && !__game.isPaused`, 300000, 'S1 explore');
await sleep(800);
const subs = (f0) => ev(`__ev.filter(x => (x.n === 'subtitle:show') && x.ft >= ${f0}).map(x => x.e.id)`);
async function holdPush(untilExpr, maxWall = 300000) {
  await tp(11.3, 0.12, 10.5, -Math.PI / 2);
  await page.waitFor(`!document.querySelector('.hud-prompt')?.hidden`, 15000, 100);
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
  const a = await st();
  await page.keyDown('KeyE');
  const ok = await page.waitFor(untilExpr, maxWall, 100);
  await page.keyUp('KeyE');
  await sleep(300);
  const b = await st();
  return { prompt, ok, a, b, speed: +((Math.abs(b.raftPos[0] - a.raftPos[0])) / ((b.ft - a.ft) / 60)).toFixed(3) };
}
await step(T, '谜题 2 前置：敲钟退潮', async () => { const r = await ringBell(); await waitTide('low'); rec(T, '退潮', 'INFO', { prompt: r.prompt, s: await st() }); });

await step(T, '谜题 2：推一段后按 R 放回', async () => {
  const p = await holdPush(`__s1.puzzles.raftPush.pushT >= 0.3`);
  const promptNow = await ev(`[...document.querySelectorAll('.hud-prompt, .hud-prompt *')].map(e => e.textContent.trim()).filter(Boolean)`);
  const f0 = (await st()).ft;
  await page.tap('KeyR');
  await sleep(1500);
  const s = await st();
  await page.screenshot(`${SH}/013-after-R.png`);
  rec(T, 'R 放回浮台（低潮、搁浅）', s.pushT === 0 && Math.abs(s.raftPos[0] - 9.1) < 0.05 ? 'PASS' : 'FAIL', { push: { prompt: p.prompt, pushT: p.b.pushT, raftX: p.b.raftPos[0], speedMps_fixed: p.speed }, promptLinesBeforeR: promptNow, after: s, subs: await subs(f0) });
});

await step(T, '谜题 2：没推到位就涨潮 → 浮台漂回', async () => {
  const p = await holdPush(`__s1.puzzles.raftPush.pushT >= 0.3`);
  const f0 = (await st()).ft;
  await ringBell();
  await waitTide('high');
  await page.waitFor(`__s1.puzzles.raft.state !== 'drifting'`, 120000, 100);
  await sleep(1500);
  const fl = await ev(`__ev.filter(x => x.n === 'float:state' && x.ft >= ${f0}).map(x => ({ e: x.e, ft: x.ft, el: +x.el.toFixed(2) }))`);
  const s = await st();
  await page.screenshot(`${SH}/013-raft-drift-back.png`);
  const sb = await subs(f0);
  rec(T, '漂回原位 + 「它漂回去了。」', Math.abs(s.raftPos[0] - 9.1) < 0.1 && s.pushT === 0 && sb.includes('ch1.s1.raft.drift_back') ? 'PASS' : 'FAIL', { pushedTo: p.b.raftPos, floatEvents: fl, after: s, subs: sb });
});

await step(T, '谜题 2：退潮后推到石槽', async () => {
  await ringBell(); await waitTide('low');
  const p = await holdPush(`__s1.puzzles.raftPush.locked || __s1.puzzles.raftPush.pushT >= 1`);
  await page.screenshot(`${SH}/013-raft-in-slot.png`);
  rec(T, '推到石槽并锁定', p.b.locked && Math.abs(p.b.raftPos[0] + 0.9) < 0.05 ? 'PASS' : 'FAIL', { prompt: p.prompt, end: p.b, speedMps_fixed: p.speed, fixedSec: +((p.b.ft - p.a.ft) / 60).toFixed(2) });
  // 锁定后再按 E / R
  await page.tap('KeyR'); await sleep(1000);
  rec(T, '锁定后按 R（a3da8e7 未要求禁用，仅记录）', 'INFO', await st());
});

await step(T, '谜题 2：涨潮浮台升到 1.85 ± 0.05 m', async () => {
  await ringBell(); await waitTide('high');
  await page.waitFor(`__s1.puzzles.raft.state === 'floating'`, 60000, 100); await sleep(1500);
  const s = await st();
  rec(T, '浮台高度', Math.abs(s.raftPos[1] - 1.85) <= 0.05 && s.inAnchor ? 'PASS' : 'FAIL', { raftPos: s.raftPos, inAnchor: s.inAnchor, raft: s.raft });
});

await step(T, '谜题 2：真实走山脊到近岸平台，E 两次跨过去', async () => {
  const w = await walk([[-12.5, -4], [-12, -2.2], [-10.1, 0], [-8.2, 2.2], [-6.3, 4.4], [-4.4, 6.6], [-0.9, 7.4], [-0.9, 8.0]], { maxWall: 300000, tol: 0.3 });
  rec(T, '涨潮时沿山脊走到近岸平台', w.reached && !w.stuck ? 'PASS' : 'FAIL', { stuck: w.stuck, final: w.final, trace: w.trace });
  if (!w.reached) await tp(-0.9, 1.87, 8.0, 0);
  await ev(`(() => { __s1.rig.controller.facing = 0; __s1.cameraFollow.yaw = Math.PI; return 1; })()`);
  // 往前挪到提示出现
  await page.keyDown('KeyW'); const seen1 = await page.waitFor(`!!__s1.rig.controller.nearLink`, 20000, 50); await page.keyUp('KeyW');
  await sleep(300);
  const pr1 = await ev(`document.querySelector('.hud-prompt')?.hidden ? null : document.querySelector('.hud-prompt')?.textContent`);
  const a = await st();
  await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 10000, 30);
  await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  const b = await st();
  await page.screenshot(`${SH}/013-on-raft.png`);
  await page.keyDown('KeyW'); const seen2 = await page.waitFor(`!!__s1.rig.controller.nearLink`, 20000, 50); await page.keyUp('KeyW');
  await sleep(300);
  const pr2 = await ev(`document.querySelector('.hud-prompt')?.hidden ? null : document.querySelector('.hud-prompt')?.textContent`);
  await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 10000, 30);
  await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  await sleep(800);
  const c = await st();
  await page.screenshot(`${SH}/013-crossed.png`);
  rec(T, 'E 两次跨上浮台、跨到对岸 → 谜题 2 解开', seen1 && seen2 && b.pos[2] > 8.8 && b.pos[2] < 12.2 && c.p2 ? 'PASS' : 'FAIL', { prompt1: pr1, prompt2: pr2, beforeE1: a.pos, onRaft: b.pos, after: c.pos, p2: c.p2, goal: c.goal });
});

await step(T, '解开后按 R', async () => {
  await ringBell(); await waitTide('low');
  const a = await st();
  await page.tap('KeyR'); await sleep(1500);
  const b = await st();
  rec(T, '谜题 2 解开后按 R（b5bbc8c 才禁用；a3da8e7 未实现）', 'INFO', { before: { raftPos: a.raftPos, locked: a.locked, p2: a.p2 }, after: { raftPos: b.raftPos, pushT: b.pushT, locked: b.locked, p2: b.p2 } });
});

await step(T, '送回：礁石上涨潮 / 走进深水', async () => {
  const f0 = (await st()).ft;
  await ringBell();
  await tp(-2, 0.62, 0.5, 0);
  const ok = await page.waitFor(`__ev.some(x => x.n === 'subtitle:show' && x.e.id === 'ch1.common.tide_return' && x.ft >= ${f0})`, 300000, 100);
  await sleep(1500);
  const s = await st();
  await page.screenshot(`${SH}/013-recall-reef.png`);
  rec(T, '涨潮时站在礁石上 → 黑场送回安全点 + 「水太冷了。」', ok && Math.hypot(s.pos[0] + 12.5, s.pos[2] + 4) < 0.6 ? 'PASS' : 'FAIL', { pos: s.pos, level: s.level, subs: await subs(f0) });
  await waitTide('high');
  // 高潮从近岸平台东沿真实走进水里
  await tp(-0.5, 1.87, 7, -Math.PI / 2 + Math.PI);
  const f1 = (await st()).ft;
  const w = await walk([[4, 7]], { maxWall: 120000 });
  const ok2 = await page.waitFor(`__ev.some(x => x.n === 'subtitle:show' && x.e.id === 'ch1.common.tide_return' && x.ft >= ${f1})`, 60000, 100);
  await sleep(1500);
  const s2 = await st();
  rec(T, '高潮时从平台走进水里 → 送回', ok2 && Math.hypot(s2.pos[0] + 12.5, s2.pos[2] + 4) < 0.6 ? 'PASS' : 'FAIL', { walk: { stuck: w.stuck, final: w.final }, pos: s2.pos });
});
console.log('STATE', JSON.stringify(await st()));
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
