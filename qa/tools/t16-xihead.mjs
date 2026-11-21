// batch16 汐头 r3 游戏内 sanity：对称（bind 几何镜像最近点）、接缝（同位置顶点法线夹角）、半脸暗影是光照还是接缝（镜像主光重拍）
import { open, sleep, SH16 } from './b16lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH16}/xi`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5609, { width: 960, height: 540 });
const out = {};
try {
  for (let att = 1; att <= 3; att++) {
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1`));
    await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore' && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's1');
    await sleep(3000); const bad = await ev(`__game.assets.loadStats.filter((x) => (x.done && !x.ok) || x.fallback).length`); console.log('bad', bad); if (!bad) break;
  }
  out.geo = await ev(`(() => { const m0 = __s1.rig.animator.model; const res = [];
    m0.traverse((m) => { if (!m.isSkinnedMesh || /lod[12]/i.test(m.name)) return; const mats = [].concat(m.material).map((x) => x.name).join(' '); if (!/face|hair|head|eye|brow/i.test(mats + ' ' + m.name)) return;
      const p = m.geometry.attributes.position, nrm = m.geometry.attributes.normal; const n = p.count; const G = new Map(); const h = (x, y, z, s) => Math.round(x / s) + ',' + Math.round(y / s) + ',' + Math.round(z / s);
      let maxX = -1e9, minX = 1e9; for (let i = 0; i < n; i++) { const x = p.getX(i); maxX = Math.max(maxX, x); minX = Math.min(minX, x); G.set(h(p.getX(i), p.getY(i), p.getZ(i), 0.004), (G.get(h(p.getX(i), p.getY(i), p.getZ(i), 0.004)) || []).concat(i)); }
      // 对称：镜像 x→−x 后在 8 mm 邻域找最近点
      let far = 0, sum = 0, mx = 0; const c = 0.004;
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 3000))) { const x = -p.getX(i), y = p.getY(i), z = p.getZ(i); let best = 1;
        const bx = Math.round(x / c), by = Math.round(y / c), bz = Math.round(z / c);
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let d = -2; d <= 2; d++) for (const j of G.get((bx + a) + ',' + (by + b) + ',' + (bz + d)) || []) best = Math.min(best, Math.hypot(p.getX(j) - x, p.getY(j) - y, p.getZ(j) - z));
        if (best > 0.008) far++; sum++; if (best < 1) mx = Math.max(mx, best); }
      // 接缝：同位置（<0.05 mm）不同顶点的法线夹角
      let dup = 0, hard30 = 0, hard60 = 0; const hardMid = [];
      for (const [k, arr] of G) { if (arr.length < 2) continue; for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) { const i = arr[a], j = arr[b]; if (Math.hypot(p.getX(i) - p.getX(j), p.getY(i) - p.getY(j), p.getZ(i) - p.getZ(j)) > 5e-5) continue; dup++;
        const dot = nrm.getX(i) * nrm.getX(j) + nrm.getY(i) * nrm.getY(j) + nrm.getZ(i) * nrm.getZ(j); const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI; if (ang > 30) { hard30++; if (Math.abs(p.getX(i)) < 0.003 && hardMid.length < 6) hardMid.push([p.getX(i), p.getY(i), p.getZ(i)].map((v) => +v.toFixed(3))); } if (ang > 60) hard60++; } }
      res.push({ mesh: m.name, mats, verts: n, xRange: [+minX.toFixed(3), +maxX.toFixed(3)], mirrorFarPct: +(100 * far / sum).toFixed(1), mirrorMaxMm: +(mx * 1000).toFixed(1), dupPairs: dup, hard30, hard60, hardMid }); });
    return res; })()`);
  console.log(JSON.stringify(out.geo));
  // 拍照：正脸，主光原样 / 主光按头前向平面镜像
  await ev(`(() => { const s = __s1; s.puzzles.tide.set('high', { instant: true }); const sp = s.spawns.get('start'); const b = s.rig.body; b.teleport(b.position.clone().set(sp.position.x, sp.position.y + 0.02, sp.position.z)); s.rig.controller.facing = sp.yaw + Math.PI; document.getElementById('ui-root').style.display = 'none'; __game.postfx.setLensDroplets?.(0); return 1; })()`);
  await sleep(4000);
  await ev(`(() => { window.__unf = __game.freeze(); __s1.cameraFollow.update = () => {}; return 1; })()`);
  const lights = await ev(`(() => { const L = []; __s1.scene.traverse((o) => { if (o.isLight) L.push({ t: o.type, n: o.name, i: +o.intensity.toFixed(2), p: o.position.toArray().map((v) => +v.toFixed(1)), tg: o.target?.position.toArray().map((v) => +v.toFixed(1)) }); }); return L; })()`);
  out.lights = lights; console.log('lights', JSON.stringify(lights));
  const shot = async (name, yawDeg, mirror) => {
    const info = await ev(`(() => { const s = __s1, o = s.rig.animator.model, V = s.camera.position.constructor; o.updateMatrixWorld(true);
      let sm = null; o.traverse((m) => { if (!sm && m.isSkinnedMesh && m.skeleton.bones.some((b) => b.name === 'head')) sm = m; }); const hb = sm.skeleton.bones.find((b) => b.name === 'head');
      const f = new V(0, 0, 1).transformDirection(o.matrixWorld).setY(0).normalize(); const at = hb.getWorldPosition(new V()).add(new V(0, 0.08, 0));
      const a = ${yawDeg} * Math.PI / 180; const dir = f.clone().applyAxisAngle(new V(0, 1, 0), a); const eye = at.clone().addScaledVector(dir, 0.7).add(new V(0, 0.03, 0));
      if (!window.__L0) { window.__L0 = []; s.scene.traverse((l) => { if (l.isDirectionalLight || l.isSpotLight || l.isPointLight) window.__L0.push([l, l.position.clone(), l.target?.position.clone()]); }); }
      const side = new V(f.z, 0, -f.x); for (const [l, p0, t0] of window.__L0) { l.position.copy(p0); if (t0) l.target.position.copy(t0);
        if (${mirror}) { const rel = p0.clone().sub(at); rel.addScaledVector(side, -2 * rel.dot(side)); l.position.copy(at).add(rel); if (t0) { const tr = t0.clone().sub(at); tr.addScaledVector(side, -2 * tr.dot(side)); l.target.position.copy(at).add(tr); } } l.updateMatrixWorld(); l.target?.updateMatrixWorld(); }
      const c = s.camera; c.position.copy(eye); c.fov = 30; c.lookAt(at); c.updateProjectionMatrix(); return { eye: eye.toArray().map((v) => +v.toFixed(2)) }; })()`);
    await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))'); await sleep(300); await page.screenshot(`${D}/xihead-${name}.png`); console.log('shot', name, JSON.stringify(info));
  };
  for (const [n, y, m] of [['front', 0, false], ['front-lightmirror', 0, true], ['l35', 35, false], ['r35', -35, false], ['back', 180, false], ['side-l', 90, false], ['side-r', -90, false]]) await shot(n, y, m);
  out.errors = page.errors.slice(0, 6).map((e) => String(e).slice(0, 200));
} finally { writeFileSync(`${D}/t16-xihead.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
