import { REPO_ROOT } from './paths.mjs';
// batch9 ①：BUG-015 回归（018360a）
import { s3, sleep } from './b8s3.mjs';
const SH9 = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch9');
const T = 'b9-015';
const S = await s3(5420, process.env.Q || 'art=0');
const { page, ev, must, rec, step, done, waitSec, prompt } = S;
const P = `__s3.puzzles`;
await ev(`(() => { const e = __s3.game.events; e.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }); __s3.tides.fixedUpdate(7); e.emit('interact:used', { id: 'door-s3', kind: 'use' }); return 1; })()`);
await waitSec(0.5);
const stand = () => ev(`(() => { const s = __s3, ix = s.puzzles.leverIx, sp = ix.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.03)); s.rig.body.velocity?.set?.(0,0,0); s.rig.controller.facing = sp.facing; s.cameraFollow.yaw = sp.facing + Math.PI; s.cameraFollow.pitch = -0.2; return s.cameraFollow.yaw; })()`);
const sweep = async () => { const yaw0 = await stand(); await waitSec(0.4); const out = [];
  for (const dy of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) for (const pt of [-0.5, -0.25, 0]) { await ev(`(__s3.cameraFollow.yaw = ${yaw0 + dy}, __s3.cameraFollow.pitch = ${pt}, 1)`); await waitSec(0.15); out.push([dy, pt, await ev(`__s3.interaction.current?.id ?? null`), await prompt()]); }
  await ev(`(__s3.cameraFollow.yaw = ${yaw0}, __s3.cameraFollow.pitch = -0.2, 1)`); await waitSec(0.3);
  const cnt = {}; for (const o of out) { const k = o[2] + '|' + o[3]; cnt[k] = (cnt[k] || 0) + 1; } return { cnt, out }; };
const st = () => ev(`({ ig: ${P}.beam.igniter.state, lever: ${P}.leverIx.enabled, ign: ${P}.state.ignited })`);
await step(T, '阀门关 / 光未到：透镜仍「E 查看」', async () => {
  const a = { st: await st(), sw: (await sweep()).cnt };
  await ev(`(${P}.beam.solve(), ${P}.beam.tracer.trace(), 1)`); await waitSec(1.5);
  const b = { st: await st(), sw: (await sweep()).cnt };
  rec(T, '未开阀（光未到 / 光到点火口 blocked）：拉杆站位正前方是透镜「E 查看」，无「E 点灯」', [a, b].every(x => !x.st.lever && Object.keys(x.sw).some(k => k.startsWith('lens-s3|E 查看')) && !Object.keys(x.sw).some(k => /点灯/.test(k))) ? 'PASS' : 'FAIL', { a, b });
});
await step(T, '开阀未就绪：透镜「E 查看」', async () => {
  await ev(`(${P}.beam.mirrors.b.part.setAngle(0, 315), ${P}.beam.tracer.trace(), 1)`); await waitSec(0.5);
  await ev(`(__s3.game.events.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }), 1)`); await waitSec(1.2);
  const c = { st: await st(), sw: (await sweep()).cnt };
  rec(T, '开阀但光不到（not ready）：透镜「E 查看」，无「E 点灯」', c.st.ig !== 'ready' && Object.keys(c.sw).some(k => k.startsWith('lens-s3|E 查看')) && !Object.keys(c.sw).some(k => /点灯/.test(k)) ? 'PASS' : 'FAIL', c);
});
await step(T, 'ready：21 个视角全「E 点灯」，E 点灯', async () => {
  await ev(`(${P}.beam.solve(), ${P}.beam.tracer.trace(), 1)`);
  await must(`${P}.beam.igniter.state === 'ready'`, 600000, 'ready');
  const s = await sweep();
  const all = s.out.every(o => o[2] === 'ignite-lever-s3' && /E 点灯/.test(o[3] ?? ''));
  rec(T, 'ready 时拉杆站位 21 个视角（yaw ±0.6 × pitch 0 / −0.25 / −0.5）全部「E 点灯」', all ? 'PASS' : 'FAIL', s.cnt);
  await page.screenshot(`${SH9}/b9-p5-ready-lever.png`);
  if (await ev(`${P}.beam.igniter.state`) !== 'ready') await must(`${P}.beam.igniter.state === 'ready'`, 600000, 'ready again');
  await page.tap('KeyE');
  const ok = await page.waitFor(`${P}.state.ignited === true`, 900000, 200);
  rec(T, '按 E → 点灯（lighthouse ignited）', ok ? 'PASS' : 'FAIL', { st: await st() });
});
await step(T, '页面错误', async () => rec(T, '页面错误', S.page.errors?.length ? 'FAIL' : 'PASS', S.page.errors ?? []));
S.save?.('t9-p5'); await done();
