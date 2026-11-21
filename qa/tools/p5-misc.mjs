import { open, sleep, SH } from './b5lib.mjs';
const port = Number(process.env.PORT || 5274);
const sizes = [[1280, 720], [960, 540]];
for (const [w, h] of sizes) {
  const o = await open(port + (w === 1280 ? 0 : 1), { width: w, height: h });
  const { page, ev, must, url, rec, step, done } = o;
  for (const sc of ['s1', 'testbed']) {
    await step('toast', `${sc} ${w}x${h} toast vs hint`, async () => {
      await page.goto(url(`?smoke=1&debug=1&scene=${sc}`));
      await must(`!!__game?.scenes?.current?.rig && !__game.flow.transitioning`, 240000, sc);
      await must(`__game.input.context === 'explore'`, 60000, 'explore');
      await sleep(1000);
      await ev(`__game.events.emit('journal:updated', { docId: 'qa-probe' }); 1`);
      await sleep(600);
      const r = await ev(`(() => { const R = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; const t = R('.toast-left'), hn = R('.hud-hint'); const kb = [...document.querySelectorAll('.hud-hint kbd')].map(k => Math.round(k.getBoundingClientRect().top)); return { scene: __game.scenes.current.name, toast: t, hint: hn, hintTextTop: Math.min(...kb), lines: new Set(kb).size, overlap: !!(t && hn && t[3] > Math.min(...kb)) }; })()`);
      await page.screenshot(`${SH}/toast-${sc}-${w}.png`);
      rec('toast', `${sc} ${w}x${h}`, r.overlap ? 'FAIL' : 'PASS', r);
    });
  }
  if (w === 1280) {
    await step('push', 'testbed push 速度（fixedTick）', async () => {
      await page.goto(url(`?smoke=1&debug=1&scene=testbed`));
      await must(`!!window.__testbed?.rig && __game.input.context === 'explore'`, 240000, 'tb');
      await ev(`(() => { window.__ev = []; for (const n of ['interact:pushEnd']) __game.events.on(n, (e) => __ev.push({ n, e })); const tb = __testbed; const s = tb.samples.stands['sample-raft']; tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; tb.cameraFollow.yaw = s.facing + Math.PI; return 1; })()`);
      await sleep(1500);
      await page.keyDown('KeyE');
      const S = []; const end = Date.now() + 120000;
      while (Date.now() < end) { const s = await ev(`({ ft: __game.time.fixedTick, el: __game.time.elapsed, z: __testbed.scene.getObjectByName('sample-raft').position.z, end: __ev.length })`); S.push(s); if (s.end) break; await sleep(250); }
      await page.keyUp('KeyE');
      const mv = S.filter((s) => s.z > 6.8 && s.z < 9.3);
      const a = mv[0], b = mv[mv.length - 1];
      const vf = (b.z - a.z) / ((b.ft - a.ft) / 60), ve = (b.z - a.z) / (b.el - a.el);
      rec('push', '中段速度', Math.abs(vf - 0.8) < 0.05 && S.at(-1).end === 1 ? 'PASS' : 'FAIL', { vFixed: +vf.toFixed(3), vElapsed: +ve.toFixed(3), zEnd: S.at(-1).z, pushEnd: S.at(-1).end, samples: mv.length });
    });
    await step('lighthouse', '主场景 demo 灯塔 E 切换（15 s 内）', async () => {
      await page.goto(url(`?smoke=1&debug=1`));
      await must(`__game.scenes.current?.rig && __game.input.context === 'explore' && !__game.isPaused`, 240000, 'main');
      const sc = await ev(`__game.scenes.current.name`);
      const on0 = await ev(`__game.scenes.current.lighthouseOn`);
      await ev(`(() => { const s = __game.scenes.current; s.rig.body.teleport(new s.rig.body.position.constructor(11, 2.45, -8.3)); s.rig.controller.facing = Math.PI; return 1; })()`);
      const ok = await page.waitFor(`/E\\s*操作/.test(document.querySelector('.hud-prompt')?.hidden ? '' : document.querySelector('.hud-prompt')?.textContent ?? '')`, 10000, 200);
      const t0 = Date.now(); const f0 = await ev(`__game.time.fixedTick`);
      await page.tap('KeyE');
      const flipped = await page.waitFor(`__game.scenes.current.lighthouseOn !== ${on0}`, 15000, 100);
      const f1 = await ev(`__game.time.fixedTick`);
      rec('lighthouse', `${sc} 灯塔切换`, ok && flipped ? 'PASS' : 'FAIL', { prompt: ok, on0, flipped, wallMs: Date.now() - t0, fixedSec: +((f1 - f0) / 60).toFixed(2) });
    });
  }
  console.log('ERRORS', JSON.stringify(page.errors));
  await done();
}
console.log('PROBEDONE');
