import { open, sleep, SH } from './b4lib.mjs';
const T = 'v0.1-007';
const P = await open(5251);
const { page, ev, must, url, rec, step } = P;
const Q = '?smoke=1&debug=1&scene=testbed&hintScale=0.05';
await page.goto(url('?smoke=1')); await must('!!window.__game'); await ev('localStorage.clear()');
await page.goto(url(Q));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!__game.scenes.current.hints && __game.input.context === 'explore'`, 180000, 'testbed');
await sleep(1000);
const H = `__game.scenes.current.hints`;
const st = (id) => ev(`(() => { const h = ${H}; const ui = __game.ui.hints; return { time: +h.time('${id}').toFixed(2), level: h.level('${id}'), cur: h.currentId, icon: ui.iconVisible, iconCls: document.querySelector('.hint-lantern').className, open: ui.isOpen, rows: [...document.querySelectorAll('.hint-panel .hint-row')].map(r => r.querySelector('.hint-level').textContent + '|' + r.querySelector('.hint-text').textContent + (r.classList.contains('locked') ? '|locked' : '')), used: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null')?.hintsUsed, hl: [...__game.scenes.current.interaction.highlighter.keys?.() ?? []], ft: __game.time.fixedTick / 60, panelHidden: document.querySelector('.hint-panel').hidden }; })()`);
const tp = (x, z, f) => ev(`(() => { const r = __game.scenes.current.rig; const p = r.body.position.clone(); p.set(${x}, 0.02, ${z}); r.body.teleport(p); ${f !== undefined ? `r.controller.facing = ${f};` : ''} })()`);
const pressH = async () => { await page.tap('KeyH'); await sleep(300); for (let i = 0; i < 30; i++) { if (await ev('__game.ui.hints.isOpen')) break; await sleep(150); } };
const closeH = async () => { await page.tap('KeyH'); for (let i = 0; i < 30; i++) { if (!(await ev('__game.ui.hints.isOpen'))) break; await sleep(150); } };
const waitT = (id, t) => must(`${H}.time('${id}') >= ${t}`, 240000, `${id} 计时到 ${t}`);

await step(T, '未进任何区域：H 三行「再等等，四处看看」', async () => {
  await pressH();
  const s = await st('test-bell');
  await page.screenshot(`${SH}/007-locked-outside.png`);
  rec(T, '未进任何区域：H 三行「再等等，四处看看」', s.open && s.rows.length === 3 && s.rows.every((r) => r.includes('再等等，四处看看') && r.endsWith('locked')) ? 'PASS' : 'FAIL', `rows=${JSON.stringify(s.rows)} cur=${s.cur} icon=${s.icon} hintsUsed=${s.used}`);
  await closeH();
});

let bellStand;
await step(T, '钟区域：9 s 图标、H 一级、hintsUsed 立即写存档', async () => {
  bellStand = await ev(`(() => { const s = __testbed.samples.stands['sample-bell']; return [s.position.x, s.position.z, s.facing]; })()`);
  await tp(bellStand[0], bellStand[1], bellStand[2]);
  await must(`${H}.time('test-bell') > 0`, 30000, '开始计时');
  // 9 s 前图标不显示
  await waitT('test-bell', 7.5); const pre = await st('test-bell');
  await must(`__game.ui.hints.iconVisible`, 120000, '图标');
  const at = await st('test-bell');
  await sleep(600); await page.screenshot(`${SH}/007-icon-l1.png`);
  await pressH(); const s = await st('test-bell');
  await page.screenshot(`${SH}/007-panel-l1.png`);
  rec(T, '钟区域：9 s 图标、H 一级、hintsUsed 立即写存档', !pre.icon && at.time >= 9 && at.time < 9.6 && s.rows[0].includes('钟上刻着两道线') && s.rows[1].endsWith('locked') && s.rows[2].endsWith('locked') && s.used === 1 ? 'PASS' : 'FAIL',
    `7.5 s 时图标=${pre.icon}；图标出现于区域计时 ${at.time} s（level ${at.level}，class「${at.iconCls}」）；H rows=${JSON.stringify(s.rows)}；存档 hintsUsed=${s.used}`);
  // 弹窗不暂停（制作人裁定）：开着时计时继续
  const t1 = s.time; await sleep(2500); const s2 = await st('test-bell');
  rec(T, '弹窗不暂停（裁定，确认行为）', s2.time > t1 && s2.open ? 'PASS' : 'FAIL', `弹窗开着 2.5 s：区域计时 ${t1} → ${s2.time}，context=${await ev('__game.input.context')}`);
  await closeH();
});

await step(T, '18 s 二级 + 钟高亮 3 s；再次打开仍高亮且不重复计数', async () => {
  await waitT('test-bell', 18.05);
  const at = await st('test-bell');
  await pressH(); const s = await st('test-bell'); const ft0 = s.ft;
  await sleep(200); await page.screenshot(`${SH}/007-panel-l2-highlight.png`);
  await must(`![...__game.scenes.current.interaction.highlighter.keys()].some(k => k.startsWith('hint:'))`, 60000, '高亮结束');
  const ft1 = await ev('__game.time.fixedTick / 60');
  rec(T, '18 s 二级 + 钟高亮 3 s', at.level === 2 && s.rows[1].includes('那口钟，爸爸修过很多次') && s.rows[2].endsWith('locked') && s.hl.includes('hint:sample-bell') && s.used === 2 ? 'PASS' : 'FAIL',
    `到 18 s 时 level=${at.level}；rows=${JSON.stringify(s.rows)}；打开瞬间高亮 ${JSON.stringify(s.hl)}；高亮持续约 ${(ft1 - ft0).toFixed(2)} s（固定步长时间，含轮询误差）；hintsUsed=${s.used}`);
  await closeH(); await sleep(300);
  await pressH(); const r = await st('test-bell');
  rec(T, '二级再次打开：重新高亮、hintsUsed 不变（裁定）', r.hl.includes('hint:sample-bell') && r.used === 2 ? 'PASS' : 'FAIL', `再开高亮 ${JSON.stringify(r.hl)}；hintsUsed=${r.used}`);
  await closeH();
});

await step(T, '离开区域计时暂停、回来接着计', async () => {
  const a = await st('test-bell');
  await tp(16, 6); await sleep(500);
  const b = await st('test-bell'); await sleep(3000); const c = await st('test-bell');
  await page.screenshot(`${SH}/007-outside-paused.png`);
  const dbg = await ev(`__game.scenes.current.hints.debugLine()`);
  await tp(bellStand[0], bellStand[1], bellStand[2]); await sleep(2000); const d = await st('test-bell');
  rec(T, '离开区域计时暂停、回来接着计', Math.abs(c.time - b.time) < 0.01 && d.time > c.time && c.time >= a.time ? 'PASS' : 'FAIL',
    `离开前 ${a.time}；离开后 ${b.time} → 3 s 后 ${c.time}（游戏时间走了 ${(c.ft - b.ft).toFixed(2)} s）；区域外图标=${c.icon}、当前谜题=${c.cur}；F4 提示行「${dbg}」；回来 2 s 后 ${d.time}`);
});

await step(T, '30 s 三级全显', async () => {
  await waitT('test-bell', 30.05);
  await pressH(); const s = await st('test-bell');
  await page.screenshot(`${SH}/007-panel-l3.png`);
  rec(T, '30 s 三级全显', s.level === 3 && s.rows.every((r) => !r.endsWith('locked')) && s.rows[2].includes('敲响它') && s.used === 3 ? 'PASS' : 'FAIL', `rows=${JSON.stringify(s.rows)}；hintsUsed=${s.used}`);
  await closeH();
});

await step(T, 'F4 调试面板显示提示计时', async () => {
  await page.tap('F4'); await sleep(800);
  const txt = await ev(`(() => { const e = document.querySelector('.debug-panel, [class*=debug]'); return e && !e.hidden ? e.innerText : null; })()`);
  await page.screenshot(`${SH}/007-f4-panel.png`);
  const line = (txt || '').split('\n').filter((l) => /提示|test-bell/.test(l)).join(' / ');
  rec(T, 'F4 调试面板显示提示计时', /test-bell .*L3/.test(txt || '') ? 'PASS' : 'FAIL', `面板提示行「${line}」`);
  await page.tap('F4'); await sleep(300);
});

await step(T, '敲钟（解开）后图标消失、H 不再显示该谜题', async () => {
  await tp(bellStand[0], bellStand[1], bellStand[2]); await sleep(800);
  await must(`__game.scenes.current.interaction.current?.id === 'sample-bell'`, 30000, '钟交互');
  await page.tap('KeyE');
  await must(`${H}.isSolved('test-bell')`, 60000, '解开');
  await sleep(1500);
  const s = await st('test-bell');
  await pressH(); const v = await st('test-bell'); const pid = await ev('__game.ui.hints.view?.puzzleId ?? null');
  await page.screenshot(`${SH}/007-solved.png`);
  rec(T, '敲钟（解开）后图标消失、H 不再显示该谜题', !s.icon && v.rows.every((r) => r.endsWith('locked')) && pid === null ? 'PASS' : 'FAIL', `解开后图标=${s.icon}；H 当前谜题=${pid} rows=${JSON.stringify(v.rows)}；hintsUsed=${v.used}`);
  await closeH();
});

await step(T, '分步骤（油阀 → 窗边镜子）', async () => {
  const vs = await ev(`(() => { const s = __testbed.samples.stands['sample-valve']; return [s.position.x, s.position.z, s.facing]; })()`);
  await tp(vs[0], vs[1], vs[2]);
  await waitT('test-steps', 18.05);
  await pressH(); const a = await st('test-steps');
  await page.screenshot(`${SH}/007-steps-valve.png`);
  await closeH();
  await must(`__game.scenes.current.interaction.current?.id === 'sample-valve'`, 30000, '油阀交互');
  await page.keyDown('KeyE');
  const ok = await page.waitFor(`[...${H}['puzzles'].get('test-steps').doneSteps].includes('valve')`, 120000, 100);
  await page.keyUp('KeyE'); await sleep(800);
  await pressH(); const b = await st('test-steps');
  await page.screenshot(`${SH}/007-steps-window-mirror.png`);
  await waitT('test-steps', 30.05); await sleep(500); const c = await st('test-steps');
  rec(T, '分步骤（油阀 → 窗边镜子）', a.rows[1].includes('阀门在最下面') && a.hl.includes('hint:sample-valve') && ok && b.rows[1].includes('窗边那面镜子') && b.hl.includes('hint:sample-stand-b') && b.used === a.used ? 'PASS' : 'FAIL',
    `拧阀前 rows=${JSON.stringify(a.rows)} 高亮 ${JSON.stringify(a.hl)} hintsUsed=${a.used}；拧开(valve 完成)=${ok}；之后 rows=${JSON.stringify(b.rows)} 高亮 ${JSON.stringify(b.hl)} hintsUsed=${b.used}；弹窗开着到 30 s：rows=${JSON.stringify(c.rows)} hintsUsed=${c.used}`);
  await closeH();
});

await step(T, '计时不存档：刷新后重进从 0 开始（裁定，确认行为）', async () => {
  const before = await ev(`JSON.parse(localStorage.getItem('foglight.save.v1')).hintsUsed`);
  await page.goto(url(Q));
  await must(`window.__game?.scenes.current?.name === 'testbed' && !!__game.scenes.current.hints && __game.input.context === 'explore'`, 180000, 'testbed');
  const s = await st('test-bell');
  rec(T, '计时不存档：刷新后重进从 0 开始（裁定，确认行为）', s.time === 0 && s.used === before ? 'PASS' : 'FAIL', `刷新后 test-bell 计时 ${s.time}、level ${s.level}、solved=${await ev(`${H}.isSolved('test-bell')`)}；存档 hintsUsed ${before} → ${s.used}`);
});

P.save('b4-007');
console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
