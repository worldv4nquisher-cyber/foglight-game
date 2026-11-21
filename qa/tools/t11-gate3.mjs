// batch11 S2 art=1：拨盘铁门 78° vs 西门柱——门扇顶点到门柱附近三角面的最小距离 + 射线奇偶判内外（自写，不依赖 THREE 导出）
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-gate3';
const { page, ev, must, url, rec, step, done } = await open(5552);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
await ev(counter('__s2'));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const info = await ev(`(() => { const s = __s2, m = s.artSlots.mounted.find(x => x.id === 'prop-dial-gate-s2'); const out = []; m.model.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); out.push({ n: o.name, p: o.parent?.name, mat: [].concat(o.material).map(x => x.name), vis: o.visible, bb: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(v => +v.toFixed(3)) }); } }); 
  const near = []; s.scene.traverse(o => { if (!o.isMesh || !o.visible) return; let q = o, inGate = false; while (q) { if (q === m.model) inGate = true; q = q.parent; } if (inGate) return; const a = o.geometry.attributes.position; let c = 0; const v = new o.position.constructor(); for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); if (v.x > 4.85 && v.x < 5.6 && v.z > 11.2 && v.z < 12.4 && v.y > 0.1 && v.y < 2.2) c++; } if (c) near.push({ n: o.name, p: o.parent?.name, verts: c }); });
  return { gateMeshes: out, near }; })()`);
rec(T, '门 prop 网格 / 西门柱附近网格', 'INFO', info);
const MEASURE = `(() => { const s = __s2, m = s.artSlots.mounted.find(x => x.id === 'prop-dial-gate-s2'), door = m.model.getObjectByName('gate-door'); s.scene.updateMatrixWorld(true);
  const V = s.camera.position.constructor; const tris = [];
  s.scene.traverse(o => { if (!o.isMesh || !o.visible || /_lod[12]/.test(o.name)) return; let q = o, inGate = false; while (q) { if (q === door) inGate = true; q = q.parent; } if (inGate) return;
    const g = o.geometry, a = g.attributes.position, idx = g.index; const n = idx ? idx.count : a.count; const P = (i) => new V().fromBufferAttribute(a, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
    for (let i = 0; i < n; i += 3) { const A = P(i), B = P(i + 1), C = P(i + 2); const mx = Math.max(A.x, B.x, C.x), nx = Math.min(A.x, B.x, C.x), mz = Math.max(A.z, B.z, C.z), nz = Math.min(A.z, B.z, C.z), ny = Math.min(A.y, B.y, C.y), my = Math.max(A.y, B.y, C.y);
      if (mx < 4.8 || nx > 5.7 || mz < 11.1 || nz > 12.5 || my < 0.05 || ny > 2.3) continue; tris.push([A, B, C, o.name]); } });
  const cp = (p, a, b, c) => { const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a); const d1 = ab.dot(ap), d2 = ac.dot(ap); if (d1 <= 0 && d2 <= 0) return a; const bp = p.clone().sub(b), d3 = ab.dot(bp), d4 = ac.dot(bp); if (d3 >= 0 && d4 <= d3) return b; const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().add(ab.multiplyScalar(d1 / (d1 - d3))); const cpp = p.clone().sub(c), d5 = ab.dot(cpp), d6 = ac.dot(cpp); if (d6 >= 0 && d5 <= d6) return c; const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().add(ac.multiplyScalar(d2 / (d2 - d6))); const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.clone().add(c.clone().sub(b).multiplyScalar((d4 - d3) / ((d4 - d3) + (d5 - d6)))); const dn = 1 / (va + vb + vc); return a.clone().add(ab.multiplyScalar(vb * dn)).add(ac.multiplyScalar(vc * dn)); };
  const ray = (o, dir, a, b, c) => { const e1 = b.clone().sub(a), e2 = c.clone().sub(a), h = dir.clone().cross(e2), det = e1.dot(h); if (Math.abs(det) < 1e-12) return false; const f = 1 / det, sv = o.clone().sub(a), u = f * sv.dot(h); if (u < 0 || u > 1) return false; const q = sv.cross(e1), v = f * dir.dot(q); if (v < 0 || u + v > 1) return false; return f * e2.dot(q) > 1e-6; };
  const dirs = [new V(0.31, 0.93, 0.17).normalize(), new V(-0.2, 0.95, -0.24).normalize(), new V(0.1, 0.9, -0.42).normalize()];
  const cats = {}; let minD = 1e9, minAt = null, minName = null, inside = 0, insideList = [], nv = 0; const skipped = new Set();
  door.traverse(o => { if (!o.isMesh || !o.visible) return; if (/hinge|barrel|pin/i.test(o.name)) { skipped.add(o.name); return; } const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const p = new V().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); if (p.x < 4.75 || p.z < 11.1 || p.z > 12.5) continue; nv++;
    for (const t of tris) { const d = cp(p, t[0], t[1], t[2]).distanceTo(p); if (d < minD) { minD = d; minAt = [p.x, p.y, p.z].map(v => +v.toFixed(3)); minName = t[3]; } }
    const odd = dirs.map(dir => tris.filter(t => ray(p, dir, t[0], t[1], t[2])).length % 2 === 1); if (odd.every(Boolean)) { const r = Math.hypot(p.x - 5.0, p.z - 11.75); const cat = p.y < 0.15 ? 'ground' : (r < 0.08 ? 'hinge' : 'post'); cats[cat] = (cats[cat] || 0) + 1; if (cat === 'post') { inside++; if (insideList.length < 8) insideList.push([p.x, p.y, p.z, r].map(v => +v.toFixed(3))); } } } });
  return { rotDeg: +(s.scene.getObjectByName('s2-dial-gate-hinge').rotation.y * 180 / Math.PI).toFixed(1), tris: tris.length, triMeshes: [...new Set(tris.map(t => t[3]))], doorVertsNearPost: nv, minDistM: +minD.toFixed(4), minAt, minName, insideVerts: inside, cats, insideList, skipped: [...skipped] }; })()`;
const res = {};
await ev(`(() => { const t=__s2.scene.getObjectByName('s2-dial-gate-hinge'); return t ? 1 : 0; })()`);
await step(T, '量', async () => {
  for (const d of [0, 78, 90, 95]) {
    await ev(`(__s2.scene.getObjectByName('s2-dial-gate-hinge').rotation.y = ${d} * Math.PI / 180, 1)`); await waitN(4);
    res[d] = await ev(MEASURE); rec(T, `${d}°`, 'INFO', res[d]);
  }
  rec(T, '开门 78°：门扇顶点（除去地面以下 y<0.15 与合页轴 r<0.08）没有落在西门柱 / 墙网格（仅 lod0）内', res[78].insideVerts === 0 ? 'PASS' : 'FAIL', { at78: { minDistM: res[78].minDistM, inside: res[78].insideVerts }, at90: { minDistM: res[90].minDistM, inside: res[90].insideVerts }, at95: { minDistM: res[95].minDistM, inside: res[95].insideVerts } });
  await ev(`(__s2.scene.getObjectByName('s2-dial-gate-hinge').rotation.y = 78 * Math.PI / 180, 1)`);
  await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; s.rig.body.teleport(new V(5.9, 0.4, 13.0)); s.rig.body.velocity.set(0,0,0); const f = Math.atan2(5.0 - 5.9, 11.75 - 13.0); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.1; return 1; })()`); await waitN(60);
  await page.screenshot(`${SH11}/s2-gate-78-westpost.png`);
});
await done(); console.log('DONE');
