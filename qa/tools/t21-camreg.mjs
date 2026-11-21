// batch21 ②补：其它地方不变差 — 码头 / 窄处，同一会话 修前参数（程序 shots-bug028 LEGACY）vs 默认参数，原地转 360° 比最小相机–头距离
import { open, sleep, SH16 as SH } from './b21lib.mjs';
import { HOOK } from './t21-camlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const PART = process.env.PART ?? 'A';
const D = `${SH}/bug028`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5693, { width: 1280, height: 720 });
const out = { part: PART, rows: [] }; const save = () => writeFileSync(`${D}/t21-cam-reg-${PART}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const ALL = {
  A: [['pier-deck-mid', -3.39, 2.6, -9.8], ['pier-sea-end', 2.28, 2.6, -11.77], ['pier-land-end', -8.6, 2.6, -8.0], ['under-pier', -3.39, 0.5, -9.8], ['under-pier-w', -6.0, 0.5, -8.7], ['reef-stairs', -8.2, 1.8, -3.0]],
  B: [['reef-path', -3.2, 0.7, -0.7], ['ridge', -9, 2.5, 3], ['far-steps', -0.9, 3.0, 14.5], ['rocks-9-5', 9, 0.5, -5.2], ['rocks-7-4', 7.2, 0.5, -4.4], ['gap157-west-mouth', 7.0, 0.5, -8.6]],
}[PART];
const LEGACY = JSON.stringify({ shoulderSkin: 0, shoulderSwitchGain: 1e9, shoulderSwitchRatio: 0, lowSpaceLift: 0, nearFade: [-2, -1] });
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1'); log('s1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
  await ev(HOOK);
  const DEF = await ev(`JSON.stringify(Object.fromEntries(Object.keys(${LEGACY}).map((k) => [k, __s1.cameraFollow.cfg[k]])))`); out.defaults = JSON.parse(DEF);
  for (const [name, x, y, z] of ALL) for (const variant of ['before', 'after']) {
    try {
      await ev(`(() => { const s = __s1, V = s.rig.body.position.constructor; Object.assign(s.cameraFollow.cfg, ${variant === 'before' ? LEGACY : DEF}); s.puzzles.tide.set('low', { instant: true }); s.rig.body.teleport(new V(${x}, ${y}, ${z})); s.rig.body.velocity?.set?.(0, 0, 0); __cam.yaw = 0; __cam.pitch = -0.3; __cam.spin = 0; return 1; })()`);
      await ev(`__gwait(0.6)`); await ev(`(__cam.rec = [], __cam.last = null, __cam.spin = 3, 1)`);
      await ev(`__gwait(${(2 * Math.PI) / 3})`);
      const sm = await ev(`(() => { __cam.spin = 0; const r = __cam.rec; __cam.rec = null; return __summ(r); })()`);
      const r = { name, variant, at: [x, y, z], ...sm };
      if (variant === 'after' && /pier-deck-mid|under-pier$|reef-stairs|ridge|rocks-9-5/.test(name)) { await ev(`(__game.time.timeScale = 0, 1)`); await sleep(2000); await page.screenshot(`${D}/reg-${name}.png`); r.shot = `reg-${name}.png`; await ev(`(__game.time.timeScale = 1, 1)`); }
      out.rows.push(r); log(name, variant, JSON.stringify(sm)); save();
    } catch (e) { out.rows.push({ name, variant, fail: String(e?.message ?? e) }); log('FAILROW', name, variant, e?.message ?? e); save(); }
  }
  await ev(`(Object.assign(__s1.cameraFollow.cfg, ${DEF}), 1)`);
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
