// batch22 ⑤ 快查：反射默认强度 0.5 / 三档 RT 倍率（极致进场后切档）+ BUG-028 相机（南缝 x10.5 朝东站、朝北 yaw0、原地转）
import { open, sleep, SH16 as SH } from './b22lib.mjs';
import { HOOK } from './t21-camlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/quick`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5741, { width: 1280, height: 720 });
const out = { refl: {}, segs: [] }; const save = () => writeFileSync(`${D}/t22-quick.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const ST = `(() => { const r = __s1.reflection, s = r.stats, q = __game.quality.preset; return { tier: q.tier, planarPreset: q.reflections.planar, strengthPreset: q.reflections.planarStrength, scale: r.scale, strength: r.strength, k: +(+s.k).toFixed(3), w: s.width, h: s.height, rendered: s.rendered, skip: s.skip, kOverride: __s1.reflectKOverride, override: __s1.reflectOverride }; })()`;
const WF = async (n = 3) => { const b = await ev(`(() => { const s = __s1.reflection.stats; return s.renders + s.skips; })()`); await must(`(() => { const s = __s1.reflection.stats; return s.renders + s.skips >= ${b + n}; })()`, 240000, 'frames'); };
const Z = -8.6, E = -Math.PI / 2;
const put = (x, yaw, pitch = -0.3) => `(() => { const s = __s1, V = s.rig.body.position.constructor; s.puzzles.tide.set('low', { instant: true }); s.rig.body.teleport(new V(${x}, 0.6, ${Z})); s.rig.body.velocity?.set?.(0, 0, 0); s.rig.controller.facing = ${yaw} + Math.PI; __cam.yaw = ${yaw}; __cam.pitch = ${pitch}; __cam.spin = 0; return 1; })()`;
async function seg(name, setup, body, shot) {
  await ev(setup); await ev(`__gwait(0.5)`); await ev(`(__cam.rec = [], __cam.last = null, 1)`);
  const extra = await ev(body); const rec = await ev(`(() => { const r = __cam.rec; __cam.rec = null; return r; })()`);
  const sm = await ev(`__summ(${JSON.stringify(rec)})`);
  // 钩子看到的 alpha 晚一帧：按下一帧比对公式
  const na = (h) => { const k = Math.min(1, Math.max(0, (h - 0.35) / 0.55)); return k * k * (3 - 2 * k); };
  sm.lagMismatch = rec.slice(0, -1).filter((q, i) => q.hd != null && q.mode === 'explore' && !rec[i + 1].bl && Math.abs(na(q.hd) - rec[i + 1].a) > 0.02).length;
  const r = { name, ...sm, extra };
  if (shot) { await ev(`(__game.time.timeScale = 0, 1)`); await sleep(2500); r.shot = `${name}.png`; await page.screenshot(`${D}/${name}.png`); await ev(`(__game.time.timeScale = 1, 1)`); }
  out.segs.push(r); log(name, JSON.stringify(sm), JSON.stringify(extra)); save();
}
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=ultra&autostart=1`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  await WF(3); out.refl.ultra = await ev(ST); log('ultra', JSON.stringify(out.refl.ultra));
  for (const t of ['high', 'standard', 'ultra']) { await ev(`(__game.quality.set('${t}'), 1)`); await WF(4); out.refl[t + (t === 'ultra' ? '-back' : '')] = await ev(ST); log(t, JSON.stringify(out.refl[t + (t === 'ultra' ? '-back' : '')])); save(); }
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await ev(HOOK); out.cfg = await ev(`__s1.cameraFollow.cfg.nearFade`);
  const hold = (s) => `(async () => { await __gwait(${s}); return { mat: __mat(), a: __s1.xiNearAlpha }; })()`;
  await seg('stand-east-x10.5', put(10.5, E), hold(1.5), true);
  await seg('north-rock-yaw0-x10.5', put(10.5, 0), hold(2), true);
  const spin = `(async () => { __cam.spin = 2; let mat = null, minA = 1; const g = () => __game.time.fixedTick * __game.time.fixedDelta; const g0 = g();
    while (g() - g0 < Math.PI) { await new Promise((r) => setTimeout(r, 40)); if (__s1.xiNearAlpha < minA) { minA = __s1.xiNearAlpha; mat = __mat(); } } __cam.spin = 0; return { matAtMinAlpha: mat }; })()`;
  await seg('spin-x10.5', put(10.5, E), spin);
  await seg('spin-x12', put(12, E), spin);
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
