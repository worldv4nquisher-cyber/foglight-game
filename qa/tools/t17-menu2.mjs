import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5614, { width: 960, height: 540 });
const out = {};
try {
  for (const q of [`?smoke=1&debug=1&art=1`, `?smoke=1&debug=1&art=1&scene=s3`]) {
    await page.goto(url(q));
    await must(`!!window.__game?.scenes?.current && __game.scenes.current.name !== 'boot'`, 300000, 'boot');
    const r = [];
    for (let i = 0; i < 6; i++) { r.push(await ev(`({ sc: __game.scenes.current?.name, has: __game.assets.has('mus-menu'), miss: __game.assets.missing?.has?.('mus-menu') ?? null, groups: __game.assets.loadedGroups, k: __game.audio.musicKey })`)); await sleep(1500); }
    out[q] = r;
  }
  out.errors = page.errors.slice(0, 5); out.logs = (page.logs || []).filter((x) => String(x).includes('menu')).slice(0, 5);
} finally { writeFileSync(`${SH}/t17-menu2.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
