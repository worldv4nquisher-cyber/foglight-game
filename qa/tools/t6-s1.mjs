import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5282);
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
await page.screenshot(`${SH}/013-s1-spawn.png`);
rec(T, '开场状态', 'INFO', await st());

await step(T, '谜题 1：涨潮时礁石小径走不下去', async () => {
  await tp(-10.6, 2.42, -3.0, Math.PI / 2);
  const r = await walk([[-7.5, -3.0]], { maxWall: 90000 });
  const s = await st();
  rec(T, '涨潮时台阶口被挡', s.pos[0] < -9.6 ? 'PASS' : 'FAIL', { walk: { reached: r.reached, stuck: r.stuck, final: r.final }, tide: s.tide, level: s.level });
});

await step(T, '谜题 1：真实 E 敲钟 → 6 s 退潮', async () => {
  const b = await ringBell();
  const f0 = (await st()).ft;
  await page.screenshot(`${SH}/013-bell-ring.png`);
  await waitTide('low');
  const ch = await evs('tide:changed', f0);
  const s = await st();
  rec(T, '敲钟退潮', b.used && s.tide === 'low' && s.level === 0 ? 'PASS' : 'FAIL', { prompt: b.prompt, fixedSec: ch.length ? +((ch[0].ft - f0) / 60).toFixed(2) : null, goal: s.goal });
});

await step(T, '谜题 1：真实走台阶 + 礁石小径到尽头', async () => {
  await tp(-10.6, 2.42, -3.0, Math.PI / 2);
  const pts = [[-9.5, -3.0], [-6.3, -3.0], [-5.9, -3.0], [-4.5, -1.9], [-3.2, -0.7], [-2, 0.5], [-0.8, 1.6], [0.4, 2.6], [1.8, 3.4]];
  const r = await walk(pts, { maxWall: 300000 });
  await sleep(500);
  const s = await st();
  await page.screenshot(`${SH}/013-reef-path-end.png`);
  rec(T, '走礁石小径到尽头 → 谜题 1 解开', r.reached && !r.stuck && s.p1 ? 'PASS' : 'FAIL', { stuck: r.stuck, final: r.final, p1: s.p1, goal: s.goal, trace: r.trace });
});
console.log('STATE', JSON.stringify(await st()));
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
