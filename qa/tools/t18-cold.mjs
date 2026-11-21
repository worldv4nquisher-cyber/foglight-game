// batch18 ② 冷启动（每次新 Chrome 新 profile）：MODE=s3|menu，记可选资源缺失 / loadFailures / 主菜单曲
import { open, sleep, SH16 as SH } from './b18lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/cold`; mkdirSync(D, { recursive: true });
const MODE = process.env.MODE || 's3', R = process.env.R || '0';
const { page, ev, must, url, done } = await open(5630 + (+R % 10), { width: 960, height: 540 });
const out = { MODE, R };
try {
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cl = []; for (const m of ['info', 'warn', 'error']) { const o = console[m]; console[m] = (...a) => { try { __cl.push(m + ': ' + a.map((x) => (x instanceof Error ? x.name + ' ' + x.message : String(x))).join(' ').slice(0, 300)); } catch {} return o.apply(console, a); }; }` });
  await page.goto(url(MODE === 's3' ? `?smoke=1&debug=1&art=1&scene=s3` : `?smoke=1&debug=1&art=1`));
  if (MODE === 's3') await must(`!!window.__s3?.rig && __game.assets.loadedGroups.includes('menu') && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3');
  else await must(`__game.scenes.current?.name === 'menu' && __game.assets.loadedGroups.includes('menu')`, 600000, 'menu');
  await sleep(500);
  const snap = async () => ({ miss: await ev(`[...__game.assets.missing]`), fails: await ev(`(() => { const f = __game.assets.loadFailures; return f ? JSON.parse(JSON.stringify(f instanceof Map ? [...f] : f)) : null; })()`).catch((e) => 'ERR ' + e),
    hasMenu: await ev(`__game.assets.has('mus-menu')`), retried: await ev(`__game.assets.loadStats.filter((x) => x.attempts > 1).map((x) => x.url.split('/').pop() + '×' + x.attempts)`).catch(() => null), cl: await ev(`__cl.filter((x) => /可选资源缺失|retry|重试|fail|失败/i.test(x)).slice(0, 30)`) });
  out.load = await snap();
  for (let i = 0; i < 5; i++) { await page.click(20, 20); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  if (MODE === 's3') { await ev(`(__game.flow.toMenu(), 1)`); await must(`__game.scenes.current?.name === 'menu'`, 300000, 'toMenu'); await sleep(1500); }
  out.menu = { key: await ev(`__game.audio.musicKey`), log: await ev(`__game.audio.musicLog.slice(-2).map((x) => [x.op, x.key, x.fade])`) };
  out.end = await snap();
  out.errors = page.errors.slice(0, 5).map((e) => String(e).slice(0, 200));
} catch (e) { out.err = String(e?.message ?? e); } finally { writeFileSync(`${D}/${MODE}-${R}.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
