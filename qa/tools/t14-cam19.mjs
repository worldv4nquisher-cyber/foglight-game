// batch14 ② BUG-019 返工复测：真实 S2 美术场景 + 场景 PhysicsSystem + 玩家本人的 CharacterBody（真胶囊）驱动，CameraFollow.update(dt) 同步逐帧
import { open, SH14 } from './b14lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b14-cam19';
const HZ = +(process.argv[2] ?? 60);
const { page, ev, must, url, rec, step, done } = await open(5591, { width: 480, height: 270 });
const out = { hz: HZ };
await step(T, 's2', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s2&art=1&quality=standard'));
  await must(`!!window.__s2?.rig && !!__s2.art && __game.input.context === 'explore' && __s2.cameraFollow.heightCaps.length > 0`, 400000, 's2');
  out.caps = await ev(`JSON.parse(JSON.stringify(__s2.cameraFollow.heightCaps))`);
  out.body = await ev(`(() => { const b = __s2.rig.controller.body.body; return { r: b.radius, h: b.height, cls: b.constructor.name, inPhys: __s2.physics.bodies?.includes?.(b) ?? null }; })()`);
  await ev(`window.__run19 = (a, b, yawDeg, pitchDeg, speed, dt) => { const s = __s2, cf = s.cameraFollow, c = cf.heightCaps[0], ph = s.physics; const V = s.camera.position.constructor;
    const body = s.rig.controller.body.body; const hl = Math.hypot(c.dir.x, c.dir.z);
    const P = (sv, lat) => [c.origin.x + (c.dir.x / hl) * sv - (c.dir.z / hl) * lat, c.origin.z + (c.dir.z / hl) * sv + (c.dir.x / hl) * lat];
    const gy = (x, z) => { const d = ph.raycast(new V(x, 12, z), new V(0, -1, 0), 30); return d == null ? 0 : 12 - d; };
    const save = { t: cf.target, y: cf.yaw, p: cf.pitch, d: cf.distance, pos: body.position.clone() };
    const tgt = { position: new V() }; cf.target = tgt; cf.initialized = false; cf.recover = null; cf.yaw = yawDeg * Math.PI / 180; cf.pitch = pitchDeg * Math.PI / 180; cf.distance = 6;
    const A = P(...a), B = P(...b); body.teleport(new V(A[0], gy(A[0], A[1]) + 0.05, A[1]));
    const frame = () => { ph.step(dt); tgt.position.copy(body.position); cf.update(dt); };
    for (let i = 0; i < Math.round(0.7 / dt); i++) frame();
    const rows = []; let last = s.camera.position.clone(), lastD = cf.currentDistance, moving = true, after = 0, stuck = 0;
    for (let k = 1; k < 2400 && after < 1 / dt; k++) {
      if (moving) { const v = new V(B[0] - body.position.x, 0, B[1] - body.position.z); if (v.length() < 0.1 || stuck > 60) { moving = false; v.set(0, 0, 0); } else v.normalize().multiplyScalar(speed); body.velocity.x = v.x; body.velocity.z = v.z; } else { body.velocity.x = 0; body.velocity.z = 0; after++; }
      const p0 = body.position.clone(); frame(); if (moving && p0.distanceTo(body.position) < speed * dt * 0.2) stuck++;
      const d = cf.currentDistance; const phys = d < lastD - 1e-3 && !cf.heightCapped && Math.abs(d - cf.targetDistance) < 1e-3;
      rows.push([k, s.camera.position.distanceTo(last), d - lastD, phys ? 1 : 0, cf.heightCapped ? 1 : 0, cf.indoor ? 1 : 0]); last = s.camera.position.clone(); lastD = d; }
    // 来回弹：同 verify-camera 口径——非物理外推 ≥0.3 m 后 1 s 内紧跟非物理内收 ≥0.3 m
    const runs = []; for (const r of rows) { if (r[3] || Math.abs(r[2]) < 1e-4) continue; const sg = Math.sign(r[2]), cur = runs[runs.length - 1]; if (cur && cur.sg === sg && r[0] - cur.end <= 2) { cur.amt += Math.abs(r[2]); cur.end = r[0]; } else runs.push({ sg, amt: Math.abs(r[2]), st: r[0], end: r[0] }); }
    let bounce = 0; for (let i = 1; i < runs.length; i++) if (runs[i - 1].sg > 0 && runs[i].sg < 0 && runs[i - 1].amt >= 0.3 && runs[i].amt >= 0.3 && (runs[i].st - runs[i - 1].end) * dt <= 1) bounce++;
    let maxNP = 0, maxNPk = 0, maxAll = 0; for (const r of rows) { if (r[1] > maxAll) maxAll = r[1]; if (!r[3] && r[1] > maxNP) { maxNP = r[1]; maxNPk = r[0]; } }
    const capped = rows.filter(r => r[4]).length, end = body.position.clone(); const reach = Math.hypot(end.x - B[0], end.z - B[1]);
    cf.target = save.t; cf.yaw = save.y; cf.pitch = save.p; cf.distance = save.d; cf.initialized = false; body.teleport(save.pos);
    return { maxNP: +maxNP.toFixed(3), maxNPk, maxAll: +maxAll.toFixed(3), bounce, capped, n: rows.length, reach: +reach.toFixed(2), stuck };
  }; 1`);
  const paths = [
    ['沿视线出 s 3→14', [3, 0], [14, 0]], ['沿视线入 s 14→3', [14, 0], [3, 0]],
    ['横入 +lat 6→0 @s5.5', [5.5, 6], [5.5, 0]], ['横出 lat 0→+6 @s5.5', [5.5, 0], [5.5, 6]],
    ['横入 −lat 6→0 @s8', [8, -6], [8, 0]], ['横出 lat 0→−6 @s8', [8, 0], [8, -6]],
    ['斜入 s12 lat5 → s4', [12, 5], [4, 0]], ['斜出 s4 → s12 lat5', [4, 0], [12, 5]],
  ];
  const dt = 1 / HZ, lim = 0.6 * 60 / HZ; out.lim = lim; out.rows = [];
  // 制作人 batch13 三类用例先跑
  const key = [['沿视线出 s 3→14', 270, -15, 1.6], ['沿视线出 s 3→14', 315, -15, 1.6], ['沿视线出 s 3→14', 270, -15, 3.2], ['沿视线出 s 3→14', 315, -15, 3.2], ['沿视线出 s 3→14', 180, -40, 1.6], ['横出 lat 0→+6 @s5.5', 90, -30, 1.6], ['横出 lat 0→+6 @s5.5', 90, -40, 1.6], ['横出 lat 0→−6 @s8', 180, -15, 3.2]];
  out.key = [];
  for (const [name, yaw, pitch, sp] of key) { const p = paths.find(q => q[0] === name); const r = await ev(`__run19(${JSON.stringify(p[1])}, ${JSON.stringify(p[2])}, ${yaw}, ${pitch}, ${sp}, ${dt})`); out.key.push({ name, yaw, pitch, sp, ...r }); }
  rec(T, `制作人用例 ${HZ} Hz`, out.key.every(r => r.maxNP <= lim && r.bounce === 0) ? 'PASS' : 'FAIL', out.key.map(r => [r.name, r.yaw, r.pitch, r.sp, r.maxNP, r.bounce, r.reach]));
  for (const p of paths) {
    const rr = await ev(`(() => { const o = []; for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) for (const pitch of [-15, -30, -40]) for (const sp of [1.6, 3.2]) o.push([yaw, pitch, sp, __run19(${JSON.stringify(p[1])}, ${JSON.stringify(p[2])}, yaw, pitch, sp, ${dt})]); return o; })()`);
    for (const [yaw, pitch, sp, r] of rr) out.rows.push({ name: p[0], yaw, pitch, sp, ...r });
  }
  const worst = [...out.rows].sort((a, b) => b.maxNP - a.maxNP).slice(0, 5);
  out.sum = { n: out.rows.length, maxNP: worst[0].maxNP, worst: worst.map(r => [r.name, r.yaw, r.pitch, r.sp, r.maxNP]), over: out.rows.filter(r => r.maxNP > lim).length, bounce: out.rows.reduce((a, r) => a + r.bounce, 0), capped: out.rows.filter(r => r.capped > 0).length, stuck: out.rows.filter(r => r.reach > 0.5).length };
  rec(T, `${HZ} Hz 全部`, out.sum.over === 0 && out.sum.bounce === 0 ? 'PASS' : 'FAIL', out.sum);
});
writeFileSync(`${SH14}/cam19-${HZ}.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
