// batch13 ⑧ 复查：S3 quality=high 下洋红棋盘格（缺贴图占位）来源 — 读 __game.assets.loadStats
import { open, sleep, SH13 } from './b13lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b13-s3tex';
const q = process.argv[2] ?? 'high';
const { page, ev, must, url, rec, step, done } = await open(5577, { width: 960, height: 540 });
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 300000, 50); };
const out = {};
await step(T, 's3', async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=${q}`));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore'`, 400000, 's3');
  await ticks(120);
  out.stats = await ev(`(() => { const L = __game.assets.loadStats; return { n: L.length, pending: L.filter(s => !s.done).length, bad: L.filter(s => !s.ok || s.fallback || s.attempts > 1).map(s => ({ u: s.url.split('/').pop(), a: s.attempts, ok: s.ok, done: s.done, fb: !!s.fallback, e: (s.error ?? '').slice(0, 120) })) }; })()`);
  out.tier = await ev(`__game.quality?.tier ?? __s3.qualityTier ?? null`);
  rec(T, `S3 quality=${q} 贴图加载`, out.stats.bad.length ? 'WARN' : 'OK', out);
  await ev(`(() => { const s = __s3; s.puzzles.tide.set('low', { instant: true }); const w = s.frame.localToWorld(new s.rig.body.position.constructor(0.5, 0.25, 0.5)); s.rig.body.teleport(w); return 1; })()`);
  await ticks(40); await sleep(400); await page.screenshot(`${SH13}/s3tex-${q}.png`);
});
writeFileSync(`${SH13}/s3tex-${q}.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
