// 014 谜题 3/4 后半段：按住键直到角度变化（避免 tap 漏帧）；阅读器打开时按真实时间等待
import { open, sleep, SH } from './b7lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5307);
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
await step(T, '白石 LOD', async () => {
  const r = await ev(`(() => { const s = __s2; const ws = s.greybox.whiteStones; let n = 0, lod = 0, crit = 0; ws.traverse(o => { if (o.isMesh) { n++; let a = o; let c = false; for (; a; a = a.parent) { if (a.isLOD) lod++; if (a.userData?.puzzleCritical) c = true; } if (c) crit++; } }); let lodsInScene = 0; s.scene.traverse(o => { if (o.isLOD) lodsInScene++; }); return { meshes: n, underLOD: lod, puzzleCritical: crit, lodsInScene, hasLodsFn: typeof window.__lods }; })()`);
  rec(T, '白石：无 THREE.LOD 祖先（始终 LOD0）+ puzzleCritical', r.underLOD === 0 && r.puzzleCritical === r.meshes ? 'PASS' : 'FAIL', r);
});
await step(T, '拨盘错码', async () => {
  await tp(4.2, 0.02, 10.6, 0); await waitSec(1.2);
  const e = await pressE('dial-gate-s2', `__game.input.context === 'puzzle'`);
  await waitSec(1.2);
  const f0 = await ft();
  const dial = (i) => `__s2.puzzles.dials[${i}].angles[0]`;
  const sel = () => ev(`__s2.puzzles.dialPuzzle.current?.id ?? null`);
  const r = { sel0: await sel() };
  await page.tap('KeyQ'); await waitSec(0.3); r.selQ = await sel();   // 拨盘 3
  for (const v of [36, 72, 108, 144, 180, 216]) await hold('KeyD', `${dial(2)} === ${v}`); // 006
  await page.tap('KeyE'); await waitSec(0.3); r.selE = await sel();   // 拨盘 1
  for (const v of [36, 72, 108]) await hold('KeyD', `${dial(0)} === ${v}`); // 306
  await page.tap('KeyE'); await waitSec(0.3);
  await hold('KeyD', `${dial(1)} === 36`); // 316
  await waitSec(3);
  const a = await st();
  const wrong = { sfx: (await evs('sfx:play', f0)).map(x => x.e.id), subs: (await evs('subtitle:show', f0)).map(x => x.e.id), respawn: (await evs('player:respawn', t0)).length, hints: (await evs('hint:show', f0)).length };
  await page.screenshot(`${SH}/s2-dial-316.png`);
  rec(T, '拨盘：316（中途经过 001…006、106…306）不开、无惩罚、无反馈', e.ok && JSON.stringify(a.dials) === '[108,36,216]' && !a.gateOpen && a.ctx === 'puzzle' && wrong.respawn === 0 ? 'PASS' : 'FAIL', { e, ...r, at316: { dials: a.dials, gateOpen: a.gateOpen, ctx: a.ctx, pos: a.pos }, wrong });
  await page.tap('KeyE'); await waitSec(0.3);
  await hold('KeyD', `${dial(2)} === 252`);
  const opened = await page.waitFor(`__s2.puzzles.state.gateOpen && __game.input.context === 'explore'`, 60000, 100);
  rec(T, '拨盘：316 → 第 3 位 +1 = 317 自动开门', opened ? 'PASS' : 'FAIL', { dials: (await st()).dials });
});
await step(T, '书桌：真实 E 拿起风灯、暖窗熄灭', async () => {
  await tp(-4.6, 3.02, -0.25, -Math.PI / 2); await waitSec(1);
  await ev(`(() => { const s = __s2; s.interaction.trigger(s.interaction.get('journal-s2')); return 1; })()`);
  await page.waitFor(`__game.ui.reader.isOpen`, 120000, 100); await sleep(2000);
  await page.tap('Tab'); await waitSec(2);
  const s1 = await st();
  const L = await ev(`(() => { const l = __s2.puzzles.lantern; const p = l.getWorldPosition(l.position.clone()); return [p.x, p.y + 0.13, p.z]; })()`);
  let aimL = false; for (let k = 0; k < 3 && !aimL; k++) aimL = await aimAt(L[0], L[1], L[2], 'lantern-s2', 10);
  const cands = await ev(`(() => { const s = __s2; return s.interaction.current?.id ?? null; })()`);
  const e2 = await pressE('lantern-s2', `__s2.interaction.held?.current?.id === 'lantern'`);
  await waitSec(3);
  const s2 = await st();
  await page.screenshot(`${SH}/s2-lantern-pickup.png`);
  rec(T, '书桌：真实 E 拿起风灯、暖窗熄灭', s1.glow && s1.lanternOnDesk && e2.ok && s2.holding === 'lantern' && !s2.glow ? 'PASS' : 'FAIL', { before: { glow: s1.glow, onDesk: s1.lanternOnDesk, journalRead: s1.journalRead, goal: s1.goal }, L, aimL, cur: cands, e2, after: { holding: s2.holding, glow: s2.glow, onDesk: s2.lanternOnDesk } });
});
console.log('ERRORS', JSON.stringify(page.errors));
await done(); console.log('DONE'); process.exit(0);
