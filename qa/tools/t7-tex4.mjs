import { REPO_ROOT } from './paths.mjs';
import { open, sleep } from './b7lib.mjs';
const N = Number(process.env.N || 4); let port = 5320; const sum = {};
for (const mode of (process.env.MODES || 'noflag,flag').split(',')) {
  sum[mode] = [];
  for (let i = 0; i < N; i++) {
    process.env.QA_EXTRA = mode === 'flag' ? '--disable-extensions' : '';
    const { page, ev, must, url, done } = await open(port++);
    const reqs = new Map(); const fails = []; const t0 = Date.now();
    page.onEvent((m) => { const p = m.params ?? {};
      if (m.method === 'Network.requestWillBeSent' && /ktx2|glb|woff2|\.js|wasm/.test(p.request.url)) reqs.set(p.requestId, p.request.url.split('/').pop());
      if (m.method === 'Network.loadingFailed' && reqs.has(p.requestId)) fails.push({ t: Date.now() - t0, f: reqs.get(p.requestId), err: p.errorText }); });
    await page.send('Network.enable', {});
    await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
    const ok = await page.waitFor(`!!(window.__s1 && __s1.puzzles) && __game.input.context === 'explore'`, 300000, 300);
    await sleep(3000);
    const missing = ok ? await ev(`(() => { const out = new Set(); __s1.art.root.traverse(o => { if (o.isMesh && o.visible !== false) for (const m of [].concat(o.material)) if (m && m.name && /^mat-/.test(m.name) && !m.map) out.add(o.name.replace(/_lod\\d.*/, '') + '/' + m.name); }); return [...out]; })()`) : null;
    const fonts = ok ? await ev(`[...__game.assets.fontStats.values()].map(s => s.attempts)`) : null;
    const r = { i, ok, fails, consoleErr: page.errors.filter(e => /error/.test(e)).length, missingMaps: missing, fontAttempts: fonts };
    console.log(mode, JSON.stringify(r)); sum[mode].push(r);
    await page.screenshot((REPO_ROOT + '/docs/bugs/qa-v0.1-batch7/bug012-') + mode + '-' + i + '.png');
    await done(); await sleep(1500);
  }
}
for (const [m, rs] of Object.entries(sum)) console.log('SUMMARY', m, 'runs', rs.length, 'withCanceled', rs.filter(r => r.fails.length).length, 'withMissingMaps', rs.filter(r => r.missingMaps?.length).length, 'fontRetry', rs.filter(r => r.fontAttempts?.some(a => a > 1)).length);
process.exit(0);
