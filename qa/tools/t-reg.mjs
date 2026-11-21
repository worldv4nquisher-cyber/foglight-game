import { open, sleep, SH } from './b4lib.mjs';
const P = await open(5253);
const { page, ev, must, clickSel, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['interact:used','interact:read','item:pickup','item:place','journal:updated','subtitle:show','reader:open','reader:close','journal:open','journal:close'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), now: performance.now() }));
  } }); })();`);
const frames = async (n = 4) => { const f0 = await ev(`__game.time.frame`); await must(`__game.time.frame >= ${f0 + n}`, 120000, 'frames'); };
const bf = (sel) => ev(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const c = getComputedStyle(e); return { vis: !e.hidden && c.display !== 'none', bf: c.backdropFilter, wbf: c.webkitBackdropFilter, bg: c.backgroundColor }; })()`);
const toast = () => ev(`(() => { const t = document.querySelector('.toast-left'); const h = document.querySelector('.hud-hint'); const tr = t.getBoundingClientRect(), hr = h.getBoundingClientRect(); return { hidden: t.hidden, text: t.textContent, pending: __game.ui.toastLeft.pending, rem: +(__game.ui.toastLeft.remaining ?? NaN).toFixed(3), t: [tr.left, tr.top, tr.bottom].map(Math.round), hint: [hr.left, hr.top, hr.bottom].map(Math.round), hintText: h.innerText, overlap: !(tr.bottom <= hr.top || tr.top >= hr.bottom || tr.width === 0) }; })()`);

// ---------- A 主菜单 / 设置持久化 / 恢复默认 ----------
await page.goto(url('?smoke=1')); await must('!!window.__game'); await ev('localStorage.clear()');
await page.goto(url('?smoke=1'));
await must(`window.__game?.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 120000, 'menu'); await sleep(800);
await step('回归', '主菜单', async () => {
  const m = await ev(`[...document.querySelectorAll('.main-menu .main-btn')].filter(b => !b.hidden).map(b => b.textContent)`);
  await page.screenshot(`${SH}/reg-menu.png`);
  rec('回归', '主菜单（无存档）', m.join('/') === '新游戏/设置/制作人员' || (m.length >= 3 && !m.includes('继续')) ? 'PASS' : 'FAIL', `可见按钮 ${JSON.stringify(m)}`);
});
await step('回归', '设置持久化 + 恢复默认', async () => {
  await clickSel('.main-menu [data-act="settings"]'); await must(`__game.ui.settings.isOpen`, 30000, 'settings');
  await ev(`(() => { const set = (a, v) => { const i = document.querySelector('.settings-panel input[data-act="' + a + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }; set('sens', '1.7'); set('vol-master', '40'); })()`);
  await clickSel('.settings-panel [data-act="invert"]'); await clickSel('.settings-panel [data-size="l"]');
  await page.screenshot(`${SH}/reg-settings-changed.png`);
  const before = await ev(`__game.settings.all`);
  await page.goto(url('?smoke=1'));
  await must(`window.__game?.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 120000, 'menu2'); await sleep(500);
  const after = await ev(`({ all: __game.settings.all, sens: __game.input.lookSensitivity, inv: __game.input.invertY })`);
  const ok = after.all.mouseSensitivity === 1.7 && after.all.masterVolume === 40 && after.all.invertY === true && after.all.subtitleSize === 'l' && after.sens === 1.7;
  rec('回归', '设置改动（界面操作）刷新后保留', ok ? 'PASS' : 'FAIL', `改后 ${JSON.stringify({ s: before.mouseSensitivity, v: before.masterVolume, i: before.invertY, sub: before.subtitleSize })}；刷新后 ${JSON.stringify({ s: after.all.mouseSensitivity, v: after.all.masterVolume, i: after.all.invertY, sub: after.all.subtitleSize })}，输入层灵敏度 ${after.sens}`);
  await clickSel('.main-menu [data-act="settings"]'); await must(`__game.ui.settings.isOpen`, 30000, 'settings2');
  const q0 = await ev(`({ tier: __game.quality.tier, src: __game.settings.get('qualitySource'), detected: __game.settings.all.qualityDetectedTier ?? null })`);
  await clickSel('.settings-panel [data-act="reset"]'); await sleep(500);
  const r = await ev(`({ all: __game.settings.all, tier: __game.quality.tier })`);
  await page.screenshot(`${SH}/reg-settings-reset.png`);
  rec('回归', '恢复默认（裁定：已检测→检测档，否则极致；灵敏度 1.0）', r.all.mouseSensitivity === 1 && r.all.invertY === false && r.all.masterVolume !== 40 && r.all.quality === (q0.detected ?? 'ultra') ? 'PASS' : 'FAIL', `恢复前画质 ${JSON.stringify(q0)}；恢复后 ${JSON.stringify({ tier: r.tier, s: r.all.mouseSensitivity, i: r.all.invertY, v: r.all.masterVolume, sub: r.all.subtitleSize, qs: r.all.qualitySource })}`);
  await clickSel('.settings-panel [data-act="back"]'); await sleep(400);
});

// ---------- B 新游戏 S1：HUD 文案、暂停/设置 模糊、暂停→主菜单 ----------
await step('BUG-003', '暂停 / 设置 背景模糊（运行时计算样式）', async () => {
  await clickSel('.main-menu [data-act="new"]');
  await must(`__game.scenes.current?.name === 's1-ebb-shore' && !!__game.scenes.current.rig && !__game.flow.transitioning && __game.input.context === 'explore'`, 240000, 'S1');
  await sleep(1500);
  const hud = await ev(`({ text: document.querySelector('.hud-hint').innerText.replace(/\\s+/g, ' ').trim(), loc: document.querySelector('.hud-location')?.textContent ?? null })`);
  const want = 'W A S D 移动　Shift 小跑　点击画面 锁定鼠标转视角　E 互动　右键 观察　滚轮 远近　Esc 暂停'.replace(/\s+/g, '');
  const kbd = await ev(`document.querySelectorAll('.hud-hint kbd').length`);
  rec('BUG-005', 'S1 左下操作提示与快照文本表 ui.hud.controls 一致', hud.text.replace(/\s+/g, '') === want && kbd >= 9 ? 'PASS' : 'FAIL', `页面「${hud.text}」（kbd ${kbd} 个）；快照 zh-CN.ts 的值去空白后比对；地名「${hud.loc}」`);
  // smoke 004 失败项复核：S1 demo 灯塔 E 切换
  const on0 = await ev(`__game.scenes.current.lighthouseOn`);
  await ev(`(() => { const s = __game.scenes.current; s.rig.body.teleport(new s.rig.body.position.constructor(11, 2.45, -8.3)); s.rig.controller.facing = Math.PI; return 1; })()`);
  const lp = await page.waitFor(`/E\\s*操作/.test(document.querySelector('.hud-prompt')?.hidden ? '' : document.querySelector('.hud-prompt')?.textContent ?? '')`, 30000, 150);
  const tE = Date.now(); await page.tap('KeyE');
  const sw = await page.waitFor(`__game.scenes.current.lighthouseOn !== ${on0}`, 30000, 100);
  rec('回归', 'S1 demo 灯塔 E 切换（复核 smoke 004 失败）', lp && sw ? 'PASS' : 'FAIL', `初始 lighthouseOn=${on0}；「E 操作」提示出现=${lp}；按 E 后切换=${sw}（墙钟 ${Date.now() - tE} ms，期间帧数见 __game.time.frame）`);
  await sleep(500);
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 30000, 'pause');
  await sleep(800); const p = await bf('.pause-menu');
  await page.screenshot(`${SH}/reg-bug003-pause-blur.png`);
  await clickSel('.pause-menu [data-act="settings"]'); await must(`__game.ui.settings.isOpen`, 30000, 'pset'); await sleep(600);
  const s = await bf('.pause-menu'); const sp = await bf('.settings-panel');
  await page.screenshot(`${SH}/reg-bug003-settings-blur.png`);
  rec('BUG-003', '暂停 / 设置 背景模糊（运行时计算样式）', /blur\(6px\)/.test(p?.bf ?? '') && p.vis && /blur/.test(s?.bf ?? '') ? 'PASS' : 'FAIL', `暂停菜单 ${JSON.stringify(p)}；打开设置时外层 ${JSON.stringify(s)}，设置面板自身 ${JSON.stringify(sp)}`);
  await clickSel('.settings-panel [data-act="back"]'); await sleep(400);
  await clickSel('.pause-menu [data-act="to-menu"]'); await sleep(800);
  const conf = await ev(`__game.ui.confirm?.isOpen ?? false`);
  if (conf) { await ev(`(() => { const b = document.querySelector('.confirm-dialog [data-act="confirm"]'); b && b.click(); })()`); }
  const back = await page.waitFor(`__game.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 120000, 200);
  const m = await ev(`[...document.querySelectorAll('.main-menu .main-btn')].filter(b => !b.hidden).map(b => b.textContent)`);
  rec('回归', '暂停 → 回到主菜单，出现「继续」', back && m[0] === '继续' ? 'PASS' : 'FAIL', `确认框=${conf}；回到主菜单=${back}；按钮 ${JSON.stringify(m)}`);
});

// ---------- C 测试场：阅读/日志 模糊、BUG-004 提示挂起、交互 ----------
await page.goto(url('?smoke=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed && __game.input.context === 'explore'`, 180000, 'testbed');
await frames(10); await page.click(640, 400); await frames(4);
const go = async (id) => { await ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`); await frames(4); return page.waitFor(`__testbed.interaction.current?.id === '${id}'`, 20000, 150); };
const now = () => ev(`performance.now()`);
const evs = (n, t) => ev(`__ev.filter(x => x.n === '${n}' && x.now > ${t})`);

await step('BUG-004', '阅读时挂起、关闭后显示 2 s、不压操作提示、再读不重复', async () => {
  await go('sample-read'); const t0 = await now();
  await page.tap('KeyE'); await must(`__game.ui.reader.isOpen`, 60000, 'reader'); await frames(6);
  const inR = await toast(); const rb = await bf('.reader');
  await page.screenshot(`${SH}/reg-bug003-reader-blur.png`);
  await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'close');
  const samp = ev(`__qa.sample(() => [Math.round(performance.now()), document.querySelector('.toast-left').hidden, +__game.time.elapsed.toFixed(3), __game.ui.toastLeft.pending], 9000)`);
  await must(`!document.querySelector('.toast-left').hidden`, 30000, 'toast shown');
  const vis = await toast(); await page.screenshot(`${SH}/reg-bug004-toast-after-reader.png`);
  const s = await samp;
  const shown = s.filter((x) => !x[1]); const first = shown[0], last = shown.at(-1);
  const gone = s.find((x) => first && x[0] > first[0] && x[1] && !x[3]);
  const ju = (await evs('journal:updated', t0)).length;
  rec('BUG-003', '阅读界面背景模糊（运行时计算样式）', /blur/.test(rb?.bf ?? '') ? 'PASS' : 'FAIL', `.reader ${JSON.stringify(rb)}`);
  rec('BUG-004', '阅读时挂起、关闭后显示约 2 s、不压操作提示', ju === 1 && inR.hidden && inR.pending && !vis.hidden && vis.text === '日志已更新' && !vis.overlap && vis.t[2] <= vis.hint[1] && gone ? 'PASS' : 'FAIL',
    `首读 journal:updated ${ju} 次；阅读界面开着时提示 hidden=${inR.hidden} pending=${inR.pending}；关闭后「${vis.text}」框 [left,top,bottom]=${JSON.stringify(vis.t)}，操作提示 ${JSON.stringify(vis.hint)}，重叠=${vis.overlap}；显示期间墙钟 ${gone ? gone[0] - first[0] : '?'} ms，游戏时间 ${gone ? (gone[2] - first[2]).toFixed(2) : '?'} s（UI 帧时间每帧上限 0.25 s，软件渲染下墙钟会更长）`);
  const t1 = await now(); await go('sample-read'); await page.tap('KeyE'); const ok = await page.waitFor(`__game.ui.reader.isOpen`, 60000, 200);
  await frames(4); if (ok) { await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'close2'); }
  await frames(6); const re = await toast();
  rec('BUG-004', '再读不重复弹', ok && (await evs('journal:updated', t1)).length === 0 && re.hidden && !re.pending ? 'PASS' : 'FAIL', `再读 journal:updated ${(await evs('journal:updated', t1)).length} 次，提示 hidden=${re.hidden} pending=${re.pending}`);
});

await step('BUG-004', '日志 / 暂停 打开时挂起，关闭后补显示', async () => {
  await page.tap('KeyJ'); await must(`__game.ui.journal.isOpen`, 30000, 'journal'); await frames(4);
  const jb = await bf('.journal'); await page.screenshot(`${SH}/reg-bug003-journal-blur.png`);
  await ev(`__game.events.emit('journal:updated', { docId: 'qa' }); 1`); await frames(6);
  const inJ = await toast();
  await page.tap('KeyJ'); await must(`!__game.ui.journal.isOpen`, 30000, 'jclose');
  await must(`!document.querySelector('.toast-left').hidden`, 30000, 'toast after journal'); const aJ = await toast();
  await page.tap('Escape'); await must(`__game.ui.pause.isOpen`, 30000, 'pause'); await frames(4);
  const inP = await toast(); await sleep(2500); const inP2 = await toast();
  await page.tap('Escape'); await must(`!__game.ui.pause.isOpen`, 30000, 'unpause');
  const aP = await page.waitFor(`!document.querySelector('.toast-left').hidden`, 20000, 50); const aP2 = await toast();
  rec('BUG-003', '日志界面背景模糊（运行时计算样式）', /blur/.test(jb?.bf ?? '') ? 'PASS' : 'FAIL', `.journal ${JSON.stringify(jb)}`);
  rec('BUG-004', '日志 / 暂停 打开时挂起，关闭后补显示', inJ.hidden && inJ.pending && !aJ.hidden && inP.hidden && inP.rem === inP2.rem && aP ? 'PASS' : 'FAIL',
    `（日志里用事件模拟一次 journal:updated）日志开着 hidden=${inJ.hidden} pending=${inJ.pending}；关日志后显示=${!aJ.hidden}；途中开暂停 hidden=${inP.hidden}，剩余 ${inP.rem} → 2.5 s 后 ${inP2.rem}；关暂停后重新显示=${aP}（剩余 ${aP2.rem}）`);
});

await step('回归', '交互类型快速复跑（inspect / use / hold / pickup / place）', async () => {
  const out = [];
  let t = await now(); out.push(['inspect', await go('sample-inspect')]); await page.tap('KeyE'); await sleep(1500);
  const sub = await ev(`__ev.filter(x => x.n === 'subtitle:show' && x.now > ${t}).length`); out.push(['inspect 字幕', sub]);
  await frames(30);
  t = await now(); await go('sample-bell'); await page.tap('KeyE'); out.push(['use', await page.waitFor(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.now > ${t})`, 60000, 150)]);
  t = await now(); await go('sample-valve'); await page.keyDown('KeyE'); out.push(['hold', await page.waitFor(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-valve' && x.now > ${t})`, 90000, 150)]); await page.keyUp('KeyE');
  t = await now(); await go('sample-lantern'); await page.tap('KeyE'); out.push(['pickup', await page.waitFor(`__ev.some(x => x.n === 'item:pickup' && x.now > ${t})`, 60000, 150)]);
  t = await now(); await go('sample-pedestal'); await page.tap('KeyE'); out.push(['place', await page.waitFor(`__ev.some(x => x.n === 'item:place' && x.now > ${t})`, 60000, 150)]);
  await page.screenshot(`${SH}/reg-interactions.png`);
  rec('回归', '交互类型快速复跑（inspect / use / hold / pickup / place）', out.every(([, v]) => v === true || v > 0) ? 'PASS' : 'FAIL', JSON.stringify(out));
});

P.save('b4-reg'); console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
