import { open, sleep, SH } from './b5lib.mjs';
const P = await open(5278);
const { page, ev, must, clickSel, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['interact:used','interact:read','item:pickup','item:place','journal:updated','subtitle:show','reader:open','reader:close','journal:open','journal:close'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), now: performance.now() }));
  } }); })();`);
const frames = async (n = 4) => { const f0 = await ev(`__game.time.frame`); await must(`__game.time.frame >= ${f0 + n}`, 120000, 'frames'); };
const bf = (sel) => ev(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const c = getComputedStyle(e); return { vis: !e.hidden && c.display !== 'none', bf: c.backdropFilter, wbf: c.webkitBackdropFilter, bg: c.backgroundColor }; })()`);
const toast = () => ev(`(() => { const t = document.querySelector('.toast-left'); const h = document.querySelector('.hud-hint'); const tr = t.getBoundingClientRect(), hr = h.getBoundingClientRect(); return { hidden: t.hidden, text: t.textContent, pending: __game.ui.toastLeft.pending, rem: +(__game.ui.toastLeft.remaining ?? NaN).toFixed(3), t: [tr.left, tr.top, tr.bottom].map(Math.round), hint: [hr.left, hr.top, hr.bottom].map(Math.round), hintText: h.innerText, overlap: !(tr.bottom <= hr.top || tr.top >= hr.bottom || tr.width === 0) }; })()`);

// ---------- C 测试场：阅读/日志 模糊、BUG-004 提示挂起、交互 ----------
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed && __game.input.context === 'explore'`, 180000, 'testbed');
await frames(10); await page.click(640, 400); await frames(4);
const go = async (id) => { await ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`); await frames(4); return page.waitFor(`__testbed.interaction.current?.id === '${id}'`, 20000, 150); };
const now = () => ev(`performance.now()`);
const evs = (n, t) => ev(`__ev.filter(x => x.n === '${n}' && x.now > ${t})`);

await step('回归', '交互类型快速复跑（inspect / use / hold / pickup / place）', async () => {
  const out = [];
  let t = await now(); out.push(['inspect', await go('sample-inspect')]); await page.tap('KeyE'); await sleep(1500);
  const sub = await ev(`__ev.filter(x => x.n === 'subtitle:show' && x.now > ${t}).length`); out.push(['inspect 字幕', sub]);
  await frames(30);
  t = await now(); await go('sample-bell'); await page.tap('KeyE'); out.push(['use', await page.waitFor(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.now > ${t})`, 60000, 150)]);
  t = await now(); await go('sample-valve'); await page.keyDown('KeyE'); out.push(['hold', await page.waitFor(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-valve' && x.now > ${t})`, 90000, 150)]); await page.keyUp('KeyE');
  t = await now(); await go('sample-lantern'); await page.tap('KeyE'); out.push(['pickup', await page.waitFor(`__ev.some(x => x.n === 'item:pickup' && x.now > ${t})`, 60000, 150)]);
  t = await now(); await go('sample-stand-a'); await page.tap('KeyE'); out.push(['place', await page.waitFor(`__ev.some(x => x.n === 'item:place' && x.now > ${t})`, 60000, 150)]);
  await page.screenshot(`${SH}/reg-interactions.png`);
  rec('回归', '交互类型快速复跑（inspect / use / hold / pickup / place）', out.every(([, v]) => v === true || v > 0) ? 'PASS' : 'FAIL', JSON.stringify(out));
});

P.save('b4-reg2'); console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
