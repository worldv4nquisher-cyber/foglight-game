// batch8 S2（art=1）：插口 / 光感锁坐标、谜题 3 真按键可解、书桌放灯计时、地窖钥匙挂右手 + LOD0、淋湿（室内 / 室外）
import { open, sleep, SH } from './b8lib.mjs';
import { EVLOG } from './b8s3.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5405);
const T = 'b8-S2';
await page.addInit(EVLOG);
await page.addInit(`window.addEventListener('keydown', (e) => { if (!e.repeat) (window.__kd ??= []).push({ code: e.code, n: window.__n ?? -1 }); }, true);`);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2 explore');
await sleep(800);
await ev(`(() => { const s = __s2; window.__n = 0; window.__smp = null; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; if (window.__smp) { const a = s.rig.animator, L = s.puzzles.lantern, K = s.scene.getObjectByName('prop-key-cellar-s2');
  let lod = null; if (K) { lod = []; K.traverse((x) => { if (x.isLOD) lod.push(x.getCurrentLevel()); }); }
  const bone = s.rig.visual.getObjectByName('middle_03_r'); let kd = null; if (K && bone && K.visible) { const kp = K.getWorldPosition(K.position.clone()), bp = bone.getWorldPosition(K.position.clone()); kd = +kp.distanceTo(bp).toFixed(3); }
  window.__smp.push({ n: window.__n, pose: a?.posing ?? null, busy: s.rig.controller.busy, lp: L.parent?.name ?? null, kp: K?.parent?.name ?? null, kv: K?.visible ?? null, lod, kd, inHand: s.puzzles.state.keyInHand, hasKey: s.puzzles.state.hasKey, reader: __game.ui.reader.isOpen, ctx: __game.input.context }); } }; return 1; })()`);
const smpOn = () => ev(`(window.__smp = [], 1)`);
const smpOff = () => ev(`(() => { const r = window.__smp; window.__smp = null; return r; })()`);
const N = () => ev('window.__n');
const waitN = async (k) => { const n0 = await N(); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const tp = (x, y, z, facing) => ev(`(() => { const s = __s2; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.body.position.constructor(${x}, ${y}, ${z})); s.rig.body.velocity.set(0,0,0); ${facing !== undefined ? `s.rig.controller.facing = ${facing}; s.cameraFollow.yaw = ${facing} + Math.PI;` : ''} return 1; })()`);
const trig = (id) => ev(`(() => { const s = __s2; const it = s.interaction.get('${id}'); if (!it) return 'no ' + '${id}'; s.interaction.trigger(it); return 'ok'; })()`);
const aimAt = async (x, y, z, id, tries = 8) => { for (let i = 0; i < tries; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(${x}, ${y}, ${z}).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${i % 3 === 2 ? 0.05 : 0}; s.cameraFollow.pitch = ${i % 2 ? -1 : 1} * Math.asin(t.y); return 1; })()`); await waitN(15); if ((await ev(`__s2.interaction.current?.id ?? null`)) === id) return true; } return false; };
const prompt = () => ev(`((p) => (p && !p.hidden ? p.textContent.trim() : null))(document.querySelector('.hud-prompt'))`);
const lastKd = async (code) => (await ev('window.__kd')).filter((k) => k.code === code).at(-1)?.n;

await step(T, 'a9b3403 坐标', async () => {
  const r = await ev(`(() => { const s = __s2, p = s.puzzles, b = p.beam; const V = s.rig.body.position.constructor; const sock = s.scene.getObjectByName('desk-lantern-s2-socket'); const w = sock ? sock.getWorldPosition(new V()) : null;
    const lc = b.lock.center(new V()); const art = []; s.scene.traverse((o) => { if (/socket|light-lock|lock-s2/i.test(o.name) && art.length < 30) { const q = o.getWorldPosition(new V()); art.push([o.name, +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3)]); } });
    return { deskSocket: w && [w.x, w.y, w.z].map(v => +v.toFixed(3)), lockCenter: [lc.x, lc.y, lc.z].map(v => +v.toFixed(3)), art }; })()`);
  const ok = r.deskSocket && Math.abs(r.deskSocket[2] + 0.35) < 0.01 && Math.abs(r.lockCenter[2] - 4.0) < 0.01;
  rec(T, 'a9b3403 风灯插口 z −0.35 / 光感锁接收器 z 4.0（场景世界坐标 + 美术节点）', ok ? 'PASS' : 'FAIL', r);
});

const wet = () => ev(`({ w: __s2.rig.look?.look.wetness ?? null, tgt: __s2.rig.look?.wetTarget ?? null, rain: !!__s2.rain?.visible, el: __game.time.elapsed })`);
async function wetSlope(label, x, y, z, w0, sec) {
  await tp(x, y, z); await waitN(20);
  await ev(`(__s2.rig.look.look.wetness = ${w0}, 1)`);
  const a = await wet(); await waitN(Math.round(sec * 60)); const b = await wet();
  return { label, at: [x, y, z], rain: a.rain, target: b.tgt, w0: +a.w.toFixed(4), w1: +b.w.toFixed(4), dGame: +(b.el - a.el).toFixed(2), slopePerSec: +((b.w - a.w) / (b.el - a.el)).toFixed(5) };
}
await step(T, '淋湿：室外 / 小屋 / 地窖', async () => {
  const r = [];
  r.push(await wetSlope('室外小院（湿 0 → 应 +1/40 每秒）', -10.5, 0.05, 0, 0, 8));
  r.push(await wetSlope('室外小院（湿 0.98 → 封顶 1）', -10.5, 0.05, 0, 0.98, 3));
  r.push(await wetSlope('小屋一层（湿 0.5 → 应 −1/150 每秒）', -2.6, 0.05, 0.4, 0.5, 8));
  r.push(await wetSlope('小屋二层书桌', -3.9, 3.05, -0.25, 0.5, 8));
  r.push(await wetSlope('地窖', -1.6, -2.35, 1.6, 0.5, 8));
  r.push(await wetSlope('室内（湿 0 → 保持 0）', -2.6, 0.05, 0.4, 0, 4));
  const okOut = Math.abs(r[0].slopePerSec - 1 / 40) < 0.003 && r[1].w1 === 1;
  const okIn = r.slice(2, 5).every((x) => x.target === 0 && Math.abs(x.slopePerSec + 1 / 150) < 0.001) && r[5].w1 === 0;
  rec(T, '淋湿：室外有雨约 40 s 湿透、室内（小屋 / 地窖）不湿且约 150 s 干透', okOut && okIn ? 'PASS' : 'FAIL', r);
});

await step(T, '谜题 3 真按键可解（art=1）', async () => {
  await trig('lantern-s2'); await waitN(200);
  await tp(-13.2, 0.05, -6.2); await waitN(20); await trig('lamp-stand-east-s2'); await must(`!__s2.rig.controller.busy && !__s2.interaction.held.current`, 300000, 'place east');
  await waitN(60);
  await tp(-12.2, 0.05, 2.0, Math.PI); await waitN(20);
  const aimed = await aimAt(-13.2, 0.85, 3.0, 'mirror-stand-s2-a');
  const pr = await prompt();
  await page.tap('KeyE');
  await must(`__game.input.context === 'puzzle'`, 300000, 'puzzle mode');
  await waitN(60);
  const ang = () => ev(`[__s2.puzzles.beam.mirrorA.part.angles[0], __s2.puzzles.beam.mirrorB.part.angles[0]]`);
  const seq = [];
  for (const k of ['KeyD', 'KeyD', 'KeyE', 'KeyA', 'KeyA', 'KeyA']) { await page.tap(k); await waitN(40); seq.push([k, await ang()]); }
  await page.tap('Tab');
  const ok = await page.waitFor(`__s2.puzzles.state.lockOpen && __s2.puzzles.state.doorOpen >= 1`, 300000, 200);
  const s = await ev(`({ lock: __s2.puzzles.beam.lock.state, lockOpen: __s2.puzzles.state.lockOpen, door: __s2.puzzles.state.doorOpen, ctx: __game.input.context })`);
  await page.screenshot(`${SH}/s2-p3-lock-open.png`);
  rec(T, '谜题 3 真按键可解（A 30° / B 315° → 光感锁开 → 地窖门开）', ok ? 'PASS' : 'FAIL', { aimed, prompt: pr, seq, ...s });
});

await step(T, '地窖钥匙：挂右手 middle_03_r、拿着时 LOD0、clip 2.67 s', async () => {
  await tp(-1.6, -2.35, 1.6, -Math.PI / 2); await waitN(30);
  const aimed = await aimAt(-2.35, -1.3, 1.35, 'cellar-key-s2');
  const pr = await prompt();
  await smpOn();
  await page.tap('KeyE');
  await must(`__s2.puzzles.state.hasKey`, 300000, 'key');
  await must(`!__s2.rig.controller.busy`, 300000, 'busy end');
  await waitN(30);
  const smp = await smpOff(); const k = await lastKd('KeyE');
  const pose = smp.filter((q) => q.pose === 'xi-pickup-shelf'); const p0 = pose[0];
  const att = smp.find((q) => q.kp === 'middle_03_r');
  const held = smp.filter((q) => q.kp === 'middle_03_r' && q.kv);
  const lodBad = held.filter((q) => q.lod && q.lod.some((l) => l !== 0));
  const hidden = smp.find((q) => q.hasKey && q.kv === false);
  const busyTicks = p0 ? smp.filter((q) => q.n >= p0.n && q.busy).length : null;
  const r = { aimed, prompt: pr, poseStartAfterE: p0 ? p0.n - k : null, attachAfterPose: p0 && att ? att.n - p0.n : null, attachBone: att?.kp, heldTicks: held.length, lodLevels: [...new Set(held.flatMap((q) => q.lod ?? []))], lodNotZeroTicks: lodBad.length, keyBoneDist: held.length ? [Math.min(...held.map((q) => q.kd)), Math.max(...held.map((q) => q.kd))] : null, hiddenAfterPose: p0 && hidden ? hidden.n - p0.n : null, poseTicks: pose.length, busyTicksFromPose: busyTicks };
  const ok = r.attachBone === 'middle_03_r' && Math.abs(r.attachAfterPose - 44) <= 2 && r.lodNotZeroTicks === 0 && r.lodLevels.length > 0 && Math.abs(r.hiddenAfterPose - 160) <= 3;
  rec(T, '地窖钥匙：grab 帧 22（+0.733 s）挂 middle_03_r（右手中指）、拿着全程 LOD0、clip 末（2.67 s）收起', ok ? 'PASS' : 'FAIL', r);
});
await step(T, '页面错误', async () => { rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors.slice(0, 10)); });
save('t8-s2c');
await done();
process.exit(0);
