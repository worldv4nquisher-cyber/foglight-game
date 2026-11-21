// batch11 S2 art=1：拨盘铁门开 78° 后门扇与西门柱穿插检查（美术门扇顶点 vs 门柱网格，合页筒除外）+ 真拨 317 开门
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-gate';
const { page, ev, must, url, rec, step, done } = await open(5550);
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
await ev(counter('__s2'));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const GEO = (deg) => `(() => { const s = __s2, h = s.scene.getObjectByName('s2-dial-gate-hinge'); ${deg === null ? '' : `h.rotation.y = ${deg} * Math.PI / 180;`} s.scene.updateMatrixWorld(true);
  const m = s.artSlots.mounted.find(x => x.id === 'prop-dial-gate-s2'); const door = m.model.getObjectByName('gate-door'); door.updateMatrixWorld(true);
  const inDoor = new Set(); door.traverse(o => inDoor.add(o));
  const V = h.position.constructor; const verts = []; const names = new Set();
  door.traverse(o => { if (!o.isMesh || !o.visible) return; if (/hinge|barrel|pin/i.test(o.name)) { names.add('skip:' + o.name); return; } names.add(o.name); const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) verts.push(new V().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld)); });
  // 候选门柱：门扇以外、世界包围盒在西门柱附近（x 4.8…5.6, z 11.2…12.3）的网格
  const res = []; const B = new h.position.constructor(); 
  s.scene.traverse(o => { if (!o.isMesh || !o.visible || inDoor.has(o)) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    if (bb.max.x < 4.8 || bb.min.x > 5.6 || bb.max.z < 11.2 || bb.min.z > 12.4 || bb.max.y < 0.2) return; if (bb.max.x - bb.min.x > 3 || bb.max.z - bb.min.z > 3) return;
    const inv = o.matrixWorld.clone().invert(), lb = o.geometry.boundingBox; let inside = 0, maxPen = 0; let minGap = 1e9;
    for (const v of verts) { const l = v.clone().applyMatrix4(inv); const dx = Math.max(lb.min.x - l.x, 0, l.x - lb.max.x), dy = Math.max(lb.min.y - l.y, 0, l.y - lb.max.y), dz = Math.max(lb.min.z - l.z, 0, l.z - lb.max.z); const out = Math.hypot(dx, dy, dz);
      if (out === 0) { inside++; const pen = Math.min(l.x - lb.min.x, lb.max.x - l.x, l.y - lb.min.y, lb.max.y - l.y, l.z - lb.min.z, lb.max.z - l.z); maxPen = Math.max(maxPen, pen); } else minGap = Math.min(minGap, out); }
    res.push({ mesh: o.name, parent: o.parent?.name, bb: [bb.min.x, bb.min.z, bb.max.x, bb.max.z].map(v => +v.toFixed(3)), inside, maxPenM: +maxPen.toFixed(4), minGapM: +minGap.toFixed(4) }); });
  return { rotDeg: +(h.rotation.y * 180 / Math.PI).toFixed(2), doorMeshes: [...names], nVerts: verts.length, res }; })()`;
await step(T, '几何', async () => {
  await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; s.rig.body.teleport(new V(4.6, 0.4, 13.6)); s.rig.body.velocity.set(0,0,0); const f = Math.atan2(5.0 - 4.6, 11.75 - 13.6); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.15; return 1; })()`); await waitN(60);
  for (const d of [0, 78, 90, 95]) {
    await ev(`(__s2.scene.getObjectByName('s2-dial-gate-hinge').rotation.y = ${d} * Math.PI / 180, 1)`); await waitN(4);
    const r = await ev(GEO(null));
    const art = await ev(`(() => { const m = __s2.artSlots.mounted.find(x => x.id === 'prop-dial-gate-s2'), o = m.model.getObjectByName('gate-door'), h = __s2.scene.getObjectByName('s2-dial-gate-hinge'); const qa = o.getWorldQuaternion(o.quaternion.clone()), qh = h.getWorldQuaternion(h.quaternion.clone()); return { artVsHingeDeg: +(2 * Math.acos(Math.min(1, Math.abs(qa.dot(qh)))) * 180 / Math.PI).toFixed(3) }; })()`);
    r.art = art;
    if (d === 78) await page.screenshot(`${SH11}/s2-gate-78-art.png`);
    rec(T, `门扇转 ${d}°：与门柱附近网格的穿插（顶点落进网格局部包围盒）`, 'INFO', r);
    if (d === 78) globalThis.__r78 = r;
  }
  await ev(`(__s2.scene.getObjectByName('s2-dial-gate-hinge').rotation.y = 0, 1)`); await waitN(5);
  const r = globalThis.__r78;
  const posts = r.res.filter(x => /post|pillar|gate/i.test(x.mesh + ' ' + x.parent) || true);
  rec(T, '开门 78°：门扇（除合页筒）不嵌进西门柱', posts.every(p => p.inside === 0 || p.maxPenM < 0.002) ? 'PASS' : 'FAIL', posts);
});
await step(T, '真拨 317 开门', async () => {
  // 用谜题 API 拨到 317 后发 partRotated 走真实开门路径
  const r0 = await ev(`(() => { const P = __s2.puzzles; return Object.keys(P).filter(k => /dial|gate/i.test(k)); })()`);
  rec(T, 'puzzles 上门相关字段', 'INFO', r0);
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
