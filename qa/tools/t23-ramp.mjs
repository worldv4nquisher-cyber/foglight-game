// batch23 ① BUG-030：S1 art=1 修后 / ?rampfix=0 各进一次：4 张 ramp 格式 / mip / 采样；加载期 GL 错误逐调用归属；全部 KTX2 上传格式尺寸对比；同机位截图
import { open, sleep, SH16 as SH } from './b23lib.mjs';
import { HOOK } from './t21-camlib.mjs';
import { RAMP_PROBE } from './snap-69683cd/game/scripts/lib/ramp-probe.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/ramp`; mkdirSync(D, { recursive: true });
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = {}; const save = () => writeFileSync(`${D}/t23-ramp.json`, JSON.stringify(out, null, 1));
const GLT = `(() => { const P = WebGL2RenderingContext.prototype; const sz = (window.__glSz = new WeakMap()); const cur = new WeakMap(); let unit = 0; window.__glErrLog = [];
  const tb = (gl, t) => (cur.get(gl) ?? {})[unit + ':' + t];
  const w = (n, f) => { const o = P[n]; P[n] = function (...a) { const r = o.apply(this, a); try { f.call(this, a, r); } catch (e) {} return r; }; };
  const chk = (n) => w(n, function (a) { const e = this.getError(); if (e) { const x = tb(this, a[0]); const s = x && sz.get(x); window.__glErrLog.push({ call: n, err: e, level: a[1], args: a.slice(2, 6).filter((v) => typeof v === 'number'), tex: s ?? null }); } });
  w('activeTexture', function ([u]) { unit = u - 0x84C0; });
  w('bindTexture', function ([t, x]) { let m = cur.get(this); if (!m) cur.set(this, (m = {})); m[unit + ':' + t] = x; });
  w('texStorage2D', function ([t, lv, f, W, H]) { const x = tb(this, t); if (x) sz.set(x, { w: W, h: H, f, lv }); });
  w('texImage2D', function (a) { if (a[1] === 0 && typeof a[3] === 'number' && typeof a[4] === 'number') { const x = tb(this, a[0]); if (x) sz.set(x, { w: a[3], h: a[4], f: a[2], lv: 'texImage' }); } });
  w('compressedTexImage2D', function (a) { if (a[1] === 0) { const x = tb(this, a[0]); if (x && !sz.get(x)) sz.set(x, { w: a[3], h: a[4], f: a[2] }); } });
  for (const n of ['texStorage2D', 'compressedTexSubImage2D', 'compressedTexImage2D', 'texSubImage2D', 'texImage2D']) chk(n);
})();`;
const ROWS = `(() => { const tex = new Map(); const props = __game.renderer.properties;
  const add = (t, where) => { if (!t || !t.isTexture || t.isRenderTargetTexture) return; const e = tex.get(t) ?? { where: new Set() }; e.where.add(where); tex.set(t, e); };
  __game.scenes.current.scene.traverse((o) => { const mat = o.material; if (!mat) return; for (const m of [].concat(mat)) { if (!m) continue; for (const [k, v] of Object.entries(m)) add(v, o.name + '.' + k); if (m.uniforms) for (const [k, u] of Object.entries(m.uniforms)) add(u?.value, o.name + '.u.' + k); } });
  for (const k of ['tex-xi-ramp', 'tex-ramp-char', 'tex-ramp-env', 'tex-ramp-metal-wet']) if (__game.assets.has(k)) add(__game.assets.getTexture(k), 'asset:' + k);
  const rows = []; for (const [t, e] of tex) { if (!t.isCompressedTexture && !t.userData.ktx2Uncompressed) continue; const wt = props.get(t).__webglTexture; const g = wt && window.__glSz.get(wt);
    rows.push({ id: t.uuid, name: t.name || '', where: [...e.where].slice(0, 3).join(' | '), fmt: t.format, w: t.image?.width, h: t.image?.height, nMip: t.mipmaps?.length ?? 0, minF: t.minFilter, unc: !!t.userData.ktx2Uncompressed, glF: g?.f ?? null, glW: g?.w ?? null, glH: g?.h ?? null, glLv: g?.lv ?? null }); }
  return rows; })()`;
const Z = -8.6, E = -Math.PI / 2;
const put = (x, yaw, pitch = -0.3) => `(() => { const s = __s1, V = s.rig.body.position.constructor; s.puzzles.tide.set('low', { instant: true }); s.rig.body.teleport(new V(${x}, 0.6, ${Z})); s.rig.body.velocity?.set?.(0, 0, 0); s.rig.controller.facing = ${yaw} + Math.PI; __cam.yaw = ${yaw}; __cam.pitch = ${pitch}; __cam.spin = 0; return 1; })()`;
const { page, ev, must, url, done } = await open(5751, { width: 1280, height: 720 });
let reqs = [], cons = [];
page.onEvent((m) => { if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url.replace(/^https?:\/\/[^/]+/, ''));
  if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) cons.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
await page.send('Network.enable'); await page.addInit(GLT);
try {
  for (const [mode, q] of [['fix', ''], ['off', '&rampfix=0'], ['fix2', '']]) {
    reqs = []; cons = []; const R = (out[mode] = {});
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=ultra&autostart=1${q}`));
    await must(`!!window.__s1?.rig && !!__s1.art && __game.input.context === 'explore'`, 900000, 's1');
    await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
    await sleep(3000);
    R.loadGlErrLog = await ev(`window.__glErrLog.slice(0, 40)`); R.loadGlErrN = await ev(`window.__glErrLog.length`);
    R.drain = await ev(`(() => { const gl = __game.renderer.getContext(); let e, n = []; while ((e = gl.getError()) && n.length < 5) n.push(e); return n; })()`);
    R.uncompressedUrls = await ev(`[...__game.assets.ktx2Router.uncompressedUrls]`);
    R.probe = await ev(RAMP_PROBE);
    R.rows = await ev(ROWS);
    const k = reqs.filter((u) => /\.ktx2(\?|$)/.test(u)); const cnt = {}; for (const u of k) cnt[u] = (cnt[u] ?? 0) + 1;
    R.ktx2Req = k.length; R.ktx2Uniq = Object.keys(cnt).length; R.ktx2Dup = Object.entries(cnt).filter(([, n]) => n > 1); R.reqs = reqs.length;
    R.console = cons.slice(0, 40); R.errors = page.errors.slice(0, 20).map((e) => String(e).slice(0, 300)); page.errors.length = 0;
    R.endGlErrN = await ev(`window.__glErrLog.length`);
    log(mode, JSON.stringify({ glErrN: R.loadGlErrN, drain: R.drain, unc: R.uncompressedUrls, ktx2Req: R.ktx2Req, uniq: R.ktx2Uniq, dup: R.ktx2Dup.length, rows: R.rows.length }));
    for (const [n, p] of Object.entries(R.probe)) log(' ', n, JSON.stringify(p));
    save();
    if (mode !== 'fix2') {
      await ev(`(() => { const s = __s1; s.updateLensDroplets = () => {}; __game.postfx.setLensDroplets?.(0); document.getElementById('ui-root').style.display = 'none'; s.puzzles.tide.set('low', { instant: true }); return 1; })()`);
      await ev(HOOK); await ev(put(10.5, E)); await ev(`__gwait(2)`);
      await ev(`(__game.time.timeScale = 0, 1)`); await sleep(2500); await page.screenshot(`${D}/s1-east-${mode}.png`); await ev(`(__game.time.timeScale = 1, 1)`);
      R.glErrAfterShot = await ev(`window.__glErrLog.length`) - R.endGlErrN;
    }
    save();
  }
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
