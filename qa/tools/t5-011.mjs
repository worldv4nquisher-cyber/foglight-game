import { open, sleep, SH } from './b5lib.mjs';
const T = 'v0.1-011';
const P = await open(5256);
const { page, ev, must, url, rec, step } = P;
await page.addInit(`(() => { let g; window.__ev = [];
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    for (const n of ['tide:changing','tide:changed','tide:bell','tide:recall','float:state','interact:used','subtitle:show','sfx:play'])
      v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, now: performance.now() }));
  } }); })();`);
await page.goto(url('?smoke=1')); await must('!!window.__game'); await ev('localStorage.clear()');
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed?.tideArea && __game.input.context === 'explore'`, 180000, 'testbed');
await sleep(1000); await page.click(640, 400); await sleep(500);
const A = `__testbed.tideArea`;
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 300000, 'wait ' + s); };
const tp = (x, y, z, face) => ev(`(() => { const tb = __testbed; tb.interaction.cancel?.(); tb.rig.body.teleport(new tb.rig.body.position.constructor(${x}, ${y}, ${z})); ${face !== undefined ? `tb.rig.controller.facing = ${face};` : ''} return 1; })()`);
const pos = () => ev(`(() => { const p = __testbed.rig.body.position; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; })()`);
const tide = () => ev(`(() => { const t = ${A}.tide; return { state: t.state, level: +t.level.toFixed(3), tr: t.transitioning, rings: ${A}.bell.rings, gate: ${A}.reefGate.enabled, deep: ${A}.deepWalls.map(w => w.enabled), u: +(${'__testbed.tides.primary'} ? 0 : 0), raft: ${A}.raft.state, raftPos: ${A}.raft.object.position.toArray().map(v => +v.toFixed(2)), inAnchor: ${A}.raft.inAnchor, pushEnabled: ${A}.raftPush.enabled }; })()`);
const f4 = () => ev(`(() => { const e = document.querySelector('.debug-panel, [class*=debug]'); return e ? e.innerText.split('\\n').filter(l => /潮汐/.test(l)).join(' / ') : null; })()`);
const walk = async (yaw, sec) => { await ev(`__testbed.cameraFollow.yaw = ${yaw}; 1`); await sleep(300); await page.keyDown('KeyW'); await waitSec(sec); await page.keyUp('KeyW'); await waitSec(0.3); };
const ringOnce = async () => { const t = await ft(); await page.tap('KeyY'); await must(`__ev.some(x => x.n === 'tide:changing' && x.ft >= ${t})`, 60000, 'changing'); };
const waitSettled = () => must(`!${A}.tide.transitioning`, 300000, 'settled');

await step(T, '初始状态 + F4 潮汐行', async () => {
  await page.tap('F4'); await sleep(800);
  const s = await tide(); const l = await f4();
  rec(T, '初始状态 + F4 潮汐行', s.state === 'high' && Math.abs(s.level - 1.6) < 1e-3 && /潮汐/.test(l ?? '') ? 'PASS' : 'FAIL', `${JSON.stringify(s)}；F4「${l}」`);
});

await step(T, '涨潮时礁石路入口被挡', async () => {
  await tp(0, 2.02, 23, Math.PI * 0); await walk(Math.PI, 3);
  const p = await pos(); const s = await tide();
  await page.screenshot(`${SH}/011-high-reef-blocked.png`);
  rec(T, '涨潮时礁石路入口被挡（walkableWhen=low 空气墙）', p[2] < 24 && s.gate ? 'PASS' : 'FAIL', `从岸台 (0,2,23) 朝南走 3 s（游戏时间）→ 位置 ${p}；入口墙 enabled=${s.gate}`);
});

await step(T, '敲钟（真实 E）：6 s 平滑落潮、过渡中提示变灰且 E 无效', async () => {
  await tp(-4, 2.02, 22.45, Math.PI); await sleep(500);
  await must(`__testbed.interaction.current?.id === 'tide-bell'`, 30000, 'bell candidate');
  const prompt0 = await ev(`document.querySelector('.hud-prompt').textContent`);
  const samp = ev(`__qa.sample(() => [__game.time.fixedTick, +__testbed.tideArea.tide.level.toFixed(4), __testbed.tideArea.tide.transitioning, document.querySelector('.hud-prompt').classList.contains('is-disabled'), document.querySelector('.hud-prompt').hidden], 26000)`);
  const t0 = await ft(); await page.tap('KeyE');
  await must(`__ev.some(x => x.n === 'tide:changing' && x.ft >= ${t0})`, 60000, 'changing');
  await sleep(1200);
  const mid = await tide(); const midDis = await ev(`document.querySelector('.hud-prompt').classList.contains('is-disabled')`);
  await page.screenshot(`${SH}/011-bell-prompt-disabled.png`);
  await page.tap('KeyE'); await sleep(1500); const mid2 = await tide();
  await waitSettled(); await sleep(500); const end = await tide();
  const s = await samp;
  const evs = await ev(`__ev.filter(x => x.ft >= ${t0} && /tide|sfx/.test(x.n)).map(x => [x.n, JSON.stringify(x.e), x.ft])`);
  const ch = evs.find((x) => x[0] === 'tide:changing'), cd = evs.find((x) => x[0] === 'tide:changed');
  const durS = ch && cd ? (cd[2] - ch[2]) / 60 : null;
  // 平滑：采样点按 smoothstep 对比
  const tr = s.filter((x) => x[2]); let maxErr = 0, mono = true;
  for (let i = 0; i < tr.length; i++) { const u = Math.min(1, (tr[i][0] - ch[2]) / 360); const exp = 1.6 - 1.6 * u * u * (3 - 2 * u); maxErr = Math.max(maxErr, Math.abs(exp - tr[i][1])); if (i && tr[i][1] > tr[i - 1][1] + 1e-6) mono = false; }
  const disFrac = tr.filter((x) => x[3] && !x[4]).length + '/' + tr.filter((x) => !x[4]).length;
  rec(T, '敲钟（真实 E）：6 s 平滑落潮、过渡中提示变灰且 E 无效', durS !== null && Math.abs(durS - 6) < 0.1 && mono && maxErr < 0.05 && end.state === 'low' && Math.abs(end.level) < 1e-3 && midDis && mid2.rings === mid.rings && mid2.state === 'low' ? 'PASS' : 'FAIL',
    `提示「${prompt0}」；tide:changing→changed 固定步长 ${durS?.toFixed(2)} s；过渡中采样 ${tr.length} 点，单调=${mono}，与 smoothstep 最大偏差 ${maxErr.toFixed(4)} m；过渡中提示灰色帧 ${disFrac}；过渡中按 E 后 rings ${mid.rings}→${mid2.rings}、state ${mid2.state}（level ${mid.level}→${mid2.level}）；结束 ${JSON.stringify({ state: end.state, level: end.level, gate: end.gate, deep: end.deep })}；事件 ${JSON.stringify(evs.map((x) => x[0]))}`);
});

await step(T, '退潮后走礁石路', async () => {
  await tp(0, 2.02, 23); await walk(Math.PI, 5);
  const p = await pos(); await page.screenshot(`${SH}/011-low-reef-walk.png`);
  rec(T, '退潮后礁石路可走', p[2] > 25 ? 'PASS' : 'FAIL', `从岸台朝南走 5 s → 位置 ${p}；入口墙 enabled=${(await tide()).gate}`);
});

await step(T, '站在礁石路上涨潮 → 黑场送回 + 字幕', async () => {
  await tp(0, 0.12, 32); await waitSec(1);
  const p0 = await pos(); const t0 = await ft();
  const samp = ev(`__qa.sample(() => [__game.time.fixedTick, +__testbed.tideArea.tide.level.toFixed(3), +__game.ui.fade.opacity.toFixed(2), document.querySelector('.subtitle-line')?.textContent ?? ''], 20000)`);
  await page.tap('KeyY');
  await must(`__ev.some(x => x.n === 'tide:recall' && x.ft >= ${t0})`, 120000, 'recall');
  const r = await ev(`__ev.find(x => x.n === 'tide:recall' && x.ft >= ${t0})`);
  const lvAt = await ev(`__testbed.tideArea.tide.level`);
  await sleep(800); await page.screenshot(`${SH}/011-recall-fade.png`);
  await must(`!__testbed.rig.controller.busy && __game.ui.fade.opacity === 0`, 120000, 'recall done');
  const p1 = await pos(); const sub = await ev(`document.querySelector('.subtitle-line')?.textContent`);
  await page.screenshot(`${SH}/011-recall-subtitle.png`);
  const s = await samp; const maxFade = Math.max(...s.map((x) => x[2])); const subs = [...new Set(s.map((x) => x[3]).filter(Boolean))];
  rec(T, '站在礁石路上涨潮 → 黑场送回 + 字幕', maxFade >= 0.99 && Math.abs(p1[0]) < 0.3 && Math.abs(p1[2] - 22) < 0.3 && (subs.includes('水太冷了。') || sub === '水太冷了。') ? 'PASS' : 'FAIL',
    `站位 ${p0}（脚底 y≈0.1）；tide:recall 时水位约 ${lvAt.toFixed(2)} m（阈值 0.1+0.3=0.4，读取有 1 帧延迟）；黑场最大不透明度 ${maxFade}；送回后位置 ${p1}（安全点 0,2,22）；字幕 ${JSON.stringify(subs)} / 当前「${sub}」`);
  await waitSettled();
});

await step(T, '浮物：不在锚位涨潮 → 2 s 漂回', async () => {
  // 先落潮
  if ((await tide()).state !== 'low') { await ringOnce(); await waitSettled(); }
  const s0 = await tide();
  await tp(5, 0.12, 29.45, Math.PI); await waitSec(0.5);
  const cand = await ev(`__testbed.interaction.current?.id ?? null`);
  const prompt = await ev(`document.querySelector('.hud-prompt').hidden ? null : document.querySelector('.hud-prompt').textContent`);
  await page.keyDown('KeyE'); await waitSec(2.2); await page.keyUp('KeyE'); await waitSec(0.5);
  const s1 = await tide();
  await tp(0, 2.02, 22); await waitSec(0.3);
  const t0 = await ft(); await page.tap('KeyY');
  await must(`__ev.some(x => x.n === 'float:state' && x.e.state === 'drifting' && x.ft >= ${t0})`, 60000, 'drifting');
  const d0 = await ev(`__ev.find(x => x.n === 'float:state' && x.e.state === 'drifting' && x.ft >= ${t0}).ft`);
  await must(`__ev.some(x => x.n === 'float:state' && x.e.state !== 'drifting' && x.ft > ${d0})`, 60000, 'drift end');
  const d1 = await ev(`__ev.find(x => x.n === 'float:state' && x.e.state !== 'drifting' && x.ft > ${d0})`);
  await waitSettled(); const s2 = await tide();
  await page.screenshot(`${SH}/011-raft-drift-home.png`);
  rec(T, '浮物：搁浅时可推；不在锚位涨潮 → 2 s 漂回原位', cand === 'tide-raft' && s0.pushEnabled && s1.raftPos[2] < 28.3 && Math.abs((d1.ft - d0) / 60 - 2) < 0.1 && Math.abs(s2.raftPos[0] - 5) < 0.02 && Math.abs(s2.raftPos[2] - 28.5) < 0.02 && !s2.pushEnabled ? 'PASS' : 'FAIL',
    `退潮搁浅 ${JSON.stringify({ raft: s0.raft, pos: s0.raftPos, push: s0.pushEnabled })}，候选 ${cand} 提示「${prompt}」；按住 E 2.2 s 推到 ${s1.raftPos}；涨潮 → drifting 持续 ${((d1.ft - d0) / 60).toFixed(2)} s（固定步长）→ ${d1.e.state}；涨潮后 ${JSON.stringify({ raft: s2.raft, pos: s2.raftPos, push: s2.pushEnabled })}`);
});

await step(T, '浮物：推进锚位，涨潮浮起与岸台齐平，可站上去随之升降', async () => {
  await ringOnce(); await waitSettled();
  await tp(5, 0.12, 29.45, Math.PI); await waitSec(0.5);
  await page.keyDown('KeyE'); await waitSec(6.5); await page.keyUp('KeyE'); await waitSec(0.5);
  const s1 = await tide();
  await tp(5, 2.02, 23.2); await waitSec(0.3);
  await ringOnce(); await waitSettled(); await waitSec(0.5);
  const s2 = await tide(); const deckTop = 2.0; const raftTop = s2.raftPos[1] + 0.25;
  await page.screenshot(`${SH}/011-raft-afloat-anchor.png`);
  await walk(Math.PI, 1.0);
  const p = await pos();
  // 站上去后落潮，采样相对高度
  const samp = ev(`__qa.sample(() => [__game.time.fixedTick, +(__testbed.rig.body.position.y - (__testbed.tideArea.raft.object.position.y + 0.25)).toFixed(3), +__testbed.rig.body.position.y.toFixed(3), __testbed.rig.body.body.onGround], 24000)`);
  await ringOnce(); await waitSettled(); await waitSec(0.5);
  const s = await samp; const p2 = await pos(); const s3 = await tide();
  const rel = s.map((x) => x[1]); const span = Math.max(...rel) - Math.min(...rel); const airborne = s.filter((x) => !x[3]).length;
  await page.screenshot(`${SH}/011-raft-ride-down.png`);
  const rec2 = await ev(`__ev.filter(x => x.n === 'tide:recall').length`);
  rec(T, '浮物：推进锚位，涨潮浮起与岸台齐平，可站上去随之升降', s1.inAnchor && s2.raft === 'floating' && Math.abs(raftTop - deckTop) < 0.05 && Math.abs(p[1] - raftTop) < 0.08 && Math.abs(p2[1] - (s3.raftPos[1] + 0.25)) < 0.08 && span < 0.1 ? 'PASS' : 'FAIL',
    `推到 ${s1.raftPos}（inAnchor=${s1.inAnchor}）；涨潮后 ${s2.raft}，浮台顶 ${raftTop.toFixed(2)} m（岸台 2.0）；走上去后位置 ${p}；落潮过程采样 ${s.length} 点：脚底 - 浮台顶 相对高度范围 ${Math.min(...rel)}…${Math.max(...rel)}（跨度 ${span.toFixed(3)} m），离地帧 ${airborne}；落潮后人 ${p2}、浮台 ${s3.raftPos} ${s3.raft}；累计送回 ${rec2} 次`);
});

await step(T, '浮起时不能推 + uTideLevel', async () => {
  await tp(5, 2.02, 23.2); await ringOnce(); await waitSettled(); await waitSec(0.3);
  const s = await tide();
  const u = await ev(`(() => { const sh = __testbed.tideArea.gauge.material.userData.tideShader; return sh ? +sh.uniforms.uTideLevel.value.toFixed(3) : null; })()`);
  await tp(-2.5, 2.02, 23.4, 0); await waitSec(0.5); await page.screenshot(`${SH}/011-gauge-wetline-high.png`);
  rec(T, '浮起时不能推；uTideLevel 在材质里可读', s.raft === 'floating' && !s.pushEnabled && u !== null && Math.abs(u - s.level) < 1e-3 ? 'PASS' : 'FAIL', `浮起 ${s.raft} push.enabled=${s.pushEnabled}；刻度柱着色器 uTideLevel=${u}，tide.level=${s.level}（湿痕线是白盒材质，不判断效果）`);
});

P.save('b5-011'); console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
