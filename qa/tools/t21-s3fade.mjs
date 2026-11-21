// batch21 ②补：S3 — 强制淡出（nearFade 临时 [0.35, 50]）时钢笔 / 父亲 / 幽灵预写材质不被动；结尾演出里汐不淡（alpha 1）、钢笔照常显示、幽灵照常
import { open, sleep, SH16 as SH } from './b21lib.mjs';
import { HOOK } from './t21-camlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/bug028`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5694, { width: 1280, height: 720 });
const out = { samples: [] }; const save = () => writeFileSync(`${D}/t21-s3fade.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const OWN = `(() => { const s = __s3, saved = s.nearFade?.saved ? [...s.nearFade.saved.keys()] : []; const set = new Set(saved);
  const mats = (root) => { const r = []; root?.traverse?.((o) => { if (o.isMesh) for (const m of [].concat(o.material)) r.push(m); }); return r; };
  const pen = mats(s.pen?.root), fa = mats(s.father?.root), pre = (s.endingCutscene?.ghost?.prepasses ?? []).flatMap((p) => mats(p));
  const st = (arr) => ({ n: arr.length, inSaved: arr.filter((m) => set.has(m)).length, faded: arr.filter((m) => m.alphaHash || m.opacity < 0.999).length, ops: [...new Set(arr.map((m) => +m.opacity.toFixed(3) + (m.alphaHash ? 'h' : '') + (m.transparent ? 't' : '')))].slice(0, 6) });
  return { alpha: +(+s.xiNearAlpha).toFixed(3), touched: s.nearFade?.touched ?? 0, pen: st(pen), father: st(fa), prepass: st(pre), xi: __mat() }; })()`;
const PS = `(() => { const s = __s3, p = s.pen, c = s.endingCutscene, g = c?.ghost; return { t: c ? +c.t.toFixed(2) : null, shot: c?.shot ?? null, scene: __game.scenes.current?.name, mode: s.cameraFollow.modeName, alpha: +(+s.xiNearAlpha).toFixed(3), touched: s.nearFade?.touched ?? 0, hd: Number.isFinite(s.cameraFollow.headDistance) ? +s.cameraFollow.headDistance.toFixed(2) : null, penVis: p ? p.root.visible : null, ghostOp: g ? +g.opacity.toFixed(3) : null, preVis: g ? g.prepasses.filter((q) => q.visible).length : null }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3'); log('s3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`(!!__s3.pen || !!__s3.penError) && !!__s3.father`, 120000, 'pen');
  await ev(HOOK); await ev(`(document.getElementById('ui-root').style.display = 'none', 1)`);
  out.base = await ev(OWN); log('base', JSON.stringify(out.base));
  out.nearFadeDefault = await ev(`__s3.cameraFollow.cfg.nearFade`);
  await ev(`(__s3.cameraFollow.cfg.nearFade = [0.35, 50], 1)`); await ev(`__gwait(0.8)`);
  out.forced = await ev(OWN); log('forced', JSON.stringify(out.forced)); await page.screenshot(`${D}/s3-forced-fade.png`); save();
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'music');
  await ev(`(() => { localStorage.clear(); __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene && __s3.endingCutscene.t > 0.5`, 600000, 'start'); log('started');
  out.cutStart = await ev(OWN); log('cutStart', JSON.stringify(out.cutStart));
  let penShot = false, ghostShot = false;
  for (let i = 0; i < 1600; i++) {
    const s = await ev(PS).catch((e) => ({ err: String(e) })); out.samples.push(s);
    if (s.penVis && !penShot) { await page.screenshot(`${D}/s3-cut-pen-t${s.t}.png`); penShot = true; out.atPen = await ev(OWN); log('pen', JSON.stringify(s), JSON.stringify(out.atPen)); save(); }
    if (s.ghostOp > 0.5 && !ghostShot) { await page.screenshot(`${D}/s3-cut-ghost-t${s.t}.png`); ghostShot = true; out.atGhost = await ev(OWN); log('ghost', JSON.stringify(s), JSON.stringify(out.atGhost)); save(); }
    if (s.scene && s.scene !== 's3-lighthouse') break;
    if (i % 40 === 0) { log(JSON.stringify(s)); save(); }
    await sleep(250);
  }
  const cut = out.samples.filter((q) => q.t != null && q.scene === 's3-lighthouse');
  out.cutSummary = { n: cut.length, alphaMin: Math.min(...cut.map((q) => q.alpha)), touchedMax: Math.max(...cut.map((q) => q.touched)), penVisSamples: cut.filter((q) => q.penVis).length, ghostMax: Math.max(...cut.map((q) => q.ghostOp ?? 0)), modes: [...new Set(cut.map((q) => q.mode))] };
  log('cutSummary', JSON.stringify(out.cutSummary));
  await ev(`(__s3?.cameraFollow && (__s3.cameraFollow.cfg.nearFade = ${JSON.stringify(out.nearFadeDefault)}), 1)`).catch(() => {});
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
