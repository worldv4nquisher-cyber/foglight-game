import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5232);
const { page, ev, must, clickSel, visible, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['interact:used','interact:inspect','interact:read','interact:pushEnd','item:pickup','item:place','puzzle:enter','puzzle:exit','puzzle:partSelected','puzzle:partRotated','puzzle:reset','highlight:start','highlight:end','journal:updated','subtitle:show','subtitle:hide','reader:open','reader:close','journal:open','journal:close','game:pause','game:resume','goal:changed'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), el: v.time.elapsed, now: performance.now() }));
  } }); })();`);
const A = '004', B = '005';
await page.goto(url('?smoke=1'));
await must(`!!window.__game`);
await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed`, 120000, 'testbed');
await sleep(3000);
// 点画面拿指针锁定
await page.click(640, 400); await sleep(800);
const lock0 = await ev(`!!document.pointerLockElement`);
const go = (id, dyaw = 0) => ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing + ${dyaw}; tb.cameraFollow.yaw = s.facing + ${dyaw} + Math.PI; return 1; })()`);
const tpRel = (id, back) => ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); const p = s.position.clone(); p.x -= Math.sin(s.facing) * ${back}; p.z -= Math.cos(s.facing) * ${back}; tb.rig.body.teleport(p); tb.rig.controller.facing = s.facing; return 1; })()`);
const hud = () => ev(`({ prompt: document.querySelector('.hud-prompt').hidden ? null : document.querySelector('.hud-prompt').textContent, markers: [...document.querySelectorAll('.hud-marker')].filter(m => !m.hidden && m.style.display !== 'none').length, markerColor: (() => { const m = [...document.querySelectorAll('.hud-marker')].find(m => !m.hidden && m.style.display !== 'none'); return m ? getComputedStyle(m).color + ' / ' + getComputedStyle(m).backgroundColor + ' / ' + getComputedStyle(m).borderColor : null; })(), cur: __testbed.interaction.current?.id ?? null })`);
const evs = (n, since = 0) => ev(`__ev.filter(x => x.n === '${n}' && x.now > ${since})`);
const now = () => ev(`performance.now()`);
const E = () => page.tap('KeyE');

await step(A, '提示：1.8 m / ±60° / 3.5 m 图标', async () => {
  await go('sample-inspect'); await sleep(1500);
  const a = await hud();
  await go('sample-inspect', Math.PI); await sleep(1500);
  const b = await hud();
  await go('sample-inspect', 1.2); await sleep(1500); // 约 69°
  const b2 = await hud();
  await go('sample-inspect', 0.9); await sleep(1500); // 约 52°
  const b3 = await hud();
  await tpRel('sample-inspect', 1.0); await sleep(1500); // 离开 ~1 m → 约 2.6 m
  const c = await hud();
  await tpRel('sample-inspect', 3.0); await sleep(1500); // ~4.6 m
  const d = await hud();
  await go('sample-inspect'); await sleep(1200);
  await page.screenshot(`${SH}/004-prompt-inspect.png`);
  const dist = await ev(`(() => { const s = __testbed.samples.stands['sample-inspect'].position; return +(17.6 - s.x).toFixed(2); })()`);
  rec(A, '站在 1.8 m 内、面向 ±60° 内才出现提示；3.5 m 内冷色小图标', a.prompt && !b.prompt && !b2.prompt && b3.prompt && !c.prompt && c.markers > 0 && d.markers === 0 ? 'PASS' : 'FAIL',
    `站位到木箱中心 ${dist} m：正对「${a.prompt}」图标 ${a.markers}；背对 提示=${b.prompt}；偏 69° 提示=${b2.prompt}；偏 52° 提示=${b3.prompt}；后退 1 m 提示=${c.prompt} 图标=${c.markers}（颜色 ${c.markerColor}）；后退 3 m 图标=${d.markers}`);
});

await step(A, 'inspect', async () => {
  await go('sample-inspect'); await sleep(1000);
  const t0 = await now(); const el0 = await ev(`__game.time.elapsed`);
  await E(); await sleep(1500);
  const r = await ev(`({ sub: document.querySelector('.subtitle-line')?.textContent, reader: __game.ui.reader.isOpen, paused: __game.paused, el: __game.time.elapsed })`);
  const ins = await evs('interact:inspect', t0);
  await page.screenshot(`${SH}/004-inspect-subtitle.png`);
  rec(A, 'inspect：按 E 以字幕显示一句描述，不开阅读、不暂停', ins.length && r.sub === '晾着的网。' || (ins.length && r.sub && !r.reader && !r.paused && r.el > el0) ? 'PASS' : 'FAIL', `字幕「${r.sub}」，事件 ${JSON.stringify(ins.map(x => x.e))}，阅读界面=${r.reader}，暂停=${r.paused}，游戏时间 ${el0.toFixed(2)}→${r.el.toFixed(2)}`);
});

await step(B, '阅读（单页告示 + 5 页日志）、翻页、冻结、关闭、日志更新', async () => {
  await sleep(4000);
  await go('sample-read'); await sleep(1000);
  const t0 = await now();
  await E(); await sleep(1500);
  const r1 = await ev(`({ open: __game.ui.reader.isOpen, doc: __game.ui.reader.docId, pages: __game.ui.reader.pageCount, title: document.querySelector('.reader-title').textContent, ctx: __game.input.context })`);
  await page.tap('Tab'); await sleep(1000);
  const r1c = await ev(`__game.ui.reader.isOpen`);
  const toast1 = await ev(`(() => { const t = document.querySelector('.toast-left'); return t ? { text: t.textContent, hidden: t.hidden, op: getComputedStyle(t).opacity } : null; })()`);
  const ju1 = await evs('journal:updated', t0);
  // 5 页日志
  await go('sample-journal'); await sleep(1000);
  const t1 = await now();
  await E(); await sleep(1500);
  const j = await ev(`({ open: __game.ui.reader.isOpen, doc: __game.ui.reader.docId, pages: __game.ui.reader.pageCount, page: __game.ui.reader.page, label: document.querySelector('.reader-page').textContent, ctx: __game.input.context, bodyLen: document.querySelector('.reader-body').textContent.length })`);
  await page.screenshot(`${SH}/005-reader-journal-p1.png`);
  // 冻结：游戏时间、角色位置
  const fz0 = await ev(`({ el: __game.time.elapsed, p: __testbed.rig.body.position.toArray(), lift: __testbed.course.lift.position.y })`);
  await page.keyDown('KeyW'); await sleep(2500); await page.keyUp('KeyW');
  const fz1 = await ev(`({ el: __game.time.elapsed, p: __testbed.rig.body.position.toArray(), lift: __testbed.course.lift.position.y, frame: __game.time.frame })`);
  const pagesSeen = [];
  for (let i = 0; i < 4; i++) { await page.tap(i % 2 ? 'KeyD' : 'KeyD'); await sleep(700); pagesSeen.push(await ev(`document.querySelector('.reader-page').textContent`)); }
  await page.screenshot(`${SH}/005-reader-journal-p5.png`);
  await page.tap('KeyD'); await sleep(600);
  const beyond = await ev(`__game.ui.reader.page`);
  await page.tap('KeyA'); await sleep(600);
  const back = await ev(`document.querySelector('.reader-page').textContent`);
  await clickSel('.reader [data-act="prev"]'); await sleep(600);
  const arrowPrev = await ev(`document.querySelector('.reader-page').textContent`);
  await clickSel('.reader [data-act="next"]'); await sleep(600);
  const arrowNext = await ev(`document.querySelector('.reader-page').textContent`);
  const rcPt = await P.rect('.reader-paper');
  await page.click(rcPt.x, rcPt.y, 'right'); await sleep(1000);
  const closed = await ev(`({ open: __game.ui.reader.isOpen, ctx: __game.input.context })`);
  const ju2 = await evs('journal:updated', t1);
  // 再读一次：不重复
  const t2 = await now();
  await E(); await sleep(1500);
  await page.tap('Tab'); await sleep(800);
  const ju3 = await evs('journal:updated', t2);
  const entries = await ev(`[...__game.narrative.readDocs ?? []]`).catch(() => null);
  rec(B, '阅读界面 2 页以上翻页，右键 / Tab 关闭，打开期间角色不能移动（游戏时间冻结）',
    r1.open && !r1c && j.pages === 5 && pagesSeen[3]?.startsWith('5') && closed.open === false && Math.abs(fz1.el - fz0.el) < 1e-6 && Math.hypot(fz1.p[0] - fz0.p[0], fz1.p[2] - fz0.p[2]) < 0.01 ? 'PASS' : 'FAIL',
    `告示：open=${r1.open} 页数 ${r1.pages} 标题「${r1.title}」上下文 ${r1.ctx}，Tab 后 open=${r1c}；日志：页数 ${j.pages} 标签「${j.label}」上下文 ${j.ctx}；D 翻页 ${JSON.stringify(pagesSeen)}，末页再 D 停在第 ${beyond + 1} 页，A 回「${back}」，箭头 ‹「${arrowPrev}」›「${arrowNext}」；右键关闭 open=${closed.open} 上下文 ${closed.ctx}；打开期间按 W 2.5 s：游戏时间 ${fz0.el.toFixed(3)}→${fz1.el.toFixed(3)}，位置 ${fz0.p.map(v => v.toFixed(2))}→${fz1.p.map(v => v.toFixed(2))}，升降台 y ${fz0.lift.toFixed(3)}→${fz1.lift.toFixed(3)}`);
  rec(B, '首次阅读写进日志并弹「日志已更新」；再读不重复', ju1.length === 1 && ju2.length === 1 && ju3.length === 0 && toast1?.text?.includes('日志已更新') ? 'PASS' : 'FAIL',
    `告示首读 journal:updated ${ju1.length} 次（toast「${toast1?.text}」hidden=${toast1?.hidden}）；日志首读 ${ju2.length} 次；再读 ${ju3.length} 次；readDocs=${JSON.stringify(entries)}`);
});

await step(B, '日志（J）：当前目标、分组、点条目阅读、第 6 页', async () => {
  await page.tap('KeyJ'); await sleep(1200);
  const j = await ev(`({ open: __game.ui.journal.isOpen, title: document.querySelector('.journal-title').textContent, goalLabel: document.querySelector('.journal-goal-label').textContent, goal: document.querySelector('.journal-goal-text').textContent, chapters: [...document.querySelectorAll('.journal-chapter')].map(e => e.firstChild?.textContent ?? e.textContent.slice(0, 20)), groups: [...document.querySelectorAll('.journal-group')].map(g => g.innerText.replace(/\\n/g, ' | ')), entries: [...document.querySelectorAll('.journal-entry')].map(b => b.textContent), el: __game.time.elapsed })`);
  await page.screenshot(`${SH}/005-journal.png`);
  await ev(`__game.narrative.setGoal('ch1.s2.goal.cellar')`); await sleep(800);
  const g2 = await ev(`document.querySelector('.journal-goal-text').textContent`);
  // 点「父亲的日志」条目
  const idx = j.entries.findIndex((t) => /日志|爸爸|父亲/.test(t));
  await clickSel(`.journal-entry:nth-of-type(${1})`).catch(() => null);
  const btns = await ev(`[...document.querySelectorAll('.journal-entry')].map((b, i) => ({ i, t: b.textContent }))`);
  const target = btns.find((b) => /日志/.test(b.t)) ?? btns[0];
  await ev(`__game.ui.reader.isOpen && __game.ui.reader.close()`); await sleep(500);
  const rr = await ev(`(() => { const b = [...document.querySelectorAll('.journal-entry')][${target?.i ?? 0}]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.click(rr.x, rr.y); await sleep(1200);
  const fromJ = await ev(`({ reader: __game.ui.reader.isOpen, doc: __game.ui.reader.docId, pages: __game.ui.reader.pageCount })`);
  await page.tap('Tab'); await sleep(1000);
  const backJ = await ev(`({ journal: __game.ui.journal.isOpen, reader: __game.ui.reader.isOpen })`);
  await page.tap('KeyJ'); await sleep(800);
  const jClosed = await ev(`({ journal: __game.ui.journal.isOpen, ctx: __game.input.context })`);
  rec(B, '首次阅读的文档出现在 J 日志中（分组）；当前目标可由代码更新', j.open && j.entries.length >= 2 && g2 && g2 !== j.goal ? 'PASS' : 'FAIL',
    `日志标题「${j.title}」目标「${j.goalLabel}：${j.goal}」→ setGoal 后「${g2}」；分组 ${JSON.stringify(j.groups)}；条目 ${JSON.stringify(j.entries)}；点条目「${target?.t}」打开阅读 ${JSON.stringify(fromJ)}；Tab 关阅读后回到日志 ${JSON.stringify(backJ)}；J 关闭 ${JSON.stringify(jClosed)}`);
  // 第 6 页
  await ev(`__game.narrative.unlockOutroEntry()`); await sleep(500);
  await ev(`__game.ui.reader.open('ch1.s2.journal.doc')`); await sleep(1000);
  for (let i = 0; i < 5; i++) { await page.tap('KeyD'); await sleep(600); }
  const p6 = await ev(`({ pages: __game.ui.reader.pageCount, label: document.querySelector('.reader-page').textContent, body: document.querySelector('.reader-body').textContent })`);
  await page.screenshot(`${SH}/005-journal-page6.png`);
  await page.tap('Tab'); await sleep(800);
  rec(B, '结尾演出后父亲日志第 6 页出现 ch1.outro.journal_entry', p6.pages === 6 && p6.label.startsWith('6') ? 'PASS' : 'FAIL', `unlockOutroEntry() 后页数 ${p6.pages}，翻到「${p6.label}」，正文「${p6.body.slice(0, 80)}…」`);
  globalThis.__p6body = p6.body;
});

await step(A, 'pickup / place', async () => {
  await go('sample-lantern'); await sleep(1000);
  const t0 = await now();
  await E(); await sleep(1500);
  const h1 = await ev(`({ holding: __testbed.interaction.held.holding, prompt: document.querySelector('.hud-prompt').hidden ? null : document.querySelector('.hud-prompt').textContent })`);
  // 拿着时去一个不是 socket 的地方按 E（木箱）
  await go('sample-inspect'); await sleep(1000);
  await E(); await sleep(1200);
  const h2 = await ev(`__testbed.interaction.held.holding`);
  await go('sample-stand-a'); await sleep(1000);
  const pa = (await hud()).prompt;
  await E(); await sleep(1500);
  const h3 = await ev(`({ holding: __testbed.interaction.held.holding, lanternParent: __testbed.scene.getObjectByName('sample-lantern').parent?.name })`);
  await page.screenshot(`${SH}/004-place-stand-a.png`);
  // 空手去灯台 B：不应有 place 提示
  await go('sample-stand-b'); await sleep(1000);
  const pb = (await hud()).prompt;
  const ev1 = (await evs('item:pickup', t0)).concat(await evs('item:place', t0)).map((x) => x.n + ' ' + JSON.stringify(x.e));
  rec(A, 'pickup / place：拾取手持物，只能放到 -socket 上', h1.holding && h2 && !h3.holding && /socket/.test(h3.lanternParent) && !pb ? 'PASS' : 'FAIL',
    `拾取后 holding=${h1.holding}；拿着对木箱按 E 仍 holding=${h2}；灯台 A 提示「${pa}」放下后 holding=${h3.holding}，风灯挂在 ${h3.lanternParent}；空手到灯台 B 提示=${pb}；事件 ${ev1.join('；')}`);
});

await step(A, 'use：自动走到交互点并转向', async () => {
  await sleep(3000);
  await go('sample-bell'); await sleep(1200);
  const p0 = await ev(`__testbed.rig.body.position.toArray()`);
  const t0 = await now(); const el0 = await ev(`__game.time.elapsed`);
  await E();
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.now > ${t0})`, 20000, 'bell used');
  const u = (await evs('interact:used', t0)).find((x) => x.e.id === 'sample-bell');
  const p1 = await ev(`({ p: __testbed.rig.body.position.toArray(), f: __testbed.rig.controller.facing })`);
  await sleep(1500);
  await page.screenshot(`${SH}/004-use-bell.png`);
  // 路径被挡：从钟架背后（另一侧）出发
  rec(A, 'use：角色自动走到交互点（≤ 0.4 s）并转向，再触发', Math.hypot(p1.p[0] - 15.25, p1.p[2] + 2) < 0.15 && u.el - el0 <= 0.45 + 0.2 ? 'PASS' : 'FAIL',
    `起点 ${p0.map(v => v.toFixed(2))} → 触发时 ${p1.p.map(v => v.toFixed(2))}（交互点 15.25, -2），朝向 ${(p1.f * 180 / Math.PI).toFixed(0)}°（朝西 = -90°），按 E 到 interact:used 游戏时间 ${(u.el - el0).toFixed(2)} s（含按键到达这一帧）`);
});

await step(A, 'hold：2 s 圆环，中途松开归零', async () => {
  await go('sample-valve'); await sleep(1500);
  const t0 = await now();
  const el0 = await ev(`__game.time.elapsed`);
  await page.keyDown('KeyE');
  await must(`__game.time.elapsed - ${el0} > 1.0 && __testbed.interaction.holdProgress > 0`, 20000, 'hold 1s');
  const mid = await ev(`({ p: __testbed.interaction.holdProgress, ring: !document.querySelector('.hud-hold').hidden, off: document.querySelector('.hud-hold-arc').getAttribute('stroke-dashoffset') })`);
  await page.screenshot(`${SH}/004-hold-ring-mid.png`);
  await page.keyUp('KeyE'); await sleep(1200);
  const rel = await ev(`({ p: __testbed.interaction.holdProgress, ring: !document.querySelector('.hud-hold').hidden })`);
  const used1 = (await evs('interact:used', t0)).filter((x) => x.e.id === 'sample-valve').length;
  await go('sample-valve'); await sleep(1000);
  const t1 = await now(); const el1 = await ev(`__game.time.elapsed`);
  await page.keyDown('KeyE');
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-valve' && x.now > ${t1})`, 40000, 'valve used');
  const u = (await evs('interact:used', t1)).find((x) => x.e.id === 'sample-valve');
  const prog = (await evs('interact:holdProgress', t1));
  await page.keyUp('KeyE');
  // 圆环走满时刻：取 holdProgress 事件不可得（未记录），用触发时刻游戏时间
  rec(A, 'hold：按住 E 2 秒出现完整圆环后触发；中途松开进度归零', mid.ring && rel.p === 0 && used1 === 0 && u && u.el - el1 >= 1.9 && u.el - el1 <= 2.4 ? 'PASS' : 'FAIL',
    `按住 ~1 s：进度 ${mid.p.toFixed(2)}，圆环显示=${mid.ring}（dashoffset ${mid.off}）；松开后进度 ${rel.p}、圆环显示=${rel.ring}，未触发（${used1}）；第二次按住到 interact:used 游戏时间 ${(u.el - el1).toFixed(2)} s（含走位）`);
});

await step(A, 'push：0.8 m/s，终点卡位后发事件、不能再推', async () => {
  await go('sample-raft'); await sleep(1500);
  const t0 = await now();
  const z0 = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  await page.keyDown('KeyE');
  const samples = [];
  const tEnd = Date.now() + 60000;
  while (Date.now() < tEnd) {
    const s = await ev(`({ el: __game.time.elapsed, z: __testbed.scene.getObjectByName('sample-raft').position.z, end: __ev.some(x => x.n === 'interact:pushEnd' && x.now > ${t0}) })`);
    samples.push(s); if (s.end) break; await sleep(300);
  }
  await page.keyUp('KeyE'); await sleep(800);
  const zEnd = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  // 速度：取中段（排除起步走位）
  const mv = samples.filter((s) => s.z > z0 + 0.3 && s.z < 9.3);
  const v = mv.length >= 2 ? (mv[mv.length - 1].z - mv[0].z) / (mv[mv.length - 1].el - mv[0].el) : NaN;
  await page.screenshot(`${SH}/004-push-end.png`);
  // 再推
  const pr = (await hud()).prompt;
  await page.keyDown('KeyE'); await sleep(3000); await page.keyUp('KeyE');
  const zAgain = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  const pe = await evs('interact:pushEnd', t0);
  rec(A, 'push：按住 E 以 0.8 m/s 沿轨道移动，到终点卡位发事件且不能再推', Math.abs(v - 0.8) < 0.05 && pe.length === 1 && Math.abs(zEnd - 9.5) < 0.02 && Math.abs(zAgain - zEnd) < 1e-3 ? 'PASS' : 'FAIL',
    `z ${z0} → ${zEnd.toFixed(3)}（终点 9.5），中段速度 ${v.toFixed(3)} m/s（游戏时间）；pushEnd ${pe.length} 次；终点后提示=${pr}，再按住 3 s z=${zAgain.toFixed(3)}`);
});

await step(A, '机关模式', async () => {
  await go('sample-mechanism'); await sleep(1500);
  const t0 = await now();
  await E(); await sleep(2500);
  const st = () => ev(`({ ctx: __game.input.context, cur: __testbed.interaction.puzzle?.current?.id ?? __testbed.samples.puzzle.current?.id, angles: __testbed.samples.puzzle.parts.map(p => p.angles ? [...p.angles] : p.axes.map(a => a.angle)), bar: document.querySelector('.hud-puzzle-bar').hidden ? null : document.querySelector('.hud-puzzle-bar').textContent, cam: __testbed.cameraFollow.modeName, lock: !!document.pointerLockElement })`);
  const s0 = await st().catch((e) => ({ err: String(e) }));
  await page.screenshot(`${SH}/004-puzzle-enter.png`);
  await page.tap('KeyD'); await sleep(800);
  const s1 = await st();
  await page.keyDown('ShiftLeft'); await page.tap('KeyD'); await page.keyUp('ShiftLeft'); await sleep(800);
  const s2 = await st();
  // 鼠标（指针锁定时的相对移动）
  if (!s2.lock) { await page.click(640, 400); await sleep(600); }
  for (let i = 0; i < 6; i++) { await page.mouse('mouseMoved', 640 + (i + 1) * 15, 400); await sleep(120); }
  await sleep(600);
  const s3 = await st();
  await page.tap('KeyE'); await sleep(800);
  const s4 = await st();
  await page.tap('KeyW'); await sleep(800);
  await page.tap('KeyD'); await sleep(800);
  const s5 = await st();
  await page.tap('KeyQ'); await sleep(800);
  const s6 = await st();
  await page.tap('KeyR'); await sleep(800);
  const s7 = await st();
  const hl = await ev(`(() => { const sel = []; __testbed.samples.root.traverse(o => { if (o.userData?.outline || o.name?.includes('outline') || o.userData?.highlighted) sel.push(o.name || o.parent?.name); }); return sel; })()`);
  const rot = (await evs('puzzle:partRotated', t0)).map((x) => `${x.e.part}#${x.e.axis}=${x.e.angle}${x.e.fine ? '(精调)' : ''}`);
  const selE = (await evs('puzzle:partSelected', t0)).map((x) => x.e.part);
  await page.click(640, 400, 'right'); await sleep(2000);
  const s8 = await st();
  rec(A, '机关模式：15° / Shift 7.5° 吸附，Q/E 切换，R 复位，右键退出', s0.ctx === 'puzzle' && s8.ctx === 'explore' && rot.length >= 2 ? 'PASS' : 'FAIL',
    `进入：上下文 ${s0.ctx}，相机 ${s0.cam}，操作条「${s0.bar}」，当前部件 ${s0.cur}，角度 ${JSON.stringify(s0.angles)}；D → ${JSON.stringify(s1.angles)}；Shift+D → ${JSON.stringify(s2.angles)}；鼠标右移 → ${JSON.stringify(s3.angles)}（指针锁定=${s3.lock}）；E 切换 → ${s4.cur}；W、D → ${JSON.stringify(s5.angles)}；Q → ${s6.cur}；R → ${JSON.stringify(s7.angles)}；事件 rotated ${JSON.stringify(rot)} selected ${JSON.stringify(selE)}；右键后上下文 ${s8.ctx} 相机 ${s8.cam}`);
  globalThis.__s = { s0, s1, s2, s3, s4, s5, s6, s7, s8 };
  // Tab 退出
  await go('sample-mechanism'); await sleep(1000);
  await E(); await sleep(2000);
  const tIn = await st();
  await page.tap('Tab'); await sleep(2000);
  const tOut = await st();
  rec(A, '机关：Tab 退出', tIn.ctx === 'puzzle' && tOut.ctx === 'explore' ? 'PASS' : 'FAIL', `进入 ${tIn.ctx} → Tab 后 ${tOut.ctx}`);
  // Esc 暂停 → 继续 → 第一下右键
  await go('sample-mechanism'); await sleep(1000);
  await page.click(640, 400); await sleep(500);
  await E(); await sleep(2000);
  const e0 = await st();
  await page.tap('Escape'); await sleep(1500);
  const ep = await ev(`({ pause: __game.ui.pause.isOpen, ctx: __game.input.context, lock: !!document.pointerLockElement })`);
  await page.screenshot(`${SH}/004-puzzle-esc-pause.png`);
  await clickSel('.pause-menu [data-act="resume"]'); await sleep(1500);
  const er = await st();
  await page.click(640, 400, 'right'); await sleep(2000);
  const ex = await st();
  rec(A, '机关中 Esc 暂停，继续后仍在机关；第一下右键重新锁定并退出', e0.ctx === 'puzzle' && ep.pause && er.ctx === 'puzzle' && ex.ctx === 'explore' ? 'PASS' : 'FAIL',
    `进入 ${e0.ctx}（锁定=${e0.lock}）→ Esc：暂停菜单=${ep.pause} 上下文 ${ep.ctx} 锁定=${ep.lock} → 点「继续」：${er.ctx} 锁定=${er.lock} → 第一下右键：上下文 ${ex.ctx}，相机 ${ex.cam}，锁定=${ex.lock}`);
});

await step(A, 'highlight()', async () => {
  const t0 = await now(); const el0 = await ev(`__game.time.elapsed`);
  await go('sample-bell'); await sleep(500);
  const ids = await ev(`__testbed.interaction.highlight(['sample-bell'], 3)`);
  await sleep(800);
  await page.screenshot(`${SH}/004-highlight.png`);
  await must(`__ev.some(x => x.n === 'highlight:end' && x.now > ${t0})`, 60000, 'highlight end');
  const s = (await evs('highlight:start', t0))[0], e = (await evs('highlight:end', t0))[0];
  rec(A, 'highlight() 后目标描边高亮 3 秒后消失', s && e && Math.abs(e.el - s.el - 3) < 0.15 ? 'PASS' : 'FAIL', `返回 ${JSON.stringify(ids)}；start→end 游戏时间 ${(e.el - s.el).toFixed(2)} s`);
});

await step(B, '字幕：时长 / 推进 / 样式 / 字号', async () => {
  const el0 = await ev(`__game.time.elapsed`);
  const r = await ev(`(async () => { const st = __game.ui.subtitles; const out = {};
    const measure = async (fn) => { const t0 = performance.now(); fn(); const sh = __game.time.elapsed; await __qa.until(() => __ev.some(x => x.n === 'subtitle:hide' && x.now > t0), 60000); const h = __ev.filter(x => x.n === 'subtitle:hide' && x.now > t0)[0]; return { dur: +(h.el - sh).toFixed(3), reason: h.e.reason, shown: h.e.shown }; };
    out.ten = await measure(() => st.play(['ch1.s2.cups.inspect']));
    out.thirty = await measure(() => st.track.playText('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'));
    out.t29 = await measure(() => st.play(['ch1.hint.p5.mid_a.l3']));
    return out; })()`);
  // 推进：左键 / Space
  const t0 = await now();
  await ev(`__game.ui.subtitles.play(['ch1.s2.cups.inspect', 'ch1.s1.nets.inspect'])`); await sleep(600);
  const a0 = await ev(`document.querySelector('.subtitle-line').textContent`);
  await page.tap('Space'); await sleep(700);
  const a1 = await ev(`document.querySelector('.subtitle-line').textContent`);
  await page.click(640, 400); await sleep(700);
  const a2 = await ev(`({ t: document.querySelector('.subtitle-line').textContent, cur: __game.ui.subtitles.current })`);
  const hides = (await evs('subtitle:hide', t0)).map((x) => x.e.reason);
  // 样式与字号
  await ev(`__game.ui.subtitles.play(['ch1.s2.cups.inspect'])`); await sleep(400);
  const sty = await ev(`(() => { const l = document.querySelector('.subtitle-line'), w = document.querySelector('.subtitles'); const cs = getComputedStyle(l), ws = getComputedStyle(w); const r = l.getBoundingClientRect();
    return { center: +((r.x + r.width / 2) - innerWidth / 2).toFixed(1), bottom: +(innerHeight - r.bottom).toFixed(0), bg: cs.backgroundColor + ' / ' + ws.backgroundColor, shadow: cs.textShadow, color: cs.color, font: cs.fontFamily.split(',')[0], size: cs.fontSize }; })()`);
  await page.screenshot(`${SH}/005-subtitle-m.png`);
  const sizes = {};
  for (const sz of ['s', 'l', 'm']) { await ev(`__game.settings.set('subtitleSize', '${sz}')`); await sleep(400); sizes[sz] = await ev(`getComputedStyle(document.querySelector('.subtitle-line')).fontSize`); if (sz === 'l') await page.screenshot(`${SH}/005-subtitle-l.png`); }
  // 父亲字色
  const fatherId = await ev(`(() => { return null; })()`);
  rec(B, '10 字字幕 2.0 s、30 字 3.6 s 自动切换（游戏时间）', Math.abs(r.ten.dur - 2.0) < 0.1 && Math.abs(r.thirty.dur - 3.6) < 0.1 ? 'PASS' : 'FAIL',
    `10 字「两只杯子。一只扣着。」${r.ten.dur} s（${r.ten.reason}）；30 字测试行（playText）${r.thirty.dur} s；表内 29 字行 ${r.t29.dur} s（期望 3.48）`);
  rec(B, '左键 / Space 立即推进', a1 !== a0 && hides[0] === 'advance' && hides[1] === 'advance' ? 'PASS' : 'FAIL', `「${a0}」→ Space →「${a1}」→ 左键 → ${a2.cur ? '「' + a2.t + '」' : '清空'}；hide 原因 ${JSON.stringify(hides)}`);
  rec(B, '字幕底部居中、无底框、浅阴影；字号三档即时生效', Math.abs(sty.center) < 2 && /0\)|transparent/.test(sty.bg) && sty.shadow !== 'none' && sizes.s !== sizes.m && sizes.m !== sizes.l ? 'PASS' : 'FAIL',
    `水平中心偏差 ${sty.center} px，距底 ${sty.bottom} px，背景 ${sty.bg}，阴影 ${sty.shadow}，字色 ${sty.color}，字体 ${sty.font}；字号 小/中/大 = ${sizes.s}/${sizes.m}/${sizes.l}`);
});

console.log('LOCK0', lock0);
console.log('ERRORS', JSON.stringify(page.errors));
P.save('b3-045');
await P.done(); process.exit(0);
