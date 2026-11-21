// batch20 ③：?reflect=off|0.25|0.5|1 + 默认（high / standard）：倍率生效、开场 / 码头统计、动态 3 帧、贴水高度 k 连续；只看正确性
import { open, sleep, SH16 as SH } from './b20lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const M = process.env.MODE ?? 'default'; const Q = process.env.RQ ?? 'high';
const D = `${SH}/reflect`; mkdirSync(D, { recursive: true });
const tag = `${M}-${Q}`;
const { page, ev, must, url, done } = await open(5681, { width: 1280, height: 720 });
const out = { mode: M, quality: Q };
const save = () => writeFileSync(`${D}/t20-reflect-${tag}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const VIEWS = { pier: [[2.5, 3.2, -3.5], [-5, 0.6, -11], 50], 'pier-low': [[-2.2, 2.3, -2.4], [-3.6, 1.2, -9.8], 55], opening: [[-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40] };
const WF = async (n = 3) => { const b = await ev(`(() => { const s = __s1.reflection.stats; return s.renders + s.skips; })()`); await must(`(() => { const s = __s1.reflection.stats; return s.renders + s.skips >= ${b + n}; })()`, 240000, 'frames'); };
const ST = `(() => { const r = __s1.reflection; const s = r.stats; return { enabled: r.enabled, scale: r.scale, rendered: s.rendered, skip: s.skip, k: +s.k.toFixed(3), w: s.width, h: s.height, calls: s.calls, tri: s.triangles, ms: +s.ms.toFixed(1), renders: s.renders, skips: s.skips, occluded: r.occluded }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=${Q}&autostart=1${M === 'default' ? '' : '&reflect=' + M}`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  out.loads = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
  out.init = await ev(`(() => { const s = __s1, q = __game.quality.preset; return { tier: q.tier, planarPreset: q.reflections.planar, override: s.reflectOverride, hasRefl: !!s.reflection, waterY: +s.water.position.y.toFixed(3), level: s.water.level, tide: s.puzzles?.tide?.state ?? null }; })()`);
  out.debugLine = await ev(`(() => { const t = document.body.innerText.split('\\n').filter((l) => /反射|倒影/.test(l)); return t.slice(0, 4); })()`);
  log('init', JSON.stringify(out.init), JSON.stringify(out.debugLine)); save();
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); s.cameraFollow.update = () => {}; return 1; })()`);
  out.views = {};
  for (const [v, [eye, at, fov]] of Object.entries(VIEWS)) {
    await ev(`(() => { const c = __s1.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`);
    await WF(3);
    const samples = []; for (let i = 0; i < 4; i++) { samples.push(await ev(ST)); await WF(1); }
    const shots = [];
    if (v !== 'pier-low') for (let i = 0; i < 3; i++) { const f = `${D}/${v}-${tag}-${i}.png`; await page.screenshot(f); shots.push(f.split('/').pop()); await sleep(1200); }
    out.views[v] = { samples, shots }; log(v, JSON.stringify(samples.at(-1))); save();
  }
  if (M === 'default' || M === '1') {
    out.heights = [];
    for (const dh of [-0.3, 0.02, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 1.2]) {
      await ev(`(() => { const c = __s1.camera, y = __s1.water.level + ${dh}; c.position.set(-2.2, y, -2.4); c.lookAt(-3.6, y - 0.2, -9.8); c.updateMatrixWorld(); return 1; })()`);
      await WF(3); out.heights.push({ dh, ...(await ev(ST)) });
    }
    log('heights', out.heights.map((h) => `${h.dh}:${h.k}/${h.skip}`).join(' '));
  }
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
