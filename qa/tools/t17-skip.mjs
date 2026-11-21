// batch17 ② 自测（真实 CDP 键盘）：结尾演出 / S1 开场建立镜头：短按 Space 不跳过；按住 1 s 圆环（右下）→ 跳过；结尾：0.75 s 淡出 + 0.75 s 黑场 → 结束页
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/skip`; mkdirSync(D, { recursive: true });
const PART = process.env.PART || 'end';
const { page, ev, must, url, done } = await open(5612, { width: 960, height: 540 });
const out = { part: PART };
const save = () => writeFileSync(`${D}/t17-skip-${PART}.json`, JSON.stringify(out, null, 1));
const hint = `(() => { const e = document.querySelector('.skip-hint'); if (!e) return null; const r = e.getBoundingClientRect(); const f = e.querySelector('.skip-hint-fill'); return { hidden: e.hidden, vis: __game.ui.skipHint.visible, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), off: f ? +getComputedStyle(f).strokeDashoffset.replace('px', '') : null, p: +__game.ui.skip.progress(performance.now()).toFixed(2), id: __game.ui.skip.id }; })()`;
const unlock = async () => { for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; } };
try {
  if (PART === 'end') {
    await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
    await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
    await unlock();
    await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
    await must(`!!__s3.endingMusic?.buffer && !!__s3.father && !!__s3.rig?.animator`, 300000, 'ready');
    out.pre = await ev(`({ has: __game.assets.has('mus-menu'), miss: [...__game.assets.missing], groups: __game.assets.loadedGroups.join(',') })`);
    await ev(`(() => { localStorage.clear(); window.__sk = []; const c = __s3.endingCutscene; const o = c.update.bind(c); c.update = () => { o(); __sk.push([+performance.now().toFixed(0), +c.t.toFixed(2), +__game.ui.fade.opacity.toFixed(3), +(__game.audio.music?.gain?.gain?.value ?? -1).toFixed(3), __game.audio.musicKey, __game.scenes.current?.name]); }; return 1; })()`);
    await ev(`__s3.lightTheLamp(), 1`);
    await must(`__s3.endingCutscene.t >= 12`, 300000, 't12');
    // 短按 0.15 s ×3
    for (let i = 0; i < 3; i++) { await page.keyDown('Space'); await sleep(150); out['tap' + i] = await ev(hint); await page.keyUp('Space'); await sleep(700); }
    await sleep(1500);
    out.afterTaps = await ev(`({ t: __s3.endingCutscene.t, endedBy: __s3.endingCutscene.endedBy, skipLog: __game.ui.skip.log.length, sc: __game.scenes.current?.name, hint: ${hint} })`);
    // 按住 1.4 s，每 0.2 s 采圆环
    out.hold = []; const h0 = Date.now(); await page.keyDown('Space');
    for (let i = 0; i < 8; i++) { const x = await ev(hint); out.hold.push({ ms: Date.now() - h0, ...(x || {}) }); if (i === 3) await page.screenshot(`${D}/skip-ring-end.png`); await sleep(150); }
    await page.keyUp('Space');
    out.skipInfo = await ev(`({ endedBy: __s3.endingCutscene.endedBy, log: __game.ui.skip.log.slice(-2), music: __game.audio.musicLog.slice(-2), now: performance.now() })`);
    await must(`__game.scenes.current?.name === 'chapter-end'`, 60000, 'chapter-end');
    out.endAt = await ev(`performance.now()`); await sleep(1500); await page.screenshot(`${D}/skip-end-page.png`);
    out.trace = (await ev(`__sk`)).slice(-40);
    out.prem = await ev(`({ has: __game.assets.has('mus-menu'), miss: [...__game.assets.missing] })`);
    const r = await ev(`(() => { const b = document.querySelector('.chapter-end [data-act="to-menu"]'); const q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
    await page.click(r[0], r[1]);
    await must(`__game.scenes.current?.name === 'menu'`, 120000, 'menu');
    out.menu = []; for (let i = 0; i < 10; i++) { out.menu.push(await ev(`({ w: +performance.now().toFixed(0), k: __game.audio.musicKey, g: +(__game.audio.music?.gain?.gain?.value ?? -1).toFixed(3) })`)); await sleep(300); }
    out.menuLog = await ev(`__game.audio.musicLog.slice(-2)`);
  } else {
    // S1 开场：新游戏 → 建立镜头
    await page.goto(url(`?smoke=1&debug=1&art=1&autostart=1`));
    await must(`!!window.__s1?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's1');
    await must(`__game.ui.skip.id === 'establishing' || __game.input.context === 'explore'`, 300000, 'estab');
    out.start = await ev(`({ id: __game.ui.skip.id, ctx: __game.input.context, skippable: __s1.cameraFollow.cutsceneSkippable, name: __s1.cameraFollow.cutsceneName })`);
    console.log('start', JSON.stringify(out.start));
    for (let i = 0; i < 2; i++) { await page.keyDown('Space'); await sleep(150); out['tap' + i] = await ev(hint); await page.keyUp('Space'); await sleep(600); }
    out.afterTaps = await ev(`({ ctx: __game.input.context, name: __s1.cameraFollow.cutsceneName, id: __game.ui.skip.id, hint: ${hint} })`);
    out.hold = []; const h0 = Date.now(); await page.keyDown('Space');
    for (let i = 0; i < 10; i++) { const x = await ev(`({ ctx: __game.input.context, name: __s1.cameraFollow.cutsceneName, h: ${hint} })`); out.hold.push({ ms: Date.now() - h0, ...x }); if (i === 3) await page.screenshot(`${D}/skip-ring-open.png`); await sleep(150); }
    await page.keyUp('Space');
    await sleep(2000); out.after = await ev(`({ ctx: __game.input.context, name: __s1.cameraFollow.cutsceneName, id: __game.ui.skip.id })`);
  }
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
