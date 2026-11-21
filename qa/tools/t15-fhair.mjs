// batch15 摸头穿发量化：以汐头心为原点按方向分桶（2°），每桶取头发外表面半径；父亲右手顶点半径 < 外表面 − 阈值 = 埋进头发
import { open, SH15 } from './b15lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5602, { width: 640, height: 360 });
const out = { loads: [] };
try {
  for (let att = 1; att <= 3; att++) {
    await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=high&father=hand`));
    await must(`!!window.__s3?.father && __game.input.context === 'explore' && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 400000, 's3');
    const bad = await ev(`__game.assets.loadStats.filter((x) => (x.done && !x.ok) || x.fallback).length`); out.loads.push(bad); if (!bad) break;
  }
  await ev(`(async () => { __s3.hideFather(); await __s3.playFather('hand'); return 1; })()`);
  for (const fr of [60, 70, 83, 100, 130]) {
    await must(`__s3.father.clipTime * 30 >= ${fr}`, 200000, 'f' + fr);
    const u = await ev(`(() => { window.__unf = __game.freeze(); return 1; })()`);
    const r = await ev(`(() => { const s = __s3, V = s.camera.position.constructor; const v = new V(); const xi = s.rig.animator.model, fr = s.father.root; xi.updateMatrixWorld(true); fr.updateMatrixWorld(true);
      const C = xi.getObjectByName('head').getWorldPosition(new V()).add(new V(0, 0.07, 0));
      const B = 2 * Math.PI / 180; const key = (d) => Math.round(Math.acos(Math.max(-1, Math.min(1, d.y))) / B) + ':' + Math.round((Math.atan2(d.z, d.x) + Math.PI) / B);
      const hairR = new Map(), skinR = new Map();
      const each = (root, test, fn) => root.traverse(m => { if (!m.isSkinnedMesh || /lod[12]/.test(m.name) || !test([].concat(m.material).map(x => x.name).join(' '))) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); m.localToWorld(v); fn(v); } });
      each(xi, n => /hair/.test(n), (q) => { const d = q.clone().sub(C); const r = d.length(); const k = key(d.normalize()); if (r > (hairR.get(k) ?? 0)) hairR.set(k, r); });
      each(xi, n => /face|body/.test(n), (q) => { const d = q.clone().sub(C); const r = d.length(); if (r > 0.2) return; const k = key(d.normalize()); if (r > (skinR.get(k) ?? 0)) skinR.set(k, r); });
      const hb = fr.getObjectByName('hand_r').getWorldPosition(new V());
      let n = 0, deep5 = 0, deep10 = 0, deep20 = 0, intoSkin = 0, maxD = 0, near = 0; const ds = [];
      each(fr, n2 => /skin/.test(n2), (q) => { if (q.distanceTo(hb) > 0.14) return; const d = q.clone().sub(C); const r = d.length(); const k = key(d.normalize()); const h = hairR.get(k); n++; if (h === undefined) return; near++; const dep = h - r; ds.push(dep); if (dep > 0.005) deep5++; if (dep > 0.01) deep10++; if (dep > 0.02) deep20++; if (dep > maxD) maxD = dep; const sk = skinR.get(k); if (sk !== undefined && r < sk) intoSkin++; });
      ds.sort((a, b) => b - a);
      return { frame: Math.round(s.father.clipTime * 30), handVerts: n, overHair: near, depthGt5mm: deep5, depthGt10mm: deep10, depthGt20mm: deep20, maxDepth: +maxD.toFixed(4), top5: ds.slice(0, 5).map(x => +x.toFixed(4)), intoScalp: intoSkin, hairBuckets: hairR.size }; })()`);
    out['f' + fr] = r; console.log(JSON.stringify(r));
    await ev(`(() => { __unf(); return 1; })()`);
  }
} finally { writeFileSync(`${SH15}/father/hand-hair-depth.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
