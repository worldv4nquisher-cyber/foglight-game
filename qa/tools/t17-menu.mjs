// batch17 ⑤ 探查：?scene=s3 直进 → mus-menu 是否在缓存；toMenu 后 musicKey / 增益
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5613, { width: 960, height: 540 });
const out = {};
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  out.has = await ev(`({ miss: [...__game.assets.missing], groups: __game.assets.loadedGroups.join(','), has: __game.assets.has('mus-menu'), buf: !!__game.assets.getAudio('mus-menu'), stat: __game.assets.loadStats.filter((x) => x.url.includes('mus-')).map((x) => [x.url.split('/').pop(), x.ok, x.done]) })`);
  await ev(`__game.flow.toMenu(), 1`);
  await must(`__game.scenes.current?.name === 'menu'`, 120000, 'menu');
  const g = []; for (let i = 0; i < 10; i++) { g.push(await ev(`({ k: __game.audio.musicKey, g: +(__game.audio.music?.gain?.gain?.value ?? -1).toFixed(3) })`)); await sleep(300); }
  out.g = g; out.log = await ev(`__game.audio.musicLog.slice(-3)`); out.errors = page.errors.slice(0, 5);
} finally { writeFileSync(`${SH}/t17-menu-${process.env.R||0}.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
