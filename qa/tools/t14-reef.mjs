// batch14 美术修复：S3 礁岛石面在塔内（水平距塔心 < r）是否高出塔内地板 —— 遍历 env-rock-islet-a 顶点（世界坐标）
import { open, SH14 } from './b14lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, rec, done } = await open(5594, { width: 640, height: 360 });
await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=standard`));
await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore'`, 400000, 's3');
const r = await ev(`(() => { const s = __s3; const V = s.camera.position.constructor; let root = s.art.root; while (root.parent) root = root.parent; root.updateMatrixWorld(true);
  const C = { x: 39.73, z: -122.75 }; const res = {};
  const scan = (name, rMax) => { const o = root.getObjectByName(name); if (!o) return null; let n = 0, inside = 0, maxY = -1e9, over02 = 0, over03 = 0, hist = {}; const v = new V();
    o.traverse(m => { if (!m.isMesh || !m.geometry?.attributes?.position) return; if (/_lod[1-9]/i.test(m.name)) return; const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); n++; const d = Math.hypot(v.x - C.x, v.z - C.z); if (d < rMax) { inside++; if (v.y > maxY) maxY = v.y; if (v.y > 0.2) over02++; if (v.y > 0.3) { over03++; (res.pts ??= []).length < 400 && res.pts.push([+d.toFixed(2), +v.y.toFixed(2), +(Math.atan2(v.z - C.z, v.x - C.x) * 180 / Math.PI).toFixed(0), name]); const key = name + '>' + m.name + ' vis=' + (() => { let p = m, ok = true; while (p) { if (!p.visible) ok = false; p = p.parent; } return ok; })() + ' mat=' + (Array.isArray(m.material) ? m.material.map(x => x.name).join('|') : m.material?.name) + ' layers=' + m.layers.mask + ' rO=' + m.renderOrder; (res.meshes ??= {})[key] = (res.meshes[key] ?? 0) + 1; } const k = (Math.round(v.y * 10) / 10).toFixed(1); hist[k] = (hist[k] ?? 0) + 1; } } });
    return { verts: n, insideR: inside, maxY: +maxY.toFixed(3), over02, over03, hist }; };
  res.islet_r28 = scan('env-rock-islet-a', 2.8);
  res.islet_r30 = scan('env-rock-islet-a', 3.0);
  // 塔内地板 / 楼梯底：塔内 interior 网格 y 在 0–1.2 之间的顶点分布
  res.interior = scan('env-lighthouse-ch1-interior', 2.9);
  const names = []; root.traverse(o => { if (/islet|interior|stair|floor/i.test(o.name) && o.parent && !/islet|interior|stair|floor/i.test(o.parent.name)) names.push(o.name); });
  res.names = names.slice(0, 20);
  return res; })()`);
writeFileSync(`${SH14}/s3-reef.json`, JSON.stringify(r, null, 1));
const P = (r.pts||[]).filter(p => p[3] === 'env-rock-islet-a'); const bins = {}; for (const p of P) { const k = 'd' + (Math.floor(p[0] * 2) / 2) + ' y' + p[1].toFixed(1); bins[k] = (bins[k] ?? 0) + 1; } console.log('MESHES', JSON.stringify(r.meshes)); console.log('BINS', JSON.stringify(bins)); console.log('ANG', JSON.stringify(P.filter(p=>p[0]<2.5).slice(0,30)));
rec('b14-reef', 'islet vs floor', 'INFO', { islet_r28: { ...r.islet_r28, hist: undefined }, islet_r30: { ...r.islet_r30, hist: undefined }, interiorHistLow: r.interior && Object.fromEntries(Object.entries(r.interior.hist).filter(([k]) => +k <= 1.2)), names: r.names });
await done(); console.log('DONE');
