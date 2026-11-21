import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5288);
const T = 'v0.1-013';
await step(T, '剪影超出视距（standard 250 m）仍渲染', async () => {
  await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
  await must(`!!window.__s1?.art && __game.input.context === 'explore' && __game.benchmark.running === false`, 300000, 'bench');
  await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
  await must(`!!window.__s1?.art && __game.input.context === 'explore'`, 300000, 'reload');
  await must(`__s1.camera.far <= 250`, 30000, 'far 250');
  await ev(`(() => { const p = __s1.rig.body.position; const sil = __s1.scene.getObjectByName('s1-sky-silhouettes'); const c = new p.constructor(); sil.children[0].getWorldPosition(c); const d = new p.constructor(); sil.children[1].getWorldPosition(d); c.add(d).multiplyScalar(0.5); __s1.cameraFollow.yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z)); return 1; })()`);
  await sleep(2500);
  const info = await ev(`(() => { const c = __s1.camera; const sil = __s1.scene.getObjectByName('s1-sky-silhouettes'); return { far: c.far, dist: sil.children.map(ch => +ch.getWorldPosition(c.position.clone()).distanceTo(c.position).toFixed(1)) }; })()`);
  await page.screenshot(`${SH}/013-silhouettes-on.png`);
  await ev(`(__s1.scene.getObjectByName('s1-sky-silhouettes').visible = false, 1)`); await sleep(1500);
  await page.screenshot(`${SH}/013-silhouettes-off.png`);
  await ev(`(__s1.scene.getObjectByName('s1-sky-silhouettes').visible = true, 1)`);
  rec(T, 'sil info', 'INFO', info);
});
await done(); console.log('DONE');
