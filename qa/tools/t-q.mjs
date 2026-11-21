import { REPO_ROOT } from './paths.mjs';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER, makeRecorder } from './common.mjs';
const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch2');
const T = 'v0.1-009';
const { rec, save } = makeRecorder('quality');
const dev = await startDev(5221);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
// 在 __game 被赋值的瞬间挂事件钩子（早于 MainScene.enter / benchmark.start）
await page.addInit(`(() => { let g; window.__qlog = []; window.__qFirst = null;
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
    window.__qFirst = { tier: v.quality.tier, settingsQuality: v.settings.get('quality'), detected: v.settings.get('qualityDetected') };
    const push = (type) => (e) => window.__qlog.push({ type, e: JSON.parse(JSON.stringify(e ?? null)), now: performance.now(), el: v.time.elapsed, scene: v.scenes.current?.name ?? null });
    v.events.on('quality:changed', push('changed')); v.events.on('quality:detected', push('detected')); v.events.on('scene:change', push('scene'));
  } }); })();`);
const url = (q = '') => dev.url + '/' + q;
const waitMain = () => page.waitFor(`window.__game?.scenes.current?.name === 'main' && __game.scenes.current.cameraFollow`, 90000);
const fresh = async (q) => { await page.goto(url(q)); await page.waitFor(`!!window.__game`, 60000); await ev(`localStorage.clear()`); await page.goto(url(q)); };
const S = `({ tier: __game.quality.tier, st: __game.benchmark.state, rounds: __game.benchmark.rounds, set: JSON.parse(localStorage.getItem('foglight.settings.v1') || 'null'), log: __qlog.filter(x => x.type !== 'scene').map(x => [x.type, x.e.previous ?? '', x.e.tier, x.e.source ?? '', +x.el.toFixed(2)]) })`;
const clickTier = async (label) => {
  const r = await ev(`(() => { const b = [...document.querySelectorAll('.pause-menu [data-role="quality"] button')].find(b => b.textContent === ${JSON.stringify(label)}); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.click(r.x, r.y);
};

// 1. 默认极致（无设置、无检测结果）
await fresh('');
await waitMain();
const first = await ev(`window.__qFirst`);
rec(T, '默认（无设置、无检测结果）档位为极致', first.tier === 'ultra' && first.settingsQuality === 'ultra' && first.detected === false ? 'PASS' : 'FAIL', `清空 localStorage 后启动：quality.tier=${first.tier}，设置 quality=${first.settingsQuality}，qualityDetected=${first.detected}`);

// 2. simulateFps=40：极致→高→标准，只降两档
await fresh('?simulateFps=40');
await waitMain();
const est = await ev(`(async () => { const cf = __game.scenes.current.cameraFollow; await __qa.until(() => cf.modeName === 'explore', 20000); return __game.time.elapsed; })()`);
await page.waitFor(`__game.benchmark.state === 'done'`, 90000);
await sleep(3000);
const r2 = await ev(S);
const seq = r2.log.filter((l) => l[0] === 'changed').map((l) => l[2]);
const det = r2.log.find((l) => l[0] === 'detected');
rec(T, 'simulateFps=40：极致 → 高 → 标准，不再往下降', JSON.stringify(seq) === '["ultra","high","standard"]' || JSON.stringify(seq) === '["high","standard"]' ? (r2.tier === 'standard' && r2.rounds.length === 3 ? 'PASS' : 'FAIL') : 'FAIL',
  `quality:changed 依次 ${JSON.stringify(r2.log)}；rounds=${JSON.stringify(r2.rounds)}；最终 ${r2.tier}；设置 qualityDetected=${r2.set.qualityDetected} qualityDetectedTier=${r2.set.qualityDetectedTier} qualitySource=${r2.set.qualitySource} quality=${r2.set.quality}`);
rec(T, '检测完成时机（参考）', 'INFO', `建立镜头在游戏时间 ${est.toFixed(2)} s 交还；检测完成（quality:detected）在 ${det?.[4]} s。三轮各 3 s（加每轮 5 帧热身），所以连降两档要 3 轮约 9 s+，会超过 3 s 建立镜头`);
await ev(`__game.pause('user')`); await sleep(800);
const note = await ev(`({ note: document.querySelector('.pause-menu [data-role="quality-note"]')?.hidden === false ? document.querySelector('.pause-menu [data-role="quality-note"]').textContent : null, foot: document.querySelector('.pause-menu .menu-foot')?.textContent, active: document.querySelector('.pause-menu .seg-btn.active')?.textContent })`);
await page.screenshot(`${SH}/009-auto-note-pause-menu.png`);
rec(T, '降过档：画质项下显示 ui.settings.quality_auto_note', note.note ? 'PASS' : 'FAIL', `提示「${note.note}」；底栏「${note.foot}」；当前高亮 ${note.active}`);
await ev(`__game.resume()`);

// 3. 刷新后不再检测
await page.goto(url('?simulateFps=40'));
await waitMain(); await sleep(12000);
const r3 = await ev(S);
rec(T, '检测后刷新不再检测', r3.st === 'idle' && r3.log.length === 0 && r3.tier === 'standard' ? 'PASS' : 'FAIL', `刷新后 12 s：benchmark.state=${r3.st}，quality 事件 ${r3.log.length} 条，档位 ${r3.tier}`);

// 4. 手动改回极致（真实点击暂停菜单按钮），刷新保留、不被自动改
await ev(`__game.pause('user')`); await sleep(600);
await clickTier('极致'); await sleep(800);
const r4a = await ev(S);
await ev(`__game.resume()`);
await page.goto(url('?simulateFps=40'));
await waitMain(); await sleep(12000);
const r4b = await ev(S);
rec(T, '手动改回极致后生效并保存，之后不被自动改动', r4a.tier === 'ultra' && r4a.set.quality === 'ultra' && r4a.set.qualitySource === 'user' && r4b.tier === 'ultra' && r4b.st === 'idle' && r4b.log.length === 0 ? 'PASS' : 'FAIL',
  `点「极致」后：tier=${r4a.tier}，设置 quality=${r4a.set.quality} source=${r4a.set.qualitySource}；刷新 12 s 后：tier=${r4b.tier}，benchmark=${r4b.st}，quality 事件 ${r4b.log.length} 条`);

// 5. 运行时切档：不重载场景
await ev(`window.__qaMarker = 42; window.__qaScene = __game.scenes.current; __qlog.length = 0;`);
await page.tap('F3'); await sleep(800);
const sw = [];
for (const [tier, label] of [['high', '高'], ['standard', '标准'], ['ultra', '极致']]) {
  await ev(`__game.pause('user')`); await sleep(400);
  await clickTier(label); await sleep(300);
  await ev(`__game.resume()`); await sleep(2500);
  const s = await ev(`(() => { const sc = __game.scenes.current; return { tier: __game.quality.tier, marker: window.__qaMarker, same: sc === window.__qaScene, frame: __game.time.frame,
    pr: __game.renderer.getPixelRatio(), shadow: sc.sun.shadow.mapSize.width, rain: sc.rain.geometry.drawRange.count / 2, far: sc.camera.far,
    f3: document.querySelector('.fps-counter, [class*=fps]')?.innerText ?? null }; })()`);
  await page.screenshot(`${SH}/009-f3-${tier}.png`);
  sw.push(s);
}
const sceneEv = await ev(`__qlog.filter(x => x.type === 'scene').length`);
const exp = { ultra: { shadow: 4096, rain: 30000, far: 600, dc: 2000, tri: '6.00M' }, high: { shadow: 2048, rain: 15000, far: 400, dc: 1200, tri: '3.50M' }, standard: { shadow: 2048, rain: 6000, far: 250, dc: 600, tri: '1.50M' } };
const swOk = sw.every((s) => s.marker === 42 && s.same && s.shadow === exp[s.tier].shadow && s.rain === exp[s.tier].rain && s.far === exp[s.tier].far) && sceneEv === 0;
rec(T, '运行时切换三档不重载场景，资源按档位重建', swOk ? 'PASS' : 'FAIL',
  sw.map((s) => `${s.tier}：页面标记保留=${s.marker === 42}、同一场景对象=${s.same}、像素比 ${s.pr}、阴影贴图 ${s.shadow}、雨 ${s.rain}、视距 ${s.far}`).join('；') + `；期间 scene:change ${sceneEv} 次`);
const f3Ok = sw.every((s) => s.f3 && /FPS/.test(s.f3) && /ms/.test(s.f3) && s.f3.includes(`draw call`) && s.f3.includes(`/ ${exp[s.tier].dc}`) && s.f3.includes(`/ ${exp[s.tier].tri}`) && /三角面/.test(s.f3));
rec(T, 'F3 性能面板：FPS、帧时间、draw call、三角面（预算对照 §8）', f3Ok ? 'PASS' : 'FAIL', sw.map((s) => `${s.tier}：「${(s.f3 || '无').replace(/\n/g, ' | ')}」`).join('；'));
const prOk = sw.find((s) => s.tier === 'standard')?.pr;
rec(T, 'renderScale 生效（补充）', Math.abs(prOk - 0.8) < 1e-6 ? 'PASS' : 'FAIL', `devicePixelRatio=1 时：标准档像素比 ${prOk}（期望 min(1,1.0)×0.8=0.8），高/极致 ${sw.filter((s) => s.tier !== 'standard').map((s) => s.pr).join('/')}`);
await page.tap('F3');

// 6. 恢复默认 → 回到检测结果，不重新检测
await ev(`__qlog.length = 0; __game.settings.resetToDefaults()`); await sleep(2000);
const r6 = await ev(S);
rec(T, '「恢复默认」不重新检测，画质回到检测结果', r6.tier === 'standard' && r6.set.qualitySource === 'auto' && r6.set.qualityDetected === true && r6.st === 'idle' ? 'PASS' : 'FAIL', `恢复默认后 tier=${r6.tier}，source=${r6.set.qualitySource}，benchmark=${r6.st}，事件 ${JSON.stringify(r6.log)}`);

// 7. 检测中玩家手动改档 → 停止，以玩家为准
await fresh('?simulateFps=40');
await waitMain();
await page.waitFor(`__game.benchmark.state === 'running'`, 20000);
await ev(`__game.pause('user')`); await sleep(500);
await clickTier('高'); await sleep(500);
await ev(`__game.resume()`); await sleep(12000);
const r7 = await ev(S);
await page.goto(url('?simulateFps=40')); await waitMain(); await sleep(8000);
const r7b = await ev(S);
rec(T, '检测中手动改档：立即停止，以玩家为准（补充）', r7.st === 'aborted' && r7.tier === 'high' && r7.set.qualityDetected === true && r7b.tier === 'high' && r7b.st === 'idle' ? 'PASS' : 'FAIL',
  `state=${r7.st}，tier=${r7.tier}，设置 detected=${r7.set.qualityDetected} source=${r7.set.qualitySource}；刷新后 tier=${r7b.tier} benchmark=${r7b.st}`);

// 8. 检测前已手动选过 → 跳过
await page.goto(url('')); await page.waitFor(`!!window.__game`, 60000);
await ev(`localStorage.clear(); localStorage.setItem('foglight.settings.v1', JSON.stringify({ quality: 'high', qualitySource: 'user', qualityDetected: false }))`);
await page.goto(url('?simulateFps=40')); await waitMain(); await sleep(8000);
const r8 = await ev(S);
rec(T, '检测前已手动选档：跳过检测（补充）', r8.st === 'skipped' && r8.tier === 'high' && r8.log.length === 0 ? 'PASS' : 'FAIL', `state=${r8.st}，tier=${r8.tier}，事件 ${r8.log.length} 条，detected=${r8.set.qualityDetected}`);

// 9. URL ?quality= 覆盖不检测、不写盘
await fresh('?quality=high&simulateFps=40');
await waitMain(); await sleep(8000);
const r9 = await ev(S);
rec(T, 'URL ?quality= 临时覆盖：不检测、不写设置（补充）', r9.st === 'idle' && r9.tier === 'high' && (r9.set === null || r9.set.qualityDetected === false) ? 'PASS' : 'FAIL', `state=${r9.st}，tier=${r9.tier}，设置=${JSON.stringify(r9.set)}`);

save();
console.log('ERRORS', page.errors.length, page.errors.slice(0, 5));
close(); await dev.close(); process.exit(0);
