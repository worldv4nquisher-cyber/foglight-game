// batch17 ①③⑤ 自测：S3 art=1 完整结尾演出（逐帧记演出 t / 时钟来源 / 曲子位置 / 镜头 / 父亲），父亲段截图，结束页 → 主菜单
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/ending`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5611, { width: 960, height: 540 });
const out = {};
const save = () => writeFileSync(`${D}/t17-end.json`, JSON.stringify(out, null, 1));
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer && !!__s3.father && !!__s3.rig?.animator`, 300000, 'ready');
  out.bad = await ev(`__game.assets.loadStats.filter((x) => (x.done && !x.ok) || x.fallback).map((x) => x.url.split('/').pop())`);
  await ev(`(() => { localStorage.clear(); const c = __s3.endingCutscene; window.__fr = []; window.__err = []; addEventListener('error', (e) => __err.push(String(e.message))); 
    const o = c.update.bind(c); c.update = () => { o(); const a = __game.audio, em = __s3.endingMusic; const f = __s3.father;
      __fr.push([+performance.now().toFixed(0), +c.t.toFixed(3), c.player.clock.source[0], a.musicKey === 'mus-ending-ch1' && em.ignitedAt != null ? +(a.context.currentTime - em.ignitedAt).toFixed(3) : null, c.shot, f?.root?.visible ? 1 : 0, __game.scenes.current?.name ?? null]); };
    return 1; })()`);
  out.igniteWall = await ev(`performance.now()`);
  await ev(`__s3.lightTheLamp(), 1`);
  const shots = [37, 38.5, 40, 41.5]; let si = 0;
  const t0 = Date.now();
  for (;;) {
    const st = await ev(`({ t: __s3.endingCutscene?.t ?? null, sc: __game.scenes.current?.name })`);
    if (si < shots.length && st.t >= shots[si]) { await page.screenshot(`${D}/end-father-t${shots[si]}.png`); out['shotT' + shots[si]] = await ev(`__s3.endingCutscene.t`); si++; continue; }
    if (st.sc === 'chapter-end') break;
    if (Date.now() - t0 > 400000) { out.timeout = st; break; }
    await sleep(si < shots.length && st.t > 35 ? 50 : 400);
  }
  out.endWall = await ev(`performance.now()`);
  out.frames = await ev(`__fr`); out.cueLog = await ev(`__s3.endingCutscene?.player.log ?? null`);
  out.endedBy = await ev(`__s3.endingCutscene?.endedBy ?? null`);
  save();
  await sleep(2500); await page.screenshot(`${D}/end-page.png`);
  out.page = await ev(`({ key: __game.audio.musicKey, log: __game.audio.musicLog.slice(-3), fade: __game.ui.fade.opacity })`);
  // ⑤ 结束页 → 主菜单
  const r = await ev(`(() => { const b = document.querySelector('[data-act="to-menu"]'); const q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2, getComputedStyle(b).visibility, b.offsetParent ? 1 : 0]; })()`);
  out.btn = r; await page.click(r[0], r[1]);
  await must(`__game.scenes.current?.name === 'menu'`, 120000, 'menu');
  const g = [];
  for (let i = 0; i < 12; i++) { g.push(await ev(`({ w: +performance.now().toFixed(0), k: __game.audio.musicKey, g: +(__game.audio.musicLevel ?? -1).toFixed(3), g2: +(__game.audio.music?.gain?.gain?.value ?? -1).toFixed(3) })`)); await sleep(300); }
  out.menuGain = g; out.menuLog = await ev(`__game.audio.musicLog.slice(-3)`); await page.screenshot(`${D}/menu-after-end.png`);
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200)); out.winErr = await ev(`__err`);
} finally { save(); await done(); console.log('DONE'); }
