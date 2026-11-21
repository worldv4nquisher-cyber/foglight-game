// batch16 018 脱困（手动固定步，不靠墙钟/渲染）：冻结游戏循环，在页面里同步 input.beginFrame → scene.fixedUpdate(dt) → input.endFrame
import { open, sleep, SH16 } from './b16lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH16}/walk`; mkdirSync(D, { recursive: true });
const PART = process.env.PART || 'all';
const { page, ev, must, url, done } = await open(5608, { width: 480, height: 270 });
const out = { part: PART, loads: [] };
const save = () => writeFileSync(`${D}/t16-esc-${PART}.json`, JSON.stringify(out, null, 1));
try {
  for (let att = 1; att <= 3; att++) {
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=low&autostart=1`));
    await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 600000, 's1');
    for (let k = 0; k < 3; k++) { await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads'); await sleep(3000); }
    const ls = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
    out.loads.push(ls); console.log('load', att, ls.n, ls.bad.length); if (!ls.bad.length) break; if (att === 3) throw new Error('占位');
  }
  await ev(`(() => { const s = __s1, g = __game, inp = g.input, V = s.rig.body.position.constructor, dt = g.time.fixedDelta;
    s.puzzles.tide.set('low', { instant: true }); window.__unf = g.freeze(); window.__rc = 0; window.__rpos = []; g.events.on('tide:recall', () => { window.__rc++; const q = window.__last; if (q) window.__rpos.push([q.x, q.z].map((v) => +v.toFixed(2))); });
    const step = (n) => { for (let i = 0; i < n; i++) { window.__last = s.rig.body.position.clone(); inp.beginFrame(); s.fixedUpdate(dt); inp.endFrame(); } };
    window.__step = step;
    window.__tp = (x, y, z) => { s.rig.body.teleport(new V(x, y, z)); s.rig.body.velocity?.set?.(0, 0, 0); };
    const P = () => s.rig.body.position.clone();
    window.__walk = (a, sec) => { s.cameraFollow.yaw = Math.atan2(-Math.sin(a), -Math.cos(a)); inp.setRaw('smoke', 'KeyW', true); const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { s.cameraFollow.yaw = Math.atan2(-Math.sin(a), -Math.cos(a)); step(1); } inp.setRaw('smoke', 'KeyW', false); step(6); };
    window.__escape = (x, y, z) => { window.__rc = 0; window.__rpos = []; window.__tp(x, y, z); step(Math.round(0.4 / dt)); const st = P(); const disp = [];
      for (let k = 0; k < 8; k++) { window.__tp(st.x, st.y + 0.02, st.z); step(4); const b = P(); window.__walk((k / 8) * Math.PI * 2, 0.4); const e = P(); disp.push(+Math.hypot(e.x - b.x, e.z - b.z).toFixed(2)); }
      return { recall: window.__rc, rpos: window.__rpos.slice(), start: [st.x, st.y, st.z].map((v) => +v.toFixed(2)), disp, moved: disp.filter((d) => d > 0.15).length }; };
    window.__route = (wps, r = 0.45) => { window.__rc = 0; const t0 = g.time.fixedTick; let stuck = null, minZ = 9, jumps = 0, prev = P(); const tr = [];
      inp.setRaw('smoke', 'KeyW', true);
      for (let i = 0; i < wps.length && !stuck; i++) { const [tx, tz] = wps[i]; let best = 1e9, bestN = 0, n = 0;
        for (;;) { const p = P(); s.cameraFollow.yaw = Math.atan2(-(tx - p.x), -(tz - p.z)); step(1); n++; const q = P(); if (Math.hypot(q.x - prev.x, q.z - prev.z) > 1) jumps++; prev = q; if (q.x > 7 && q.x < 15) minZ = Math.min(minZ, q.z); if (n % 15 === 0) tr.push([q.x, q.z].map((v) => +v.toFixed(2)));
          const d = Math.hypot(tx - q.x, tz - q.z); if (d < r) break; if (d < best - 0.05) { best = d; bestN = n; } if (n - bestN > 120 || n > 2400) { stuck = { wp: i, at: [q.x, q.y, q.z].map((v) => +v.toFixed(2)), dist: +d.toFixed(2) }; break; } } }
      inp.setRaw('smoke', 'KeyW', false); const e = P(); return { ok: !stuck, recall: window.__rc, jumps, minZ: +minZ.toFixed(2), stuck, end: [e.x, e.y, e.z].map((v) => +v.toFixed(2)), trace: tr }; };
    return 1; })()`);
  // 方向自检：yaw 朝 +x 走 1 s
  out.dirCheck = await ev(`(() => { __tp(4.8, 0.5, -2.6); __step(20); const a = __s1.rig.body.position.clone(); __walk(Math.PI / 2, 1); const b = __s1.rig.body.position; return [+(b.x - a.x).toFixed(2), +(b.z - a.z).toFixed(2)]; })()`);
  console.log('dirCheck +x 1s', out.dirCheck); save();
  const T = [[8.6, -5.9, -0.179], [6.4, -4.7, -0.616], [11.6, -6.6, -0.503], [10.6, -4.6, 0.145], [6.7, -6.46, 3.854], [11.41, -4.11, 6.071], [8.82, -3.8, 4.37], [12.03, -4.42, 1.785], [7.83, -4.33, 3.219]];
  const fg = [[155, 3.247, 2.147], [156, 1.512, 1.088], [157, 2.799, 1.889], [158, 1.194, 0.864], [159, 0.949, 0.475], [160, 0.953, 0.598], [161, 0.648, 0.612], [162, 0.545, 0.426], [163, 0.49, 0.327]];
  const rocks = fg.map(([n, hx, hz], i) => [n, T[i][0], T[i][1], T[i][2], hx * 0.8, hz * 0.8]);
  const pierLocal = (lx, lz) => { const r = -1.23594, c = Math.cos(r), sn = Math.sin(r); return [-3.39 + lx * c + lz * sn, -9.8 - lx * sn + lz * c]; };
  out.escape = [];
  const esc = async (near, wx, wz) => { const r = await ev(`__escape(${wx}, 0.6, ${wz})`); out.escape.push({ near, req: [+wx.toFixed(2), +wz.toFixed(2)], ...r }); };
  if (PART === 'all' || PART === 'route') {
    out.routes = {};
    for (const [name, wps] of Object.entries({ '斜 NW→SE（重测）': [[9.0, -7.2], [11.8, -8.7], [14.0, -8.5]], '斜 NW→SE 绕外': [[9.0, -7.6], [10.0, -8.6], [14.0, -8.6]], 'E→W z−8.75': [[14.0, -8.75], [7.6, -8.75]] })) {
      await ev(`(__tp(${wps[0][0]}, 0.5, ${wps[0][1]}), __step(20), 1)`);
      const r = await ev(`__route(${JSON.stringify(wps.slice(1))})`); out.routes[name] = r; console.log('route', name, JSON.stringify({ ...r, trace: undefined }));
    }
    save();
  }
  if (PART === 'all' || PART === 'rocks') {
    for (const [n, x, z, ry, hx, hz] of rocks) {
      for (const [lx, lz] of [[hx + 0.3, 0], [-(hx + 0.3), 0], [0, hz + 0.3], [0, -(hz + 0.3)], [hx + 0.25, hz + 0.25], [-(hx + 0.25), -(hz + 0.25)]]) {
        const c = Math.cos(ry), s = Math.sin(ry); await esc(n, x + lx * c + lz * s, z - lx * s + lz * c);
      }
      console.log('esc', n, out.escape.filter((e) => e.near === n).map((e) => `${e.moved}${e.recall ? 'R' : ''}`).join(',')); save();
    }
  }
  if (PART === 'all' || PART === 'gaps') {
    for (let i = 0; i < rocks.length; i++) for (let j = i + 1; j < rocks.length; j++) {
      const A = rocks[i], B = rocks[j]; if (Math.hypot(A[1] - B[1], A[2] - B[2]) > 3.5) continue;
      for (const t of [0.35, 0.5, 0.65]) await esc(`gap ${A[0]}-${B[0]}`, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
    }
    console.log('gaps', out.escape.filter((e) => /^gap/.test(e.near)).map((e) => `${e.near}:${e.moved}${e.recall ? 'R' : ''}`).join(' ')); save();
  }
  if (PART === 'all' || PART === 'pier') {
    for (const lz of [-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6]) for (const lx of [1.6, 2.0, -1.6, -2.0]) { const [wx, wz] = pierLocal(lx, lz); await esc(`pier ${lx},${lz}`, wx, wz); }
    console.log('pier', out.escape.filter((e) => /^pier/.test(e.near)).map((e) => `${e.near}:${e.moved}${e.recall ? 'R' : ''}@${e.start.slice(1).join('/')}`).join(' ')); save();
  }
  if (PART === 'beach') {
    for (let x = -10; x <= 3.01; x += 1) for (const z of [-8.75, -8.3, -7.8]) await esc('beach', x, z);
    for (let lz = -6; lz <= 6; lz += 1) for (const lx of [1.6, 2.2, -1.6, -2.2]) { const [wx, wz] = pierLocal(lx, lz); if (wz > -8.9) await esc(`pier ${lx},${lz}`, wx, wz); }
    console.log('beach', out.escape.map((e) => `${e.req.join('/')}:${e.moved}${e.recall ? 'R' + JSON.stringify(e.rpos) : ''}`).join(' ')); save();
  }
  out.escapeMin = out.escape.length ? Math.min(...out.escape.map((e) => e.moved)) : null;
  out.errors = page.errors.slice(0, 6).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
