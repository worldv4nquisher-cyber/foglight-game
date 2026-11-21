// batch20 ④补：#157 南沿缝里跟随相机距离探针（往东 / 往西 / 站立），找出把相机拉进头的挡体
import { open, sleep, SH16 as SH } from './b20lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/sand`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5686, { width: 1280, height: 720 });
const out = { probes: [] }; const save = () => writeFileSync(`${D}/t20-cam-strip.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const PR = `(() => { const s = __s1, cf = s.cameraFollow, V = s.rig.body.position.constructor, ph = s.physics;
  const gt = () => __game.time.fixedTick * __game.time.fixedDelta; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__probe = async (x, z, yaw, walk) => { s.rig.body.teleport(new V(x, 0.6, z)); s.rig.body.velocity?.set?.(0, 0, 0); cf.yaw = yaw;
    let g0 = gt(); while (gt() - g0 < 0.6) { cf.yaw = yaw; await wait(30); }
    if (walk) __game.input.setRaw('smoke', 'KeyW', true); g0 = gt(); while (gt() - g0 < 1.2) { cf.yaw = yaw; await wait(30); } __game.input.setRaw('smoke', 'KeyW', false);
    g0 = gt(); while (gt() - g0 < 0.3) { cf.yaw = yaw; await wait(30); }
    const p = s.rig.body.position.clone(), head = p.clone(); head.y += 1.35; const cam = s.camera.position;
    const right = new V(Math.cos(yaw), 0, -Math.sin(yaw)); const side = ph.sphereCast(head, right, 0.2, 0.4);
    const pivot = head.clone().addScaledVector(right, side); const back = cam.clone().sub(pivot); const bl = back.length(); back.normalize();
    const hits = []; for (const c of ph.colliders) { if (!c.enabled) continue; for (let d = 0; d <= 4; d += 0.1) { const q = pivot.clone().addScaledVector(back.lengthSq() ? back : right, d); if (c.bounds.distanceToPoint(q) < 0.2) { hits.push(c.name + '@' + d.toFixed(1)); break; } } }
    return { at: [x, z], yaw: +yaw.toFixed(3), walk, body: p.toArray().map((v) => +v.toFixed(2)), cam: cam.toArray().map((v) => +v.toFixed(2)), camToHead: +cam.distanceTo(head).toFixed(3),
      distance: +(+cf.distance).toFixed(3), targetDistance: +(+cf.targetDistance).toFixed(3), side: +side.toFixed(3), pitch: +(+cf.pitch).toFixed(3), boundsNearBackRay: hits.slice(0, 12) }; };
  return 1; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await sleep(2000); await ev(PR);
  const E = -Math.PI / 2, W = Math.PI / 2;
  for (const [x, z, yaw, walk, tag] of [[7.5, -8.62, E, true, 'e75'], [10.5, -8.62, E, true, 'e105'], [10.5, -8.62, E, false, 'e105s'], [12.3, -8.62, E, true, 'e123'], [10.5, -8.62, W, true, 'w105'], [10.5, -8.62, 0, false, 'n105s'], [10.5, -8.62, Math.PI, false, 's105s']]) {
    const r = await ev(`__probe(${x}, ${z}, ${yaw}, ${walk})`); r.tag = tag; await page.screenshot(`${D}/cam-strip-${tag}.png`); out.probes.push(r); log(tag, JSON.stringify(r)); save(); }
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
