import { REPO_ROOT } from './paths.mjs';
// 358a1a1 回归：BUG-014 书桌选择（art=0，默认视角 / 读完日志 / 抬头 / 低头）+ BUG-013 S2 直梯竖直速度（迈级到迈级口径，真按 W）
import { open, sleep } from './b8lib.mjs';
const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch8');
const { page, ev, must, url, rec, step, save, done } = await open(5409);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=0'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 600000, 's2');
await ev(`(() => { const s = __s2; window.__n = 0; window.__y = null; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; if (window.__y) { const p = s.rig.body.position; window.__y.push([window.__n, +p.x.toFixed(4), +p.y.toFixed(4)]); } }; return 1; })()`);
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 600000, 'ticks'); };
const prompt = () => ev(`document.querySelector('.hud-prompt')?.textContent ?? null`);
const cur = () => ev(`__s2.interaction.current?.id ?? null`);
const T = 'reg-BUG-014';
const stand = async (pitch, dyaw = 0) => { await ev(`(() => { const s = __s2; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(-4.6, 3.02, -0.25)); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = -Math.PI/2; s.cameraFollow.yaw = Math.PI/2 + ${dyaw}; ${pitch === null ? '' : `s.cameraFollow.pitch = ${pitch};`} return 1; })()`); await waitN(20); };
await step(T, '书桌默认视角 → 日志；读完 → 风灯；抬头 → 海图；低头 → 纸条', async () => {
  const pitch0 = await ev('__s2.cameraFollow.pitch');
  await stand(null);
  const d0 = { pitch: +pitch0.toFixed(3), cur: await cur(), prompt: await prompt() };
  await page.screenshot(`${SH}/reg358-bug014-default.png`);
  // 真 E 读日志
  await page.tap('KeyE');
  const opened = await page.waitFor(`__game.ui.reader.isOpen`, 120000, 100);
  await sleep(1000); await page.tap('Tab');
  await page.waitFor(`!__game.ui.reader.isOpen && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 120000, 100);
  await waitN(60);
  await stand(pitch0);
  const d1 = { cur: await cur(), prompt: await prompt(), lanternParent: await ev(`__s2.puzzles.lantern.parent?.name ?? null`) };
  const sweep = [];
  for (let p = -0.6; p <= 0.41; p += 0.05) { await stand(+p.toFixed(2)); sweep.push([+p.toFixed(2), +(await ev('__s2.cameraFollow.pitch')).toFixed(2), await cur()]); }
  const up = sweep.filter(s => s[1] > pitch0 + 0.01).map(s => s[2]), down = sweep.filter(s => s[1] < pitch0 - 0.01).map(s => s[2]);
  const ok = opened && d0.cur === 'journal-s2' && d1.cur === 'lantern-s2' && up.includes('chart-s2') && down.includes('xi-note-s2');
  rec(T, '书桌选择', ok ? 'PASS' : 'FAIL', { d0, opened, d1, sweep });
});
const T2 = 'reg-BUG-013';
await step(T2, 'S2 直梯竖直速度（迈级到迈级）', async () => {
  const rise = 3 / 16; const out = [];
  for (const [dir, sprint] of [[1, false], [1, true], [-1, false], [-1, true]]) {
    if (dir > 0) await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(-3.8, 0.1, -0.975)); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = Math.PI/2; s.cameraFollow.yaw = -Math.PI/2; s.cameraFollow.pitch = -0.2; return 1; })()`);
    else await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(1.3, 3.1, -0.975)); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = -Math.PI/2; s.cameraFollow.yaw = Math.PI/2; s.cameraFollow.pitch = -0.2; return 1; })()`);
    await waitN(40);
    const y0 = await ev('__s2.rig.body.position.y');
    await ev('(window.__y = [], 1)');
    if (sprint) await page.keyDown('ShiftLeft');
    await page.keyDown('KeyW'); await waitN(600); await page.keyUp('KeyW'); if (sprint) await page.keyUp('ShiftLeft');
    const ys = await ev('(() => { const r = window.__y; window.__y = null; return r; })()');
    const base = dir > 0 ? y0 : y0 - 3; const top = base + 3;
    const lo = base + 3 * rise + 0.05, hi = top - 3 * rise - 0.05;
    const st = []; for (let i = 1; i < ys.length; i++) if (Math.abs(ys[i][2] - ys[i - 1][2]) > 0.08 && ys[i][2] > lo && ys[i][2] < hi) st.push(i);
    const a = st[0], b = st.at(-1);
    const vy = st.length > 1 ? (ys[b][2] - ys[a][2]) / ((ys[b][0] - ys[a][0]) / 60) : null;
    // 端点法（对照）：纯楼梯段首末采样
    const seg = ys.filter(q => q[2] > lo && q[2] < hi); const vEnd = seg.length > 1 ? (seg.at(-1)[2] - seg[0][2]) / ((seg.at(-1)[0] - seg[0][0]) / 60) : null;
    out.push({ dir: dir > 0 ? 'up' : 'down', sprint, y0: +y0.toFixed(3), yEnd: ys.at(-1)?.[2], risers: st.length, vy: vy && +Math.abs(vy).toFixed(4), errPct: vy && +((Math.abs(vy) / 0.5455 - 1) * 100).toFixed(2), endpoint: vEnd && +Math.abs(vEnd).toFixed(4) });
  }
  const ok = out.every(o => o.risers >= 8 && Math.abs(o.errPct) <= 1);
  rec(T2, 'S2 直梯 0.5455 ±1%', ok ? 'PASS' : 'FAIL', out);
});
await step('reg', '页面错误', async () => rec('reg', '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors.slice(0, 5)));
save('t8-reg-s2'); await done();
