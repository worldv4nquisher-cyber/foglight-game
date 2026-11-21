// batch21 ② 公用：相机采样钩子（每次 cameraFollow.update 后记 headDistance / 自算相机–头距离 / 淡出 / 偏移 / 抬高 / 帧跳）
export const HOOK = `(() => { const s = window.__s1 ?? window.__s3, cf = s.cameraFollow, V = s.camera.position.constructor;
  if (window.__cam) return 2;
  const C = window.__cam = { rec: null, spin: 0, yaw: null, pitch: null, last: null };
  const o = cf.update.bind(cf); const hb = new V();
  cf.update = (dt) => { if (C.yaw != null) { if (C.spin) C.yaw += C.spin * dt; cf.yaw = C.yaw; } if (C.pitch != null) cf.pitch = C.pitch; o(dt);
    if (!C.rec) return; const p = s.rig.body.position; const head = new V(p.x, p.y + 1.35, p.z); const cam = cf.live.position;
    let bone = null; const m = s.rig.animator?.model; const hn = m?.getObjectByName?.('head'); if (hn) { hn.getWorldPosition(hb); bone = cam.distanceTo(hb); }
    const jump = C.last ? cam.distanceTo(C.last) : 0; C.last = cam.clone();
    C.rec.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), hd: Number.isFinite(cf.headDistance) ? +cf.headDistance.toFixed(3) : null, ch: +cam.distanceTo(head).toFixed(3), cb: bone == null ? null : +bone.toFixed(3),
      a: +(+s.xiNearAlpha).toFixed(3), sd: +(+cf.side).toFixed(3), lf: +(+cf.lift).toFixed(3), cd: +(+cf.currentDistance).toFixed(3), j: +jump.toFixed(3), yaw: +cf.yaw.toFixed(3), mode: cf.modeName, bl: !!cf.blending }); };
  const gt = () => __game.time.fixedTick * __game.time.fixedDelta; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__gwait = async (sec) => { const g0 = gt(); while (gt() - g0 < sec) await wait(40); };
  window.__mat = () => { const r = { skinned: 0, skinnedFaded: 0, hull: 0, hullFaded: 0, other: 0, otherFaded: 0, alphaHashOn: 0, minOp: 1, touched: s.nearFade?.touched ?? 0, otherNames: [] };
    s.rig.visual.traverse((q) => { if (!q.isMesh) return; const mats = [].concat(q.material); const faded = mats.some((mm) => mm.opacity < 0.999 || mm.alphaHash);
      for (const mm of mats) { if (mm.alphaHash) r.alphaHashOn++; r.minOp = Math.min(r.minOp, +mm.opacity.toFixed(3)); }
      if (q.userData.outlineHull) { r.hull++; if (faded) r.hullFaded++; } else if (q.isSkinnedMesh) { r.skinned++; if (faded) r.skinnedFaded++; } else { r.other++; if (faded) r.otherFaded++; if (r.otherNames.length < 6) r.otherNames.push(q.name); } });
    return r; };
  window.__summ = (rec) => { const v = rec.filter((q) => q.mode === 'explore'); const mn = (k) => v.reduce((a, q) => (q[k] != null && q[k] < a.v ? { v: q[k], q } : a), { v: 1e9, q: null });
    const h = mn('hd'), c = mn('ch'), b = mn('cb'), al = mn('a'); const fadeBad = v.filter((q) => q.hd != null && q.hd < 0.9 && !q.bl && q.a >= 0.999).length; const fadeWrong = v.filter((q) => q.hd != null && q.hd >= 0.9 && q.a < 0.999).length;
    return { n: rec.length, nExplore: v.length, minHeadDist: h.v, minCamHead: c.v, minCamBone: b.v, atMin: c.q && { x: c.q.x, z: c.q.z, yaw: c.q.yaw, sd: c.q.sd, lf: c.q.lf, a: c.q.a }, minAlpha: al.v, framesHdLt09: v.filter((q) => q.hd < 0.9).length, framesHdLt035: v.filter((q) => q.hd < 0.35).length,
      noFadeWhenNear: fadeBad, fadeWhenFar: fadeWrong, maxJump: Math.max(0, ...v.map((q) => q.j)), jumpsGt05: v.filter((q) => q.j > 0.5).map((q) => [q.j, q.yaw, q.x]).slice(0, 6), sides: [Math.min(...v.map((q) => q.sd)), Math.max(...v.map((q) => q.sd))], liftMax: Math.max(0, ...v.map((q) => q.lf)),
      xRange: [Math.min(...v.map((q) => q.x)), Math.max(...v.map((q) => q.x))], zRange: [Math.min(...v.map((q) => q.z)), Math.max(...v.map((q) => q.z))] }; };
  return 1; })()`;
