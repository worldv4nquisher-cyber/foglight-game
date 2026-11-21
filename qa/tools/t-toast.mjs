import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5241);
const { page, ev, must, url } = P;
await page.goto(url('?smoke=1')); await must(`!!window.__game`, 120000); await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1&scene=testbed')); await must(`!!window.__testbed`, 180000);
await sleep(3000);
const r = await ev(`(async () => { const t = document.querySelector('.toast-left'); const log = []; const t0 = performance.now();
  __game.ui.reader.open('ch1.s1.notice.doc');
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); const vis = !t.hidden; let top = null; if (vis) { const b = t.getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); top = e === t || t.contains(e) ? 'toast' : (e.className || e.tagName); }
    log.push([Math.round(performance.now() - t0), vis, top, __game.ui.reader.isOpen]); if (!vis && i > 3) break; }
  return { log, z: getComputedStyle(t).zIndex, rz: getComputedStyle(document.querySelector('.reader')).zIndex }; })()`);
await page.screenshot(`${SH}/005-toast-under-reader.png`);
console.log(JSON.stringify(r));
await P.done(); process.exit(0);
