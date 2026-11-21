import { open, sleep, SH } from './b7lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5300);
const T = 'v0.1-013';
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  for (const n of ['interact:used','interact:pushEnd','tide:changed','tide:changing','float:state','subtitle:show','subtitle:hide','hint:solved','puzzle:solved','player:respawn','fade:start'])
    v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed, now: performance.now() }));
} }); })();`);
const S = '__s1';
const st = () => ev(`(() => { const s = ${S}, p = s.puzzles, b = s.rig.body.position, r = p.raft.object.position; const pr = document.querySelector('.hud-prompt'); return { ft: __game.time.fixedTick, tide: p.tide.state, level: +p.tide.level.toFixed(3), tr: p.tide.transitioning, raft: p.raft.state, raftPos: [r.x, r.y, r.z].map(v => +v.toFixed(3)), inAnchor: p.raft.inAnchor, pushT: +p.raftPush.pushT.toFixed(3), locked: p.raftPush.locked, p1: p.p1Solved, p2: p.p2Solved, pos: [b.x, b.y, b.z].map(v => +v.toFixed(3)), goal: __game.narrative.goal, busy: s.rig.controller.busy, ctx: __game.input.context, prompt: pr && !pr.hidden ? pr.textContent.trim() : null, prompt2: (() => { const e = document.querySelector('.hud-prompt2'); return e && !e.hidden ? e.textContent.trim() : null; })(), sub: (() => { const e = document.querySelector('.subtitle, .hud-subtitle, .subtitles'); return e && !e.hidden ? e.textContent.trim() : null; })() }; })()`);
const tp = (x, y, z, facing) => ev(`(() => { const s = ${S}; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); ${facing !== undefined ? `s.rig.controller.facing = ${facing}; s.cameraFollow.yaw = ${facing} + Math.PI;` : ''} return 1; })()`);
const evs = (n, sinceFt) => ev(`__ev.filter(x => x.n === '${n}' && x.ft >= ${sinceFt})`);
// 真实走路：每 150 ms 把相机朝向对准下一个点、按住 W；固定步长 4 s 没前进 5 cm 判卡住
async function walk(points, { tol = 0.35, maxWall = 240000, label = '' } = {}) {
  await page.keyDown('KeyW');
  const trace = []; let stuck = null; const end = Date.now() + maxWall; let i = 0;
  let ref = await st(); let refFt = ref.ft;
  try {
    while (i < points.length && Date.now() < end) {
      const [tx, tz] = points[i];
      const s = await st();
      const d = Math.hypot(tx - s.pos[0], tz - s.pos[2]);
      if (d < tol) { i++; continue; }
      await ev(`(() => { const s = ${S}; s.cameraFollow.yaw = Math.atan2(-(${tx} - s.rig.body.position.x), -(${tz} - s.rig.body.position.z)); return 1; })()`);
      if (Math.hypot(s.pos[0] - ref.pos[0], s.pos[2] - ref.pos[2]) > 0.05) { ref = s; refFt = s.ft; }
      else if (s.ft - refFt > 240) { stuck = { at: s.pos, target: points[i], idx: i, tide: s.tide, level: s.level }; break; }
      if (trace.length === 0 || Math.hypot(s.pos[0] - trace.at(-1)[0], s.pos[2] - trace.at(-1)[2]) > 0.5) trace.push(s.pos);
      await sleep(150);
    }
  } finally { await page.keyUp('KeyW'); }
  const s = await st();
  return { reached: i >= points.length, stuck, final: s.pos, trace };
}
const waitTide = (state) => must(`${S}.puzzles.tide.state === '${state}' && !${S}.puzzles.tide.transitioning`, 400000, 'tide ' + state);
async function ringBell() {
  await tp(-13.9, 2.42, -6.2, -Math.PI / 2); // 钟交互点西侧 0.55 m，面朝东（−X）
  const ok = await page.waitFor(`/E/.test(document.querySelector('.hud-prompt')?.hidden ? '' : document.querySelector('.hud-prompt')?.textContent ?? '')`, 20000, 150);
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
  const f0 = (await st()).ft;
  await page.tap('KeyE');
  const used = await page.waitFor(`__ev.some(x => x.n === 'interact:used' && x.e.id === 'tide-bell-s1' && x.ft >= ${f0})`, 60000, 100);
  return { ok, prompt, used };
}


await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
await must(`(!!(window.__s1 && __s1.puzzles) && __game.input.context === 'explore' && !__game.isPaused) && ((window.__qaExplore ??= performance.now()), true)`, 300000, 'S1 explore');
await sleep(800);
const subs = (f0) => ev(`__ev.filter(x => (x.n === 'subtitle:show') && x.ft >= ${f0}).map(x => x.e.id)`);
async function holdPush(untilExpr, maxWall = 300000) {
  await tp(11.3, 0.12, 10.5, -Math.PI / 2);
  await page.waitFor(`!document.querySelector('.hud-prompt')?.hidden`, 15000, 100);
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
  const a = await st();
  await page.keyDown('KeyE');
  const ok = await page.waitFor(untilExpr, maxWall, 100);
  await page.keyUp('KeyE');
  await sleep(300);
  const b = await st();
  return { prompt, ok, a, b, speed: +((Math.abs(b.raftPos[0] - a.raftPos[0])) / ((b.ft - a.ft) / 60)).toFixed(3) };
}


const promptRects = () => ev(`[...document.querySelectorAll('.hud-prompt')].map(e => { const r = e.getBoundingClientRect(); return { cls: e.className, hidden: e.hidden, text: e.textContent.trim(), r: [r.left, r.top, r.right, r.bottom].map(Math.round), fs: getComputedStyle(e).fontSize, op: getComputedStyle(e).opacity }; })`);
const ov = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
const T7 = 'b7';
await step(T7, 'S1 首次下载不含 S2 包（S2 只在进入可操作后后台预加载）', async () => {
  await sleep(12000);
  const r = await ev(`(() => { const R = /clifftop-s2|keeper-house|cellar|courtyard-wall-s2|laundry-rack/; const all = performance.getEntriesByType('resource').filter(e => /\\.(glb|ktx2|bin|woff2|js|wasm)/.test(e.name));
    const s2 = all.filter(e => R.test(e.name)); const first = all.filter(e => !R.test(e.name) && e.startTime < (window.__qaExplore ?? Infinity));
    return { exploreAt: Math.round(window.__qaExplore ?? -1), firstN: first.length, firstMB: +(first.reduce((s, e) => s + (e.encodedBodySize || e.transferSize || 0), 0) / 1048576).toFixed(2), firstEnd: Math.round(Math.max(...first.map(e => e.responseEnd))),
      s2n: s2.length, s2MB: +(s2.reduce((s, e) => s + (e.encodedBodySize || e.transferSize || 0), 0) / 1048576).toFixed(2), s2FirstStart: s2.length ? Math.round(Math.min(...s2.map(e => e.startTime))) : null, s2Group: __game.assets.isGroupLoaded?.('s2') ?? null }; })()`);
  rec(T7, 'S2 专属文件都在 S1 可操作之后才开始下载（首包不含 S2）', r.exploreAt > 0 && (r.s2FirstStart === null || r.s2FirstStart >= r.exploreAt - 1000) ? 'PASS' : 'FAIL', r);
});
await step(T7, 'ed61faf 美术节点 / 小船对齐', async () => {
  const r = await ev(`(() => { const out = {}; __s1.art.root.traverse(o => { if (/^(env-|prop-boat)/.test(o.name) && o.parent === __s1.art.root) { const p = o.getWorldPosition(o.position.clone()); out[o.name] = { p: [p.x, p.y, p.z].map(v => +v.toFixed(3)), ry: +o.rotation.y.toFixed(5) }; } }); const hull = __s1.physics.colliders?.find?.(c => /hull/.test(c.name ?? c.id ?? '')); const hw = __s1.greybox.root.getObjectByName('s1-boat-hull-wall'); return { nodes: out, hull: hw ? { p: hw.position.toArray().map(v => +v.toFixed(3)), visible: hw.visible } : null, level: __s1.puzzles.tide.level }; })()`);
  await tp(1.6, 2.42, -11.4, Math.PI / 2 + 0.25); await sleep(1500);
  await page.screenshot(`${SH}/ed61-boat-high.png`);
  rec(T7, '美术节点位置（与 layout.ts artNodes / boat 比对）', 'INFO', r);
});
await step(T7, 'BUG-010：没推浮台就涨落', async () => {
  await ringBell(); await waitTide('low');
  const s0 = await st();
  rec(T7, 'R 提示：浮台在原位不显示', s0.prompt2 === null ? 'PASS' : 'FAIL', { prompt2: s0.prompt2 });
  const f0 = (await st()).ft;
  await ringBell(); await waitTide('high'); await sleep(3500);
  const fl = await ev(`__ev.filter(x => x.n === 'float:state' && x.ft >= ${f0}).map(x => x.e.state)`);
  const sb = await subs(f0);
  rec(T7, 'BUG-010 回归：浮台没动 → 原地浮起、不说「它漂回去了。」', !fl.includes('drifting') && !sb.includes('ch1.s1.raft.drift_back') ? 'PASS' : 'FAIL', { floatStates: fl, subs: sb });
  await ringBell(); await waitTide('low');
});
await step(T7, 'ed61faf 低潮船体挡板', async () => {
  const b = { c: [5.508, -10.757], r: -1.70407 };
  const ax = [Math.sin(b.r), Math.cos(b.r)], pp = [Math.cos(b.r), -Math.sin(b.r)];
  const res = [];
  for (const [dir, lab] of [[pp, '横穿'], [[-pp[0], -pp[1]], '反向横穿'], [ax, '纵穿']]) {
    const s = [b.c[0] - dir[0] * 3, b.c[1] - dir[1] * 3], e = [b.c[0] + dir[0] * 3, b.c[1] + dir[1] * 3];
    await tp(s[0], 1.0, s[1], 0); await sleep(800);
    const a = await st();
    const f0 = a.ft;
    const w = await walk([e], { maxWall: 60000 });
    const sent = await ev(`__ev.some(x => x.n === 'subtitle:show' && x.e.id === 'ch1.common.tide_return' && x.ft >= ${f0})`);
    const f = (await st()).pos;
    const along = (f[0] - b.c[0]) * dir[0] + (f[2] - b.c[1]) * dir[1];
    res.push({ lab, start: a.pos, final: f, stuck: !!w.stuck, reached: w.reached, sentBack: sent, distAlongFromCenter: +along.toFixed(2) });
    if (lab === '横穿') await page.screenshot(`${SH}/ed61-hull-blocker.png`);
    if (sent) await sleep(2000);
  }
  rec(T7, '低潮时不能穿过小船', res.every(x => !x.reached && !x.sentBack) ? 'PASS' : 'FAIL', res);
  await tp(1.6, 2.42, -11.4, Math.PI / 2 + 0.25); await sleep(1500);
  await page.screenshot(`${SH}/ed61-boat-low.png`);
});
await step(T7, 'b5bbc8c「R 放回浮台」', async () => {
  const p = await holdPush(`__s1.puzzles.raftPush.pushT >= 0.3`);
  // 推完仍站在推位上
  await page.keyDown('KeyE'); await sleep(400); // 让「按住 E 推」与 R 同时出现
  const both = await promptRects();
  await page.screenshot(`${SH}/b5bb-two-prompts.png`);
  await page.keyUp('KeyE'); await sleep(400);
  const s1 = await st(); const rects = await promptRects();
  // 走远 > 3.5 m
  const w = await walk([[s1.raftPos[0] + 6, 10.5]], { maxWall: 60000 });
  const far = await st();
  const raftX = far.raftPos[0];
  // 远处按 R（规格：任意位置生效）
  await page.tap('KeyR'); await sleep(800);
  const afterFarR = await st();
  rec(T7, '推离原位、3.5 m 内显示「R 放回浮台」（第二行）', s1.prompt2 === 'R 放回浮台' ? 'PASS' : 'FAIL', { prompt: s1.prompt, prompt2: s1.prompt2, rects, raft: s1.raftPos, pos: s1.pos });
  const a = both.find(x => !x.cls.includes('prompt2')), b2 = both.find(x => x.cls.includes('prompt2'));
  rec(T7, '与「按住 E 推」同时显示时两行不重叠', a && b2 && !a.hidden && !b2.hidden && !ov(a.r, b2.r) ? 'PASS' : 'INFO', both);
  rec(T7, '离开 3.5 m 后隐藏', far.prompt2 === null ? 'PASS' : 'FAIL', { dist: +Math.hypot(far.pos[0] - raftX, far.pos[2] - 10.5).toFixed(2), prompt2: far.prompt2 });
  rec(T7, '远处按 R 也放回（规格：S1 任意位置生效）', Math.abs(afterFarR.raftPos[0] - 9.1) < 0.05 ? 'PASS' : 'FAIL', { raft: afterFarR.raftPos, prompt2: afterFarR.prompt2 });
  // 近处按 R → 提示立即消失
  await holdPush(`__s1.puzzles.raftPush.pushT >= 0.2`);
  const n1 = await st();
  await page.tap('KeyR'); await sleep(300);
  const n2 = await st();
  rec(T7, '近处按 R：浮台回原位、提示消失', n1.prompt2 === 'R 放回浮台' && n2.prompt2 === null && Math.abs(n2.raftPos[0] - 9.1) < 0.05 ? 'PASS' : 'FAIL', { before: { p2: n1.prompt2, raft: n1.raftPos }, after: { p2: n2.prompt2, raft: n2.raftPos } });
});
await step(T7, 'BUG-010：漂回独白只说一次', async () => {
  const res = [];
  for (let i = 0; i < 2; i++) {
    await holdPush(`__s1.puzzles.raftPush.pushT >= 0.2`);
    const f0 = (await st()).ft;
    await ringBell();
    await page.waitFor(`__s1.puzzles.tide.transitioning`, 10000, 30);
    const mid = await st();
    await waitTide('high'); await page.waitFor(`__s1.puzzles.raft.state !== 'drifting'`, 60000, 100); await sleep(3000);
    const fl = await ev(`__ev.filter(x => x.n === 'float:state' && x.ft >= ${f0}).map(x => x.e.state)`);
    res.push({ round: i + 1, floatStates: fl, subs: await subs(f0), prompt2DuringTransition: mid.prompt2, raft: (await st()).raftPos });
    await ringBell(); await waitTide('low');
  }
  rec(T7, '第一次漂回说、第二次不说', res[0].subs.includes('ch1.s1.raft.drift_back') && !res[1].subs.includes('ch1.s1.raft.drift_back') && res.every(r => r.floatStates.includes('drifting')) ? 'PASS' : 'FAIL', res);
});
await step(T7, '推进石槽 → 涨潮 → 跨越，看浮台上的提示', async () => {
  const p = await holdPush(`__s1.puzzles.raftPush.locked`);
  await sleep(300);
  const sLocked = await st();
  rec(T7, '锁在石槽（离开原位）时 3.5 m 内仍显示 R 提示', sLocked.prompt2 === 'R 放回浮台' ? 'PASS' : 'FAIL', { prompt2: sLocked.prompt2, pos: sLocked.pos, raft: sLocked.raftPos });
  await ringBell();
  await page.waitFor(`__s1.puzzles.tide.transitioning`, 10000, 30);
  await tp(0.9, 0.12, 10.5, -Math.PI / 2); await sleep(400);
  const tr = await st();
  await page.tap('KeyR'); await sleep(400);
  const tr2 = await st();
  rec(T7, '潮汐变化中：不显示 R 提示、R 无效', tr.tr && tr.prompt2 === null && Math.abs(tr2.raftPos[0] + 0.9) < 0.05 ? 'PASS' : 'FAIL', { tr: tr.tr, level: tr.level, prompt2: tr.prompt2, raftAfterR: tr2.raftPos });
  await waitTide('high'); await page.waitFor(`__s1.puzzles.raft.state === 'floating'`, 60000, 100); await sleep(800);
  await tp(-0.9, 1.87, 7.6, 0); await sleep(600);
  const hi = await st();
  rec(T7, '涨潮浮台浮起：不显示 R 提示', hi.prompt2 === null ? 'PASS' : 'FAIL', { prompt2: hi.prompt2, raft: hi.raftPos });
  // 第一次跨越
  await tp(-0.9, 1.87, 8.2, 0); await sleep(1000);
  const pre = await st();
  await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 5000, 30); await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50); await sleep(800);
  const land = await st();
  await page.screenshot(`${SH}/8f68-on-raft.png`);
  // 浮台上各处、两种朝向
  const spots = [];
  for (const [x, z, f] of [[-0.9, 9.45, 0], [-0.9, 9.45, Math.PI], [-0.9, 10.5, 0], [-0.9, 10.5, Math.PI], [-0.9, 11.5, 0], [-0.4, 9.6, Math.PI], [-1.4, 11.4, 0]]) {
    await tp(x, 1.87, z, f); await sleep(700);
    const s = await st();
    const cur = await ev(`__s1.interaction.current?.id ?? null`);
    spots.push({ at: [x, z, +f.toFixed(2)], prompt: s.prompt, current: cur, nearLink: await ev(`!!__s1.rig.controller.nearLink`) });
  }
  // 在落点（朝南）按 E：应跨回近岸，而不是查看石槽
  await tp(-0.9, 1.87, 9.45, Math.PI); await sleep(800);
  const f0 = (await st()).ft;
  await page.tap('KeyE');
  const went = await page.waitFor(`__s1.rig.controller.busy`, 5000, 30); await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50); await sleep(800);
  const back = await st();
  const inspected = (await subs(f0)).includes('ch1.s1.stone_slot.inspect');
  const linkSpots = spots.filter(s => s.nearLink);
  rec(T7, '8f68e36：站在浮台上（跨越点附近）提示「E 跨过去」而不是「E 查看」', pre.prompt === 'E 跨过去' && land.prompt === 'E 跨过去' && linkSpots.every(s => s.prompt === 'E 跨过去') && went && !inspected && back.pos[2] < 8.6 ? 'PASS' : 'FAIL', { preCross: pre.prompt, landing: { pos: land.pos, prompt: land.prompt }, spots, eOnLanding: { traversed: went, inspected, endPos: back.pos } });
  // 再跨两次到对岸
  await tp(-0.9, 1.87, 8.2, 0); await sleep(800); await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 5000, 30); await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  await tp(-0.9, 1.87, 11.5, 0); await sleep(800); await page.tap('KeyE');
  await page.waitFor(`__s1.rig.controller.busy`, 5000, 30); await page.waitFor(`!__s1.rig.controller.busy`, 60000, 50);
  await page.keyDown('KeyW'); await page.waitFor(`__s1.puzzles.p2Solved`, 10000, 50); await page.keyUp('KeyW');
  const s = await st();
  rec(T7, '谜题 2 解开', s.p2 ? 'PASS' : 'FAIL', { pos: s.pos, goal: s.goal });
});
await step(T7, 'b5bbc8c 解开后 R 永久失效、不显示', async () => {
  await ringBell(); await waitTide('low');
  await tp(1.4, 0.12, 10.5, -Math.PI / 2); await sleep(800);
  const a = await st();
  await page.screenshot(`${SH}/b5bb-after-p2-no-prompt.png`);
  await page.tap('KeyR'); await sleep(1000);
  const b = await st();
  rec(T7, '谜题 2 解开后：不显示 R 提示、按 R 浮台不动', a.p2 && a.prompt2 === null && Math.abs(b.raftPos[0] + 0.9) < 0.05 && b.locked ? 'PASS' : 'FAIL', { p2: a.p2, prompt: a.prompt, prompt2: a.prompt2, raftBefore: a.raftPos, raftAfter: b.raftPos, locked: b.locked });
  // 再涨落一次后仍失效
  await ringBell(); await waitTide('high'); await ringBell(); await waitTide('low');
  await tp(1.4, 0.12, 10.5, -Math.PI / 2); await sleep(800);
  const c = await st(); await page.tap('KeyR'); await sleep(800); const d = await st();
  rec(T7, '再涨落一轮后仍失效（永久）', c.prompt2 === null && Math.abs(d.raftPos[0] + 0.9) < 0.05 ? 'PASS' : 'FAIL', { prompt2: c.prompt2, raft: d.raftPos });
});
await step(T7, '包体：走进 S1 出口后才下载 S2 包', async () => {
  const before = await ev(`performance.getEntriesByType('resource').map(r => r.name).filter(n => /s2|keeper|cellar|courtyard|laundry/.test(n)).length`);
  await tp(-9.6, 5.25, 19.6, 0); await sleep(1000);
  const w = await walk([[-9.6, 21.3]], { maxWall: 60000 });
  const ok = await page.waitFor(`__game.scenes.current?.name === 's2-keeper-house' && !!window.__s2?.rig`, 240000, 300);
  await sleep(3000);
  const after = await ev(`(() => { const rs = performance.getEntriesByType('resource').filter(r => /\\.(glb|ktx2|bin)/.test(r.name)); const s2 = rs.filter(r => /s2|keeper|cellar|courtyard|laundry/.test(r.name)); return { s2n: s2.length, s2MB: +(s2.reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0) / 1048576).toFixed(2), names: s2.map(r => r.name.split('/').pop()) }; })()`);
  await page.screenshot(`${SH}/s2-entered-from-s1.png`);
  rec(T7, 'S1→S2：走进出口切到 S2（S2 包已在 S1 后台预加载）', ok && after.s2n > 0 ? 'PASS' : 'FAIL', { before, walk: w.reached, entered: ok, after });
});
console.log('STATE', JSON.stringify(await st()));
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
