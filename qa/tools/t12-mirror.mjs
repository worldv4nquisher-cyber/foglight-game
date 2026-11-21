// batch12：S3 导光镜 a/b 重交——运行时网格法线/UV 一致性 + 近景截图 + 光路到点火口（art=1）
import { open, sleep, SH12 } from './b12lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const T = 'b12-mirror';
mkdirSync(SH12, { recursive: true });
const { page, ev, must, url, rec, step, done } = await open(5542, { width: 960, height: 540 });
await step(T, 'S3 导光镜', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s3&art=1&quality=high'));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore'`, 400000, 's3');
  await sleep(500);
  const r = await ev(`(() => { const s = __s3, out = {};
    for (const id of ['prop-guide-mirror-wall-s3-a', 'prop-guide-mirror-wall-s3-b']) {
      const o = s.scene.getObjectByName(id); if (!o) { out[id] = 'missing'; continue; }
      const meshes = []; o.traverse(m => { if (!m.isMesh) return; const g = m.geometry, n = g.attributes.normal, uv = g.attributes.uv, p = g.attributes.position, idx = g.index;
        let bad = 0, tot = 0;         const v = (i) => [p.getX(i), p.getY(i), p.getZ(i)];
        const tris = idx ? idx.count / 3 : p.count / 3;
        for (let t = 0; t < tris; t++) { const ia = idx ? idx.getX(3*t) : 3*t, ib = idx ? idx.getX(3*t+1) : 3*t+1, ic = idx ? idx.getX(3*t+2) : 3*t+2;
          const a = v(ia), b = v(ib), c = v(ic); const e1 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], e2 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
          const fn = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]]; const L = Math.hypot(...fn); if (L < 1e-12 || !n) continue;
          for (const i of [ia, ib, ic]) { tot++; const d = (n.getX(i)*fn[0] + n.getY(i)*fn[1] + n.getZ(i)*fn[2]) / L; if (d < 0) bad++; } }
        meshes.push({ name: m.name, visible: m.visible, verts: p.count, hasNormal: !!n, hasUV: !!uv, uvRange: uv ? (() => { let mn = 1e9, mx = -1e9; for (let i = 0; i < uv.count; i++) { mn = Math.min(mn, uv.getX(i), uv.getY(i)); mx = Math.max(mx, uv.getX(i), uv.getY(i)); } return [+mn.toFixed(3), +mx.toFixed(3)]; })() : null, normalFlipPct: tot ? +(100 * bad / tot).toFixed(2) : null, map: !!m.material?.map, normalMap: !!m.material?.normalMap }); });
      out[id] = meshes;
    }
    return out; })()`);
  const flips = Object.values(r).flat().filter(m => m.visible && !/-collider|-wall/.test(m.name));
  rec(T, '导光镜 a/b 渲染网格：有法线 + UV、顶点法线与面法线同向（翻转 ≤ 1%）', flips.length && flips.every(m => m.hasNormal && m.hasUV && m.normalFlipPct <= 1) ? 'PASS' : 'FAIL', r);
  // 近景
  for (const id of ['prop-guide-mirror-wall-s3-a', 'prop-guide-mirror-wall-s3-b']) {
    for (const [k, back] of [['front', [0, 0.25, 1]], ['side', [0.9, 0.35, 0.5]]]) {
      await ev(`(() => { const s = __s3, o = s.scene.getObjectByName('${id}'); s.cameraFollow.update = () => {}; s.rig.entity.object3D.visible = false; __game.postfx.setLensDroplets?.(0);
        const V = o.position.constructor, c = new V(); o.getWorldPosition(c);
        let r = 0.3; o.traverse(m => { if (m.isMesh && m.visible) { m.geometry.computeBoundingSphere(); r = Math.max(r, m.geometry.boundingSphere.radius); } });
        const q = o.getWorldQuaternion(s.camera.quaternion.clone()); const off = new V(${back}).normalize().multiplyScalar(Math.max(0.9, r * 2.4)).applyQuaternion(q);
        s.camera.position.copy(c.clone().add(off)); s.camera.fov = 45; s.camera.lookAt(c); s.camera.updateProjectionMatrix(); return 1; })()`);
      const fr = await ev('__game.time.frame'); await must(`__game.time.frame >= ${fr + 3}`, 300000, 'frames');
      await page.screenshot(`${SH12}/mirror-${id.slice(-1)}-${k}.png`);
    }
  }
  // 光路：调到正解，读点火口受光
  const lp = await ev(`(() => { const s = __s3, p = s.puzzles; const keys = Object.keys(p); return { keys: keys.slice(0, 40) }; })()`);
  rec(T, 'puzzles keys', 'INFO', lp);
});
await done(); console.log('DONE');
