// batch21 ①：?reflectK=0/0.5/1 + 无参数默认（强度），三档默认分辨率倍率；开场 / 码头统计 + 3 帧（接缝 / 闪）
import { open, sleep, SH16 as SH } from './b21lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const K = process.env.RK ?? 'default'; const Q = process.env.RQ ?? 'high';
const D = `${SH}/reflect`; mkdirSync(D, { recursive: true });
const tag = `k${K}-${Q}`;
const { page, ev, must, url, done } = await open(5691, { width: 1280, height: 720 });
const out = { reflectK: K, quality: Q };
const save = () => writeFileSync(`${D}/t21-reflect-${tag}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const VIEWS = { pier: [[2.5, 3.2, -3.5], [-5, 0.6, -11], 50], opening: [[-0.9, 4.2, 9.5], [6.58, 4.2, -29.78], 40] };
const WF = async (n = 3) => { const b = await ev(`(() => { const s = __s1.reflection.stats; return s.renders + s.skips; })()`); await must(`(() => { const s = __s1.reflection.stats; return s.renders + s.skips >= ${b + n}; })()`, 240000, 'frames'); };
const ST = `(() => { const r = __s1.reflection; const s = r.stats; return { enabled: r.enabled, scale: r.scale, strength: r.strength, rendered: s.rendered, skip: s.skip, k: +(+s.k).toFixed(3), w: s.width, h: s.height, calls: s.calls, tri: s.triangles, renders: s.renders, skips: s.skips, uReflK: +(+(__s1.water.uniforms?.uReflK?.value ?? NaN)).toFixed(3) }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=${Q}&autostart=1${K === 'default' ? '' : '&reflectK=' + K}`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  out.loads = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
  out.init = await ev(`(() => { const s = __s1, q = __game.quality.preset; return { tier: q.tier, planarPreset: q.reflections.planar, strengthPreset: q.reflections.planarStrength, override: s.reflectOverride, kOverride: s.reflectKOverride, hasRefl: !!s.reflection, scale: s.reflection?.scale, strength: s.reflection?.strength, waterY: +s.water.position.y.toFixed(3) }; })()`);
  out.debugLine = await ev(`(() => { try { return __s1.reflection.debugLine(); } catch (e) { return String(e); } })()`);
  log('init', JSON.stringify(out.init), JSON.stringify(out.debugLine)); save();
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); s.cameraFollow.update = () => {}; return 1; })()`);
  out.views = {};
  for (const [v, [eye, at, fov]] of Object.entries(VIEWS)) {
    await ev(`(() => { const c = __s1.camera; c.position.set(${eye}); c.fov = ${fov}; c.lookAt(${at.join(',')}); c.updateProjectionMatrix(); c.updateMatrixWorld(); return 1; })()`);
    await WF(3);
    const samples = []; for (let i = 0; i < 3; i++) { samples.push(await ev(ST)); await WF(1); }
    const shots = [];
    for (let i = 0; i < 3; i++) { const f = `${D}/${v}-${tag}-${i}.png`; await page.screenshot(f); shots.push(f.split('/').pop()); await WF(1); }
    out.views[v] = { samples, shots }; log(v, JSON.stringify(samples.at(-1))); save();
  }
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
