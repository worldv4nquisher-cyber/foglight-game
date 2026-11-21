// batch13 ③-d 钥匙站位：相机朝向正确（yaw = facing + π）时 E 选中哪个，扫俯仰 / 偏航
import { open, sleep, EVLOG, SH13 } from './b13lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b13-keypick';
const { page, ev, must, url, rec, step, done } = await open(5575, { width: 960, height: 540 });
await page.addInit(EVLOG);
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 120000, 50); };
const out = { sweep: [] };
await step(T, 'run', async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=s2&art=1&quality=standard`));
  await must(`!!window.__s2?.rig && !!__s2.art?.loaded && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 's2');
  await ev(`__game.events.emit('receiver:activated', { id: __s2.puzzles.beam.lock.id }); 1`);
  await page.waitFor(`__s2.puzzles.state.doorOpen >= 1`, 180000, 100);
  await ev(`(() => { const s = __s2; const st = s.interaction.get('cellar-key-s2').standPoint(new s.rig.body.position.constructor()); s.rig.body.teleport(st.position.clone().setY(st.position.y + 0.05)); s.rig.controller.facing = st.facing; window.__kf = st.facing; return 1; })()`);
  await ticks(40);
  out.stand = await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; const f = (id) => { const it = s.interaction.get(id); return it ? it.focus(new V()).toArray().map(v => +v.toFixed(3)) : null; }; return { pos: s.rig.body.position.toArray().map(v => +v.toFixed(2)), facing: +__kf.toFixed(3), camYaw0: +s.cameraFollow.yaw.toFixed(3), camPitch0: +s.cameraFollow.pitch.toFixed(3), keyF: f('cellar-key-s2'), sketchF: f('sketch-s2'), cur: s.interaction.current?.id ?? null }; })()`);
  const Q = `(() => { const s = __s2, V = s.rig.body.position.constructor; const n = (id) => { const it = s.interaction.get(id); const p = it.focus(new V()).project(s.camera); return [+p.x.toFixed(3), +p.y.toFixed(3)]; }; return { cur: s.interaction.current?.id ?? null, key: n('cellar-key-s2'), sketch: n('sketch-s2'), yaw: +s.cameraFollow.yaw.toFixed(3), pitch: +s.cameraFollow.pitch.toFixed(3) }; })()`;
  for (const dy of [0, -0.25, 0.25]) for (const p of [-0.6, -0.45, -0.3, -0.16, 0]) {
    await ev(`(() => { const c = __s2.cameraFollow; c.yaw = __kf + Math.PI + (${dy}); c.pitch = ${p}; return 1; })()`); await ticks(12);
    out.sweep.push({ dy, p, ...(await ev(Q)) });
  }
  // 默认俯仰 -0.16、正对
  await ev(`(() => { const c = __s2.cameraFollow; c.yaw = __kf + Math.PI; c.pitch = -0.16; return 1; })()`); await ticks(20);
  out.e = { before: await ev(Q) }; await sleep(300); await page.screenshot(`${SH13}/key-stand-aligned.png`);
  const f0 = await ev('__game.time.fixedTick');
  await page.tap('KeyE'); await ticks(90);
  out.e.events = await ev(`__ev.filter(e => e.ft >= ${f0} && /interact|reader/.test(e.n)).map(e => e.n + ':' + (e.e?.id ?? e.e?.docId ?? ''))`);
  out.e.hasKey = await ev('__s2.puzzles.state.hasKey');
  rec(T, 'keypick', 'INFO', out);
});
writeFileSync(`${SH13}/cellar-keypick.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
