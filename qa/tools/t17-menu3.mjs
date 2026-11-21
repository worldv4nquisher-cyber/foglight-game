// ⑤ 追查：?scene=s3 全程轮询 mus-menu 是否在缓存，何时消失；再 toMenu
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5615, { width: 960, height: 540 });
const out = { poll: [] };
const P = async (tag) => { try { out.poll.push({ tag, w: Date.now(), ...(await ev(`({ sc: __game.scenes.current?.name, has: __game.assets.has('mus-menu'), groups: __game.assets.loadedGroups.join(','), k: __game.audio.musicKey, ctx: __game.input.context })`)) }); } catch (e) { out.poll.push({ tag, err: String(e).slice(0, 80) }); } };
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  for (let i = 0; i < 400; i++) { await P('load'); const l = out.poll.at(-1); if (l.sc === 's3-lighthouse' && l.k) break; await sleep(1500); }
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); await P('click'); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  for (let i = 0; i < 400; i++) { await P('explore'); if (out.poll.at(-1).ctx === 'explore') break; await sleep(1500); }
  await sleep(3000); await P('settled');
  await ev(`__game.flow.toMenu(), 1`);
  await must(`__game.scenes.current?.name === 'menu'`, 120000, 'menu');
  for (let i = 0; i < 4; i++) { await P('menu'); await sleep(800); }
  out.errors = page.errors.slice(0, 5);
} finally {
  // 压缩：只留状态变化
  out.poll = out.poll.filter((x, i, a) => i === 0 || i === a.length - 1 || JSON.stringify({ ...x, w: 0, tag: 0 }) !== JSON.stringify({ ...a[i - 1], w: 0, tag: 0 }));
  writeFileSync(`${SH}/t17-menu3.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE');
}
