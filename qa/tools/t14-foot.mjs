// batch14 033：脚印贴花 T1–T4 —— 贴花底下的物理地面高度、所在网格（沙 / 礁 / 水）、退潮水面
import { open, SH14 } from './b14lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, rec, done } = await open(5595, { width: 640, height: 360 });
await page.goto(url(`?smoke=1&debug=1&art=1&quality=standard&autostart=1`));
await must(`!!window.__s1?.rig && __game.scenes.current?.name === 's1-ebb-shore' && !!__s1.art && __game.input.context === 'explore'`, 600000, 's1');
await ev(`(__s1.puzzles.tide.set('low', { instant: true }), 1)`);
const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + 20}`, 120000, 50);
const r = await ev(`(() => { const s = __s1; const V = s.camera.position.constructor; let root = s.art.root; while (root.parent) root = root.parent; root.updateMatrixWorld(true);
  const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const B = root.children.length ? null : null; const Box = new (s.camera.constructor.prototype.constructor === Object ? Object : Object)();
  const meshes = []; root.traverse(o => { if (o.isMesh && vis(o) && o.geometry) { o.geometry.computeBoundingBox?.(); meshes.push(o); } });
  const at = (x, z) => { const hits = []; const v = new V(); for (const m of meshes) { const bb = m.geometry.boundingBox; if (!bb) continue; const c = bb.clone ? bb.clone().applyMatrix4(m.matrixWorld) : null; if (!c) continue; if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z && c.max.y > -2 && c.min.y < 2) hits.push(m.name + ' y[' + c.min.y.toFixed(2) + ',' + c.max.y.toFixed(2) + ']'); } return hits.slice(0, 14); };
  const down = new V(0, -1, 0);
  const out = { tide: s.puzzles.tide.state, level: +s.puzzles.tide.level.toFixed(3), water: s.water?.position?.y ?? s.water?.mesh?.position?.y ?? null, decals: [] };
  for (const d of s.dressing.decals) { const p = d.position; const g = []; for (const [dx, dz] of [[0, 0], [0.4, 0.8], [-0.4, -0.8], [0.4, -0.8], [-0.4, 0.8]]) { const q = new V(dx, 0, dz).applyAxisAngle(new V(0, 1, 0), d.rotation.y); const t = s.physics.raycast(new V(p.x + q.x, 3, p.z + q.z), down, 6); g.push(t == null ? null : +(3 - t).toFixed(3)); }
    out.decals.push({ name: d.name, p: p.toArray().map(v => +v.toFixed(3)), size: d.geometry?.parameters ? [d.geometry.parameters.width, d.geometry.parameters.height] : null, scale: d.scale.toArray(), rotX: +d.rotation.x.toFixed(3), groundY: g, gap: g.map(y => y == null ? null : +(p.y - y).toFixed(3)), under: at(p.x, p.z) }); }
  const flat = []; root.traverse(o => { if (o.isMesh && /^env-tidal-flat-s1_lod0/.test(o.name) && o.geometry?.attributes?.position) flat.push(o); });
  const fv = []; const tv = new V(); for (const m of flat) { const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i++) { tv.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); if (tv.x > 0 && tv.x < 11 && tv.z > 1 && tv.z < 11 && tv.y < 1.5) fv.push([tv.x, tv.y, tv.z]); } }
  out.flatVerts = fv.length;
  for (const d of out.decals) { const [px, py, pz] = d.p; const yaw = s.dressing.decals.find(x => x.name === d.name).rotation.y; const pts = []; for (const [dx, dz] of [[0, 0], [0, 0.5], [0, -0.5], [0, 0.9], [0, -0.9], [0.4, 0], [-0.4, 0]]) { const q = new V(dx, 0, dz).applyAxisAngle(new V(0, 1, 0), yaw); const x = px + q.x, z = pz + q.z; let best = null, wsum = 0, ysum = 0; for (const v of fv) { const dd = Math.hypot(v[0] - x, v[2] - z); if (dd < 0.35) { const w = 1 / (dd + 0.02); wsum += w; ysum += w * v[1]; } } pts.push(wsum ? +(ysum / wsum).toFixed(3) : null); } d.visualY = pts; d.visualGap = pts.map(y => y == null ? null : +(py - y).toFixed(3)); }
  out.greyboxFootprintsVisible = s.greybox.decor.filter(o => /^s1-footprint-/.test(o.name) && vis(o)).length;
  out.greyboxFootprintsAll = s.greybox.decor.filter(o => /^s1-footprint-/.test(o.name)).length;
  return out; })()`);
writeFileSync(`${SH14}/foot/foot-ground.json`, JSON.stringify(r, null, 1));
rec('b14-foot', 'decals', 'INFO', r);
await done(); console.log('DONE');
