process.env.QA_GAME = '/workspace/game-studio/game';
process.env.QA_VITE = '/workspace/game-studio/game/node_modules';
const { open, sleep } = await import('/tmp/fp/b5lib2.mjs');
async function run(port) {
  const P = await open(port);
  const { page, ev, must, url } = P;
  const log = [];
  let t0 = null;
  page.onEvent((m) => {
    const p = m.params ?? {};
    const ts = p.timestamp ?? null; if (ts && t0 === null) t0 = ts;
    const T = ts ? +(ts - t0).toFixed(3) : null;
    if (m.method === 'Network.requestWillBeSent' && /\.woff2|index-|\.js$/.test(p.request.url)) {
      const st = p.initiator?.stack?.callFrames?.slice(0, 4).map((f) => `${f.functionName}@${f.url.split('/').pop()}:${f.lineNumber}`).join(' < ');
      log.push({ T, ev: 'req', id: p.requestId, url: p.request.url.split('/').pop(), type: p.type, init: p.initiator?.type, st, loader: p.loaderId, frame: p.frameId, docURL: p.documentURL.split('/').pop() });
    }
    if (m.method === 'Network.loadingFailed') log.push({ T, ev: 'fail', id: p.requestId, err: p.errorText, canceled: p.canceled, type: p.type });
    if (m.method === 'Network.responseReceived' && /woff2/.test(p.response.url)) log.push({ T, ev: 'resp', id: p.requestId, st: p.response.status });
    if (/^Page\.(frameNavigated|frameStartedLoading|frameRequestedNavigation|navigatedWithinDocument|loadEventFired|domContentEventFired|lifecycleEvent)$/.test(m.method)) {
      if (m.method === 'Page.lifecycleEvent' && !/init|commit|DOMContent|load$/.test(p.name)) return;
      log.push({ T, ev: m.method.slice(5), name: p.name, loader: p.loaderId, url: p.frame?.url ?? p.url });
    }
  });
  await page.addInit(`window.__fl = ['init']; try { (() => { const L = window.__fl; const t = () => +performance.now().toFixed(1);
    const of = window.fetch; window.fetch = function (u, i) { const p = of.call(this, u, i); if (!/woff2/.test(String(u))) L.push(['fetch*', t(), String(u).slice(-50)]); if (/woff2/.test(String(u))) { L.push(['fetch', t(), String(u).split('/').pop(), document.readyState]); p.then(() => L.push(['ok', t()]), (e) => L.push(['rej', t(), e && e.name, e && e.message, document.readyState])); } return p; };
    const ab = AbortController.prototype.abort; AbortController.prototype.abort = function (r) { L.push(['abort', t(), new Error().stack.split(String.fromCharCode(10)).slice(1, 4).join(' | ')]); return ab.call(this, r); };
    const st = window.stop; window.stop = function () { L.push(['stop', t()]); return st.call(this); };
    const hook = (obj, name, label) => { const o = obj[name]; if (typeof o !== 'function') return; obj[name] = function (...a) { L.push([label, t(), String(a[0]).slice(0, 60)]); return o.apply(this, a); }; };
    hook(HTMLCanvasElement.prototype, 'getContext', 'getContext'); hook(document.fonts, 'add', 'fonts.add'); hook(document.fonts, 'clear', 'fonts.clear'); hook(document.fonts, 'delete', 'fonts.delete');
    hook(window, 'requestAnimationFrame', 'raf1'); hook(history, 'replaceState', 'replaceState'); hook(history, 'pushState', 'pushState');
    const W = window.Worker; window.Worker = function (...a) { L.push(['Worker', t(), String(a[0]).slice(0, 60)]); return new W(...a); };
    hook(WebAssembly, 'instantiate', 'wasm'); hook(URL, 'createObjectURL', 'blobURL'); hook(window, 'open', 'open'); hook(Element.prototype, 'requestFullscreen', 'fs'); hook(Element.prototype, 'requestPointerLock', 'pl');
    const oxs = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { L.push(['xhr', t(), String(u).slice(-50)]); return oxs.apply(this, arguments); };
    for (const e of ['DOMContentLoaded', 'load', 'visibilitychange', 'pagehide', 'freeze', 'resume']) (e === 'load' || e === 'pagehide' ? window : document).addEventListener(e, () => L.push(['ev', t(), e, document.visibilityState]), true);
    document.fonts && document.fonts.addEventListener('loading', () => L.push(['fonts-loading', t()]));
  })(); } catch (e) { window.__fl.push(['initerr', String(e)]); }`);
  if (process.env.CPU) await page.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  if (!process.env.NONET) await page.send('Network.enable', {});
  await page.send('Page.setLifecycleEventsEnabled', { enabled: true });
  await page.goto(url('?smoke=1'));
  await must(`!!window.__game?.assets?.fontStats && [...__game.assets.fontStats.values()].length >= 2 && [...__game.assets.fontStats.values()].every(s => s.ok || s.error)`, 180000, 'fonts');
  await sleep(500);
  const stats = await ev(`[...__game.assets.fontStats.values()].map(s => s.attempts + (s.error ? ':' + s.error : ''))`);
  console.log('PORT', port, 'attempts', JSON.stringify(stats)); console.log('  FL', JSON.stringify(await ev('[typeof window.__qa, typeof window.__fl, JSON.stringify(window.__fl)]')));
  for (const l of log) if (/req|fail|resp|load|DOM/.test(l.ev + l.name) && !/\.js|css/.test(l.url ?? '')) console.log('  ', JSON.stringify(l));
  await P.done();
}
for (let p = 5291; p < 5291 + Number(process.env.N || 10); p++) { try { await run(p); } catch (e) { console.log('ERR', p, e.message); } }
process.exit(0);
