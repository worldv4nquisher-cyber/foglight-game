import { QA_DIR } from './paths.mjs';
import { readFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER, SHOTS, makeRecorder, step } from './common.mjs';
const T = 'v0.1-003';
const { rec, save } = makeRecorder('cam');
const dev = await startDev(5204);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
await page.addInit(readFileSync((QA_DIR + '/ctrl-helper.js'), 'utf8'));
await page.addInit(`
window.__cam = {
  cf: () => __testbed.cameraFollow,
  // 每帧采样直到 pred 为真或相机时钟超出 maxSec；t 用相机自身时钟（渲染 dt 累计）
  run(fn, pred, maxSec) {
    const cf = window.__cam.cf ? (window.__testbed ? __testbed.cameraFollow : __game.scenes.current.cameraFollow) : null;
    const c0 = cf.clock; const out = [];
    return new Promise((res) => { const f = () => { const t = cf.clock - c0; let o; try { o = fn(t); } catch (e) { o = { err: String(e) }; } out.push(o);
      if (t < maxSec && !(pred && pred(o, t))) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); });
  },
  // 头部到相机之间是否有几何体挡住（相机穿到墙后 = 被挡）
  clear() {
    const tb = __testbed, cf = tb.cameraFollow, cam = tb.cameraFollow.camera, p = tb.rig.body.position;
    const head = new cam.position.constructor(p.x, p.y + 1.5, p.z);
    const d = cam.position.clone().sub(head); const len = d.length(); d.normalize();
    const hit = tb.physics.sphereCast(head, d, 0.02, len);
    return { len, hit, blocked: hit < len - 0.05 };
  },
};`);
await page.goto(dev.url + '/?scene=testbed');
await page.waitFor(`window.__testbed?.rig && __game.scenes.current?.name === 'testbed'`, 90000);
await page.waitFor(`__game.input.context === 'explore'`, 30000);
await sleep(1500);
const DEG = Math.PI / 180;

await step(rec, T, '默认距离/滚轮', async () => {
  await ev(`__ctl.tp(0,0.02,4)`);
  await sleep(800);
  const d0 = await ev(`({ d: __cam.cf().distance, cur: __cam.cf().currentDistance })`);
  for (let i = 0; i < 12; i++) { await page.wheel(640, 360, 100); await sleep(120); }
  await sleep(1200);
  const dOut = await ev(`({ d: __cam.cf().distance, cur: __cam.cf().currentDistance })`);
  for (let i = 0; i < 12; i++) { await page.wheel(640, 360, -100); await sleep(120); }
  await sleep(1200);
  const dIn = await ev(`({ d: __cam.cf().distance, cur: __cam.cf().currentDistance })`);
  for (let i = 0; i < 3; i++) { await page.wheel(640, 360, 100); await sleep(120); }
  await sleep(600);
  const d3 = await ev(`__cam.cf().distance`);
  rec(T, '默认距离 4.0 m', Math.abs(d0.d - 4) < 1e-6 && Math.abs(d0.cur - 4) < 0.05 ? 'PASS' : 'FAIL', `distance=${d0.d}，实际 currentDistance=${d0.cur.toFixed(2)}（空旷处）`);
  rec(T, '滚轮可调 2.5–6.0 m', Math.abs(dOut.d - 6) < 1e-6 && Math.abs(dIn.d - 2.5) < 1e-6 ? 'PASS' : 'FAIL', `真实滚轮事件：向后滚 12 格→${dOut.d}（当前 ${dOut.cur.toFixed(2)}），向前滚 12 格→${dIn.d}（当前 ${dIn.cur.toFixed(2)}）；再向后 3 格→${d3}（每格 0.5）`);
  await ev(`__cam.cf().distance = 4`);
});

await step(rec, T, '俯仰限制', async () => {
  const r = await ev(`(async () => { const cf = __cam.cf(), inp = __game.input;
    for (let i = 0; i < 20; i++) { inp.addLook(0, -0.3); await __qa.sleep(60); } const up = cf.pitch;
    for (let i = 0; i < 40; i++) { inp.addLook(0, 0.3); await __qa.sleep(60); } const down = cf.pitch;
    cf.pitch = 0; return { up, down }; })()`);
  // 方向不预设：取两端
  const hi = Math.max(r.up, r.down) / DEG, lo = Math.min(r.up, r.down) / DEG;
  rec(T, '俯仰 -35°～+55°', Math.abs(hi - 55) < 0.01 && Math.abs(lo + 35) < 0.01 ? 'PASS' : 'FAIL', `持续大幅上/下转后 pitch 两端：${lo.toFixed(2)}° / ${hi.toFixed(2)}°`);
});

await step(rec, T, '墙体遮挡+恢复', async () => {
  await ev(`__ctl.tp(-4,0.02,-12.6)`);
  await ev(`(async () => { __cam.cf().yaw = 0; await __qa.sleep(1000); })()`);
  // 背朝墙：相机后向 (sin yaw,0,cos yaw)，yaw=π → 相机在 -z（墙一侧）
  const blocked = await ev(`(async () => { const cf = __cam.cf(); cf.yaw = Math.PI; await __qa.sleep(1200);
    return { cur: cf.currentDistance, tgt: cf.targetDistance, camZ: cf.camera.position.z, clear: __cam.clear() }; })()`);
  await page.screenshot(`${SHOTS}/003-wall-pullin.png`);
  // 转回 → 测恢复时长
  const rcv = await ev(`(async () => { const cf = __cam.cf(); cf.yaw = 0;
    const s = await __cam.run((t) => ({ t, cur: cf.currentDistance }), (o) => o.cur >= 3.999, 3); return s; })()`);
  const tDone = rcv.find((s) => s.cur >= 3.999)?.t;
  rec(T, '靠墙不穿墙：相机前拉', blocked.camZ > -13.8 && !blocked.clear.blocked && blocked.cur < 1.3 ? 'PASS' : 'FAIL',
    `角色 z=-12.6 背朝墙（墙面 z=-13.8）：currentDistance ${blocked.cur.toFixed(2)} m（目标 ${blocked.tgt.toFixed(2)}），相机 z=${blocked.camZ.toFixed(2)}，头→相机连线无遮挡=${!blocked.clear.blocked}`);
  rec(T, '遮挡解除后 0.25 s 平滑恢复', tDone !== undefined && tDone > 0.15 && tDone < 0.25 + 0.25 ? 'PASS' : 'FAIL',
    `从 ${rcv[0].cur.toFixed(2)} 恢复到 4.0 用时 ${tDone?.toFixed(3)} s（相机时钟；低帧率每帧约 ${(rcv[1]?.t - rcv[0]?.t).toFixed(2)} s，精度 ±1 帧）；中间值 ${rcv.slice(0, 6).map((s) => s.cur.toFixed(2)).join('→')}`);
  // 转一整圈检查任何角度不穿墙
  const sweep = await ev(`(async () => { const cf = __cam.cf(); const bad = []; let n = 0;
    for (let a = 0; a < 360; a += 15) { cf.yaw = a * Math.PI / 180; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await __qa.sleep(250);
      const c = __cam.clear(); n++; if (c.blocked || cf.camera.position.z < -13.8) bad.push({ a, z: cf.camera.position.z, hit: c.hit, len: c.len }); }
    cf.yaw = 0; return { n, bad }; })()`);
  rec(T, '贴墙转一圈任何角度相机不进墙', sweep.bad.length === 0 ? 'PASS' : 'FAIL', `${sweep.n} 个角度，问题 ${sweep.bad.length} 个 ${JSON.stringify(sweep.bad.slice(0, 3))}`);
});

await step(rec, T, '室内/门洞', async () => {
  await ev(`__ctl.tp(15,0.02,9)`);
  const walk = await ev(`(async () => { const cf = __cam.cf(); cf.yaw = Math.PI; await __qa.sleep(600);
    const inp = __game.input; inp.setRaw('qa','KeyW',true);
    const s = await __cam.run(() => { const p = __testbed.rig.body.position; const c = __cam.clear(); return { z: p.z, x: p.x, indoor: cf.indoor, cur: cf.currentDistance, blocked: c.blocked }; }, (o) => o.z > 13, 10);
    inp.setRaw('qa','KeyW',false); await __qa.sleep(1000); return s; })()`);
  await page.screenshot(`${SHOTS}/003-indoor.png`);
  const inside = walk.filter((s) => s.indoor);
  const maxIn = Math.max(...inside.map((s) => s.cur));
  const blockedN = walk.filter((s) => s.blocked).length;
  const yaws = await ev(`(async () => { const cf = __cam.cf(); const out = []; for (let a = 0; a < 360; a += 45) { cf.yaw = a*Math.PI/180; await __qa.sleep(500); out.push({ a, cur: +cf.currentDistance.toFixed(2), indoor: cf.indoor, blocked: __cam.clear().blocked }); } cf.yaw = Math.PI; return out; })()`);
  const maxY = Math.max(...yaws.map((y) => y.cur));
  rec(T, '穿过窄门（1.0 m）相机不穿墙', blockedN === 0 && walk[walk.length - 1].z > 12 ? 'PASS' : 'FAIL', `走 z ${walk[0].z.toFixed(2)}→${walk[walk.length - 1].z.toFixed(2)}，${walk.length} 帧中头→相机被墙挡住 ${blockedN} 帧`);
  rec(T, '室内触发体内最大距离 ≤ 2.0 m', inside.length > 0 && maxIn <= 2.0001 && maxY <= 2.0001 && yaws.every((y) => y.indoor) ? 'PASS' : 'FAIL', `走入过程 indoor 帧最大 ${maxIn.toFixed(2)} m；室内 8 个朝向距离 ${yaws.map((y) => y.cur).join('/')}`);
});

await step(rec, T, 'FOV', async () => {
  await ev(`__ctl.tp(0,0.02,4)`);
  const r = await ev(`(async () => { const cf = __cam.cf(), cam = cf.camera, inp = __game.input; const base = cam.fov;
    inp.setRaw('qa','Mouse2',true); await __qa.sleep(1500); const obs = cam.fov, observing = cf.observing, scale = inp.lookScale;
    inp.setRaw('qa','Mouse2',false); await __qa.sleep(1500); const back = cam.fov;
    inp.setRaw('qa','ShiftLeft',true); inp.setRaw('qa','KeyW',true); await __qa.sleep(2000); const run = cam.fov, running = __testbed.rig.controller.running;
    inp.setRaw('qa','ShiftLeft',false); inp.setRaw('qa','KeyW',false); await __qa.sleep(1500); const after = cam.fov;
    return { base, obs, observing, scale, back, run, running, after }; })()`);
  rec(T, '按住右键 FOV 30°，松开回 55°', Math.abs(r.obs - 30) < 0.05 && Math.abs(r.back - 55) < 0.05 && Math.abs(r.base - 55) < 0.05 ? 'PASS' : 'FAIL', `初始 ${r.base.toFixed(2)}°，按住 ${r.obs.toFixed(2)}°（observing=${r.observing}，灵敏度倍率 ${r.scale}），松开 ${r.back.toFixed(2)}°`);
  rec(T, '小跑 FOV 58°', Math.abs(r.run - 58) < 0.05 && Math.abs(r.after - 55) < 0.05 ? 'PASS' : 'FAIL', `Shift+W 小跑中 ${r.run.toFixed(2)}°（running=${r.running}），停下 ${r.after.toFixed(2)}°`);
});

await step(rec, T, '机关机位', async () => {
  await ev(`__ctl.tp(-14,0.02,2.2)`);
  const pre = await ev(`(async () => { const cf = __cam.cf(); cf.yaw = 0.7; cf.pitch = 0.2; await __qa.sleep(800); return { yaw: cf.yaw, pitch: cf.pitch }; })()`);
  const enter = await ev(`(async () => { const cf = __cam.cf(), inp = __game.input;
    inp.setRaw('qa','KeyE',true); await __qa.sleep(30); inp.setRaw('qa','KeyE',false);
    await __qa.until(() => cf.modeName === 'puzzle', 3000);
    const s = await __cam.run((t) => ({ t, b: cf.blending }), (o, t) => !o.b && t > 0.05, 3);
    await __qa.sleep(500);
    const node = __testbed.course.anchors.mechanism.cam; const wp = node.getWorldPosition(cf.camera.position.clone());
    return { s, mode: cf.modeName, ctx: inp.context, dist: wp.distanceTo(cf.camera.position), fov: cf.camera.fov }; })()`);
  const tEnter = enter.s.find((o) => !o.b)?.t;
  await page.screenshot(`${SHOTS}/003-puzzle-cam.png`);
  const look = await ev(`(async () => { const cf = __cam.cf(), inp = __game.input;
    for (let i = 0; i < 20; i++) { inp.addLook(0.2, 0.2); await __qa.sleep(60); } const a = cf.puzzleOffsetDeg;
    for (let i = 0; i < 40; i++) { inp.addLook(-0.2, -0.2); await __qa.sleep(60); } const b = cf.puzzleOffsetDeg; return { a, b, yaw: cf.yaw, pitch: cf.pitch }; })()`);
  const exit = await ev(`(async () => { const cf = __cam.cf(), inp = __game.input;
    inp.setRaw('qa','Tab',true); await __qa.sleep(30); inp.setRaw('qa','Tab',false);
    await __qa.until(() => cf.modeName === 'explore', 3000);
    const s = await __cam.run((t) => ({ t, b: cf.blending }), (o, t) => !o.b && t > 0.05, 3);
    await __qa.sleep(300); return { s, yaw: cf.yaw, pitch: cf.pitch, ctx: inp.context }; })()`);
  const tExit = exit.s.find((o) => !o.b)?.t;
  rec(T, '进入机关 0.6 s 过渡到机关机位', enter.mode === 'puzzle' && enter.dist < 0.01 && tEnter > 0.45 && tEnter < 0.85 ? 'PASS' : 'FAIL', `过渡 ${tEnter?.toFixed(3)} s（相机时钟，±1 帧≈${(enter.s[1]?.t - enter.s[0]?.t).toFixed(2)} s）；结束后相机与 mech-cam 节点距离 ${enter.dist.toFixed(4)} m；上下文 ${enter.ctx}；FOV ${enter.fov.toFixed(1)}`);
  rec(T, '机关内小范围转动 ±20°', Math.abs(Math.abs(look.a.yaw) - 20) < 0.01 && Math.abs(Math.abs(look.a.pitch) - 20) < 0.01 && Math.abs(Math.abs(look.b.yaw) - 20) < 0.01 && Math.sign(look.a.yaw) !== Math.sign(look.b.yaw) ? 'PASS' : 'FAIL', `一侧转到底 yaw ${look.a.yaw.toFixed(2)}° pitch ${look.a.pitch.toFixed(2)}°；另一侧 yaw ${look.b.yaw.toFixed(2)}° pitch ${look.b.pitch.toFixed(2)}°；探索 yaw/pitch 期间未变=${Math.abs(look.yaw - pre.yaw) < 1e-9}`);
  rec(T, '退出 0.6 s 回到探索相机，朝向恢复进入前', exit.ctx === 'explore' && Math.abs(exit.yaw - pre.yaw) < 1e-6 && Math.abs(exit.pitch - pre.pitch) < 1e-6 && tExit > 0.45 && tExit < 0.85 ? 'PASS' : 'FAIL', `过渡 ${tExit?.toFixed(3)} s；进入前 yaw ${(pre.yaw / DEG).toFixed(2)}° pitch ${(pre.pitch / DEG).toFixed(2)}°，退出后 yaw ${(exit.yaw / DEG).toFixed(2)}° pitch ${(exit.pitch / DEG).toFixed(2)}°`);
});

await step(rec, T, '观察点', async () => {
  await ev(`__ctl.tp(-8,0.02,12)`);
  await page.tap('F4'); await sleep(500);
  // 扫描 yaw（pitch 固定朝目标大致高度）求每个角度下的 alignment
  const res = await ev(`(async () => { const tb = __testbed, cf = tb.cameraFollow, v = tb.viewpoint; const tgt = new cf.camera.position.constructor(-8, 3, 0);
    const out = []; const fw = new cf.camera.position.constructor();
    cf.pitch = 0; await __qa.sleep(300);
    // 先粗找对准的 yaw / pitch：目标在 -z 方向 → yaw≈0
    let best = null;
    for (let p = -10; p <= 20; p += 2) { for (let y = -6; y <= 6; y += 2) { cf.yaw = y*Math.PI/180; cf.pitch = p*Math.PI/180; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!best || v.angleDeg < best.ang) best = { y, p, ang: v.angleDeg }; } }
    for (const dy of [0, 3, 5, 6, 7, 9, 10, 11, 12, 14, 20]) { cf.yaw = (best.y + dy) * Math.PI/180; cf.pitch = best.p*Math.PI/180;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      cf.camera.getWorldDirection(fw); const want = tgt.clone().sub(cf.camera.position).normalize(); const myAng = Math.acos(Math.min(1, Math.max(-1, want.dot(fw)))) * 180 / Math.PI;
      out.push({ dy, inRegion: v.inRegion, ang: v.angleDeg, myAng, al: v.alignment, hud: document.querySelector('.debug-panel, [class*=debug]')?.innerText.match(/观察点[^\\n]*/)?.[0] ?? null }); }
    cf.yaw = best.y*Math.PI/180; await __qa.sleep(600);
    return { best, out }; })()`);
  await page.screenshot(`${SHOTS}/003-viewpoint-aligned-f4.png`);
  const expect = (a) => (a <= 6 ? 1 : a >= 12 ? 0 : 1 - (a - 6) / 6);
  const okAll = res.out.every((o) => o.inRegion && Math.abs(o.al - expect(o.ang)) < 1e-6 && Math.abs(o.ang - o.myAng) < 1.0);
  rec(T, '观察点：≤6° 为 1，≥12° 为 0，中间线性；HUD 显示数值', okAll && res.out.some((o) => o.hud) ? 'PASS' : 'FAIL',
    res.out.map((o) => `${o.ang.toFixed(1)}°(自算 ${o.myAng.toFixed(1)}°)→${o.al.toFixed(3)}`).join('，') + `；F4 面板：「${res.out.find((o) => o.hud)?.hud ?? '无'}」`);
  const out = await ev(`(async () => { await __ctl.tp(-8,0.02,14); await __qa.sleep(400); return { inRegion: __testbed.viewpoint.inRegion, al: __testbed.viewpoint.alignment }; })()`);
  rec(T, '离开观察点区域 alignment 归 0', !out.inRegion && out.al === 0 ? 'PASS' : 'FAIL', `离中心 2 m：inRegion=${out.inRegion} alignment=${out.al}`);
  await page.tap('F4');
});

await step(rec, T, '演出镜头', async () => {
  await ev(`__ctl.tp(0,0.02,4)`);
  await ev(`(async () => { const cf = __cam.cf(); cf.yaw = 0.5; cf.pitch = 0.1; await __qa.sleep(600); })()`);
  const pre = await ev(`({ yaw: __cam.cf().yaw, pitch: __cam.cf().pitch, p: __testbed.rig.body.position.clone() })`);
  await page.tap('KeyC');
  const r = await ev(`(async () => { const cf = __cam.cf(), inp = __game.input; await __qa.until(() => cf.modeName === 'cutscene', 3000);
    inp.setRaw('qa','KeyW',true); for (let i = 0; i < 10; i++) inp.addLook(0.3, 0.1);
    const s = await __cam.run((t) => ({ t, m: cf.modeName, b: cf.blending, ctx: inp.context, x: __testbed.rig.body.position.x, z: __testbed.rig.body.position.z, yaw: cf.yaw }), (o) => o.m === 'explore' && !o.b, 12);
    const p = __testbed.rig.body.position.clone(); inp.setRaw('qa','KeyW',false); await __qa.sleep(300);
    return { s, yaw: cf.yaw, pitch: cf.pitch, p }; })()`);
  const s = r.s;
  const tEnd = s.find((o) => o.m === 'explore')?.t, tBack = s[s.length - 1].t;
  const during = s.filter((o) => o.m === 'cutscene');
  const moved = Math.max(...during.map((o) => Math.hypot(o.x - pre.p.x, o.z - pre.p.z)));
  rec(T, '演出 5 s，期间角色不动、输入为 cutscene', tEnd > 4.8 && tEnd < 5.3 && moved < 0.01 && during.every((o) => o.ctx === 'cutscene') ? 'PASS' : 'FAIL', `演出段 ${tEnd?.toFixed(2)} s（相机时钟）；期间按住 W 并转视角：角色最大位移 ${moved.toFixed(3)} m，上下文 ${[...new Set(during.map((o) => o.ctx))].join('/')}`);
  rec(T, '结束 0.8 s 交还，朝向与演出前一致', Math.abs(tBack - tEnd - 0.8) < 0.25 && Math.abs(r.yaw - pre.yaw) < 1e-6 && Math.abs(r.pitch - pre.pitch) < 1e-6 ? 'PASS' : 'FAIL', `交还过渡 ${(tBack - tEnd).toFixed(2)} s；yaw ${(pre.yaw / DEG).toFixed(2)}°→${(r.yaw / DEG).toFixed(2)}°，pitch ${(pre.pitch / DEG).toFixed(2)}°→${(r.pitch / DEG).toFixed(2)}°`);
});

save();
console.log('ERRORS', page.errors.length, page.errors.slice(0, 3));
close(); await dev.close(); process.exit(0);
