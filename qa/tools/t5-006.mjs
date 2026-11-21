import { open, sleep, SH } from './b5lib.mjs';
const T = 'BUG-006';
const P = await open(5265);
const { page, ev, must, url, rec, step } = P;
await page.goto(url('?smoke=1')); await must('!!window.__game'); await ev('localStorage.clear()');
await page.goto(url('?smoke=1&debug=1&scene=s3'));
await must(`window.__game?.scenes.current?.name === 's3-lighthouse' && __game.input.context === 'explore'`, 180000, 's3');
await sleep(1500); await page.click(640, 400); await sleep(500);
await ev(`window.__s3 = __game.scenes.current; 1`);
const S = `__s3`;
const lh = () => ev(`(() => { const l = ${S}.lighthouse; return { on: l.on, sceneOn: ${S}.lighthouseOn, beam: l.beamPivot.visible, light: l.light.visible, intensity: +l.light.intensity.toFixed(2), emissive: l.lamp.material.emissiveIntensity }; })()`);
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 300000, 'wait'); };
await step(T, 'S3 进场灯塔暗', async () => {
  const pos = await ev(`${S}.rig.body.position.toArray().map(v => +v.toFixed(2))`);
  const a = await lh(); await waitSec(2); const b = await lh();
  await page.screenshot(`${SH}/006-s3-entry-dark.png`);
  rec(T, 'S3 进场灯塔暗（无自发光、无光束、无暖光）', !a.on && !a.beam && !a.light && a.emissive === 0 && b.intensity === 0 && !b.beam ? 'PASS' : 'FAIL', `进场位置 ${pos}；进场 ${JSON.stringify(a)}；2 s 后 ${JSON.stringify(b)}`);
});
await step(T, 'E 点灯 → 亮 + 光束 → 结束页', async () => {
  // 走过去：朝 -z 按 W，直到出现 s3-lamp 候选
  await ev(`${S}.cameraFollow ? (${S}.cameraFollow.yaw = 0) : 0; 1`); await sleep(300);
  await page.keyDown('KeyW');
  const ok = await page.waitFor(`${S}.interaction.current?.id === 's3-lamp' || __game.scenes.current !== __s3`, 240000, 300) && await ev(`${S}.interaction.current?.id === 's3-lamp'`);
  console.log('scene now', await ev(`__game.scenes.current?.name`), 'ctx', await ev(`__game.input.context`));
  await page.keyUp('KeyW'); await waitSec(0.3);
  const p = await ev(`${S}.rig.body.position.toArray().map(v => +v.toFixed(2))`);
  const prompt = await ev(`(() => { const e = document.querySelector('.hud-prompt'); return e && !e.hidden ? e.textContent : null; })()`);
  const pre = await lh();
  await page.tap('KeyE'); await waitSec(1);
  const post = await lh();
  await page.screenshot(`${SH}/006-s3-lit.png`);
  await must(`!!document.querySelector('.chapter-end') && document.querySelector('.chapter-end').offsetParent !== null`, 240000, 'ending');
  await sleep(1500); await page.screenshot(`${SH}/006-s3-ending.png`);
  const end = await ev(`document.querySelector('.chapter-end').innerText.replace(/\\s+/g, ' ').slice(0, 200)`);
  rec(T, 'E 点灯 → 亮 + 光束 → 结束页', ok && !pre.on && post.on && post.beam && post.light && post.emissive > 0 && post.intensity > 0 ? 'PASS' : 'FAIL', `走 W 到 ${p} 出现候选 s3-lamp=${ok}，提示「${prompt}」；E 前 ${JSON.stringify(pre)}；E 后 1 s ${JSON.stringify(post)}；结束页「${end}」`);
});
P.save('b5-006'); console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
