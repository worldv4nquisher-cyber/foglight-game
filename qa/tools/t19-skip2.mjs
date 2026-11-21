// batch19 ⑤ 复测：按住 1.2 s 后松开（CDP 真键盘），记录按住期间 rAF 帧数 / 最长帧间隔 / 松开前控制器进度，最多 3 次
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5672, { width: 1280, height: 720 });
const out = { holds: [] };
const save = () => writeFileSync(`${SH}/skip/t19-skip2.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'music');
  await ev(`(() => { localStorage.clear(); const w = window.__fr = { n: 0, gap: 0, last: performance.now() }; const f = () => { const n = performance.now(); w.gap = Math.max(w.gap, n - w.last); w.last = n; w.n++; requestAnimationFrame(f); }; requestAnimationFrame(f); __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene.t > 3`, 600000, 'start'); log('started');
  for (let i = 0; i < 3; i++) {
    await sleep(2500);
    await ev(`(() => { __fr.n = 0; __fr.gap = 0; __fr.last = performance.now(); window.__w0 = performance.now(); return 1; })()`);
    await page.keyDown('Space'); await sleep(1200);
    const pre = await ev(`({ held: performance.now() - __w0, p: __game.ui.skip.progress(performance.now()), id: __game.ui.skip.id, endedBy: __s3.endingCutscene.endedBy, frames: __fr.n, maxGap: Math.round(__fr.gap), log: __game.ui.skip.log.slice(-1) })`);
    await page.keyUp('Space'); await sleep(1500);
    const post = await ev(`({ endedBy: __s3.endingCutscene.endedBy, scene: __game.scenes.current?.name, t: __s3.endingCutscene.t })`);
    out.holds.push({ i, pre, post }); save(); log(JSON.stringify({ pre, post }));
    if (post.endedBy) break;
  }
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
