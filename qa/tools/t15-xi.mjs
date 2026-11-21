// batch15 016 汐下摆 / 袖口特写：S1 art=1 high，用 char-xi 模型根（rig.animator.model）的 +Z 当正面；冻结后摆机位
import { open, sleep, SH15 } from './b15lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH15}/xi`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5604, { width: 1280, height: 720 });
const out = { loads: [], shots: {} };
const raf = () => ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))');
try {
  for (let att = 1; att <= 3; att++) {
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=high&autostart=1`));
    await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 400000, 's1');
    for (let k = 0; k < 4; k++) { await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 400000, 'loads'); await sleep(3000); }
    const ls = await ev(`(() => { const s = __game.assets.loadStats; return { n: s.length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop()) }; })()`);
    out.loads.push(ls); console.log('load', att, ls.n, ls.bad.length); if (!ls.bad.length) break; if (att === 3) throw new Error('占位');
  }
  await ev(`(() => { const s = __s1; s.cameraFollow.update = () => {}; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; window.__unf = __game.freeze(); return 1; })()`);
  const VIEWS = {
    'hem-front': `at = P(0, 0.70, 0); eye = P(0, 0.74, 0.62);`,
    'hem-front-low': `at = P(0, 0.70, 0); eye = P(0.1, 0.45, 0.55);`,
    'hem-side': `at = P(0, 0.70, 0.08); eye = P(0.6, 0.74, 0.35);`,
    'cuff-r-front': `at = C('r'); eye = at.clone().addScaledVector(f, 0.5).addScaledVector(rt, -0.12).add(new V(0, 0.05, 0));`,
    'cuff-l-front': `at = C('l'); eye = at.clone().addScaledVector(f, 0.5).addScaledVector(rt, 0.12).add(new V(0, 0.05, 0));`,
    'cuff-r-under': `at = C('r'); eye = at.clone().addScaledVector(f, 0.25).addScaledVector(rt, -0.2).add(new V(0, -0.35, 0));`,
    'cuff-l-under': `at = C('l'); eye = at.clone().addScaledVector(f, 0.25).addScaledVector(rt, 0.2).add(new V(0, -0.35, 0));`,
    'cuff-r-side': `at = C('r'); eye = at.clone().addScaledVector(rt, -0.5).add(new V(0, 0.03, 0));`,
  };
  for (const [name, code] of Object.entries(VIEWS)) {
    const r = await ev(`(() => { const s = __s1; const m = s.rig.animator.model; m.updateMatrixWorld(true); const V = m.position.constructor; const p = m.getWorldPosition(new V());
      const f = new V(0, 0, 1).transformDirection(m.matrixWorld).setY(0).normalize(); const rt = new V(f.z, 0, -f.x);
      const P = (x, y, z) => p.clone().addScaledVector(rt, x).add(new V(0, y, 0)).addScaledVector(f, z);
      const C = (sd) => { const h = m.getObjectByName('hand_' + sd).getWorldPosition(new V()); return h.lerp(m.getObjectByName('lower_arm_' + sd).getWorldPosition(new V()), 0.18); };
      let at, eye; ${code}
      const c = s.camera; c.position.copy(eye); c.fov = 35; c.near = 0.02; c.lookAt(at); c.updateProjectionMatrix(); c.updateMatrixWorld(); return { eye: eye.toArray().map(v => +v.toFixed(3)), at: at.toArray().map(v => +v.toFixed(3)) }; })()`);
    await raf(); await sleep(300); await page.screenshot(`${D}/xi-${name}.png`); out.shots[name] = r;
  }
  await ev(`(() => { __unf(); return 1; })()`);
  out.errors = page.errors.slice(0, 6).map(e => String(e).slice(0, 200));
} finally { writeFileSync(`${D}/t15-xi.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
