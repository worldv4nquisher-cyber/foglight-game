// batch12 裁定 19 手动：S2 西窗外第三人称相机限高 + 平滑（固定步读数）
import { open, sleep } from './b12lib.mjs';
const T = 'b12-cam19';
const { page, ev, must, url, rec, step, done } = await open(5545, { width: 480, height: 270 });
const waitG = async (s) => { const f = await ev('__game.time.fixedTick'); await must(`__game.time.fixedTick >= ${f + Math.round(s * 60)}`, 300000, 'wait'); };
const REC = `(() => { const s = __s2, cf = s.cameraFollow, c = cf.heightCaps[0]; window.__cr = []; const gen = (window.__crGen = (window.__crGen || 0) + 1); const loop = () => { if (gen !== window.__crGen) return; { const cam = s.camera.position, p = s.rig.body.position; const hl = Math.hypot(c.dir.x, c.dir.z), hx = c.dir.x / hl, hz = c.dir.z / hl; const px = cam.x - c.origin.x, pz = cam.z - c.origin.z, sv = px * hx + pz * hz, lat = Math.abs(px * hz - pz * hx); const core = sv >= c.from && sv <= c.to && lat <= c.halfWidth; const lineY = c.origin.y + c.dir.y / hl * sv; __cr.push({ t: __game.time.elapsed, ft: __game.time.fixedTick, cy: +cam.y.toFixed(3), tgt: cf.targetDistance, cx: cam.x, cz: cam.z, py: p.y, px: p.x, pz: p.z, core, lim: lineY - c.margin, capped: cf.heightCapped, d: cf.currentDistance }); if (window.__crOn) requestAnimationFrame(loop); } }; window.__crOn = true; loop(); return 1; })()`;
await step(T, 's2', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s2&art=1&quality=standard'));
  await must(`!!window.__s2?.rig && !!__s2.art && __game.input.context === 'explore' && __s2.cameraFollow.heightCaps.length > 0`, 400000, 's2');
  const cap = await ev(`JSON.parse(JSON.stringify(__s2.cameraFollow.heightCaps))`);
  rec(T, '限高带参数', 'INFO', cap);
  const c = cap[0], hl = Math.hypot(c.dir.x, c.dir.z), hx = c.dir.x / hl, hz = c.dir.z / hl;
  const at = (sv, lat = 0) => [c.origin.x + hx * sv + hz * lat, c.origin.z + hz * sv - hx * lat];
  // 站在带内三处：玩家背对字组（相机在玩家与眼位之间的方向往后 = 朝窗），俯仰压到 -35°、距离拉到 6
  const res = [];
  for (const sv of (process.env.SKIP1 ? [] : [c.from + 1, (c.from + c.to) / 2, c.to - 1])) {
    const [x, z] = at(sv);
    await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(${x}, 6, ${z})); s.rig.body.velocity.set(0,0,0); const cf = s.cameraFollow; cf.yaw = Math.atan2(${-hx}, ${-hz}) + Math.PI; cf.pitch = -35 * Math.PI / 180; cf.distance = 6; return 1; })()`);
    await waitG(2);
    await ev(REC); await waitG(1); await ev('window.__crOn = false, 1');
    const r = await ev('__cr');
    const core = r.filter(o => o.core);
    res.push({ s: +sv.toFixed(2), playerY: +r.at(-1).py.toFixed(2), camY: r.at(-1).cy, lim: +r.at(-1).lim.toFixed(2), capped: r.at(-1).capped, dist: +r.at(-1).d.toFixed(2), coreFrames: core.length, over: core.filter(o => o.cy > Math.max(o.lim, o.py + 0.5 + 1.0) + 0.02).length });
  }
  rec(T, '带内相机高度 ≤ 视线 − 1.3 m（或支点 +0.5 下限）', res.every(o => o.over === 0) ? 'PASS' : 'FAIL', res);
  // 平滑：带中段横向走出带（D 3 s）再走回（A 3 s），每帧位移速率
  const [x, z] = at((c.from + c.to) / 2);
  await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(${x}, 6, ${z})); s.rig.body.velocity.set(0,0,0); const cf = s.cameraFollow; cf.yaw = Math.atan2(${-hx}, ${-hz}) + Math.PI; cf.pitch = -35 * Math.PI / 180; cf.distance = 6; return 1; })()`);
  await waitG(2);
  const sm = {};
  for (const k of ['KeyD', 'KeyA', 'KeyS', 'KeyW']) {
    await ev(REC); await page.keyDown(k); await waitG(3); await page.keyUp(k); await waitG(0.5); await ev('window.__crOn = false, 1');
    const r = await ev('__cr'); (await import('node:fs')).writeFileSync(`out/b12-cam19-${k}.json`, JSON.stringify(r));
    let maxCam = 0, maxPl = 0, maxDy = 0, capFlips = 0;
    for (let i = 1; i < r.length; i++) { const dt = r[i].t - r[i - 1].t; if (dt <= 1e-6) continue; const dc = Math.hypot(r[i].cx - r[i - 1].cx, r[i].cy - r[i - 1].cy, r[i].cz - r[i - 1].cz) / dt; const dp = Math.hypot(r[i].px - r[i - 1].px, r[i].py - r[i - 1].py, r[i].pz - r[i - 1].pz) / dt; maxCam = Math.max(maxCam, dc); maxPl = Math.max(maxPl, dp); maxDy = Math.max(maxDy, Math.abs(r[i].cy - r[i - 1].cy) / dt); if (r[i].capped !== r[i - 1].capped) capFlips++; }
    sm[k] = { frames: r.length, gameS: +(r.at(-1).t - r[0].t).toFixed(2), camYRange: [Math.min(...r.map(o => o.cy)), Math.max(...r.map(o => o.cy))], maxCamSpeed: +maxCam.toFixed(2), maxPlayerSpeed: +maxPl.toFixed(2), maxCamVy: +maxDy.toFixed(2), capFlips, coreOver: r.filter(o => o.core && o.cy > Math.max(o.lim, o.py + 1.5) + 0.02).length };
  }
  const jumpy = Object.values(sm).some(o => o.maxCamSpeed > Math.max(12, o.maxPlayerSpeed * 3));
  rec(T, '窗外走动相机不跳（每帧速率 vs 玩家速率）', jumpy ? 'FAIL' : 'PASS', sm);
});
await done(); console.log('DONE');
