// batch17 ② 追查：短按 Space 在长帧下是否会误跳过；跳过提示是否真的画出来
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/skip`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5618, { width: 960, height: 540 });
const out = {};
const save = () => writeFileSync(`${D}/t17-tap.json`, JSON.stringify(out, null, 1));
const st = `({ t: +__s3.endingCutscene.t.toFixed(2), endedBy: __s3.endingCutscene.endedBy, skip: __game.ui.skip.log.slice(), ev: __kev.slice(-6), fr: __frm.slice(-6) })`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'ready');
  await ev(`(() => { localStorage.clear(); window.__kev = []; window.__frm = []; for (const ty of ['keydown', 'keyup']) addEventListener(ty, (e) => { if (e.code === 'Space') __kev.push([ty, +performance.now().toFixed(0), e.repeat]); }, true);
    const c = __s3.endingCutscene; const o = c.update.bind(c); c.update = () => { __frm.push(+performance.now().toFixed(0)); o(); }; return 1; })()`);
  await ev(`__s3.lightTheLamp(), 1`);
  await must(`__s3.endingCutscene.t >= 8`, 300000, 't8');
  // A：提示绘制。按住 0.5 s 期间等一帧 UI 更新后截图
  await page.keyDown('Space');
  await sleep(450);
  out.hintA = await ev(`(() => { const e = document.querySelector('.skip-hint'); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hidden: e.hidden, r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], top: top ? String(top.className?.baseVal ?? top.className) : null, fadeZ: getComputedStyle(document.querySelector('.screen-fade')).zIndex, fadeOp: getComputedStyle(document.querySelector('.screen-fade')).opacity, p: __game.ui.skip.progress(performance.now()) }; })()`);
  await page.keyUp('Space'); await page.screenshot(`${D}/tap-hint-A.png`); await sleep(1500);
  out.A = await ev(st);
  // B：对照，正常短按 0.15 s
  await page.keyDown('Space'); await sleep(150); await page.keyUp('Space'); await sleep(2500);
  out.B = await ev(st);
  // C：短按 0.2 s，按下后主线程插一段 1.2 s 卡顿（模拟一次长帧）
  await page.keyDown('Space');
  await ev(`(setTimeout(() => { const t = performance.now(); while (performance.now() - t < 1200); }, 0), 1)`);
  await sleep(200); await page.keyUp('Space'); await sleep(3000);
  out.C = await ev(st);
  out.errors = page.errors.slice(0, 5);
} finally { save(); await done(); console.log('DONE'); }
