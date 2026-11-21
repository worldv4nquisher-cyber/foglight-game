import { REPO_ROOT } from './paths.mjs';
import './b10env.mjs';
// batch8 ②：谜题 5 E 点灯（逐固定步插桩：包一层 puzzles.fixedUpdate，在指定 tick 断光 / 复光，逐步记录状态）
import { s3, sleep } from './b8s3.mjs';
const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch10');
const T = 'b10-p5';
const S = await s3(5435, process.env.Q || 'art=0');
const { page, ev, must, rec, step, done, ft, waitSec, evs, tpL, prompt } = S;
const P = `__s3.puzzles`;
await ev(`(() => { const p = __s3.puzzles, b = p.beam, orig = p.fixedUpdate; window.__sch = []; window.__tl = []; let last = '';
  window.__brk = (on) => { b.mirrors.b.part.setAngle(0, on ? 315 : 300); b.tracer.trace(); };
  window.__tk = 0; window.__ek = [];
  for (const n of ['receiver:ready','receiver:lost','ignition:reminder','interact:used','lighthouse:ignited','subtitle:show','subtitle:hide','sfx:play']) __game.events.on(n, (e) => window.__ek.push({ n, id: e?.id ?? null, tk: window.__tk }));
  window.addEventListener('keydown', (e) => { if (!e.repeat) window.__ek.push({ n: 'key', id: e.code, tk: window.__tk }); }, true);
  window.__at = (dt, fn) => { window.__sch.push({ at: window.__tk + dt, fn }); return window.__tk + dt; };
  p.fixedUpdate = (dt) => { const t = ++window.__tk; for (const s of window.__sch.splice(0)) { if (s.at <= t) s.fn(); else window.__sch.push(s); }
    orig(dt);
    const ig = b.igniter, c = __game.ui.subtitles.current, lm = b.igniterLens.material;
    const row = { t, st: ig.state, hit: ig.hit, sub: c ? c.id : null, pulse: +ig.reminderPulse.toFixed(2), ign: p.state.ignited, igniting: p.state.igniting, lever: p.leverIx.enabled, ctx: __game.input.context, pose: __s3.rig.animator?.posing ?? null, ang: +(p.leverSwing.rotation.x * 180 / Math.PI).toFixed(1), lamp: p.lamp.on };
    const k = JSON.stringify({ ...row, t: 0, pulse: row.pulse > 0, ang: Math.round(row.ang / 10) });
    if (k !== last) { last = k; window.__tl.push({ ...row, em: lm.emissive?.getHexString?.(), ei: +(lm.emissiveIntensity ?? 0).toFixed(2) }); } };
  return 1; })()`);
const tl = (f0) => ev(`__tl.filter(r => r.t >= ${f0})`);
const tick = () => ev('window.__tk');
const waitTick = (t) => must(`window.__tk >= ${t}`, 900000, 'tick ' + t);
const evk = (n, k0 = 0) => ev(`__ek.filter(x => x.n === '${n}' && x.tk >= ${k0}).map(x => ({ e: { id: x.id }, ft: x.tk }))`);
const igSt = () => ev(`${P}.beam.igniter.state`);
// 前置（已在 t8-s3a 真按键测过）：敲钟 / 开门 / 开阀走事件，光路 solve
await ev(`(() => { const e = __s3.game.events; e.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }); __s3.tides.fixedUpdate(7); e.emit('interact:used', { id: 'door-s3', kind: 'use' }); e.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }); return 1; })()`);
await waitSec(0.5);
// 站到拉杆站位、面向拉杆
await ev(`(() => { const s = __s3, ix = s.puzzles.leverIx, sp = ix.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.03)); s.rig.controller.facing = sp.facing; s.cameraFollow.yaw = sp.facing + Math.PI; s.cameraFollow.pitch = -0.2; return 1; })()`);
await waitSec(1);

await step(T, '1.0 s 连续受光 → 可点灯', async () => {
  const t1 = await ev(`__at(1, () => { __s3.puzzles.beam.solve(); __s3.puzzles.beam.tracer.trace(); })`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 'ready');
  const rd = (await evk('receiver:ready', t1 - 1)).filter(x => x.e.id === 'ignition-port-s3');
  const dt = rd[0] ? rd[0].ft - t1 : null;
  rec(T, '开阀 + 连续受光 1.0 s → ready（receiver:ready 一次；dTicks 59 = 第 60 个受光步）', dt !== null && (dt === 59 || dt === 60) && rd.length === 1 ? 'PASS' : 'FAIL', { solveTick: t1, readyTicks: rd.map(x => x.ft), dTicks: dt, readyCount: await ev(`${P}.state.readyCount`) });
});
await step(T, '可点灯：冷白、无暖色、提示 E 点灯', async () => {
  await waitSec(0.5);
  const r = await ev(`(() => { const s = __s3, p = s.puzzles, b = p.beam; let warm = []; s.scene.traverse(o => { if ((o.isPointLight || o.isSpotLight) && o.visible && o.intensity > 0 && o.color.r > o.color.b + 0.1) warm.push(o.name);
    if (o.isMesh && o.visible) for (const m of [].concat(o.material)) if (m?.emissive && m.emissiveIntensity > 0 && m.emissive.r > m.emissive.b + 0.1) warm.push('emis:' + o.name + ':' + m.emissive.getHexString());
    if ((o.isMesh || o.isLine) && o.visible && /beam/i.test(o.name)) for (const m of [].concat(o.material)) if (m?.color && m.color.r > m.color.b + 0.1) warm.push('beam:' + o.name + ':' + m.color.getHexString()); });
    const lm = b.igniterLens.material; return { warm, skyColor: b.sky.color, lens: { em: lm.emissive.getHexString(), ei: lm.emissiveIntensity }, lamp: p.lamp.on, ign: p.state.ignited, lever: p.leverIx.enabled }; })()`);
  const pr = await prompt();
  await page.screenshot(`${SH}/s3-p5-ready-lever.png`);
  rec(T, '可点灯状态冷白（点火口 / 光束无暖色、灯未亮）', !r.warm.length && r.skyColor === 'coldWhite' && !r.lamp && !r.ign ? 'PASS' : 'FAIL', r);
  const sweep = await (async () => { const out = []; const base = await ev(`({ yaw: __s3.cameraFollow.yaw, pitch: __s3.cameraFollow.pitch, facing: __s3.rig.controller.facing })`);
    for (const dy of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) for (const pt of [-0.5, -0.25, 0]) { await ev(`(__s3.cameraFollow.yaw = ${base.yaw + dy}, __s3.cameraFollow.pitch = ${pt}, 1)`); await waitSec(0.15); out.push([dy, pt, await ev(`__s3.interaction.current?.id ?? null`)]); }
    await ev(`(__s3.cameraFollow.yaw = ${base.yaw}, __s3.cameraFollow.pitch = ${base.pitch}, 1)`); await waitSec(0.2); return { base, out }; })();
  const curAt = await ev(`({ cur: __s3.interaction.current?.id ?? null, pos: (() => { const p = __s3.frame.worldToLocal(__s3.rig.body.position.clone()); return [p.x, p.y, p.z].map(v => +v.toFixed(2)); })() })`);
  rec(T, '拉杆站位：镜头扫一圈（yaw ±0.6 rad、pitch 0…−0.5）各点当前交互物', 'INFO', { curAt, lever: sweep.out.filter(x => x[2] === 'ignite-lever-s3').length, lens: sweep.out.filter(x => x[2] === 'lens-s3').length, other: sweep.out.filter(x => x[2] !== 'ignite-lever-s3' && x[2] !== 'lens-s3'), grid: sweep.out });
  rec(T, '拉杆前提示「E 点灯」（不是 E 操作）', /点灯/.test(pr ?? '') && !/操作/.test(pr ?? '') ? 'PASS' : 'FAIL', { prompt: pr, cur: curAt.cur });
});
await step(T, '断光容差', async () => {
  const lost0 = (await evk('receiver:lost')).length; const rc0 = await ev(`${P}.state.readyCount`);
  const out = {};
  for (const gap of [15, 18, 19]) {
    const l0 = (await evk('receiver:lost')).length;
    const tb = await ev(`(__at(2, () => __brk(true)), __at(${2 + gap}, () => __brk(false)))`);
    await waitTick(tb + 10);
    const rows = await tl(tb - gap - 1);
    out[gap] = { minState: [...new Set(rows.map(r => r.st))], lost: (await evk('receiver:lost')).length - l0, rc: (await ev(`${P}.state.readyCount`)) - rc0 };
  }
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 're-ready after gap19');
  rec(T, '可点灯中断光 15 / 18 步（0.25 / 0.30 s）→ 保持 ready、不发 lost；19 步 → 退出（lost 1 次）', out[15].lost === 0 && out[18].lost === 0 && out[19].lost === 1 && !out[15].minState.includes('idle') && !out[18].minState.includes('idle') && out[18].rc === 0 ? 'PASS' : 'FAIL', out);
  const tb = await ev(`__at(2, () => __brk(true))`);
  await waitTick(tb + 19 + 3);
  const rows = await tl(tb);
  const exitRow = rows.find(r => r.st !== 'ready');
  const lostEv = (await evk('receiver:lost', tb)).map(x => x.ft);
  const pr = await prompt();
  const tr = await ev(`__at(2, () => __brk(false))`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 're-ready');
  const rd = (await evk('receiver:ready', tr)).map(x => x.ft);
  rec(T, '断光 > 0.3 s 退出（第 19 步 = 0.317 s）、提示消失；复光后再连续 1.0 s 才 ready', exitRow && exitRow.t - tb + 1 === 19 && lostEv.length === 1 && !/点灯/.test(pr ?? '') && (rd[0] - tr === 59 || rd[0] - tr === 60) ? 'PASS' : 'FAIL', { breakTick: tb, missTicksAtExit: exitRow ? exitRow.t - tb + 1 : null, lostAtMiss: lostEv.map(t => t - tb + 1), promptAfterExit: pr, restoreTick: tr, readyAfterTicks: rd.map(t => t - tr) });
  // 累计阶段断光 0.2 s：进度不清零（也不增加）
  const tb2 = await ev(`__at(2, () => __brk(true))`); await waitTick(tb2 + 30);
  const ta = await ev(`(__at(2, () => __brk(false)), __at(32, () => __brk(true)), __at(44, () => __brk(false)))`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 'ready2');
  const r0 = ta - 42; const rd2 = (await evk('receiver:ready', r0)).map(x => x.ft);
  rec(T, '累计受光阶段断光 0.2 s 不清零（受光 0.5 s + 断 0.2 s + 受光 0.5 s → ready）', rd2.length && rd2[0] - r0 === 71 ? 'PASS' : 'FAIL', { restoreTick: r0, readyAfterTicks: rd2.map(t => t - r0), note: '断光期暂停计时 = 71；断光也计时 = 59；清零 = 101' });
});
await step(T, '状态外按 E 无反应（真实按键）', async () => {
  const tb = await ev(`__at(2, () => __brk(true))`);
  await waitTick(tb + 30);
  const f0 = await tick(); const s0 = await igSt();
  await page.keyDown('KeyE'); await sleep(300); await page.keyUp('KeyE'); await waitSec(0.5);
  const used = (await evk('interact:used', f0)).map(x => x.e.id);
  const r = await ev(`({ igniting: ${P}.state.igniting, ign: ${P}.state.ignited, ctx: __game.input.context })`);
  rec(T, '断光 > 0.3 s 后按 E：无反应', s0 !== 'ready' && !used.includes('ignite-lever-s3') && !r.igniting ? 'PASS' : 'FAIL', { stateAtE: s0, used, ...r });
  const tr = await ev(`__at(2, () => __brk(false))`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 're-ready');
});
await step(T, '20 s 提醒', async () => {
  const rd = (await evk('receiver:ready')).filter(x => x.e.id === 'ignition-port-s3').pop().ft;
  await waitTick(rd + 1200 + 70);
  const rem = (await evk('ignition:reminder', rd)).map(x => x.ft - rd);
  const rows = await tl(rd);
  const pulse = rows.filter(r => r.pulse > 0); const pulseSpan = pulse.length ? [pulse[0].t - rd, pulse[pulse.length - 1].t - rd] : null;
  const maxEi = Math.max(...rows.map(r => r.ei)); const baseEi = rows.find(r => r.st === 'ready')?.ei;
  const sfx = (await evk('sfx:play', rd)).map(x => x.e.id).filter(i => /ignite/.test(i));
  const st = await ev(`({ ig: ${P}.beam.igniter.state, lit: ${P}.state.ignited, lamp: ${P}.lamp.on })`);
  rec(T, '可点灯 20 s 未按 E：ignition:reminder 一次（第 1200 步）、不自动点灯', rem.length === 1 && Math.abs(rem[0] - 1199) <= 1 && st.ig === 'ready' && !st.lit ? 'PASS' : 'FAIL', { reminderAfterTicks: rem, pulseTicks: pulseSpan, lensEi: { base: baseEi, max: maxEi }, sfx, st });
  await waitTick(rd + 1200 + 25 * 60);
  const rem2 = (await evk('ignition:reminder', rd)).length;
  rec(T, '之后 25 s 不再重复脉冲', rem2 === 1 ? 'PASS' : 'FAIL', { reminders: rem2 });
});
await step(T, '提示：可点灯 H / 退出后', async () => {
  await ev(`__s3.hints.debugSetTime('p5', 700), 1`); await waitSec(0.2);
  await page.keyDown('KeyH'); await sleep(200); await page.keyUp('KeyH'); await waitSec(0.5);
  const a = await ev(`(() => { const v = __s3.hints.view(); return { step: v.step, ids: v.lines.map(l => l.textId), hl: [...__s3.hints.highlightIds()] }; })()`);
  await page.keyDown('KeyH'); await sleep(200); await page.keyUp('KeyH'); await waitSec(0.3);
  const tb = await ev(`__at(2, () => __brk(true))`); await waitTick(tb + 30);
  const b = await ev(`(() => { const v = __s3.hints.view(); return { step: v.step, ids: v.lines.map(l => l.textId), hl: [...__s3.hints.highlightIds()] }; })()`);
  rec(T, '可点灯 H 只显示 ch1.hint.p5.ignite.l3；退出后回到步骤提示', a.ids.join() === 'ch1.hint.p5.ignite.l3' && !a.hl.length && b.step !== 'override' ? 'PASS' : 'FAIL', { ready: a, afterExit: b });
  const tr = await ev(`__at(2, () => __brk(false))`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 're-ready');
});
await step(T, '容差内按 E（真实按键）→ 点灯演出', async () => {
  await ev(`(() => { window.__lit = []; __game.events.on('lighthouse:ignited', () => window.__lit.push(window.__tk)); return 1; })()`);
  // 先走开一点（测走位），再回头
  await ev(`(() => { const s = __s3, sp = s.puzzles.leverIx.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().set(sp.position.x + 0.5 * Math.sin(sp.facing + 2.4), sp.position.y + 0.03, sp.position.z + 0.5 * Math.cos(sp.facing + 2.4))); s.rig.controller.facing = sp.facing + 0.4; s.cameraFollow.yaw = sp.facing + 0.4 + Math.PI; return 1; })()`);
  await waitSec(0.6);
  const pr0 = await prompt();
  const tb = await ev(`__at(1, () => __brk(true))`);
  await waitTick(tb + 3);
  await page.keyDown('KeyE'); await sleep(150); await page.keyUp('KeyE');
  // 演出中狂按 E
  for (let i = 0; i < 4; i++) { await sleep(400); await page.tap('KeyE'); }
  await must(`${P}.state.ignited`, 600000, 'ignited');
  const used = (await evk('interact:used', tb)).filter(x => x.e.id === 'ignite-lever-s3').map(x => x.ft);
  await waitSec(1);
  await must(`${P}.outroTime >= 3.7 || __game.scenes.current !== __s3`, 900000, 'outro');
  const rows = await tl(tb);
  const lit = await ev(`window.__lit`);
  const ign = lit[0];
  const eRow = used[0];
  const kE = (await ev(`__ek.filter(x => x.n === 'key' && x.id === 'KeyE' && x.tk >= ${tb})`))[0]?.tk;
  const missAtE = (kE ?? eRow) - tb;
  const firstPose = rows.find(r => r.pose === 'xi-ignite-lever');
  const walkEnd = rows.find(r => r.t > eRow && (r.pose || Math.abs(r.ang) > 0.05));
  const mono = rows.filter(r => r.sub === 'ch1.s3.ignite.mono');
  const monoSpan = mono.length ? [mono[0].t - ign, null] : null;
  const after = rows.filter(r => r.t > (mono[0]?.t ?? 1e9));
  const monoEnd = after.find(r => r.sub !== 'ch1.s3.ignite.mono');
  if (monoSpan) monoSpan[1] = monoEnd ? monoEnd.t - ign : 'open';
  const ctxs = [...new Set(rows.filter(r => r.t >= eRow && r.t <= ign).map(r => r.ctx))];
  const angAtIgn = rows.filter(r => r.t <= ign).pop()?.ang;
  const subsShown = (await evk('subtitle:show', ign)).map(x => x.e.id ?? x.e);
  rec(T, '容差内（断光后第 ' + missAtE + ' 步）真实按 E 生效、锁输入（cutscene）', used.length >= 1 && missAtE + 1 <= 18 && ctxs.every(c => c === 'cutscene') ? 'PASS' : 'FAIL', { promptBefore: pr0, breakTick: tb, eTick: eRow, missTicks: missAtE, usedTicks: used, ctxs });
  rec(T, 'lighthouse:ignited 只一次，在拉杆动作第 34 帧（动作开始 +1.133 s）', lit.length === 1 && (firstPose ? Math.abs(ign - firstPose.t - 68) <= 2 : true) ? 'PASS' : 'FAIL', { litTicks: lit, eToIgnTicks: ign - eRow, poseStartTick: firstPose?.t ?? null, poseToIgn: firstPose ? ign - firstPose.t : null, walkOrLeverMoveStart: walkEnd ? walkEnd.t - eRow : null, leverAngAtIgn: angAtIgn, note: 'art=0 无 animator 时 pose 为空' });
  rec(T, '点灯独白 ch1.s3.ignite.mono：点燃后 0.5 s 出现、持续 3.0 s、只一次', monoSpan && Math.abs(monoSpan[0] - 30) <= 1 && Math.abs(monoSpan[1] - monoSpan[0] - 180) <= 2 && subsShown.filter(i => i === 'ch1.s3.ignite.mono').length <= 1 ? 'PASS' : 'FAIL', { monoTicksRelIgn: monoSpan, subsShown });
  const warmAfter = await ev(`({ sky: __s3.puzzles.beam.sky.color, lamp: __s3.puzzles.lamp.on })`).catch(() => null);
  rec(T, '点燃后才转暖（光束 warm、灯亮）', warmAfter?.sky === 'warm' && warmAfter.lamp ? 'PASS' : 'FAIL', warmAfter);
  await page.screenshot(`${SH}/s3-p5-ignited.png`);
  await must(`__game.scenes.current !== __s3`, 900000, 'chapter end');
  rec(T, '0:04 后进章节结束', 'PASS', { scene: await ev(`__game.scenes.current?.name ?? null`) });
});
rec(T, 'errors', 'INFO', page.errors);
S.save('t10-p5-' + (process.env.Q || 'art=0'));
await done(); console.log('DONE'); process.exit(0);
