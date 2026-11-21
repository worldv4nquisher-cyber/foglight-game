// batch8 S1：退潮深水区送回 / 船绳开关缺节点 / 推浮台 start-loop-end / 四个跨越落点 / 017 走跑混合与滑步（art=1）
import { open, sleep, SH } from './b8lib.mjs';
import { EVLOG } from './b8s3.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5407);
const T = 'b8-S1';
await page.addInit(EVLOG);
await page.addInit(`window.addEventListener('keydown', (e) => { if (!e.repeat) (window.__kd ??= []).push({ code: e.code, n: window.__n ?? -1 }); }, true); window.addEventListener('keyup', (e) => (window.__ku ??= []).push({ code: e.code, n: window.__n ?? -1 }), true);`);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
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
async function walkTo(tx, tz, { maxTicks = 1200, run = false, stopIf = 'false' } = {}) {
  if (run) await page.keyDown('ShiftLeft');
  await page.keyDown('KeyW');
  const n0 = await N(); let r = null;
  try {
    for (;;) {
      const s = await st();
      if (await ev(stopIf)) { r = 'stop'; break; }
      if (Math.hypot(tx - s.pos[0], tz - s.pos[2]) < 0.3) { r = 'reached'; break; }
      if (s.n - n0 > maxTicks) { r = 'timeout'; break; }
      await ev(`(() => { const s = ${S}; s.cameraFollow.yaw = Math.atan2(-(${tx} - s.rig.body.position.x), -(${tz} - s.rig.body.position.z)); return 1; })()`);
      await sleep(120);
    }
  } finally { await page.keyUp('KeyW'); if (run) await page.keyUp('ShiftLeft'); }
  return r;
}
const inPoly = (x, z) => { const P = [[-19.6, -18.1], [-19.6, -11.25], [-10.5, -11.25], [-10.5, -10], [-10, -8.95], [12.5, -8.95], [13, -10.75], [13.5, -12.5], [14, -14.25], [14.5, -16.25], [15, -17.75], [15.2, -18.1]]; let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

// ---------- 017 走跑混合 / 滑步（码头甲板，真按键）
if (false) await step(T, '017 走跑按速度混合 + 起停滑步', async () => {
  await tp(2.0, 2.25, -11.7, Math.atan2(-9 - 2, -7.85 + 11.7));
  await waitN(30);
  await smpOn();
  await page.keyDown('KeyW'); await waitN(150); await page.keyUp('KeyW'); await waitN(90);
  await page.keyDown('ShiftLeft'); await page.keyDown('KeyW'); await waitN(150); await page.keyUp('KeyW'); await page.keyUp('ShiftLeft'); await waitN(90);
  const smp = await smpOff();
  const kd = await ev('window.__kd'), ku = await ev('window.__ku');
  // 有效脚速 = Σ(w·rate·步幅速度)/Σw（用实际槽权重，含淡入淡出滞后）
  const rows = smp.map((r) => { const wi = r.idle?.[0] ?? 0, ww = r.walk?.[0] ?? 0, wj = r.jog?.[0] ?? 0; const sum = wi + ww + wj; const foot = sum > 0 ? (ww * (r.walk?.[1] ?? 0) * 1.6 + wj * (r.jog?.[1] ?? 0) * 3.2) / sum : 0; return { n: r.n, v: r.v, foot: +foot.toFixed(3), slip: +Math.abs(r.v - foot).toFixed(3), st: r.st, wi, ww, wj }; });
  const trans = rows.filter((r, i) => i > 0 && (Math.abs(r.v - rows[i - 1].v) > 0.02 || (r.v > 0.01 && r.v < 0.5) || Math.abs(r.foot - r.v) > 0.05));
  const maxSlip = Math.max(...rows.map((r) => r.slip));
  const slideDist = rows.reduce((a, r) => a + r.slip / 60, 0);
  const states = [...new Set(rows.map((r) => r.st))];
  const vWalk = rows.filter((r) => r.st === 'walk').map((r) => r.v), vJog = rows.filter((r) => r.st === 'jog').map((r) => r.v);
  const lowTicks = rows.filter((r) => r.v > 0.05 && r.v < 0.5).length;
  rec(T, '017 走跑按速度混合 + 起停滑步', maxSlip < 0.5 && states.includes('walk') && states.includes('jog') ? 'PASS' : 'FAIL',
    { states, vWalkMax: Math.max(...vWalk), vJogMax: Math.max(...vJog), maxSlip, slideDistM: +slideDist.toFixed(3), lowSpeedTicks: lowTicks, trans: trans.slice(0, 60), kd: kd.slice(-4), ku: ku.slice(-4) });
});

// ---------- 退潮深水区（c5ef9ab）
if (false) await step(T, 'c5ef9ab 退潮深水区送回', async () => {
  await ringTo('low');
  const res = {};
  // 合法滩地（区外北侧）站 3 s 不送回
  for (const [x, z] of [[6, -7.5], [0, -8.5], [-6, -7]]) {
    await tp(x, 0.6, z); const f0 = await gft(); await waitN(180);
    const s = await st();
    res[`stand ${x},${z}`] = { pos: s.pos, inPoly: inPoly(x, z), recall: (await evs('subtitle:show', f0)).map((e) => e.e?.id ?? e.e?.text) };
  }
  // 真走进深水区（小船东侧）
  await tp(8, 0.6, -7.5); await waitN(60);
  const f0 = await gft(); await smpOn();
  const r = await walkTo(8, -11.5, { maxTicks: 1500, stopIf: `${S}.rig.controller.busy` });
  await waitN(240);
  const smp = await smpOff();
  const firstIn = smp.find((q) => inPoly(q.p[0], q.p[2]));
  const busyAt = smp.find((q) => q.busy);
  const subs = (await evs('subtitle:show', f0)).map((e) => e.e?.id ?? e.e?.text ?? e.e);
  await must(`!${S}.rig.controller.busy`, 120000, '送回结束');
  const s = await st();
  res.walkIn = { r, firstIn: firstIn && { n: firstIn.n, p: firstIn.p }, busyAt: busyAt && { n: busyAt.n, p: busyAt.p }, dTicks: firstIn && busyAt ? busyAt.n - firstIn.n : null, subs, endPos: s.pos };
  // 旧船位 / 小船位：传送进去
  for (const [x, z] of [[10.2, -16.5], [5.5, -12.2]]) {
    await tp(x, 0.6, z); const g0 = await gft(); await waitN(120);
    await must(`!${S}.rig.controller.busy`, 120000, '送回结束');
    const q = await st();
    res[`tp ${x},${z}`] = { subs: (await evs('subtitle:show', g0)).map((e) => e.e?.id ?? e.e?.text), endPos: q.pos };
  }
  const ok = Object.entries(res).filter(([k]) => k.startsWith('stand')).every(([, v]) => !v.recall.length) && res.walkIn.busyAt && Math.hypot(res.walkIn.endPos[0] + 12.5, res.walkIn.endPos[2] + 4) < 0.5;
  rec(T, 'c5ef9ab 退潮深水区送回', ok ? 'PASS' : 'FAIL', res);
  await page.screenshot(`${SH}/s1-lowtide-after-recall.png`);
});

// ---------- 船绳开关缺节点
if (false) await step(T, '船绳两版开关：缺节点不坏', async () => {
  const r = await ev(`(() => { const a = __s1.art; return { loaded: a?.loaded, rope: a?.rope === null ? 'null' : typeof a?.rope, errs: (window.__qaErrs ?? []).length }; })()`);
  rec(T, '船绳两版开关：缺节点不坏', r.loaded && r.rope === 'null' ? 'PASS' : 'FAIL', { ...r, pageErrors: page.errors.length, note: 'layout boatRope.high/low 为空 → makeTideVariantSwitch 返回 null；涨退潮 art.update 用 rope?.update，见下方涨潮后错误数' });
});

// ---------- 推浮台 start / loop / end（真按住 E）
async function holdPushTicks(holdTicks) {
  await tp(11.3, 0.12, 10.5, -Math.PI / 2);
  await page.waitFor(`/推/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 20000, 100);
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
  await smpOn();
  await page.keyDown('KeyE'); await waitN(holdTicks); await page.keyUp('KeyE');
  await waitN(150);
  const smp = await smpOff();
  const kd = (await ev('window.__kd')).filter((k) => k.code === 'KeyE').at(-1), ku = (await ev('window.__ku')).filter((k) => k.code === 'KeyE').at(-1);
  return { prompt, smp, kd: kd.n, ku: ku.n };
}
await step(T, '推浮台 start/loop/end', async () => {
  await ringTo('low');
  // raft 在 home、退潮已是 low
  const st0 = await st();
  const a = await holdPushTicks(150);
  const s = a.smp;
  const firstMove = s.find((q, i) => i > 0 && q.raftX !== s[i - 1].raftX);
  const startTicks = s.filter((q) => q.ph === 'start').length; const startFirst = s.find((q) => q.ph === 'start');
  const loopFirst = s.find((q) => q.ph === 'loop');
  const vs = s.map((q, i) => (i ? Math.abs(q.raftX - s[i - 1].raftX) * 60 : 0));
  const dv = Math.max(...vs.slice(1).map((v, i) => Math.abs(v - vs[i])));
  const rel = s.filter((q) => q.n > a.ku);
  const endPose = rel.filter((q) => q.pose === 'xi-push-end');
  const endBusyTicks = rel.filter((q) => q.busy).length;
  const r = { moveFromApproachEndSec: firstMove && startFirst ? +((firstMove.n - startFirst.n + 1) / 60).toFixed(3) : null, approachTicks: startFirst ? startFirst.n - a.kd : null, prompt: a.prompt, raft0: st0.raftPos, kdN: a.kd, moveAtSec: firstMove ? +((firstMove.n - a.kd - 1) / 60).toFixed(3) : null, startPoseTicks: startTicks, loopAt: loopFirst ? +((loopFirst.n - a.kd) / 60).toFixed(3) : null, loopClip: loopFirst?.loop, maxSpeed: +Math.max(...vs).toFixed(3), maxTickSpeedJump: +dv.toFixed(3), endPoseTicks: endPose.length, endPoseSec: +(endPose.length / 60).toFixed(3), lockedAfterRelease: endBusyTicks, pushT: s.at(-1).pushT, states: [...new Set(s.map((q) => q.st))] };
  // 早松手（0.3 s，物体未动）→ 不播 push-end
  const b = await holdPushTicks(18);
  const relB = b.smp.filter((q) => q.n > b.ku);
  r.early = { moved: b.smp.some((q, i) => i && q.raftX !== b.smp[i - 1].raftX), endPose: relB.some((q) => q.pose === 'xi-push-end'), busyAfter: relB.filter((q) => q.busy).length };
  const ok = r.moveAtSec !== null && (r.moveAtSec <= 0.6 || r.moveFromApproachEndSec <= 0.6) && r.loopAt && r.endPoseTicks > 0 && !r.early.endPose && !r.early.moved && r.maxTickSpeedJump < 0.2;
  rec(T, '推浮台 start/loop/end', ok ? 'PASS' : 'FAIL', r);
});

// ---------- 四个跨越落点（真 E）
await step(T, '浮台四个跨越落点', async () => {
  await ev(`(() => { const p = ${S}.puzzles; p.raft.object.position.set(-0.9, 0.4, 10.5); p.raft.object.updateMatrixWorld(true); p.raftPush.pushT = 1; p.raftPush.locked = true; return 1; })()`);
  await ringTo('high');
  const links = await ev(`${S}.rig.controller.links.map(l => ({ s: [l.start.x, l.start.y, l.start.z].map(v => +v.toFixed(3)), e: [l.end.x, l.end.y, l.end.z].map(v => +v.toFixed(3)) }))`);
  const out = { links, hops: [] };
  const cross = async (label, x, y, z, facing) => {
    await tp(x, y, z, facing); await waitN(30);
    const ok = await page.waitFor(`(document.querySelector('.hud-prompt')?.textContent ?? '').includes('跨过去')`, 8000, 100);
    if (!ok) { out.hops.push({ label, prompt: await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`), at: (await st()).pos }); return null; }
    await smpOn(); const g0 = await gft();
    await page.tap('KeyE');
    await must(`${S}.rig.controller.busy`, 30000, 'busy'); await must(`!${S}.rig.controller.busy`, 120000, 'end');
    await waitN(60);
    const smp = await smpOff(); const s = await st();
    const tr = smp.filter((q) => q.st === 'step-across');
    const p0 = tr[0]?.p, p1 = tr.at(-1)?.p;
    const h = p0 && p1 ? +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(3) : null;
    // 根运动抵消后模型位移 = 身体位移 + rootOffset.z（局部）；记最大 |rz|
    const rec1 = { label, ticks: tr.length, sec: +(tr.length / 60).toFixed(3), hDisp: h, end: s.pos, yStableAfter1s: smp.slice(-30).every((q) => q.g), subs: (await evs('subtitle:show', g0)).map((e) => e.e?.id ?? e.e?.text), maxRootZ: Math.max(0, ...tr.map((q) => Math.abs(q.rz))), tide: s.tide };
    out.hops.push(rec1); return s.pos;
  };
  const L = links;
  // 0 岸台→浮台（+z）；3 台阶→浮台（−z）；1 浮台→岸台（−z）；2 浮台→台阶（+z）
  const e0 = await cross('0 岸台→浮台', L[0].s[0], L[0].s[1] + 0.05, L[0].s[2] - 0.1, 0);
  if (e0) await cross('2 浮台→台阶', L[2].s[0], L[2].s[1] + 0.05, L[2].s[2] - 0.1, 0);
  await page.screenshot(`${SH}/reg358-s1-step-landing-steps.png`);
  await cross('3 台阶→浮台', L[3].s[0], L[3].s[1] + 0.05, L[3].s[2] + 0.1, Math.PI);
  await cross('1 浮台→岸台', L[1].s[0], L[1].s[1] + 0.05, L[1].s[2] + 0.1, Math.PI);
  const RECT = { shore: [-4.6, 0.6, 5.6, 8.5], raft: [-1.9, 0.1, 9.0, 12.0], steps: [-2.4, 0.6, 12.5, 13.5] };
  const ed = (r, x, z) => +Math.min(x - r[0], r[1] - x, z - r[2], r[3] - z).toFixed(3);
  const TO = { '0': 'raft', '2': 'steps', '3': 'raft', '1': 'shore' };
  for (const h of out.hops) if (h.end) { h.edgeEnd = ed(RECT[TO[h.label[0]]], h.end[0], h.end[2]); h.edgeLink = ed(RECT[TO[h.label[0]]], L[+h.label[0]].e[0], L[+h.label[0]].e[2]); }
  const okHop = (h, i) => h.ticks > 0 && Math.hypot(h.end[0] - L[i].e[0], h.end[2] - L[i].e[2]) < 0.2 && Math.abs(h.end[1] - L[i].e[1]) < 0.15 && h.yStableAfter1s && !h.subs.length && h.edgeEnd >= 0.3 && h.edgeLink >= 0.3;
  const idx = { '0': 0, '2': 2, '3': 3, '1': 1 };
  const ok = out.hops.length === 4 && out.hops.every((h) => okHop(h, idx[h.label[0]]));
  rec(T, '浮台四个跨越落点', ok ? 'PASS' : 'FAIL', out);
});
await step(T, '页面错误', async () => { rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors.slice(0, 10)); });
save('t8-reg-s1');
await done();
process.exit(0);
