// ⑤ 追查：menu 组音频间歇缺失的原因（捕获 console.info / warn、资源计时）
import { open, sleep, SH16 as SH } from './b17lib.mjs';
import { writeFileSync } from 'node:fs';
const { page, ev, must, url, done } = await open(5616, { width: 960, height: 540 });
const out = {};
try {
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cl = []; for (const m of ['info', 'warn', 'error']) { const o = console[m]; console[m] = (...a) => { try { __cl.push(m + ': ' + a.map((x) => (x instanceof Error ? x.name + ' ' + x.message : String(x))).join(' ').slice(0, 300)); } catch {} return o.apply(console, a); }; }
  const D = BaseAudioContext.prototype.decodeAudioData; BaseAudioContext.prototype.decodeAudioData = function (b, ...r) { const n = b?.byteLength; const p = D.call(this, b, ...r); p.catch?.((e) => __cl.push('decodeAudioData FAIL bytes=' + n + ' ' + (e?.name || '') + ' ' + (e?.message || e))); return p; };
  const F = window.fetch; window.fetch = function (...a) { return F.apply(this, a).catch((e) => { __cl.push('fetch FAIL ' + String(a[0]).split('/').pop() + ' ' + e); throw e; }); };
  const X = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u, ...r) { this.addEventListener('error', () => __cl.push('xhr error ' + String(u).split('/').pop())); this.addEventListener('abort', () => __cl.push('xhr abort ' + String(u).split('/').pop())); this.addEventListener('load', () => { if (this.status !== 200) __cl.push('xhr ' + this.status + ' ' + String(u).split('/').pop()); }); return X.call(this, m, u, ...r); };
  addEventListener('unhandledrejection', (e) => __cl.push('unhandled ' + (e.reason?.message || e.reason)));` });
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__game?.assets && __game.assets.loadedGroups.includes('menu')`, 300000, 'menu-group');
  await sleep(500);
  out.miss = await ev(`[...__game.assets.missing]`);
  out.cl = await ev(`__cl.filter((x) => /assets|audio|decode|menu|sfx|FAIL|xhr|unhandled/i.test(x)).slice(0, 20)`);
  out.res = await ev(`performance.getEntriesByType('resource').filter((e) => /\\.ogg|\\.mp3|\\.wav/.test(e.name)).map((e) => [e.name.split('/').pop(), e.responseStatus, Math.round(e.duration), e.transferSize])`);
  out.ctx = await ev(`({ state: __game.audio.context?.state, sr: __game.audio.context?.sampleRate })`);
} finally { writeFileSync(`${SH}/t17-boot-${process.env.R||0}.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
