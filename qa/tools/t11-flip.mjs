// batch11 阅读器翻页音：多页文档点 › 真鼠标 → sfx-paper-flip-a~c、不连续重复、箭头本身不出 confirm
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-flip';
const { page, ev, must, url, rec, step, done, clickSel } = await open(5581);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore'`, 400000, 'S2');
await ev(`(() => { const a = __game.audio; window.__pb = []; const pb = a.playBuffer.bind(a); const key = (b) => { for (const [k, v] of __game.assets.audio) if (v === b) return k; return null; };
  a.playBuffer = (b, ...r) => { window.__pb.push(key(b)); return pb(b, ...r); }; return 1; })()`);
await step(T, '翻页', async () => {
  let doc = null;
  for (const d of ['ch1.s2.journal.doc', 'ch1.s3.logbook.doc', 'ch1.s1.notice.doc']) { const ok = await ev(`(() => { try { const r = __game.ui.reader.open('${d}'); return r && __game.ui.reader.pageCount > 1 ? __game.ui.reader.pageCount : (__game.ui.reader.close?.(), 0); } catch (e) { return 0; } })()`); if (ok) { doc = [d, ok]; break; } }
  if (!doc) { const ids = await ev(`Object.keys(window.__TEXT ?? {}).filter(k => /\\.doc$/.test(k)).slice(0, 20)`).catch(() => null); rec(T, '找多页文档', 'UNVERIFIED', { ids }); return; }
  await sleep(1500);
  const n0 = (await ev('__pb.length'));
  const flips = Math.min(4, doc[1] - 1);
  for (let i = 0; i < flips; i++) {
    await clickSel('.reader-arrow[data-act="next"]'); await sleep(1500);
  }
  const pb = (await ev('__pb')).slice(n0), fl = pb.filter(k => /paper-flip/.test(k));
  rec(T, `多页文档 ${doc[0]}（${doc[1]} 页）点 › ${flips} 次：sfx-paper-flip-a~c 各一声、不连续重复、箭头不出 confirm`, fl.length === flips && fl.every((k, i) => !i || k !== fl[i - 1]) && !pb.includes('sfx-ui-confirm') ? 'PASS' : 'FAIL', { pb, page: await ev('__game.ui.reader.page ?? null') });
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
