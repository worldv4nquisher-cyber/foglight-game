import { open, sleep, SH } from './b5lib.mjs';
const T = '字体';
const out = [];
async function run(port, block) {
  const P = await open(port);
  const { page, ev, must, url } = P;
  const net = new Map();
  page.onEvent((m) => {
    const p = m.params ?? {};
    if (m.method === 'Network.requestWillBeSent' && /\.woff2/.test(p.request.url)) net.set(p.requestId, { url: p.request.url.split('/').pop(), t: +(p.timestamp).toFixed(3), status: null, done: false, failed: null, canceled: null, fromCache: false });
    const r = net.get(p.requestId); if (!r) return;
    if (m.method === 'Network.responseReceived') { r.status = p.response.status; r.fromCache = !!(p.response.fromDiskCache || p.response.fromMemoryCache); }
    if (m.method === 'Network.loadingFinished') r.done = true;
    if (m.method === 'Network.loadingFailed') { r.failed = p.errorText; r.canceled = !!p.canceled; r.blocked = p.blockedReason ?? null; }
  });
  await page.send('Network.enable', {});
  if (block) await page.send('Network.setBlockedURLs', { urls: ['*.woff2'] });
  await page.goto(url('?smoke=1'));
  await must(`!!window.__game?.assets?.fontStats && [...__game.assets.fontStats.values()].length >= 2 && [...__game.assets.fontStats.values()].every(s => s.ok || s.error)`, 180000, 'fonts settled');
  await must(`!!document.querySelector('[data-act="new"]')`, 180000, 'menu');
  await sleep(1500);
  const stats = await ev(`[...__game.assets.fontStats.values()].map(s => ({ ...s, url: s.url.split('/').pop() }))`);
  const doc = await ev(`({ fallbackClass: document.documentElement.classList.contains('fonts-fallback'), faces: [...document.fonts].map(f => f.family + ':' + f.status), uiFont: getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim().slice(0, 120), menuFont: getComputedStyle(document.querySelector('[data-act="new"]')).fontFamily.slice(0, 120), menuText: document.querySelector('[data-act="new"]').textContent.trim(), perf: performance.getEntriesByType('resource').filter(e => /woff2/.test(e.name)).map(e => ({ n: e.name.split('/').pop(), size: e.transferSize, dur: +e.duration.toFixed(0), status: e.responseStatus })), ua: navigator.userAgent })`);
  const name = block ? 'font-blocked-fallback' : `font-cold-${port}`;
  await page.screenshot(`${SH}/${name}.png`);
  const r = { port, block, stats, net: [...net.values()], doc, errors: page.errors };
  console.log(JSON.stringify(r)); out.push(r);
  await P.done();
}
for (const p of [5266, 5267, 5268]) { try { await run(p, false); } catch (e) { console.log('ERR', p, e.message); } }
try { await run(5269, true); } catch (e) { console.log('ERR block', e.message); }
process.exit(0);
