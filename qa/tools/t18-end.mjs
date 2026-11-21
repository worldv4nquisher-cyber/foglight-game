// batch18 ① BUG-025 回归：PART=boot 冷启动主菜单第一首不淡入；PART=end S3 结尾（seek 到 100 s）→ 结束页 → 主菜单 2 s 淡入
import { open, sleep, SH16 as SH } from './b18lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/bug025`; mkdirSync(D, { recursive: true });
const PART = process.env.PART || 'end'; const VAR = process.env.VAR || 'seek';
const { page, ev, must, url, done } = await open(5621, { width: 960, height: 540 });
const out = { PART };
const save = () => writeFileSync(`${D}/t18-${PART}${PART === 'end' ? '-' + VAR : ''}.json`, JSON.stringify(out, null, 1));
const G = `({ w: +performance.now().toFixed(0), ct: +(__game.audio.context?.currentTime ?? -1).toFixed(3), k: __game.audio.musicKey, g: +(__game.audio.music?.gain?.gain?.value ?? -1).toFixed(3) })`;
const sample = async (n, dt) => { const g = []; for (let i = 0; i < n; i++) { g.push(await ev(G)); await sleep(dt); } return g; };
try {
  if (PART === 'boot') {
    await page.goto(url(`?smoke=1&debug=1&art=1`));
    await must(`__game.scenes.current?.name === 'menu' && __game.assets.loadedGroups.includes('menu')`, 600000, 'menu');
    out.miss = await ev(`[...__game.assets.missing]`);
    out.pre = await ev(`({ log: __game.audio.musicLog.slice(), st: __game.audio.context?.state })`);
    for (let i = 0; i < 5; i++) { await page.click(20, 20); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
    out.gain = await sample(10, 300);
    out.log = await ev(`__game.audio.musicLog.slice()`);
  } else {
    await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
    await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
    for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
    await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
    await must(`!!__s3.endingMusic?.buffer && !!__s3.father`, 300000, 'ready');
    await ev(`(localStorage.clear(), __s3.lightTheLamp(), 1)`);
    await must(`__s3.endingCutscene.t > 1`, 300000, 'start');
    if (VAR === 'seek') await ev(`(__s3.endingCutscene.seek(100), 1)`);
    if (VAR === 'skip') { await must(`__s3.endingCutscene.t > 3`, 300000, 't3'); await page.keyDown('Space'); await must(`__game.scenes.current?.name === 'chapter-end' || __s3.endingCutscene.endedBy`, 120000, 'skip'); await page.keyUp('Space'); }
    await must(`__game.scenes.current?.name === 'chapter-end'`, 900000, 'chapter-end');
    out.endedBy = await ev(`__s3.endingCutscene?.endedBy ?? null`);
    await sleep(2500);
    out.page = await ev(`({ key: __game.audio.musicKey, log: __game.audio.musicLog.slice() })`);
    const r = await ev(`(() => { const b = document.querySelector('.chapter-end [data-act="to-menu"]'); const q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
    await page.click(r[0], r[1]);
    await must(`__game.audio.musicKey === 'mus-menu'`, 120000, 'menu-music');
    out.gain = await sample(14, 200);
    out.log = await ev(`__game.audio.musicLog.slice(-3)`);
    out.miss = await ev(`[...__game.assets.missing]`);
  }
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
