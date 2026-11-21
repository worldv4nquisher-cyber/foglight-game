// batch15 父亲大衣袖口特写：hand 模式第 ~90 帧定格（右手在汐头上、左手垂下），gaze 模式从背后看（双手背在身后）
import { open, sleep, SH15 } from './b15lib.mjs';
const D = `${SH15}/father`;
const { page, ev, must, url, done } = await open(5603, { width: 1280, height: 720 });
const cam = (e, a, fov = 35) => ev(`(() => { const c = __s3.camera; c.position.set(${e}); c.fov = ${fov}; c.lookAt(${a}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`);
const raf = () => ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
const W = (sd, side, back, up, lerp = 0.2) => `(() => { const r = __s3.father.root, V = __s3.camera.position.constructor; r.updateMatrixWorld(true); const h = r.getObjectByName('hand_${sd}').getWorldPosition(new V()); const el = r.getObjectByName('lower_arm_${sd}').getWorldPosition(new V()); const at = h.clone().lerp(el, ${lerp}); const fwd = new V(0, 0, 1).transformDirection(r.matrixWorld).setY(0).normalize(); const rt = new V(fwd.z, 0, -fwd.x); const eye = at.clone().addScaledVector(rt, ${side}).addScaledVector(fwd, ${back}).add(new V(0, ${up}, 0)); return [eye.toArray(), at.toArray()]; })()`;
try {
  for (let att = 1; att <= 3; att++) {
    await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=high&father=hand`));
    await must(`!!window.__s3?.father && __game.input.context === 'explore' && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 400000, 's3');
    const bad = await ev(`__game.assets.loadStats.filter((x) => (x.done && !x.ok) || x.fallback).length`); console.log('bad', bad); if (!bad) break;
  }
  await ev(`(() => { const s = __s3; s.cameraFollow.update = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
  await ev(`(async () => { __s3.hideFather(); await __s3.playFather('hand'); return 1; })()`);
  await must(`__s3.father.clipTime * 30 >= 90`, 200000, 'f90');
  await ev(`(() => { window.__unf = __game.freeze(); return 1; })()`);
  for (const [n, sd, side, back, up] of [['hand-r-out', 'r', -0.45, 0.1, 0.05], ['hand-l-out', 'l', 0.5, 0.15, 0.05], ['hand-l-front', 'l', 0.1, 0.55, 0.05]]) {
    const [e, a] = await ev(W(sd, side, back, up)); await cam(e.join(','), a.join(',')); await raf(); await sleep(300); await page.screenshot(`${D}/father-cuff-${n}.png`);
  }
  await ev(`(() => { __unf(); return 1; })()`);
  await ev(`(async () => { __s3.hideFather(); await __s3.playFather('gaze'); return 1; })()`);
  const t0 = await ev('__game.time.elapsed'); await must(`__game.time.elapsed >= ${t0 + 1.5}`, 200000, 'w');
  await ev(`(() => { window.__unf = __game.freeze(); return 1; })()`);
  for (const [n, sd, side, back, up] of [['gaze-back-r', 'r', -0.15, -0.55, 0.1], ['gaze-back-l', 'l', 0.15, -0.55, 0.1]]) {
    const [e, a] = await ev(W(sd, side, back, up)); await cam(e.join(','), a.join(',')); await raf(); await sleep(300); await page.screenshot(`${D}/father-cuff-${n}.png`);
  }
  await ev(`(() => { __unf(); return 1; })()`);
  console.log('errors', page.errors.length);
} finally { await done(); console.log('DONE'); }
