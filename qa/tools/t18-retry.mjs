// batch18 ② 补：CDP Fetch 让 menu 组几项（菜单曲 / UI 音效 / UI 图片）第一次请求 Aborted，看 6d908bf 的重试能否补回（不缺失）
import { open, sleep, SH16 as SH } from './b18lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/cold`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5661, { width: 960, height: 540 });
const out = { aborted: [], passed: [] }; const seen = new Set();
try {
  page.onEvent(async (m) => { if (m.method !== 'Fetch.requestPaused') return; const u = m.params.request.url.split('/').pop(); const k = u.split('?')[0];
    if (!seen.has(k)) { seen.add(k); out.aborted.push(u); await page.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' }); }
    else { out.passed.push(u); await page.send('Fetch.continueRequest', { requestId: m.params.requestId }); } });
  await page.send('Fetch.enable', { patterns: ['*mus-menu*', '*sfx-ui-confirm*', '*sfx-ui-back*', '*ui-icon-journal*', '*ui-panel-frame*'].map((p) => ({ urlPattern: p, requestStage: 'Request' })) });
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__game?.assets && __game.assets.loadedGroups.includes('menu')`, 600000, 'menu-group');
  await sleep(1000);
  out.miss = await ev(`[...__game.assets.missing]`);
  out.fails = await ev(`JSON.parse(JSON.stringify(__game.assets.loadFailures))`);
  out.has = await ev(`({ mus: __game.assets.has('mus-menu'), confirm: __game.assets.has('sfx-ui-confirm'), back: __game.assets.has('sfx-ui-back'), journal: __game.assets.has('ui-icon-journal'), frame: __game.assets.has('ui-panel-frame') })`);
  out.attempts = await ev(`__game.assets.loadStats.filter((x) => /mus-menu|sfx-ui-confirm|sfx-ui-back|ui-icon-journal|ui-panel-frame/.test(x.url)).map((x) => [x.url.split('/').pop(), x.attempts, x.ok, x.fallback ?? null])`);
  out.errors = page.errors.slice(0, 5).map((e) => String(e).slice(0, 200));
} catch (e) { out.err = String(e?.message ?? e); } finally { writeFileSync(`${D}/t18-retry.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
