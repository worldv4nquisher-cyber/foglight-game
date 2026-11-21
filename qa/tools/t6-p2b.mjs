import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5285);
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

await step(T, '未推浮台就来回涨落潮', async () => {
  await ringBell(); await waitTide('low');
  const f0 = (await st()).ft;
  await ringBell(); await waitTide('high'); await page.waitFor(`__s1.puzzles.raft.state !== 'drifting'`, 60000, 100); await sleep(2500);
  const fl = await ev(`__ev.filter(x => x.n === 'float:state' && x.ft >= ${f0}).map(x => x.e.state)`);
  const sb = await subs(f0);
  await page.screenshot(`${SH}/BUG-010-drift-back-unmoved.png`);
  rec(T, '浮台没离开原位、涨潮时不应说「它漂回去了。」', sb.includes('ch1.s1.raft.drift_back') ? 'FAIL' : 'PASS', { floatStates: fl, subs: sb, raft: (await st()).raftPos });
});
await step(T, '推到石槽 → 涨潮 1.85', async () => {
  await ringBell(); await waitTide('low');
  const p = await holdPush(`__s1.puzzles.raftPush.locked || __s1.puzzles.raftPush.pushT >= 1`);
  rec(T, '推到石槽并锁定（第二次）', p.b.locked ? 'PASS' : 'FAIL', { raftPos: p.b.raftPos, fixedSec: +((p.b.ft - p.a.ft) / 60).toFixed(2), speed: p.speed });
  await ringBell(); await waitTide('high');
  await page.waitFor(`__s1.puzzles.raft.state === 'floating'`, 60000, 100); await sleep(1500);
  const ys = [];
  for (let i = 0; i < 12; i++) { ys.push((await st()).raftPos[1]); await sleep(250); }
  const s = await st();
  await page.screenshot(`${SH}/013-raft-floating-slot.png`);
  rec(T, '浮台高度 1.85 ± 0.05（采样 12 次含起伏）', ys.every(y => Math.abs(y - 1.85) <= 0.05) && s.inAnchor ? 'PASS' : 'FAIL', { ys, min: Math.min(...ys), max: Math.max(...ys), raftPos: s.raftPos, inAnchor: s.inAnchor, subsSincePush: await subs(p.a.ft) });
});
await step(T, '真实沿山脊走到近岸平台，E 两次跨过去', async () => {
  const w = await walk([[-12.5, -4], [-12, -2.2], [-11, 0.5], [-9, 3], [-6.5, 5.4], [-4.4, 6.6], [-0.9, 7.4], [-0.9, 8.0]], { maxWall: 300000, tol: 0.3 });
  rec(T, '涨潮时沿山脊走到近岸平台', w.reached && !w.stuck ? 'PASS' : 'FAIL', { stuck: w.stuck, final: w.final, trace: w.trace });
  if (!w.reached) await tp(-0.9, 1.87, 8.0, 0);
  await ev(`(() => { __s1.rig.controller.facing = 0; __s1.cameraFollow.yaw = Math.PI; return 1; })()`);
  await page.keyDown('KeyW'); const seen1 = await page.waitFor(`!!__s1.rig.controller.nearLink`, 20000, 50); await page.keyUp('KeyW');
  await sleep(300);
  const pr1 = await ev(`document.querySelector('.hud-prompt')?.hidden ? null : document.querySelector('.hud-prompt')?.textContent`);
  await page.screenshot(`${SH}/013-link-prompt.png`);
  const a = await st();
  await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 10000, 30);
  await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  const b = await st();
  await page.screenshot(`${SH}/013-on-raft.png`);
  await page.keyDown('KeyW'); const seen2 = await page.waitFor(`!!__s1.rig.controller.nearLink`, 20000, 50); await page.keyUp('KeyW');
  await sleep(300);
  const pr2 = await ev(`document.querySelector('.hud-prompt')?.hidden ? null : document.querySelector('.hud-prompt')?.textContent`);
  const b2 = await st();
  await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 10000, 30);
  await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  await sleep(300);
  // 再往前走一步进对岸触发体
  if (!(await st()).p2) { await page.keyDown('KeyW'); await page.waitFor(`__s1.puzzles.p2Solved`, 15000, 50); await page.keyUp('KeyW'); }
  await sleep(800);
  const c = await st();
  await page.screenshot(`${SH}/013-crossed.png`);
  rec(T, 'E 两次跨上浮台、跨到对岸 → 谜题 2 解开', seen1 && seen2 && c.p2 ? 'PASS' : 'FAIL', { prompt1: pr1, prompt2: pr2, beforeE1: a.pos, onRaft: b.pos, beforeE2: b2.pos, after: c.pos, p2: c.p2, goal: c.goal });
});
await step(T, '解开后按 R', async () => {
  await ringBell(); await waitTide('low');
  await tp(1.5, 0.12, 10.5, -Math.PI / 2);
  await sleep(600);
  const a = await st();
  const lines = await ev(`[...document.querySelectorAll('.hud-prompt, .hud-prompt *')].map(e => e.textContent.trim()).filter(Boolean)`);
  await page.tap('KeyR'); await sleep(1500);
  const b = await st();
  rec(T, '谜题 2 解开后按 R', b.p2 && Math.abs(b.raftPos[0] + 0.9) < 0.05 ? 'PASS' : 'FAIL(未实现)', { promptLines: lines, before: { raftPos: a.raftPos, locked: a.locked, p2: a.p2 }, after: { raftPos: b.raftPos, pushT: b.pushT, locked: b.locked, p2: b.p2 } });
});
console.log('STATE', JSON.stringify(await st()));
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
