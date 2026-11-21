// batch12：导光镜 a/b 近景（从 -interact 站位眼高看镜心 + 斜侧 45°）
import { open, sleep, SH12 } from './b12lib.mjs';
const T = 'b12-mirror2';
const { page, ev, must, url, rec, step, done } = await open(5543, { width: 960, height: 540 });
await step(T, 'shots', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s3&art=1&quality=high'));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore'`, 400000, 's3');
  for (const id of (process.argv[2] ?? 'a,b').split(',')) for (const [k, side, dist] of [['stand', 0, 1.0], ['oblique', 0.8, 0.8]]) {
    const info = await ev(`(() => { const s = __s3, o = s.scene.getObjectByName('prop-guide-mirror-wall-s3-${id}'); s.cameraFollow.update = () => {}; s.rig.entity.object3D.visible = false;
      const V = o.position.constructor; let it = null, mm = null; o.traverse(m => { if (/-interact$/.test(m.name)) it = m; if (m.name === 'mirror-pitch-mesh') mm = m; });
      const c = new V(); (mm ?? o).getWorldPosition(c); const st = new V(); (it ?? o).getWorldPosition(st);
      const dir = st.clone().sub(c).setY(0).normalize(); const perp = new V(-dir.z, 0, dir.x);
      const eye = c.clone().add(dir.multiplyScalar(${dist})).add(perp.multiplyScalar(${side})).add(new V(0, 0.15, 0));
      s.camera.position.copy(eye); s.camera.fov = 50; s.camera.lookAt(c); s.camera.updateProjectionMatrix();
      return { c: c.toArray().map(v => +v.toFixed(2)), eye: eye.toArray().map(v => +v.toFixed(2)), interact: !!it }; })()`);
    const fr = await ev('__game.time.frame'); await must(`__game.time.frame >= ${fr + 3}`, 900000, 'frames');
    await page.screenshot(`${SH12}/mirror-${id}-${k}.png`);
    rec(T, `mirror-${id}-${k}`, 'INFO', info);
  }
});
await done(); console.log('DONE');
