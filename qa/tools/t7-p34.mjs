// 014 谜题 3/4 后半段：按住键直到角度变化（避免 tap 漏帧）；阅读器打开时按真实时间等待
import { open, sleep, SH } from './b7lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5306);
const T = 'v0.1-014';
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  for (const n of ['interact:used','sfx:play','subtitle:show','beam:receiverOn','receiver:activated','puzzle:solved','puzzle:enter','puzzle:exit','puzzle:reset','puzzle:partRotated','player:respawn','journal:updated','scene:enter','hint:show'])
    v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick }));
} }); })();`);
const st = () => ev(`(() => { const s = __s2, p = s.puzzles, b = p.beam, bp = s.rig.body.position; const h = s.interaction.held; const pr = document.querySelector('.hud-prompt');
  return { ft: __game.time.fixedTick, ...p.state, holding: h?.current?.id ?? null, goal: __game.narrative.goal, reader: __game.ui.reader.isOpen, ctx: __game.input.context,
    glow: p.windowGlow.visible, A: b.mirrorA.part.angles[0], B: b.mirrorB.part.angles[0], lock: b.lock.state, align: +p.viewpoint.alignment.toFixed(3), digits: p.digits.visible,
    dials: p.dials.map(d => d.angles[0]), cur: s.interaction.current?.id ?? null, prompt: pr && !pr.hidden ? pr.textContent.trim() : null,
    pos: [bp.x, bp.y, bp.z].map(v => +v.toFixed(2)), scene: __game.scenes.current?.name }; })()`);
const tp = (x, y, z, f) => ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); s.rig.controller.facing = ${f}; s.cameraFollow.yaw = ${f} + Math.PI; return 1; })()`);
const ft = () => ev('__game.time.fixedTick');
const evs = (n, f0) => ev(`__ev.filter(x => x.n === '${n}' && x.ft >= ${f0})`);
const waitSec = async (s) => { if (await ev(`__game.ui.reader.isOpen`)) return sleep(s * 1000 + 500); const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)} || __game.ui.reader.isOpen`, 400000, 'wait'); };
const aimAt = async (x, y, z, id, tries = 10) => { for (let i = 0; i < tries; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(${x}, ${y}, ${z}).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${i % 3 === 2 ? 0.05 : 0}; s.cameraFollow.pitch = ${i % 2 ? -1 : 1} * Math.asin(t.y); return 1; })()`); await waitSec(0.3); if ((await st()).cur === id) return true; } return false; };
async function pressE(id, cond, ms = 60000) {
  const pre = await st(); const f0 = await ft();
  await page.keyDown('KeyE'); await sleep(250); await page.keyUp('KeyE');
  let ok = await page.waitFor(`(${cond}) || (!__game.ui.reader.isOpen && __game.time.fixedTick > ${f0 + 300})`, ms, 100) && await ev(cond);
  const used = await ev(`__ev.filter(x => x.n === 'interact:used' && x.ft >= ${f0}).map(x => [x.e.id, +((x.ft - ${f0}) / 60).toFixed(2)])`);
  return { ok, prePrompt: pre.prompt, preCur: pre.cur, used };
}
// 按住直到 cond 成立（或超时）再松开
const hold = async (code, cond, ms = 20000) => { await page.keyDown(code); const ok = await page.waitFor(cond, ms, 30); await page.keyUp(code); await waitSec(0.1); return ok; };
const ang = (w) => `__s2.puzzles.beam.mirror${w}.part.angles[0]`;
const out = {};

await page.goto(url('?debug=1')); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&beamDebug=1&scene=s2&art=0'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 300000, 's2');
await sleep(1500);
const t0 = await ft();
console.log('FPSPROBE', await ev(`new Promise(r => { const a = __game.time.fixedTick; let n = 0; const f = () => { n++; if (n < 30) requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => r({ ticksPerSec: (__game.time.fixedTick - a) / 3, raf3s: n }), 3000); })`));

await step(T, '书桌：日志 → 拿起风灯 → 暖窗熄灭', async () => {
  await tp(-4.6, 3.02, -0.25, -Math.PI / 2); await waitSec(1);
  const aimJ = await aimAt(-5.0, 3.77, 0.02, 'journal-s2');
  const e = await pressE('journal-s2', `__game.ui.reader.isOpen`, 90000);
  await sleep(2500); await page.tap('Tab'); await waitSec(1.5);
  const s1 = await st();
  // 风灯：socket = (deskInteract.x − 0.45, top, z − 0.05)
  const L = await ev(`(() => { const l = __s2.puzzles.lantern; const p = l.getWorldPosition(l.position.clone()); return [p.x, p.y + 0.13, p.z]; })()`);
  const aimL = await aimAt(L[0], L[1], L[2], 'lantern-s2', 14);
  const e2 = await pressE('lantern-s2', `__s2.interaction.held?.current?.id === 'lantern'`);
  await waitSec(2.5);
  const s2 = await st();
  out.desk = { aimJ, e, journalRead: s1.journalRead, goal: s1.goal, glowBefore: s1.glow, aimL, e2, holding: s2.holding, glowAfter: s2.glow, onDesk: s2.lanternOnDesk };
  rec(T, '书桌：真实 E 拿起风灯、暖窗熄灭', e.ok && e2.ok && s2.holding === 'lantern' && !s2.glow && s1.glow ? 'PASS' : 'FAIL', out.desk);
  if (!s2.holding) await ev(`(() => { const s = __s2; s.interaction.trigger(s.interaction.get('lantern-s2')); return 1; })()`);
});

await step(T, '东灯台 + 镜子 15° 档 + R 重置', async () => {
  await tp(-13.2, 0.02, -6.6, 0); await waitSec(1);
  const e = await pressE('lamp-stand-east-s2', `!__s2.interaction.held?.current`);
  await tp(-12.2, 0.02, 2.0, Math.atan2(-1, 1)); await waitSec(1);
  const e3 = await pressE('mirror-stand-s2-a', `__game.input.context === 'puzzle'`);
  await waitSec(1.2);
  await page.screenshot(`${SH}/s2-mirror-cam.png`);
  const r = {};
  r.d1 = await hold('KeyD', `${ang('A')} === 15`); r.d2 = await hold('KeyD', `${ang('A')} === 30`);
  r.afterD = [await ev(ang('A')), await ev(ang('B'))];
  await page.tap('KeyE'); await waitSec(0.3);
  r.sel = await ev(`__s2.puzzles.beam.puzzle.current?.id ?? null`);
  r.a1 = await hold('KeyA', `${ang('B')} === 345`);
  r.afterA1 = [await ev(ang('A')), await ev(ang('B'))];
  await page.tap('KeyR'); await waitSec(0.4);
  r.afterR = [await ev(ang('A')), await ev(ang('B'))];
  await page.tap('KeyQ'); await waitSec(0.3);
  r.selQ = await ev(`__s2.puzzles.beam.puzzle.current?.id ?? null`);
  r.hasCam = await ev(`__s2.puzzles.beam.puzzle.camNode?.name ?? null`);
  out.mirror = { e, e3, ...r };
  rec(T, '镜子：E 进入机关、D 正转 15° 一档、E/Q 切换、R 重置两面', e.ok && e3.ok && r.afterD[0] === 30 && r.afterD[1] === 0 && r.afterA1[1] === 345 && r.afterR[0] === 0 && r.afterR[1] === 0 ? 'PASS' : 'FAIL', out.mirror);
});

await step(T, '解谜 3：转到正解、锁受光 1.5 s、光高、门开', async () => {
  // 当前选中镜 A（Q 回到上一个）
  const sel = await ev(`__s2.puzzles.beam.puzzle.current?.id ?? null`);
  if (sel !== 'mirror-stand-s2-a') { await page.tap('KeyQ'); await waitSec(0.3); }
  await hold('KeyD', `${ang('A')} === 15`); await hold('KeyD', `${ang('A')} === 30`);
  await page.tap('KeyE'); await waitSec(0.3);
  const f0 = await ft();
  await ev(`(() => { window.__hitFt = null; const id = setInterval(() => { const l = __s2.puzzles.beam.lock; if (l.hit && __hitFt === null) __hitFt = __game.time.fixedTick; if (l.state === 'activated') clearInterval(id); }, 4); return 1; })()`);
  await hold('KeyA', `${ang('B')} === 345`); await hold('KeyA', `${ang('B')} === 330`); await hold('KeyA', `${ang('B')} === 315`);
  const angles = [await ev(ang('A')), await ev(ang('B'))];
  const opened = await page.waitFor(`__s2.puzzles.state.lockOpen`, 120000, 50);
  const hitFt = await ev('__hitFt'); const on = hitFt === null ? [] : [{ ft: hitFt }]; const act = await evs('receiver:activated', f0); const rot = await evs('puzzle:partRotated', f0);
  const lastRot = rot.at(-1)?.ft;
  const geo = await ev(`(() => { const b = __s2.puzzles.beam; const V = b.mirrorA.center.constructor; const lc = b.lock.center(new V()); const path = b.tracer.paths.find(p => p.emitter.id === 'lamp-east-s2');
    const em = b.lamps.east.emitter.node.getWorldPosition(new V()); const lens = b.lockLens.getWorldPosition(new V());
    return { emitter: em.toArray().map(v => +v.toFixed(3)), mA: b.mirrorA.center.toArray(), mB: b.mirrorB.center.toArray(), lens: lens.toArray().map(v => +v.toFixed(3)), rxCenter: lc.toArray().map(v => +v.toFixed(3)),
      segY: path.segments.map(s => [+s.from.y.toFixed(3), +s.to.y.toFixed(3)]), mirrors: path.mirrors, end: path.end, rx: path.receiver?.id ?? null, hitDist: +path.endPoint.distanceTo(lc).toFixed(3), lateral: path.hitOffset ?? null }; })()`);
  await page.screenshot(`${SH}/s2-lock-lit.png`);
  const holdSec = act[0] && lastRot !== undefined ? +((act[0].ft - lastRot) / 60).toFixed(2) : null;
  const onToAct = act[0] && on[0] ? +((act[0].ft - on[0].ft) / 60).toFixed(2) : null;
  out.solve = { angles, opened, holdSecFromLastRotate: holdSec, onToActivated: onToAct, receiverOn: on.map(x => x.ft), activated: act.map(x => x.ft), geo };
  rec(T, '15° 档正解 A30/B315、光感锁受光 ≈1.5 s 开锁', opened && angles[0] === 30 && angles[1] === 315 && onToAct !== null && Math.abs(onToAct - 1.5) < 0.1 ? 'PASS' : 'FAIL', out.solve);
  const ys = [geo.emitter[1], geo.mA[1], geo.mB[1], geo.lens[1], geo.rxCenter[1], ...geo.segY.flat()];
  rec(T, '灯出光 / 镜心 / 锁透镜 y≈0.85 ±3 cm，光束命中锁 0.3 m 判定', ys.every(y => Math.abs(y - 0.85) <= 0.03) && geo.rx === 'light-lock-s2' && geo.hitDist <= 0.3 ? 'PASS' : 'FAIL', { ys, rx: geo.rx, hitDist: geo.hitDist });
  await page.tap('Tab'); await waitSec(0.6);
  const door = await page.waitFor(`__s2.puzzles.state.doorOpen >= 1`, 120000, 100);
  await waitSec(1.2);
  const subs = (await evs('subtitle:show', f0)).map(x => x.e?.ids ?? x.e);
  const sfx = (await evs('sfx:play', f0)).map(x => x.e.id);
  const s = await st();
  out.door = { door, ctx: s.ctx, subs, sfx, goal: s.goal };
  rec(T, '地窖门转开 + 独白 + 开锁音；退出机关回 explore', door && s.ctx === 'explore' && sfx.includes('sfx-lock-open') ? 'PASS' : 'FAIL', out.door);
});

await step(T, '地窖：钥匙（架面 1.1 m）+ 草图', async () => {
  await tp(-1.9, -2.38, 1.4, -Math.PI / 2); await waitSec(1.2);
  const keyY = await ev(`(() => { const k = __s2.scene.getObjectByName('cellar-key-s2'); return +k.getWorldPosition(k.position.clone()).y.toFixed(3); })()`);
  const aimK = await aimAt(-2.35, -1.27, 1.35, 'cellar-key-s2');
  const f0 = await ft();
  const e = await pressE('cellar-key-s2', `__s2.puzzles.state.hasKey`);
  await waitSec(1.5);
  const s = await st();
  const toast = await ev(`[...document.querySelectorAll('.toast-left, .toast')].map(e => e.textContent.trim()).filter(Boolean)`);
  await page.screenshot(`${SH}/s2-cellar-key.png`);
  const aimS = await aimAt(-2.35, -1.28, 1.8, 'sketch-s2');
  const e2 = await pressE('sketch-s2', `__game.ui.reader.isOpen`);
  const doc = await ev(`document.querySelector('.reader, [class*=reader]')?.textContent?.slice(0, 200) ?? null`);
  await page.screenshot(`${SH}/s2-sketch.png`);
  await sleep(1500); await page.tap('Tab'); await waitSec(0.8);
  const subs = (await evs('subtitle:show', f0)).map(x => x.e);
  const sfx = (await evs('sfx:play', f0)).map(x => x.e.id);
  out.cellar = { keyY, aimK, e, hasKey: s.hasKey, goal: s.goal, toast, aimS, e2, doc, subs, sfx };
  rec(T, '地窖：钥匙在架面 1.1 m（地窖地面 −2.4）、E 拾取 → toast + 目标 gate；草图 E 可读', e.ok && s.hasKey && s.goal === 'ch1.s2.goal.gate' && Math.abs(keyY - (-1.3)) < 0.03 && e2.ok ? 'PASS' : 'FAIL', out.cellar);
});

await step(T, '观察点：右键对准白石 317', async () => {
  await tp(0.95, 3.02, 1.0, -Math.PI / 2); await waitSec(1.2);
  const s0 = await st(); const vprompt = await ev(`__s2.puzzles.viewpointPrompt()`);
  await page.mouse('mouseMoved', 640, 360); await page.mouse('mousePressed', 640, 360, 'right');
  const f0 = await ft();
  const aim = async (off) => { for (let i = 0; i < 3; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(18, 0.2, 1).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${off}; s.cameraFollow.pitch = Math.asin(t.y); return 1; })()`); await waitSec(0.25); } return { align: (await st()).align, digits: (await st()).digits, observing: await ev('__s2.cameraFollow.observing') }; };
  const curve = {};
  for (const deg of [20, 14, 12, 10, 8, 6, 4, 0]) curve[deg] = await aim(deg * Math.PI / 180);
  await waitSec(1.2);
  const s = await st();
  await page.screenshot(`${SH}/s2-viewpoint-317.png`);
  await page.mouse('mouseReleased', 640, 360, 'right');
  const sfx = (await evs('sfx:play', f0)).map(x => x.e.id); const subs = (await evs('subtitle:show', f0)).map(x => x.e);
  // 别处：二层 (−0.6, 1.0)、一层同平面位置
  const offs = {};
  for (const [k, x, y, z] of [['upper-1.5m', -0.6, 3.02, 1.0], ['ground-same-xz', 0.95, 0.02, 1.0], ['outside-west', 4.5, 0.02, 1.0]]) {
    await tp(x, y, z, -Math.PI / 2); await waitSec(1);
    await page.mouse('mousePressed', 640, 360, 'right'); const a = await aim(0); await page.mouse('mouseReleased', 640, 360, 'right'); offs[k] = { ...a, pos: (await st()).pos };
  }
  out.vp = { prompt: s0.prompt, vprompt, curve, digitsSeen: s.digitsSeen, sfx, subs, offs };
  const c = (d) => curve[d].align;
  rec(T, '观察点：12° 起淡入、≤6° 完全清晰 + 风铃、别处看不到', /右键/.test(vprompt ?? '') && c(20) === 0 && c(14) === 0 && c(10) > 0 && c(10) < 1 && c(6) >= 0.99 && c(0) >= 0.99 && s.digitsSeen && sfx.includes('sfx-wind-chime') && Object.values(offs).every(o => !o.digits && o.align === 0) ? 'PASS' : 'FAIL', out.vp);
});

await step(T, '拨盘铁门：错码无反应无惩罚、317 开门', async () => {
  await tp(4.2, 0.02, 10.6, 0); await waitSec(1.2);
  const pre = await st();
  const e = await pressE('dial-gate-s2', `__game.input.context === 'puzzle'`);
  await waitSec(1.2);
  const f0 = await ft();
  const dial = (i) => `__s2.puzzles.dials[${i}].angles[0]`;
  const sel = () => ev(`__s2.puzzles.dialPuzzle.current?.id ?? null`);
  const r = { sel0: await sel() };
  // 3 1 6
  for (const v of [36, 72, 108]) await hold('KeyD', `${dial(0)} === ${v}`);
  await page.tap('KeyE'); await waitSec(0.3); r.sel1 = await sel();
  await hold('KeyD', `${dial(1)} === 36`);
  await page.tap('KeyE'); await waitSec(0.3); r.sel2 = await sel();
  await hold('KeyA', `${dial(2)} === 324`); // 9
  for (const v of [288, 252, 216]) await hold('KeyA', `${dial(2)} === ${v}`); // 6
  await waitSec(2);
  const a = await st();
  const wrongEv = { sfx: (await evs('sfx:play', f0)).map(x => x.e.id), subs: (await evs('subtitle:show', f0)).map(x => x.e), respawn: (await evs('player:respawn', t0)).length };
  await page.screenshot(`${SH}/s2-dial-316.png`);
  // 316 → 317（再往回 A 一档 = 216−36=180 是 5；正向 D: 216+36=252 = 7）
  await hold('KeyD', `${dial(2)} === 252`);
  const opened = await page.waitFor(`__s2.puzzles.state.gateOpen && __game.input.context === 'explore'`, 60000, 100);
  await waitSec(2.2);
  const b = await st();
  const rot = await ev(`+__s2.greybox.dialGate.rotation.y.toFixed(3)`);
  await page.screenshot(`${SH}/s2-gate-open.png`);
  out.gate = { pre: pre.prompt, e, ...r, at316: { dials: a.dials, gateOpen: a.gateOpen, ctx: a.ctx }, wrongEv, opened, after: { dials: b.dials, ctx: b.ctx, goal: b.goal }, gateRotY: rot, sfxAll: (await evs('sfx:play', f0)).map(x => x.e.id) };
  rec(T, '拨盘：316 不开、无惩罚；317 自动开门、退出机关', e.ok && !a.gateOpen && a.ctx === 'puzzle' && JSON.stringify(a.dials) === '[108,36,216]' && wrongEv.respawn === 0 && opened ? 'PASS' : 'FAIL', out.gate);
});

await step(T, '过铁门 → 崖径 → S3 出口（真实走路）', async () => {
  await page.keyDown('KeyW'); let reached = false; const end = Date.now() + 240000; let last = null;
  try { for (const [tx, tz] of [[4.2, 12.5], [5, 18], [5, 23.5]]) { while (Date.now() < end) { const s = await ev(`(() => { const p = __s2?.rig?.body?.position; return p ? [p.x, p.z] : null; })()`).catch(() => null); if (!s) { reached = true; break; } last = s; if (Math.hypot(tx - s[0], tz - s[1]) < 0.4) break; await ev(`(() => { const s = __s2; s.cameraFollow.yaw = Math.atan2(-(${tx} - s.rig.body.position.x), -(${tz} - s.rig.body.position.z)); return 1; })()`).catch(() => 0); await sleep(150); } } } finally { await page.keyUp('KeyW'); }
  const ok = await page.waitFor(`__game.scenes.current?.name && !/s2/.test(__game.scenes.current.name)`, 240000, 300);
  const sc = await ev(`__game.scenes.current?.name`);
  await sleep(2000); await page.screenshot(`${SH}/s2-exit-to-s3.png`);
  rec(T, '走到出口进 S3', ok ? 'PASS' : 'FAIL', { scene: sc, last, fixedSecTotal: +(((await ft()) - t0) / 60).toFixed(1) });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE'); process.exit(0);
