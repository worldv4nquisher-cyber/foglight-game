// ② 追查：跳过提示 DOM 可见但截图里看不到 —— 主菜单上强制显示提示，查层叠
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5619, { width: 960, height: 540 });
const out = {};
try {
  await page.goto(url(`?smoke=1&debug=1&art=1`));
  await must(`__game.scenes.current?.name === 'menu'`, 300000, 'menu');
  await sleep(2000);
  await ev(`(() => { const s = __game.ui.skip; window.__offx = s.register({ id: 'qa', onSkip() {} }, performance.now() - 5000); s.anyKey(performance.now()); return 1; })()`);
  await sleep(1500);
  out.s = await ev(`(() => { const e = document.querySelector('.skip-hint'); const r = e.getBoundingClientRect(); const all = [...document.querySelectorAll('body > *, body > * > *')].map((x) => { const cs = getComputedStyle(x); const q = x.getBoundingClientRect(); return [x.tagName + '.' + String(x.className?.baseVal ?? x.className).slice(0, 40), cs.position, cs.zIndex, cs.opacity, cs.display, cs.visibility, Math.round(q.width) + 'x' + Math.round(q.height)]; }); return { vis: __game.ui.skipHint.visible, hidden: e.hidden, r: [r.x, r.y, r.width, r.height], parent: e.parentElement.className, all }; })()`);
  await page.screenshot(`${SH}/skip/hint-menu.png`);
  out.errors = page.errors.slice(0, 5);
} finally { writeFileSync(`${SH}/skip/t17-hint.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
