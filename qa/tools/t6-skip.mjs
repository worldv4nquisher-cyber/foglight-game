import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5281);
const T = 'v0.1-013';
const camSt = `(() => { const s = window.__s1, cf = s?.cameraFollow, c = s?.camera, b = s?.rig?.body.position; return { name: cf?.cutsceneName ?? null, mode: cf?.modeName, ctx: __game.input.context, ft: __game.time.fixedTick, el: +__game.time.elapsed.toFixed(3), bench: { running: __game.benchmark.running ?? null, first: __game.benchmark.firstRoundDone }, cam: c ? [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(2)) : null, pos: b ? [b.x, b.y, b.z].map(v => +v.toFixed(3)) : null }; })()`;
await step(T, '跳过开场 → 3 s 不可跳过建立镜头', async () => {
  await page.goto(url('?smoke=1&debug=1&autostart=1'));
  await must(`!!window.__s1 && __s1.cameraFollow?.cutsceneName === 'establishing'`, 240000, 'establishing');
  const a = await ev(camSt);
  await page.keyDown('Space');
  const switched = await page.waitFor(`__s1.cameraFollow.cutsceneName !== 'establishing'`, 120000, 50);
  await page.keyUp('Space');
  const b = await ev(camSt);
  await sleep(300); await page.screenshot(`${SH}/013-skip-hold-shot.png`);
  // 在 hold 镜头里再按住 Space 并按住 W：不应跳过、角色不动
  await page.keyDown('Space'); await page.keyDown('KeyW');
  const samples = [];
  let last = b;
  const end = Date.now() + 240000;
  while (Date.now() < end) { last = await ev(camSt); samples.push(last); if (last.name !== 's1-establishing-hold') break; await sleep(100); }
  await page.keyUp('Space'); await page.keyUp('KeyW');
  const inHold = samples.filter((s) => s.name === 's1-establishing-hold');
  const lastHold = inHold.at(-1) ?? b;
  const moved = inHold.length ? Math.hypot(lastHold.pos[0] - b.pos[0], lastHold.pos[2] - b.pos[2]) : null;
  await must(`__game.input.context === 'explore'`, 120000, 'explore');
  const c = await ev(camSt);
  rec(T, '跳过开场后接 s1-establishing-hold、不可跳过、期间不能动', b.name === 's1-establishing-hold' && !a.bench.first && moved !== null && moved < 0.01 ? 'PASS' : 'FAIL', {
    before: a, afterSkip: b, holdLastSample: lastHold, end: c, holdSamples: inHold.length, movedDuringHold: moved,
    holdElapsedSec: +(lastHold.el - b.el).toFixed(2), holdFixedSec: +((lastHold.ft - b.ft) / 60).toFixed(2), skippableTrack: await ev(`null`),
  });
  rec(T, 'hold 镜头时长（帧时间 / 固定步长，到最后一次采样仍在 hold）', 'INFO', { elapsed: +(lastHold.el - b.el).toFixed(2), fixed: +((lastHold.ft - b.ft) / 60).toFixed(2), benchDoneAtEnd: c.bench.first });
});
await step(T, '对照：画质检测已完成后再跳过 → 直接交还', async () => {
  await page.goto(url('?smoke=1&debug=1&autostart=1'));
  await must(`!!window.__s1 && __s1.cameraFollow?.cutsceneName === 'establishing'`, 240000, 'establishing2');
  const a = await ev(camSt);
  await page.keyDown('Space');
  const sw = await page.waitFor(`__s1.cameraFollow.cutsceneName !== 'establishing'`, 120000, 50);
  await page.keyUp('Space');
  const b = await ev(camSt);
  const settings = await ev(`JSON.parse(localStorage.getItem('foglight.settings.v1') || 'null')`);
  rec(T, '检测已完成时跳过不补 hold 镜头', a.bench.first && b.name !== 's1-establishing-hold' ? 'PASS' : (a.bench.first ? 'FAIL' : 'INFO'), { before: a, after: b, qualityDetected: settings?.qualityDetected, tier: settings?.qualityDetectedTier ?? settings?.quality });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
