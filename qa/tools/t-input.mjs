import { REPO_ROOT } from './paths.mjs';
import { execSync } from 'node:child_process';
import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
import { HELPER, SHOTS, makeRecorder, step } from './common.mjs';
const T = 'v0.1-001';
const { rec, save } = makeRecorder('input');
const dev = await startDev(5201);
const { page, close } = await launch();
const ev = (e) => page.evaluate(e);
await page.addInit(HELPER);
await page.goto(dev.url + '/');
await page.waitFor(`window.__game?.scenes?.current?.name === 'main'`, 90000);
await page.waitFor(`__game.input.context === 'explore' && __game.scenes.current.cameraFollow.modeName === 'explore'`, 60000);

await step(rec, T, '源码无 jump', async () => {
  let out = '';
  try { out = execSync(`grep -rniw "jump" ${REPO_ROOT}/game/src ${REPO_ROOT}/game/README.md || true`).toString(); } catch { /* */ }
  rec(T, '源码/README 无 jump', out.trim() ? 'FAIL' : 'PASS', out.trim() || 'grep -w jump 无匹配');
});

await step(rec, T, '空格不跳', async () => {
  const y0 = await ev(`__game.scenes.current.rig?.body?.position?.y ?? null`);
  await page.tap('Space');
  const ys = await ev(`__qa.sample(() => __game.scenes.current.rig.body.position.y, 2500)`);
  const max = Math.max(...ys);
  const last = await ev(`__qa.last()`);
  rec(T, '空格不会让角色跳起', max - y0 < 0.02 ? 'PASS' : 'FAIL', `y0=${y0?.toFixed(3)} 2.5s 内最高 y=${max.toFixed(3)}；最近 action=${last}`);
});

const state = () => ev(`({ locked: document.pointerLockElement === document.querySelector('canvas'), paused: __game.isPaused, ctx: __game.input.context, yaw: __game.scenes.current.cameraFollow.yaw, pitch: __game.scenes.current.cameraFollow.pitch, menu: !document.querySelector('.pause-menu').hidden })`);

await step(rec, T, '指针锁定', async () => {
  await page.click(640, 360);
  await page.waitFor(`document.pointerLockElement === document.querySelector('canvas')`, 3000);
  let s = await state();
  const yaw0 = s.yaw;
  for (let i = 1; i <= 5; i++) { await page.mouse('mouseMoved', 640 + i * 20, 360); await sleep(30); }
  await sleep(600);
  const s2 = await state();
  rec(T, '点击画面后锁定，移动鼠标直接转视角（无需按住）', s.locked && Math.abs(s2.yaw - yaw0) > 1e-3 ? 'PASS' : 'FAIL', `locked=${s.locked}，移动 100px 后 yaw 变化 ${(s2.yaw - yaw0).toFixed(3)} rad`);
});

await step(rec, T, 'Esc 暂停', async () => {
  await page.tap('Escape');
  await page.waitFor(`__game.isPaused`, 4000);
  await sleep(500);
  const s = await state();
  await page.screenshot(`${SHOTS}/001-esc-pause-menu.png`);
  const r = await ev(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await page.click(r.x, r.y);
  await sleep(300);
  const s2 = await state();
  await sleep(1300);
  await page.click(640, 360);
  await page.waitFor(`document.pointerLockElement === document.querySelector('canvas')`, 3000);
  const s3 = await state();
  const ok = s.paused && !s.locked && s.menu && s.ctx === 'menu' && !s2.paused && s3.locked && !s3.paused;
  rec(T, 'Esc：解锁并弹出暂停菜单；点「继续」后再次点击画面重新锁定', ok ? 'PASS' : 'FAIL', `Esc 后 ${JSON.stringify({ paused: s.paused, locked: s.locked, menu: s.menu, ctx: s.ctx })}；继续后 paused=${s2.paused}；再点画面 locked=${s3.locked}`);
});

await step(rec, T, '灵敏度/Y反转', async () => {
  const moveX = async () => { const a = (await state()).yaw; for (let i = 1; i <= 5; i++) { await page.mouse('mouseMoved', 640 + i * 10, 360); await sleep(30); } await sleep(500); await page.mouse('mouseMoved', 640, 360); await sleep(500); return a; };
  // 鼠标回到中心本身也会产生反向 movement，所以测量「往右 50px」这一段：先移动再回中，各取一半
  const measure = async () => {
    const y0 = (await state()).yaw;
    for (let i = 1; i <= 5; i++) { await page.mouse('mouseMoved', 640 + i * 10, 360); await sleep(30); }
    await sleep(600);
    const y1 = (await state()).yaw;
    await page.mouse('mouseMoved', 640, 360); await sleep(600);
    return y1 - y0;
  };
  void moveX;
  await ev(`__game.settings.update({ mouseSensitivity: 1, invertY: false })`);
  const d1 = await measure();
  await ev(`__game.settings.update({ mouseSensitivity: 2 })`);
  const d2 = await measure();
  const ratio = d2 / d1;
  rec(T, '鼠标灵敏度修改后立即生效', Math.abs(ratio - 2) < 0.15 ? 'PASS' : 'FAIL', `灵敏度 1.0 → 2.0，同样 50px 横移 yaw 变化 ${d1.toFixed(4)} → ${d2.toFixed(4)} rad（比值 ${ratio.toFixed(2)}，期望 2）`);
  await ev(`__game.settings.update({ mouseSensitivity: 1 })`);
  const p0 = (await state()).pitch;
  await page.mouse('mouseMoved', 640, 380); await sleep(600);
  const p1 = (await state()).pitch;
  await page.mouse('mouseMoved', 640, 360); await sleep(600);
  await ev(`__game.settings.update({ invertY: true })`);
  const p2 = (await state()).pitch;
  await page.mouse('mouseMoved', 640, 380); await sleep(600);
  const p3 = (await state()).pitch;
  await page.mouse('mouseMoved', 640, 360); await sleep(600);
  await ev(`__game.settings.update({ invertY: false })`);
  const a = p1 - p0, b = p3 - p2;
  rec(T, 'Y 轴反转修改后立即生效', a !== 0 && Math.sign(a) === -Math.sign(b) ? 'PASS' : 'FAIL', `鼠标下移 20px：正常 pitch ${a.toFixed(4)}，反转后 ${b.toFixed(4)} rad`);
  // 暂停菜单里的灵敏度滑块（真实 UI）
  await page.tap('Escape'); await page.waitFor(`__game.isPaused`, 4000); await sleep(300);
  const sv = await ev(`(() => { const i = document.querySelector('.pause-menu [data-act="sens"]'); i.value = '2.5'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return { sens: __game.input.lookSensitivity, stored: JSON.parse(localStorage.getItem('foglight.settings.v1')).mouseSensitivity }; })()`);
  rec(T, '暂停菜单灵敏度滑块即时生效（补充）', sv.sens === 2.5 && sv.stored === 2.5 ? 'PASS' : 'FAIL', JSON.stringify(sv));
  await ev(`__game.settings.update({ mouseSensitivity: 1 }); __game.resume()`);
  await sleep(500);
});
save();
const mod = await import('./t-input-2.mjs');
await mod.run({ page, ev, rec, step, T, state });
save();
console.log('ERRORS', page.errors.length, page.errors.slice(0, 3));
close(); await dev.close(); process.exit(0);
