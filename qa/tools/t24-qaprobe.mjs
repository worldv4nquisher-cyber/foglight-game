import { open, sleep, SH16 as SH } from './b24lib.mjs';
import { writeFileSync } from 'node:fs';
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const { page, ev, must, url, done } = await open(5762, { width: 1280, height: 720 });
const P = `({ href: location.href, t: typeof window.__qa, s: String(window.__qa).slice(0, 200), own: Object.getOwnPropertyDescriptor(window, '__qa') ? Object.keys(Object.getOwnPropertyDescriptor(window, '__qa')) : null, keys: window.__qa && typeof window.__qa === 'object' ? Object.keys(window.__qa).slice(0, 10) : null, el: !!document.getElementById('__qa'), named: document.getElementsByName('__qa').length, tag: window.__qa?.tagName ?? null, game: typeof window.__game })`;
const out = [];
try {
  await page.goto(url('')); await sleep(10000); out.push(await ev(P)); log(JSON.stringify(out.at(-1)));
  await page.goto(url('?debug=1')); await sleep(10000); out.push(await ev(P)); log(JSON.stringify(out.at(-1)));
} catch (e) { log('FAIL', String(e)); }
writeFileSync(`${SH}/hooks/t24-qaprobe.json`, JSON.stringify(out, null, 1));
await done(); process.exit(0);
