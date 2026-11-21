// batch10 S1 art=1：真按 E 敲钟（站位 / 第 30 帧钟响 / 美术钟摆跟白盒 / 切潮）、船绳两版跟潮位、木筏碰撞 + 跟随
import { open, sleep, SH10, EVLOG, counter } from './b10lib.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5441); console.log('open', process.env.QA_GAME);
const T = 'b10-S1'; const S = '__s1';
console.log('a'); await page.addInit(EVLOG); console.log('b');
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
console.log('c'); await page.goto(url('?smoke=1&debug=1&autostart=1&art=1')); console.log('d');
await must(`!!(window.__s1 && __s1.puzzles && __s1.art?.loaded) && __game.input.context === 'explore' && !__game.isPaused && !__s1.rig.controller.busy`, 400000, 'S1 explore');
console.log('ready', new Date().toISOString()); await ev(counter(S));
const N = () => ev('window.__n');
const waitN = async (k) => { const n0 = await N(); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const W = (name) => `((o) => { if (!o) return null; o.updateWorldMatrix(true, false); const v = o.getWorldPosition(o.position.clone()); return [v.x, v.y, v.z].map(x => +x.toFixed(3)); })(${S}.scene.getObjectByName('${name}'))`;
const ropeSt = () => ev(`(() => { const r = ${S}.art.rope; if (!r) return { rope: null }; const vis = (o) => { let p = o, v = true; while (p) { v = v && p.visible; p = p.parent; } return v; };
  return { state: r.state, high: r.high.map(o => [o.name, vis(o)]), low: r.low.map(o => [o.name, vis(o)]), level: +${S}.puzzles.tide.level.toFixed(3), tide: ${S}.puzzles.tide.state,
    endHigh: ${W('env-pier-wood-ch1-rope-bow-end-high')}, endLow: ${W('env-pier-wood-ch1-rope-bow-end-low')}, endOld: ${W('env-pier-wood-ch1-rope-bow-end')}, ring: ${W('prop-boat-rowboat-bow-ring')}, boatY: +(${S}.art.boat?.position.y ?? NaN).toFixed(3) }; })()`);
const dist = (a, b) => a && b ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3) : null;

await step(T, '船绳涨潮版', async () => {
  const r = await ropeSt();
  const ok = r.state === 'high' && r.high.every(x => x[1]) && r.low.every(x => !x[1]) && r.high.length && r.low.length;
  rec(T, '涨潮（开场）：rope-high 可见、rope-low 隐藏', ok ? 'PASS' : 'FAIL', r);
  rec(T, '涨潮：船头端点 bow-end-high 与船头环距离（参考，≤0.05 m 视为对上）', (dist(r.endHigh, r.ring) ?? 99) <= 0.05 ? 'PASS' : 'FAIL', { d: dist(r.endHigh, r.ring), endHigh: r.endHigh, ring: r.ring });
  await page.screenshot(`${SH10}/s1-rope-high.png`);
});

let bellInfo = null;
await step(T, '真按 E 敲钟', async () => {
  // 走到敲钟站位附近（站位外 1.2 m），让交互系统自己走过去
  const sp = await ev(`(() => { const b = ${S}.puzzles.bell.interactable; const r = b.standPoint(${S}.rig.body.position.clone()); return { p: [r.position.x, r.position.y, r.position.z], f: r.facing }; })()`);
  await ev(`(() => { const s = ${S}, f = ${sp.f}; const p = new s.rig.body.position.constructor(${sp.p[0]} - Math.sin(f) * 0.15, ${sp.p[1]} + 0.03, ${sp.p[2]} - Math.cos(f) * 0.15); s.rig.body.teleport(p); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.15; return 1; })()`);
  await waitN(20);
  const ok = await page.waitFor(`/敲钟/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 60000, 150);
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
  if (!ok) { rec(T, '敲钟提示', 'FAIL', { prompt, sp }); return; }
  await ev(`(() => { window.__f = () => { const s = ${S}, a = s.interaction.animState, b = s.puzzles.bell, sw = s.scene.getObjectByName('tide-bell-s1-swing'), m = s.artSlots.mounted.find(x => x.id === 'prop-tide-bell'), as = m && m.model.getObjectByName('bell-swing');
    const q = (o) => o ? o.getWorldQuaternion(o.quaternion.clone()) : null; const qa = q(as), ql = q(sw);
    const bp = s.rig.body.position; return { n: window.__n, clip: a?.clip ?? null, t: a ? +a.t.toFixed(4) : null, ang: +b.angle.toFixed(4), cl: +b.clapperAngle.toFixed(4), rings: b.rings, tr: s.puzzles.tide.transitioning, qa: qa && [qa.x, qa.y, qa.z, qa.w].map(v => +v.toFixed(4)), ql: ql && [ql.x, ql.y, ql.z, ql.w].map(v => +v.toFixed(4)), pos: [bp.x, bp.y, bp.z].map(v => +v.toFixed(3)) }; };
    window.__smp = []; window.__sfx = []; if (!window.__sfxOff) window.__sfxOff = __game.events.on('sfx:play', (e) => window.__sfx.push({ id: e.id, n: window.__n })); return 1; })()`);
  await page.tap('KeyE');
  await must(`${S}.puzzles.tide.transitioning`, 300000, '切潮开始');
  await waitN(120);
  const smp = await ev(`(() => { const r = window.__smp; window.__smp = null; return r; })()`);
  const sfx = await ev('window.__sfx');
  const a0 = smp.find(x => x.clip === 'xi-ring-bell');
  const bellSfx = sfx.find(x => x.id === 'sfx-tide-bell');
  const ringTick = smp.find(x => x.rings > 0);
  const frameAtSfx = a0 && bellSfx ? +((bellSfx.n - a0.n) + (a0.t * 60)).toFixed(2) : null;
  const sfxRow = bellSfx && smp.find(x => x.n === bellSfx.n);
  // 站位离钟轴
  const axis = await ev(`(() => { const o = ${S}.scene.getObjectByName('env-shore-ledge-s1-bell-anchor') ?? ${S}.scene.getObjectByName('tide-bell-s1'); const v = o.getWorldPosition(o.position.clone()); return [v.x, v.y, v.z]; })()`);
  const stand = a0?.pos; const dAxis = stand ? +Math.hypot(stand[0] - axis[0], stand[2] - axis[2]).toFixed(3) : null;
  // 美术 bell-swing 与白盒 swing 的世界旋转增量一致：比较相对首帧的角度变化
  const qang = (a, b) => { const d = Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]); return 2 * Math.acos(Math.min(1, d)); };
  const f0 = smp.find(x => x.qa && x.ql);
  const follow = smp.filter(x => x.qa && x.ql).map(x => +(Math.abs(qang(x.qa, f0.qa) - qang(x.ql, f0.ql))).toFixed(4));
  const maxFollowErr = Math.max(...follow);
  const angs = smp.map(x => x.ang); const touchRow = a0 && smp.find(x => x.clip === 'xi-ring-bell' && x.t * 60 >= 22);
  const beforeTouch = smp.filter(x => x.clip === 'xi-ring-bell' && x.t * 60 < 21.5).map(x => Math.abs(x.ang));
  bellInfo = { prompt, sp, stand, axis, dAxis, frameAtSfx, sfx, ringTickFrame: ringTick && a0 ? +((ringTick.n - a0.n) + a0.t * 60).toFixed(2) : null, angAtSfx: sfxRow?.ang, maxAng: Math.max(...angs), minAng: Math.min(...angs), maxBeforeTouch: Math.max(0, ...beforeTouch), maxFollowErrRad: maxFollowErr, clapMax: Math.max(...smp.map(x => Math.abs(x.cl))) };
  rec(T, '真按 E「E 敲钟」→ xi-ring-bell，站位离钟轴 0.98 m（±0.03）', a0 && Math.abs(dAxis - 0.98) <= 0.03 ? 'PASS' : 'FAIL', bellInfo);
  rec(T, '钟声 sfx-tide-bell 在 xi-ring-bell 第 30 帧（±1 帧）', frameAtSfx !== null && Math.abs(frameAtSfx - 30) <= 1 ? 'PASS' : 'FAIL', { frameAtSfx, ringTickFrame: bellInfo.ringTickFrame });
  rec(T, '钟摆：第 22 帧前不动、ring 帧约 0.100 rad、之后自由摆（钟锤有相对摆）', bellInfo.maxBeforeTouch < 0.005 && Math.abs((sfxRow?.ang ?? 0) - 0.1) < 0.012 && bellInfo.minAng < -0.02 && bellInfo.clapMax > 0.005 ? 'PASS' : 'FAIL', { maxBeforeTouch: bellInfo.maxBeforeTouch, angAtSfx: sfxRow?.ang, maxAng: bellInfo.maxAng, minAng: bellInfo.minAng, clapMax: bellInfo.clapMax });
  rec(T, '美术 bell-swing 世界旋转增量跟白盒 swing 一致（误差 ≤0.002 rad）', f0 && maxFollowErr <= 0.002 && bellInfo.maxAng > 0.05 ? 'PASS' : 'FAIL', { maxFollowErr, samples: follow.length });
});

await step(T, '切潮 + 船绳退潮版', async () => {
  const t0 = await ev(`${S}.puzzles.tide.state`);
  await ev(`(() => { const t = ${S}.puzzles.tide; t.t = Math.max(t.t, t.transitionSec - 0.05); return 1; })()`);
  await must(`${S}.puzzles.tide.state === 'low' && !${S}.puzzles.tide.transitioning`, 300000, '退潮');
  await waitN(30);
  const r = await ropeSt();
  rec(T, '敲钟切潮：涨 → 退（切潮逻辑：一次敲钟一次切换）', t0 !== 'low' && r.tide === 'low' ? 'PASS' : 'FAIL', { before: t0, after: r.tide, level: r.level });
  const ok = r.state === 'low' && r.low.every(x => x[1]) && r.high.every(x => !x[1]);
  rec(T, '退潮：rope-low 可见、rope-high 隐藏', ok ? 'PASS' : 'FAIL', r);
  rec(T, '退潮：船头端点 bow-end-low 与（落到滩上的）船头环距离（≤0.05 m 视为对上）', (dist(r.endLow, r.ring) ?? 99) <= 0.05 ? 'PASS' : 'FAIL', { d: dist(r.endLow, r.ring), endLow: r.endLow, ring: r.ring, boatY: r.boatY });
  await ev(`(() => { const s = ${S}; s.rig.body.teleport(new s.rig.body.position.constructor(1.5, 2.3, -11.4)); s.cameraFollow.yaw = -Math.PI / 2 + Math.PI; return 1; })()`);
  await waitN(20);
  await page.screenshot(`${SH10}/s1-rope-low.png`);
});

await step(T, '木筏碰撞 + 美术跟随', async () => {
  const r = await ev(`(() => { const s = ${S}, c = s.scene.getObjectByName('raft-s1-collider'), g = c.geometry.parameters, root = s.scene.getObjectByName('raft-s1'), m = s.artSlots.mounted.find(x => x.id === 'prop-raft-s1');
    const vis = []; root.traverse(o => { if (o.isMesh && o.visible) { let p = o, art = false; while (p) { if (p.userData.artSlot) art = true; p = p.parent; } if (!art) vis.push(o.name); } });
    return { size: [g.width, g.height, g.depth], scale: c.getWorldScale(c.scale.clone()).toArray(), mounted: !!m, parentOk: m?.model.parent === root, zero: m ? m.model.position.lengthSq() === 0 && m.model.quaternion.w === 1 : null, gbVisible: vis, missing: m?.missingNodes ?? null, raftState: s.puzzles.raft.state }; })()`);
  rec(T, '木筏碰撞 2.0×0.3×3.0、美术零变换挂 raft-s1、白盒网格隐藏', r.size.join() === '2,0.3,3' && r.parentOk && r.zero && !r.gbVisible.length && !(r.missing ?? []).length ? 'PASS' : 'FAIL', r);
});
await step(T, '页面错误', async () => rec(T, '页面错误 / 控制台 art-slot 缺节点', page.errors?.length ? 'FAIL' : 'PASS', page.errors ?? []));
save('t10-s1'); await done();
