// batch13 ⑧-b 补：S1 退潮脚印贴花，按包围盒俯拍
import { open, SH13 } from './b13lib.mjs';
const T = 'b13-foot';
const { page, ev, must, url, rec, step, done } = await open(5581, { width: 1280, height: 720 });
await step(T, 's1', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s1&art=1&quality=high'));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 400000, 's1');
  await ev(`__s1.puzzles.tide.set('low', { instant: true }); 1`);
  const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + 60}`, 120000, 50);
  const info = await ev(`(() => { const s = __s1; const o = s.scene.getObjectByName('s1-footprints-decal'); if (!o) return null;
    const B = new (s.camera.position.constructor)(); const box = { min: null, max: null }; const meshes = [];
    o.traverse(m => { if (m.isMesh) meshes.push({ n: m.name, vis: m.visible, mat: m.material?.type, op: m.material?.opacity, tr: m.material?.transparent, map: !!m.material?.map, rO: m.renderOrder, pOff: m.material?.polygonOffset }); });
    const bb = new (Object.getPrototypeOf(s.scene).constructor.prototype.constructor === undefined ? Object : Object)();
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9]; const v = s.camera.position.clone();
    o.updateWorldMatrix(true, true); o.traverse(m => { if (!m.isMesh) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); mn = mn.map((a, k) => Math.min(a, v.getComponent(k))); mx = mx.map((a, k) => Math.max(a, v.getComponent(k))); } });
    const c = mn.map((a, k) => (a + mx[k]) / 2), size = mx.map((a, k) => a - mn[k]); const r = Math.max(size[0], size[2]);
    s.cameraFollow.update = () => {}; if (s.rig) s.rig.entity.object3D.visible = false; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0);
    s.camera.position.set(c[0] + 0.01, c[1] + Math.max(1.2, r * 1.3), c[2] + r * 0.35); s.camera.fov = 45; s.camera.lookAt(c[0], c[1], c[2]); s.camera.updateProjectionMatrix();
    return { c: c.map(a => +a.toFixed(3)), size: size.map(a => +a.toFixed(3)), meshes, water: s.water?.mesh?.position?.y ?? null, visible: o.visible }; })()`);
  const fr = await ev('__game.time.frame'); await must(`__game.time.frame >= ${fr + 4}`, 300000, 'frames');
  await page.screenshot(`${SH13}/retry-lowtide-footprints-top.png`);
  rec(T, '脚印贴花俯拍', info ? 'INFO' : 'MISSING', info);
});
await done(); console.log('DONE');
