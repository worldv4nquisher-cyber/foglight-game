import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5286);
const T = 'v0.1-013';
const ktx = `(() => { const r = performance.getEntriesByType('resource').filter(e => /\\.ktx2(\\?|$)/.test(e.name)); const by = {}; for (const e of r) { const k = e.name.split('/').pop(); (by[k] ||= []).push({ t: e.transferSize, b: e.encodedBodySize }); } return { n: r.length, uniq: Object.keys(by).length, dup: Object.entries(by).filter(([, v]) => v.length > 1).map(([k, v]) => k + 'x' + v.length), cached: r.filter(e => e.transferSize === 0 && e.encodedBodySize > 0).length, bytes: r.reduce((s, e) => s + e.transferSize, 0) }; })()`;
const artSt = `(() => { const a = __s1.art; let lit = 0; a.tower?.traverse((o) => { const m = o.material; for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.emissive && x.emissive.getHex() !== 0 && x.emissiveIntensity > 0) lit++; }); let warm = 0, lights = []; __s1.scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.visible && o.intensity > 0) { lights.push(o.name + ':' + o.color.getHexString()); if (o.color.r > o.color.b + 0.1) warm++; } }); let silEm = 0; const sil = __s1.scene.getObjectByName('s1-sky-silhouettes'); sil?.traverse((o) => { const m = o.material; for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.emissive && x.emissive.getHex() !== 0 && x.emissiveIntensity > 0) silEm++; }); const c = __s1.camera; const d = sil ? sil.children.map(ch => { const p = ch.getWorldPosition(new ch.position.constructor()); return +p.distanceTo(c.position).toFixed(1); }) : []; const tp = a.tower ? a.tower.getWorldPosition(new a.tower.position.constructor()).distanceTo(c.position).toFixed(1) : null; return { loaded: a.loaded, tower: !!a.tower, towerLitMats: lit, warmLights: warm, lights, silhouettes: sil?.children.length ?? 0, silVisible: sil?.visible, silEmissive: silEm, silDist: d, towerDist: +tp, camFar: c.far, quality: __game.settings?.get?.('quality') ?? null }; })()`;
await step(T, '远景灯塔熄灭 + 剪影超出视距仍渲染 + KTX2', async () => {
  await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
  await must(`!!window.__s1?.art && __game.input.context === 'explore'`, 300000, 'S1 art explore');
  await sleep(1500);
  const k1 = await ev(ktx);
  const a = await ev(artSt);
  // 看向剪影方向
  const yaw = await ev(`(() => { const p = __s1.rig.body.position; const sil = __s1.scene.getObjectByName('s1-sky-silhouettes').children[0].getWorldPosition(new p.constructor()); __s1.cameraFollow.yaw = Math.atan2(-(sil.x - p.x), -(sil.z - p.z)); return __s1.cameraFollow.yaw; })()`);
  await sleep(1500);
  await page.screenshot(`${SH}/013-silhouettes-on.png`);
  await ev(`(__s1.scene.getObjectByName('s1-sky-silhouettes').visible = false, 1)`); await sleep(800);
  await page.screenshot(`${SH}/013-silhouettes-off.png`);
  await ev(`(__s1.scene.getObjectByName('s1-sky-silhouettes').visible = true, 1)`);
  // 看向 S3 灯塔
  await ev(`(() => { const p = __s1.rig.body.position; const t = __s1.art.tower.getWorldPosition(new p.constructor()); __s1.cameraFollow.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z)); return 1; })()`);
  await sleep(1500);
  await page.screenshot(`${SH}/013-far-tower-dark.png`);
  const a2 = await ev(artSt);
  rec(T, '远景灯塔熄灭', a.tower && a.towerLitMats === 0 && a.warmLights === 0 && a.silEmissive === 0 ? 'PASS' : 'FAIL', a);
  rec(T, 'KTX2 首次加载', k1.dup.length === 0 ? 'PASS' : 'FAIL', k1);
  await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
  await must(`!!window.__s1?.art && __game.input.context === 'explore'`, 300000, 'S1 art explore 2');
  await sleep(1000);
  const k2 = await ev(ktx);
  rec(T, 'KTX2 刷新后走缓存', k2.dup.length === 0 && k2.cached === k2.n ? 'PASS' : 'INFO', k2);
  rec(T, '剪影信息', 'INFO', { yaw, a2 });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
