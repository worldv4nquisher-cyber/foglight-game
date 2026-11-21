// batch12：雨分档 + 溅水存活数（用雨自己的时间基）
import { open, sleep } from './b12lib.mjs';
const T = 'b12-splash';
const { page, ev, must, url, rec, step, done } = await open(5547, { width: 480, height: 270 });
for (const [atmo, q] of [['rain-night', 'ultra'], ['rain-night', 'high'], ['rain-night', 'standard'], ['overcast-after-rain', 'ultra'], ['after-lit', 'ultra']]) await step(T, atmo + '/' + q, async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=s1&atmo=${atmo}&quality=${q}&art=1`));
  await must(`!!window.__s1?.rain && !!__s1.art && __game.scenes.current?.name === 's1-ebb-shore'`, 400000, 's1');
  const t0 = await ev('__game.time.elapsed'); await must(`__game.time.elapsed >= ${t0 + 4}`, 300000, 'wait');
  const r = await ev(`(() => { const r = __s1.rain, sp = r.splashes; const samples = []; return { mode: r.mode, drops: r.dropCount, visible: r.object?.visible ?? r.mesh?.visible ?? null, rainTime: +(r.time ?? NaN).toFixed(2), splash: sp ? sp.aliveCount(r.time) : null, splashCap: sp?.capacity ?? sp?.max ?? null, lens: __game.postfx.lensDroplets?.strength ?? __game.postfx.lensDroplets?.uniforms?.uStrength?.value ?? null }; })()`);
  const samples = [];
  for (let i = 0; i < 4; i++) { const t = await ev('__game.time.elapsed'); await must(`__game.time.elapsed >= ${t + 0.5}`, 120000, 'w'); samples.push(await ev(`__s1.rain.splashes ? __s1.rain.splashes.aliveCount(__s1.rain.time) : null`)); }
  rec(T, `${atmo} ${q}`, 'INFO', { ...r, splashSamples: samples });
});
await done(); console.log('DONE');
