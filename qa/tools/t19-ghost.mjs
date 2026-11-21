// batch18 ③④⑥：结尾完整播放；逐帧记 幽灵不透明度 / 预写可见数 / 玻璃 uSpecGate / 镜头；冻结点截图（1280×720）+ 父亲手–汐头发间隙
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const TAG = process.env.TAG || ''; const Q = process.env.Q || ''; const TS = process.env.TS ? process.env.TS.split(',').map(Number) : null;
const D = `${SH}/ghost${TAG ? '-' + TAG : ''}`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5641, { width: 1280, height: 720 });
const out = { pts: [] };
const save = () => writeFileSync(`${D}/t19-ghost.json`, JSON.stringify(out, null, 1));
const MEAS = `(() => { const s = __s3, c = s.endingCutscene, V = s.camera.position.constructor; const v = new V(); const xi = s.rig.animator.model, f = s.father, fr = f.root; xi.updateMatrixWorld(true); fr.updateMatrixWorld(true);
  const C = xi.getObjectByName('head').getWorldPosition(new V()).add(new V(0, 0.07, 0));
  const B = 2 * Math.PI / 180; const key = (d) => Math.round(Math.acos(Math.max(-1, Math.min(1, d.y))) / B) + ':' + Math.round((Math.atan2(d.z, d.x) + Math.PI) / B);
  const hairR = new Map();
  const each = (root, test, fn) => root.traverse(m => { if (!m.isSkinnedMesh || /lod[12]/.test(m.name) || !test([].concat(m.material).map(x => x.name).join(' '))) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); m.localToWorld(v); fn(v); } });
  each(xi, n => /hair/.test(n), (q) => { const d = q.clone().sub(C); const r = d.length(); const k = key(d.normalize()); if (r > (hairR.get(k) ?? 0)) hairR.set(k, r); });
  const hb = fr.getObjectByName('hand_r').getWorldPosition(new V());
  let n = 0, over = 0, contact = 0, deep10 = 0, minGap = 9, maxDep = -9;
  each(fr, n2 => /skin/.test(n2), (q) => { if (q.distanceTo(hb) > 0.14) return; n++; const d = q.clone().sub(C); const r = d.length(); const h = hairR.get(key(d.normalize())); if (h === undefined) return; over++; const g = r - h; if (g < minGap) minGap = g; if (-g > maxDep) maxDep = -g; if (Math.abs(g) < 0.005) contact++; if (-g > 0.01) deep10++; });
  const ops = new Set(); fr.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) ops.add(+m.opacity.toFixed(3) + (m.transparent ? 't' : '')); });
  const cam = __game.scenes.current.camera; const pc = C.clone().project(cam); const ph = hb.clone().project(cam);
  return { t: +c.t.toFixed(2), shot: c.shot, mode: f.mode, ftime: +f.time.toFixed(2), vis: fr.visible, ops: [...ops], handDist: +hb.distanceTo(C).toFixed(3), handVerts: n, overHair: over, minGapMm: +(minGap * 1000).toFixed(1), maxDepthMm: +(maxDep * 1000).toFixed(1), contactLt5mm: contact, deepGt10mm: deep10,
    headPx: [Math.round((pc.x + 1) / 2 * innerWidth), Math.round((1 - pc.y) / 2 * innerHeight)], handPx: [Math.round((ph.x + 1) / 2 * innerWidth), Math.round((1 - ph.y) / 2 * innerHeight)] }; })()`;
const GH = `(() => { const g = __s3.endingCutscene.ghost; return g ? { op: +g.opacity.toFixed(3), pre: g.prepasses.filter((p) => p.visible).length, preN: g.prepasses.length, en: g.prepassEnabled } : null; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3${Q}`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer && !!__s3.father && !!__s3.rig?.animator`, 300000, 'ready');
  out.bad = await ev(`__game.assets.loadStats.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop())`);
  out.glass0 = await ev(`({ v: __s3.endingCutscene.glass?.value, n: __s3.endingCutscene.glass?.materials?.length })`);
  await ev(`(localStorage.clear(), __s3.lightTheLamp(), 1)`);
  await must(`__s3.endingCutscene.t > 0.5`, 300000, 'start');
  // 可停 + 可变速的后备时钟（单调）：赶路 rate 1，接近目标切 0.03（每帧只走几十 ms），到目标停住；只往前 seek
  await ev(`(() => { window.__hold = false; window.__clk = { base: 0, p0: performance.now(), rate: 1 }; window.__now = () => { const k = __clk; return k.base + (performance.now() - k.p0) * k.rate; }; window.__rate = (r) => { __clk.base = __now(); __clk.p0 = performance.now(); __clk.rate = r; };
    const c = __s3.endingCutscene.clock; c.src = { audio: () => null, now: () => __now(), paused: () => window.__hold }; return 1; })()`);
  for (const T of TS ?? [36.1, 36.4, 36.7, 37.0, 38.5, 40.0, 41.4, 42.05, 42.3, 42.6, 42.9, 43.3, 50.0]) {
    await ev(`(() => { __rate(1); window.__hold = false; if (__s3.endingCutscene.t < ${T} - 0.2) __s3.endingCutscene.seek(${T} - 0.12); __rate(0.03); return 1; })()`);
    await must(`__s3.endingCutscene.t >= ${T}`, 400000, 't' + T);
    await ev(`(window.__hold = true, 1)`);
    await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
    const m = await ev(MEAS); m.ghost = await ev(GH); m.glass = await ev(`__s3.endingCutscene.glass.value`); out.pts.push(m); console.log(JSON.stringify(m));
    m.beam = await ev(`(() => { const L = __s3.puzzles.lamp; return { style: L.style ?? L.beamStyle ?? null }; })()`).catch((e) => String(e));
    if (T < 44) await page.screenshot(`${D}/ghost-t${T}.png`);
    if (process.env.LEGACY && T < 44) { await ev(`(__s3.puzzles.lamp.setStyle('legacy'), 1)`); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))'); await page.screenshot(`${D}/ghost-t${T}-legacy.png`); await ev(`(__s3.puzzles.lamp.setStyle('volume'), 1)`); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))'); }
    save();
  }
  if (TS) throw new Error('TS-only done');
  // 玻璃：在 42–58 段里（t≈50）跳过 → 应恢复 1
  out.glassBeforeSkip = await ev(`({ t: __s3.endingCutscene.t, g: __s3.endingCutscene.glass.value })`);
  await ev(`(() => { __rate(1); window.__hold = false; return 1; })()`);
  await page.keyDown('Space'); await must(`__game.scenes.current?.name === 'chapter-end' || !!__s3.endingCutscene.endedBy`, 200000, 'skip'); await page.keyUp('Space');
  await must(`__game.scenes.current?.name === 'chapter-end'`, 900000, 'end');
  out.endedBy = await ev(`__s3.endingCutscene?.endedBy ?? null`);
  out.glassEnd = await ev(`__s3.endingCutscene.glass?.value ?? null`);
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
