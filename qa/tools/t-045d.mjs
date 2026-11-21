import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5235);
const { page, ev, must, clickSel, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['interact:used','interact:read','interact:holdProgress','interact:pushMoved','item:pickup','item:place','puzzle:enter','puzzle:exit','puzzle:partSelected','puzzle:partRotated','puzzle:reset','journal:updated','subtitle:show','subtitle:hide','reader:open','reader:close','journal:open','journal:close','interact:pushEnd'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), el: v.time.elapsed, fr: v.time.frame, now: performance.now() }));
  } }); })();`);
await page.goto(url('?smoke=1'));
await must(`!!window.__game`);
await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed`, 180000, 'testbed');
const frames = async (n = 4) => { const f0 = await ev(`__game.time.frame`); await must(`__game.time.frame >= ${f0 + n}`, 120000, 'frames'); };
await frames(10);
await page.click(640, 400); await frames(4);
const go = async (id) => { await ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`); await frames(4); await must(`__testbed.interaction.current?.id === '${id}' || true`, 1000); };
const st = () => ev(`({ j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context, page: document.querySelector('.reader-page').textContent, pages: __game.ui.reader.pageCount, doc: __game.ui.reader.docId, held: __testbed.interaction.held.holding, ak: __testbed.interaction.actionKind, cur: __testbed.interaction.current?.id ?? null, prompt: document.querySelector('.hud-prompt').hidden ? null : document.querySelector('.hud-prompt').textContent })`);
const now = () => ev(`performance.now()`);
const evs = (n, t) => ev(`__ev.filter(x => x.n === '${n}' && x.now > ${t})`);
const E = async () => { await page.tap('KeyE'); await frames(4); };
const fr = (l) => console.log('..', l);

await step('005', '阅读 + 父亲日志 5 页 + 冻结 + 关闭 + 日志更新', async () => {
  await go('sample-read');
  const pre = await st();
  const t0 = await now();
  await E(); await must(`__game.ui.reader.isOpen`, 60000, 'notice open');
  const a = await st();
  await page.screenshot(`${SH}/005-reader-notice.png`);
  await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'notice tab close');
  await frames(3);
  const toast = await ev(`(() => { const t = document.querySelector('.toast-left'); return t ? { text: t.textContent, hidden: t.hidden, op: getComputedStyle(t).opacity, cls: t.className } : null; })()`);
  await page.screenshot(`${SH}/005-journal-updated-toast.png`);
  const ju1 = (await evs('journal:updated', t0)).length;
  await go('sample-journal');
  const pre2 = await st();
  const t1 = await now();
  await E(); await must(`__game.ui.reader.isOpen`, 60000, 'journal doc open');
  const b = await st();
  await page.screenshot(`${SH}/005-reader-journal-p1.png`);
  const fz0 = await ev(`({ el: __game.time.elapsed, fr: __game.time.frame, p: __testbed.rig.body.position.toArray() })`);
  await page.keyDown('KeyW'); await frames(8); await page.keyUp('KeyW');
  const fz1 = await ev(`({ el: __game.time.elapsed, fr: __game.time.frame, p: __testbed.rig.body.position.toArray() })`);
  const seen = [];
  for (const k of ['KeyD', 'ArrowRight', 'KeyD', 'KeyD', 'KeyD', 'KeyA', 'ArrowLeft']) { const p0 = await ev(`__game.ui.reader.page`); await page.tap(k); await frames(4); seen.push(`${k}:${p0 + 1}→${await ev(`document.querySelector('.reader-page').textContent`)}`); if (seen.length === 5) await page.screenshot(`${SH}/005-reader-journal-p5.png`); }
  await clickSel('.reader [data-act="prev"]'); await frames(4); seen.push('‹→' + await ev(`document.querySelector('.reader-page').textContent`));
  await clickSel('.reader [data-act="next"]'); await frames(4); seen.push('›→' + await ev(`document.querySelector('.reader-page').textContent`));
  const rp = await P.rect('.reader-paper');
  await page.click(rp.x, rp.y, 'right'); await must(`!__game.ui.reader.isOpen`, 60000, 'rc close');
  const c = await st();
  const ju2 = (await evs('journal:updated', t1)).length;
  const t2 = await now();
  await E(); await must(`__game.ui.reader.isOpen`, 60000, 'reopen');
  await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'tab close 2');
  const ju3 = (await evs('journal:updated', t2)).length;
  rec('005', '阅读界面 2 页以上翻页，右键 / Tab 关闭；打开期间角色不能移动', a.r && b.pages === 5 && !c.r && fz1.el === fz0.el && Math.hypot(fz1.p[0] - fz0.p[0], fz1.p[2] - fz0.p[2]) < 0.01 && seen[4].endsWith('5 / 5') ? 'PASS' : 'FAIL',
    `告示：站位提示「${pre.prompt}」→ E 打开 页数 ${a.pages} 上下文 ${a.ctx}（单页无箭头），Tab 关闭；父亲日志：站位提示「${pre2.prompt}」→ E 打开 页数 ${b.pages}「${b.page}」；按住 W ${fz1.fr - fz0.fr} 帧：游戏时间 ${fz0.el.toFixed(3)}→${fz1.el.toFixed(3)}，位置 ${fz0.p.map(v => v.toFixed(2))}→${fz1.p.map(v => v.toFixed(2))}；翻页 ${seen.join('，')}；纸面右键关闭 → ${c.ctx}`);
  rec('005', '首次阅读弹「日志已更新」；再读不重复', ju1 === 1 && ju2 === 1 && ju3 === 0 && /日志已更新/.test(toast?.text ?? '') ? 'PASS' : 'FAIL', `告示首读 journal:updated ${ju1} 次（左侧提示「${toast?.text}」opacity ${toast?.op}）；父亲日志首读 ${ju2} 次；再读 ${ju3} 次`);
});

await step('005', 'J 日志', async () => {
  await page.tap('KeyJ'); await must(`__game.ui.journal.isOpen`, 60000, 'J open'); await frames(2);
  const j = await ev(`({ title: document.querySelector('.journal-title').textContent, goalLabel: document.querySelector('.journal-goal-label').textContent, goal: document.querySelector('.journal-goal-text').textContent, groups: [...document.querySelectorAll('.journal-group')].map(g => g.innerText.replace(/\\n+/g, ' | ')), entries: [...document.querySelectorAll('.journal-entry')].map(b => b.textContent), el: __game.time.elapsed })`);
  await page.screenshot(`${SH}/005-journal.png`);
  await ev(`__game.narrative.setGoal('ch1.s2.goal.cellar')`); await frames(3);
  const g2 = await ev(`document.querySelector('.journal-goal-text').textContent`);
  await page.screenshot(`${SH}/005-journal-goal-updated.png`);
  const i = j.entries.findIndex((t) => /日志/.test(t));
  const rr = await ev(`(() => { const b = [...document.querySelectorAll('.journal-entry')][${Math.max(0, i)}]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.click(rr.x, rr.y); await must(`__game.ui.reader.isOpen`, 60000, 'entry open');
  const fromJ = await st();
  await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'entry close');
  await frames(3);
  const backJ = await st();
  await page.tap('KeyJ'); await must(`!__game.ui.journal.isOpen`, 60000, 'J close');
  const closed = await st();
  // 右键关闭
  await page.tap('KeyJ'); await must(`__game.ui.journal.isOpen`, 60000, 'J open 2');
  await page.click(640, 400, 'right'); const rcOk = await page.waitFor(`!__game.ui.journal.isOpen`, 60000, 200);
  await page.tap('KeyJ'); await must(`__game.ui.journal.isOpen`, 60000, 'J open 3');
  await page.tap('Tab'); const tabOk = await page.waitFor(`!__game.ui.journal.isOpen`, 60000, 200);
  rec('005', 'J 日志：已读文档按分组列出，可点开阅读；当前目标可由代码更新；J / 右键 / Tab 关闭', j.entries.length >= 2 && g2 !== j.goal && fromJ.r && backJ.j && !backJ.r && !closed.j && rcOk && tabOk ? 'PASS' : 'FAIL',
    `标题「${j.title}」，目标「${j.goalLabel}」「${j.goal}」→ setGoal 后「${g2}」；分组 ${JSON.stringify(j.groups)}；点「${j.entries[Math.max(0, i)]}」打开阅读 ${fromJ.doc} ${fromJ.pages} 页；Tab 关阅读后日志仍开=${backJ.j}；J 关闭后上下文 ${closed.ctx}；右键关闭=${rcOk}；Tab 关闭=${tabOk}`);
  await ev(`__game.narrative.unlockOutroEntry()`); await frames(2);
  await ev(`__game.ui.reader.open('ch1.s2.journal.doc')`); await must(`__game.ui.reader.isOpen`, 60000, 'open6');
  for (let k = 0; k < 5; k++) { const p0 = await ev(`__game.ui.reader.page`); await page.tap('KeyD'); await must(`__game.ui.reader.page !== ${p0}`, 60000, 'flip'); }
  const p6 = await ev(`({ pages: __game.ui.reader.pageCount, label: document.querySelector('.reader-page').textContent, body: document.querySelector('.reader-body').textContent })`);
  await page.screenshot(`${SH}/005-journal-page6.png`);
  await page.tap('Tab'); await must(`!__game.ui.reader.isOpen`, 60000, 'close6');
  rec('005', '父亲日志第 6 页（unlockOutroEntry 后）', p6.pages === 6 && p6.label.startsWith('6') ? 'PASS' : 'FAIL', `页数 ${p6.pages}「${p6.label}」正文「${p6.body.replace(/\s+/g, ' ').slice(0, 60)}…」`);
  globalThis.p6body = p6.body;
});

await step('004', 'pickup / place', async () => {
  await go('sample-lantern');
  const p = await st();
  const t0 = await now();
  await E(); await must(`__testbed.interaction.held.holding`, 60000, 'pickup');
  await go('sample-inspect');
  await E(); await frames(4);
  const h2 = await st();
  await page.screenshot(`${SH}/004-holding-lantern.png`);
  await go('sample-stand-a');
  const pa = await st();
  await E(); await must(`!__testbed.interaction.held.holding`, 60000, 'place');
  const parent = await ev(`__testbed.scene.getObjectByName('sample-lantern')?.parent?.name`);
  await page.screenshot(`${SH}/004-place-stand-a.png`);
  await go('sample-stand-b');
  const pb = await st();
  const ev1 = (await evs('item:pickup', t0)).concat(await evs('item:place', t0)).map((x) => x.n + JSON.stringify(x.e));
  rec('004', 'pickup / place：拾取手持，只能放到 socket 上', h2.held && !pb.cur && /socket/.test(parent) ? 'PASS' : 'FAIL',
    `拾取前提示「${p.prompt}」；拿着时木箱处 holding=${h2.held}（木箱仍按 inspect，提示「${h2.prompt}」）；灯台 A 提示「${pa.prompt}」放下后挂在 ${parent}；空手到灯台 B：可交互=${pb.cur} 提示=${pb.prompt}；事件 ${ev1.join('；')}`);
});

await step('004', 'use', async () => {
  await go('sample-bell');
  const pre = await ev(`({ p: __testbed.rig.body.position.toArray(), prompt: document.querySelector('.hud-prompt').textContent })`);
  const t0 = await now(); const el0 = await ev(`__game.time.elapsed`);
  const trace = [];
  await page.tap('KeyE');
  const end = Date.now() + 90000;
  while (Date.now() < end) { const s = await ev(`({ el: __game.time.elapsed, ak: __testbed.interaction.actionKind, x: __testbed.rig.body.position.x, z: __testbed.rig.body.position.z, f: __testbed.rig.controller.facing, used: __ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-bell' && x.now > ${t0}) })`); trace.push(s); if (s.used) break; await sleep(100); }
  const u = (await evs('interact:used', t0)).find((x) => x.e.id === 'sample-bell');
  const p1 = await ev(`({ p: __testbed.rig.body.position.toArray(), f: __testbed.rig.controller.facing })`);
  await frames(3);
  await page.screenshot(`${SH}/004-use-bell.png`);
  const appr = trace.filter((s) => s.ak === 'approach');
  rec('004', 'use：自动走到交互点并转向后触发', u && Math.hypot(p1.p[0] - 15.25, p1.p[2] + 2) < 0.15 ? 'PASS' : 'FAIL',
    `提示「${pre.prompt}」；起点 ${pre.p.map(v => v.toFixed(2))} → 触发时 ${p1.p.map(v => v.toFixed(2))}（交互点 15.25, 0, -2），朝向 ${(p1.f * 180 / Math.PI).toFixed(0)}°；按 E 到 used 游戏时间 ${u ? (u.el - el0).toFixed(2) : '-'} s，approach 采样 ${appr.length} 个（${appr.map(s => `${s.el.toFixed(2)}:${s.x.toFixed(2)}`).join(' ')}）`);
});

await step('004', 'hold', async () => {
  await go('sample-valve');
  const pre = await st();
  const t0 = await now(); const el0 = await ev(`__game.time.elapsed`);
  await page.keyDown('KeyE');
  await must(`__testbed.interaction.actionKind === 'hold' && __testbed.interaction.holdProgress > 0.3`, 90000, 'hold progress');
  const mid = await ev(`({ p: __testbed.interaction.holdProgress, ring: !document.querySelector('.hud-hold').hidden, off: document.querySelector('.hud-hold-arc').getAttribute('stroke-dashoffset') })`);
  await page.screenshot(`${SH}/004-hold-ring-mid.png`);
  await page.keyUp('KeyE'); await frames(4);
  const rel = await ev(`({ ak: __testbed.interaction.actionKind, p: __testbed.interaction.holdProgress, ring: !document.querySelector('.hud-hold').hidden })`);
  const u1 = (await evs('interact:used', t0)).length;
  await go('sample-valve');
  const t1 = await now();
  await page.keyDown('KeyE');
  await must(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'sample-valve' && x.now > ${t1})`, 120000, 'valve used');
  await page.keyUp('KeyE');
  const hp = await evs('interact:holdProgress', t1);
  const u = (await evs('interact:used', t1)).find((x) => x.e.id === 'sample-valve');
  const first = hp.find((x) => x.e.progress > 0);
  const dur = first ? u.el - first.el : NaN;
  // 第一个进度事件时 progress 已经 > 0：按 progress*2 s 回推起点
  const dur2 = first ? u.el - (first.el - first.e.progress * 2) : NaN;
  rec('004', 'hold：按住 E 2 秒（圆环满）触发；中途松开归零', mid.ring && rel.p === 0 && !rel.ring && u1 === 0 && Math.abs(dur2 - 2) < 0.15 ? 'PASS' : 'FAIL',
    `提示「${pre.prompt}」；中途：进度 ${mid.p.toFixed(2)} 圆环显示=${mid.ring}（dashoffset ${mid.off}/94.25）；松开：进度 ${rel.p} 圆环=${rel.ring} 未触发(${u1})；第二次按住：进度从 ${first?.e.progress.toFixed(2)} 到触发 ${dur.toFixed(2)} s，回推完整时长 ${dur2.toFixed(2)} s（游戏时间）；最后进度 ${hp.at(-1)?.e.progress}`);
});

await step('004', 'push', async () => {
  await go('sample-raft');
  const pre = await st();
  const t0 = await now();
  const z0 = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  await page.keyDown('KeyE');
  await must(`__ev.some(x => x.n === 'interact:pushEnd' && x.now > ${t0})`, 240000, 'pushEnd');
  await page.keyUp('KeyE'); await frames(4);
  const zEnd = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  const pm = await evs('interact:pushMoved', t0);
  const mv = pm.filter((x) => x.e.t > 0.05 && x.e.t < 0.95);
  const pz = await ev(`__ev.filter(x => x.n === 'interact:pushMoved' && x.now > ${t0}).map(x => x.el)`);
  const v = mv.length >= 2 ? ((mv.at(-1).e.t - mv[0].e.t) * 3) / (mv.at(-1).el - mv[0].el) : NaN;
  await page.screenshot(`${SH}/004-push-end.png`);
  const after = await st();
  await page.keyDown('KeyE'); await frames(10); await page.keyUp('KeyE'); await frames(2);
  const z2 = await ev(`__testbed.scene.getObjectByName('sample-raft').position.z`);
  const n = (await evs('interact:pushEnd', t0)).length;
  rec('004', 'push：0.8 m/s 沿轨道，终点卡位发事件、不能再推', Math.abs(v - 0.8) < 0.05 && n === 1 && Math.abs(zEnd - 9.5) < 0.02 && Math.abs(z2 - zEnd) < 1e-3 ? 'PASS' : 'FAIL',
    `提示「${pre.prompt}」；z ${z0}→${zEnd.toFixed(3)}（轨道 3 m，终点 9.5）；pushMoved ${pm.length} 次，中段速度 ${v.toFixed(3)} m/s（t×3 m / 游戏时间）；pushEnd ${n} 次；终点后可交互=${after.cur} 提示=${after.prompt}；再按住 10 帧 z=${z2.toFixed(3)}`);
});

await step('004', '机关', async () => {
  await go('sample-mechanism');
  const t0 = await now();
  await E(); await must(`__game.input.context === 'puzzle'`, 60000, 'puzzle');
  await frames(6);
  const P0 = () => ev(`(() => { const g = __testbed.samples.puzzle; const ix = __testbed.interaction; return { ctx: __game.input.context, cur: g.current.id, angles: g.parts.map(p => [...p.angles]), bar: document.querySelector('.hud-puzzle-bar').hidden ? null : document.querySelector('.hud-puzzle-bar').textContent, hl: ix.highlighter.keys(), cam: __testbed.cameraFollow.modeName, lock: !!document.pointerLockElement }; })()`);
  const s0 = await P0();
  await page.screenshot(`${SH}/004-puzzle-enter.png`);
  if (!s0.lock) { await page.click(640, 400); await frames(3); }
  const mouseRight = async (px) => { for (let i = 1; i <= 4; i++) { await page.mouse('mouseMoved', 640 + (i * px) / 4, 400); await sleep(50); } await frames(4); await page.mouse('mouseMoved', 640, 400); await frames(2); };
  // 依次：右移一点（测一档），Shift 右移
  const steps = [];
  const rot0 = (await evs('puzzle:partRotated', t0)).length;
  await mouseRight(60);
  steps.push(['鼠标右移', await P0()]);
  await page.keyDown('ShiftLeft'); await frames(2);
  await mouseRight(60);
  await page.keyUp('ShiftLeft'); await frames(2);
  steps.push(['Shift+鼠标右移', await P0()]);
  await page.tap('KeyE'); await frames(4);
  steps.push(['E', await P0()]);
  await page.screenshot(`${SH}/004-puzzle-part2.png`);
  await page.mouse('mouseMoved', 640, 400);
  for (let i = 1; i <= 4; i++) { await page.mouse('mouseMoved', 640, 400 - i * 15); await sleep(50); } await frames(4);
  steps.push(['鼠标上移(镜子俯仰)', await P0()]);
  await page.tap('KeyQ'); await frames(4);
  steps.push(['Q', await P0()]);
  await page.tap('KeyR'); await frames(4);
  steps.push(['R', await P0()]);
  const rot = (await evs('puzzle:partRotated', t0)).map((x) => `${x.e.part}#${x.e.axis}=${x.e.angle}${x.e.fine ? '(精调)' : ''}`);
  await page.click(640, 400, 'right'); await must(`__game.input.context === 'explore'`, 60000, 'rc exit');
  await frames(4);
  const s9 = await P0();
  rec('004', '机关：鼠标 15° / Shift 7.5° 吸附；Q/E 切换且高亮跟随；R 复位；右键退出', s0.ctx === 'puzzle' && s9.ctx === 'explore' && rot.length >= 2 ? 'CHECK' : 'FAIL',
    `进入：相机 ${s0.cam}，操作条「${s0.bar}」，当前 ${s0.cur}，高亮 ${JSON.stringify(s0.hl)}；${steps.map(([l, s]) => `${l} → 当前 ${s.cur} 角度 ${JSON.stringify(s.angles)} 高亮 ${JSON.stringify(s.hl)}`).join('；')}；rotated 事件 ${JSON.stringify(rot)}；右键 → ${s9.ctx}/${s9.cam}，高亮 ${JSON.stringify(s9.hl)}`);
});

await step('005', '字幕推进', async () => {
  const out = [];
  for (const how of ['Space', 'click']) {
    const t0 = await now();
    await ev(`__game.ui.subtitles.play(['ch1.s2.cups.inspect', 'ch1.s1.nets.inspect'])`); await frames(2);
    const a = await ev(`({ t: document.querySelector('.subtitle-line').textContent, ctx: __game.input.context })`);
    if (how === 'Space') await page.tap('Space'); else await page.click(640, 400);
    await frames(4);
    const b = await ev(`document.querySelector('.subtitle-line').textContent`);
    const h = (await evs('subtitle:hide', t0)).map((x) => x.e.reason);
    out.push({ how, a: a.t, ctx: a.ctx, b, h });
    await ev(`__game.ui.subtitles.clear?.()`); await frames(2);
  }
  rec('005', '左键 / Space 立即推进', out.every((o) => o.h[0] === 'advance' && o.b !== o.a) ? 'PASS' : 'FAIL', out.map((o) => `${o.how}（${o.ctx}）：「${o.a}」→「${o.b}」${JSON.stringify(o.h)}`).join('；'));
});

console.log('ERRORS', JSON.stringify(page.errors));
P.save('b3-045d');
await P.done(); process.exit(0);
