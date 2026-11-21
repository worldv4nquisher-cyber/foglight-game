import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5290);
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



await step(T, 'R 在涨潮 / 潮汐变化中无效', async () => {
  await ringBell(); await waitTide('low');
  await holdPush(`__s1.puzzles.raftPush.pushT >= 0.3`);
  const a = await st();
  await ringBell();
  await page.waitFor(`__s1.puzzles.tide.transitioning`, 10000, 30);
  await tp(5, 0.12, 13, 0);
  await page.tap('KeyR'); await sleep(200);
  const b = await st();
  await waitTide('high');
  await page.waitFor(`__s1.puzzles.raft.state !== 'drifting'`, 60000, 100);
  // 高潮时浮台已漂回原位；先退潮、推到石槽、再涨潮，测高潮时 R
  await ringBell(); await waitTide('low');
  await holdPush(`__s1.puzzles.raftPush.locked`);
  await ringBell(); await waitTide('high');
  await page.waitFor(`__s1.puzzles.raft.state === 'floating'`, 60000, 100);
  await page.tap('KeyR'); await sleep(1000);
  const c = await st();
  rec(T, '潮汐变化中按 R 无效', b.tr && Math.abs(b.raftPos[0] - a.raftPos[0]) < 0.3 && b.pushT > 0 ? 'PASS' : 'FAIL', { before: { x: a.raftPos[0], pushT: a.pushT }, duringTransition: { tr: b.tr, level: b.level, x: b.raftPos[0], pushT: b.pushT, raft: b.raft } });
  rec(T, '涨潮（浮台在石槽浮起）时按 R 无效', c.inAnchor && Math.abs(c.raftPos[0] + 0.9) < 0.05 && c.raft === 'floating' ? 'PASS' : 'FAIL', { raftPos: c.raftPos, inAnchor: c.inAnchor, raft: c.raft, locked: c.locked });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
