// batch24 ③ __qa 钩子：生产构建正常 URL 下不存在；?smoke=1 下 puzzles/save/saveData/diff/scene 可用；dev 下存在
import { open, sleep, SH16 as SH } from './b24lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/hooks`; mkdirSync(D, { recursive: true });
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = {}; const save = () => writeFileSync(`${D}/t24-hooks${process.env.DEV ? '-dev' : ''}.json`, JSON.stringify(out, null, 1));
const DEV = !!process.env.DEV;
const { page, ev, must, url, done } = await open(DEV ? 5761 : 5760, { dev: DEV, width: 1280, height: 720 });
const pres = `({ qa: typeof window.__qa, game: typeof window.__game, perf: typeof window.__perfSpot, menu: !!document.querySelector('.main-menu') && document.querySelector('.main-menu').checkVisibility(), scene: null })`;
try {
  if (DEV) {
    await page.goto(url(''));
    await must(`!!document.querySelector('.main-menu') && document.querySelector('.main-menu').checkVisibility()`, 600000, 'menu');
    out.devPlain = await ev(pres); log('dev plain', JSON.stringify(out.devPlain));
    out.devScene = await ev(`window.__qa ? __qa.scene() : null`); out.devPuzzlesMenu = await ev(`window.__qa ? __qa.puzzles() : 'no'`);
    log('dev scene', JSON.stringify(out.devScene), JSON.stringify(out.devPuzzlesMenu));
  } else {
    for (const q of ['', '?debug=1', '?autostart=1', '?debug=1&scene=s2&art=0&autostart=1']) {
      await ev(`localStorage.clear(), 1`).catch(() => 0);
      await page.goto(url(q));
      await sleep(1500);
      await must(`document.readyState === 'complete'`, 120000);
      // 等 boot 跑完（主菜单出现或场景开始加载）
      await page.waitFor(`(!!document.querySelector('.main-menu') && document.querySelector('.main-menu').checkVisibility()) || !!document.querySelector('canvas')`, 120000, 300);
      await sleep(8000);
      const r = await ev(pres); r.q = q; (out.prod ??= []).push(r); log('prod', q, JSON.stringify(r));
    }
    // ?smoke=1
    await ev(`localStorage.clear(), 1`);
    await page.goto(url('?smoke=1'));
    await must(`!!window.__qa && !!document.querySelector('.main-menu') && document.querySelector('.main-menu').checkVisibility()`, 600000, 'smoke menu');
    out.menu = await ev(`({ pres: ${pres}, keys: Object.keys(__qa), puzzles: __qa.puzzles(), save: __qa.save(), saveData: __qa.saveData(), scene: __qa.scene() })`); log('menu', JSON.stringify(out.menu));
    for (const sc of ['s1', 's2', 's3']) {
      await page.goto(url(`?smoke=1&debug=1&scene=${sc}&art=0&autostart=1`));
      await must(`!!window.__qa && __game.input.context === 'explore' && !__game.flow.transitioning && !!__qa.puzzles()`, 600000, sc);
      await sleep(1500);
      const r = await ev(`(() => { const a = __qa.puzzles(); return { a, again: __qa.diff(a, __qa.puzzles()), save: __qa.save(), saveData: __qa.saveData(), scene: __qa.scene(), json: JSON.stringify(a) === JSON.stringify(JSON.parse(JSON.stringify(a))) }; })()`);
      out[sc] = r; log(sc, JSON.stringify(r).slice(0, 1500));
    }
    // S3 里改状态：敲钟（谜题状态变）→ diff 非空
    out.s3change = await ev(`(async () => { const a = __qa.puzzles(); __game.events.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }); __s3.tides.fixedUpdate(7); await new Promise((r) => setTimeout(r, 1500)); const b = __qa.puzzles(); return { d: __qa.diff(a, b), b }; })()`);
    log('s3change', JSON.stringify(out.s3change).slice(0, 1200));
    out.synthetic = await ev(`({ same: __qa.diff({ a: 1, b: [1, 2], c: { d: null } }, { a: 1, b: [1, 2], c: { d: null } }), diff: __qa.diff({ a: 1, b: [1, 2], c: { d: 1 } }, { a: 2, b: [1, 3], c: { d: 1 }, e: true }), nulls: __qa.diff(null, { a: 1 }) })`);
    log('synthetic', JSON.stringify(out.synthetic));
    out.badSave = await ev(`(() => { const k = 'foglight.save.v1'; const old = localStorage.getItem(k); localStorage.setItem(k, '{bad'); const bad = __qa.save(); localStorage.removeItem(k); const none = __qa.save(); if (old !== null) localStorage.setItem(k, old); return { bad, none }; })()`);
    log('badSave', JSON.stringify(out.badSave));
  }
  out.errors = page.errors.slice(0, 10);
  save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
await done(); process.exit(0);
