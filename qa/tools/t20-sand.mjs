// batch20 ④：?seabed=0 / 1 退潮对比：固定机位（opening / rocks-top）时间流动连拍 + 走过新礁石南侧沙面跟拍
import { open, sleep, SH16 as SH } from './b20lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const SB = process.env.SEABED ?? '1'; const TAG = process.env.TAG ?? ''; const ROUTE = process.env.ROUTE ?? '[[8, -7.7], [12.6, -7.9], [13.8, -6], [12.6, -7.3], [8, -7.2], [4.8, -6.8]]'; const START = process.env.START ?? '4.6, 0.6, -7.4'; const NOFIX = !!process.env.NOFIX;
const D = `${SH}/sand`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5682, { width: 1280, height: 720 });
const out = { seabed: SB };
const save = () => writeFileSync(`${D}/t20-sand${TAG}-seabed${SB}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const DRV = `(() => {
  const s = __s1, inp = __game.input, V = s.rig.body.position.constructor;
  const gt = () => __game.time.fixedTick * __game.time.fixedDelta; const pos = () => s.rig.body.position; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const steer = (tx, tz) => { const p = pos(); s.cameraFollow.yaw = Math.atan2(-(tx - p.x), -(tz - p.z)); };
  window.__tp = (x, y, z) => { s.rig.body.teleport(new V(x, y, z)); s.rig.body.velocity?.set?.(0, 0, 0); };
  window.__route = async (wps, r = 0.45) => { const trace = []; let stuck = null; const t0 = gt(); inp.setRaw('smoke', 'KeyW', true);
    try { for (let i = 0; i < wps.length; i++) { const [tx, tz] = wps[i]; let best = 1e9, bestG = gt(); const g0 = gt();
      for (;;) { steer(tx, tz); await wait(60); const p = pos(); const d = Math.hypot(tx - p.x, tz - p.z);
        if (!trace.length || gt() - trace[trace.length - 1][0] >= 0.5) trace.push([+(gt() - t0).toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), i]);
        if (d < r) break; if (d < best - 0.05) { best = d; bestG = gt(); }
        if (gt() - bestG > 2) { stuck = { wp: i, at: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), dist: +d.toFixed(2) }; break; }
        if (gt() - g0 > 40) { stuck = { wp: i, timeout: true, at: [p.x, p.y, p.z].map((v) => +v.toFixed(2)) }; break; } }
      if (stuck) break; } } finally { inp.setRaw('smoke', 'KeyW', false); }
    const p = pos(); return { ok: !stuck, stuck, gameSec: +(gt() - t0).toFixed(2), end: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), trace }; };
  return 1; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1${SB === '0' ? '&seabed=0' : ''}`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  out.loads = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
  out.seabedInfo = await ev(`(() => { const sb = __s1.seabed; return sb ? { ms: +sb.ms.toFixed(1), w: sb.map.width ?? sb.map.w ?? null, h: sb.map.height ?? sb.map.h ?? null, keys: Object.keys(sb.map) } : null; })()`);
  out.penInS1 = await ev(`({ loaded: __game.assets.has('prop-fountain-pen'), inScene: !!__s1.scene.getObjectByName('prop-fountain-pen'), hasPenField: '__pen' in __s1 })`);
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await sleep(3000);
  out.tide = await ev(`({ state: __s1.puzzles.tide.state, level: +(+__s1.puzzles.tide.level).toFixed(3), waterY: +__s1.water.position.y.toFixed(3) })`);
  log('info', JSON.stringify(out.seabedInfo), JSON.stringify(out.tide)); save();
  await ev(DRV);
  // 1) 走：新礁石南侧沙面（礁石 x 6.4–12、z −3.8…−6.6，深水 z −8.95）来回，跟拍
  await ev(`(__tp(${START}), 1)`); await sleep(1500);
  await ev(`(window.__walk = __route(${ROUTE}).then((r) => (window.__walkRes = r)), 1)`);
  out.walkShots = [];
  for (let i = 0; i < 40; i++) { const st = await ev(`({ done: !!window.__walkRes, p: __s1.rig.body.position.toArray().map((v) => +v.toFixed(2)) })`); if (st.done) break;
    const f = `walk${TAG}-seabed${SB}-${String(i).padStart(2, '0')}.png`; await page.screenshot(`${D}/${f}`); out.walkShots.push({ f, p: st.p }); await sleep(700); }
  await must(`!!window.__walkRes`, 300000, 'walk');
  out.walk = await ev(`window.__walkRes`); log('walk', out.walk.ok, JSON.stringify(out.walk.stuck), out.walk.end, out.walkShots.length); save();
  // 2) 固定机位时间流动连拍（水在动，看沙斑是否闪）
  await ev(`(() => { const s = __s1; s.cameraFollow.update = () => {}; s.rig.entity.object3D.visible = false; return 1; })()`);
  out.fixed = {};
  for (const [v, eye, at, fov] of NOFIX ? [] : [['rocks-top', [8.5, 9.0, 2.0], [8.5, 0.0, -7.0], 50], ['opening', [-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40], ['sand-low', [9.0, 1.6, -2.2], [9.5, 0.0, -7.8], 55]]) {
    await ev(`(() => { const c = __s1.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`);
    await sleep(2000); const fs = [];
    for (let i = 0; i < 6; i++) { const t = await ev(`+__game.time.elapsed.toFixed(2)`); const f = `fix-${v}-seabed${SB}-${i}.png`; await page.screenshot(`${D}/${f}`); fs.push({ f, t }); await sleep(500); }
    out.fixed[v] = fs; log(v, fs.map((x) => x.t).join(',')); save();
  }
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
