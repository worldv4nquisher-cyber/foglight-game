// batch13 ⑧ batch12 补拍：S3 导光镜近景（光照贴图 + 门开）、S3 打开的父亲日志近景、S1 退潮后纸条 a / 脚印贴花
import { open, sleep, SH13 } from './b13lib.mjs';
const T = 'b13-retry';
const which = (process.argv[2] ?? 's3,s1').split(',');
const { page, ev, must, url, rec, step, done } = await open(5580, { width: 1280, height: 720 });
const frames = async (n) => { const fr = await ev('__game.time.frame'); await must(`__game.time.frame >= ${fr + n}`, 900000, 'frames'); };
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 300000, 50); };
const CAM = (name, back, up, side, fov = 45, lookUp = 0.02) => `(() => { const s = __game.scenes.current; const o = s.scene.getObjectByName('${name}'); if (!o) return null; s.cameraFollow.update = () => {}; if (s.rig) s.rig.entity.object3D.visible = false; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0);
  const V = o.position.constructor; let mm = null, it = null; o.traverse(m => { if (m.name === 'mirror-pitch-mesh') mm = m; if (/-interact$/.test(m.name)) it = m; });
  const c = new V(); (mm ?? o).getWorldPosition(c); let dir;
  if (it) { const st = new V(); it.getWorldPosition(st); dir = st.sub(c).setY(0).normalize(); } else dir = new V(0, 0, 1).applyQuaternion(o.getWorldQuaternion(s.camera.quaternion.clone())).setY(0).normalize();
  const perp = new V(-dir.z, 0, dir.x); const eye = c.clone().add(dir.multiplyScalar(${back})).add(perp.multiplyScalar(${side})).add(new V(0, ${up}, 0));
  s.camera.position.copy(eye); s.camera.fov = ${fov}; s.camera.lookAt(c.clone().add(new V(0, ${lookUp}, 0))); s.camera.updateProjectionMatrix();
  return { c: c.toArray().map(v => +v.toFixed(2)), eye: eye.toArray().map(v => +v.toFixed(2)), mm: !!mm, it: !!it }; })()`;
if (which.includes('s3')) await step(T, 's3', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s3&art=1&quality=high'));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore' && !__s3.rig.controller.busy`, 400000, 's3');
  await ev(`__game.events.emit('interact:used', { id: __s3.puzzles.doorIx.id, kind: 'use' }); 1`);
  await page.waitFor(`__s3.puzzles.state.doorOpen >= 1`, 300000, 200);
  const names = await ev(`(() => { const r = []; __s3.scene.traverse(o => { if (/^prop-guide-mirror|^prop-journal-father/.test(o.name)) r.push(o.name); }); return r; })()`);
  rec(T, 's3 节点', 'INFO', names);
  for (const id of ['a', 'b']) for (const [k, back, up, side] of [['front', 0.9, 0.05, 0], ['oblique', 0.7, 0.25, 0.6], ['low', 0.8, -0.25, -0.3]]) {
    const info = await ev(CAM(`prop-guide-mirror-wall-s3-${id}`, back, up, side, 50, 0));
    await frames(3); await page.screenshot(`${SH13}/retry-mirror-${id}-${k}.png`); rec(T, `mirror ${id} ${k}`, info ? 'INFO' : 'MISSING', info);
  }
  const jn = names.find(n => /^prop-journal-father/.test(n)) ?? 'prop-journal-father-s3';
  const vis = await ev(`(() => { const o = __s3.scene.getObjectByName('${jn}'); const r = {}; o.traverse(m => { if (/journal-father-(open|closed)$/.test(m.name)) r[m.name] = m.visible; }); return r; })()`);
  for (const [k, back, up, side] of [['top', 0.25, 0.45, 0.05], ['oblique', 0.45, 0.3, 0.25]]) {
    const info = await ev(CAM(jn, back, up, side, 40, 0));
    await frames(3); await page.screenshot(`${SH13}/retry-journal-open-${k}.png`); rec(T, `journal open ${k}`, info ? 'INFO' : 'MISSING', { info, vis });
  }
});
if (which.includes('s1')) await step(T, 's1', async () => {
  await page.goto(url('?smoke=1&scene=s1&art=1&quality=high'));
  await must(`__game.scenes.current?.name === 's1-ebb-shore' && !!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 400000, 's1');
  await ev(`__s1.puzzles.tide.set('low', { instant: true }); 1`); await ticks(60);
  const tide = await ev(`(() => { const t = __s1.puzzles.tide; return { level: t.level ?? t.current ?? null, state: t.state ?? null, water: __s1.water?.mesh?.position?.y ?? __s1.water?.level ?? null }; })()`);
  for (const [id, back, up, side, fov] of [['prop-letter-a-s1', 0.5, 0.55, 0.1, 40], ['s1-footprints-decal', 1.6, 1.8, 0.4, 45]]) {
    const info = await ev(CAM(id, back, up, side, fov, 0));
    await frames(4); await page.screenshot(`${SH13}/retry-lowtide-${id}.png`);
    const y = await ev(`(() => { const o = __s1.scene.getObjectByName('${id}'); if (!o) return null; return +o.getWorldPosition(o.position.clone()).y.toFixed(3); })()`);
    rec(T, `低潮 ${id}`, info ? 'INFO' : 'MISSING', { info, y, tide });
  }
});
await done(); console.log('DONE');
