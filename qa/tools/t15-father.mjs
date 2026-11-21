// batch15 031 父亲游戏内：?father=hand 进 S3 art=1 high；mesh 列表、摸头穿插量化、3 机位截图、LOD 实切、gaze/walk 动画在播、父亲袖口特写
import { open, sleep, SH15 } from './b15lib.mjs';
import { writeFileSync } from 'node:fs';
const D = `${SH15}/father`;
const { page, ev, must, url, rec, step, done } = await open(5601, { width: 1280, height: 720 });
const out = {};
try {
out.loads = [];
for (let att = 1; att <= 3; att++) {
  await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=high&father=hand`));
  await must(`!!window.__s3?.father && __s3.father.mode === 'hand' && __game.input.context === 'explore'`, 400000, 's3 father');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 400000, 'loads');
  const ls = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
  out.loads.push(ls); console.log('load', att, ls.n, ls.bad.length);
  if (!ls.bad.length) break;
  if (att === 3) throw new Error('3 次都有占位');
}
await ev(`(() => { const s = __s3; s.cameraFollow.update = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; return 1; })()`);
await ev(`(async () => { __s3.hideFather(); await __s3.playFather('hand'); return 1; })()`);
await step('f', 'meshes', async () => {
  out.meshes = await ev(`(() => { const r = []; const f = (o, who) => o.traverse(m => { if (m.isMesh && !/lod[12]/.test(m.name)) r.push(who + ':' + m.name + ' mat=' + [].concat(m.material).map(x => x.name).join('|') + ' v=' + m.geometry.attributes.position.count); }); f(__s3.father.root, 'F'); f(__s3.rig.animator.model, 'X'); return r; })()`);
  rec('f', 'meshes', 'INFO', out.meshes);
});
// 摸头定格在 strokeA–strokeB 之间与 handOn 后
const PEN = `(() => { const s = __s3, V = s.camera.position.constructor; const v = new V();
  const mn = (m) => m.name + ' ' + [].concat(m.material).map(x => x.name).join(' ');
  const pts = (root, test) => { const a = []; root.updateMatrixWorld(true); root.traverse(m => { if (!m.isSkinnedMesh || !m.visible || !test(mn(m))) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); m.localToWorld(v); a.push([v.x, v.y, v.z]); } }); return a; };
  const lod0 = (n) => !/lod[12]/i.test(n);
  const xi = s.rig.animator.model, fr = s.father.root;
  const hairMeshes = []; xi.traverse(m => { if (m.isSkinnedMesh && /hair/i.test(mn(m)) && lod0(m.name)) hairMeshes.push(mn(m)); });
  const hair = pts(xi, n => /hair/i.test(n) && lod0(n));
  // 父亲右手：取离 hand_r 骨 < 0.13 m 的父亲 LOD0 顶点
  const hb = fr.getObjectByName('hand_r').getWorldPosition(new V()); const mid = fr.getObjectByName('middle_01_r')?.getWorldPosition(new V()) ?? hb; const hc = hb.clone().add(mid).multiplyScalar(0.5);
  const hand = pts(fr, n => lod0(n)).filter(q => Math.hypot(q[0] - hc.x, q[1] - hc.y, q[2] - hc.z) < 0.12);
  // 汐头部 / 头发包络：每个手顶点找 2 cm 水平半径内头发顶点的最高 y；手点低于它 = 埋进头发（深度）
  let inside = 0, maxDepth = 0, minGap = 1e9; const gaps = [];
  for (const q of hand) { let top = -1e9, near = 1e9; for (const h of hair) { const dxz = Math.hypot(h[0] - q[0], h[2] - q[2]); if (dxz < 0.02 && h[1] > top) top = h[1]; const d = Math.hypot(h[0] - q[0], h[1] - q[1], h[2] - q[2]); if (d < near) near = d; } if (near < minGap) minGap = near; if (top > -1e9 && q[1] < top - 0.005) { inside++; maxDepth = Math.max(maxDepth, top - q[1]); } gaps.push(near); }
  gaps.sort((a, b) => a - b);
  const headBone = xi.getObjectByName('head').getWorldPosition(new V());
  return { frame: Math.round(s.father.clipTime * 30), hairMeshes, hairVerts: hair.length, handVerts: hand.length, minGapHandHair: +minGap.toFixed(4), p10gap: +(gaps[Math.floor(gaps.length * 0.1)] ?? 0).toFixed(4), handBelowHairTop: inside, maxDepth: +maxDepth.toFixed(4), handCenter: hc.toArray().map(x => +x.toFixed(3)), xiHead: headBone.toArray().map(x => +x.toFixed(3)) }; })()`;
const cam = (eye, at, fov = 40) => ev(`(() => { const c = __s3.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`);
const raf = () => ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
for (const fr of [62, 83, 120]) {
  await step('f', 'pen' + fr, async () => {
    await must(`__s3.father.clipTime * 30 >= ${fr}`, 200000, 'frame ' + fr);
    await ev(`(() => { window.__unf = __game.freeze(); return 1; })()`);
    const p = await ev(PEN); out['pen' + fr] = p; rec('f', 'pen' + fr, 'INFO', p);
    if (fr === 83) {
      const [x, y, z] = p.xiHead; const hc = p.handCenter;
      // 正侧、斜前、俯视 3 个头部特写
      const views = { side: [hc[0] + 0.7, hc[1] + 0.05, hc[2]], side2: [hc[0] - 0.7, hc[1] + 0.05, hc[2]], front: [hc[0], hc[1] + 0.05, hc[2] + 0.7], back: [hc[0], hc[1] + 0.05, hc[2] - 0.7], top: [hc[0] + 0.15, hc[1] + 0.6, hc[2] + 0.15] };
      for (const [k, e] of Object.entries(views)) { await cam(e.join(','), `${hc[0]},${hc[1] - 0.05},${hc[2]}`, 35); await raf(); await sleep(300); await page.screenshot(`${D}/hand-${k}.png`); }
    }
    await ev(`(() => { __unf(); return 1; })()`);
  });
}
await step('f', 'lod', async () => {
  await ev(`(() => { window.__unf = __game.freeze(); return 1; })()`);
  out.lodDist = await ev(`(() => { const r = []; __s3.father.root.traverse(o => { if (o.isLOD) r.push({ name: o.name, d: o.levels.map(l => l.distance), h: o.levels.map(l => l.hysteresis) }); }); return r; })()`);
  const res = [];
  for (const d of [3, 30, 38, 44, 60, 95, 106, 150, 95, 44, 36, 3]) {
    await ev(`(() => { const s = __s3, V = s.camera.position.constructor; const F = s.father.root.getWorldPosition(new V()); const c = s.camera; c.position.set(F.x + ${d} * 0.6, F.y + 1.4, F.z + ${d} * 0.8); c.lookAt(F.x, F.y + 1, F.z); c.updateMatrixWorld(); return 1; })()`);
    await raf(); await raf();
    res.push({ d, lv: await ev(`(() => { const r = []; const s = __s3, V = s.camera.position.constructor; __s3.father.root.traverse(o => { if (o.isLOD) r.push(o.getCurrentLevel() + '@' + o.getWorldPosition(new V()).distanceTo(s.camera.position).toFixed(1)); }); return r; })()`) });
  }
  out.lod = res; rec('f', 'lod', 'INFO', { dist: out.lodDist, res });
  await ev(`(() => { __unf(); return 1; })()`);
});
for (const mode of ['gaze', 'walk']) {
  await step('f', mode, async () => {
    await ev(`(async () => { __s3.hideFather(); await __s3.playFather('${mode}'); return 1; })()`);
    const a = await ev(`(() => { const f = __s3.father; const V = __s3.camera.position.constructor; return { t: f.clipTime, root: f.root.getWorldPosition(new V()).toArray(), lf: f.root.getObjectByName('foot_l').getWorldPosition(new V()).toArray(), hd: f.root.getObjectByName('head').getWorldPosition(new V()).toArray() }; })()`);
    const t0 = await ev('__game.time.elapsed'); await must(`__game.time.elapsed >= ${t0 + 2}`, 200000, 'wait');
    const b = await ev(`(() => { const f = __s3.father; const V = __s3.camera.position.constructor; return { mode: f.mode, vis: f.visible, t: f.clipTime, root: f.root.getWorldPosition(new V()).toArray(), lf: f.root.getObjectByName('foot_l').getWorldPosition(new V()).toArray(), hd: f.root.getObjectByName('head').getWorldPosition(new V()).toArray(), running: [...f.actions.values()].filter(x => x.isRunning()).map(x => x.getClip().name) }; })()`);
    const dd = (p, q) => +Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]).toFixed(3);
    out[mode] = { a, b, rootMove: dd(a.root, b.root), footMove: dd(a.lf, b.lf), headMove: dd(a.hd, b.hd), clipAdvance: +(b.t - a.t).toFixed(3) }; rec('f', mode, 'INFO', out[mode]);
    if (mode === 'gaze') {
      await ev(`(() => { window.__unf = __game.freeze(); return 1; })()`);
      for (const sd of ['r', 'l']) {
        const e = await ev(`(() => { const r = __s3.father.root, V = __s3.camera.position.constructor; r.updateMatrixWorld(true); const h = r.getObjectByName('hand_${sd}').getWorldPosition(new V()); const el = r.getObjectByName('lower_arm_${sd}').getWorldPosition(new V()); const at = h.clone().lerp(el, 0.2); const fwd = new V(0, 0, 1).transformDirection(r.matrixWorld).setY(0).normalize(); const R = r.getWorldPosition(new V()); const outv = at.clone().sub(R).setY(0).normalize(); const eye = at.clone().addScaledVector(fwd, 0.5).addScaledVector(outv, 0.25).add(new V(0, 0.08, 0)); return [eye.toArray(), at.toArray()]; })()`);
        await cam(e[0].join(','), e[1].join(','), 35); await raf(); await sleep(300); await page.screenshot(`${D}/father-cuff-${sd}.png`);
      }
      await ev(`(() => { __unf(); return 1; })()`);
    }
  });
}
out.errors = page.errors.slice(0, 8).map(e => String(e).slice(0, 200));
} finally {
writeFileSync(`${D}/t15-father.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
}
