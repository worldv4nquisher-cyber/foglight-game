// batch19 ⑤：结尾演出手动跳过：短按 Space（150 ms / 600 ms）不跳；按住 1.2 s 跳（不行再 3 s）；记 skiphint:shown 事件
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/skip`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5671, { width: 1280, height: 720 });
const out = { steps: [] };
const save = () => writeFileSync(`${D}/t19-skip.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const ST = `(() => { const c = __s3?.endingCutscene; return { scene: __game.scenes.current?.name, t: c ? +c.t.toFixed(2) : null, endedBy: c?.endedBy ?? null, ev: window.__shown?.length ?? 0, shownCount: +(document.querySelector('[data-shown-count]')?.dataset.shownCount ?? -1) }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3'); log('s3');
  for (let i = 0; i < 5; i++) { await page.click(640, 360); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'music');
  await ev(`(() => { window.__shown = []; window.addEventListener('skiphint:shown', (e) => __shown.push({ at: performance.now() | 0, ...e.detail })); localStorage.clear(); __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene.t > 3`, 600000, 'start'); log('started');
  for (const ms of [150, 600]) {
    const a = await ev(ST); await page.keyDown('Space'); await sleep(ms); await page.keyUp('Space'); await sleep(4000);
    const b = await ev(ST); out.steps.push({ kind: 'tap', ms, before: a, after: b }); save(); log('tap', ms, JSON.stringify(b));
  }
  for (const ms of [1200, 3000]) {
    const a = await ev(ST); if (a.scene !== 's3-lighthouse' || a.endedBy) break;
    await page.keyDown('Space'); await sleep(ms); const mid = await ev(ST); await page.keyUp('Space');
    const ok = await must(`__game.scenes.current?.name === 'chapter-end' || !!__s3.endingCutscene.endedBy`, 30000, 'skip' + ms).then(() => true, () => false);
    const b = await ev(ST); out.steps.push({ kind: 'hold', ms, before: a, mid, after: b, skipped: ok }); save(); log('hold', ms, ok, JSON.stringify(b));
    if (ok) break;
  }
  out.shown = await ev(`window.__shown`);
  const end = await must(`__game.scenes.current?.name === 'chapter-end'`, 600000, 'end').then(() => true, () => false);
  out.end = { reached: end, ...(await ev(`({ scene: __game.scenes.current?.name, endedBy: __s3?.endingCutscene?.endedBy ?? null, music: __game.audio.musicLog?.slice(-3) })`).catch((e) => ({ err: String(e) }))) };
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
