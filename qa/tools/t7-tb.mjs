import { open, sleep, SH } from './b7lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5301);
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v; for (const n of ['interact:used']) v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed })); } }); })();`);
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`__game.scenes.current?.name === 'testbed' && !!window.__testbed?.rig && __game.input.context === 'explore'`, 240000, 'tb');
await sleep(1500);
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 300000, 'wait'); };
const tp = (x, y, z, f) => ev(`(() => { const tb = __testbed; tb.interaction.cancel?.(); tb.rig.body.teleport(new tb.rig.body.position.constructor(${x}, ${y}, ${z})); ${f !== undefined ? `tb.rig.controller.facing = ${f}; tb.cameraFollow.yaw = ${f} + Math.PI;` : ''} return 1; })()`);
const pos = () => ev(`__testbed.rig.body.position.toArray().map(v => +v.toFixed(3))`);

await step('004', 'use 走位（949127e，batch5 同方法 p5-fix）×5', async () => {
  const out = [];
  for (let k = 0; k < 5; k++) {
    await ev(`(() => { const tb = __testbed; const p = tb.rig.body.position.clone(); p.set(16, 0.02, -2); tb.interaction.cancel(); tb.rig.body.teleport(p); tb.rig.controller.facing = -Math.PI / 2; tb.cameraFollow.yaw = Math.PI / 2; return 1; })()`);
    await sleep(1500);
    const f0 = await ft(); const e0 = await ev('__game.time.elapsed');
    await page.tap('KeyE');
    await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.ft > ${f0})`, 60000, 'used');
    const u = await ev(`__ev.filter(x => x.n === 'interact:used' && x.ft > ${f0}).at(-1)`);
    out.push({ fixedSec: +((u.ft - f0) / 60).toFixed(3), elapsedSec: +(u.el - e0).toFixed(3) });
    await waitSec(3);
  }
  const fx = out.map(o => o.fixedSec);
  rec('004', 'use 走位 固定步长', Math.max(...fx) <= 0.4 ? 'PASS' : 'FAIL', { runs: out, min: Math.min(...fx), max: Math.max(...fx), first: fx[0] });
});

await step('002', '螺旋楼梯竖直速度（bc26a68）走 / Shift', async () => {
  const sp = await ev(`(() => { const s = __testbed.course.anchors.spiral; return { c: s.center.toArray(), r: s.walkRadius, n: s.steps, a: s.stepAngle, riser: s.riser }; })()`);
  const P = (ang, r = sp.r) => [sp.c[0] + r * Math.cos(ang), sp.c[2] + r * Math.sin(ang)];
  const climb = async (shift, down) => {
    const pts = [];
    if (!down) { for (let i = 0; i < sp.n; i++) pts.push(P((i + 0.5) * sp.a)); }
    else { for (let i = sp.n - 1; i >= 0; i--) pts.push(P((i + 0.5) * sp.a)); pts.push(P(-0.6 * sp.a)); }
    if (!down) { const [x, z] = P(-0.7 * sp.a); await tp(x, 0.05, z); }
    else { const [x, z] = P((sp.n - 0.5) * sp.a); await tp(x, sp.n * sp.riser + 0.05, z); }
    await sleep(800);
    const samples = []; let i = 0; const end = Date.now() + 240000;
    if (shift) await page.keyDown('ShiftLeft');
    await page.keyDown('KeyW');
    try {
      while (i < pts.length && Date.now() < end) {
        const s = await ev(`(() => { const tb = __testbed, b = tb.rig.body.position; return { ft: __game.time.fixedTick, x: b.x, y: b.y, z: b.z, gait: tb.rig.controller.stairs?.speed ?? null }; })()`);
        samples.push(s);
        const [tx, tz] = pts[i];
        if (Math.hypot(tx - s.x, tz - s.z) < 0.3) { i++; continue; }
        await ev(`(() => { const tb = __testbed; tb.cameraFollow.yaw = Math.atan2(-(${tx} - tb.rig.body.position.x), -(${tz} - tb.rig.body.position.z)); return 1; })()`);
        await sleep(120);
      }
    } finally { await page.keyUp('KeyW'); if (shift) await page.keyUp('ShiftLeft'); }
    const top = sp.n * sp.riser;
    const mid = samples.filter(s => s.y > 0.8 && s.y < top - 0.8);
    if (mid.length < 3) return { reached: i >= pts.length, n: mid.length, last: samples.at(-1) };
    const a = mid[0], b = mid.at(-1);
    const vy = (b.y - a.y) / ((b.ft - a.ft) / 60);
    const hs = []; for (let k = 1; k < mid.length; k++) { const dt = (mid[k].ft - mid[k - 1].ft) / 60; if (dt > 0) hs.push(Math.hypot(mid[k].x - mid[k - 1].x, mid[k].z - mid[k - 1].z) / dt); }
    return { reached: i >= pts.length, vy: +vy.toFixed(4), horiz: +(hs.reduce((p, c) => p + c, 0) / hs.length).toFixed(3), gaitSpeed: mid.at(-1).gait, span: [+a.y.toFixed(2), +b.y.toFixed(2)], fixedSec: +((b.ft - a.ft) / 60).toFixed(2) };
  };
  const r = { upWalk: await climb(false, false), upShift: await climb(true, false), downWalk: await climb(false, true), downShift: await climb(true, true) };
  await page.screenshot(`${SH}/002-spiral.png`);
  const ok = Object.values(r).every(v => v.vy !== undefined && Math.abs(Math.abs(v.vy) - 0.5455) < 0.03);
  rec('002', '楼梯竖直 ≈0.5455、Shift 不影响', ok ? 'PASS' : 'FAIL', { spiral: sp, ...r });
});

await step('012', 'testbed BEAM_Y 0.85（e0b1cc1）', async () => {
  const b = await ev(`(() => { const a = __testbed.beamArea; const ys = []; for (const p of a.tracer.paths) for (const s of p.segments) ys.push([p.emitter.id, +s.from.y.toFixed(3), +s.to.y.toFixed(3)]);
    const n = (k) => { const o = __testbed.scene.getObjectByName(k); if (!o) return null; const v = o.getWorldPosition(o.position.clone()); return +v.y.toFixed(3); };
    return { ys, lamp: n('beam-lamp-emitter'), mA: n('beam-mirror-a-yaw'), mB: n('beam-mirror-b-yaw'), lock: n('beam-lock-receiver'), lens: n('beam-lock-lens') }; })()`);
  const lampSegs = b.ys.filter(s => s[0] === 'beam-lamp');
  const ok = [b.lamp, b.mA, b.mB, b.lock, b.lens].every(y => Math.abs(y - 0.85) < 0.005) && lampSegs.every(s => Math.abs(s[1] - 0.85) < 0.01 && Math.abs(s[2] - 0.85) < 0.01);
  rec('012', 'testbed 光高 0.85', ok ? 'PASS' : 'FAIL', b);
});

await step('BUG-007', '礁石坡接缝真实走（af76df6）', async () => {
  await page.tap('KeyY'); await must(`!__testbed.tideArea.tide.transitioning && __testbed.tideArea.tide.state === 'low'`, 400000, 'low');
  const out = [];
  for (const [x, z] of [[0, 23], [0.5, 23], [-0.6, 23], [0, 23.1], [0, 23.2], [0, 23.5], [0.3, 23.85]]) {
    await tp(x, 2.02, z, 0); await ev(`__testbed.cameraFollow.yaw = Math.PI; 1`); await sleep(400);
    await page.keyDown('KeyW'); await waitSec(4); await page.keyUp('KeyW'); await waitSec(0.3);
    const p = await pos(); out.push({ from: [x, z], to: p, passed: p[2] > 26 });
    if (x === 0 && z === 23) await page.screenshot(`${SH}/bug007-regress.png`);
  }
  rec('BUG-007', '接缝不卡', out.every(o => o.passed) ? 'PASS' : 'FAIL', out);
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE'); process.exit(0);
