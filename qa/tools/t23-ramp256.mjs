// batch23 ① 补：4 张 ramp 用 256 点采样（u = (i+0.5)/256），修后 / ?rampfix=0
import { open, sleep, SH16 as SH } from './b23lib.mjs';
import { RAMP_PROBE256 } from './ramp-probe256.mjs';
import { writeFileSync } from 'node:fs';
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = {}; const save = () => writeFileSync(`${SH}/ramp/t23-ramp256.json`, JSON.stringify(out, null, 1));
const { page, ev, must, url, done } = await open(5753, { width: 1280, height: 720 });
try {
  for (const [mode, q] of [['fix', ''], ['off', '&rampfix=0']]) {
    await page.goto(url(`?smoke=1&debug=1&art=1&quality=ultra&scene=s1${q}`));
    await must(`__game.scenes.current?.name?.startsWith('s1') && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's1');
    await sleep(2000); out[mode] = await ev(RAMP_PROBE256);
    for (const [n, p] of Object.entries(out[mode])) { const { samples, ...rest } = p ?? {}; log(mode, n, JSON.stringify(rest), samples ? samples.filter((_, i) => i % 16 === 0).join(',') + ',' + samples[255] : ''); }
    save();
  }
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
