// batch8 S3 art=1：敲钟 / 阀门 / 楼梯 / 原地转身计时；S3 淋湿；拉杆与纸条距离
import { s3, sleep, SH } from './b8s3.mjs';
const T = 'b8-017-S3';
const S = await s3(5411, 'art=1');
const { page, ev, must, rec, step, done, waitSec, tpL, prompt } = S;
await ev(`window.addEventListener('keydown', (e) => { if (!e.repeat) (window.__kd ??= []).push({ code: e.code, n: window.__n ?? -1 }); }, true); window.addEventListener('keyup', (e) => (window.__ku ??= []).push({ code: e.code, n: window.__n ?? -1 }), true); 1`);
await ev(`(() => { const s = __s3; window.__n = 0; window.__smp = null; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; if (window.__smp) { const a = s.rig.animator, b = s.rig.body.body, ix = s.interaction, act = ix.action; const sl = (n) => { const x = a?.slots?.get(n); return x ? [+x.w.toFixed(3), +x.action.timeScale.toFixed(3)] : null; };
  window.__smp.push({ n: window.__n, pose: a?.posing ?? null, st: a?.state, busy: s.rig.controller.locked, locked: s.rig.controller.locked, v: +(a?.speed ?? 0).toFixed(3), vy: +(a?.vy ?? 0).toFixed(3), y: +b.position.y.toFixed(3), su: sl('xi-stairs-up'), sd: sl('xi-stairs-down'), act: act?.kind ?? null, at: act?.t != null ? +act.t.toFixed(3) : null, tide: s.puzzles.tide?.state ?? s.tides?.primary?.state, tr: s.tides?.primary?.transitioning ?? null, valve: s.puzzles.state.valveOpen, face: +s.rig.controller.facing.toFixed(4), turning: a?.turning ?? null }); } }; return 1; })()`);
const smpOn = () => ev(`(window.__smp = [], 1)`);
const smpOff = () => ev(`(() => { const r = window.__smp; window.__smp = null; return r; })()`);
const N = () => ev('window.__n');
const waitN = async (k) => { const n0 = await N(); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const aimIt = async (id, tries = 8) => { for (let i = 0; i < tries; i++) { await ev(`(() => { const s = __s3, c = s.camera, it = s.interaction.get('${id}'); const f = c.position.clone(); it.focus(f); const p = c.getWorldPosition(c.position.clone()); const t = f.sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${i % 3 === 2 ? 0.05 : 0}; s.cameraFollow.pitch = ${i % 2 ? -1 : 1} * Math.asin(t.y); return 1; })()`); await waitN(15); if ((await ev(`__s3.interaction.current?.id ?? null`)) === id) return true; } return false; };
const lastKd = async (code) => (await ev('window.__kd')).filter((k) => k.code === code).at(-1)?.n;
const lastKu = async (code) => (await ev('window.__ku')).filter((k) => k.code === code).at(-1)?.n;

if (false) await step(T, '拉杆与纸条距离（art=1 世界坐标）', async () => {
  const r = await ev(`(() => { const s = __s3, V = s.rig.body.position.constructor; const g = (n) => { const o = s.scene.getObjectByName(n); if (!o) return null; const q = o.getWorldPosition(new V()); return [q.x, q.y, q.z]; };
    const lever = g('ignite-lever-s3'), grip = g('ignite-lever-s3-grip'), note = g('ignition-note-s3'), stand = g('ignite-lever-s3-interact'); const d = (a, b) => a && b ? +Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]).toFixed(3) : null; const dh = (a, b) => a && b ? +Math.hypot(a[0]-b[0], a[2]-b[2]).toFixed(3) : null;
    const artNodes = []; s.scene.traverse((o) => { if (/lever|note/i.test(o.name) && artNodes.length < 20) { const q = o.getWorldPosition(new V()); artNodes.push([o.name, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)]); } });
    return { lever_note: d(lever, note), grip_note: d(grip, note), stand_note_h: dh(stand, note), artNodes }; })()`);
  rec(T, '拉杆 ≥1.5 m 离纸条', r.lever_note >= 1.5 && r.grip_note >= 1.5 ? 'PASS' : 'FAIL', r);
});

await step(T, '敲钟：xi-ring-bell 第 30 帧（+1.0 s）响钟', async () => {
  await tpL(-3.451, 2.42, -4.469, -2.758, -5.162); await waitN(30);
  const aimed = await aimIt('tide-bell-s3'); const pr = await prompt();
  await smpOn(); const f0 = await ev('__game.time.fixedTick');
  await page.tap('KeyE');
  await must(`__ev.some(x => x.n === 'tide:changing' && x.ft >= ${f0})`, 300000, 'tide changing');
  await must(`!__s3.rig.controller.locked`, 300000, 'bell end');
  await waitN(10);
  const smp = await smpOff(); const k = await lastKd('KeyE');
  // 钟响 = tide:changing / interact:used；用采样里 tr 由 false 变 true 的步
  const p0 = smp.find((q) => q.pose === 'xi-ring-bell'); const ring = smp.find((q) => q.tr === true);
  const pose = smp.filter((q) => q.pose === 'xi-ring-bell').length;
  const r = { aimed, prompt: pr, poseStartAfterE: p0 ? p0.n - k : null, ringAfterPose: p0 && ring ? ring.n - p0.n : null, poseTicks: pose, busyTicks: smp.filter((q) => q.busy).length };
  rec(T, '敲钟：动作开始后第 30 帧（60 步 = 1.0 s）钟响 / 开始退潮', r.ringAfterPose !== null && Math.abs(r.ringAfterPose - 60) <= 2 ? 'PASS' : 'FAIL', r);
  await ev(`(() => { const t = __s3.tides.primary; t.t = Math.max(t.t, t.transitionSec - 0.05); return 1; })()`);
  await must(`!__s3.tides.primary.transitioning`, 300000, 'low');
});

await step(T, '阀门：按住 E，前 0.533 s 握住、2.0 s 转、松手段 0.467 s', async () => {
  await ev(`(__s3.game.events.emit('interact:used', { id: 'door-s3', kind: 'use' }), 1)`); await waitN(60);
  await tpL(0.855, 0.22, 2.349, 0.992, 2.725); await waitN(30);
  const aimed = await aimIt('oil-valve-s3'); const pr = await prompt();
  await smpOn();
  await page.keyDown('KeyE');
  await must(`__s3.puzzles.state.valveOpen`, 600000, 'valve');
  await page.keyUp('KeyE');
  await must(`!__s3.rig.controller.locked`, 300000, 'valve end');
  await waitN(10);
  const smp = await smpOff(); const k = await lastKd('KeyE');
  const p0 = smp.find((q) => q.pose === 'xi-valve-hold'); const hold = smp.filter((q) => q.act === 'hold');
  const ringStart = hold.find((q) => q.at > 0.5334); const open = smp.find((q) => q.valve);
  const relPose = open ? smp.filter((q) => q.n >= open.n && q.pose === 'xi-valve-hold').length : null;
  const relBusy = open ? smp.filter((q) => q.n >= open.n && q.busy).length : null; const relAct = open ? smp.filter((q) => q.n > open.n && q.act === 'anim').length : null;
  const r = { aimed, prompt: pr, poseStartAfterE: p0 ? p0.n - k : null, holdTicks: hold.length, ringTurnStartAfterPose: p0 && ringStart ? ringStart.n - p0.n : null, openAfterPose: p0 && open ? open.n - p0.n : null, releasePoseTicks: relPose, releaseAnimTicks: relAct, releaseBusyTicks: relBusy };
  rec(T, '阀门：握住段 32 步（0.533 s）+ 转 120 步（2.0 s）→ 开；松手段 28 步（0.467 s）锁定', r.openAfterPose !== null && Math.abs(r.openAfterPose - 152) <= 2 && Math.abs(r.releasePoseTicks - 28) <= 2 ? 'PASS' : 'FAIL', r);
});

if (false) await step(T, '楼梯：stairs-up / down，播放率 = 水平速度 / 0.7091', async () => {
  await tpL(-2.12, 0.22, 1.325, -2.6, 0.2); await waitN(30);
  const steer = (dir) => `(() => { const s = __s3, p = s.frame.worldToLocal(s.rig.body.position.clone()); const th = Math.atan2(p.z, p.x), r = Math.hypot(p.x, p.z); const err = 2.5 - r; const lx = ${dir} * -Math.sin(th) + 0.9 * err * Math.cos(th), lz = ${dir} * Math.cos(th) + 0.9 * err * Math.sin(th); const o = s.frame.localToWorld(p.clone().set(0,0,0)), w = s.frame.localToWorld(p.clone().set(lx, 0, lz)).sub(o); s.cameraFollow.yaw = Math.atan2(-w.x, -w.z); return +p.y.toFixed(2); })()`;
  const walk = async (dir, ticks) => { await page.keyDown('KeyW'); const n0 = await N(); while ((await N()) - n0 < ticks) { await ev(steer(dir)); await sleep(150); } await page.keyUp('KeyW'); await waitN(30); };
  await smpOn(); await walk(1, 420); const up = await smpOff();
  await smpOn(); await walk(-1, 300); const dn = await smpOff();
  const an = (rows, slot) => { const on = rows.filter((q) => q.st === slot && q.v > 0.3); const rate = on.map((q) => { const s = slot === 'stairs-up' ? q.su : q.sd; return s ? Math.abs(s[1] - q.v / 0.7091) : null; }).filter((x) => x !== null); return { ticks: on.length, states: [...new Set(rows.map((q) => q.st))], vMean: on.length ? +(on.reduce((a, q) => a + q.v, 0) / on.length).toFixed(3) : null, vyMean: on.length ? +(on.reduce((a, q) => a + q.vy, 0) / on.length).toFixed(3) : null, maxRateErr: rate.length ? +Math.max(...rate).toFixed(4) : null, y: [rows[0]?.y, rows.at(-1)?.y] }; };
  const r = { up: an(up, 'stairs-up'), down: an(dn, 'stairs-down') };
  await page.screenshot(`${SH}/s3-stairs-art1.png`);
  rec(T, '楼梯：上楼 stairs-up / 下楼 stairs-down，播放率 = h/0.7091', r.up.ticks > 60 && r.down.ticks > 60 && r.up.maxRateErr < 0.05 && r.down.maxRateErr < 0.05 ? 'PASS' : 'FAIL', r);
});

if (false) await step(T, '原地转身（API：无玩法调用点）', async () => {
  await tpL(-1.0, 0.22, -1.0, 0, -2); await waitN(30);
  await smpOn(); const f0 = await ev(`(__s3.rig.animator.turnInPlace('l').then(() => window.__turnDone = window.__n), window.__n)`);
  await must(`window.__turnDone != null`, 300000, 'turn'); await waitN(10);
  const smp = await smpOff(); const f = smp.map((q) => q.face); const face0 = f[0];
  const jump = smp.find((q, i) => i && Math.abs(q.face - smp[i - 1].face) > 0.5);
  const r = { startN: f0, doneAfter: (await ev('window.__turnDone')) - f0, facingJumpAfter: jump ? jump.n - f0 : null, dFacingDeg: +(((smp.at(-1).face - face0) * 180 / Math.PI)).toFixed(1), lockedTicks: smp.filter((q) => q.locked).length, states: [...new Set(smp.map((q) => q.st))] };
  rec(T, '原地转身 90°：第 34 帧（68 步）朝向 +90°、第 40 帧（80 步）结束、期间锁定', r.facingJumpAfter !== null && Math.abs(r.facingJumpAfter - 68) <= 2 && Math.abs(r.doneAfter - 80) <= 2 && Math.abs(Math.abs(r.dFacingDeg) - 90) < 1 ? 'PASS' : 'FAIL', r);
});

const wet = () => ev(`({ w: __s3.rig.look?.look.wetness ?? null, tgt: __s3.rig.look?.wetTarget ?? null, rain: !!__s3.rain?.visible, el: __game.time.elapsed })`);
if (false) await step(T, '淋湿：S3 塔内 / 塔外', async () => {
  const one = async (label, x, y, z, w0, sec) => { await tpL(x, y, z, 0, 0); await waitN(20); await ev(`(__s3.rig.look.look.wetness = ${w0}, 1)`); const a = await wet(); await waitN(sec * 60); const b = await wet(); return { label, rain: a.rain, target: b.tgt, w0, w1: +b.w.toFixed(4), slope: +((b.w - a.w) / (b.el - a.el)).toFixed(5) }; };
  const r = [await one('塔内底层', -1.0, 0.22, -1.0, 0.5, 8), await one('塔内 10 m', -1.915, 10.05, 1.607, 0.5, 6), await one('塔外平台', -3.451, 2.42, -4.469, 0, 8)];
  const ok = r[0].target === 0 && r[1].target === 0 && r[0].slope < 0 && Math.abs(r[0].slope + 1 / 150) < 0.001 && (r[2].rain ? Math.abs(r[2].slope - 1 / 40) < 0.003 : true);
  rec(T, '淋湿：S3 塔内不湿（只变干 1/150）、塔外有雨按 1/40 变湿', ok ? 'PASS' : 'FAIL', r);
});
rec(T, 'errors', page.errors.length ? 'FAIL' : 'PASS', page.errors.slice(0, 10));
S.save('t8-s3art2');
await done(); process.exit(0);
