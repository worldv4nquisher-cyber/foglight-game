// batch19 ①：游戏内（非演出）体积灯束：探索态直接 lamp.setOn(true)，冻结旋转，按 4 个角度在 桥尾出生点（跟随相机）/ 塔外仰视 / 灯室内（跟随相机）截图，volume 与 legacy 同帧对比
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/beam`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5661, { width: 1280, height: 720 });
const out = { views: [] };
const save = () => writeFileSync(`${D}/t19-beam.json`, JSON.stringify(out, null, 1));
const raf = () => ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3'); log('s3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore'); log('explore');
  out.bad = await ev(`__game.assets.loadStats.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop())`);
  await ev(`(() => { __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; const L = __s3.puzzles.lamp; L.setOn(true); L.update = () => {}; __s3.__cfu = __s3.cameraFollow.update; return 1; })()`);
  const put = (x, y, z) => `(() => { const s = __s3; const w = s.frame.localToWorld(s.rig.body.position.clone().set(${x}, ${y}, ${z})); s.rig.body.position.copy(w); s.rig.body.velocity.set(0, 0, 0); return 1; })()`;
  const views = [
    { tag: 'spawn', setup: null },
    { tag: 'tower-up', setup: `(() => { const s = __s3, c = s.camera, V = c.position.constructor; s.cameraFollow.update = () => {}; const o = s.frame.localToWorld(new V(0, 23.55, 0)); const e = s.frame.localToWorld(new V(-14, 4, -14)); c.position.copy(e); c.lookAt(o.clone().add(new V(0, 3, 0))); c.fov = 55; c.updateProjectionMatrix(); return 1; })()` },
    { tag: 'lamp-room', setup: put(-2.462, 22.1, -0.434), follow: true },
  ];
  for (const v of views.filter((x) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(x.tag))) {
    if (v.setup) { if (v.follow) { await ev(`(() => { const s = __s3; if (s.__cfu) s.cameraFollow.update = s.__cfu; return 1; })()`); } await ev(v.setup); for (let i = 0; i < 4; i++) { await raf(); await sleep(500); } }
    else await ev(`(() => { const s = __s3; s.__cfu = s.cameraFollow.update; return 1; })()`);
    for (const deg of (process.env.DEGS ?? '0,45,90,135').split(',').map(Number)) {
      for (const st of ['volume', 'legacy']) {
        await ev(`(() => { const L = __s3.puzzles.lamp; L.beam.beams.rotation.y = ${deg} * Math.PI / 180; L.setStyle('${st}'); return 1; })()`);
        await raf(); await raf();
        const f = `${D}/beam-${v.tag}-${deg}-${st}.png`; await page.screenshot(f);
        const cam = await ev(`(() => { const c = __s3.camera, o = __s3.frame.worldToLocal(c.position.clone()); return { cam: o.toArray().map((x) => +x.toFixed(2)), mode: __s3.cameraFollow.modeName }; })()`);
        out.views.push({ view: v.tag, deg, style: st, f, ...cam }); save(); log(v.tag, deg, st);
      }
    }
  }
  await ev(`(__s3.puzzles.lamp.setStyle('volume'), 1)`);
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
