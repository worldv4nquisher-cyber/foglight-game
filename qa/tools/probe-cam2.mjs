import { QA_DIR } from './paths.mjs';
import { readFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER } from './common.mjs';
const dev = await startDev(5206);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
await page.addInit(readFileSync((QA_DIR + '/ctrl-helper.js'), 'utf8'));
await page.goto(dev.url + '/?scene=testbed');
await page.waitFor(`window.__testbed?.rig && __game.input.context === 'explore'`, 90000);
await sleep(1500);
await ev(`__ctl.tp(-4,0.02,-12.6)`);
const r = await ev(`(async () => {
  const tb = __testbed, cf = tb.cameraFollow; const res = {};
  const inWall = (c) => c.x > -11 && c.x < 3 && c.z < -13.8 && c.z > -14.2 && c.y < 2.5;
  const behind = (c) => c.z < -14.2 && c.y < 2.5;
  // 1) 俯仰极端值下贴墙一圈（同步步进）
  res.sweep = [];
  for (const pd of [-35, 0, 55]) { let bad = 0, over = 0, n = 0;
    for (let a = 0; a < 360; a += 5) { cf.yaw = a*Math.PI/180; cf.pitch = pd*Math.PI/180; for (let i = 0; i < 40; i++) cf.update(1/60);
      const c = cf.camera.position; n++; if (inWall(c) || behind(c)) bad++; if (c.z < -13.8 && c.y >= 2.5) over++; }
    res.sweep.push({ pitchDeg: pd, n, bad, overWallTop: over }); }
  cf.pitch = -0.3;
  // 2) 机关进入/退出过渡（同步 1/120 s 步进）
  await __ctl.tp(-14, 0.02, 2.2);
  cf.yaw = 0.7; cf.pitch = 0.2; for (let i = 0; i < 30; i++) cf.update(1/60);
  tb.enterMechanism(); let t = 0; cf.update(0); 
  while (cf.blending && t < 3) { cf.update(1/120); t += 1/120; } res.enter = +t.toFixed(4);
  tb.exitMechanism(); t = 0; while (cf.blending && t < 3) { cf.update(1/120); t += 1/120; } res.exit = +t.toFixed(4);
  res.after = { yaw: cf.yaw, pitch: cf.pitch, ctx: __game.input.context };
  // 3) 空旷处默认距离
  await __ctl.tp(5, 0.02, 0); cf.yaw = 0; cf.pitch = -0.3; for (let i = 0; i < 60; i++) cf.update(1/60);
  res.open = { d: cf.distance, cur: cf.currentDistance };
  await __ctl.tp(0, 0.02, 4); cf.yaw = 0; for (let i = 0; i < 60; i++) cf.update(1/60);
  res.spawn = { cur: cf.currentDistance, cam: cf.camera.position.toArray().map(v => +v.toFixed(2)) };
  return res; })()`);
console.log(JSON.stringify(r, null, 0));
console.log('ERR', page.errors.length, page.errors.slice(0, 2));
close(); await dev.close(); process.exit(0);
