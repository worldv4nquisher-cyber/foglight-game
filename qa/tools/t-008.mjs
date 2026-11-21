import { open, sleep, SH } from './b3lib.mjs';
const T = 'v0.1-008';
const P = await open(5231);
const { page, ev, must, clickSel, visible, url, rec, step } = P;
const S = () => ev(`({ save: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null'), set: JSON.parse(localStorage.getItem('foglight.settings.v1') || 'null'), scene: __game.scenes.current?.name, paused: __game.paused })`);
const waitMenu = () => must(`window.__game?.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 90000, '主菜单');
const waitMain = () => must(`window.__game?.scenes.current?.name === 'main' && !!__game.scenes.current.rig`, 120000, '主场景');
const pos = () => ev(`(() => { const p = __game.scenes.current.rig.entity.object3D.position; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; })()`);

await page.goto(url('?smoke=1'));
await must(`!!window.__game`);
await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1'));

await step(T, '无存档时主菜单没有「继续」', async () => {
  await waitMenu(); await sleep(1500);
  const r = await ev(`({ cont: document.querySelector('.main-menu [data-act="continue"]').hidden, btns: [...document.querySelectorAll('.main-menu .main-buttons button')].filter(b => !b.hidden).map(b => b.textContent), title: document.querySelector('.main-title').textContent, ver: document.querySelector('.main-version').textContent, lock: !!document.pointerLockElement, ctx: __game.input.context })`);
  await page.screenshot(`${SH}/008-menu-empty.png`);
  rec(T, '无存档时主菜单没有「继续」', r.cont && !r.btns.includes('继续') ? 'PASS' : 'FAIL', `可见按钮 ${JSON.stringify(r.btns)}；标题「${r.title}」；版本「${r.ver}」；指针锁定=${r.lock}；输入上下文=${r.ctx}`);
});

await step(T, '设置：修改即时生效、刷新后保留', async () => {
  await clickSel('.main-menu [data-act="settings"]'); await sleep(800);
  const labels = await ev(`[...document.querySelectorAll('.settings-panel .menu-row > span:first-child')].map(s => s.textContent).concat([...document.querySelectorAll('.settings-panel .settings-actions button')].filter(b => !b.hidden).map(b => '[' + b.textContent + ']'))`);
  await clickSel('.settings-panel [data-tier="high"]'); await sleep(600);
  await clickSel('.settings-panel [data-act="invert"]');
  await clickSel('.settings-panel [data-act="recenter"]');
  await clickSel('.settings-panel [data-size="l"]');
  // 灵敏度滑条：真实点击滑条 80% 位置
  const r = await P.rect('.settings-panel [data-act="sens"]');
  await page.click(r.x - r.w / 2 + r.w * 0.8, r.y);
  const rv = await P.rect('.settings-panel [data-act="vol-music"]');
  await page.click(rv.x - rv.w / 2 + rv.w * 0.25, rv.y);
  await sleep(800);
  const now = await ev(`({ tier: __game.quality.tier, sens: __game.settings.get('mouseSensitivity'), inv: __game.settings.get('invertY'), rec: __game.settings.get('autoRecenter'), sub: __game.settings.get('subtitleSize'), music: __game.settings.get('musicVolume'),
    subPx: getComputedStyle(document.querySelector('.subtitles, .subtitle, [class*=subtitle]') || document.body).fontSize, status: document.querySelector('.settings-panel [data-role="quality-status"]').textContent,
    vals: [...document.querySelectorAll('.settings-panel .menu-range-value')].map(e => e.textContent) })`);
  await page.screenshot(`${SH}/008-settings-changed.png`);
  await page.goto(url('?smoke=1')); await waitMenu(); await sleep(1000);
  await clickSel('.main-menu [data-act="settings"]'); await sleep(800);
  const after = await ev(`({ tier: __game.quality.tier, active: [...document.querySelectorAll('.settings-panel .seg-btn.active')].map(b => b.textContent), set: JSON.parse(localStorage.getItem('foglight.settings.v1')), vals: [...document.querySelectorAll('.settings-panel .menu-range-value')].map(e => e.textContent), toggles: [...document.querySelectorAll('.settings-panel .menu-row button.small')].map(b => b.textContent) })`);
  const ok = now.tier === 'high' && now.inv && now.rec && now.sub === 'l' && now.sens !== 1 && after.tier === 'high' && after.set.invertY && after.set.autoRecenter && after.set.subtitleSize === 'l' && after.set.mouseSensitivity === now.sens && after.set.musicVolume === now.music;
  rec(T, '设置：修改即时生效、刷新后保留', ok ? 'PASS' : 'FAIL', `设置项 ${JSON.stringify(labels)}；改后运行时 tier=${now.tier} 灵敏度=${now.sens} Y反转=${now.inv} 自动回正=${now.rec} 字幕=${now.sub} 音乐=${now.music}，状态行「${now.status}」；刷新后 tier=${after.tier}，高亮 ${JSON.stringify(after.active)}，滑条 ${JSON.stringify(after.vals)}，开关 ${JSON.stringify(after.toggles)}`);
  const bad = labels.filter((l) => /寻路|点击移动|分辨率|缩放|按键/.test(l));
  rec(T, '菜单中不存在点击寻路、分辨率缩放选项', bad.length === 0 ? 'PASS' : 'FAIL', `设置界面全部条目：${labels.join(' / ')}`);
});

await step(T, '「恢复默认」（未检测 → 极致，灵敏度 1.0）', async () => {
  await clickSel('.settings-panel [data-act="reset"]'); await sleep(800);
  const r = await ev(`({ tier: __game.quality.tier, set: JSON.parse(localStorage.getItem('foglight.settings.v1')), status: document.querySelector('.settings-panel [data-role="quality-status"]').textContent, vals: [...document.querySelectorAll('.settings-panel .menu-range-value')].map(e => e.textContent) })`);
  const s = r.set;
  rec(T, '「恢复默认」（未检测 → 极致，灵敏度 1.0）', r.tier === 'ultra' && s.mouseSensitivity === 1 && !s.invertY && !s.autoRecenter && s.subtitleSize === 'm' && s.musicVolume === 80 ? 'PASS' : 'FAIL',
    `tier=${r.tier}，quality=${s.quality} source=${s.qualitySource} detectedTier=${s.qualityDetectedTier}，灵敏度=${s.mouseSensitivity}，Y反转=${s.invertY}，自动回正=${s.autoRecenter}，字幕=${s.subtitleSize}，音量 ${s.masterVolume}/${s.musicVolume}/${s.sfxVolume}；状态行「${r.status}」；滑条显示 ${JSON.stringify(r.vals)}`);
  await clickSel('.settings-panel [data-act="back"]'); await sleep(500);
  await clickSel('.main-menu [data-act="credits"]'); await sleep(800);
  const cr = await ev(`(() => { const e = document.querySelector('.main-menu .credits, .credits'); return e ? e.innerText.slice(0, 200) : null; })()`);
  await page.screenshot(`${SH}/008-credits.png`);
  await page.tap('Escape'); await sleep(800);
  const home = await ev(`__game.ui.mainMenu.view`);
  rec(T, '制作名单打开 / Esc 返回首页', cr && cr.includes('谢谢你来过这座岛') && home === 'home' ? 'PASS' : 'FAIL', `制作名单文字「${(cr || '').replace(/\n+/g, ' | ')}」；Esc 后 view=${home}`);
});

let spawn;
await step(T, '新游戏 → 暂停 → 回到主菜单（先取消再确认）', async () => {
  await clickSel('.main-menu [data-act="new"]');
  await waitMain(); await sleep(6000);
  spawn = await pos();
  await page.keyDown('KeyW'); await sleep(4000); await page.keyUp('KeyW'); await sleep(500);
  const moved = await pos();
  const bm = await ev(`__game.benchmark.state`);
  await page.tap('Escape'); await sleep(1200);
  const pm = await ev(`({ open: __game.ui.pause.isOpen, paused: __game.paused, btns: [...document.querySelectorAll('.pause-menu .pause-panel button')].map(b => b.textContent), blur: getComputedStyle(document.querySelector('.pause-menu')).backdropFilter, bg: getComputedStyle(document.querySelector('.pause-menu')).backgroundColor, lock: !!document.pointerLockElement })`);
  await page.screenshot(`${SH}/008-pause.png`);
  await clickSel('.pause-menu [data-act="to-menu"]'); await sleep(800);
  const cf = await ev(`({ view: __game.ui.pause.view, title: document.querySelector('.confirm-title').textContent, body: document.querySelector('.confirm-body').textContent })`);
  await page.screenshot(`${SH}/008-pause-to-menu-confirm.png`);
  await clickSel('.confirm-dialog [data-act="cancel"]'); await sleep(800);
  const afterCancel = await ev(`({ view: __game.ui.pause.view, open: __game.ui.pause.isOpen, scene: __game.scenes.current.name, paused: __game.paused })`);
  await clickSel('.pause-menu [data-act="to-menu"]'); await sleep(800);
  await clickSel('.confirm-dialog [data-act="confirm"]');
  await waitMenu(); await sleep(1500);
  const m = await ev(`({ cont: !document.querySelector('.main-menu [data-act="continue"]').hidden, primary: document.querySelector('.main-menu .primary:not([hidden])')?.textContent, bm: __game.benchmark.state, set: JSON.parse(localStorage.getItem('foglight.settings.v1')), tier: __game.quality.tier })`);
  await page.screenshot(`${SH}/008-menu-with-save.png`);
  const ok = pm.open && cf.body === '将回到最近的场景开头。' && afterCancel.open && afterCancel.view === 'main' && afterCancel.scene === 'main' && m.cont;
  rec(T, '新游戏 → Esc 暂停 → 回到主菜单（取消 / 确认）', ok ? 'PASS' : 'FAIL',
    `出生点 ${spawn}，按 W 4 s 后 ${moved}；暂停：open=${pm.open} paused=${pm.paused} 按钮 ${JSON.stringify(pm.btns)} backdrop-filter=${pm.blur} 底色=${pm.bg} 指针锁定=${pm.lock}；确认框「${cf.title} / ${cf.body}」；取消后 view=${afterCancel.view} 场景=${afterCancel.scene} 仍暂停=${afterCancel.paused}；确认后回主菜单，「继续」可见=${m.cont}，主按钮=${m.primary}`);
  rec('BUG-002', '检测未完成就离开 S1：整次作废（回到主菜单路径）', bm === 'running' ? (m.set.qualityDetected === false && m.set.qualityDetectedTier == null && m.tier === m.set.quality ? 'PASS' : 'FAIL') : 'INFO',
    `离开前 benchmark=${bm}；回菜单后 benchmark=${m.bm}，设置 qualityDetected=${m.set.qualityDetected} detectedTier=${m.set.qualityDetectedTier} quality=${m.set.quality}，运行时 tier=${m.tier}`);
});

await step(T, '「继续」回到场景开头', async () => {
  await clickSel('.main-menu [data-act="continue"]');
  await waitMain(); await sleep(4000);
  const p = await pos();
  const d = Math.hypot(p[0] - spawn[0], p[2] - spawn[2]);
  const bm = await ev(`__game.benchmark.state`);
  rec(T, '暂停「回到主菜单」后「继续」回到当前场景开头', d < 0.3 ? 'PASS' : 'FAIL', `继续后位置 ${p}（出生点 ${spawn}，水平偏差 ${d.toFixed(2)} m）；再次进 S1 benchmark=${bm}`);
});

await step(T, '有存档点「新游戏」弹出覆盖确认，取消回主菜单；确认后新开', async () => {
  await sleep(12000); // 让游玩时间累计一点
  const before = (await S()).save;
  await page.tap('Escape'); await sleep(1000);
  await clickSel('.pause-menu [data-act="to-menu"]'); await sleep(600);
  await clickSel('.confirm-dialog [data-act="confirm"]');
  await waitMenu(); await sleep(1000);
  await clickSel('.main-menu [data-act="new"]'); await sleep(800);
  const cf = await ev(`({ view: __game.ui.mainMenu.view, title: document.querySelector('.confirm-title').textContent, body: document.querySelector('.confirm-body').textContent, ok: document.querySelector('.confirm-dialog [data-act="confirm"]').textContent, cancel: document.querySelector('.confirm-dialog [data-act="cancel"]').textContent })`);
  await page.screenshot(`${SH}/008-overwrite-confirm.png`);
  await clickSel('.confirm-dialog [data-act="cancel"]'); await sleep(800);
  const c1 = await ev(`({ view: __game.ui.mainMenu.view, scene: __game.scenes.current.name, cont: !document.querySelector('.main-menu [data-act="continue"]').hidden, save: JSON.parse(localStorage.getItem('foglight.save.v1')) })`);
  await clickSel('.main-menu [data-act="new"]'); await sleep(800);
  await clickSel('.confirm-dialog [data-act="confirm"]');
  await waitMain(); await sleep(3000);
  const after = (await S()).save;
  rec(T, '有存档点「新游戏」弹出覆盖确认，取消回主菜单', cf.view === 'confirm' && c1.view === 'home' && c1.scene === 'menu' && c1.cont && JSON.stringify(c1.save) === JSON.stringify(before) || (c1.view === 'home' && c1.save?.playTimeSec === before?.playTimeSec) ? 'PASS' : 'FAIL',
    `确认框「${cf.title} / ${cf.body}」按钮「${cf.cancel} / ${cf.ok}」；取消后 view=${c1.view} 场景=${c1.scene} 继续可见=${c1.cont}，存档未变（playTime ${before?.playTimeSec} → ${c1.save?.playTimeSec}）；确认后进入主场景，新存档 playTime=${after?.playTimeSec} startedAt 变化=${before?.startedAt !== after?.startedAt}`);
});

await step(T, '章节结束页：用时 / 提示次数，回主菜单后继续回到结束页', async () => {
  await sleep(25000);
  const s0 = (await S()).save;
  await ev(`__game.flow.completeChapter()`);
  await must(`__game.scenes.current?.name === 'chapter-end' && __game.ui.chapterEnd.isOpen`, 60000, '结束页');
  await sleep(1500);
  const r = await ev(`({ title: document.querySelector('.chapter-end-title').textContent, art: document.querySelector('.chapter-end-art-label').textContent, time: document.querySelector('[data-role="playtime"]').textContent, hints: document.querySelector('[data-role="hints"]').textContent, tbc: document.querySelector('.chapter-end-tbc').textContent, btn: document.querySelector('.chapter-end [data-act="to-menu"]').textContent, save: JSON.parse(localStorage.getItem('foglight.save.v1')) })`);
  await page.screenshot(`${SH}/008-chapter-end.png`);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  await sleep(12000);
  const r2 = await ev(`({ save: JSON.parse(localStorage.getItem('foglight.save.v1')), time: document.querySelector('[data-role="playtime"]').textContent })`);
  const okNum = r.time.includes(fmt(r.save.playTimeSec)) && r.hints.includes(String(r.save.hintsUsed)) && r.save.chapterComplete;
  rec(T, '章节结束页显示用时（分:秒）和提示次数，数值与实际一致', okNum && r2.save.playTimeSec === r.save.playTimeSec ? 'PASS' : 'FAIL',
    `「${r.title}」「${r.art}」「${r.time}」「${r.hints}」「${r.tbc}」[${r.btn}]；存档 playTimeSec=${r.save.playTimeSec}（进结束页前 ${s0.playTimeSec}，零头补记）hintsUsed=${r.save.hintsUsed} chapterComplete=${r.save.chapterComplete}；12 s 后 playTimeSec=${r2.save.playTimeSec}（不再计时）`);
  await clickSel('.chapter-end [data-act="to-menu"]');
  await waitMenu(); await sleep(1000);
  await clickSel('.main-menu [data-act="continue"]');
  await must(`__game.scenes.current?.name === 'chapter-end' && __game.ui.chapterEnd.isOpen`, 60000, '继续→结束页');
  await sleep(1000);
  const r3 = await ev(`document.querySelector('[data-role="playtime"]').textContent`);
  await page.screenshot(`${SH}/008-continue-to-chapter-end.png`);
  rec(T, '结束页 → 回到主菜单 → 继续 → 回到结束页', r3 === r.time ? 'PASS' : 'FAIL', `继续后进入 chapter-end，用时「${r3}」`);
  // Esc 在结束页
  await page.tap('Escape'); await sleep(800);
  const esc = await ev(`({ scene: __game.scenes.current.name, pause: __game.ui.pause.isOpen })`);
  rec(T, '结束页按 Esc 不弹暂停（补充）', esc.scene === 'chapter-end' && !esc.pause ? 'PASS' : 'FAIL', JSON.stringify(esc));
});

await step(T, '样式对照 style-guide §6（计算样式）', async () => {
  await clickSel('.chapter-end [data-act="to-menu"]'); await waitMenu(); await sleep(800);
  const st = await ev(`(() => { const b = document.querySelector('.main-menu [data-act="settings"]'); const cs = getComputedStyle(b); const title = getComputedStyle(document.querySelector('.main-title'));
    return { btnBorder: cs.borderColor, btnFont: cs.fontFamily, titleFont: title.fontFamily, titleColor: title.color }; })()`);
  const r = await P.rect('.main-menu [data-act="settings"]');
  await page.mouse('mouseMoved', r.x, r.y); await sleep(600);
  const hov = await ev(`(() => { const cs = getComputedStyle(document.querySelector('.main-menu [data-act="settings"]')); return { border: cs.borderColor, shadow: cs.boxShadow, color: cs.color }; })()`);
  await page.screenshot(`${SH}/008-menu-hover.png`);
  await clickSel('.main-menu [data-act="settings"]'); await sleep(600);
  const panel = await ev(`getComputedStyle(document.querySelector('.settings-panel')).backgroundColor`);
  rec(T, '面板底色、悬停琥珀色、字体（计算样式，最终由制作人看截图）', 'INFO', `设置面板底色 ${panel}；按钮常态描边 ${st.btnBorder} → 悬停 ${hov.border} / 阴影 ${hov.shadow} / 字色 ${hov.color}；正文字体 ${st.btnFont}；标题字体 ${st.titleFont}`);
});

console.log('ERRORS', JSON.stringify(page.errors));
P.save('b3-008');
await P.done(); process.exit(0);
