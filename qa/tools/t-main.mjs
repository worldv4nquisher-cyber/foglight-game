import { launch, sleep } from './cdp.mjs';
import { startPreview, startDev } from './server.mjs';
import { HELPER, SHOTS, makeRecorder } from './common.mjs';
const { rec, save } = makeRecorder('main');
const prev = await startPreview(5207);
const INIT = `(() => { const f = () => { const g = window.__game;
  if (g && g.time.frame >= 1 && !window.__qaFirst) window.__qaFirst = { t: performance.now(), scene: g.scenes.current?.name };
  if (g && g.scenes.current?.name === 'main' && !window.__qaMainEnter) window.__qaMainEnter = performance.now();
  if (g && g.scenes.current?.name === 'main' && g.scenes.current.cameraFollow && !window.__qaHold) {
    window.__qaHold = true; g.input.setRaw('qa', 'KeyW', true);
    const s = g.scenes.current, cf = s.cameraFollow, p0 = s.rig.body.position.clone(), c0 = cf.clock, out = [];
    window.__qaEst = out; window.__qaP0 = p0;
    const h = () => { out.push({ t: cf.clock - c0, m: cf.modeName, b: cf.blending, ctx: g.input.context, d: Math.hypot(s.rig.body.position.x - p0.x, s.rig.body.position.z - p0.z), now: performance.now() });
      if (cf.clock - c0 < 7) requestAnimationFrame(h); else g.input.setRaw('qa', 'KeyW', false); };
    requestAnimationFrame(h);
  }
  requestAnimationFrame(f); }; requestAnimationFrame(f); })();`;
const loads = [];
for (let i = 0; i < 3; i++) {
  const { page, close } = await launch();
  await page.addInit(HELPER);
  await page.addInit(INIT);
  await page.goto(prev.url + '/?smoke=1');
  await page.waitFor(`window.__qaEst && window.__qaEst.length && window.__qaEst[window.__qaEst.length-1].t >= 7`, 120000);
  const r = await page.evaluate(`({ first: window.__qaFirst, mainEnter: window.__qaMainEnter, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, transfer: n.transferSize }; })(),
    bytes: performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || 0), 0), res: performance.getEntriesByType('resource').length,
    est: window.__qaEst })`);
  if (i === 0) await page.screenshot(`${SHOTS}/003-main-after-establishing.png`);
  loads.push(r);
  console.log('ERR', page.errors.length, page.errors.slice(0, 2));
  close();
}
for (const r of loads) console.log(JSON.stringify({ first: r.first, mainEnter: r.mainEnter?.toFixed(0), fcp: r.fcp?.toFixed(0), nav: r.nav, bytes: r.bytes, res: r.res }));
const est = loads[0].est;
const handIdx = est.findIndex((o) => o.m === 'explore');
const tEnd = est[handIdx]?.t;
const backIdx = est.findIndex((o, i) => i >= handIdx && o.m === 'explore' && !o.b);
const during = est.slice(0, handIdx);
const movedDuring = Math.max(...during.map((o) => o.d));
const final = est[est.length - 1];
console.log(JSON.stringify(est.filter((_, i) => i % 3 === 0).map((o) => [o.t.toFixed(2), o.m, o.b ? 'B' : '', o.ctx, o.d.toFixed(2)])));
rec('v0.1-003', '进入主场景 3 s 建立镜头，期间角色不能移动，结束交还控制', tEnd > 2.85 && tEnd < 3.3 && movedDuring < 0.01 && final.d > 0.5 ? 'PASS' : 'FAIL',
  `从进入主场景起按住 W：建立镜头 ${tEnd?.toFixed(2)} s（相机时钟），期间上下文 ${[...new Set(during.map((o) => o.ctx))].join('/')}、角色最大位移 ${movedDuring.toFixed(3)} m；交还过渡结束于 ${est[backIdx]?.t.toFixed(2)} s；7 s 时角色已走出 ${final.d.toFixed(2)} m（证明 W 一直按着、交还后能走）`);
save();
await prev.close(); process.exit(0);
