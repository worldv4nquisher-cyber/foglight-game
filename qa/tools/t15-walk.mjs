// batch15 018 打磨：S1 art=1 计数 + 出生点 + 键盘驱动走 码头 / 脚印 / 浮台路线 + 前景礁石 / 码头桩旁 8 向脱困
import { open, sleep, SH15 } from './b15lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH15}/walk`; mkdirSync(D, { recursive: true });
const Q = process.env.WQ || 'low';
const { page, ev, must, url, done } = await open(5605, { width: 960, height: 540 });
const out = { quality: Q, loads: [] };
const save = () => writeFileSync(`${D}/t15-walk.json`, JSON.stringify(out, null, 1));
const DRV = `(() => {
  const s = __s1, inp = __game.input, V = s.rig.body.position.constructor;
  const gt = () => __game.time.fixedTick * __game.time.fixedDelta;
  const pos = () => s.rig.body.position;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const steer = (tx, tz) => { const p = pos(); s.cameraFollow.yaw = Math.atan2(-(tx - p.x), -(tz - p.z)); };
  window.__tp = (x, y, z) => { s.rig.body.teleport(new V(x, y, z)); s.rig.body.velocity?.set?.(0, 0, 0); };
  window.__route = async (wps, r = 0.45) => {
    const trace = []; let stuck = null; const t0 = gt(); inp.setRaw('smoke', 'KeyW', true);
    try {
      for (let i = 0; i < wps.length; i++) {
        const [tx, tz] = wps[i]; let best = 1e9, bestG = gt(); const g0 = gt();
        for (;;) {
          steer(tx, tz); await wait(60);
          const p = pos(); const d = Math.hypot(tx - p.x, tz - p.z);
          if (!trace.length || gt() - trace[trace.length - 1][0] >= 0.5) trace.push([+(gt() - t0).toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), i]);
          if (d < r) break;
          if (d < best - 0.05) { best = d; bestG = gt(); }
          if (gt() - bestG > 2) { stuck = { wp: i, target: [tx, tz], at: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), dist: +d.toFixed(2) }; break; }
          if (gt() - g0 > 40) { stuck = { wp: i, timeout: true, at: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), dist: +d.toFixed(2) }; break; }
        }
        if (stuck) break;
      }
    } finally { inp.setRaw('smoke', 'KeyW', false); }
    const p = pos(); return { ok: !stuck, stuck, gameSec: +(gt() - t0).toFixed(2), end: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), trace };
  };
  // 8 向脱困：点上放下，每个方向按 W 0.45 s 游戏时间，看位移
  window.__escape = async (x, y, z) => {
    window.__tp(x, y, z); const g0 = gt(); while (gt() - g0 < 0.4) await wait(40);
    const st = pos().clone(); const res = [];
    for (let k = 0; k < 8; k++) {
      window.__tp(st.x, st.y + 0.02, st.z); const g1 = gt(); while (gt() - g1 < 0.15) await wait(30);
      const a = (k / 8) * Math.PI * 2; const b = pos().clone();
      s.cameraFollow.yaw = Math.atan2(-Math.sin(a), -Math.cos(a)); inp.setRaw('smoke', 'KeyW', true);
      const g2 = gt(); while (gt() - g2 < 0.45) { s.cameraFollow.yaw = Math.atan2(-Math.sin(a), -Math.cos(a)); await wait(30); }
      inp.setRaw('smoke', 'KeyW', false); const e = pos(); res.push(+Math.hypot(e.x - b.x, e.z - b.z).toFixed(2));
    }
    return { start: [st.x, st.y, st.z].map((v) => +v.toFixed(2)), disp: res, moved: res.filter((d) => d > 0.15).length };
  };
  return 1; })()`;
try {
  for (let att = 1; att <= 3; att++) {
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=${Q}&autostart=1`));
    await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 400000, 's1');
    for (let k = 0; k < 4; k++) { await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 400000, 'loads'); await sleep(3000); }
    const ls = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
    out.loads.push(ls); console.log('load', att, ls.n, ls.bad.length); if (!ls.bad.length) break; if (att === 3) throw new Error('占位');
  }
  // 计数
  out.counts = await ev(`(() => { const s = __s1; const cs = s.physics.colliders.map((c) => c.name);
    let inst = 0, lodObjs = 0; s.art.root?.traverse?.((o) => { if (o.isInstancedMesh && /rock/i.test(o.name + (o.parent?.name ?? ''))) { inst += o.count; lodObjs++; } });
    return { piles: cs.filter((n) => /^s1-pier-pile-\\d+-collider$/.test(n)).length, fgRocks: cs.filter((n) => /^s1-fg-rock-\\d+-collider$/.test(n)).map((n) => +n.match(/\\d+/)[0]),
      rockInstancedMeshes: lodObjs, rockInstancesSum: inst, artKeys: Object.keys(s.art).slice(0, 20) }; })()`);
  console.log('counts', JSON.stringify(out.counts)); save();
  // 出生点
  out.spawn = await ev(`(() => { const b = __s1.rig.body; return { pos: b.position.toArray().map((v) => +v.toFixed(3)), onGround: b.onGround, facing: +__s1.rig.controller.facing.toFixed(3) }; })()`);
  console.log('spawn', JSON.stringify(out.spawn));
  await ev(DRV);
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; return 1; })()`);
  // 1) 码头：出生点 → 岸台（涨潮，原状态）
  const pierLocal = (lx, lz) => { const r = -1.23594, c = Math.cos(r), sn = Math.sin(r); return [-3.39 + lx * c + lz * sn, -9.8 - lx * sn + lz * c]; };
  out.pier = await ev(`__route(${JSON.stringify([pierLocal(0, -3), pierLocal(0.6, 0), pierLocal(-0.6, 3), pierLocal(0, 6.6), [-11.5, -6.5]])})`);
  console.log('pier', out.pier.ok, out.pier.gameSec, JSON.stringify(out.pier.stuck), out.pier.end); save();
  // 退潮（instant）
  out.tide = await ev(`(() => { const t = __s1.puzzles.tide; t.set('low', { instant: true }); return { state: t.state, level: t.level }; })()`);
  // 2) 岸台 → 台阶 → 礁石小径 → 小径尽头
  await ev(`(__tp(-12.5, 2.5, -3), 1)`); await sleep(500);
  out.reef = await ev(`__route([[-10.3, -3], [-6.6, -3], ${JSON.stringify([[-5.9, -3], [-4.5, -1.9], [-3.2, -0.7], [-2, 0.5], [-0.8, 1.6], [0.4, 2.6], [1.8, 3.4]]).slice(1, -1)}])`);
  console.log('reef', out.reef.ok, out.reef.gameSec, JSON.stringify(out.reef.stuck), out.reef.end); save();
  // 3) 脚印路线：小径尽头 → T1..T4 中心 → 浮台边
  const decals = await ev(`__s1.dressing.decals.map((m) => { m.updateMatrixWorld(true); const p = m.getWorldPosition(m.position.clone()); return [m.name, +p.x.toFixed(2), +p.z.toFixed(2)]; })`);
  out.decals = decals;
  await ev(`(__tp(1.8, 0.4, 3.4), 1)`); await sleep(500);
  out.footprints = await ev(`__route(${JSON.stringify([...decals.map((d) => [d[1], d[2]]), [9.1, 8.7]])})`);
  console.log('footprints', out.footprints.ok, out.footprints.gameSec, JSON.stringify(out.footprints.stuck), out.footprints.end); save();
  // 4) 浮台直线路线：小径尽头 → raft.home 边（shots-031 用的 11 点直线）
  await ev(`(__tp(1.8, 0.4, 3.4), 1)`); await sleep(500);
  const a = [1.8, 3.4], h = [9.1, 10.5]; const line = []; for (let i = 1; i <= 9; i++) line.push([a[0] + (h[0] - a[0]) * i / 10, a[1] + (h[1] - a[1]) * i / 10]);
  out.pontoon = await ev(`__route(${JSON.stringify(line)})`);
  console.log('pontoon', out.pontoon.ok, out.pontoon.gameSec, JSON.stringify(out.pontoon.stuck), out.pontoon.end); save();
  // 5) 前景礁石区绕行：码头南侧滩地，绕礁石群一圈 + 穿缝
  await ev(`(__tp(4.8, 0.4, -2.6), 1)`); await sleep(500);
  out.rockLoop = await ev(`__route([[13.6, -2.6], [13.6, -8], [5, -8], [5, -2.6], [9.7, -5.0], [7.4, -5.6], [12.4, -5.5]], 0.5)`);
  console.log('rockLoop', out.rockLoop.ok, out.rockLoop.gameSec, JSON.stringify(out.rockLoop.stuck), out.rockLoop.end); save();
  // 6) 8 向脱困：每块前景礁石四边外 0.25 m + 码头桩旁（甲板两侧外滩地）
  const fg = [[155, 3.247, 2.147], [156, 1.512, 1.088], [157, 2.799, 1.889], [158, 1.194, 0.864], [159, 0.949, 0.475], [160, 0.953, 0.598], [161, 0.648, 0.612], [162, 0.545, 0.426], [163, 0.49, 0.327]];
  const rocks = await ev(`(() => { const R = __s1.physics.colliders.filter((c) => /^s1-fg-rock-/.test(c.name)); return R.map((c) => [c.name, c.position.x, c.position.z, c.rotation.y, c.geometry.parameters.width / 2, c.geometry.parameters.depth / 2]); })()`);
  out.escape = [];
  for (const [n, x, z, ry, hx, hz] of rocks) {
    for (const [lx, lz] of [[hx + 0.3, 0], [-(hx + 0.3), 0], [0, hz + 0.3], [0, -(hz + 0.3)]]) {
      const c = Math.cos(ry), s = Math.sin(ry); const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      const r = await ev(`__escape(${wx}, 0.6, ${wz})`); out.escape.push({ near: n, ...r });
    }
    console.log('esc', n, out.escape.slice(-4).map((e) => e.moved).join(',')); save();
  }
  for (const lz of [-6, -3, 0, 3, 6]) for (const lx of [1.7, -1.7]) {
    const [wx, wz] = pierLocal(lx, lz); const r = await ev(`__escape(${wx}, 0.6, ${wz})`); out.escape.push({ near: `pier ${lx},${lz}`, ...r });
  }
  console.log('esc pier', out.escape.slice(-10).map((e) => `${e.moved}@${e.start.join('/')}`).join(' '));
  out.escapeMin = Math.min(...out.escape.map((e) => e.moved));
  out.errors = page.errors.slice(0, 6).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
