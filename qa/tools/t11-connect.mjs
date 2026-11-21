// batch11 S2 art=1：真放风灯到东灯台 + 正解镜 → 光感锁接通：sfx-beam-connect 一声 + sfx-beam-hum-loop；断光 >0.3 s 淡出、再接通再一声
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-connect';
const { page, ev, must, url, rec, step, done } = await open(5561);
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
await ev(counter('__s2'));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
await ev(`(() => { const a = __game.audio; window.__pb = []; window.__lp = []; const pb = a.playBuffer.bind(a), sl = a.startLoop.bind(a), st = a.stopLoop.bind(a);
  const key = (buf) => { for (const [k, v] of __game.assets.audio) if (v === buf) return k; return null; };
  a.playBuffer = (b, ...r) => { window.__pb.push({ k: key(b), ft: __game.time.fixedTick }); return pb(b, ...r); };
  a.startLoop = (n, o = {}) => { window.__lp.push({ on: n, buf: key(o.buffer), fadeIn: o.fadeIn, ft: __game.time.fixedTick }); return sl(n, o); };
  a.stopLoop = (n, o = {}) => { window.__lp.push({ off: n, fadeOut: o.fadeOut, ft: __game.time.fixedTick }); return st(n, o); }; return 1; })()`);
await step(T, '接通', async () => {
  await ev(`__s2.puzzles.beam.solve(), 1`);
  for (const key of ['east']) {
    await ev(`(() => { const s = __s2, P = s.puzzles, h = s.interaction.held; if (h.current?.id !== 'lantern') { try { h.pickUp('lantern', P.lantern); } catch (e) {} }
      const it = s.interaction.get('lamp-stand-${key}-s2'); const r = it.standPoint ? it.standPoint(s.rig.body.position.clone()) : null; const f = r?.facing ?? 0; const p = r ? r.position : it.focus;
      s.rig.body.teleport(new s.rig.body.position.constructor(p.x - Math.sin(f) * 0.1, p.y + 0.03, p.z - Math.cos(f) * 0.1)); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.2; return 1; })()`);
    await waitN(20);
    const f0 = await ev('__game.time.fixedTick');
    await page.keyDown('KeyE'); await sleep(250); await page.keyUp('KeyE');
    const ok = await page.waitFor(`__s2.puzzles.lantern.parent?.name === 'lamp-stand-${key}-s2-socket' && !__s2.interaction.animState`, 900000, 300);
    await waitN(30);
    const r = await ev(`(() => { const b = __s2.puzzles.beam; return { placed: ${!!'x'} && __s2.puzzles.lantern.parent?.name, lit: b.lamps.${key}.emitter.lit, lock: b.lock.state, recv: b.tracer.paths.map(p => (p.emitter.lit ? '亮 ' : '灭 ') + (p.receiver?.id ?? p.end ?? null)), humOn: __s2.puzzles.beamHum.on, starts: __s2.puzzles.beamHum.starts }; })()`);
    const sfx = await ev(`__ev.filter(e => e.n === 'sfx:play' && e.ft >= ${f0}).map(e => e.e.id + '@' + e.ft)`), pb = await ev(`__pb.filter(p => p.ft >= ${f0}).map(p => p.k + '@' + p.ft)`), lp = await ev(`__lp.filter(l => l.ft >= ${f0})`);
    rec(T, '风灯放东灯台（真按 E）+ 镜正解 → 光感锁接通：sfx-beam-connect 1 声（文件）+ sfx-beam-hum-loop 起播（文件 buffer）', ok && sfx.filter(x => x.startsWith('sfx-beam-connect')).length === 1 && pb.some(x => x.startsWith('sfx-beam-connect')) && lp.some(l => l.on === 'sfx-beam-hum-loop' && l.buf === 'sfx-beam-hum-loop') ? 'PASS' : 'FAIL', { ok, ...r, sfx, pb, lp });
    await page.screenshot(`${SH11}/s2-lightlock-connect.png`);
  }
  // 断光：镜 A 转走 → >0.3 s 后嗡鸣淡出；再转回 → 再一声
  const f1 = await ev('__game.time.fixedTick');
  await ev(`__s2.puzzles.beam.mirrorA.part.setAngle(0, 0), 1`); await waitN(40);
  const a = await ev(`({ humOn: __s2.puzzles.beamHum.on, lp: __lp.filter(l => l.ft >= ${f1}) })`);
  await ev(`__s2.puzzles.beam.solve(), 1`); await waitN(30);
  const b = await ev(`({ humOn: __s2.puzzles.beamHum.on, starts: __s2.puzzles.beamHum.starts, sfx: __ev.filter(e => e.n === 'sfx:play' && e.ft >= ${f1}).map(e => e.e.id + '@' + e.ft), lp: __lp.filter(l => l.ft >= ${f1}) })`);
  rec(T, '断光 40 步（0.67 s > 0.3 s）嗡鸣 stopLoop；重新接通再起播 + 再一声 connect', !a.humOn && a.lp.some(l => l.off === 'sfx-beam-hum-loop') && b.humOn && b.sfx.filter(x => x.startsWith('sfx-beam-connect')).length === 1 ? 'PASS' : 'FAIL', { a, b });
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
