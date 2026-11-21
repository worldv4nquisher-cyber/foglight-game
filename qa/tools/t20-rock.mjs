// batch20 ⑤：#157 礁石轮廓棱柱：24 向迎面走（胶囊中心离轮廓最小距离 = 是否穿进）、轮廓外 0.3 m 16 点 8 向脱困、贴边绕行一圈
import { open, sleep, SH16 as SH } from './b20lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/rock157`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5684, { width: 960, height: 540 });
const out = {};
const save = () => writeFileSync(`${D}/t20-rock157${process.env.SKIP_APPROACH ? '-escloop' : ''}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const DRV = `(() => {
  const s = __s1, inp = __game.input, V = s.rig.body.position.constructor;
  const c = s.physics.colliders.find((x) => x.name === 's1-fg-rock-157-collider');
  const g = c.geometry, P = g.attributes.position, tv = new V(); let ymin = 1e9; const wp = [];
  for (let i = 0; i < P.count; i++) { tv.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(c.matrix); wp.push([tv.x, tv.y, tv.z]); ymin = Math.min(ymin, tv.y); }
  const ring = wp.filter((p) => Math.abs(p[1] - ymin) < 1e-4); const C = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[2], 0) / ring.length];
  const poly = ring.map((p) => [p[0] - C[0], p[2] - C[1]]);
  window.__poly = poly; window.__rock = c;
  const sd = (lx, lz) => { let m = 1e9, inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > lz) !== (zj > lz) && lx < (xj - xi) * (lz - zi) / (zj - zi) + xi) inside = !inside;
      const ex = xj - xi, ez = zj - zi, t = Math.max(0, Math.min(1, ((lx - xi) * ex + (lz - zi) * ez) / (ex * ex + ez * ez))); m = Math.min(m, Math.hypot(lx - xi - t * ex, lz - zi - t * ez)); }
    return inside ? -m : m; };
  const loc = (p) => ({ x: p.x - C[0], z: p.z - C[1] });
  window.__sdBody = () => { const l = loc(s.rig.body.position); return sd(l.x, l.z); };
  const gt = () => __game.time.fixedTick * __game.time.fixedDelta; const pos = () => s.rig.body.position; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tp = (x, y, z) => { s.rig.body.teleport(new V(x, y, z)); s.rig.body.velocity?.set?.(0, 0, 0); };
  const W = (lx, lz) => new V(C[0] + lx, 0, C[1] + lz);
  // 局部方向 a 上轮廓边界距离（中心射线）
  window.__rb = (a) => { let lo = 0, hi = 10; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (sd(Math.cos(a) * m, Math.sin(a) * m) < 0) lo = m; else hi = m; } return lo; };
  window.__approach = async (a, back = 1.4, secs = 2.2) => { const rb = __rb(a); const st = W(Math.cos(a) * (rb + back), Math.sin(a) * (rb + back)); const ctr = W(0, 0);
    __tp(st.x, 0.8, st.z); const g0 = gt(); while (gt() - g0 < 0.4) await wait(30);
    let min = 1e9, minAt = null; inp.setRaw('smoke', 'KeyW', true); const g1 = gt();
    try { while (gt() - g1 < secs) { const p = pos(); s.cameraFollow.yaw = Math.atan2(-(ctr.x - p.x), -(ctr.z - p.z)); const d = __sdBody(); if (d < min) { min = d; minAt = [p.x, p.y, p.z].map((v) => +v.toFixed(2)); } await wait(25); } }
    finally { inp.setRaw('smoke', 'KeyW', false); }
    const p = pos(); return { a: +(a * 180 / Math.PI).toFixed(0), start: [st.x, st.z].map((v) => +v.toFixed(2)), startWorldZ: +st.z.toFixed(2), minSd: +min.toFixed(3), minAt, end: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), endSd: +__sdBody().toFixed(3) }; };
  window.__escape = async (a, off = 0.3) => { const rb = __rb(a); const st0 = W(Math.cos(a) * (rb + off), Math.sin(a) * (rb + off));
    __tp(st0.x, 0.8, st0.z); const g0 = gt(); while (gt() - g0 < 0.4) await wait(30); const st = pos().clone(); const res = [];
    for (let k = 0; k < 8; k++) { __tp(st.x, st.y + 0.02, st.z); const g1 = gt(); while (gt() - g1 < 0.15) await wait(30);
      const b = pos().clone(); const aa = (k / 8) * Math.PI * 2; inp.setRaw('smoke', 'KeyW', true); const g2 = gt();
      while (gt() - g2 < 0.45) { s.cameraFollow.yaw = Math.atan2(-Math.sin(aa), -Math.cos(aa)); await wait(30); }
      inp.setRaw('smoke', 'KeyW', false); const e = pos(); res.push(+Math.hypot(e.x - b.x, e.z - b.z).toFixed(2)); }
    return { a: +(a * 180 / Math.PI).toFixed(0), start: [st.x, st.y, st.z].map((v) => +v.toFixed(2)), startSd: +(() => { const l = loc(st); return sd(l.x, l.z); })().toFixed(3), disp: res, moved: res.filter((d) => d > 0.15).length }; };
  window.__route = async (wps, r = 0.45) => { const trace = []; let stuck = null, min = 1e9; const t0 = gt(); inp.setRaw('smoke', 'KeyW', true);
    try { for (let i = 0; i < wps.length; i++) { const [tx, tz] = wps[i]; let best = 1e9, bestG = gt(); const g0 = gt();
      for (;;) { const p0 = pos(); s.cameraFollow.yaw = Math.atan2(-(tx - p0.x), -(tz - p0.z)); await wait(50); const p = pos(); const d = Math.hypot(tx - p.x, tz - p.z); min = Math.min(min, __sdBody());
        if (!trace.length || gt() - trace[trace.length - 1][0] >= 0.5) trace.push([+(gt() - t0).toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), i]);
        if (d < r) break; if (d < best - 0.05) { best = d; bestG = gt(); }
        if (gt() - bestG > 2.5) { stuck = { wp: i, target: [tx, tz], at: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), dist: +d.toFixed(2) }; break; }
        if (gt() - g0 > 30) { stuck = { wp: i, timeout: true }; break; } }
      if (stuck) break; } } finally { inp.setRaw('smoke', 'KeyW', false); }
    const p = pos(); return { ok: !stuck, stuck, minSd: +min.toFixed(3), gameSec: +(gt() - t0).toFixed(2), end: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), trace }; };
  window.__loopPts = (off) => { const pts = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; const rb = __rb(a); const w = W(Math.cos(a) * (rb + off), Math.sin(a) * (rb + off)); pts.push([+w.x.toFixed(2), +w.z.toFixed(2)]); } return pts; };
  return { n: poly.length, nVerts: P.count, ymin, center: C.map((v) => +v.toFixed(3)), zMinWorld: +Math.min(...ring.map((p) => p[2])).toFixed(3), poly: poly.map((p) => [+(p[0] + C[0]).toFixed(3), +(p[1] + C[1]).toFixed(3)]), enabled: c.enabled, kind: c.kind, radius: s.rig.body.radius ?? s.rig.body.capsule?.radius ?? null }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=low&autostart=1`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; s.puzzles.tide.set('low', { instant: true }); return 1; })()`); await sleep(1500);
  out.collider = await ev(DRV); log('collider', JSON.stringify({ ...out.collider, poly: undefined })); save();
  out.approach = []; if (!process.env.SKIP_APPROACH) {
  for (let k = 0; k < 24; k++) { const r = await ev(`__approach(${k / 24 * Math.PI * 2})`); out.approach.push(r); if (k % 6 === 5) { log('approach', out.approach.slice(-6).map((x) => `${x.a}:${x.minSd}`).join(' ')); save(); } }
  out.approachMin = Math.min(...out.approach.map((x) => x.minSd)); }
  out.escape = [];
  for (let k = 0; k < 8; k++) { out.escape.push(await ev(`__escape(${k / 8 * Math.PI * 2})`)); log('esc', JSON.stringify(out.escape.at(-1))); save(); }
  log('escape', out.escape.map((x) => `${x.a}:${x.moved}`).join(' ')); out.escapeMin = Math.min(...out.escape.map((x) => x.moved)); save();
  // 贴边绕行：轮廓外 0.45 m 16 点（南侧点若进深水区由游戏送回，记下）
  const pts = await ev(`__loopPts(0.45)`); out.loopPts = pts;
  await ev(`(__tp(${pts[0][0]}, 0.8, ${pts[0][1]}), 1)`); await sleep(800);
  out.loop = await ev(`__route(${JSON.stringify([...pts.slice(1), pts[0]])}, 0.4)`); log('loop', out.loop.ok, JSON.stringify(out.loop.stuck), out.loop.minSd); save();
  await page.screenshot(`${D}/rock157-end.png`);
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
