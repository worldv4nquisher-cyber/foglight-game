// batch21 ②：BUG-028 回归 — #157 南缝（z −8.6，x 7.5–12.5）站 / 走 / 跑朝东、原地转、朝北看礁石；最小相机–头距离、淡出、描边
import { open, sleep, SH16 as SH } from './b21lib.mjs';
import { HOOK } from './t21-camlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/bug028`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5692, { width: 1280, height: 720 });
const out = { segs: [] }; const save = () => writeFileSync(`${D}/t21-cam-gap.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const Z = -8.6, E = -Math.PI / 2;
const put = (x, yaw, pitch = -0.3) => `(() => { const s = __s1, V = s.rig.body.position.constructor; s.puzzles.tide.set('low', { instant: true }); s.rig.body.teleport(new V(${x}, 0.6, ${Z})); s.rig.body.velocity?.set?.(0, 0, 0); s.rig.controller.facing = ${yaw} + Math.PI; __cam.yaw = ${yaw}; __cam.pitch = ${pitch}; __cam.spin = 0; return 1; })()`;
async function seg(name, setup, body, shot) {
  try {
    await ev(setup); await ev(`__gwait(0.5)`); await ev(`(__cam.rec = [], __cam.last = null, 1)`);
    const extra = await ev(body);
    const rec = await ev(`(() => { const r = __cam.rec; __cam.rec = null; return r; })()`);
    const sm = await ev(`__summ(${JSON.stringify(rec)})`);
    const r = { name, ...sm, extra };
    if (shot) { await ev(`(__game.time.timeScale = 0, 1)`); await sleep(2500); r.shot = `${name}.png`; await page.screenshot(`${D}/${name}.png`); await ev(`(__game.time.timeScale = 1, 1)`); }
    out.segs.push(r); out.rec ??= {}; out.rec[name] = rec; log(name, JSON.stringify(sm), JSON.stringify(extra)); save();
  } catch (e) { out.segs.push({ name, fail: String(e?.message ?? e) }); log('FAILSEG', name, e?.message ?? e); save(); await ev(`(__game.input.setRaw('smoke','KeyW',false), __game.input.setRaw('smoke','ShiftLeft',false), __game.time.timeScale = 1, 1)`).catch(() => {}); }
}
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  out.loads = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await ev(HOOK); out.cfg = await ev(`(() => { const c = __s1.cameraFollow.cfg; return { nearFade: c.nearFade, shoulderSkin: c.shoulderSkin, lowSpaceLift: c.lowSpaceLift, collisionRadius: c.collisionRadius, shoulderOffset: c.shoulderOffset, distance: c.distance }; })()`);
  out.mat0 = await ev(`__mat()`); log('cfg', JSON.stringify(out.cfg), JSON.stringify(out.mat0)); save();
  const stand = (s) => `(async () => { await __gwait(${s}); return { mat: __mat() }; })()`;
  for (const x of [7.5, 9, 10.5, 12, 12.5]) await seg(`stand-east-x${x}`, put(x, E), stand(1.5), x === 10.5);
  const mv = (run, cap, toX, dir) => `(async () => { __game.input.setRaw('smoke', 'KeyW', true); ${run ? "__game.input.setRaw('smoke', 'ShiftLeft', true);" : ''} const g = () => __game.time.fixedTick * __game.time.fixedDelta; const g0 = g(); let mat = null;
    while (g() - g0 < ${cap} && ${dir > 0 ? `__s1.rig.body.position.x < ${toX}` : `__s1.rig.body.position.x > ${toX}`}) { await new Promise((r) => setTimeout(r, 40)); if (!mat && __s1.xiNearAlpha < 0.999) mat = __mat(); }
    __game.input.setRaw('smoke', 'KeyW', false); __game.input.setRaw('smoke', 'ShiftLeft', false); await __gwait(0.4); return { endX: +__s1.rig.body.position.x.toFixed(2), matWhenFaded: mat }; })()`;
  await seg('walk-east', put(7.3, E), mv(false, 6, 12.5, 1));
  await seg('run-east', put(7.3, E), mv(true, 4, 12.5, 1));
  await seg('walk-west', put(12.6, Math.PI / 2), mv(false, 6, 7.5, -1));
  const spin = `(async () => { __cam.spin = 2; let mat = null, minA = 1; const g = () => __game.time.fixedTick * __game.time.fixedDelta; const g0 = g();
    while (g() - g0 < Math.PI) { await new Promise((r) => setTimeout(r, 40)); if (__s1.xiNearAlpha < minA) { minA = __s1.xiNearAlpha; mat = __mat(); } } __cam.spin = 0; return { matAtMinAlpha: mat }; })()`;
  for (const x of [8, 10.5, 12]) await seg(`spin-x${x}`, put(x, E), spin);
  const north = `(async () => { await __gwait(2); return { mat: __mat(), a: __s1.xiNearAlpha }; })()`;
  await seg('north-rock-yawPi-x10.5', put(10.5, Math.PI), north, true);
  await seg('north-rock-yaw0-x10.5', put(10.5, 0), north, true);
  await seg('north-rock-yawPi-x9', put(9, Math.PI), north);
  await seg('north-rock-yawPi-x12', put(12, Math.PI), north);
  await seg('north-rock-yaw0-x12', put(12, 0), north);
  // 淡出最深处补一张图：在最小 alpha 的原地转角度停住
  const best = out.segs.filter((s) => s.atMin && s.minAlpha < 0.999).sort((a, b) => a.minAlpha - b.minAlpha)[0];
  if (best) { const recs = out.rec[best.name]; const q = recs.reduce((m, r) => (r.a < m.a ? r : m), recs[0]); await seg('fade-deepest', put(q.x, q.yaw), north, true); }
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
