import { open, sleep, SH } from './b7lib.mjs';
const sizes = [[1280, 720], [960, 540], [600, 400]];
let port = 5305;
for (const [w, h] of sizes) {
  const o = await open(port++, { width: w, height: h });
  const { page, ev, must, url, rec, step, done } = o;
  for (const sc of ['testbed', 's1']) {
    await step('BUG-009', `${sc} ${w}x${h}`, async () => {
      await page.goto(url(`?smoke=1&debug=1&scene=${sc}`));
      await must(`!!__game?.scenes?.current?.rig && !__game.flow.transitioning`, 240000, sc);
      await must(`__game.input.context === 'explore'`, 120000, 'explore');
      await sleep(1500);
      await ev(`__game.events.emit('journal:updated', { docId: 'qa-probe' }); 1`);
      await sleep(700);
      const r = await ev(`(() => { const R = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
        const t = R('.toast-left'), hn = R('.hud-hint'); const kb = [...document.querySelectorAll('.hud-hint kbd')].map(k => Math.round(k.getBoundingClientRect().top));
        const hr = document.querySelector('.hud-hint')?.getClientRects(); const lines = new Set(kb).size;
        const inter = !!(t && hn && t[3] > hn[1] && t[1] < hn[3] && t[0] < hn[2] && t[2] > hn[0]);
        return { toast: t, hint: hn, hintH: hn ? hn[3] - hn[1] : null, kbdRows: lines, overlap: inter, toastText: document.querySelector('.toast-left')?.textContent?.trim(), inView: !!t && t[1] >= 0 && t[3] <= innerHeight }; })()`);
      await page.screenshot(`${SH}/bug009-${sc}-${w}.png`);
      rec('BUG-009', `${sc} ${w}x${h}`, r.toast && !r.overlap && r.inView ? 'PASS' : 'FAIL', r);
    });
  }
  console.log('ERRORS', w, JSON.stringify(page.errors));
  await done();
}
console.log('DONE'); process.exit(0);
