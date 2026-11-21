// batch13 ③ 地窖钥匙点光 / 高亮 + 地窖门角光照贴图（S2 art=1）
import { open, sleep, EVLOG, SH13, counter } from './b13lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b13-cellar';
const block = process.argv[2] === 'fallback';
const tag = block ? 'fb' : 'lh';
const { page, ev, must, url, rec, step, done } = await open(5561 + (block ? 1 : 0), { width: 960, height: 540 });
await page.addInit(EVLOG);
if (block) { await page.send('Network.enable'); await page.send('Network.setBlockedURLs', { urls: ['*prop-key-lighthouse*'] }); }
const out = {};
await step(T, 'load', async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=s2&art=1&quality=standard`));
  await must(`!!window.__s2?.rig && !!__s2.art?.loaded && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 's2');
});
const S = '__s2';
const kl = `(() => { const s = __s2, L = s.puzzles.keyLight?.light; if (!L) return null; const V = L.position.constructor; const sock = s.art.root.getObjectByName('env-cellar-s2-key-socket'); const lw = L.getWorldPosition(new V()); const sw = sock.getWorldPosition(new V()); const k = s.art.cellarKey; const kw = k ? k.getWorldPosition(new V()) : null;
  return { name: L.name, color: '#' + L.color.getHexString(), I: +L.intensity.toFixed(4), dist: L.distance, decay: L.decay, shadow: L.castShadow, visible: L.visible, parent: L.parent?.name, aboveSocket: [lw.x - sw.x, lw.y - sw.y, lw.z - sw.z].map(v => +v.toFixed(3)), keyModel: k?.name ?? null, keyParent: k?.parent?.name ?? null, keyW: kw?.toArray().map(v => +v.toFixed(3)), HL: s.puzzles.keyHighlighted, hasKey: s.puzzles.state.hasKey, pos: s.rig.body.position.toArray().map(v => +v.toFixed(2)) }; })()`;
const tp = (x, y, z) => ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.body.position.constructor(${x}, ${y}, ${z})); s.rig.body.velocity?.set?.(0,0,0); return 1; })()`);
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 120000, 50); };
await step(T, 'light-params', async () => {
  out.lm = await ev(`__s2.lightmaps.map(h => ({ root: h.root.name, key: h.key, scale: +h.scale.toFixed(4), meshes: h.meshes, mats: h.materials.length, lmI: h.materials.map(m => +m.lightMapIntensity.toFixed(4)).slice(0,3), base: h.extras.lightMapIntensity }))`);
  out.outside = await ev(kl);
  rec(T, `${tag} 灯参数 + 地窖外`, 'INFO', { lm: out.lm, kl: out.outside });
});
await step(T, 'door', async () => {
  await ev(counter(S));
  await ev(`window.__f = () => { const s = __s2; const h = s.lightmaps.find(h => (h.root.userData.name ?? h.root.name) === 'env-cellar-s2'); return [__game.time.fixedTick, +s.puzzles.state.doorOpen.toFixed(5), +h.scale.toFixed(5), +h.materials[0].lightMapIntensity.toFixed(5)]; }; window.__smp = []; 1`);
  await ev(`window.__fr = []; (() => { const g = (window.__frg = (window.__frg ?? 0) + 1); const r = () => { if (window.__frg !== g) return; const s = __s2; const h = s.lightmaps.find(h => (h.root.userData.name ?? h.root.name) === 'env-cellar-s2'); window.__fr.push([__game.time.fixedTick, +s.puzzles.state.doorOpen.toFixed(5), +h.scale.toFixed(5)]); if (window.__fr.length < 4000) requestAnimationFrame(r); }; requestAnimationFrame(r); })(); 1`);
  await ticks(5);
  await ev(`__game.events.emit('receiver:activated', { id: __s2.puzzles.beam.lock.id }); 1`);
  await page.waitFor(`__s2.puzzles.state.doorOpen >= 1`, 180000, 100);
  await ticks(20);
  out.doorTicks = await ev('window.__smp'); out.doorFrames = await ev('window.__fr'); await ev('window.__smp = null; window.__frg++; 1');
  const f = (u) => { u = Math.min(1, Math.max(0, u)); const s = u * u * (3 - 2 * u); return 0.55 + 0.45 * s; };
  const tk = out.doorTicks.filter(r => Array.isArray(r));
  let maxTickExp = 0; for (let i = 1; i < tk.length; i++) maxTickExp = Math.max(maxTickExp, Math.abs(f(tk[i][1]) - f(tk[i - 1][1])));
  let maxFrame = 0, maxFrameTicks = 0, maxMis = 0; const fr = out.doorFrames;
  for (let i = 1; i < fr.length; i++) { const d = Math.abs(fr[i][2] - fr[i - 1][2]); if (d > maxFrame) { maxFrame = d; maxFrameTicks = fr[i][0] - fr[i - 1][0]; } }
  for (const r of fr) maxMis = Math.max(maxMis, Math.abs(r[2] - f(r[1])));
  const first = tk[0], last = tk[tk.length - 1];
  out.doorSum = { ticks: tk.length, start: first, end: last, maxTickStepExpected: +maxTickExp.toFixed(5), frames: fr.length, maxFrameStep: +maxFrame.toFixed(5), ticksInThatFrame: maxFrameTicks, maxMismatchVsFormula: +maxMis.toFixed(5), monotonic: fr.every((r, i) => i === 0 || r[2] >= fr[i - 1][2] - 1e-6) };
  rec(T, `${tag} 地窖门开：光照贴图倍率随门角`, 'INFO', out.doorSum);
});
await step(T, 'key-light', async () => {
  const kw = out.outside.keyW;
  const seq = [];
  // 楼梯顶（地窖外，y > -0.6）
  await tp(0.8, 0.1, 3.3); await ticks(40); seq.push({ at: 'stair-top', ...(await ev(kl)) });
  // 进地窖底：逐 tick 采样淡入
  await ev(`window.__f = () => [__game.time.fixedTick, +(__s2.puzzles.keyLight.light.intensity).toFixed(4), __s2.puzzles.keyHighlighted]; window.__smp = []; 1`);
  await tp(-0.3, -2.35, -0.9); await ticks(45);
  out.fadeIn = await ev('window.__smp'); await ev('window.__smp = null; 1');
  seq.push({ at: 'cellar-far', dKey: +Math.hypot(-0.3 - kw[0], -0.9 - kw[2]).toFixed(2), ...(await ev(kl)) });
  for (const d of [3.2, 2.0, 1.0]) { await tp(kw[0] + d, -2.35, kw[2]); await ticks(15); seq.push({ at: 'cellar d=' + d, ...(await ev(kl)) }); }
  await ev(`(() => { const s = __s2; const st = s.interaction.get('cellar-key-s2').standPoint(new s.rig.body.position.constructor()); s.rig.body.teleport(st.position.clone().setY(st.position.y + 0.05)); s.rig.controller.facing = st.facing; return 1; })()`);
  await ticks(30); seq.push({ at: 'stand', cur: await ev(`__s2.interaction.current?.id ?? null`), ...(await ev(kl)) });
  await sleep(500); await page.screenshot(`${SH13}/key-hl-${tag}.png`);
  // 地窖里雨丝：记录 rain.visible / 相机室内判定，关掉雨再拍一张对比
  out.rainIndoor = await ev(`({ rain: __s2.rain?.visible ?? null, camIndoor: __s2.cameraFollow.indoor, cam: __s2.camera.position.toArray().map(v => +v.toFixed(2)) })`);
  await ev(`(() => { __s2.rain.__v = __s2.rain.visible; __s2.rain.object3D ? (__s2.rain.object3D.visible = false) : null; if (__s2.rain.lines) __s2.rain.lines.visible = false; if (__s2.rain.quads) __s2.rain.quads.visible = false; return 1; })()`);
  await ticks(10); await sleep(300); await page.screenshot(`${SH13}/key-hl-${tag}-norain.png`);
  await ev(`(() => { if (__s2.rain.lines) __s2.rain.lines.visible = true; if (__s2.rain.object3D) __s2.rain.object3D.visible = true; return 1; })()`);
  // 出地窖：淡出
  await ev(`window.__smp = []; 1`); await tp(0.8, 0.1, 3.3); await ticks(45); out.fadeOut = await ev('window.__smp'); await ev('window.__smp = null; 1');
  seq.push({ at: 'out-again', ...(await ev(kl)) });
  // 回去拿钥匙
  await ev(`(() => { const s = __s2; const st = s.interaction.get('cellar-key-s2').standPoint(new s.rig.body.position.constructor()); s.rig.body.teleport(st.position.clone().setY(st.position.y + 0.05)); s.rig.controller.facing = st.facing; return 1; })()`);
  await ticks(40);
  await ev(`window.__f = () => [__game.time.fixedTick, +(__s2.puzzles.keyLight.light.intensity).toFixed(4), __s2.puzzles.keyHighlighted, __s2.puzzles.state.hasKey]; 1`);
  // 按 E：站在钥匙站位、朝钥匙，按交互键实际触发的是哪个
  const f0 = await ev('__game.time.fixedTick');
  out.eCurRaw = await ev(`__s2.interaction.current?.id ?? null`);
  await ev(`(() => { const s = __s2; s.cameraFollow.yaw = s.rig.controller.facing; s.cameraFollow.pitch = -0.35; return 1; })()`); await ticks(40);
  out.eCur = await ev(`({ cur: __s2.interaction.current?.id ?? null, yaw: +__s2.cameraFollow.yaw.toFixed(3), facing: +__s2.rig.controller.facing.toFixed(3) })`);
  await page.screenshot(`${SH13}/key-stand-${tag}.png`);
  await page.tap('KeyE'); await ticks(90);
  out.eEvents = await ev(`__ev.filter(e => e.ft >= ${f0} && /interact|reader|subtitle/.test(e.n)).map(e => e.n + ':' + (e.e?.id ?? e.e?.docId ?? ''))`);
  out.eHasKey = await ev('__s2.puzzles.state.hasKey');
  await ev(`(() => { if (__game.ui.reader.isOpen) __game.ui.reader.close(); return 1; })()`); await ticks(30);
  await ev(`window.__smp = []; 1`);
  if (!out.eHasKey) await ev(`(() => { const s = __s2; s.interaction.trigger(s.interaction.get('cellar-key-s2')); return 1; })()`);
  await page.waitFor(`__s2.puzzles.state.hasKey && !__s2.interaction.animState && !__s2.rig.controller.busy`, 60000, 100); await ticks(30);
  out.pick = await ev('window.__smp'); await ev('window.__smp = null; 1');
  seq.push({ at: 'after-pick', ...(await ev(kl)) });
  out.seq = seq;
  const fi = out.fadeIn.filter(Array.isArray), fo = out.fadeOut.filter(Array.isArray), pk = out.pick.filter(Array.isArray);
  const firstFull = fi.find(r => r[1] >= 0.15); const firstZero = fo.find(r => r[1] === 0);
  const pickIdx = pk.findIndex(r => r[1] === 0); const hasIdx = pk.findIndex(r => r[3] === true); out.pickAlign = { firstZero: pk[pickIdx], firstHasKey: pk[hasIdx], lastBefore: pk[Math.max(0, hasIdx - 1)] };
  out.fadeSum = { fadeInTicksToFull: firstFull ? firstFull[0] - fi[0][0] : null, fadeOutTicksToZero: firstZero ? firstZero[0] - fo[0][0] : null, pickTicksToZero: pickIdx, pickFirst: pk[0], pickLast: pk[pk.length - 1] };
  rec(T, `${tag} 钥匙点光 / 高亮序列`, 'INFO', { seq, fade: out.fadeSum, pickAlign: out.pickAlign, eCurRaw: out.eCurRaw, rainIndoor: out.rainIndoor, eCur: out.eCur, eEvents: out.eEvents, eHasKey: out.eHasKey });
});
writeFileSync(`${SH13}/cellar-${tag}.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
