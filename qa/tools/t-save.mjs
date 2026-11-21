import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER, SHOTS, makeRecorder, step } from './common.mjs';
const T = 'v0.1-006';
const { rec, save } = makeRecorder('save');
const dev = await startDev(5202);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
const load = async () => {
  await page.goto(dev.url + '/');
  await sleep(500);
  return page.waitFor(`window.__game?.scenes?.current?.name === 'main'`, 90000);
};
const read = () => ev(`({ save: localStorage.getItem('foglight.save.v1'), settings: localStorage.getItem('foglight.settings.v1'), status: __game.save.status, canContinue: __game.save.canContinue, notice: __game.save.startupNotice, toast: (() => { const t = document.querySelector('.hud-toast'); return t && !t.hidden ? t.textContent : null; })(), frame: __game.time.frame, scene: __game.scenes.current?.name })`);
const running = async () => { const f0 = await ev('__game.time.frame'); await sleep(1500); return (await ev('__game.time.frame')) > f0; };

await load();
await ev(`localStorage.clear(); 1`);
await load();
await step(rec, T, '进场自动存档', async () => {
  const s = await read();
  const d = JSON.parse(s.save || 'null');
  const keys = d ? Object.keys(d).sort().join(',') : '';
  rec(T, '进入玩法场景自动写存档（当前只有占位主场景 main）', d && d.version === 1 && d.sceneId === 'main' ? 'PASS' : 'FAIL', `foglight.save.v1 = ${s.save}；字段 ${keys}`);
});
await step(rec, T, '设置刷新保留 / 新游戏不清设置', async () => {
  await ev(`__game.settings.update({ mouseSensitivity: 1.7, invertY: true, subtitleSize: 'l', masterVolume: 40 }); 1`);
  await load();
  const s1 = await ev(`({ all: __game.settings.all, sens: __game.input.lookSensitivity, inv: __game.input.invertY })`);
  const before = await ev(`localStorage.getItem('foglight.settings.v1')`);
  await ev(`__game.save.newGame('ch1', 'main'); 1`);
  const after = await ev(`({ settings: localStorage.getItem('foglight.settings.v1'), save: localStorage.getItem('foglight.save.v1') })`);
  const ok1 = s1.all.mouseSensitivity === 1.7 && s1.all.invertY === true && s1.all.subtitleSize === 'l' && s1.all.masterVolume === 40 && s1.sens === 1.7 && s1.inv === true;
  rec(T, '修改设置后刷新仍保留', ok1 ? 'PASS' : 'FAIL', `刷新后 sens=${s1.all.mouseSensitivity} invertY=${s1.all.invertY} subtitle=${s1.all.subtitleSize} master=${s1.all.masterVolume}；输入层 sens=${s1.sens} inv=${s1.inv}`);
  rec(T, '「新游戏」不清除设置（主菜单 008 未做，调用 save.newGame 验证逻辑）', after.settings === before && after.save === null ? 'PASS' : 'FAIL', `newGame 后设置键${after.settings === before ? '不变' : '变了'}，存档键=${after.save}`);
  await ev(`__game.settings.resetToDefaults(); 1`);
});
for (const [label, payload, shot] of [
  ['version 改成 0', `JSON.stringify({ ...JSON.parse(localStorage.getItem('foglight.save.v1')), version: 0 })`, '006-corrupt-version0.png'],
  ['写入非法 JSON', `'{not json'`, '006-corrupt-badjson.png'],
]) {
  await step(rec, T, label, async () => {
    await load();
    await sleep(500);
    await ev(`localStorage.setItem('foglight.save.v1', ${payload}); 1`);
    await load();
    await sleep(800);
    const s = await read();
    await page.screenshot(`${SHOTS}/${shot}`);
    const run = await running();
    const ok = /存档无法读取/.test(s.notice ?? '') && /存档无法读取/.test(s.toast ?? '') && run && s.scene === 'main';
    rec(T, `存档${label}：提示「存档无法读取」且不崩溃`, ok ? 'PASS' : 'FAIL', `startupNotice=${s.notice}；HUD toast=${s.toast}；场景=${s.scene} 渲染在走=${run}；之后存档=${s.save?.slice(0, 60)}`);
  });
}
await step(rec, T, 'localStorage 写入抛错', async () => {
  const { identifier } = await page.addInit(`Storage.prototype.setItem = function () { throw new DOMException('QuotaExceededError (QA 模拟)', 'QuotaExceededError'); };`);
  await load();
  await sleep(800);
  const s = await read();
  await page.screenshot(`${SHOTS}/006-storage-unwritable.png`);
  const run = await running();
  await page.waitFor(`__game.input.context === 'explore'`, 30000);
  const p0 = await ev(`__game.scenes.current.rig.body.position.clone().toArray()`);
  await ev(`__game.input.setRaw('qa', 'KeyW', true); 1`);
  await sleep(2500);
  await ev(`__game.input.setRaw('qa', 'KeyW', false); 1`);
  const p1 = await ev(`__game.scenes.current.rig.body.position.clone().toArray()`);
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  const ok = s.notice && /无法保存进度/.test(s.notice) && /无法保存进度|进度不会保存/.test(s.toast ?? '') && run && moved > 0.3;
  rec(T, '模拟 localStorage 抛错：可正常游玩并有「进度不会保存」类提示', ok ? 'PASS' : 'FAIL', `startupNotice=${s.notice}；toast=${s.toast}；渲染在走=${run}；按 W 2.5s 移动 ${moved.toFixed(2)} m；未捕获异常 ${page.errors.length} 条`);
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
});
await step(rec, T, '游玩时间', async () => {
  await ev(`localStorage.clear(); 1`);
  await load();
  await page.waitFor(`__game.input.context === 'explore'`, 30000);
  const e0 = await ev('__game.time.elapsed');
  await page.waitFor(`__game.time.elapsed - ${e0} > 21`, 60000, 500);
  const r = await ev(`(() => { __game.save.save({ chapterId: 'ch1', sceneId: 'main' }); return { mem: __game.save.playTimeSec, stored: JSON.parse(localStorage.getItem('foglight.save.v1')).playTimeSec, el: __game.time.elapsed }; })()`);
  rec(T, '游玩时间每 10 秒累加、存档时写入（补充）', r.stored >= 20 && r.stored % 10 === 0 ? 'PASS' : 'FAIL', `游戏内经过 >21s 后手动触发存档：playTimeSec=${r.stored}（内存 ${r.mem}）`);
});
save();
console.log('ERRORS', page.errors.length, page.errors.slice(0, 3));
close(); await dev.close(); process.exit(0);
