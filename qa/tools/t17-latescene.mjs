// batch17 ⑥ 9669ec9：S3 场景曲（底层+上层）下载被 CDP 扣住 → 点燃、结尾曲已在放 → 放行 → 场景曲不能起播、结尾曲 / 音频时钟不受影响
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5621, { width: 960, height: 540 });
const out = {}; const held = [];
const save = () => writeFileSync(`${SH}/t17-latescene.json`, JSON.stringify(out, null, 1));
try {
  page.onEvent((m) => { if (m.method === 'Fetch.requestPaused') held.push(m.params.requestId); });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*mus-s3-lighthouse*', requestStage: 'Request' }] });
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'ending-buf');
  out.pre = await ev(`({ key: __game.audio.musicKey, held: ${held.length}, lazy: __s3.musicLazyResult ?? null })`);
  out.pre.held = held.length;
  await ev(`(() => { localStorage.clear(); const c = __s3.endingCutscene; window.__lt = []; const o = c.update.bind(c); c.update = () => { o(); __lt.push([+c.t.toFixed(2), c.player.clock.source[0], __game.audio.musicKey]); }; __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene.t >= 6 && __game.audio.musicKey === 'mus-ending-ch1'`, 300000, 't6');
  out.beforeRelease = await ev(`({ t: __s3.endingCutscene.t, key: __game.audio.musicKey, src: __s3.endingCutscene.player.clock.source })`);
  out.released = held.length;
  for (const id of held.splice(0)) await page.send('Fetch.continueRequest', { requestId: id });
  await page.send('Fetch.disable');
  await must(`__s3.musicLazyResult !== undefined && __s3.musicLazyResult !== null`, 240000, 'lazy-result').catch((e) => { out.lazyWait = String(e).slice(0, 120); });
  await sleep(4000);
  out.after = await ev(`({ t: __s3.endingCutscene.t, key: __game.audio.musicKey, src: __s3.endingCutscene.player.clock.source, lazy: __s3.musicLazyResult ?? null, upper: __s3.musicUpperResult ?? null, log: __game.audio.musicLog.map((x) => x.op + ':' + x.key + '@' + x.at.toFixed(1)) })`);
  const lt = await ev(`__lt`); out.frames = lt.length; out.back = lt.filter((x, i) => i && x[0] < lt[i - 1][0]).length; out.srcs = [...new Set(lt.map((x) => x[1] + x[2]))];
  out.errors = page.errors.slice(0, 5);
} finally { save(); await done(); console.log('DONE'); }
