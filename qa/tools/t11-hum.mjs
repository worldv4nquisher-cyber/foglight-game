// batch11 S3 art=1：可点灯嗡鸣循环（ready 淡入 / 断光 ≤0.3 s 不断 / >0.3 s 淡出 / 点燃淡出 / Esc 挂起）+ 拉杆第 34 帧到底 + 透镜转动循环
import './b11env.mjs';
import { s3, sleep } from './b8s3.mjs';
import { SH11 } from './b11lib.mjs';
const T = 'b11-hum';
const S = await s3(5530, 'art=1');
const { page, ev, must, rec, step, done, waitSec } = S;
const P = `__s3.puzzles`, HUM = 'sfx-ignite-ready-loop';
await page.click(640, 360, 'left'); await sleep(300);
await ev(`(() => { const p = __s3.puzzles, b = p.beam, orig = p.fixedUpdate, A = __game.audio, as = __game.assets.audio; const key = (x) => { for (const [k, v] of as) if (v === x) return k; return null; };
  window.__sch = []; window.__tk = 0; window.__lp = []; window.__g = []; window.__ek = [];
  window.__brk = (on) => { b.mirrors.b.part.setAngle(0, on ? 315 : 300); b.tracer.trace(); };
  window.__at = (dt, fn) => { window.__sch.push({ at: window.__tk + dt, fn }); return window.__tk + dt; };
  for (const n of ['receiver:ready','receiver:lost','lighthouse:ignited','sfx:play']) __game.events.on(n, (e) => window.__ek.push({ n, id: e?.id ?? null, tk: window.__tk }));
  const sl = A.startLoop.bind(A); A.startLoop = (n, o = {}) => { const r = sl(n, o); window.__lp.push({ on: n, buf: o.buffer ? key(o.buffer) : null, fadeIn: o.fadeIn ?? null, ok: r, tk: window.__tk, ct: A.context?.currentTime }); return r; };
  const so = A.stopLoop.bind(A); A.stopLoop = (n, o = {}) => { const r = so(n, o); window.__lp.push({ off: n, fadeOut: o.fadeOut ?? null, ok: r, tk: window.__tk }); return r; };
  const m = __s3.artSlots?.mounted?.find(x => /ignition-port/.test(x.id)); const an = m?.model.getObjectByName('ignite-lever'); const q0 = an ? an.getWorldQuaternion(an.quaternion.clone()) : null;
  p.fixedUpdate = (dt) => { const t = ++window.__tk; for (const s of window.__sch.splice(0)) { if (s.at <= t) s.fn(); else window.__sch.push(s); } orig(dt);
    let artDeg = null; if (an) { const q = an.getWorldQuaternion(an.quaternion.clone()); artDeg = 2 * Math.acos(Math.min(1, Math.abs(q.dot(q0)))) * 180 / Math.PI; }
    const hv = A.loops.get('${HUM}'); if (hv) window.__hg = (window.__hg || []).concat([[A.context.currentTime, hv.gain.gain.value]]).slice(-400);
    window.__g.push({ t, st: b.igniter.state, hum: A.isLooping('${HUM}'), lens: A.isLooping('sfx-lens-rotate-loop'), wbDeg: -p.leverSwing.rotation.x * 180 / Math.PI, artDeg, pose: __s3.rig.animator?.posing ?? null, ctxSt: A.context?.state });
    if (window.__g.length > 4000) window.__g.splice(0, 1000); };
  return { artLever: !!an, mounted: m?.id ?? null }; })()`).then(r => rec(T, '插桩', 'INFO', r));
const tick = () => ev('window.__tk');
const waitTick = (t) => must(`window.__tk >= ${t}`, 900000, 'tick ' + t);
const lp = (k0 = 0) => ev(`__lp.filter(x => x.tk >= ${k0} && (x.on === '${HUM}' || x.off === '${HUM}'))`);
await ev(`(() => { const e = __s3.game.events; e.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }); __s3.tides.fixedUpdate(7); e.emit('interact:used', { id: 'door-s3', kind: 'use' }); e.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }); return 1; })()`);
await waitSec(0.5);
await ev(`(() => { const s = __s3, ix = s.puzzles.leverIx, sp = ix.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.03)); s.rig.controller.facing = sp.facing; s.cameraFollow.yaw = sp.facing + Math.PI; s.cameraFollow.pitch = -0.2; return 1; })()`);
await waitSec(1);
await step(T, 'ready 淡入', async () => {
  const t1 = await ev(`__at(1, () => { __s3.puzzles.beam.solve(); __s3.puzzles.beam.tracer.trace(); })`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 'ready');
  const rd = await ev(`__ek.filter(x => x.n === 'receiver:ready' && x.tk >= ${t1}).map(x => x.tk)`);
  await waitTick(rd[0] + 20); const gMid = await ev(`__game.audio.loops.get('${HUM}')?.gain.gain.value ?? null`);
  await waitTick(rd[0] + 90); const gEnd = await ev(`__game.audio.loops.get('${HUM}')?.gain.gain.value ?? null`);
  const l = await lp(t1);
  rec(T, 'receiver:ready 那一步起播 sfx-ignite-ready-loop（032 文件 buffer、fadeIn 0.6 s），只一次', l.length === 1 && l[0].on && l[0].tk === rd[0] && l[0].buf === HUM && l[0].fadeIn === 0.6 && l[0].ok ? 'PASS' : 'FAIL', { readyTk: rd, loops: l, gainAt20ticks: gMid, gainAt90ticks: gEnd, ctx: await ev('__game.audio.context?.state') });
  const hg = await ev('window.__hg || []'); const ct0 = l[0]?.ct;
  const ramp = hg.filter(([c]) => c >= ct0 && c <= ct0 + 1.2).map(([c, g]) => [+(c - ct0).toFixed(3), +g.toFixed(3)]);
  const vol = ramp.length ? ramp[ramp.length - 1][1] : null;
  const bad = ramp.filter(([dt, g]) => Math.abs(g - vol * Math.min(1, dt / 0.6)) > 0.06 * vol);
  rec(T, '嗡鸣增益按 AudioContext 时钟 0.6 s 线性淡入（逐固定步采 gain.value 对 currentTime）', ramp.length >= 3 && ramp.some(([dt]) => dt > 0.02 && dt < 0.55) && !bad.length ? 'PASS' : (ramp.some(([dt]) => dt > 0.02 && dt < 0.55) ? 'FAIL' : 'UNVERIFIED'), { samples: ramp.slice(0, 12), bad: bad.slice(0, 5), note: '音频时钟走实时，负载高时一个固定步可能跨过整段淡入' });
});
await step(T, '断光宽限', async () => {
  const out = {};
  for (const gap of [15, 18, 19]) {
    const tb = await ev(`(__at(2, () => __brk(true)), __at(${2 + gap}, () => __brk(false)))`);
    await waitTick(tb + 10);
    await must(`${P}.beam.igniter.state === 'ready'`, 600000, 're-ready');
    out[gap] = (await lp(tb - gap)).map(x => (x.on ? 'on' : 'off') + '@' + (x.tk - (tb - gap)) + (x.fadeOut !== null ? '/fo' + x.fadeOut : ''));
    await waitTick((await tick()) + 5);
  }
  rec(T, '断光 15 / 18 步（0.25 / 0.30 s）嗡鸣不断；19 步（>0.3 s）淡出 0.3 s，复光再 ready 时重新淡入', !out[15].length && !out[18].length && out[19].length === 2 && /^off@\d+\/fo0\.3$/.test(out[19][0]) && /^on/.test(out[19][1]) ? 'PASS' : 'FAIL', { gap15: out[15], gap18: out[18], gap19: out[19], note: 'tick 相对断光开始；19 步后的 on = 复光 1.0 s 后再 ready' });
});
await step(T, 'Esc 挂起', async () => {
  const before = await ev(`({ ctx: __game.audio.context?.state, hum: __game.audio.isLooping('${HUM}') })`);
  await page.keyDown('Escape'); await sleep(250); await page.keyUp('Escape'); await page.waitFor('__game.paused === true', 30000, 100); await sleep(800);
  const p = await ev(`({ ctx: __game.audio.context?.state, hum: __game.audio.isLooping('${HUM}'), input: __game.input.context })`);
  await page.keyDown('Escape'); await sleep(250); await page.keyUp('Escape'); const escResumed = await page.waitFor('__game.paused === false', 30000, 100); if (!escResumed) { const b = await ev(`(() => { const e = document.querySelector('.pause-menu [data-act="resume"]'); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`); if (b) await page.click(b.x, b.y, 'left'); await page.waitFor('__game.paused === false', 30000, 100); } await sleep(800);
  const r = await ev(`({ ctx: __game.audio.context?.state, hum: __game.audio.isLooping('${HUM}'), input: __game.input.context })`);
  rec(T, 'Esc 暂停：AudioContext suspended、嗡鸣保留不重起；恢复后 running 接着播', before.hum && p.ctx === 'suspended' && p.hum && r.ctx === 'running' && r.hum ? 'PASS' : 'FAIL', { before, paused: p, resumed: r, escResumed });
  if (r.input !== 'explore') { await page.click(640, 360, 'left'); await sleep(500); }
  await page.click(640, 360, 'left'); await sleep(300);
});
await step(T, '点燃', async () => {
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 'ready');
  const tb = await tick();
  await page.keyDown('KeyE'); await sleep(150); await page.keyUp('KeyE');
  await must(`${P}.state.igniting`, 300000, 'igniting');
  const tI = await tick(); await ev(`__at(5, () => __brk(true))`);
  await must(`${P}.state.ignited`, 600000, 'ignited');
  const ign = (await ev(`__ek.filter(x => x.n === 'lighthouse:ignited').map(x => x.tk)`))[0];
  await waitTick(ign + 120);
  const l = await lp(tb);
  const g = await ev(`__g.filter(r => r.t >= ${tb})`);
  const pose0 = g.find(r => r.pose === 'xi-ignite-lever');
  const atIgn = g.find(r => r.t === ign), pre = g.find(r => r.t === ign - 1);
  const maxWb = Math.max(...g.map(r => r.wbDeg)), maxArt = Math.max(...g.map(r => r.artDeg ?? 0));
  const lensOn = (await ev(`__lp.filter(x => x.on === 'sfx-lens-rotate-loop')`))[0];
  rec(T, '按 E 后断光嗡鸣不停，lighthouse:ignited 那一步淡出（fadeOut 0.3）', l.length === 1 && l[0].off && l[0].tk === ign && l[0].fadeOut === 0.3 ? 'PASS' : 'FAIL', { igniteTick: ign, eTick: tI, loops: l });
  rec(T, '拉杆第 34 帧到底：点燃那一步白盒拉杆 60°、美术 ignite-lever 跟到 60°（之后不再超）', pose0 && atIgn && Math.abs(atIgn.wbDeg - 60) < 0.1 && (atIgn.artDeg === null || Math.abs(atIgn.artDeg - 60) < 0.5) && maxWb <= 60.01 && maxArt <= 60.5 && Math.abs((ign - pose0.t) / 2 - 34) <= 1 ? 'PASS' : 'FAIL', { poseStart: pose0?.t, ign, frameAtIgn: pose0 ? (ign - pose0.t) / 2 : null, wbAtIgn: atIgn?.wbDeg, artAtIgn: atIgn?.artDeg, wbPrev: pre?.wbDeg, artPrev: pre?.artDeg, maxWb, maxArt });
  rec(T, '点燃后 1.5 s 起透镜转动循环 sfx-lens-rotate-loop（文件 buffer）', lensOn && Math.abs(lensOn.tk - ign - 90) <= 1 && lensOn.buf === 'sfx-lens-rotate-loop' ? 'PASS' : 'FAIL', { lensOn, dTicks: lensOn ? lensOn.tk - ign : null });
  await page.screenshot(`${SH11}/s3-ignite-art.png`);
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE'); process.exit(0);
