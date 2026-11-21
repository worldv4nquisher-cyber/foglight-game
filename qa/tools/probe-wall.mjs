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
  const tb = __testbed, cf = tb.cameraFollow, ph = tb.physics, V = cf.camera.position.constructor;
  __game.pause('user'); await __qa.sleep(300);
  const p = tb.rig.body.position.clone();
  const out = [];
  for (const a of [90, 105, 120, 150, 180, 210, 225, 240, 270]) {
    cf.yaw = a * Math.PI / 180; cf.pitch = 0;
    for (let i = 0; i < 60; i++) cf.update(1/60);
    const c = cf.camera.position.clone();
    const head = new V(p.x, p.y + 1.5, p.z);
    const dir = c.clone().sub(head); const len = dir.length(); dir.normalize();
    const back = new V(Math.sin(cf.yaw), 0, Math.cos(cf.yaw));
    out.push({ a, cam: [c.x, c.y, c.z].map(v => +v.toFixed(2)), cur: +cf.currentDistance.toFixed(2), tgt: +cf.targetDistance.toFixed(2),
      castHeadToCam: +ph.sphereCast(head, dir, 0.02, len).toFixed(2), len: +len.toFixed(2),
      castBack01: +ph.sphereCast(head, back, 0.1, 6).toFixed(2), castBack0: +ph.sphereCast(head, back, 0.001, 6).toFixed(2) });
  }
  // 恢复曲线：先挡住再转开，手动 1/120 s 步进
  cf.yaw = Math.PI; for (let i = 0; i < 60; i++) cf.update(1/60);
  const from = cf.currentDistance; cf.yaw = 0; const curve = []; let t = 0;
  for (let i = 0; i < 120; i++) { cf.update(1/120); t += 1/120; curve.push([+t.toFixed(4), +cf.currentDistance.toFixed(3)]); if (cf.currentDistance >= 4 - 1e-4) break; }
  // 机关过渡：手动步进
  return { p: [p.x, p.y, p.z], out, from, curve };
})()`);
console.log(JSON.stringify(r, null, 0));
console.log('ERR', page.errors.length, page.errors.slice(0, 2));
close(); await dev.close(); process.exit(0);
