// batch11：风吹钟 6–14 s（短跑，逐段打印）
import { open, sleep, EVLOG } from './b11lib.mjs';
const T = 'b11-wind';
const { page, ev, must, url, rec, step, done } = await open(5531);
await page.addInit(EVLOG);
await step(T, 'S1 风吹钟', async () => {
  await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
  await page.goto(url('?smoke=1&debug=1&scene=s1&art=1'));
  await must(`!!window.__s1?.puzzles && __game.input.context === 'explore' && !__s1.rig.controller.busy`, 400000, 's1');
  await page.click(640, 360, 'left'); await sleep(500);
  await ev(`(() => { const s = __s1, b = s.puzzles.bell.interactable, r = b.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(r.position.clone().setY(r.position.y + 0.03)); s.rig.body.velocity.set(0,0,0); return 1; })()`);
  const g0 = await ev('__game.time.fixedTick');
  const t0 = Date.now();
  for (;;) {
    const s = await ev(`({ ft: __game.time.fixedTick, ctx: __game.input.context, n: __ev.filter(e => e.n === 'sfx:play' && /bell-wind/.test(e.e?.id ?? '')).length })`);
    console.log('prog', s.ft - g0, s.ctx, s.n, Math.round((Date.now() - t0) / 1000) + 's');
    if (s.ft - g0 >= 60 * 50 || Date.now() - t0 > 900000) break;
    await sleep(20000);
  }
  const bw = await ev(`__ev.filter(e => e.n === 'sfx:play' && /bell-wind/.test(e.e?.id ?? '') && e.ft >= ${g0}).map(e => [e.ft, e.e.id, e.e.key ?? e.e.variant ?? null])`);
  const g1 = await ev('__game.time.fixedTick');
  const iv = bw.slice(1).map((x, i) => +((x[0] - bw[i][0]) / 60).toFixed(2));
  rec(T, `S1 钟旁 ${((g1 - g0) / 60).toFixed(1)} s 游戏时间：风吹轻响间隔 6–14 s`, iv.length >= 2 && iv.every(x => x >= 5.98 && x <= 14.02) && new Set(iv).size > 1 ? 'PASS' : 'FAIL', { firstAfterSec: bw.length ? +((bw[0][0] - g0) / 60).toFixed(2) : null, intervalsSec: iv, ev: bw.slice(0, 3) });
});
await done(); console.log('DONE');
