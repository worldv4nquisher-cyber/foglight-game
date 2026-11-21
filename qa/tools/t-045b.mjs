import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5233);
const { page, ev, must, clickSel, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['interact:used','interact:read','item:pickup','item:place','journal:updated','subtitle:hide','reader:open','reader:close','journal:open','journal:close','interact:pushEnd'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), el: v.time.elapsed, now: performance.now() }));
  } }); })();`);
await page.goto(url('?smoke=1'));
await must(`!!window.__game`);
await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed`, 120000, 'testbed');
await sleep(3000);
await page.click(640, 400); await sleep(800);
const go = (id, dyaw = 0, back = 0) => ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); const p = s.position.clone(); p.x -= Math.sin(s.facing) * ${back}; p.z -= Math.cos(s.facing) * ${back}; tb.rig.body.teleport(p); tb.rig.controller.facing = s.facing + ${dyaw}; return 1; })()`);
const probe = (id) => ev(`(() => { const tb = __testbed, ix = tb.interaction, it = ix.get('${id}'); const f = new tb.rig.body.position.constructor(); it.focus(f); const b = tb.rig.body.position; return { facing: +tb.rig.controller.facing.toFixed(3), canI: ix.canInteract(it), reach: it.reach, d: +Math.hypot(f.x - b.x, f.z - b.z).toFixed(2), cur: ix.current?.id ?? null, prompt: document.querySelector('.hud-prompt').hidden ? null : document.querySelector('.hud-prompt').textContent, markers: ix.markers().map(m => m.id), ctx: __game.input.context }; })()`);
const now = () => ev(`performance.now()`);
const E = () => page.tap('KeyE');

await step('004', 'prompt probe', async () => {
  const out = [];
  for (const [dy, back, label] of [[0, 0, '正对'], [Math.PI, 0, '背对'], [1.22, 0, '偏70°'], [0.87, 0, '偏50°'], [-0.87, 0, '偏-50°'], [0, 0.5, '后退0.5'], [0, 0.8, '后退0.8'], [0, 2.0, '后退2.0'], [0, 3.0, '后退3.0']]) {
    await go('sample-read', dy, back); await sleep(1500);
    out.push(label + ' ' + JSON.stringify(await probe('sample-read')));
  }
  rec('004', 'prompt probe (sample-read)', 'INFO', out.join('\n'));
});

await step('005', 'J open/close simple', async () => {
  await page.tap('KeyJ'); await sleep(1200);
  const a = await ev(`({ j: __game.ui.journal.isOpen, ctx: __game.input.context })`);
  await page.tap('KeyJ'); await sleep(1200);
  const b = await ev(`({ j: __game.ui.journal.isOpen, ctx: __game.input.context })`);
  await page.tap('KeyJ'); await sleep(1200);
  await page.tap('Tab'); await sleep(1200);
  const c = await ev(`({ j: __game.ui.journal.isOpen, ctx: __game.input.context })`);
  await page.tap('KeyJ'); await sleep(1200);
  await page.click(640, 400, 'right'); await sleep(1200);
  const d = await ev(`({ j: __game.ui.journal.isOpen, ctx: __game.input.context })`);
  rec('005', 'J 打开 / J 关闭 / Tab 关闭 / 右键关闭', a.j && !b.j && !c.j && !d.j ? 'PASS' : 'FAIL', JSON.stringify({ a, b, c, d }));
});

await step('005', 'read notice → journal entry → Tab → J', async () => {
  await go('sample-read'); await sleep(1200);
  await E(); await sleep(1500);
  const r = await ev(`({ open: __game.ui.reader.isOpen, doc: __game.ui.reader.docId })`);
  await page.tap('Tab'); await sleep(1200);
  await page.tap('KeyJ'); await sleep(1200);
  const rr = await ev(`(() => { const b = document.querySelector('.journal-entry'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.click(rr.x, rr.y); await sleep(1500);
  const a = await ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  await page.tap('Tab'); await sleep(1500);
  const b = await ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  await page.tap('KeyJ'); await sleep(1500);
  const c = await ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  await page.screenshot(`${SH}/005-journal-after-entry-J.png`);
  await page.tap('KeyJ'); await sleep(1500);
  const d = await ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  await page.tap('Tab'); await sleep(1500);
  const e = await ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  await page.click(640, 400, 'right'); await sleep(1500);
  const f = await ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  const evs = await ev(`__ev.filter(x => /journal:|reader:/.test(x.n)).map(x => x.n)`);
  rec('005', '日志点条目阅读 → Tab 回日志 → 关闭日志', b.j && !c.j ? 'PASS' : 'FAIL', `读告示 ${JSON.stringify(r)}；点条目 ${JSON.stringify(a)}；Tab ${JSON.stringify(b)}；J ${JSON.stringify(c)}；再 J ${JSON.stringify(d)}；Tab ${JSON.stringify(e)}；右键 ${JSON.stringify(f)}；事件 ${JSON.stringify(evs)}`);
  if (f.j) { await ev(`__game.ui.journal.close()`); await sleep(800); }
});

await step('005', 'journal doc 5 pages', async () => {
  const p = await probe('sample-journal'); await go('sample-journal'); await sleep(1500);
  const p2 = await probe('sample-journal');
  const t0 = await now();
  await E(); await sleep(2000);
  const j = await ev(`({ open: __game.ui.reader.isOpen, doc: __game.ui.reader.docId, pages: __game.ui.reader.pageCount, label: document.querySelector('.reader-page').textContent, ctx: __game.input.context })`);
  await page.screenshot(`${SH}/005-reader-journal-p1.png`);
  const fz0 = await ev(`({ el: __game.time.elapsed, p: __testbed.rig.body.position.toArray() })`);
  await page.keyDown('KeyW'); await sleep(2500); await page.keyUp('KeyW');
  const fz1 = await ev(`({ el: __game.time.elapsed, p: __testbed.rig.body.position.toArray() })`);
  const seen = [];
  for (const k of ['KeyD', 'ArrowRight', 'KeyD', 'KeyD', 'KeyD']) { await page.tap(k); await sleep(900); seen.push(k + '→' + await ev(`document.querySelector('.reader-page').textContent`)); }
  await page.screenshot(`${SH}/005-reader-journal-p5.png`);
  for (const k of ['KeyA', 'ArrowLeft']) { await page.tap(k); await sleep(900); seen.push(k + '→' + await ev(`document.querySelector('.reader-page').textContent`)); }
  await clickSel('.reader [data-act="prev"]'); await sleep(900); seen.push('‹→' + await ev(`document.querySelector('.reader-page').textContent`));
  await clickSel('.reader [data-act="next"]'); await sleep(900); seen.push('›→' + await ev(`document.querySelector('.reader-page').textContent`));
  const rp = await P.rect('.reader-paper');
  await page.click(rp.x, rp.y, 'right'); await sleep(1200);
  const cl = await ev(`({ open: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  const ju = await ev(`__ev.filter(x => x.n === 'journal:updated' && x.now > ${t0}).length`);
  const toast = await ev(`(() => { const t = document.querySelector('.toast-left'); return t ? t.textContent : null; })()`);
  const t1 = await now();
  await E(); await sleep(1500); await page.tap('Tab'); await sleep(1200);
  const ju2 = await ev(`__ev.filter(x => x.n === 'journal:updated' && x.now > ${t1}).length`);
  rec('005', '父亲日志 5 页翻阅、冻结、右键关闭、日志更新不重复', j.pages === 5 && cl.open === false && fz1.el === fz0.el ? 'PASS' : 'FAIL',
    `站位前 ${JSON.stringify(p)} 站位后 ${JSON.stringify(p2)}；打开 ${JSON.stringify(j)}；按 W 2.5 s：游戏时间 ${fz0.el.toFixed(3)}→${fz1.el.toFixed(3)} 位置 ${fz0.p.map(v => v.toFixed(2))}→${fz1.p.map(v => v.toFixed(2))}；翻页 ${seen.join('，')}；右键 ${JSON.stringify(cl)}；首读 journal:updated ${ju}（toast「${toast}」），再读 ${ju2}`);
});

await step('004', 'pickup/place', async () => {
  await go('sample-lantern'); await sleep(1500);
  const p = await probe('sample-lantern');
  const t0 = await now();
  await E(); await sleep(1500);
  const h1 = await ev(`__testbed.interaction.held.holding`);
  await go('sample-inspect'); await sleep(1200); await E(); await sleep(1200);
  const h2 = await ev(`({ h: __testbed.interaction.held.holding, sub: document.querySelector('.subtitle-line')?.textContent })`);
  await sleep(3000);
  await go('sample-stand-a'); await sleep(1500);
  const pa = await probe('sample-stand-a');
  await E(); await sleep(1500);
  const h3 = await ev(`({ h: __testbed.interaction.held.holding, parent: __testbed.scene.getObjectByName('sample-lantern')?.parent?.name })`);
  await page.screenshot(`${SH}/004-place-stand-a.png`);
  await go('sample-stand-b'); await sleep(1500);
  const pb = await probe('sample-stand-b');
  const evs = await ev(`__ev.filter(x => /item:|interact:used/.test(x.n) && x.now > ${t0}).map(x => x.n + ' ' + JSON.stringify(x.e))`);
  rec('004', 'pickup / place', h1 && h2.h && !h3.h && !pb.canI ? 'PASS' : 'FAIL', `站位 ${JSON.stringify(p)}；拾取后 holding=${h1}；拿着按木箱 ${JSON.stringify(h2)}；灯台 A ${JSON.stringify(pa)} 放下后 ${JSON.stringify(h3)}；空手灯台 B ${JSON.stringify(pb)}；事件 ${JSON.stringify(evs)}`);
});

await step('004', 'hold', async () => {
  await go('sample-valve'); await sleep(1500);
  const p = await probe('sample-valve');
  const t0 = await now(); const el0 = await ev(`__game.time.elapsed`);
  await page.keyDown('KeyE');
  const ok1 = await page.waitFor(`__game.time.elapsed - ${el0} > 1.2`, 30000, 100);
  const mid = await ev(`({ k: __testbed.interaction.actionKind, p: __testbed.interaction.holdProgress, ring: !document.querySelector('.hud-hold').hidden, off: document.querySelector('.hud-hold-arc').getAttribute('stroke-dashoffset') })`);
  await page.screenshot(`${SH}/004-hold-ring-mid.png`);
  await page.keyUp('KeyE'); await sleep(1500);
  const rel = await ev(`({ k: __testbed.interaction.actionKind, p: __testbed.interaction.holdProgress, ring: !document.querySelector('.hud-hold').hidden })`);
  const u1 = await ev(`__ev.filter(x => x.n === 'interact:used' && x.now > ${t0}).length`);
  await go('sample-valve'); await sleep(1500);
  const t1 = await now();
  await page.keyDown('KeyE');
  const samples = [];
  const end = Date.now() + 60000;
  while (Date.now() < end) { const s = await ev(`({ el: __game.time.elapsed, k: __testbed.interaction.actionKind, p: __testbed.interaction.holdProgress, used: __ev.some(x => x.n === 'interact:used' && x.now > ${t1}) })`); samples.push(s); if (s.used) break; await sleep(200); }
  await page.keyUp('KeyE');
  const holdStart = samples.find((s) => s.k === 'hold' && s.p > 0);
  const usedAt = await ev(`(__ev.find(x => x.n === 'interact:used' && x.now > ${t1}) || {}).el`);
  rec('004', 'hold 2 s / 松开归零', mid.ring && rel.p === 0 && u1 === 0 && usedAt ? 'PASS' : 'FAIL', `站位 ${JSON.stringify(p)}；按住 >1.2 s(游戏) ${JSON.stringify(mid)}；松开 ${JSON.stringify(rel)}，未触发 ${u1}；第二次：首个进度采样 ${JSON.stringify(holdStart)}，interact:used 游戏时间 ${usedAt}；采样 ${JSON.stringify(samples.filter((_, i) => i % 3 === 0).map(s => [+s.el.toFixed(2), s.k, +s.p.toFixed(2)]))}`);
});

await step('004', 'push', async () => {
  await go('sample-raft'); await sleep(1500);
  const p = await probe('sample-raft');
  const t0 = await now();
  const z0 = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  await page.keyDown('KeyE');
  const samples = []; const end = Date.now() + 90000;
  while (Date.now() < end) { const s = await ev(`({ el: __game.time.elapsed, k: __testbed.interaction.actionKind, z: __testbed.scene.getObjectByName('sample-raft').position.z, end: __ev.some(x => x.n === 'interact:pushEnd' && x.now > ${t0}) })`); samples.push(s); if (s.end) break; await sleep(250); }
  await page.keyUp('KeyE'); await sleep(1000);
  const zEnd = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  const mv = samples.filter((s) => s.z > z0 + 0.2 && s.z < 9.3);
  const v = mv.length >= 2 ? (mv[mv.length - 1].z - mv[0].z) / (mv[mv.length - 1].el - mv[0].el) : NaN;
  await page.screenshot(`${SH}/004-push-end.png`);
  const pe = await probe('sample-raft');
  await page.keyDown('KeyE'); await sleep(3000); await page.keyUp('KeyE');
  const z2 = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  const n = await ev(`__ev.filter(x => x.n === 'interact:pushEnd' && x.now > ${t0}).length`);
  rec('004', 'push 0.8 m/s / 终点', Math.abs(v - 0.8) < 0.05 && n === 1 && Math.abs(z2 - zEnd) < 1e-3 ? 'PASS' : 'FAIL', `站位 ${JSON.stringify(p)}；z ${z0}→${zEnd.toFixed(3)}，中段速度 ${v.toFixed(3)} m/s（游戏时间，${mv.length} 个采样）；pushEnd ${n} 次；终点后 ${JSON.stringify(pe)}，再按 3 s z=${z2.toFixed(3)}；采样 ${JSON.stringify(samples.filter((_, i) => i % 4 === 0).map(s => [+s.el.toFixed(2), s.k, +s.z.toFixed(2)]))}`);
});

await step('005', 'Space advance', async () => {
  const out = [];
  for (const how of ['Space', 'Space-hold', 'click']) {
    const t0 = await now();
    await ev(`__game.ui.subtitles.play(['ch1.s2.cups.inspect', 'ch1.s1.nets.inspect'])`); await sleep(700);
    const a = await ev(`({ t: document.querySelector('.subtitle-line').textContent, ctx: __game.input.context })`);
    if (how === 'Space') await page.tap('Space');
    else if (how === 'Space-hold') { await page.keyDown('Space'); await sleep(250); await page.keyUp('Space'); }
    else await page.click(640, 400);
    await sleep(800);
    const b = await ev(`document.querySelector('.subtitle-line').textContent`);
    const h = await ev(`__ev.filter(x => x.n === 'subtitle:hide' && x.now > ${t0}).map(x => x.e.reason)`);
    out.push(`${how}: ${a.t}(${a.ctx}) → ${b} ${JSON.stringify(h)}`);
    await ev(`__game.ui.subtitles.clear?.()`); await sleep(500);
  }
  rec('005', 'Space / 左键推进 probe', 'INFO', out.join('\n'));
});

console.log('ERRORS', JSON.stringify(page.errors));
P.save('b3-045b');
await P.done(); process.exit(0);
