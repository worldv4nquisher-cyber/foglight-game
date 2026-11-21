// batch18 ③④⑥：结尾完整播放；逐帧记 幽灵不透明度 / 预写可见数 / 玻璃 uSpecGate / 镜头；冻结点截图（1280×720）+ 父亲手–汐头发间隙
import { open, sleep, SH16 as SH } from './b18lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const TAG = process.env.TAG || ''; const Q = process.env.Q || ''; const TS = process.env.TS ? process.env.TS.split(',').map(Number) : null;
const D = `${SH}/wash`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5641, { width: 1280, height: 720 });
const out = { pts: [], sweep: [] };
const save = () => writeFileSync(`${D}/t18-wash.json`, JSON.stringify(out, null, 1));
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
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer && !!__s3.father && !!__s3.rig?.animator`, 300000, 'ready');
  await ev(`(localStorage.clear(), __s3.lightTheLamp(), 1)`);
  await must(`__s3.endingCutscene.t > 0.5`, 300000, 'start');
  await ev(`(() => { window.__hold = false; window.__clk = { base: 0, p0: performance.now(), rate: 1 }; window.__now = () => { const k = __clk; return k.base + (performance.now() - k.p0) * k.rate; }; window.__rate = (r) => { __clk.base = __now(); __clk.p0 = performance.now(); __clk.rate = r; };
    const c = __s3.endingCutscene.clock; c.src = { audio: () => null, now: () => __now(), paused: () => window.__hold }; return 1; })()`);
  const T = 38.5;
  await ev(`(() => { __s3.endingCutscene.seek(${T} - 0.12); __rate(0.03); return 1; })()`);
  await must(`__s3.endingCutscene.t >= ${T}`, 400000, 't' + T);
  await ev(`(window.__hold = true, 1)`);
  // 冻结光束转动：每帧把 rotation.y 拉回 __ang
  out.beam = await ev(`(() => { const b = __s3.scene.getObjectByName('lamp-beam-s3'); if (!b) return null; window.__beam = b; window.__ang = b.rotation.y; b.onBeforeRender = () => {}; const kids = b.children; for (const k of kids) k.onBeforeRender = () => { b.rotation.y = window.__ang; b.updateMatrixWorld(true); };
    const V = b.position.constructor; const cam = __game.scenes.current.camera; return { vis: b.visible, ang: b.rotation.y, origin: b.getWorldPosition(new V()).toArray().map((v) => +v.toFixed(2)), cam: cam.position.toArray().map((v) => +v.toFixed(2)), mats: kids.map((k) => [k.material.opacity, k.material.blending]) }; })()`);
  const head = await ev(MEAS); out.head = head;
  const [hx, hy] = head.headPx;
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12;
    await ev(`(window.__ang = ${a}, 1)`); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
    const f = `/tmp/b18/wash-${i}.png`; await page.screenshot(f); out.sweep.push({ i, a: +a.toFixed(3), f }); save();
  }
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
