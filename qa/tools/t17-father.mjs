// batch17 ③ 父亲回忆：~36 s 出现、hand-on-head、半透明、42.6 消失；冻结测手–汐头发间隙 + 截图；④/② 顺带：跳过提示实际绘制检查
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/father`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5617, { width: 1280, height: 720 });
const out = { pts: [] };
const save = () => writeFileSync(`${D}/t17-father.json`, JSON.stringify(out, null, 1));
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
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer && !!__s3.father && !!__s3.rig?.animator`, 300000, 'ready');
  await ev(`(() => { localStorage.clear(); const c = __s3.endingCutscene; window.__fv = []; const o = c.update.bind(c); c.update = () => { o(); const f = __s3.father; let op = null; f?.root?.traverse((x) => { if (op === null && x.isMesh) op = [].concat(x.material)[0].opacity; }); __fv.push([+performance.now().toFixed(0), +c.t.toFixed(2), f?.root?.visible ? 1 : 0, op === null ? null : +op.toFixed(3), f?.mode ?? null]);
    if (window.__frzAt && c.t >= __frzAt) { window.__frzAt = null; window.__unf = __game.freeze(); } }; return 1; })()`);
  await ev(`__s3.lightTheLamp(), 1`);
  for (const T of [36.9, 38.5, 40.0, 41.4]) {
    await ev(`(window.__frzAt = ${T}, 1)`);
    await must(`!!window.__unf`, 400000, 'frz' + T);
    await sleep(300);
    const m = await ev(MEAS); out.pts.push(m); console.log(JSON.stringify(m));
    await page.screenshot(`${D}/father-t${m.t}.png`);
    await ev(`(() => { const u = __unf; window.__unf = null; u(); return 1; })()`);
  }
  // 父亲退场：等 t ≥ 44
  await must(`__s3.endingCutscene.t >= 44`, 300000, 't44');
  out.after = await ev(`({ t: __s3.endingCutscene.t, vis: __s3.father.root.visible, log: __s3.endingCutscene.player.log.filter((x) => /father/.test(x.id)) })`);
  // 跳过提示实际绘制：短按 0.4 s（不会跳过）后截图
  await page.keyDown('Space'); await sleep(450);
  out.hint = await ev(`(() => { const e = document.querySelector('.skip-hint'); const r = e.getBoundingClientRect(); const chain = []; for (let x = e; x && x !== document.documentElement; x = x.parentElement) { const cs = getComputedStyle(x); chain.push([x.className || x.tagName, cs.display, cs.visibility, cs.opacity, cs.zIndex]); } const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hidden: e.hidden, r: [r.x, r.y, r.width, r.height], text: e.textContent, color: getComputedStyle(e).color, chain, top: top ? (top.className?.baseVal ?? top.className) + '/' + top.tagName : null }; })()`);
  await page.screenshot(`${D}/hint-hold.png`);
  await page.keyUp('Space'); await sleep(1500);
  out.notSkipped = await ev(`({ endedBy: __s3.endingCutscene.endedBy, t: __s3.endingCutscene.t })`);
  out.fv = (await ev(`__fv`)).filter((x) => x[1] > 34 && x[1] < 47);
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
