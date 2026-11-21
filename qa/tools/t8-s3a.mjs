// batch8 ①：S3 跳过油阀路线（真按键）：门外台阶 / 敲钟 / 开门 / 三面镜子 / 闪光共鸣 / R 只重置当前镜 / 没有油 / 提示停在油阀 / 开阀起计时
import { s3, sleep, SH } from './b8s3.mjs';
const T = '015';
const S = await s3(5401);
const { page, ev, must, rec, step, done, ft, waitSec, evs, loc, tpL, aimL, hold, prompt, angs, turnTo, pressE } = S;
const P = `__s3.puzzles`;
const st = () => ev(`(() => { const p = ${P}, b = p.beam; return { ft: __game.time.fixedTick, tide: p.tide.state, tr: p.tide.transitioning, door: p.state.doorOpen, valve: p.state.valveOpen, reached: p.state.reached, flashes: p.state.flashes, ig: b.igniter.state, sky: b.sky.lit, skyAlways: b.sky.alwaysOn, W: b.mirrors.window.part.angles.slice(), A: b.mirrors.a.part.angles[0], B: b.mirrors.b.part.angles[0], ctx: __game.input.context, cur: __s3.interaction.current?.id ?? null, lever: p.leverIx.enabled, goal: __game.narrative.goal, done: [...(__s3.hints.puzzles.get('p5')?.doneSteps ?? [])] }; })()`);
const hintH = async () => { await ev(`__s3.hints.debugSetTime('p5', 700), 1`); await waitSec(0.2); const f0 = await ft(); await page.keyDown('KeyH'); await sleep(200); await page.keyUp('KeyH'); await waitSec(0.5);
  const r = await ev(`(() => { const v = __s3.hints.view(); return { step: v.step, ids: v.lines.map(l => l.textId), hl: [...__s3.hints.highlightIds()] }; })()`);
  r.shown = (await evs('hint:show', f0)).map(x => x.e); await page.keyDown('KeyH'); await sleep(200); await page.keyUp('KeyH'); await waitSec(0.3); return r; };
const sky = () => must(`${P}.beam.sky.lit`, 900000, 'sky lit');
const t0 = await ft();
rec(T, '进场', 'INFO', { ...(await st()), pos: await loc() });

await step(T, '门外台阶可走（桥 → 3 级台阶 → 门外平台 → 回桥）', async () => {
  const s = (v) => [-0.7071 * v, -0.7071 * v];
  const [x, z] = s(10.2), [fx, fz] = s(3);
  await tpL(x, 3.05, z, fx, fz); await waitSec(0.5);
  const ys = [];
  await page.keyDown('KeyW');
  const ok = await page.waitFor(`(() => { const p = __s3.frame.worldToLocal(__s3.rig.body.position.clone()); return -(p.x + p.z) / Math.SQRT2 < 6.6; })()`, 400000, 300);
  await page.keyUp('KeyW'); await waitSec(0.5);
  const a = await loc();
  await tpL(...[a[0], a[1], a[2]], ...s(12)); await waitSec(0.3);
  await page.keyDown('KeyW');
  const ok2 = await page.waitFor(`(() => { const p = __s3.frame.worldToLocal(__s3.rig.body.position.clone()); return -(p.x + p.z) / Math.SQRT2 > 9.6; })()`, 400000, 300);
  await page.keyUp('KeyW'); await waitSec(0.5);
  const b = await loc();
  const resp = (await evs('player:respawn', t0)).length;
  rec(T, '门外台阶：桥面 3.0 → 平台 2.4 下行、平台 → 桥上行', ok && ok2 && Math.abs(a[1] - 2.4) < 0.1 && Math.abs(b[1] - 3.0) < 0.1 && !resp ? 'PASS' : 'FAIL', { down: { ok, at: a }, up: { ok: ok2, at: b }, respawn: resp });
});

await step(T, '涨潮时提示（门前）', async () => {
  await tpL(-4.2, 2.42, -4.2, -2.5, -2.5); await waitSec(0.5);
  const h = await hintH();
  rec(T, '提示：涨潮时二级高亮钟 + 油阀，步骤 valve', h.step === 'valve' && h.hl.includes('tide-bell-s3') && h.hl.includes('oil-valve-s3') ? 'PASS' : 'FAIL', h);
});

await step(T, '敲钟（真实 E）', async () => {
  await tpL(-3.451, 2.42, -4.469, -2.758, -5.162); await waitSec(0.5);
  const aim = await aimL(-2.758, 4.0, -5.162, 'tide-bell-s3');
  const pr = await prompt();
  const e = await pressE(`${P}.tide.state === 'low' && !${P}.tide.transitioning`);
  rec(T, '敲钟真实 E → 退潮', e.ok ? 'PASS' : 'FAIL', { aim, prompt: pr, ...e, st: await st() });
});

await step(T, '开门（真实 E）', async () => {
  await tpL(-3.323, 2.42, -3.323, -2.475, -2.475); await waitSec(0.5);
  const aim = await aimL(-2.51, 3.5, -2.51, 'door-s3');
  const pr = await prompt();
  const e = await pressE(`${P}.state.doorOpen >= 1`);
  rec(T, '塔门真实 E 打开', e.ok ? 'PASS' : 'FAIL', { aim, prompt: pr, ...e });
});

const mirror = async (k, stand, center, sol, shot) => {
  await tpL(stand[0], stand[1] + 0.02, stand[2], center[0], center[2]); await waitSec(0.6);
  const aim = await aimL(center[0], center[1], center[2], `guide-mirror-s3-${k === 'window' ? 'window' : k === 'a' ? 'mid-a' : 'mid-b'}`);
  const e = await pressE(`__game.input.context === 'puzzle'`);
  await waitSec(1.2);
  const log = [];
  const f0 = await ft(); const fl0 = (await st()).flashes;
  for (let ax = 0; ax < sol.length; ax++) {
    // 最后一轴：先转到差一档，等天光亮再转最后一档（上升沿反馈）
    const cur = (await angs(k))[ax];
    if (ax === sol.length - 1) {
      const d = ax === 0 ? ((((sol[ax] - cur) % 360) + 540) % 360) - 180 : sol[ax] - cur;
      if (Math.abs(d) > 15) await turnTo(k, ax, sol[ax] - Math.sign(d) * 15, log);
      await sky();
    }
    await turnTo(k, ax, sol[ax], log);
  }
  await waitSec(0.05);
  const emis = await ev(`(() => { const m = ${P}.beam.mirrors; return { a: m.a.plane.material.emissiveIntensity, b: m.b.plane.material.emissiveIntensity }; })()`);
  await waitSec(0.4);
  await page.screenshot(`${SH}/${shot}.png`);
  const s = await st();
  const res = (await evs('sfx:play', f0)).filter(x => x.e.id === 'sfx-glass-resonance').length;
  return { aim, enter: e, log, st: s, flashes: s.flashes - fl0, resonance: res, emis };
};

let ok = true;
await step(T, '窗口镜（未开阀）', async () => {
  const r = await mirror('window', [1.45, 0.2, 0], [2.35, 1.35, 0], [45, -30], 's3-p5-window-cam');
  ok = r.st.reached >= 1;
  rec(T, '窗口镜真按键转到 45/−30 → 光到导光镜 1，A 亮一下 + 玻璃共鸣', r.st.reached >= 1 && r.flashes >= 1 && r.resonance >= 1 && r.emis.a > 0 ? 'PASS' : 'FAIL', r);
  await page.tap('Tab'); await waitSec(1);
});
await step(T, '导光镜 1', async () => {
  const r = await mirror('a', [-1.915, 10, 1.607], [-0.996, 10.6, 0.836], [60], 's3-p5-midA-cam');
  rec(T, '导光镜 1 真按键转到 60 → 光到导光镜 2，B 亮 + 共鸣', r.st.reached >= 2 && r.flashes >= 1 && r.resonance >= 1 && r.emis.b > 0 ? 'PASS' : 'FAIL', r);
  await page.tap('Tab'); await waitSec(1);
});
await step(T, '导光镜 2 + 没有油', async () => {
  const f0 = await ft();
  const r = await mirror('b', [2.462, 16, -0.434], [1.28, 16.6, -0.226], [300], 's3-p5-midB-cam');
  const blk = await page.waitFor(`${P}.beam.igniter.state === 'blocked'`, 300000, 200);
  await waitSec(0.5);
  const subs = (await evs('subtitle:show', f0)).map(x => x.e);
  const lens = await ev(`(() => { const m = ${P}.beam.igniterLens.material; return { em: m.emissive?.getHexString(), ei: m.emissiveIntensity, col: m.color?.getHexString() }; })()`);
  const s = await st();
  rec(T, '导光镜 2 → 点火口（未开阀）：共鸣、红光 +「没有油。」、不进可点灯、拉杆不可点', r.st.reached === 3 && r.resonance >= 1 && blk && JSON.stringify(subs).includes('no_oil') && !s.lever && s.ig === 'blocked' ? 'PASS' : 'FAIL', { r, blk, subs, lens, s });
  // R 只重置当前这面
  const before = await st();
  await turnTo('b', 0, 315, []);
  const f1 = await ft();
  await page.tap('KeyR'); await waitSec(0.8);
  const after = await st();
  const resets = (await evs('puzzle:reset', f1)).map(x => x.e);
  rec(T, 'R 只重置当前镜（导光镜 2 → 0；窗口镜 / 导光镜 1 / 油阀不变）', after.B === 0 && JSON.stringify(after.W) === JSON.stringify(before.W) && after.A === before.A && after.valve === before.valve ? 'PASS' : 'FAIL', { before: { W: before.W, A: before.A, B: before.B }, after: { W: after.W, A: after.A, B: after.B, valve: after.valve, reached: after.reached }, resets });
  await turnTo('b', 0, 300, []); await waitSec(0.5);
  await page.tap('Tab'); await waitSec(1);
  const h = await hintH();
  rec(T, '跳过油阀：光已到点火口时提示仍停在油阀步骤（二级高亮油阀）', h.step === 'valve' && h.hl.includes('oil-valve-s3') && !h.ids.includes('ch1.hint.p5.ignite.l3') ? 'PASS' : 'FAIL', { h, st: await st() });
});
await step(T, '开阀（真实按住 E）→ 从开阀起 1.0 s 可点灯', async () => {
  await tpL(0.855, 0.22, 2.349, 0.992, 2.725); await waitSec(0.6);
  const aim = await aimL(0.992, 0.9, 2.725, 'oil-valve-s3');
  const pr = await prompt();
  await sky();
  await must(`${P}.beam.igniter.state === 'blocked'`, 300000, 'blocked before valve');
  const f0 = await ft();
  await page.keyDown('KeyE');
  const opened = await page.waitFor(`${P}.state.valveOpen`, 400000, 100);
  await page.keyUp('KeyE');
  const ready = await page.waitFor(`${P}.beam.igniter.state === 'ready'`, 300000, 100);
  await waitSec(0.3);
  const u = (await evs('interact:used', f0)).find(x => x.e.id === 'oil-valve-s3');
  const rd = (await evs('receiver:ready', f0)).filter(x => x.e.id === 'ignition-port-s3');
  const subs = (await evs('subtitle:show', f0)).map(x => x.e.id ?? x.e);
  const dt = u && rd[0] ? (rd[0].ft - u.ft) / 60 : null;
  rec(T, '开阀后（光一直在点火口上）从开阀那一刻起 1.0 s 进可点灯', opened && ready && dt !== null && Math.abs(dt - 1.0) <= 2 / 60 + 1e-6 && rd.length === 1 ? 'PASS' : 'FAIL', { aim, prompt: pr, usedFt: u?.ft, readyFt: rd.map(x => x.ft), dt, subs, st: await st() });
  const h = await hintH();
  rec(T, '可点灯状态 H → 只显示 ch1.hint.p5.ignite.l3（不高亮）', h.ids.join() === 'ch1.hint.p5.ignite.l3' ? 'PASS' : 'FAIL', h);
});
rec(T, 'errors', 'INFO', page.errors);
S.save('t8-s3a');
await done(); console.log('DONE'); process.exit(0);
