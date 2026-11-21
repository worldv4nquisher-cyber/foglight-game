// batch13 ⑥ BUG-019：真实 S2 场景（真实物理 / 室内触发体 / 限高带）里同步驱动 CameraFollowSystem.update(1/60)
import { open, sleep, SH13 } from './b13lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b13-cam19b';
const { page, ev, must, url, rec, step, done } = await open(5575, { width: 480, height: 270 });
const out = {};
await step(T, 's2', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s2&art=1&quality=standard'));
  await must(`!!window.__s2?.rig && !!__s2.art && __game.input.context === 'explore' && __s2.cameraFollow.heightCaps.length > 0`, 400000, 's2');
  out.caps = await ev(`JSON.parse(JSON.stringify(__s2.cameraFollow.heightCaps))`);
  const FN = `window.__run19 = (a, b, yawDeg, pitchDeg, speed, dt) => { const s = __s2, cf = s.cameraFollow, c = cf.heightCaps[0]; const V = s.camera.position.constructor;
    const hl = Math.hypot(c.dir.x, c.dir.z), hx = c.dir.x / hl, hz = c.dir.z / hl;
    const P = (sv, lat) => [c.origin.x + hx * sv - hz * lat, c.origin.z + hz * sv + hx * lat];
    const down = new V(0, -1, 0);
    const gy = (x, z) => { const d = s.physics.raycast(new V(x, 12, z), down, 30); return d == null ? null : 12 - d; };
    const saveT = cf.target, saveY = cf.yaw, saveP = cf.pitch, saveD = cf.distance;
    const dummy = { position: new V() };
    cf.target = dummy; cf.initialized = false; cf.recover = null; cf.yaw = yawDeg * Math.PI / 180; cf.pitch = pitchDeg * Math.PI / 180; cf.distance = 6;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.ceil(len / (speed * dt));
    let noGround = 0;
    const put = (k) => { const t = Math.min(k / n, 1); const [x, z] = P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); const y = gy(x, z); if (y == null) noGround++; dummy.position.set(x, y ?? 0, z); };
    put(0); for (let i = 0; i < 60; i++) cf.update(dt);
    let last = s.camera.position.clone(), maxStep = 0, maxAt = 0, capped = 0, indoor = 0, jumps = [], over = 0;
    for (let k = 1; k <= n + Math.round(1 / dt); k++) { put(k); const d0 = cf.currentDistance; cf.update(dt); const st = s.camera.position.distanceTo(last);
      if (st > maxStep) { maxStep = st; maxAt = k; }
      if (st > 0.25) jumps.push({ k, st: +st.toFixed(3), d0: +d0.toFixed(2), d1: +cf.currentDistance.toFixed(2), tgt: +cf.targetDistance.toFixed(2), capped: cf.heightCapped, indoor: cf.indoor, p: dummy.position.toArray().map(v => +v.toFixed(2)) });
      last = s.camera.position.clone(); if (cf.heightCapped) capped++; if (cf.indoor) indoor++; }
    cf.target = saveT; cf.yaw = saveY; cf.pitch = saveP; cf.distance = saveD; cf.initialized = false;
    return { maxStep: +maxStep.toFixed(3), maxAt, n, capped, indoor, noGround, jumps: jumps.slice(0, 4), nJumps: jumps.length };
  }; 1`;
  await ev(FN);
  const paths = [
    ['沿视线入 s 14→3', [14, 0], [3, 0], true], ['沿视线出 s 3→14', [3, 0], [14, 0], false],
    ['横入 lat 7→0 s 4', [4, 7], [4, 0], true], ['横入 lat −7→0 s 9', [9, -7], [9, 0], true], ['横出 lat 0→7 s 6', [6, 0], [6, 7], false],
    ['斜入 s 13 lat −6 → s 5 lat 0', [13, -6], [5, 0], true], ['带尾入 s 14.5→8', [14.5, 1], [8, 0], true], ['贴墙入 s 1.6 lat 6 → 0', [1.6, 6], [1.6, 0], true],
  ];
  const rows = [];
  for (const speed of [1.6, 3.2]) for (const pitch of [-40, -15, -30]) for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) for (const [name, a, b, ent] of paths) {
    const r = await ev(`__run19(${JSON.stringify(a)}, ${JSON.stringify(b)}, ${yaw}, ${pitch}, ${speed}, 1/60)`);
    rows.push({ name, yaw, pitch, speed, ent, ...r });
  }
  out.rows = rows;
  const enter = rows.filter(r => r.ent && r.capped > 0);
  const top = (arr) => [...arr].sort((x, y) => y.maxStep - x.maxStep).slice(0, 6);
  out.sum = { n: rows.length, nEnter: enter.length, enterOver025: enter.filter(r => r.maxStep > 0.25).length, anyOver06: rows.filter(r => r.maxStep > 0.6).length, enterTop: top(enter), anyTop: top(rows) };
  rec(T, 'BUG-019 真实场景 60 Hz 同步驱动', 'INFO', { n: out.sum.n, nEnter: out.sum.nEnter, enterOver025: out.sum.enterOver025, anyOver06: out.sum.anyOver06 });
});
writeFileSync(`${SH13}/cam19-scene.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
