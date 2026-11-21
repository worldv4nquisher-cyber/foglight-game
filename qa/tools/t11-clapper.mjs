// batch11：钟锤碰壁音 sfx-tide-bell-clapper 真按 E 敲钟时要真的响（阈值缺省 0.055 / 美术根 clapperHitRad 0.0537）
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const SC = process.env.SC || 's1', Q = process.env.Q || 'art=1', X = `__${SC}`;
const T = `b11-clapper-${SC}-${Q}`;
const { page, ev, must, url, rec, step, done } = await open(5510 + (SC === 's3' ? 2 : 0) + (Q === 'art=1' ? 1 : 0));
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url(`?smoke=1&debug=1&scene=${SC}&${Q}`));
await must(`!!window.${X}?.puzzles && __game.input.context === 'explore' && !${X}.rig.controller.busy`, 400000, SC);
await page.click(640, 360, 'left'); await sleep(300); // 用户手势解锁 AudioContext
await ev(counter(X));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
await step(T, '敲钟', async () => {
  const info0 = await ev(`(() => { const b = ${X}.puzzles.bell, m = ${X}.artSlots?.mounted?.find(x => /tide-bell/.test(x.id)); let root = null; m?.model.traverse(o => { if (root === null && o.userData?.clapperHitRad !== undefined) root = { name: o.name, v: o.userData.clapperHitRad }; });
    return { hitRad: b.clapperHitRad, mounted: m?.id ?? null, artRoot: root, buf: __game.assets.audio.has('sfx-tide-bell-clapper'), missing: [...__game.assets.missing].filter(k => /clapper/.test(k)), ctx: __game.audio.context?.state }; })()`);
  const sp = await ev(`(() => { const b = ${X}.puzzles.bell.interactable; const r = b.standPoint(${X}.rig.body.position.clone()); return { p: [r.position.x, r.position.y, r.position.z], f: r.facing }; })()`);
  await ev(`(() => { const s = ${X}, f = ${sp.f}; const p = new s.rig.body.position.constructor(${sp.p[0]} - Math.sin(f) * 0.15, ${sp.p[1]} + 0.03, ${sp.p[2]} - Math.cos(f) * 0.15); s.rig.body.teleport(p); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.15; return 1; })()`);
  await waitN(20);
  const ok = await page.waitFor(`/敲钟/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 60000, 150);
  if (!ok) { rec(T, '敲钟提示', 'FAIL', { prompt: await ev(`document.querySelector('.hud-prompt')?.textContent ?? null`), sp }); return; }
  await ev(`(() => { const A = __game.audio; window.__pb = []; const o = A.playBuffer.bind(A); A.playBuffer = (buf, vol, rate) => { window.__pb.push({ n: window.__n, dur: +buf.duration.toFixed(3), vol: +(vol ?? 1).toFixed(3) }); return o(buf, vol, rate); };
    const ob = A.beep.bind(A); A.beep = (...a) => { window.__pb.push({ n: window.__n, beep: a[0] }); return ob(...a); };
    window.__sfx = []; __game.events.on('sfx:play', (e) => window.__sfx.push({ id: e.id, opt: !!e.optional, n: window.__n }));
    window.__f = () => { const b = ${X}.puzzles.bell; return { n: window.__n, cl: b.clapperAngle, hits: b.clapperHits ?? null, rings: b.rings }; }; window.__smp = []; return 1; })()`);
  await page.tap('KeyE');
  await waitN(420);
  const smp = await ev(`(() => { const r = window.__smp; window.__smp = null; return r; })()`);
  const sfx = await ev('window.__sfx'), pb = await ev('window.__pb');
  const cl = sfx.filter(x => x.id === 'sfx-tide-bell-clapper'), ring = sfx.filter(x => x.id === 'sfx-tide-bell');
  const dur = await ev(`__game.assets.audio.get('sfx-tide-bell-clapper')?.duration ?? null`);
  const played = cl.filter(c => pb.some(p => p.n === c.n && p.dur === +(dur ?? -1).toFixed(3)));
  const beeps = pb.filter(p => p.beep && cl.some(c => c.n === p.n));
  const maxCl = Math.max(...smp.map(s => Math.abs(s.cl)));
  const info = { ...info0, ring: ring.map(x => x.n), clapperSfx: cl.map(x => x.n), clapperHitsCounter: smp.at(-1)?.hits, maxClapperAbs: +maxCl.toFixed(4), clapperFileDur: dur, playedClapperBuffers: played.length, fallbackBeepsAtClapper: beeps.length, ctxAfter: await ev('__game.audio.context?.state') };
  const want = Q === 'art=1' ? (SC === 's1' || SC === 's3') : false;
  if (Q === 'art=1') {
    rec(T, `阈值：美术根 clapperHitRad 生效（期望 0.0537）`, Math.abs(info0.hitRad - 0.0537) < 1e-6 && info0.artRoot && Math.abs(info0.artRoot.v - 0.0537) < 1e-6 ? 'PASS' : 'FAIL', info);
    rec(T, '真按 E 敲钟：钟锤碰壁 sfx-tide-bell-clapper ≥1 次、且真的用 032 文件 buffer 播出（不是合成占位）', cl.length >= 1 && played.length === cl.length && !beeps.length && maxCl >= info0.hitRad - 1e-6 ? 'PASS' : 'FAIL', info);
  } else {
    rec(T, '阈值缺省 0.055（无美术）；钟锤碰壁事件仍发、文件缺失时静默不出合成音', Math.abs(info0.hitRad - 0.055) < 1e-6 && cl.length >= 1 && !beeps.length && !played.length ? 'PASS' : 'FAIL', info);
  }
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
