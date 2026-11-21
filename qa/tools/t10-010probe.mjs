import { open, sleep } from './b10lib.mjs';
const { page, ev, must, url, rec, done } = await open(5461);
for (const q of ['?smoke=1&debug=1&scene=s3', '?smoke=1&debug=1&scene=s3&art=1']) {
  await page.goto(url('?debug=1')); await sleep(1000); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
  await page.goto(url(q));
  await must(`__game.scenes.current?.name === 's3-lighthouse' && __game.input.context === 'explore'`, 400000, 's3');
  await sleep(1500);
  const r0 = await ev(`(() => { window.__w0 = performance.now(); window.__t0 = __game.time.fixedTick; window.__fr = 0; const f = () => { window.__fr++; if (__game.scenes.current?.name !== 'chapter-end') requestAnimationFrame(f); else { window.__w1 = performance.now(); window.__t1 = __game.time.fixedTick; } }; requestAnimationFrame(f); __game.scenes.current.lightTheLamp(); return __game.time.fixedDelta; })()`);
  const ok = await page.waitFor(`__game.scenes.current?.name === 'chapter-end'`, 180000, 200);
  const r = await ev(`({ wallSec: ((window.__w1 ?? performance.now()) - __w0) / 1000, gameSec: ((window.__t1 ?? __game.time.fixedTick) - __t0) * ${r0}, frames: __fr, scene: __game.scenes.current?.name })`);
  rec('b10-010probe', `${q} lightTheLamp → chapter-end`, ok ? 'INFO' : 'FAIL', { ...r, fps: +(r.frames / r.wallSec).toFixed(1), errs: page.errors });
}
await done(); console.log('DONE');
