// batch21 ②补：缝里慢速原地转（0.4 rad/s，yaw −1.6→+1.6 经过朝北礁石），细采最小相机–头距离；俯视看淡出的汐截图
import { open, sleep, SH16 as SH } from './b21lib.mjs';
import { HOOK } from './t21-camlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/bug028`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5695, { width: 1280, height: 720 });
const out = { segs: [], rec: {} }; const save = () => writeFileSync(`${D}/t21-cam-fine.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const put = (x, yaw, pitch = -0.3) => `(() => { const s = __s1, V = s.rig.body.position.constructor; s.puzzles.tide.set('low', { instant: true }); s.rig.body.teleport(new V(${x}, 0.6, -8.6)); s.rig.body.velocity?.set?.(0, 0, 0); s.rig.controller.facing = ${yaw} + Math.PI; __cam.yaw = ${yaw}; __cam.pitch = ${pitch}; __cam.spin = 0; return 1; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await ev(HOOK);
  for (const x of [8, 10.5, 12]) {
    const name = `slowspin-x${x}`;
    await ev(put(x, -1.6)); await ev(`__gwait(0.8)`); await ev(`(__cam.rec = [], __cam.last = null, __cam.spin = 0.4, 1)`);
    await ev(`(async () => { while (__cam.yaw < 1.6) await new Promise((r) => setTimeout(r, 40)); return 1; })()`);
    const rec = await ev(`(() => { __cam.spin = 0; const r = __cam.rec; __cam.rec = null; return r; })()`); const sm = await ev(`__summ(${JSON.stringify(rec)})`);
    out.segs.push({ name, ...sm }); out.rec[name] = rec; log(name, JSON.stringify(sm)); save();
  }
  for (const [x, yaw, pitch, nm] of [[10.5, 0, -0.9, 'lookdown-north-x10.5'], [10.5, 0.15, -0.6, 'lookdown-yaw0.15-x10.5']]) {
    await ev(put(x, yaw, pitch)); await ev(`__gwait(1.5)`);
    const st = await ev(`(() => ({ a: __s1.xiNearAlpha, hd: __s1.cameraFollow.headDistance, lift: __s1.cameraFollow.lift, mat: __mat() }))()`);
    await ev(`(__game.time.timeScale = 0, 1)`); await sleep(2500); await page.screenshot(`${D}/${nm}.png`); await ev(`(__game.time.timeScale = 1, 1)`);
    out.segs.push({ name: nm, ...st, shot: `${nm}.png` }); log(nm, JSON.stringify(st)); save();
  }
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
