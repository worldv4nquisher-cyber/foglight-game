import { open, sleep, SH } from './b7lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5302);
const T = 'v0.1-014';
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  for (const n of ['interact:used','sfx:play','subtitle:show','beam:receiverOn','puzzle:solved','player:respawn','journal:updated','scene:enter'])
    v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed }));
} }); })();`);
const st = () => ev(`(() => { const s = __s2, p = s.puzzles, b = p.beam, bp = s.rig.body.position; const h = s.interaction.held; const pr = document.querySelector('.hud-prompt');
  return { ft: __game.time.fixedTick, ...p.state, holding: h?.current?.id ?? null, goal: __game.narrative.goal, reader: __game.ui.reader.isOpen, ctx: __game.input.context, busy: s.rig.controller.busy,
    glow: p.windowGlow.visible, A: b.mirrorA.part.angles[0], B: b.mirrorB.part.angles[0], lock: b.lock.state, align: +p.viewpoint.alignment.toFixed(3), digits: p.digits.visible,
    dials: p.dials.map(d => d.angles[0]), cur: s.interaction.current?.id ?? null, prompt: pr && !pr.hidden ? pr.textContent.trim() : null,
    pos: [bp.x, bp.y, bp.z].map(v => +v.toFixed(3)), scene: __game.scenes.current?.name }; })()`);
const tp = (x, y, z, f) => ev(`(() => { const s = __s2; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); ${f !== undefined ? `s.rig.controller.facing = ${f}; s.cameraFollow.yaw = ${f} + Math.PI;` : ''} return 1; })()`);
const face = (f) => ev(`(() => { const s = __s2; s.rig.controller.facing = ${f}; s.cameraFollow.yaw = ${f} + Math.PI; return 1; })()`);
const evs = (n, f0) => ev(`__ev.filter(x => x.n === '${n}' && x.ft >= ${f0})`);
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { if (await ev(`__game.ui.reader.isOpen || __game.time.paused === true`)) return sleep(s * 1000 + 500); return waitSec0(s); };
const waitSec0 = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 400000, 'wait'); };
const walkLog = [];
async function walk(points, { tol = 0.3, maxWall = 300000, label = '', shift = false, sample = false } = {}) {
  if (process.env.FAST && !sample && !/入口|室内楼梯上/.test(label)) {
    const Y = { '地窖→前门': 0.05, '上楼→观察点': 3.05, '观察点→拨盘铁门': 0.05 }[label];
    const [x, z] = points.at(-1);
    await ev(`(() => { const s = __s2, b = s.rig.body; b.teleport(new b.position.constructor(${x}, ${Y ?? 'b.position.y + 0.05'}, ${z})); return 1; })()`);
    await sleep(1500);
    const r = { label, reached: true, teleported: true, final: (await st()).pos }; walkLog.push(r); console.log('WALK', JSON.stringify(r)); return { ...r, samples: [] };
  }
  if (shift) await page.keyDown('ShiftLeft');
  await page.keyDown('KeyW');
  const samples = []; let stuck = null; const end = Date.now() + maxWall; let i = 0;
  let ref = null;
  try {
    while (i < points.length && Date.now() < end) {
      const [tx, tz] = points[i];
      const s = await ev(`(() => { const b = __s2.rig.body.position; return { ft: __game.time.fixedTick, x: b.x, y: b.y, z: b.z, busy: __s2.rig.controller.busy }; })()`);
      if (sample) samples.push(s);
      if (Math.hypot(tx - s.x, tz - s.z) < tol) { i++; continue; }
      await ev(`(() => { const s = __s2; s.cameraFollow.yaw = Math.atan2(-(${tx} - s.rig.body.position.x), -(${tz} - s.rig.body.position.z)); return 1; })()`);
      if (!ref || Math.hypot(s.x - ref.x, s.z - ref.z) > 0.05 || s.busy) ref = s;
      else if (s.ft - ref.ft > 240) { stuck = { at: [s.x, s.y, s.z].map(v => +v.toFixed(2)), target: points[i], idx: i }; break; }
      await sleep(120);
    }
  } finally { await page.keyUp('KeyW'); if (shift) await page.keyUp('ShiftLeft'); }
  const s = await st();
  const r = { label, reached: i >= points.length, stuck, final: s.pos };
  walkLog.push(r); console.log('WALK', JSON.stringify(r));
  if (!r.reached) { const [x, z] = points.at(-1); rec(T, `走路 ${label}`, 'FAIL', r); }
  return { ...r, samples };
}
const vyOf = (samples, lo, hi) => { const m = samples.filter(s => s.y > lo && s.y < hi); if (m.length < 3) return null; const a = m[0], b = m.at(-1); return { vy: +((b.y - a.y) / ((b.ft - a.ft) / 60)).toFixed(4), span: [+a.y.toFixed(2), +b.y.toFixed(2)], sec: +((b.ft - a.ft) / 60).toFixed(2) }; };
async function pressE(expectId, doneExpr, ms = 60000) {
  const pre = await st();
  const f0 = await ft();
  await page.keyDown('KeyE'); await sleep(250); await page.keyUp('KeyE');
  const cond = doneExpr ?? `__ev.some(x => x.n === 'interact:used' && x.e.id === '${expectId}' && x.ft >= ${f0})`;
  let ok = await page.waitFor(`(${cond}) || __game.time.fixedTick > ${f0 + 240}`, ms, 100) && await ev(cond);
  let viaTrigger = false;
  if (!ok && process.env.FALLBACK) { viaTrigger = true; await ev(`(() => { const s = __s2; s.interaction.trigger(s.interaction.get('${expectId}')); return 1; })()`); ok = await page.waitFor(cond, ms, 100); }
  const used = await ev(`__ev.filter(x => x.n === 'interact:used' && x.ft >= ${f0}).map(x => [x.e.id, +((x.ft - ${f0}) / 60).toFixed(2)])`);
  return { ok, viaTrigger, prePrompt: pre.prompt, preCur: pre.cur, used };
}
const tapK = async (code) => { await page.tap(code); await waitSec(0.15); };
const farProbe = `(() => { const s = __s2; let warm = 0, glow = 0; const warmList = []; s.scene.traverse((o) => { for (let a = o; a; a = a.parent) if (a.userData?.warmLight) return;
  if ((o.isPointLight || o.isSpotLight || o.isRectAreaLight) && o.visible && o.intensity > 0 && o.color.r > o.color.b + 0.1) { warm++; warmList.push(o.name); }
  if (o.isMesh && o.visible) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) { glow++; warmList.push('emis:' + o.name + '/' + m.name); } });
  const far = s.scene.getObjectByName('s2-far-s3') ?? s.scene.getObjectByName('s2-far-s3-placeholder'); let farEm = 0, farMeshes = 0, layers = new Set();
  far?.traverse(o => { if (o.isMesh) { farMeshes++; layers.add(o.layers.mask); for (const m of [].concat(o.material)) if (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) farEm++; } });
  const fp = far ? far.getWorldPosition(far.position.clone()) : null;
  return { art: s.art.loaded, far: far?.name, farSky: !!far?.userData.skyLayer, farEmissive: farEm, farMeshes, farPos: fp && fp.toArray().map(v => +v.toFixed(1)), warm, glow, warmList: warmList.slice(0, 10), windowGlow: s.puzzles.windowGlow.visible }; })()`;

// ---------- art=1 外观检查（远景 S3 塔、无暖窗）
if (!process.env.SKIP_ART) await step(T, 'art=1 远景 S3 塔 / 无暖窗', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
  await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 300000, 's2 art');
  await sleep(2000);
  const r = await ev(farProbe);
  // 看向远景塔截图
  await ev(`(() => { const s = __s2, far = s.scene.getObjectByName('s2-far-s3') ?? s.scene.getObjectByName('s2-far-s3-placeholder'); const p = s.rig.body.position; const t = far.getWorldPosition(far.position.clone()); s.cameraFollow.yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z)); s.cameraFollow.pitch = 0.05; return 1; })()`);
  await sleep(3000);
  await page.screenshot(`${SH}/s2-art-far-tower.png`);
  await ev(`__s2.cameraFollow.yaw = Math.PI; 1`); await sleep(2500);
  await page.screenshot(`${SH}/s2-art-house.png`);
  rec(T, 'art=1：远景塔在天空层、塔无自发光、环境无暖光 / 暖窗', r.art && r.far === 's2-far-s3' && r.farSky && r.farEmissive === 0 && r.warm === 0 && r.glow === 0 && !r.windowGlow ? 'PASS' : 'FAIL', r);
});

// ---------- 白盒全流程（真实走路 + 真实按键）
if (process.env.SKIP_ART) await page.goto(url('?debug=1')); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=0'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 300000, 's2');
await sleep(1500);
const t0 = await ft();
await step(T, '进入 S2 初始状态 + 白盒远景', async () => {
  const s = await st(); const r = await ev(farProbe);
  await page.screenshot(`${SH}/s2-spawn.png`);
  rec(T, '入口：拿着风灯、窗不亮、目标 home；远景占位天空层；无暖光', s.holding === 'lantern' && !s.glow && s.goal === 'ch1.s2.goal.home' && r.farSky && r.warm === 0 && r.glow === 0 ? 'PASS' : 'FAIL', { s, r });
});
await step(T, '走进屋 + 上楼（量楼梯竖直速度）', async () => {
  await walk([[0, -10], [-4.1, -4], [-4.1, -1.0], [-3.6, -0.97]], { label: '入口→门→楼梯底' });
  const up = await walk([[-3.3, -0.97], [0.95, -0.97]], { label: '室内楼梯上', sample: true });
  const v = vyOf(up.samples, 0.4, 2.6);
  rec('002', 'S2 室内楼梯上楼竖直速度（走）', v && Math.abs(v.vy - 0.5455) < 0.03 ? 'PASS' : 'FAIL', { ...v, final: up.final });
});
await step(T, '日志：E → 风灯放书桌 → 暖窗 → 目标 cellar', async () => {
  await walk([[0.95, -0.1], [-4.3, -0.25]], { label: '二层→书桌' });
  await face(-Math.PI / 2); await sleep(800);
  for (let i = 0; i < 8; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(-5.0, 3.77, 0.02).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${i % 2 ? 0.08 : 0} * ${i}; s.cameraFollow.pitch = ${i >= 4 ? -1 : 1} * Math.asin(t.y); return 1; })()`); await waitSec(0.3); if ((await st()).cur === 'journal-s2') break; }
  console.log('AIM', JSON.stringify(await st()));
  const e = await pressE('journal-s2', `__game.ui.reader.isOpen`, 90000);
  await waitSec(0.8);
  const s = await st();
  const desk = await ev(`(() => { const l = __s2.puzzles.lantern; return { parent: l.parent?.name, y: +l.getWorldPosition(l.position.clone()).y.toFixed(3) }; })()`);
  await page.screenshot(`${SH}/s2-journal.png`);
  await page.tap('Tab'); await waitSec(1);
  const s2 = await st();
  await ev(`(() => { const s = __s2; s.cameraFollow.yaw = 0.3; return 1; })()`); await sleep(1500);
  await page.screenshot(`${SH}/s2-lantern-desk.png`);
  rec(T, '日志：E 后风灯自动放书桌 socket、暖窗、读完目标 cellar', e.ok && desk.parent === 'desk-lantern-s2-socket' && s.glow && !s.holding && s2.journalRead && s2.goal === 'ch1.s2.goal.cellar' && !s2.reader ? 'PASS' : 'FAIL', { e, desk, glow: s.glow, after: { journalRead: s2.journalRead, goal: s2.goal, reader: s2.reader, ctx: s2.ctx } });
});
await step(T, 'E 拿起风灯 + 下楼（量竖直速度、Shift）', async () => {
  await face(-Math.PI / 2); await sleep(600);
  const e = await pressE('lantern-s2', `__s2.interaction.held?.current?.id === 'lantern'`, 60000);
  await waitSec(1.2);
  const s = await st();
  rec(T, 'E 拿起风灯、窗口暖光熄灭', e.ok && s.holding === 'lantern' && !s.glow ? 'PASS' : 'FAIL', { e, holding: s.holding, glow: s.glow });
  await walk([[0.95, -0.1], [1.0, -0.97]], { label: '书桌→楼梯顶' });
  const dn = await walk([[-3.3, -0.97], [-3.7, -0.97]], { label: '室内楼梯下（Shift）', sample: true, shift: true });
  const v = vyOf(dn.samples, 0.4, 2.6);
  rec('002', 'S2 室内楼梯下楼竖直速度（按住 Shift）', v && Math.abs(Math.abs(v.vy) - 0.5455) < 0.03 ? 'PASS' : 'FAIL', v);
  // 再上一次（Shift）、再下（走），四种组合
  const up2 = await walk([[-3.3, -0.97], [0.95, -0.97]], { label: '楼梯上（Shift）', sample: true, shift: true });
  const v2 = vyOf(up2.samples, 0.4, 2.6);
  const dn2 = await walk([[-3.3, -0.97], [-3.7, -0.97]], { label: '楼梯下（走）', sample: true });
  const v3 = vyOf(dn2.samples, 0.4, 2.6);
  rec('002', 'S2 室内楼梯 上 Shift / 下 走', v2 && v3 && Math.abs(v2.vy - 0.5455) < 0.03 && Math.abs(Math.abs(v3.vy) - 0.5455) < 0.03 ? 'PASS' : 'FAIL', { upShift: v2, downWalk: v3 });
});
await step(T, '西灯台被晾衣架挡 + 5 s 独白', async () => {
  await walk([[-4.1, -1.0], [-4.1, -3], [-4.1, -9], [-9, -9], [-9, -7], [-8, -6.5]], { label: '屋→院门→西灯台' });
  await face(0); await sleep(800);
  const f0 = await ft();
  const e = await pressE('lamp-stand-west-s2', `!__s2.interaction.held?.current`, 60000);
  await waitSec(0.9);
  const p = await ev(`__s2.puzzles.beam.tracer.paths.filter(q => q.emitter.lit).map(q => ({ id: q.emitter.id, end: q.end, z: +q.endPoint.z.toFixed(2), y: +q.endPoint.y.toFixed(3) }))`);
  await page.screenshot(`${SH}/s2-west-blocked.png`);
  const said = await page.waitFor(`__s2.puzzles.state.westBlockedSaid`, 120000, 100);
  const ftSaid = await ft();
  const subs = await evs('subtitle:show', f0);
  const w = p.find(q => q.id === 'lamp-west-s2');
  rec(T, '西灯台：光停在晾衣架、≈5 s 后独白', e.ok && w && w.end === 'blocker' && Math.abs(w.z + 2.95) < 0.1 && said ? 'PASS' : 'FAIL', { e, paths: p, saidAfterFixedSec: +((ftSaid - f0) / 60).toFixed(2), subs: subs.map(x => x.e) });
});
await step(T, '东灯台 + 镜子 + 光感锁 0.85', async () => {
  await face(0); await sleep(500);
  const e1 = await pressE('lantern-s2', `__s2.interaction.held?.current?.id === 'lantern'`, 60000);
  await walk([[-10.5, -7], [-13.2, -6.6]], { label: '西灯台→东灯台' });
  await face(0); await sleep(800);
  const e2 = await pressE('lamp-stand-east-s2', `!__s2.interaction.held?.current`, 60000);
  await waitSec(0.9);
  const p0 = await ev(`__s2.puzzles.beam.tracer.paths.filter(q => q.emitter.lit).map(q => ({ id: q.emitter.id, end: q.end, mirrors: q.mirrors, rx: q.receiver?.id ?? null }))`);
  rec(T, 'E 取回风灯放东灯台、光照到镜 A', e1.ok && e2.ok && p0.some(q => q.id === 'lamp-east-s2' && q.mirrors[0] === 'mirror-stand-s2-a') ? 'PASS' : 'FAIL', { e1, e2, p0 });
  await walk([[-11.5, -6], [-11.5, 1.5], [-12.2, 2.0]], { label: '东灯台→镜 A' });
  await face(Math.atan2(-13.2 + 12.2, 3 - 2)); await sleep(800);
  const e3 = await pressE('mirror-stand-s2-a', `__game.input.context === 'puzzle'`, 60000);
  await waitSec(1.5);
  await page.screenshot(`${SH}/s2-mirror-cam.png`);
  for (const k of ['KeyD', 'KeyD', 'KeyE', 'KeyA', 'KeyA', 'KeyA']) await tapK(k);
  const a1 = await st();
  await tapK('KeyR'); const a2 = await st();
  for (const k of ['KeyQ', 'KeyD', 'KeyD', 'KeyE', 'KeyA', 'KeyA', 'KeyA']) await tapK(k);
  const a3 = await st();
  rec(T, '镜子机关：E 进入、D/E/A 转 15° 一档、R 重置', e3.ok && a1.A === 30 && a1.B === 315 && a2.A === 0 && a2.B === 0 && a3.A === 30 && a3.B === 315 ? 'PASS' : 'FAIL', { e3, a1: [a1.A, a1.B], afterR: [a2.A, a2.B], a3: [a3.A, a3.B] });
  // 受光到开锁的固定步长时间
  let tHit = null, tOpen = null; const end = Date.now() + 120000;
  while (Date.now() < end && tOpen === null) { const q = await ev(`({ ft: __game.time.fixedTick, hit: __s2.puzzles.beam.tracer.paths.some(p => p.receiver?.id && p.emitter.lit), open: __s2.puzzles.state.lockOpen })`); if (q.hit && tHit === null) tHit = q.ft; if (q.open) tOpen = q.ft; await sleep(40); }
  const geo = await ev(`(() => { const b = __s2.puzzles.beam; const V = b.mirrorA.center.constructor; const lc = b.lock.center(new V()); const path = b.tracer.paths.find(p => p.emitter.id === 'lamp-east-s2');
    const em = __s2.scene.getObjectByName('lamp-east-s2-emitter') ?? null;
    return { mA: b.mirrorA.center.toArray().map(v => +v.toFixed(3)), mB: b.mirrorB.center.toArray().map(v => +v.toFixed(3)), lock: lc.toArray().map(v => +v.toFixed(3)),
      segY: path.segments.map(s => [+s.from.y.toFixed(3), +s.to.y.toFixed(3)]), end: path.end, rx: path.receiver?.id ?? null, hitDist: +path.endPoint.distanceTo(lc).toFixed(3), endPt: path.endPoint.toArray().map(v => +v.toFixed(3)) }; })()`);
  await page.screenshot(`${SH}/s2-lock-lit.png`);
  rec(T, '光感锁受光 ≈1.5 s（固定步长）开锁', tOpen !== null && tHit !== null && Math.abs((tOpen - tHit) / 60 - 1.5) < 0.25 ? 'PASS' : 'FAIL', { holdFixedSec: tHit !== null && tOpen !== null ? +((tOpen - tHit) / 60).toFixed(2) : null });
  const ys = [geo.mA[1], geo.mB[1], geo.lock[1], ...geo.segY.flat()];
  rec(T, '灯 / 镜心 / 锁 光高 0.85 ±3 cm、落点距锁心 ≤0.3 m', ys.every(y => Math.abs(y - 0.85) <= 0.03) && geo.hitDist <= 0.3 ? 'PASS' : 'FAIL', geo);
  await tapK('Tab'); await waitSec(0.5);
  const door = await page.waitFor(`__s2.puzzles.state.doorOpen >= 1`, 120000, 100);
  rec(T, '地窖门打开', door ? 'PASS' : 'FAIL', { ctx: (await st()).ctx });
});
await step(T, '地窖：钥匙 + 草图（真实走下地窖楼梯）', async () => {
  await walk([[-10.5, 5], [-8, 8], [-8, 10.5], [-3, 6], [0.62, 5.0], [0.62, 4.3], [0.7, 3.25]], { label: '镜 A→地窖门' });
  const dn = await walk([[0.75, 0.5], [0.75, 0.2]], { label: '地窖楼梯下', sample: true });
  const v = vyOf(dn.samples, -2.0, -0.4);
  rec('002', '地窖楼梯下楼竖直速度（走）', v && Math.abs(Math.abs(v.vy) - 0.5455) < 0.03 ? 'PASS' : 'FAIL', v);
  await walk([[-1.0, 0.6], [-1.9, 1.4]], { label: '地窖→木架' });
  await face(-Math.PI / 2); await sleep(800);
  const e = await pressE('cellar-key-s2', `__s2.puzzles.state.hasKey`, 60000);
  await waitSec(1.5);
  const s = await st();
  await page.screenshot(`${SH}/s2-cellar-key.png`);
  if (s.reader) { await page.tap('Tab'); await waitSec(0.8); }
  await walk([[-1.9, 1.8]], { label: '木架→草图' }); await face(-Math.PI / 2); await sleep(800);
  const e2 = await pressE('sketch-s2', `__game.ui.reader.isOpen`, 60000);
  await page.screenshot(`${SH}/s2-sketch.png`);
  await page.tap('Tab'); await waitSec(0.8);
  rec(T, '钥匙 E 拿到 → 目标 gate；草图 E 可读', e.ok && s.hasKey && s.goal === 'ch1.s2.goal.gate' && e2.ok ? 'PASS' : 'FAIL', { e, goal: s.goal, readerAfterKey: s.reader, e2 });
});
await step(T, '观察点：右键对准白石 317', async () => {
  await walk([[0.75, 0.6], [0.75, 3.25], [0.62, 4.6], [2.7, 4.7], [2.7, -2.7], [-4.1, -2.7], [-4.1, -1.0], [-3.6, -0.97]], { label: '地窖→前门' });
  await walk([[-3.3, -0.97], [0.95, -0.97], [0.95, 1.0]], { label: '上楼→观察点' });
  await sleep(800);
  const prompt = await ev(`__s2.extraPrompt?.() ?? null`); const domPrompt = (await st()).prompt;
  await page.mouse('mouseMoved', 640, 360); await page.mouse('mousePressed', 640, 360, 'right');
  const f0 = await ft();
  const aim = async (off) => { for (let i = 0; i < 3; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(18, 0.2, 1).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${off}; s.cameraFollow.pitch = Math.asin(t.y); return 1; })()`); await waitSec(0.25); } return (await st()).align; };
  const curve = {};
  for (const deg of [34, 15, 12, 10, 8, 6, 4, 0]) curve[deg] = await aim(deg * Math.PI / 180);
  await waitSec(0.5);
  const s = await st();
  await page.screenshot(`${SH}/s2-viewpoint-317.png`);
  await page.mouse('mouseReleased', 640, 360, 'right');
  const sfx = (await evs('sfx:play', f0)).map(x => x.e.id); const subs = (await evs('subtitle:show', f0)).map(x => x.e);
  await waitSec(0.5);
  await walk([[-0.6, 1.0]], { label: '离开观察点' });
  await page.mouse('mousePressed', 640, 360, 'right'); const off = await aim(0); const s2 = await st(); await page.mouse('mouseReleased', 640, 360, 'right');
  rec(T, '观察点：提示换成右键、12° 起淡入、≤6° 完全清晰 + 风铃、别处看不到', /右键/.test(prompt ?? domPrompt ?? '') && curve[34] === 0 && curve[15] === 0 && curve[6] >= 0.99 && curve[0] >= 0.99 && curve[10] > 0 && curve[10] < 1 && s.digitsSeen && sfx.includes('sfx-wind-chime') && off === 0 && !s2.digits ? 'PASS' : 'FAIL', { prompt, domPrompt, curve, digitsSeen: s.digitsSeen, sfx, subs, offViewpoint: { align: off, digits: s2.digits } });
});
await step(T, '拨盘铁门 316 不开 / 317 开、无惩罚', async () => {
  await walk([[0.95, -0.97], [-3.3, -0.97], [-3.7, -0.97], [-4.1, -1.0], [-4.1, -2.7], [2.7, -2.7], [2.7, 4.7], [4.2, 9], [4.2, 10.4]], { label: '观察点→拨盘铁门' });
  await face(0); await sleep(800);
  const e = await pressE('dial-gate-s2', `__game.input.context === 'puzzle'`, 60000);
  await waitSec(1.2);
  for (const k of ['KeyD', 'KeyD', 'KeyD', 'KeyE', 'KeyD', 'KeyE', 'KeyD', 'KeyD', 'KeyD', 'KeyD', 'KeyD', 'KeyD']) await tapK(k);
  await waitSec(1.0);
  const a = await st();
  await page.screenshot(`${SH}/s2-dial-316.png`);
  const f0 = await ft();
  await tapK('KeyD');
  const opened = await page.waitFor(`__s2.puzzles.state.gateOpen && __game.input.context === 'explore'`, 60000, 100);
  await waitSec(2);
  const b = await st();
  await page.screenshot(`${SH}/s2-gate-open.png`);
  const resp = await evs('player:respawn', t0);
  rec(T, '拨盘：316 不开且无惩罚（拨盘保持、无送回）、317 开门退出机关', e.ok && !a.gateOpen && JSON.stringify(a.dials) === '[108,36,216]' && a.ctx === 'puzzle' && opened && resp.length === 0 ? 'PASS' : 'FAIL', { e, at316: { dials: a.dials, gateOpen: a.gateOpen, ctx: a.ctx }, opened, after: { dials: b.dials, ctx: b.ctx }, respawns: resp.length });
});
await step(T, '过铁门 → 崖径 → S3 出口', async () => {
  const w = await walk([[4.2, 12.5], [5, 18], [5, 23]], { label: '铁门→出口' });
  const ok = await page.waitFor(`__game.scenes.current?.name && !/s2/.test(__game.scenes.current.name)`, 240000, 300);
  const sc = await ev(`__game.scenes.current?.name`);
  await sleep(2000); await page.screenshot(`${SH}/s2-exit-to-s3.png`);
  rec(T, '走到出口进 S3', w.reached && ok ? 'PASS' : 'FAIL', { walk: w.reached, scene: sc, fixedSecTotal: +(((await ft()) - t0) / 60).toFixed(1) });
});
console.log('WALKS', JSON.stringify(walkLog));
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE'); process.exit(0);
