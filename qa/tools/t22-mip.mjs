// batch22 ②：按档跳过 KTX2 mip — 每场景 极致进场 → 高 → 标准 → 极致 → 标准；查每张压缩贴图的 image 尺寸 + 实际 GL 分配尺寸、按 char/prop vs 环境分类取最大、网络请求数
import { open, sleep, SH16 as SH } from './b22lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/mip`; mkdirSync(D, { recursive: true });
const SCENES = (process.env.SC ?? 's1,s2,s3').split(',');
const START = process.env.START ?? 'ultra';
const SEQ = (process.env.SEQ ?? 'high,standard,ultra,standard').split(',');
const out = { start: START, seq: SEQ, scenes: {} }; const save = () => writeFileSync(`${D}/t22-mip${process.env.TAG ?? ''}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const GLT = `(() => { const P = WebGL2RenderingContext.prototype; const sz = (window.__glSz = new WeakMap()); const cur = new WeakMap(); let unit = 0; window.__glAllocMax = 0; window.__glAllocLog = [];
  const tb = (gl, t) => (cur.get(gl) ?? {})[unit + ':' + t];
  const w = (n, f) => { const o = P[n]; P[n] = function (...a) { const r = o.apply(this, a); try { f.call(this, a, r); } catch (e) {} return r; }; };
  w('activeTexture', function ([u]) { unit = u - 0x84C0; });
  w('bindTexture', function ([t, x]) { let m = cur.get(this); if (!m) cur.set(this, (m = {})); m[unit + ':' + t] = x; });
  w('texStorage2D', function ([t, lv, f, W, H]) { const x = tb(this, t); if (x) sz.set(x, { w: W, h: H, f, lv }); });
  w('compressedTexImage2D', function (a) { if (a[1] === 0) { const x = tb(this, a[0]); if (x && !sz.get(x)) sz.set(x, { w: a[3], h: a[4], f: a[2] }); } });
})();`;
const NET = `(() => { const tex = new Map(); const cls = (o) => { for (let p = o; p; p = p.parent) if (/^(char|prop)-/i.test(p.name)) return true; return false; };
  __game.scenes.current.scene.traverse((o) => { const mat = o.material; if (!mat) return; const cp = cls(o);
    for (const m of [].concat(mat)) { if (!m) continue; for (const [k, v] of Object.entries(m)) { if (!v || !v.isTexture || v.isRenderTargetTexture || !v.isCompressedTexture) continue; const e = tex.get(v) ?? { cp: false, slots: new Set(), names: new Set() }; e.cp ||= cp; e.slots.add(k); e.names.add(o.name); tex.set(v, e); } } });
  const props = __game.renderer.properties; const rows = [];
  for (const [t, e] of tex) { const wt = props.get(t).__webglTexture; const g = wt && window.__glSz.get(wt);
    rows.push({ id: t.uuid.slice(0, 8), name: t.name || (t.source?.data?.src ?? ''), cp: e.cp, slots: [...e.slots].join('+'), w: t.image?.width, h: t.image?.height, mip0: t.mipmaps?.[0] ? t.mipmaps[0].width + 'x' + t.mipmaps[0].height : null, nMip: t.mipmaps?.length ?? 0, skip: t.userData.mipSkip ?? 0, glW: g?.w ?? null, glH: g?.h ?? null, uploaded: !!wt, ver: t.version }); }
  return rows; })()`;
const summarize = (rows, tier, orig) => {
  const lim = { ultra: [4096, 2048], high: [2048, 2048], standard: [2048, 1024] }[tier];
  const cat = (cp) => rows.filter((r) => r.cp === cp);
  const mx = (a, k) => Math.max(0, ...a.map((r) => Math.max(r[k + 'W'] ?? r.w ?? 0, r[k + 'H'] ?? r.h ?? 0)));
  const s = { tier, n: rows.length, cpN: cat(true).length, envN: cat(false).length,
    cpMaxImg: Math.max(0, ...cat(true).map((r) => Math.max(r.w, r.h))), envMaxImg: Math.max(0, ...cat(false).map((r) => Math.max(r.w, r.h))),
    cpMaxGL: Math.max(0, ...cat(true).filter((r) => r.glW).map((r) => Math.max(r.glW, r.glH))), envMaxGL: Math.max(0, ...cat(false).filter((r) => r.glW).map((r) => Math.max(r.glW, r.glH))),
    overCp: cat(true).filter((r) => Math.max(r.w, r.h) > lim[0]).length, overEnv: cat(false).filter((r) => Math.max(r.w, r.h) > lim[1]).length,
    glMismatch: rows.filter((r) => r.glW && (r.glW !== r.w || r.glH !== r.h)).length, notUploaded: rows.filter((r) => !r.glW).length,
    skipped: rows.filter((r) => r.skip > 0).length, mip0Mismatch: rows.filter((r) => r.mip0 && r.mip0 !== r.w + 'x' + r.h).length };
  if (orig) { // 应有尺寸 = min(原尺寸 by 逐级减半直到 ≤ 上限)
    let bad = 0, shrunkUnneeded = 0; for (const r of rows) { const o = orig[r.id]; if (!o) continue; let w = o.w, h = o.h; const L = r.cp ? lim[0] : lim[1]; while (Math.max(w, h) > L && Math.max(w, h) > 1) { w >>= 1; h >>= 1; } if (w !== r.w || h !== r.h) bad++; }
    s.expectedMismatch = bad; }
  return s; };
const { page, ev, must, url, done } = await open(5722, { width: 1280, height: 720 });
let reqs = []; page.onEvent((m) => { if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url.replace(/^https?:\/\/[^/]+/, '')); });
await page.send('Network.enable'); await page.addInit(GLT);
const frames = async (n) => { const f0 = await ev('__game.time.frame'); await must(`__game.time.frame >= ${f0 + n}`, 300000, 'frames'); };
try {
  for (const sc of SCENES) {
    const R = (out.scenes[sc] = { steps: [] }); reqs = [];
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=${START}&scene=${sc}`));
    await must(`__game.scenes.current?.name?.startsWith('${sc}') && !__game.flow.transitioning && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, sc);
    await frames(10); await sleep(1500);
    R.loadGlErr = await ev(`(() => { const gl = __game.renderer.getContext(); let e, n = []; while ((e = gl.getError()) && n.length < 5) n.push(e); return n; })()`);
    R.loadAllocMaxGL = null;
    const rows0 = await ev(NET); const orig = {}; for (const r of rows0) orig[r.id] = { w: r.w * 2 ** r.skip, h: r.h * 2 ** r.skip };
    R.loadReqs = reqs.length; R.loadKtx2 = reqs.filter((u) => /\.ktx2/i.test(u)).length; R.loadGlb = reqs.filter((u) => /\.glb/i.test(u)).length;
    R.steps.push({ ...summarize(rows0, START, orig), reqs: 0 }); R.origMax = { cp: Math.max(...rows0.filter((r) => r.cp).map((r) => Math.max(orig[r.id].w, orig[r.id].h)), 0), env: Math.max(...rows0.filter((r) => !r.cp).map((r) => Math.max(orig[r.id].w, orig[r.id].h)), 0) };
    R.origOver2048env = rows0.filter((r) => !r.cp && Math.max(orig[r.id].w, orig[r.id].h) > 2048).map((r) => r.name || r.id);
    writeFileSync(`${D}/rows-${sc}-${START}.json`, JSON.stringify(rows0, null, 1));
    log(sc, 'load', R.loadReqs, 'reqs', JSON.stringify(R.steps[0]), 'origMax', JSON.stringify(R.origMax)); save();
    for (const tier of SEQ) {
      const n0 = reqs.length; const f0 = await ev('__game.time.frame');
      await ev(`(__game.quality.set('${tier}'), 1)`);
      const imm = await ev(NET); const immS = summarize(imm, tier, orig);
      await frames(3); const rows = await ev(NET); const f1 = await ev('__game.time.frame');
      const s = { ...summarize(rows, tier, orig), framesAfter: f1 - f0, immediateImgOk: immS.overCp + immS.overEnv === 0 && immS.expectedMismatch === 0 };
      await sleep(2500); s.reqs = reqs.length - n0; s.newUrls = reqs.slice(n0).slice(0, 10);
      s.glErr = await ev(`(() => { const gl = __game.renderer.getContext(); let e, n = []; while ((e = gl.getError()) && n.length < 5) n.push(e); return n; })()`);
      R.steps.push(s); writeFileSync(`${D}/rows-${sc}-${tier}-${R.steps.length - 1}.json`, JSON.stringify(rows, null, 1));
      log(sc, tier, JSON.stringify(s)); save();
      if (sc === 's1' && !process.env.NOSHOT) await page.screenshot(`${D}/${sc}-${R.steps.length - 1}-${tier}.png`);
    }
    R.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); R.nErrors = page.errors.length; page.errors.length = 0; save();
  }
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
