// batch20 ②：钢笔挂点 / 显隐时间线（探索 → 结尾全程每 250 ms 采样）；SKIP=1：seek 到 05 段，显示中跳过 → 立即藏
import { open, sleep, SH16 as SH } from './b20lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const SKIP = process.env.SKIP === '1';
const D = `${SH}/pen`; mkdirSync(D, { recursive: true });
const tag = SKIP ? 'skip' : 'full';
const { page, ev, must, url, done } = await open(5683, { width: 1280, height: 720 });
const out = { tag, samples: [] };
const save = () => writeFileSync(`${D}/t20-pen-${tag}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const PS = `(() => { const p = __s3.pen, an = __s3.rig?.animator, c = __s3.endingCutscene; const cl = p?.clip;
  return { t: c ? +c.t.toFixed(2) : null, shot: c?.shot ?? null, endedBy: c?.endedBy ?? null, scene: __game.scenes.current?.name, posing: an?.posing ?? null, w: p && an ? +an.weightOf(cl).toFixed(3) : null,
    visible: p ? p.root.visible : null, suppressed: p ? p.isSuppressed : null, worldVisible: p ? (() => { let o = p.root; while (o) { if (!o.visible) return false; o = o.parent; } return true; })() : null }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3'); log('s3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.pen || !!__s3.penError`, 120000, 'pen');
  out.mount = await ev(`(() => { const p = __s3.pen; if (!p) return { error: __s3.penError }; const chain = []; let o = p.root.parent; while (o && chain.length < 4) { chain.push(o.name); o = o.parent; }
    return { socket: p.socket?.name, parentChain: chain, clip: p.clip, rootName: p.root.name, loadedPen: __game.assets.has('prop-fountain-pen'), penLoad: __game.assets.loadStats.filter((x) => /fountain-pen/.test(x.url)).map((x) => ({ url: x.url.split('/').pop(), ok: x.ok, fallback: !!x.fallback })) }; })()`);
  out.explore = await ev(PS); log('mount', JSON.stringify(out.mount), JSON.stringify(out.explore)); save();
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'music');
  await ev(`(() => { localStorage.clear(); __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene && __s3.endingCutscene.t > 0.5`, 600000, 'start'); log('started');
  if (SKIP) { await ev(`(__s3.endingCutscene.seek(60), 1)`); await must(`__s3.pen.root.visible === true`, 300000, 'visible@05'); }
  let shotTaken = false;
  for (let i = 0; i < 2400; i++) {
    const s = await ev(PS).catch((e) => ({ err: String(e) })); out.samples.push(s);
    if (s.visible && !shotTaken && s.t > 59) { await page.screenshot(`${D}/pen-${tag}-05-t${s.t}.png`); shotTaken = true; log('05 visible', JSON.stringify(s)); if (SKIP) { out.beforeSkip = s; out.skipRet = await ev(`__s3.endingCutscene.skip()`); out.afterSkip0 = await ev(PS); await sleep(300); out.afterSkip = await ev(PS); log('skip', out.skipRet, JSON.stringify(out.afterSkip0), JSON.stringify(out.afterSkip)); } }
    if (s.scene && s.scene !== 's3-lighthouse') break; if (s.endedBy && out.samples.filter((x) => x.endedBy).length > 8) break;
    if (i % 40 === 0) { log(JSON.stringify(s)); save(); }
    await sleep(250);
  }
  // 汇总：每个 shot 的可见采样数
  const by = {}; for (const s of out.samples) { if (!s.shot && s.t == null) continue; const k = s.shot ?? 'none'; by[k] ??= { n: 0, vis: 0, tMin: s.t, tMax: s.t, posing: new Set() }; const b = by[k]; b.n++; if (s.visible) b.vis++; b.tMax = s.t; b.posing.add(s.posing); }
  out.byShot = Object.fromEntries(Object.entries(by).map(([k, b]) => [k, { ...b, posing: [...b.posing] }]));
  const tr = []; let prev = null; for (const s of out.samples) { if (s.visible !== prev) { tr.push({ t: s.t, shot: s.shot, visible: s.visible, w: s.w, posing: s.posing, suppressed: s.suppressed }); prev = s.visible; } } out.transitions = tr;
  log('byShot', JSON.stringify(out.byShot)); log('transitions', JSON.stringify(tr));
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
