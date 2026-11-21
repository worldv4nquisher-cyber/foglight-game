// batch8 ③：S3 正常顺序只爬一趟（真按住 W，按螺旋切线每 ~0.2 s 校正视角）+ 5 m 窗台视线 + 各层提示步骤
import { s3, sleep, SH } from './b8s3.mjs';
const T = '015-climb';
const S = await s3(5403, process.env.Q || 'art=0');
const { page, ev, must, rec, step, done, ft, waitSec, evs, loc, tpL, prompt } = S;
const P = `__s3.puzzles`;
const hintNow = () => ev(`(() => { __s3.hints.debugSetTime('p5', 700); const v = __s3.hints.view(); return { step: v.step, hl: [...__s3.hints.highlightIds()] }; })()`);
await ev(`(() => { const e = __s3.game.events; e.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }); __s3.tides.fixedUpdate(7); e.emit('interact:used', { id: 'door-s3', kind: 'use' }); return 1; })()`);
await waitSec(2);
const h0 = await hintNow();
await ev(`__s3.game.events.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }), 1`);
await waitSec(0.5);
const h1 = await hintNow();
rec(T, '提示按步骤：开阀前 valve（高亮油阀）→ 开阀后 window_mirror（高亮窗口镜）', h0.step === 'valve' && h0.hl.join() === 'oil-valve-s3' && h1.step === 'window_mirror' && h1.hl.join() === 'guide-mirror-s3-window' ? 'PASS' : 'FAIL', { beforeValve: h0, afterValve: h1 });
// 窗口镜解开（机关真按键已在 t8-s3a 测过）
await ev(`(() => { const m = __s3.puzzles.beam.mirrors.window.part; m.setAngle(0, 45); m.setAngle(1, -30); __s3.puzzles.beam.tracer.trace(); return 1; })()`);
await waitSec(0.5);
const h2 = await hintNow();
rec(T, '窗口镜到位后提示 → mid_a（高亮导光镜 1）', h2.step === 'mid_a' && h2.hl.join() === 'guide-mirror-s3-mid-a' ? 'PASS' : 'FAIL', h2);

// 螺旋爬楼：按住 W，视角切线 + 半径 2.5 校正
const steer = `(() => { const s = __s3, p = s.frame.worldToLocal(s.rig.body.position.clone()); const th = Math.atan2(p.z, p.x), r = Math.hypot(p.x, p.z);
  const err = 2.5 - r; const lx = -Math.sin(th) + 0.9 * err * Math.cos(th), lz = Math.cos(th) + 0.9 * err * Math.sin(th);
  const o = s.frame.localToWorld(p.clone().set(0,0,0)), w = s.frame.localToWorld(p.clone().set(lx, 0, lz)).sub(o);
  s.cameraFollow.yaw = Math.atan2(-w.x, -w.z); return { ft: __game.time.fixedTick, y: +p.y.toFixed(3), th: +(((th * 180 / Math.PI) % 360 + 360) % 360).toFixed(1), r: +r.toFixed(2) }; })()`;
async function climb(untilY, label, maxRealMs = 1500000) {
  const samples = []; const t0 = Date.now(); let stuck = null; let lastY = -9, lastFt = await ft();
  await page.keyDown('KeyW');
  while (Date.now() - t0 < maxRealMs) {
    const s = await ev(steer); samples.push(s);
    if (s.y >= untilY) break;
    if (s.y > lastY + 0.15) { lastY = s.y; lastFt = s.ft; }
    else if (s.ft - lastFt > 600) { stuck = s; break; }
    await sleep(150);
  }
  await page.keyUp('KeyW'); await waitSec(0.3);
  const a = samples[0], b = samples[samples.length - 1];
  const resp = (await evs('player:respawn', a.ft)).length;
  return { from: a, to: b, sec: +((b.ft - a.ft) / 60).toFixed(2), vy: +((b.y - a.y) / ((b.ft - a.ft) / 60)).toFixed(3), stuck, resp, n: samples.length };
}
let total = 0;
await tpL(-2.12, 0.22, 1.325, -2.6, 0.2); await waitSec(0.5);
await step(T, '底层 → 5 m 窗台平台', async () => {
  const r = await climb(4.95, 'y5'); total += r.sec;
  rec(T, '底层 → 5 m 平台（真走）', !r.stuck && !r.resp && r.to.y >= 4.95 ? 'PASS' : 'FAIL', r);
});
await step(T, '5 m 窗台：窗前站位 + 视线', async () => {
  const here = await loc();
  // 走到窗前观景点（真走：面向观景点按 W）
  await ev(`(() => { const s = __s3, w = s.frame.localToWorld(s.rig.body.position.clone().set(1.877, 5, -1.575)), p = s.rig.body.position; s.cameraFollow.yaw = Math.atan2(-(w.x - p.x), -(w.z - p.z)); return 1; })()`);
  await page.keyDown('KeyW');
  const ok = await page.waitFor(`(() => { const p = __s3.frame.worldToLocal(__s3.rig.body.position.clone()); return Math.hypot(p.x - 1.877, p.z + 1.575) < 0.35; })()`, 300000, 100);
  await page.keyUp('KeyW'); await waitSec(0.5);
  const at = await loc();
  rec(T, '5 m 平台可走到窗前', ok ? 'PASS' : 'FAIL', { landingAt: here, viewAt: at });
});
await step(T, '5 m 窗：窗外视线（射线法）', async () => {
  const at = await loc();
  const r = await ev(`(() => { const s = __s3, V = s.rig.body.position.constructor;
    // 借场景里任意 Raycaster：three 在 window 上不可见，用 Mirror / tracer 的物理射线
    const phys = s.physics; const eye = s.frame.localToWorld(new V(${at[0]}, ${at[1]} + 1.55, ${at[2]}));
    const loc = (x,y,z) => s.frame.localToWorld(new V(x,y,z));
    const T = { 'bridge-s12': loc(-8.49, 3, -8.49), 'bridge-s20': loc(-14.1, 3, -14.1), 'bridge-s30': loc(-21.2, 3, -21.2), 'S1-origin': new V(0, 2, 0), 'S2-exit': new V(-9.6, 17, 21), 'farF1': loc(152.58, 5, 129.06), 'farF2': loc(30.11, 5, 176.01), 'east-sea-95deg': null };
    // 窗外法向（θ320）方向 50 m 处的海面作对照
    T['window-normal-sea'] = loc(2.68 + 50 * Math.cos(320 * Math.PI / 180), 0.5, 50 * Math.sin(320 * Math.PI / 180));
    delete T['east-sea-95deg'];
    const out = {};
    for (const [k, p] of Object.entries(T)) { const d = p.clone().sub(eye); const len = d.length(); d.normalize();
      const h = phys.raycast ? phys.raycast(eye, d, Math.min(len, 12)) : null;
      // 世界方位（+Z 北顺时针）与相对窗法线的夹角
      const l = s.frame.worldToLocal(p.clone()), le = s.frame.worldToLocal(eye.clone());
      const th = Math.atan2(l.z - le.z, l.x - le.x) * 180 / Math.PI;
      out[k] = { blocked: h !== null ? +h.toFixed(2) : false, offWindowDeg: +(((th - 320) % 360 + 540) % 360 - 180).toFixed(1) }; }
    const wn = s.frame.localToWorld(new V(Math.cos(320*Math.PI/180), 0, Math.sin(320*Math.PI/180))).sub(s.frame.localToWorld(new V(0,0,0)));
    return { eye: [eye.x, eye.y, eye.z].map(v => +v.toFixed(2)), hasRaycast: !!phys.raycast, out, windowWorldBearing: +((Math.atan2(wn.x, wn.z) * 180 / Math.PI + 360) % 360).toFixed(1) }; })()`);
  // 截图：相机放在眼睛位置朝窗外
  await ev(`(() => { const s = __s3, V = s.rig.body.position.constructor; const p = s.frame.worldToLocal(s.rig.body.position.clone()); const t = s.frame.localToWorld(new V(p.x + Math.cos(320*Math.PI/180), p.y, p.z + Math.sin(320*Math.PI/180))), b = s.rig.body.position; s.cameraFollow.yaw = Math.atan2(-(t.x - b.x), -(t.z - b.z)); s.cameraFollow.pitch = 0.05; return 1; })()`);
  await waitSec(1.5);
  await page.mouse('mousePressed', 640, 360, 'right'); await waitSec(1.5);
  const obs = await ev(`__s3.cameraFollow.observing ?? __s3.cameraFollow.modeName`);
  await page.screenshot(`${SH}/s3-y5-window-observe.png`);
  await page.mouse('mouseReleased', 640, 360, 'right'); await waitSec(0.8);
  await page.screenshot(`${SH}/s3-y5-window.png`);
  rec(T, '5 m 窗只见雾和海（石桥 / S1 / S2 / 远处灯塔方向都被塔壁挡住）', 'INFO', { ...r, observe: obs });
});
await step(T, '5 m → 10 m 平台 A', async () => {
  const r = await climb(9.95, 'A'); total += r.sec;
  rec(T, '5 m → 10 m 平台 A（真走）', !r.stuck && !r.resp && r.to.y >= 9.95 ? 'PASS' : 'FAIL', r);
  await ev(`(() => { __s3.puzzles.beam.mirrors.a.part.setAngle(0, 60); __s3.puzzles.beam.tracer.trace(); return 1; })()`); await waitSec(0.5);
  const h = await hintNow();
  rec(T, '导光镜 1 到位后提示 → mid_b', h.step === 'mid_b' && h.hl.join() === 'guide-mirror-s3-mid-b' ? 'PASS' : 'FAIL', h);
});
await step(T, '10 m → 16 m 平台 B', async () => {
  const r = await climb(15.95, 'B'); total += r.sec;
  rec(T, '10 m → 16 m 平台 B（真走）', !r.stuck && !r.resp && r.to.y >= 15.95 ? 'PASS' : 'FAIL', r);
  await ev(`(() => { __s3.puzzles.beam.mirrors.b.part.setAngle(0, 300); __s3.puzzles.beam.tracer.trace(); return 1; })()`);
});
await step(T, '16 m → 22 m 灯室', async () => {
  const r = await climb(21.95, 'lamp'); total += r.sec;
  rec(T, '16 m → 灯室（真走，经楼梯口 θ110–182）', !r.stuck && !r.resp && r.to.y >= 21.95 ? 'PASS' : 'FAIL', r);
  await page.screenshot(`${SH}/s3-lamproom-arrive.png`);
  rec(T, '底层 → 灯室单程游戏时间（不含 5 m 窗前停留）', 'INFO', { sec: +total.toFixed(1), spec: '约 40 s' });
  const st = await ev(`({ ig: ${P}.beam.igniter.state, reached: ${P}.state.reached })`);
  rec(T, '到灯室时光路状态', 'INFO', st);
});
rec(T, 'errors', 'INFO', page.errors);
S.save('t8-climb' + (process.env.Q ? '-art' : ''));
await done(); console.log('DONE'); process.exit(0);
