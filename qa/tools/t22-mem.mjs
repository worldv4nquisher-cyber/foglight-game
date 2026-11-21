// batch22 ①：手走路线 主菜单 →(点「新游戏」) S1 → S2 → S3 →(Esc 暂停「回主菜单」) 菜单 →(点「新游戏」) S1；每站 GC 后记显存（自写 GL 分配跟踪）/ 贴图 / 几何 / 着色器 / 对象堆 / 总堆；离开后查 window.__sN 和旧场景是否被回收
import { open, sleep, SH16 as SH } from './b22lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/mem`; mkdirSync(D, { recursive: true });
const TIER = process.env.TIER ?? 'ultra';
const out = { tier: TIER, steps: [], handles: [] }; const save = () => writeFileSync(`${D}/t22-mem${process.env.TAG ?? ''}.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const GLT = `(() => { const P = WebGL2RenderingContext.prototype; const S = (window.__gm = { bytes: new Map(), live: { tex: 0, buf: 0, rb: 0, prog: 0 } });
  const BPC = { 0x83F0: .5, 0x83F1: 1, 0x83F2: 1, 0x83F3: 1, 0x8E8C: 1, 0x8E8D: 1, 0x8E8E: 1, 0x8E8F: 1, 0x9270: .5, 0x9274: .5, 0x9278: 1, 0x93B0: 1, 0x93D0: 1, 0x8D64: .5, 0x8C4C: .5, 0x8C4D: 1, 0x8C4E: 1, 0x8C4F: 1 };
  const BPU = { 0x8058: 4, 0x8C43: 4, 0x881A: 8, 0x8814: 16, 0x822E: 4, 0x822D: 2, 0x8229: 1, 0x822B: 2, 0x8051: 3, 0x8C41: 3, 0x81A5: 2, 0x81A6: 3, 0x81A7: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8C3A: 4, 0x8C3D: 4, 0x8D62: 2, 0x8D48: 1, 0x881B: 6, 0x8815: 12, 0x8230: 8, 0x822F: 4, 0x8C3B: 4, 0x8D70: 16, 0x8D7C: 4, 0x8236: 4, 0x8234: 4, 0x8232: 1 };
  const bpp = (f) => BPC[f] ?? BPU[f] ?? 4;
  const unit = new WeakMap(), bound = new WeakMap();
  const key = (t) => (t === 0x8513 || (t >= 0x8515 && t <= 0x851A)) ? 0x8513 : t;
  const cur = (gl, t) => (bound.get(gl) ?? {})[(unit.get(gl) ?? 0) + ':' + key(t)];
  const set = (o, kind, lvl, b) => { if (!o) return; let e = S.bytes.get(o); if (!e) S.bytes.set(o, (e = { kind, lv: {} })); e.lv[lvl] = b; };
  const w = (n, f) => { const o = P[n]; if (!o) return; P[n] = function (...a) { const r = o.apply(this, a); try { f.call(this, a, r); } catch (e) {} return r; }; };
  w('createTexture', () => S.live.tex++); w('createBuffer', () => S.live.buf++); w('createRenderbuffer', () => S.live.rb++); w('createProgram', () => S.live.prog++);
  w('deleteTexture', ([o]) => { if (o) { S.live.tex--; S.bytes.delete(o); } }); w('deleteBuffer', ([o]) => { if (o) { S.live.buf--; S.bytes.delete(o); } });
  w('deleteRenderbuffer', ([o]) => { if (o) { S.live.rb--; S.bytes.delete(o); } }); w('deleteProgram', ([o]) => { if (o) S.live.prog--; });
  w('activeTexture', function ([u]) { unit.set(this, u - 0x84C0); });
  w('bindTexture', function ([t, o]) { let m = bound.get(this); if (!m) bound.set(this, (m = {})); m[(unit.get(this) ?? 0) + ':' + key(t)] = o; });
  w('texStorage2D', function ([t, L, f, W, H]) { const o = cur(this, t); let s = 0; for (let i = 0; i < L; i++) s += Math.max(1, W >> i) * Math.max(1, H >> i); set(o, 'tex', 'S', s * bpp(f) * (t === 0x8513 ? 6 : 1)); });
  w('texStorage3D', function ([t, L, f, W, H, Dp]) { const o = cur(this, t); let s = 0; for (let i = 0; i < L; i++) s += Math.max(1, W >> i) * Math.max(1, H >> i) * (t === 0x8C1A ? Dp : Math.max(1, Dp >> i)); set(o, 'tex', 'S', s * bpp(f)); });
  w('texImage2D', function (a) { const o = cur(this, a[0]); const face = a[0]; let W, H, f; if (typeof a[3] === 'number' && a.length >= 9) { W = a[3]; H = a[4]; f = a[2]; } else { const img = a[5]; W = img?.width ?? img?.videoWidth ?? 0; H = img?.height ?? img?.videoHeight ?? 0; f = a[2]; } set(o, 'tex', face + ':' + a[1], W * H * bpp(f)); });
  w('texImage3D', function (a) { set(cur(this, a[0]), 'tex', 'L' + a[1], a[3] * a[4] * a[5] * bpp(a[2])); });
  w('compressedTexImage2D', function (a) { set(cur(this, a[0]), 'tex', a[0] + ':' + a[1], a[3] * a[4] * bpp(a[2])); });
  const bb = new WeakMap(); w('bindBuffer', function ([t, o]) { let m = bb.get(this); if (!m) bb.set(this, (m = {})); m[t] = o; });
  w('bufferData', function ([t, d]) { set((bb.get(this) ?? {})[t], 'buf', 0, typeof d === 'number' ? d : d?.byteLength ?? 0); });
  let rb = null; w('bindRenderbuffer', ([, o]) => { rb = o; });
  w('renderbufferStorage', ([, f, W, H]) => set(rb, 'rb', 0, W * H * bpp(f))); w('renderbufferStorageMultisample', ([, s, f, W, H]) => set(rb, 'rb', 0, W * H * bpp(f) * Math.max(1, s)));
  window.__gmSum = () => { const r = { tex: 0, buf: 0, rb: 0 }; for (const e of S.bytes.values()) r[e.kind] += Object.values(e.lv).reduce((a, b) => a + b, 0); return { ...r, live: { ...S.live } }; };
})();`;
const { page, ev, must, url, done, clickSel, visible } = await open(5731, { width: 960, height: 540 });
let chunks = []; page.onEvent((m) => { if (m.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(m.params.chunk); });
await page.send('HeapProfiler.enable'); await page.addInit(GLT);
const MB = (b) => +(b / 1048576).toFixed(1);
async function codeHeap() { chunks = []; await page.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); const s = JSON.parse(chunks.join('')); chunks = []; const F = s.snapshot.meta.node_fields, T = s.snapshot.meta.node_types[0], NF = F.length, it = F.indexOf('type'), is = F.indexOf('self_size'); let c = 0; for (let i = 0; i < s.nodes.length; i += NF) if (T[s.nodes[i + it]] === 'code') c += s.nodes[i + is]; return c; }
const HANDLES = `(() => { const r = {}; for (const k of ['__s1', '__s2', '__s3']) r[k] = k in window ? (window[k] === __game.scenes.current ? 'current' : 'STALE') : 'absent'; const extra = Object.keys(window).filter((k) => k.startsWith('__') && window[k] && typeof window[k] === 'object' && window[k] !== __game.scenes.current && window[k].constructor?.name?.match?.(/Scene|Level/)); r.otherSceneHandles = extra; r.oldAlive = (window.__oldRefs ?? []).filter(([, w]) => { const s = w.deref(); return s && s !== __game.scenes.current; }).map(([l]) => l); return r; })()`;
async function station(label, scene) {
  if (scene) { await must(`__game.scenes.current?.name === '${scene}' && !__game.flow.transitioning`, 900000, label); await must('__game.assets.loadStats.every((x) => x.done)', 900000, label + ' assets'); }
  await sleep(3000); const f0 = await ev('__game.time.frame'); await must(`__game.time.frame >= ${f0 + 5}`, 300000, 'frames');
  await page.send('HeapProfiler.collectGarbage'); await sleep(500); await page.send('HeapProfiler.collectGarbage');
  const heap = await page.send('Runtime.getHeapUsage'); const code = await codeHeap();
  const m = await ev(`(() => { const i = __game.renderer.info; return { scene: __game.scenes.current?.name ?? null, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, gl: __gmSum() }; })()`);
  const h = await ev(HANDLES);
  const row = { label, scene: m.scene, vramMB: MB(m.gl.tex + m.gl.buf + m.gl.rb), texMB: MB(m.gl.tex), bufMB: MB(m.gl.buf), rbMB: MB(m.gl.rb), glLive: m.gl.live, geometries: m.geometries, textures: m.textures, programs: m.programs, heapMB: MB(heap.usedSize), objHeapMB: MB(heap.usedSize - code), codeHeapMB: MB(code), handles: h };
  out.steps.push(row); save(); log(JSON.stringify(row));
  await ev(`((window.__oldRefs ??= []).push([${JSON.stringify(label)}, new WeakRef(__game.scenes.current)]), 1)`);
  return row;
}
const clickNew = async () => { await must(`!!document.querySelector('.main-menu [data-act="new"]')?.checkVisibility()`, 300000, 'menu'); await sleep(800); await clickSel('.main-menu [data-act="new"]'); await sleep(1200); if (await ev(`!!document.querySelector('[data-act="confirm"]')?.checkVisibility()`)) { log('confirm dialog'); await clickSel('[data-act="confirm"]'); } };
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=${TIER}`));
  await clickNew(); log('clicked new');
  const s1a = await station('进 S1（菜单点新游戏）', 's1-ebb-shore');
  for (const [id, name] of [['s2', 's2-keeper-house'], ['s3', 's3-lighthouse']]) { await ev(`(__game.flow.goToLevel('${id}'), 1)`); await sleep(1000); await station(`切到 ${id.toUpperCase()}（goToLevel）`, name); }
  // 回主菜单：Esc → 暂停菜单「回主菜单」→ 确认
  await page.waitFor(`__game.input.context === 'explore'`, 180000, 500); out.beforePause = await ev(`({ ctx: __game.input.context, pausable: __game.scenes.current?.pausable, paused: __game.paused ?? null })`); log('beforePause', JSON.stringify(out.beforePause));
  for (let i = 0; i < 4 && !(await ev(`!!document.querySelector('[data-act="to-menu"]')?.checkVisibility()`)); i++) { await page.keyDown('Escape'); await sleep(500); await page.keyUp('Escape'); await sleep(1500); }
  let viaUI = false;
  if (await ev(`!!document.querySelector('[data-act="to-menu"]')?.checkVisibility()`)) { await clickSel('.pause-menu [data-act="to-menu"], [data-act="to-menu"]'); await sleep(1000); if (await ev(`!!document.querySelector('[data-act="confirm"]')?.checkVisibility()`)) await clickSel('[data-act="confirm"]'); viaUI = true; }
  else { log('pause menu not reachable, fallback toMenu()'); await ev('(__game.flow.toMenu(), 1)'); }
  out.toMenuViaUI = viaUI;
  await must(`!__game.flow.transitioning && !!document.querySelector('.main-menu [data-act="new"]')?.checkVisibility()`, 300000, 'menu back');
  const menu = await station('回主菜单（暂停菜单）', null);
  await clickNew();
  const s1b = await station('再进 S1（菜单点新游戏）', 's1-ebb-shore');
  const cmp = {}; for (const k of ['vramMB', 'texMB', 'geometries', 'textures', 'programs', 'objHeapMB', 'heapMB']) { const r = s1b[k] / Math.max(1e-9, s1a[k]); cmp[k] = { first: s1a[k], again: s1b[k], ratio: +r.toFixed(3), within10: Math.abs(r - 1) <= 0.1 }; }
  cmp.menuVsS1 = +(menu.vramMB / s1a.vramMB).toFixed(3);
  out.compare = cmp; log('compare', JSON.stringify(cmp));
  out.errors = page.errors.slice(0, 15).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
