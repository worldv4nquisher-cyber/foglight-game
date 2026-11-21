// batch10 S2 art=1：美术风灯（暖光例外）+ 东西灯台挂院墙 socket、风灯落座 / 光源高度
import { open, sleep, SH10, EVLOG, counter } from './b10lib.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5432);
const T = 'b10-S2'; const S = '__s2';
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2 explore');
await ev(counter(S));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const WP = `((o) => { if (!o) return null; o.updateWorldMatrix(true, false); const v = o.getWorldPosition(o.position.clone()); return [v.x, v.y, v.z].map(x => +x.toFixed(3)); })`;
await step(T, '美术件挂载', async () => {
  const r = await ev(`(() => { const s = ${S}, a = s.art, P = s.puzzles; const W = ${WP};
    const gbVis = (g) => { const v = []; g.traverse(o => { if (o.isMesh && o.visible && !/collider/.test(o.name)) { let p = o, art = false; while (p) { if (p.userData.artSlot || /prop-lantern/.test(p.name)) art = true; p = p.parent; } if (!art) v.push(o.name); } }); return v; };
    const st = {}; for (const k of ['east', 'west']) { const m = a.lampStands[k]; st[k] = m ? { name: m.name, pos: W(m), socket: W(m.getObjectByName('prop-lantern-stand-s2-socket')), emDir: W(m.getObjectByName('prop-lantern-stand-s2-emitter-dir')), wallSocket: W(s.scene.getObjectByName('env-courtyard-wall-s2-lamp-' + k + '-socket')), logicSocket: W(P.beam.lamps[k].socket), logicEmitter: W(P.beam.lamps[k].emitter.node ?? s.scene.getObjectByName('lamp-stand-' + k + '-s2-emitter')), gbVisible: gbVis(P.beam.lamps[k].stand) } : null; }
    const lanArt = P.lantern.getObjectByName('prop-lantern-brass') ?? P.lantern.children.find(c => /lantern-brass/.test(c.name));
    const gbLan = P.lantern.children.filter(c => /^s2-lantern-(body|glass|cap|handle)/.test(c.name)).map(c => c.name);
    return { stands: st, lanternArt: !!lanArt, lanternArtName: lanArt?.name ?? null, gbLanternParts: gbLan, lightColor: P.lanternLight.color.getHexString(), lightIntensity: P.lanternLight.intensity }; })()`);
  const okSt = ['east', 'west'].every(k => { const s = r.stands[k]; return s && s.wallSocket && Math.hypot(s.pos[0] - s.wallSocket[0], s.pos[1] - s.wallSocket[1], s.pos[2] - s.wallSocket[2]) < 0.005 && !s.gbVisible.length; });
  rec(T, '东西灯台：美术灯台根 = 院墙 lamp socket、白盒灯台外观隐藏', okSt ? 'PASS' : 'FAIL', r.stands);
  const okSock = ['east', 'west'].every(k => { const s = r.stands[k]; return s && s.socket && s.logicSocket && Math.hypot(s.socket[0] - s.logicSocket[0], s.socket[1] - s.logicSocket[1], s.socket[2] - s.logicSocket[2]) < 0.005; });
  rec(T, '灯台风灯 socket 位置读 GLB（逻辑 socket = 美术 -socket，y ≈1.008）', okSock ? 'PASS' : 'FAIL', Object.fromEntries(['east', 'west'].map(k => [k, [r.stands[k]?.socket, r.stands[k]?.logicSocket]])));
  rec(T, '风灯：美术 prop-lantern-brass 替换白盒外观，光源保持暖色', r.lanternArt && !r.gbLanternParts.length && r.lightColor === 'ffb060' ? 'PASS' : 'FAIL', { lanternArt: r.lanternArtName, gb: r.gbLanternParts, lightColor: r.lightColor, intensity: r.lightIntensity });
});
for (const k of ['east', 'west']) await step(T, `风灯放${k}灯台`, async () => {
  const r = await ev(`(() => { const s = ${S}, P = s.puzzles, h = s.interaction.held, L = P.beam.lamps['${k}']; const W = ${WP};
    if (P.lantern.parent && /socket/.test(P.lantern.parent.name) && h.sockets) { /* 已在某 socket：先拿起 */ }
    let placed = false; try { if (!h.isHolding('${'lantern'}') && !h.isHolding?.(P.lantern.name)) {} } catch {}
    const before = P.lantern.parent?.name;
    if (P.lantern.parent !== L.socket) { if (!h.isHolding?.('lantern')) { try { h.pickUp('lantern', P.lantern); } catch (e) {} } placed = h.place(L.socket); }
    s.scene.updateMatrixWorld(true);
    const em = P.lantern.getObjectByName('prop-lantern-brass-emitter') ?? (() => { let x = null; P.lantern.traverse(o => { if (!x && /-emitter$/.test(o.name)) x = o; }); return x; })();
    let col = null; P.lantern.traverse(o => { if (!col && o.isMesh && /-collider$/.test(o.name)) col = o; });
    let bottom = null; if (col) { const b = new col.geometry.boundingBox.constructor().setFromObject(col); bottom = +b.min.y.toFixed(3); }
    const stand = s.art.lampStands['${k}'];
    let standTop = null; if (stand) { const b = new (s.scene.position.constructor === undefined ? Object : Object)(); }
    return { before, placed, parent: P.lantern.parent?.name, handle: W(P.lantern), emitter: W(em), light: W(P.lanternLight), standSocket: W(stand?.getObjectByName('prop-lantern-stand-s2-socket')), emDir: W(stand?.getObjectByName('prop-lantern-stand-s2-emitter-dir')), beamEmitter: W(s.scene.getObjectByName('lamp-stand-${k}-s2-emitter')), lit: L.emitter.lit, color: L.emitter.color, bottom }; })()`);
  await waitN(30);
  const lit = await ev(`(() => { const P = ${S}.puzzles, L = P.beam.lamps['${k}']; const p = P.beam.tracer.paths.find(q => q.emitter === L.emitter); return { lit: L.emitter.lit, color: L.emitter.color, pathEnd: p?.end ?? null, segs: p?.segments?.length ?? p?.points?.length ?? null }; })()`);
  const d = (a, b) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 99;
  const ok = r.parent === `lamp-stand-${k}-s2-socket` && d(r.handle, r.standSocket) < 0.005 && d(r.light, r.emitter) < 0.005 && lit.lit && lit.color === 'warm';
  rec(T, `风灯放${k === 'east' ? '东' : '西'}灯台：提手 = 灯台 -socket、光源 = 风灯 -emitter、发射器亮且暖色`, ok ? 'PASS' : 'FAIL', { ...r, ...lit, handleToSocket: +d(r.handle, r.standSocket).toFixed(4), emitterY: r.emitter?.[1], emDirY: r.emDir?.[1] });
  const cam = await ev(`(() => { const s = ${S}, L = s.puzzles.beam.lamps['${k}']; const p = L.socket.getWorldPosition(L.socket.position.clone()); s.rig.body.teleport(new s.rig.body.position.constructor(p.x, 0.05, p.z + 1.6)); s.rig.body.velocity.set(0,0,0); s.cameraFollow.yaw = 0; s.cameraFollow.pitch = -0.1; return 1; })()`);
  await waitN(40);
  await page.screenshot(`${SH10}/s2-lantern-${k}.png`);
});
await step(T, '页面错误', async () => rec(T, '页面错误', page.errors?.length ? 'FAIL' : 'PASS', page.errors ?? []));
save('t10-s2'); await done();
