import { open, sleep, SH } from './b6lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5289);
const T = 'v0.1-013';
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  for (const n of ['subtitle:show','subtitle:hide','interact:used']) v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed, now: performance.now() }));
} }); })();`);
const pos = () => ev(`(() => { const b = (window.__s1 ?? __game.scenes.current).rig.body; return { p: [b.position.x, b.position.y, b.position.z].map(v => +v.toFixed(3)), vy: +b.velocity.y.toFixed(3), onGround: b.onGround, ctx: __game.input.context }; })()`);
await step(T, '字幕时长（低负载）+ Space 推进字幕且不跳', async () => {
  await page.goto(url('?smoke=1&debug=1&autostart=1'));
  await must(`!!window.__s1 && __game.input.context === 'explore'`, 300000, 'S1');
  await must(`__game.benchmark.running === false`, 120000, 'bench done');
  await sleep(4000);
  const load = (await import('node:os')).loadavg()[0].toFixed(2);
  // 出生点「E 查看」（小船）→ 等自然消失
  const prompt = await ev(`document.querySelector('.hud-prompt')?.textContent`);
  let n0 = await ev(`__ev.length`);
  await page.tap('KeyE');
  await must(`__ev.slice(${n0}).some(x => x.n === 'subtitle:hide')`, 60000, 'hide');
  const seq = await ev(`__ev.slice(${n0}).filter(x => x.n.startsWith('subtitle'))`);
  const sh = seq.find(x => x.n === 'subtitle:show'), hd = seq.find(x => x.n === 'subtitle:hide');
  const text = await ev(`(() => { return null; })()`);
  rec(T, '字幕自动消失时长', hd?.e.reason === 'timeout' && Math.abs((hd.el - sh.el) - sh.e.duration) < 0.1 ? 'PASS' : 'FAIL', { load, prompt, id: sh?.e.id, duration: sh?.e.duration, frameSec: +(hd.el - sh.el).toFixed(3), fixedSec: +((hd.ft - sh.ft) / 60).toFixed(3), wallSec: +((hd.now - sh.now) / 1000).toFixed(3), reason: hd?.e.reason });
  // 再触发，显示中按 Space
  await sleep(500);
  n0 = await ev(`__ev.length`);
  await page.tap('KeyE');
  await must(`__ev.slice(${n0}).some(x => x.n === 'subtitle:show')`, 20000, 'show2');
  await sleep(300);
  const p0 = await pos();
  await page.keyDown('Space');
  const ys = []; for (let i = 0; i < 8; i++) { ys.push((await pos()).p[1]); await sleep(60); }
  await page.keyUp('Space');
  await sleep(500);
  const p1 = await pos();
  const seq2 = await ev(`__ev.slice(${n0}).filter(x => x.n.startsWith('subtitle'))`);
  const hd2 = seq2.find(x => x.n === 'subtitle:hide');
  const s2 = seq2.find(x => x.n === 'subtitle:show');
  rec(T, 'Space 推进字幕（同时不跳跃）', hd2?.e.reason === 'advance' && Math.max(...ys) - p0.p[1] < 0.02 ? 'PASS' : 'FAIL', { shownFor: hd2 ? +(hd2.el - s2.el).toFixed(2) : null, reason: hd2?.e.reason, y0: p0.p[1], ys, y1: p1.p[1], ctx: p1.ctx });
  // 无字幕时按 Space：会不会跳
  await sleep(2500);
  const p2 = await pos();
  await page.keyDown('Space'); const ys2 = []; for (let i = 0; i < 8; i++) { ys2.push((await pos()).p[1]); await sleep(60); } await page.keyUp('Space');
  rec(T, '无字幕时按 Space（a3da8e7 没有跳跃绑定）', 'INFO', { y0: p2.p[1], ys2 });
});
await step(T, 'S3「E 点灯」', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s3'));
  await must(`__game.input.context === 'explore' && !!__game.scenes.current?.rig`, 300000, 'S3');
  await sleep(1000);
  const sc = `__game.scenes.current`;
  const start = await pos();
  await page.keyDown('KeyW');
  const end = Date.now() + 120000; let pr = null;
  while (Date.now() < end) {
    await ev(`(() => { const s = ${sc}, p = s.rig.body.position; s.cameraFollow.yaw = Math.atan2(-(0 - p.x), -(-5 - p.z)); return 1; })()`);
    pr = await ev(`(() => { const e = document.querySelector('.hud-prompt'); return e && !e.hidden ? e.textContent.trim() : null; })()`);
    if (pr && /点灯/.test(pr)) break;
    await sleep(150);
  }
  await page.keyUp('KeyW');
  await page.screenshot(`${SH}/013-s3-ignite-prompt.png`);
  const n0 = await ev(`__ev.length`);
  await page.tap('KeyE');
  const used = await page.waitFor(`__ev.slice(${n0}).some(x => x.n === 'interact:used' && x.e.id === 's3-lamp')`, 20000, 100);
  rec(T, 'S3 灯塔交互提示「E 点灯」', pr === 'E 点灯' && used ? 'PASS' : 'FAIL', { prompt: pr, start: start.p, end: (await pos()).p, used });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE');
