import { QA_DIR } from './paths.mjs';
import { readFileSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER } from './common.mjs';
const dev = await startDev(5205);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
await page.addInit(readFileSync((QA_DIR + '/ctrl-helper.js'), 'utf8'));
await page.goto(dev.url + '/?scene=testbed');
await page.waitFor(`window.__testbed?.rig && __game.input.context === 'explore'`, 90000);
await sleep(1500);
await ev(`__ctl.tp(-4,0.02,-12.6)`);
const r = await ev(`(async () => {
  const tb = __testbed, cf = tb.cameraFollow; const out = [];
  for (let a = 0; a < 360; a += 15) { cf.yaw = a * Math.PI / 180;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await __qa.sleep(250);
    const c = cf.camera.position, p = tb.rig.body.position;
    out.push({ a, cam: [c.x, c.y, c.z].map(v => +v.toFixed(2)), p: [p.x, p.y, p.z].map(v => +v.toFixed(2)), cur: +cf.currentDistance.toFixed(2), tgt: +cf.targetDistance.toFixed(2), pitch: +cf.pitch.toFixed(3), yawNow: +(cf.yaw*180/Math.PI).toFixed(1), mode: cf.modeName, blend: cf.blending, paused: __game.paused ?? __game.isPaused?.(), clock: +cf.clock.toFixed(2) });
  }
  return out; })()`);
for (const o of r) console.log(JSON.stringify(o));
console.log('ERR', page.errors.length, page.errors.slice(0, 2));
close(); await dev.close(); process.exit(0);
