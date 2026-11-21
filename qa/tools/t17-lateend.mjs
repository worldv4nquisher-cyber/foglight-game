// batch17 ⑥ ④ 结尾曲晚到自测：扣住 mus-ending-ch1 → 点燃走后备时钟 → 放行 → 补位起播；逐帧查时钟不倒退、切到 audio 后 t = 曲子位置
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5622, { width: 960, height: 540 });
const out = {}; const held = [];
const save = () => writeFileSync(`${SH}/t17-lateend.json`, JSON.stringify(out, null, 1));
try {
  page.onEvent((m) => { if (m.method === 'Fetch.requestPaused') held.push(m.params.requestId); });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*mus-ending-ch1*', requestStage: 'Request' }] });
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await sleep(3000);
  out.pre = await ev(`({ key: __game.audio.musicKey, held: ${held.length}, lazy: __s3.musicLazyResult ?? null })`);
  out.pre.held = held.length;
  await ev(`(() => { localStorage.clear(); const c = __s3.endingCutscene; window.__lt = []; const o = c.update.bind(c); c.update = () => { o(); const a = __game.audio, em = __s3.endingMusic; __lt.push([+c.t.toFixed(3), c.player.clock.source[0], a.musicKey, a.musicKey === 'mus-ending-ch1' && a.musicStartAt != null ? +(a.context.currentTime - a.musicStartAt).toFixed(3) : null]); }; __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene.t >= 6`, 300000, 't6');
  out.beforeRelease = await ev(`({ t: __s3.endingCutscene.t, key: __game.audio.musicKey, src: __s3.endingCutscene.player.clock.source })`);
  out.released = held.length;
  for (const id of held.splice(0)) await page.send('Fetch.continueRequest', { requestId: id });
  await page.send('Fetch.disable');
  await must(`__s3.endingMusic.result !== null`, 240000, 'end-result').catch((e) => { out.lazyWait = String(e).slice(0, 120); });
  await sleep(4000);
  out.after = await ev(`({ t: __s3.endingCutscene.t, key: __game.audio.musicKey, src: __s3.endingCutscene.player.clock.source, lazy: __s3.musicLazyResult ?? null, upper: __s3.musicUpperResult ?? null, log: __game.audio.musicLog.map((x) => x.op + ':' + x.key + '@' + x.at.toFixed(1)) })`);
  const lt = await ev(`__lt`); out.frames = lt.length; out.back = lt.filter((x, i) => i && x[0] < lt[i - 1][0]).length; out.srcs = [...new Set(lt.map((x) => x[1] + x[2]))]; out.lt = lt; out.em = await ev(`({ result: __s3.endingMusic.result, ig: __s3.endingMusic.ignitedAt, startAt: __game.audio.musicStartAt, play: __game.audio.musicLog.filter((x) => x.key === 'mus-ending-ch1').at(-1) })`);
  out.errors = page.errors.slice(0, 5);
} finally { save(); await done(); console.log('DONE'); }
