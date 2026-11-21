// batch9 ②：起停滑步，真 XiAnimator（art=1 testbed），停掉 rAF 手动 60 fps 一步一帧（fixedUpdate + update 各 1/60）
import { open, sleep } from './b8lib.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5421);
await page.goto(url('?smoke=1&debug=1&scene=testbed&art=1'));
await must(`!!window.__testbed?.rig?.animator && __game.scenes.current?.name === 'testbed' && __game.input.context === 'explore'`, 600000, 'testbed');
await sleep(3000);
await ev(`(() => { const g = __game, inp = g.input, oD = inp.isDown.bind(inp); window.__mv = 0; window.__sp = false;
  inp.getMove = () => ({ x: 0, y: window.__mv }); inp.isDown = (a) => a === 'sprint' ? window.__sp : oD(a);
  g.stop(); const sc = g.scenes.current, an = __testbed.rig.animator; const ST = { walk: 1.6, jog: 3.2 };
  window.__run = (n) => { const rows = []; for (let i = 0; i < n; i++) { sc.fixedUpdate(1 / 60); sc.update(1 / 60, 1);
      let num = 0, sw = 0; const ws = {}; for (const [name, s] of an.slots) { const m = /^xi-(idle|walk|jog)(-lantern)?$/.exec(name); if (!m) continue; sw += s.w; ws[m[1]] = (ws[m[1]] || 0) + s.w; if (m[1] !== 'idle') num += s.w * s.action.timeScale * ST[m[1]]; }
      const foot = num / Math.max(1, sw); rows.push({ v: an.speed, foot, slip: Math.abs(an.speed - foot), ws, state: an.state }); }
    return rows; };
  return 1; })()`);
const R = {};
const sumr = (rows) => ({ max: +Math.max(...rows.map(r => r.slip)).toFixed(3), cm: +(rows.reduce((a, r) => a + r.slip, 0) / 60 * 100).toFixed(2), vEnd: +rows.at(-1).v.toFixed(3), states: [...new Set(rows.map(r => r.state))] });
await step('b9-slip', '真动画器 60 fps 起停滑步', async () => {
  for (const [tag, sp, spStop] of [['走', false, false], ['跑', true, true], ['跑停（松 Shift）', true, false]]) {
    await ev(`(window.__mv = 0, window.__sp = false, __run(90), 1)`);
    const start = await ev(`(window.__mv = 1, window.__sp = ${sp}, __run(60))`);
    const stop = await ev(`(window.__mv = 0, window.__sp = ${spStop}, __run(60))`);
    R[tag] = { start: sumr(start), stop: sumr(stop), startPeakTick: start.findIndex(r => r.slip === Math.max(...start.map(x => x.slip))) };
  }
  const ok = Object.values(R).every(x => x.start.max < 0.5 && x.stop.max < 0.5);
  rec('b9-slip', '走 / 跑 / 跑停起停滑步峰值都 < 0.5 m/s（真 XiAnimator 权重 × timeScale × strideSpeed / max(1, Σw) 对比实际根速度）', ok ? 'PASS' : 'FAIL', R);
  rec('b9-slip', '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
});
save('t9-slip'); await done();
