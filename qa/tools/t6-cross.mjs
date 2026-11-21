import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5287);
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


await ringBell(); await waitTide('low');
await holdPush(`__s1.puzzles.raftPush.locked`);
await ringBell(); await waitTide('high');
await page.waitFor(`__s1.puzzles.raft.state === 'floating'`, 60000, 100); await sleep(1000);
const look = () => ev(`(() => { const s = __s1, it = s.interaction; const pr = document.querySelector('.hud-prompt'); return { prompt: pr && !pr.hidden ? pr.textContent : null, focus: it.focus?.id ?? it.current?.id ?? it.target?.id ?? null, nearLink: !!s.rig.controller.nearLink, linkPrompt: s.rig.controller.nearLink?.prompt ?? null, pos: [s.rig.body.position.x, s.rig.body.position.y, s.rig.body.position.z].map(v => +v.toFixed(3)), busy: s.rig.controller.busy }; })()`);
async function crossWithE(x, y, z, label) {
  await tp(x, y, z, 0); await sleep(1200);
  const a = await look();
  const f0 = (await st()).ft;
  await page.screenshot(`${SH}/013-link-${label}.png`);
  await page.tap('KeyE');
  await sleep(200);
  const traversing = await page.waitFor(`__s1.rig.controller.busy`, 5000, 30);
  if (traversing) await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  await sleep(600);
  const b = await look();
  const opened = await ev(`({ ctx: __game.input.context, subs: __ev.filter(x => x.n === 'subtitle:show' && x.ft >= ${f0}).map(x => x.e.id) })`);
  if (opened.ctx !== 'explore') { await page.tap('Escape'); await sleep(500); }
  return { before: a, traversing, after: b, opened };
}
await step(T, '只用 E（不按 W）跨两次', async () => {
  const r1 = await crossWithE(-0.9, 1.87, 8.2, 'near');
  const r2 = await crossWithE(-0.9, 1.87, 11.5, 'raft');
  await page.keyDown('KeyW'); await page.waitFor(`__s1.puzzles.p2Solved`, 8000, 50); await page.keyUp('KeyW');
  const s = await st();
  rec(T, '站在跨越点只按 E 跨越（两次）', r1.traversing && r2.traversing && r1.after.pos[2] > 8.8 && r2.after.pos[2] > 12.4 ? 'PASS' : 'FAIL', { r1, r2, p2: s.p2, goal: s.goal });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
