// batch13 ⑧-a 补：S3 导光镜近景，按 mirror-plane 法线两侧取景，隐藏雨
import { open, SH13 } from './b13lib.mjs';
const T = 'b13-mirclose';
const { page, ev, must, url, rec, step, done } = await open(5582, { width: 1280, height: 720 });
await step(T, 's3', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s3&art=1&quality=high'));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore' && !__s3.rig.controller.busy`, 400000, 's3');
  await ev(`__game.events.emit('interact:used', { id: __s3.puzzles.doorIx.id, kind: 'use' }); 1`);
  await page.waitFor(`__s3.puzzles.state.doorOpen >= 1`, 300000, 200);
  await ev(`(() => { const s = __s3; s.cameraFollow.update = () => {}; if (s.rig) s.rig.entity.object3D.visible = false; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); let n = 0; s.scene.traverse(o => { if (/rain/i.test(o.name) && (o.isPoints || o.isMesh || o.isLineSegments || o.isInstancedMesh)) { o.visible = false; n++; } }); window.__rainHidden = n; return n; })()`);
  for (const id of ['wall-s3-a', 'wall-s3-b', 'window-s3']) for (const sign of [1, -1]) {
    const info = await ev(`(() => { const s = __s3; const o = s.scene.getObjectByName('prop-guide-mirror-${id}'); if (!o) return null; let pl = s.scene.getObjectByName('prop-guide-mirror-${id}-mirror-plane') ?? null; if (!pl) o.traverse(m => { if (!pl && (m.name === 'mirror-pitch-mesh' || /mirror-plane$/.test(m.name))) pl = m; }); if (!pl) return { noPlane: true };
      const V = s.camera.position.constructor; const c = new V(); pl.getWorldPosition(c); const q = pl.getWorldQuaternion(s.camera.quaternion.clone()); const nrm = new V(0, 0, 1).applyQuaternion(q).multiplyScalar(${sign});
      const eye = c.clone().add(nrm.clone().multiplyScalar(1.0)).add(new V(0, 0.15, 0)); s.camera.position.copy(eye); s.camera.fov = 50; s.camera.lookAt(c); s.camera.updateProjectionMatrix();
      return { node: pl.name, c: c.toArray().map(a => +a.toFixed(2)), n: nrm.toArray().map(a => +a.toFixed(2)), rainHidden: window.__rainHidden }; })()`);
    const fr = await ev('__game.time.frame'); await must(`__game.time.frame >= ${fr + 3}`, 300000, 'frames');
    const f = `${SH13}/mirclose-${id}-${sign > 0 ? 'p' : 'n'}.png`; await page.screenshot(f); rec(T, `${id} ${sign}`, info ? 'INFO' : 'MISSING', info);
  }
});
await done(); console.log('DONE');
