// batch13 ④ 窗口镜高亮诊断：站位世界坐标 / 局部 y / enabled
import { open, sleep, SH13 } from './b13lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b13-s3mir';
const { page, ev, must, url, rec, step, done } = await open(5573, { width: 960, height: 540 });
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 300000, 50); };
const out = {};
const D = `(() => { const s = __s3, V = s.rig.body.position.constructor; const p = s.rig.body.position.clone(); const l = s.frame.worldToLocal(p.clone());
  const r = {}; for (const k of ['window','a','b']) { const it = s.interaction.get(s.puzzles.mirrorIx[k].id); const st = it.standPoint(new V()); const sl = s.frame.worldToLocal(st.position.clone()); r[k] = { en: s.puzzles.mirrorIx[k].enabled, hl: s.puzzles.mirrorHighlighted[k], standW: st.position.toArray().map(v => +v.toFixed(2)), standL: sl.toArray().map(v => +v.toFixed(2)), point: it.point?.name ?? null }; }
  return { pW: p.toArray().map(v => +v.toFixed(2)), pL: l.toArray().map(v => +v.toFixed(2)), onGround: s.rig.body.onGround, frameW: s.frame.position.toArray(), keys: s.interaction.highlighter.keys(), cur: s.interaction.current?.id ?? null, m: r }; })()`;
await step(T, 's3', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s3&art=1&quality=standard'));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore' && !__s3.rig.controller.busy`, 400000, 's3');
  await ev(`__game.events.emit('interact:used', { id: __s3.puzzles.doorIx.id, kind: 'use' }); 1`);
  await page.waitFor(`__s3.puzzles.state.doorOpen >= 1`, 300000, 200);
  await ev(`__s3.puzzles.tide.set('low', { instant: true }); 1`); await ticks(60);
  out.tide = await ev(`(() => { const t = __s3.puzzles.tide; return { state: t.state ?? null, level: t.level ?? null }; })()`);
  out.start = await ev(D);
  // 1) 传送到窗口镜 standPoint
  await ev(`(() => { const s = __s3; const it = s.interaction.get(s.puzzles.mirrorIx.window.id); const st = it.standPoint(new s.rig.body.position.constructor()); s.rig.body.teleport(st.position.clone().setY(st.position.y + 0.05)); s.rig.controller.facing = st.facing; return 1; })()`);
  await ticks(40); out.atStand = await ev(D);
  // 2) 塔底地面：局部 (1.45, 0.2+0.05, 0)
  await ev(`(() => { const s = __s3; const w = s.frame.localToWorld(new s.rig.body.position.constructor(1.45, 0.25, 0)); s.rig.body.teleport(w); return 1; })()`);
  await ticks(40); out.atFloor = await ev(D);
  await ev(`(() => { const s = __s3; s.cameraFollow.yaw = s.rig.controller.facing; s.cameraFollow.pitch = -0.25; return 1; })()`); await ticks(30);
  await sleep(400); await page.screenshot(`${SH13}/mirror-hl-window-lowtide.png`);
  // 3) 离窗口镜 > 3.5 m 的塔底地面：局部 (-1.6, 0.25, 0)
  await ev(`(() => { const s = __s3; const w = s.frame.localToWorld(new s.rig.body.position.constructor(-1.6, 0.25, 0.6)); s.rig.body.teleport(w); return 1; })()`);
  await ticks(40); out.atFar = await ev(D);
  rec(T, 'diag', 'INFO', out);
});
writeFileSync(`${SH13}/s3-mirror-window-diag.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
