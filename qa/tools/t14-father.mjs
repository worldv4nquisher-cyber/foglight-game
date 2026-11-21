// batch14 031 父亲：QA 侧把 char-father(+anims) 用游戏 AssetLoader 载进 S3 art=1（游戏本身还没接 031），放汐旁边：LOD、3 个 clip、截图
import { open, sleep, SH14 } from './b14lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const D = `${SH14}/father`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, rec, step, done } = await open(5596, { width: 1280, height: 720 });
const out = {};
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 120000, 50); };
await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=standard`));
await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore'`, 400000, 's3');
await ev(`(__s3.puzzles.tide.set('low', { instant: true }), document.getElementById('ui-root').style.display = 'none', 1)`);
await ev(`(() => { const s = __s3; s.rig.body.teleport(new s.rig.body.body.position.constructor(40.33, 2.6, -116.95)); s.rig.controller.facing = Math.PI * 0.75; return 1; })()`);
await ticks(30);
await step('b14-father', 'load', async () => {
  out.load = await ev(`(async () => { const t0 = performance.now(); await __game.assets.loadEntries([{ key: 'qa-father', type: 'gltf', url: 'assets/art/models/characters/char-father.glb', group: 's3', optional: true, art: true }, { key: 'qa-father-anims', type: 'gltf', url: 'assets/art/models/characters/char-father-anims.glb', group: 's3', optional: true, art: true }]);
    const s = __s3; const m = __game.assets.getModel('qa-father'); window.__fa = m; const clips = __game.assets.getAnimations('qa-father-anims'); window.__fclips = clips;
    const lods = []; let skinned = 0, bones = 0, tris = {}; m.traverse(o => { if (o.isLOD) lods.push({ name: o.name, levels: o.levels.map(l => ({ d: l.distance, obj: l.object.name })) }); if (o.isSkinnedMesh) { skinned++; bones = Math.max(bones, o.skeleton.bones.length); } if (o.isMesh && o.geometry) { const k = (o.name.match(/lod\\d/i) ?? ['?'])[0]; tris[k] = (tris[k] ?? 0) + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    const xi = s.rig.animator.model; const P = s.rig.entity.object3D.position; const yaw = s.rig.controller.facing;
    m.position.set(P.x + 0.9 * Math.cos(yaw), P.y, P.z - 0.9 * Math.sin(yaw)); m.rotation.y = yaw; m.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    s.rig.entity.object3D.parent.add(m); m.traverse(o => { if (o.isLOD) o.levels.forEach((l, i) => { l.distance = i === 0 ? 0 : [25, 60, 150][i - 1]; }); });
    const mats = new Set(); m.traverse(o => { if (o.isMesh) for (const mt of [].concat(o.material)) mats.add(mt.name + (mt.map ? ' map:' + (mt.map.name || mt.map.isCompressedTexture) : ' nomap')); });
    return { ms: Math.round(performance.now() - t0), missing: __game.assets.isMissing('qa-father'), lods, skinned, bones, tris, clips: clips.map(c => ({ name: c.name, dur: +c.duration.toFixed(3), tracks: c.tracks.length })), mats: [...mats] }; })()`);
  rec('b14-father', 'load', 'INFO', out.load);
});
const camAt = (eye, at) => ev(`(() => { const s = __s3; s.cameraFollow.__u ??= s.cameraFollow.update; s.cameraFollow.update = () => {}; const c = s.camera; c.position.set(${eye}); c.lookAt(${at}); c.updateMatrixWorld(); return 1; })()`);
await step('b14-father', 'pair', async () => {
  await ev(`(() => { const s = __s3; const Mixer = s.rig.animator.mixer.constructor; const mx = (window.__fm ??= new Mixer(__fa)); const a = mx.clipAction(__fclips.find(c => c.name === 'father-stand-gaze')); a.reset().play(); mx.update(2); __fa.updateMatrixWorld(true); return 1; })()`);
  const g = await ev(`(() => { const s = __s3; const V = s.camera.position.constructor; const B = (o) => { const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; const v = new V(); o.updateMatrixWorld(true); o.traverse(m => { if (!m.isSkinnedMesh || !m.visible) return; const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i += 7) { m.getVertexPosition(i, v); m.localToWorld(v); [v.x, v.y, v.z].forEach((x, k) => { b.min[k] = Math.min(b.min[k], x); b.max[k] = Math.max(b.max[k], x); }); } }); return { h: +(b.max[1] - b.min[1]).toFixed(3), minY: +b.min[1].toFixed(3) }; };
    const P = s.rig.entity.object3D.position, F = __fa.position, mid = P.clone().add(F).multiplyScalar(0.5); const yaw = s.rig.controller.facing; return { xi: B(s.rig.animator.model), father: B(__fa), mid: mid.toArray(), yaw, fatherPos: F.toArray().map(v => +v.toFixed(2)) }; })()`);
  out.pair = g; rec('b14-father', 'heights', 'INFO', g);
  const [mx, my, mz] = g.mid; const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
  await camAt(`${mx + 3.6 * fx}, ${my + 1.3}, ${mz + 3.6 * fz}`, `${mx}, ${my + 0.9}, ${mz}`);
  await ticks(5); await sleep(400); await page.screenshot(`${D}/father-xi-front.png`);
  await camAt(`${mx + 3.6 * fz}, ${my + 1.3}, ${mz - 3.6 * fx}`, `${mx}, ${my + 0.9}, ${mz}`);
  await ticks(5); await sleep(400); await page.screenshot(`${D}/father-xi-side.png`);
  out.eye = [mx + 3.6 * fx, my + 1.3, mz + 3.6 * fz];
});
await step('b14-father', 'lod', async () => {
  const res = [];
  for (const dist of [5, 20, 30, 50, 70, 120, 30, 5]) {
    const r = await ev(`(() => { const s = __s3; const c = s.camera; const F = __fa.position; const fx = Math.sin(s.rig.controller.facing), fz = Math.cos(s.rig.controller.facing); c.position.set(F.x + ${dist} * fx, F.y + 1.5, F.z + ${dist} * fz); c.lookAt(F.x, F.y + 1, F.z); c.updateMatrixWorld(); return 1; })()`);
    await ticks(3);
    res.push({ dist, lv: await ev(`(() => { const r = []; __fa.traverse(o => { if (o.isLOD) r.push(o.getCurrentLevel()); }); return r; })()`) });
  }
  out.lod = res; rec('b14-father', 'lod', 'INFO', res);
});
await step('b14-father', 'clips', async () => {
  const [ex, ey, ez] = out.eye;
  const res = [];
  for (const i of [0, 1, 2]) {
    const r = await ev(`(() => { const s = __s3; const Mixer = s.rig.animator.mixer.constructor; window.__fm?.stopAllAction(); const mx = (window.__fm ??= new Mixer(__fa)); const clip = __fclips[${i}]; const a = mx.clipAction(clip); a.reset().play(); const bone = (n) => { let b = null; __fa.traverse(o => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
      const names = ['hand_r', 'hand_l', 'head', 'foot_l', 'foot_r', 'spine_03']; const V = s.camera.position.constructor; const pos = () => names.map(n => { const b = bone(n); return b ? b.getWorldPosition(new V()).toArray().map(v => +v.toFixed(3)) : null; });
      mx.update(0); __fa.updateMatrixWorld(true); const p0 = pos(); const N = Math.max(8, Math.round(clip.duration * 30)); let maxMove = 0, nan = false; for (let k = 1; k <= N; k++) { mx.update(clip.duration / N * 0.999); __fa.updateMatrixWorld(true); const p = pos(); p.forEach((q, j) => { if (!q || !p0[j]) return; if (q.some(Number.isNaN)) nan = true; maxMove = Math.max(maxMove, Math.hypot(q[0] - p0[j][0], q[1] - p0[j][1], q[2] - p0[j][2])); }); }
      mx.setTime(clip.duration * 0.5); __fa.updateMatrixWorld(true);
      return { clip: clip.name, boneFound: p0.map((q, j) => names[j] + ':' + !!q).join(' '), maxBoneMove: +maxMove.toFixed(3), nan, actionRunning: a.isRunning() }; })()`);
    await ev(`(() => { const c = __s3.camera; c.position.set(${ex}, ${ey}, ${ez}); const F = __fa.position; c.lookAt(F.x, F.y + 0.9, F.z); c.updateMatrixWorld(); return 1; })()`);
    await ticks(3); await sleep(300);
    await page.screenshot(`${D}/father-clip-${r.clip}.png`);
    res.push(r);
  }
  out.clips = res; rec('b14-father', 'clips', 'INFO', res);
});
out.errors = page.errors.slice(0, 6).map(e => e.slice(0, 200));
writeFileSync(`${D}/father.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
