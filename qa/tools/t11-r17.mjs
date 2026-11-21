// batch11 裁定 17：art=1、不在观察模式，S2 山坡 / 房子 / 院子若干第三人称可到达位置截图，看能不能读出 317
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-r17';
const { page, ev, must, url, rec, step, done } = await open(5540);
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
await ev(counter('__s2'));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const slopeY = (x) => x <= 8 ? 0 : -(x - 8) * 0.0776;
const spots = [
  ['platform-east-edge', 7.5, 0, 1.0],
  ['slope-x11', 11, slopeY(11), 1.0],
  ['slope-x14-south', 14, slopeY(14), -4],
  ['slope-x15-north', 15, slopeY(15), 6],
  ['slope-x22-below', 22, slopeY(22), 1.0],
  ['house-upper-window', 0.95, 3.0, 1.0],
  ['house-upper-east', 0.4, 3.0, -0.6],
  ['house-ground-front', -3.0, 0, -4.5],
  ['yard', -10, 0, 0],
  ['north-path', 5.5, 0, 18],
];
await step(T, '截图', async () => {
  const out = [];
  for (const [name, x, y, z] of spots) {
    await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; s.rig.body.teleport(new V(${x}, ${y} + 0.4, ${z})); s.rig.body.velocity.set(0,0,0); const f = Math.atan2(18 - ${x}, 1 - ${z}); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.12; return 1; })()`);
    await waitN(90);
    const r = await ev(`(() => { const s = __s2, P = s.puzzles, c = s.camera; const p = c.getWorldPosition(c.position.clone()), b = s.rig.body.position; const aim = P.whiteStonesAim(); const d = aim.target.clone().sub(p).normalize(), f = c.getWorldDirection(c.position.clone());
      let glow = 0; const m = s.artSlots.mounted.find(x => /white-stones/.test(x.id)); m?.model.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(mm => { if (mm.name === 'mat-prop-white-stones-digit-s2') glow = Math.max(glow, mm.emissiveIntensity); }); });
      return { body: [b.x, b.y, b.z].map(v => +v.toFixed(2)), cam: [p.x, p.y, p.z].map(v => +v.toFixed(2)), distToDigits: +aim.target.distanceTo(p).toFixed(1), offAxisDeg: +(Math.acos(Math.min(1, d.dot(f))) * 180 / Math.PI).toFixed(1), observing: s.cameraFollow.observing, eye: s.cameraFollow.eyeActive, align: P.viewpoint.alignment, glow, segOpacity: P.digitsMaterial.opacity }; })()`);
    await page.screenshot(`${SH11}/r17-${name}.png`);
    out.push({ name, ...r });
    rec(T, name, 'INFO', r);
  }
  rec(T, '全部位置不在观察模式、对准度 0、数字石不加亮、七段贴片 0', out.every(o => !o.observing && !o.eye && o.align === 0 && o.glow === 0 && o.segOpacity === 0) ? 'PASS' : 'FAIL', out.map(o => o.name));
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
