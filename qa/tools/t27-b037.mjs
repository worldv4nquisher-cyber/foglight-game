// batch27 BUG-037 回归（a76631c）：测试构建（SMOKE_DIST 复用 /tmp/foglight-smoke-dist-b27qa）
// A. S3 窗口镜：同一 JS 任务内合成 keydown+keyup（必在同一帧间隔里）→ 精确转一档；CDP rawKeyDown+keyUp 连发 ×N → 每下 1 档；
//    按住：首档 1 次 + 连发、松开即停；对照：把 tappedThisFrame 换成「不记录」的 Set（模拟修复前）→ 同帧轻点被吞
// B. 探索走路：同帧轻点 W → 位置有位移（一帧量级）；对照（模拟修复前）→ 0；按住 W 1 s → 位移明显更大
process.env.SMOKE_DIST ||= '/tmp/foglight-smoke-dist-b27qa';
import { open, sleep, SH13 as SH } from './b27lib.mjs';
import { writeFileSync } from 'node:fs';
const D = `${SH}/hooks`; const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = { game: process.env.QA_GAME, dist: process.env.SMOKE_DIST, steps: [] }; const save = () => writeFileSync(`${D}/t27-b037.json`, JSON.stringify(out, null, 1));
const rec = (k, ok, d) => { out.steps.push({ k, ok, d }); log(ok ? '✓' : '✗', k, typeof d === 'string' ? d : JSON.stringify(d)); save(); };
const { page, ev, must, url, done } = await open(5782, { width: 1280, height: 720 });
const until = async (e, ms = 10000) => { const end = Date.now() + ms; let v; while (!(v = await ev(e).catch(() => false)) && Date.now() < end) await sleep(80); return v; };
const frames = async (n) => { const f0 = await ev(`__game.time.frame`); if (!(await until(`__game.time.frame >= ${f0 + n}`, 30000))) throw new Error('帧没跑满 ' + n); };
const ANG = `__s3.puzzles.beam.mirrors.window.part.angles`; const angles = () => ev(`[...${ANG}]`);
const KC = { KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], KeyE: ['e', 69], Tab: ['Tab', 9] };
const cdpKey = (type, code) => page.send('Input.dispatchKeyEvent', { type, code, key: KC[code][0], windowsVirtualKeyCode: KC[code][1], nativeVirtualKeyCode: KC[code][1] });
/** 同一 JS 任务里 keydown + keyup（中间不可能插进一帧） */
const synthTap = (code) => ev(`(() => { const f = __game.time.frame; const o = { code: ${JSON.stringify(code)}, key: ${JSON.stringify(KC[code][0])}, bubbles: true, cancelable: true };
  window.dispatchEvent(new KeyboardEvent('keydown', o)); window.dispatchEvent(new KeyboardEvent('keyup', o)); return __game.time.frame === f; })()`);
const near = (a, b) => Math.abs(a - b) < 1e-9; const eqA = (a, e) => near(a[0], e[0]) && near(a[1], e[1]);
const prefixOn = `(() => { const im = __game.input; window.__tapOrig ??= im.tappedThisFrame; const s = new Set(); s.add = function () { return this; }; im.tappedThisFrame = s; return im.tappedThisFrame !== window.__tapOrig; })()`;
const prefixOff = `(() => { __game.input.tappedThisFrame = window.__tapOrig; return 1; })()`;
try {
  await page.goto(url('?smoke=1&art=0&debug=1&scene=s3'));
  if (!(await until(`!!window.__s3?.puzzles?.beam`, 300000))) throw new Error('没进 S3');
  if (!(await until(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 180000))) throw new Error('S3 没回 explore');
  await ev(`__s3.puzzles.tide.set('low', { instant: true }), window.__rot = 0, __game.events.on('puzzle:partRotated', (e) => { if (e?.part === 'guide-mirror-s3-window') window.__rot++; }), 1`);
  out.fps = await ev(`(() => { const f = __game.time.frame, t = performance.now(); return new Promise((r) => setTimeout(() => r(((__game.time.frame - f) / ((performance.now() - t) / 1000)).toFixed(1)), 3000)); })()`);
  log('fps≈', out.fps);
  // ---------- B. 探索走路（先做：还在 explore）
  const pos = `(() => { const p = __s3.rig.body.position; return [p.x, p.z]; })()`;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const walkTap = async (label) => { await frames(8); const p0 = await ev(pos); const same = await synthTap('KeyW'); await frames(10); const p1 = await ev(pos); return { label, sameFrame: same, moved: +dist(p0, p1).toFixed(5) }; };
  const w1 = await walkTap('修复后 同帧轻点 W'); const w2 = await walkTap('修复后 同帧轻点 W（第 2 次）');
  await ev(prefixOn); const w0 = await walkTap('对照：模拟修复前'); await ev(prefixOff);
  await frames(8); const ph0 = await ev(pos); await page.keyDown('KeyW'); const t0 = Date.now(); await until(`__game.input.getAxis('moveY') === 1`, 5000); await sleep(1000); await page.keyUp('KeyW'); await frames(10); const ph1 = await ev(pos);
  const hold = { label: '按住 W ≈1 s（墙钟）', moved: +dist(ph0, ph1).toFixed(4), wallMs: Date.now() - t0 };
  rec('B 探索走路轻点', w1.sameFrame && w2.sameFrame && w1.moved > 1e-4 && w2.moved > 1e-4 && w0.moved < 1e-6 && hold.moved > w1.moved, { w1, w2, w0, hold });
  // ---------- A. 进窗口镜（真实 E）
  await ev(`(() => { const s = __s3, ix = s.puzzles.mirrorIx.window; s.interaction.cancel(); const sp = ix.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.05)); s.rig.controller.facing = sp.facing; return 1; })()`);
  if (!(await until(`__s3.interaction.current === __s3.puzzles.mirrorIx.window`, 10000))) throw new Error('镜前候选不对');
  await cdpKey('rawKeyDown', 'KeyE'); await cdpKey('keyUp', 'KeyE');
  if (!(await until(`__game.input.context === 'puzzle' && __s3.interaction.puzzle.active?.id === 'guide-mirror-s3-window-puzzle'`, 10000))) throw new Error('E 没进机关');
  await frames(3);
  // A1 同帧合成轻点：D A A D W S
  const seq = [['KeyD', [15, 0]], ['KeyA', [0, 0]], ['KeyA', [345, 0]], ['KeyD', [0, 0]], ['KeyW', [0, 15]], ['KeyS', [0, 0]]];
  const a1 = [];
  for (const [code, exp] of seq) { const r0 = await ev(`window.__rot`); const same = await synthTap(code); await frames(4); const a = await angles(); const r1 = await ev(`window.__rot`); a1.push({ code, same, exp, a, rot: r1 - r0, ok: same && eqA(a, exp) && r1 - r0 === 1 }); }
  rec('A1 机关同帧合成轻点 ×6（D A A D W S）每下精确 1 档', a1.every((x) => x.ok), a1);
  // A2 CDP 真实 rawKeyDown+keyUp 连发 ×12（D×6 再 A×6）
  const a2 = []; let exp = await angles();
  for (const code of ['KeyD', 'KeyD', 'KeyD', 'KeyD', 'KeyD', 'KeyD', 'KeyA', 'KeyA', 'KeyA', 'KeyA', 'KeyA', 'KeyA']) {
    const r0 = await ev(`window.__rot`); const f0 = await ev(`__game.time.frame`); await cdpKey('rawKeyDown', code); await cdpKey('keyUp', code); const f1 = await ev(`__game.time.frame`);
    exp = [(exp[0] + (code === 'KeyD' ? 15 : -15) + 360) % 360, exp[1]];
    await until(`(() => { const a = ${ANG}; return Math.abs(a[0] - ${exp[0]}) < 1e-9; })()`, 8000); await frames(3);
    const a = await angles(); const r1 = await ev(`window.__rot`); a2.push({ code, framesDuring: f1 - f0, a, rot: r1 - r0, ok: eqA(a, exp) && r1 - r0 === 1 });
  }
  rec('A2 机关 CDP 真实轻点 ×12 每下精确 1 档', a2.every((x) => x.ok), { n: a2.length, pass: a2.filter((x) => x.ok).length, sameFrameTaps: a2.filter((x) => x.framesDuring === 0).length, a2 });
  // A3 对照：模拟修复前，同帧合成轻点 D → 应被吞
  await ev(prefixOn); const b0 = await angles(); const r0 = await ev(`window.__rot`); const same0 = await synthTap('KeyD'); await frames(6); const b1 = await angles(); const r1 = await ev(`window.__rot`); await ev(prefixOff);
  rec('A3 对照（tappedThisFrame 失效 = 修复前）：同帧轻点被吞', same0 && eqA(b0, b1) && r1 === r0, { before: b0, after: b1, rot: r1 - r0 });
  // A4 按住：D 按下首档 1 次 + 连发；松开后不再转；delay 0.35 s / interval 0.15 s（游戏时间，无头低帧率下按游戏时间算）
  await ev(`(() => { __s3.puzzles.beam.mirrors.window.part.setAngle(0, 0); return 1; })()`); await frames(3);
  const g0 = await ev(`__game.time.elapsed ?? null`); const rA = await ev(`window.__rot`);
  await cdpKey('rawKeyDown', 'KeyD'); await until(`window.__rot > ${rA}`, 8000); const rFirst = (await ev(`window.__rot`)) - rA;
  const tg0 = await ev(`performance.now()`); await sleep(2500); await cdpKey('keyUp', 'KeyD'); const tg1 = await ev(`performance.now()`);
  const rHeld = (await ev(`window.__rot`)) - rA; await frames(6); const rAfter = (await ev(`window.__rot`)) - rA; const aH = await angles();
  rec('A4 按住 D：首档 1 次 + 连发，松开即停', rFirst === 1 && rHeld >= 3 && rAfter === rHeld && near(aH[0], (rHeld * 15) % 360), { rFirst, rHeld, rAfter, ang: aH, holdMs: Math.round(tg1 - tg0), expectApprox: `1 + floor((2.5 − 0.35)/0.15)+1 ≈ ${1 + Math.floor((2.5 - 0.35) / 0.15) + 1}（墙钟；低帧率下 dt 被 maxFrameDelta 截断会偏少）` });
  // A5 isDown 不受轻点影响（Shift 精调按真实按住）
  const isd = await ev(`(() => { const o = { code: 'ShiftLeft', key: 'Shift', bubbles: true }; window.dispatchEvent(new KeyboardEvent('keydown', o)); window.dispatchEvent(new KeyboardEvent('keyup', o)); return __game.input.isDown('fineAdjust'); })()`);
  rec('A5 同帧轻点 Shift 后 isDown(fineAdjust) 仍为 false', isd === false, { isDown: isd });
  await cdpKey('rawKeyDown', 'Tab'); await cdpKey('keyUp', 'Tab'); await until(`__game.input.context === 'explore'`, 8000);
  out.errors = page.errors.slice(0, 10); save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
await done(); process.exit(0);
