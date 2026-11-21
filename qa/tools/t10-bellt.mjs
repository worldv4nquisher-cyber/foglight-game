// batch10 钟声帧 / 钟摆逐 update 采样（S1 或 S3，art=1，真按 E）。SC=s1|s3
import './b10env.mjs';
import { open, sleep, EVLOG, counter, SH10 } from './b10lib.mjs';
const SC = process.env.SC || 's1'; const X = SC === 's1' ? '__s1' : '__s3';
const { page, ev, must, url, rec, step, save, done } = await open(SC === 's1' ? 5437 : 5438);
const T = 'b10-bellt-' + SC;
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url(SC === 's1' ? '?smoke=1&debug=1&autostart=1&art=1' : '?smoke=1&debug=1&scene=s3&art=1'));
await must(`!!(window.${X} && ${X}.puzzles) && __game.input.context === 'explore' && !__game.isPaused && !${X}.rig.controller.busy`, 400000, 'explore');
await ev(counter(X));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
await step(T, '敲钟逐步', async () => {
  const sp = await ev(`(() => { const b = ${X}.puzzles.bell.interactable; const r = b.standPoint(${X}.rig.body.position.clone()); return { p: [r.position.x, r.position.y, r.position.z], f: r.facing }; })()`);
  await ev(`(() => { const s = ${X}, f = ${sp.f}; const p = new s.rig.body.position.constructor(${sp.p[0]} - Math.sin(f) * 0.15, ${sp.p[1]} + 0.03, ${sp.p[2]} - Math.cos(f) * 0.15); s.rig.body.teleport(p); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.15; return 1; })()`);
  await waitN(20);
  if (!(await page.waitFor(`/敲钟/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 60000, 150))) { rec(T, '提示', 'FAIL', await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`)); return; }
  // 每个固定步记 animState.t；钟的 update 里记角度（update 是渲染帧）
  await ev(`(() => { const s = ${X}, b = s.puzzles.bell; window.__f = () => { const a = s.interaction.animState; return { n: window.__n, clip: a?.clip ?? null, t: a ? a.t : null, fired: a?.fired ?? null, rings: b.rings }; };
    window.__u = []; const ou = b.update.bind(b); b.update = (dt) => { ou(dt); const a = s.interaction.animState; window.__u.push({ n: window.__n, t: a && a.clip === 'xi-ring-bell' ? a.t : null, ang: b.angle, cl: b.clapperAngle }); };
    window.__smp = []; window.__sfx = []; __game.events.on('sfx:play', (e) => { const a = s.interaction.animState; window.__sfx.push({ id: e.id, n: window.__n, t: a ? a.t : null, clip: a?.clip ?? null }); }); return 1; })()`);
  await page.tap('KeyE');
  await must(`${X}.puzzles.tide.transitioning`, 300000, '切潮开始');
  await waitN(150);
  const smp = await ev(`(() => { const r = window.__smp; window.__smp = null; return r; })()`);
  const U = await ev('window.__u'); const sfx = (await ev('window.__sfx')).filter(x => x.id === 'sfx-tide-bell');
  const anim = smp.filter(x => x.clip === 'xi-ring-bell');
  const frameAtSfx = sfx[0]?.t != null ? +(sfx[0].t * 30).toFixed(2) : null;
  const ringTick = smp.find(x => x.rings > 0);
  const push = U.filter(x => x.t !== null && x.t * 30 < 30);
  const pre = U.filter(x => x.t !== null && x.t * 30 < 22).map(x => Math.abs(x.ang));
  const kOne = U.filter(x => x.t !== null && x.t * 30 >= 29 && x.t * 30 < 30.5);
  const post = U.filter(x => sfx[0] && x.n > sfx[0].n);
  const r = { sfx, frameAtSfx, ringTickN: ringTick?.n, animTicks: anim.length, firstAnimT: anim[0]?.t, renderFramesInPush: push.length, maxPreTouch: +Math.max(0, ...pre).toFixed(4), angNearRing: kOne.map(x => [+(x.t * 30).toFixed(1), +x.ang.toFixed(4)]), maxPush: +Math.max(...push.map(x => x.ang)).toFixed(4), postMax: +Math.max(...post.map(x => x.ang)).toFixed(4), postMin: +Math.min(...post.map(x => x.ang)).toFixed(4), clapMax: +Math.max(...U.map(x => Math.abs(x.cl))).toFixed(4), pushCurve: push.slice(-12).map(x => [+(x.t * 30).toFixed(1), +x.ang.toFixed(4)]) };
  rec(T, `${SC} 钟声 sfx-tide-bell 在 xi-ring-bell 第 30 帧（动画 t×30 fps，±1 帧）`, frameAtSfx !== null && Math.abs(frameAtSfx - 30) <= 1 && sfx.length === 1 ? 'PASS' : 'FAIL', r);
  rec(T, `${SC} 钟摆：22 帧前只有闲置风摆（≤0.011）、推到 ring 帧 ≈0.100（±0.012，含风摆）、之后自由摆过零、钟锤相对摆`, r.maxPreTouch <= 0.011 && Math.abs(r.maxPush - 0.1) <= 0.012 && r.postMin < -0.02 && r.clapMax > 0.005 ? 'PASS' : (push.length < 3 ? 'INFO' : 'FAIL'), r);
});
await step(T, '页面错误', async () => rec(T, '页面错误', page.errors?.length ? 'FAIL' : 'PASS', page.errors ?? []));
save('t10-bellt-' + SC); await done();
