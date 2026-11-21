// BUG-008：冷启动字体请求次数，带 / 不带 --disable-extensions，CPU 降速 8×
import { open, sleep } from './b7lib.mjs';
const N = Number(process.env.N || 6), CPU = Number(process.env.CPU || 8);
const modes = (process.env.MODES || 'noflag,flag').split(',');
let port = 5310;
const summary = {};
for (const mode of modes) {
  summary[mode] = [];
  for (let i = 0; i < N; i++) {
    process.env.QA_EXTRA = mode === 'flag' ? '--disable-extensions' : '';
    const P = await open(port++);
    const { page, ev, url } = P;
    const fails = []; const reqs = [];
    page.onEvent((m) => { const p = m.params ?? {};
      if (m.method === 'Network.requestWillBeSent' && /woff2/.test(p.request.url)) reqs.push(p.requestId);
      if (m.method === 'Network.loadingFailed' && reqs.includes(p.requestId)) fails.push({ err: p.errorText, canceled: p.canceled }); });
    await page.send('Network.enable', {});
    if (CPU > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await page.goto(url('?smoke=1'));
    const ok = await page.waitFor(`window.__game?.assets?.fontStats && [...__game.assets.fontStats.values()].length >= 2 && [...__game.assets.fontStats.values()].every(s => s.ok)`, 180000, 300);
    const st = ok ? await ev(`[...__game.assets.fontStats.values()].map(s => ({ f: s.family, a: s.attempts, ok: s.ok }))`) : await ev(`window.__game?.assets?.fontStats ? [...__game.assets.fontStats.values()] : null`).catch(() => null);
    const exts = await ev(`navigator.userAgent`).catch(() => null);
    const r = { i, ok, stats: st, woffReqs: reqs.length, woffFails: fails };
    summary[mode].push(r);
    console.log(mode, JSON.stringify(r));
    await P.done(); await sleep(1500);
  }
}
for (const [m, rs] of Object.entries(summary)) console.log('SUMMARY', m, `runs=${rs.length}`, `retry(attempts>1)=${rs.filter(r => r.stats?.some?.(s => s.a > 1)).length}`, `canceledWoff=${rs.filter(r => r.woffFails.length).length}`);
process.exit(0);
