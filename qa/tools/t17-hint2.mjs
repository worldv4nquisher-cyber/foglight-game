// ② 追查：结尾演出中跳过提示是否画出（anyKey 触发 3 s 提示，多次截图）
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5620, { width: 960, height: 540 });
const out = { shots: [] };
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'ready');
  await ev(`(localStorage.clear(), __s3.lightTheLamp(), 1)`);
  await must(`__s3.endingCutscene.t >= 8`, 300000, 't8');
  for (let k = 0; k < 3; k++) {
    await page.keyDown('KeyE'); await page.keyUp('KeyE'); // 任意键 → 提示 3 s
    for (let j = 0; j < 3; j++) { await sleep(700); const s = await ev(`({ t: +__s3.endingCutscene.t.toFixed(2), vis: __game.ui.skipHint.visible, hidden: document.querySelector('.skip-hint').hidden, id: __game.ui.skip.id })`); const f = `${SH}/skip/hint-end-${k}${j}.png`; await page.screenshot(f); s.f = f.split('/').pop(); out.shots.push(s); }
  }
  out.errors = page.errors.slice(0, 5);
} finally { writeFileSync(`${SH}/skip/t17-hint2.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
