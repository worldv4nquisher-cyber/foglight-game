// batch14 ① 030 UI 补充：主按钮悬停（找可见的 primary）、字体逐元素、9-slice/图标/favicon、懒加载失败兜底（屏蔽请求）
import { open, SH14 } from './b14lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b14-ui';
const mode = process.argv[2] ?? 'menu';
const { page, ev, must, url, rec, step, done } = await open(5592, { width: 1280, height: 720 });
const out = {};
const FONTS = `(() => { const m = {}; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length) continue; if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; const f = cs.fontFamily; (m[f] ??= []).length < 4 && m[f].push(e.tagName + '.' + String(e.className).slice(0, 30) + ':' + e.textContent.trim().slice(0, 10)); } return m; })()`;
const frames = async (n) => { const fr = await ev('__game.time.frame'); await must(`__game.time.frame >= ${fr + n}`, 300000, 'frames'); };
if (mode === 'menu') await step(T, 'menu', async () => {
  await page.goto(url('?smoke=1&art=1&quality=standard'));
  await must(`window.__game?.ui?.mainMenu?.isOpen && document.fonts.status === 'loaded'`, 400000, 'menu');
  await frames(5);
  out.fontsMenu = await ev(FONTS);
  out.prim = await ev(`[...document.querySelectorAll('.menu-btn.primary')].map(b => ({ t: b.textContent.trim(), vis: b.getClientRects().length > 0 && getComputedStyle(b).display !== 'none', r: (r => [r.x, r.y, r.width, r.height].map(Math.round))(b.getBoundingClientRect()) }))`);
  const p = await ev(`(() => { const b = [...document.querySelectorAll('.main-menu .menu-btn.primary')].find(b => b.getClientRects().length && b.getBoundingClientRect().width > 0); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const st = `(() => { const b = [...document.querySelectorAll('.main-menu .menu-btn.primary')].find(b => b.getBoundingClientRect().width > 0); const cs = getComputedStyle(b), be = getComputedStyle(b, '::before'); return { hover: b.matches(':hover'), color: cs.color, bc: cs.borderTopColor, beforeOp: be.opacity, beforeImg: be.borderImageSource.slice(0, 60), beforeTr: be.transition.slice(0, 60) }; })()`;
  out.primBefore = await ev(st);
  await page.mouse('mouseMoved', p.x, p.y); await frames(3); await new Promise(r => setTimeout(r, 600));
  out.primHover = await ev(st);
  await page.screenshot(`${SH14}/ui-qa/menu-hover-primary-720.png`);
  await page.mouse('mouseMoved', 5, 5);
  out.art = await ev(`(() => { const d = document.documentElement; const v = {}; for (const p of d.style) if (p.startsWith('--ui-img')) v[p] = d.style.getPropertyValue(p).slice(0, 50); const panel = document.querySelector('.settings-panel, .panel, .pause-panel'); return { vars: v, favicon: [...document.querySelectorAll('link[rel*=icon]')].map(l => l.rel + ' ' + l.href.split('/').pop()), logo: (e => e && { tag: e.tagName, src: (e.currentSrc || e.src || getComputedStyle(e).backgroundImage).slice(-40), ok: e.complete ?? null, w: e.naturalWidth ?? null })(document.querySelector('.ui-logo')) }; })()`);
  await ev(`(() => { __game.ui.mainMenu.openSettings(); return 1; })()`); await frames(3);
  out.fontsSettings = await ev(FONTS);
  out.panel = await ev(`(() => { const r = []; for (const e of document.querySelectorAll('*')) { const cs = getComputedStyle(e); if (cs.borderImageSource && cs.borderImageSource !== 'none' && e.getClientRects().length) r.push({ c: String(e.className).slice(0, 40), src: cs.borderImageSource.slice(-40), slice: cs.borderImageSlice, w: cs.borderImageWidth }); } return r.slice(0, 6); })()`);
  out.icons = await ev(`(() => { const r = {}; for (const e of document.querySelectorAll('*')) { for (const pe of ['', '::before', '::after']) { const cs = getComputedStyle(e, pe || null); const m = (cs.maskImage || cs.webkitMaskImage || ''); const mm = /ui-icon-[a-z-]+\\.svg/.exec(m); if (mm) r[mm[0]] = (r[mm[0]] ?? 0) + 1; } } return r; })()`);
  await page.screenshot(`${SH14}/ui-qa/settings-720.png`);
  rec(T, 'menu', 'INFO', out);
});
if (mode === 'fallback') await step(T, 'fallback', async () => {
  // 屏蔽 6 张纸 + 结尾插画 → 应退纯色；不屏蔽 ui-paper-note 做对照
  await page.send('Network.enable');
  await page.send('Network.setBlockedURLs', { urls: ['*ui-paper-journal*', '*ui-paper-letter*', '*ui-illust-chapter1-end*'] });
  await page.goto(url('?smoke=1&debug=1&art=1&quality=standard&autostart=1'));
  await must(`!!window.__s1?.rig && __game.scenes.current?.name === 's1-ebb-shore' && !!__s1.art`, 600000, 's1');
  await frames(5);
  out.lazyBefore = await ev(`performance.getEntriesByType('resource').filter(e => /ui-paper-|chapter1-end|ui-illust-menu/.test(e.name)).map(e => e.name.split('/').pop())`);
  out.fontsS1 = await ev(FONTS);
  out.read = {};
  for (const [k, doc] of [['journal', 'ch1.s2.journal.doc'], ['letter', 'ch1.s2.reply_draft.doc'], ['note', 'ch1.s1.neighbor_note.doc'], ['xi_note', 'ch1.s2.xi_note.doc'], ['ignition', 'ch1.s3.ignition_note.doc']]) {
    await ev(`(() => { __game.ui.reader.open(${JSON.stringify(doc)}); return 1; })()`);
    await must(`['ready', 'fallback'].includes(document.querySelector('.reader-paper').dataset.paper)`, 120000, 'paper ' + k);
    await frames(2);
    out.read[k] = await ev(`(() => { const p = document.querySelector('.reader-paper'); const cs = getComputedStyle(p); return { state: p.dataset.paper, key: p.dataset.paperKey, bgImg: cs.backgroundImage.slice(-50), bgColor: cs.backgroundColor, paperVar: p.style.getPropertyValue('--paper').slice(-40) }; })()`);
    if (k === 'journal' || k === 'note') await page.screenshot(`${SH14}/ui-qa/fallback-read-${k}.png`);
    await ev(`(() => { __game.ui.reader.close(false); return 1; })()`); await frames(2);
  }
  await ev(`(() => { void __game.flow.completeChapter(); return 1; })()`);
  await must(`__game.ui.chapterEnd.isOpen && ['ready', 'fallback'].includes(document.querySelector('.chapter-end-art').dataset.art)`, 300000, 'end');
  await frames(5); await new Promise(r => setTimeout(r, 800));
  out.end = await ev(`(() => { const a = document.querySelector('.chapter-end-art'); const cs = getComputedStyle(a); const b = [...document.querySelectorAll('.chapter-end .menu-btn, .chapter-end button')].map(b => (r => ({ t: b.textContent.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }))(b.getBoundingClientRect())); return { art: a.dataset.art, bgImg: cs.backgroundImage.slice(0, 80), bgColor: cs.backgroundColor, btn: b }; })()`);
  await page.screenshot(`${SH14}/ui-qa/fallback-end-720.png`);
  out.errors = page.errors.slice(0, 8);
  rec(T, 'fallback', 'INFO', out);
});
writeFileSync(`${SH14}/ui-qa/ui-${mode}.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
