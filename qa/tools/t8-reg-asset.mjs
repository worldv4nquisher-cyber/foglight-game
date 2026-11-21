import { REPO_ROOT } from './paths.mjs';
// 358a1a1 回归 BUG-012：GLB / 外部 KTX2 首次请求全部 Aborted → 重试成功；一张贴图一直失败 → 2 次重试后棋盘格 + assets-fallback；每个 URL 请求次数 = attempts
import { open, sleep } from './b8lib.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5408);
const T = 'reg-BUG-012';
const cnt = new Map(); let victim = null;
page.onEvent(async (m) => {
  if (m.method !== 'Fetch.requestPaused') return;
  const u = m.params.request.url.split('?')[0]; const n = (cnt.get(u) ?? 0) + 1; cnt.set(u, n);
  if (!victim && /tex-rock-shore.*albedo.*\.ktx2$/.test(u)) victim = u;
  try {
    if (n === 1 || u === victim) await page.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' });
    else await page.send('Fetch.continueRequest', { requestId: m.params.requestId });
  } catch (e) { console.log('fetch err', e.message); }
});
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*.glb*' }, { urlPattern: '*.ktx2*' }] });
await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
await step(T, '首请求全取消 + 一张贴图一直失败', async () => {
  const okw = await page.waitFor(`!!window.__s1 && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every(s => s.done)`, 600000, 500);
  if (!okw) { console.log('DIAG', JSON.stringify(await ev(`({ s1: !!window.__s1, scene: __game?.scenes?.current?.constructor?.name, stats: __game?.assets?.loadStats?.filter(s => !s.done).slice(0, 5), n: __game?.assets?.loadStats?.length, cls: document.documentElement.className })`)), JSON.stringify([...cnt].slice(0, 10)), page.errors.slice(0, 5)); throw new Error('assets not done'); }
  await sleep(3000);
  const stats = await ev(`__game.assets.loadStats`);
  const r = await ev(`(() => { let checker = 0, mags = 0; const seen = new Set(); const px = (img) => { try { const c = img.getContext ? img : null; if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; } catch { return null; } };
    __game.scenes.current.scene.traverse(o => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) { const t = m.map; if (t && t.image && t.image.width === 64 && t.image.height === 64 && t.image.getContext) { const c = px(t.image); checker++; if (c && c[0] === 255 && c[1] === 0 && c[2] === 255) { mags++; seen.add(o.name); } } } });
    return { checker, magenta: mags, objs: [...seen].slice(0, 8), cls: document.documentElement.classList.contains('assets-fallback') }; })()`);
  const per = stats.map(s => ({ u: s.url.split('/').pop(), kind: s.kind, attempts: s.attempts, ok: s.ok, fb: !!s.fallback, req: cnt.get(s.url.split('?')[0]) ?? null }));
  const vic = per.find(p => victim && victim.endsWith(p.u));
  const others = per.filter(p => p !== vic);
  const mism = per.filter(p => p.req !== null && p.req !== p.attempts);
  const errs = page.errors.filter(e => /tex-rock-shore|失败|fallback/i.test(e)).slice(0, 3);
  const ok = vic && vic.attempts === 3 && vic.fb && !vic.ok && others.every(p => p.ok && p.attempts === 2) && !mism.length && r.cls && r.magenta > 0;
  rec(T, 'GLB/KTX2 重试 ≤2 次、每 URL 只下载一份、最终失败棋盘格', ok ? 'PASS' : 'FAIL', { victim: vic, n: per.length, glb: others.filter(p => p.kind === 'glb').length, ktx2: others.filter(p => p.kind === 'ktx2').length, othersNotOk: others.filter(p => !p.ok || p.attempts !== 2).slice(0, 5), reqMismatch: mism.slice(0, 5), maxReqPerUrl: Math.max(...cnt.values()), ...r, errs, allErrs: page.errors.length });
  await page.screenshot((REPO_ROOT + '/docs/bugs/qa-v0.1-batch8/reg358-bug012-checker.png'));
});
save('t8-reg-asset'); await done();
