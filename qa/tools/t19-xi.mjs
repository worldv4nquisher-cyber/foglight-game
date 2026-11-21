// batch19 ④ 汐 r5 游戏内：头发 / 描边壳统计 + 脸前 / 后 / 侧特写；HULL=0 加 &hull=0；SDF=1 头顶点光仰角扫描（脸 SDF 是否翻转闪烁）
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/xi`; mkdirSync(D, { recursive: true });
const HULL = process.env.HULL ?? '1', SDF = process.env.SDF === '1';
const { page, ev, must, url, done } = await open(5651, { width: 1280, height: 720 });
const out = { HULL, shots: [], sdf: [] };
const save = () => writeFileSync(`${D}/t18-xi2.json`, JSON.stringify(out, null, 1));
const raf = () => ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
const CAM = (kind, dist = 0.75, fov = 30) => `(() => { const s = __s3, c = s.camera, V = c.position.constructor, Q = c.quaternion.constructor, o = s.rig.animator.model; o.updateMatrixWorld(true);
  let sm = null; o.traverse((m) => { if (!sm && m.isSkinnedMesh && m.skeleton.bones.some((b) => b.name === 'head')) sm = m; });
  const hb = sm.skeleton.bones.find((b) => b.name === 'head'); const bindQ = new Q(); { const M = sm.skeleton.boneInverses[sm.skeleton.bones.indexOf(hb)].clone().invert(); M.decompose(new V(), bindQ, new V()); }
  const fwd = new V(0, 0, 1).applyQuaternion(bindQ.clone().invert()).applyQuaternion(hb.getWorldQuaternion(new Q())).setY(0).normalize(); const side = new V().crossVectors(new V(0, 1, 0), fwd).normalize();
  const hd = hb.getWorldPosition(new V()); const at = hd.clone().add(new V(0, 0.07, 0)).addScaledVector(fwd, 0.03);
  const dir = '${kind}' === 'front' ? fwd : '${kind}' === 'back' ? fwd.clone().negate() : '${kind}' === 'top' ? fwd.clone().multiplyScalar(0.6).add(new V(0, 0.8, 0)).normalize() : side;
  const eye = at.clone().addScaledVector(dir, ${dist}).add(new V(0, 0.02, 0)); c.position.copy(eye); c.fov = ${fov}; c.lookAt(at); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  window.__head = { hd: hd.toArray(), fwd: fwd.toArray(), side: side.toArray() }; const p = at.clone().project(c); return { px: [Math.round((p.x + 1) / 2 * innerWidth), Math.round((1 - p.y) / 2 * innerHeight)], fwd: fwd.toArray().map((v) => +v.toFixed(3)) }; })()`;
try {
  console.log('goto', new Date().toTimeString().slice(0,8)); await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3'); console.log('s3', new Date().toTimeString().slice(0,8));
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore'); console.log('explore', new Date().toTimeString().slice(0,8));
  await ev(`(() => { __s3.cameraFollow.update = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; __s3.rig.animator.update = () => {}; return 1; })()`);
  const hull = (on) => ev(`(() => { let n = 0; __s3.rig.animator.model.traverse((m) => { if (m.isMesh && /-hull$/.test(m.name)) { m.visible = ${on}; n++; } }); return n; })()`);
  for (const k of ['front', 'back']) for (const on of [true, false]) {
    out.hullN = await hull(on); const r = await ev(CAM(k)); await raf(); await raf();
    const f = `${D}/xi2-${k}-hull${on ? 1 : 0}.png`; await page.screenshot(f); out.shots.push({ k, on, ...r, f }); save(); console.log('shot', k, on);
  }
  await hull(true);
  const pr = await ev(CAM('front', 0.9, 30)); out.sdfCam = pr;
  await ev(`(() => { let P = null; __s3.scene.traverse((o) => { if (!P && o.isPointLight) P = o.constructor; }); const L = new P(0xffffff, ${process.env.LI ?? 0.3}, 3, 2); L.name = 'qa-sdf-light'; __s3.scene.add(L); window.__L = L; return 1; })()`);
  const poses = [];
  for (const [az, els] of [[0, [80, 88, 89.7]], [90, [88, 89.7]]]) for (const el of els) poses.push({ tag: `az${az}-el${el}`, az, el });
  for (const dx of [-2, -1, 0, 1, 2]) poses.push({ tag: `walk${dx}cm`, walk: dx / 100 });
  for (const p of poses) {

      const st = await ev(`(() => { const h = __head, L = __L, V = L.position.constructor; const hd = new V(...h.hd).add(new V(0, 0.07, 0)), f = new V(...h.fwd), sd = new V(...h.side); let pos;
        if (${p.walk !== undefined}) { pos = hd.clone().add(new V(0, 0.45, 0)).addScaledVector(sd, ${p.walk ?? 0}).addScaledVector(f, 0.0236); }
        else { const el = ${p.el ?? 0} * Math.PI / 180, az = ${p.az ?? 0} * Math.PI / 180; const hdir = f.clone().multiplyScalar(Math.cos(az)).addScaledVector(sd, Math.sin(az)); pos = hd.clone().addScaledVector(hdir, 0.45 * Math.cos(el)).add(new V(0, 0.45 * Math.sin(el), 0)); }
        L.position.copy(pos); L.updateMatrixWorld(true); const d = pos.clone().sub(hd).normalize(); const hl = Math.hypot(d.dot(f), d.dot(sd)); const elev = Math.asin(d.y) * 180 / Math.PI;
        const th = hl < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, d.dot(f) / hl))) / (Math.PI / 2); const s = Math.max(0, Math.min(1, (hl - 0.1) / 0.25)); return { elev: +elev.toFixed(2), hl: +hl.toFixed(4), theta: +th.toFixed(3), thetaFixed: +(th * s * s * (3 - 2 * s)).toFixed(3) }; })()`);
      await raf(); await raf();
      const f = `/tmp/b19/sdf-${p.tag}.png`; mkdirSync('/tmp/b19', { recursive: true }); await page.screenshot(f);
      out.sdf.push({ ...p, ...st, f }); save(); console.log('sdf', p.tag);
    }
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
