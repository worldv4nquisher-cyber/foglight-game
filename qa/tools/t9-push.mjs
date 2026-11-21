import { REPO_ROOT } from './paths.mjs';
// batch8 S1：退潮深水区送回 / 船绳开关缺节点 / 推浮台 start-loop-end / 四个跨越落点 / 017 走跑混合与滑步（art=1）
import { open, sleep } from './b8lib.mjs'; const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch9');
import { EVLOG } from './b8s3.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(+process.env.PORT);
const T = 'b9-push-' + (process.env.Q || 'art=1');
await page.addInit(EVLOG);
await page.addInit(`window.addEventListener('keydown', (e) => { if (!e.repeat) (window.__kd ??= []).push({ code: e.code, n: window.__n ?? -1 }); }, true); window.addEventListener('keyup', (e) => (window.__ku ??= []).push({ code: e.code, n: window.__n ?? -1 }), true);`);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&autostart=1&' + (process.env.Q || 'art=1')));
await must(`!!(window.__s1 && __s1.puzzles) && __game.input.context === 'explore' && !__game.isPaused && !__s1.rig.controller.busy`, 400000, 'S1 explore');
await sleep(800);
const S = '__s1';
// 每个固定步采样（自己数步：Game.time.fixedTick 一帧才加一次）
await ev(`(() => { const s = __s1; window.__n = 0; window.__smp = null; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; if (window.__smp) { const a = s.rig.animator, b = s.rig.body.body, p = b.position, ix = s.interaction, sl = a?.slots; const w = (n) => { const x = sl?.get(n); return x ? [+x.w.toFixed(3), +x.action.timeScale.toFixed(3)] : null; };
  window.__smp.push({ n: window.__n, p: [p.x, p.y, p.z].map(v => +v.toFixed(4)), v: +Math.hypot(b.actualVelocity.x, b.actualVelocity.z).toFixed(3), g: b.onGround, st: a?.state, pose: a?.posing ?? null, loop: a?.looping ?? null, ph: ix.pushPhase, busy: s.rig.controller.busy, rz: a ? +a.rootOffset.position.z.toFixed(4) : 0, idle: w('xi-idle'), walk: w('xi-walk'), jog: w('xi-jog'), pushT: +s.puzzles.raftPush.pushT.toFixed(4), raftX: +s.puzzles.raft.object.position.x.toFixed(4) }); } }; return 1; })()`);
const smpOn = () => ev(`(window.__smp = [], 1)`);
const smpOff = () => ev(`(() => { const r = window.__smp; window.__smp = null; return r; })()`);
const N = () => ev('window.__n');
const waitN = async (k) => { const n0 = await N(); await must(`window.__n >= ${n0 + k}`, 600000, 'ticks ' + k); };
const st = () => ev(`(() => { const s = ${S}, p = s.puzzles, b = s.rig.body.position, r = p.raft.object.position; return { n: window.__n, tide: p.tide.state, level: +p.tide.level.toFixed(3), tr: p.tide.transitioning, raft: p.raft.state, raftPos: [r.x, r.y, r.z].map(v => +v.toFixed(3)), inAnchor: p.raft.inAnchor, pushT: +p.raftPush.pushT.toFixed(3), p2: p.p2Solved, pos: [b.x, b.y, b.z].map(v => +v.toFixed(3)), busy: s.rig.controller.busy, ctx: __game.input.context, anim: s.rig.animator?.state }; })()`);
const tp = (x, y, z, facing) => ev(`(() => { const s = ${S}; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); s.rig.body.velocity.set(0,0,0); ${facing !== undefined ? `s.rig.controller.facing = ${facing}; s.cameraFollow.yaw = ${facing} + Math.PI;` : ''} return 1; })()`);
const evs = (n, n0 = 0) => ev(`__ev.filter(x => x.n === '${n}' && x.ft >= ${n0})`);
const gft = () => ev('__game.time.fixedTick');
// 潮汐：真按键敲钟；过渡用 t 快进到末尾（只省等待，不改结果）
async function ringTo(state) {
  await tp(-13.9, 2.42, -6.2, -Math.PI / 2);
  await page.waitFor(`/敲钟/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 20000, 150);
  const f0 = await gft();
  await page.tap('KeyE');
  await must(`__ev.some(x => x.n === 'tide:changing' && x.ft >= ${f0})`, 120000, 'tide:changing');
  await ev(`(() => { const t = ${S}.puzzles.tide; t.t = Math.max(t.t, t.transitionSec - 0.05); return 1; })()`);
  await must(`${S}.puzzles.tide.state === '${state}' && !${S}.puzzles.tide.transitioning && !${S}.rig.controller.busy`, 300000, 'tide ' + state);
  await waitN(30);
}
await step(T, '推浮台起动 / 缓入（逐固定步 pushT）', async () => {
  await ringTo('low');
  await ev(`(() => { const s = __s1, it = s.puzzles.raftPush, o = s.fixedUpdate; window.__pt = null; s.fixedUpdate = (dt) => { o(dt); if (window.__pt) window.__pt.push({ n: window.__n, t: it.pushT, ph: s.interaction.pushPhase ?? null }); }; window.__len = it.track.from.distanceTo(it.track.to); window.__spd = it.track.speed ?? null; return 1; })()`);
  await tp(11.3, 0.12, 10.5, -Math.PI / 2);
  await page.waitFor(`/推/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 20000, 100);
  await ev(`(window.__pt = [], 1)`);
  await page.keyDown('KeyE'); await waitN(150); await page.keyUp('KeyE'); await waitN(30);
  const pt = await ev(`(() => { const r = window.__pt; window.__pt = null; return r; })()`);
  const len = await ev('window.__len');
  const kd = (await ev('window.__kd')).filter((k) => k.code === 'KeyE').at(-1).n;
  const startFirst = pt.find((q) => q.ph === 'start' || q.ph === 'loop');
  const v = pt.map((q, i) => ({ n: q.n, v: i ? (q.t - pt[i - 1].t) * len * 60 : 0, ph: q.ph }));
  const i0 = v.findIndex((q) => q.v > 1e-6);
  const mv = v.slice(i0);
  const vmax = Math.max(...mv.map((q) => q.v));
  const iFull = mv.findIndex((q) => q.v >= vmax - 1e-4);
  const dvs = mv.slice(1, iFull + 1).map((q, i) => q.v - mv[i].v);
  const r = { len: +len.toFixed(3), kd, phaseStartN: startFirst?.n ?? null, approachTicks: startFirst ? startFirst.n - kd : null,
    firstMoveFromPhaseStartSec: startFirst ? +((v[i0].n - startFirst.n + 1) / 60).toFixed(3) : null, firstMoveFromKeySec: +((v[i0].n - kd) / 60).toFixed(3),
    v1: +mv[0].v.toFixed(4), vmax: +vmax.toFixed(4), rampTicks: iFull + 1, rampSec: +((iFull + 1) / 60).toFixed(3), maxDv: +Math.max(...dvs).toFixed(4), monotonic: dvs.every((d) => d >= -1e-6), first20: mv.slice(0, 20).map((q) => +q.v.toFixed(3)) };
  rec(T, '推浮台起动 / 缓入', 'INFO', r);
});
save(T); await done();
