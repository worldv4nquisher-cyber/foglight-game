import { REPO_ROOT } from './paths.mjs';
// 短探针：S2 书桌按 E 读日志后游戏是否继续跑（每次 evaluate 限时 10 s）
import { open, sleep } from './b7lib.mjs';
const { page, ev, must, url, done } = await open(5304);
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  for (const n of ['interact:used','sfx:play','subtitle:show','beam:receiverOn','puzzle:solved','player:respawn','journal:updated','scene:enter'])
    v.events.on(n, (e) => window.__ev.push({ n, e: JSON.parse(JSON.stringify(e ?? null)), ft: v.time.fixedTick, el: v.time.elapsed }));
} }); })();`);
const evT = (e, ms = 10000) => Promise.race([ev(e), new Promise(r => setTimeout(() => r('EVAL_TIMEOUT'), ms))]);
await page.goto(url('?debug=1')); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=0'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 300000, 's2');
await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(-4.6, 3.02, -0.25)); s.rig.controller.facing = -Math.PI/2; return 1; })()`);
await sleep(1500);
for (let i = 0; i < 8; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(-5.0, 3.77, 0.02).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z); s.cameraFollow.pitch = ${i >= 4 ? -1 : 1} * Math.asin(t.y); return 1; })()`); await sleep(400); if (await ev(`__s2.interaction.current?.id ?? __s2.interaction.current?.()?.id ?? null`) === 'journal-s2') break; }
const q = `JSON.stringify({ ft: __game.time.fixedTick, cur: __s2.interaction.current?.id, reader: __game.ui.reader.isOpen, ctx: __game.input.context, holding: !!__s2.puzzles.state.lanternOnDesk })`;
console.log('PRE', await evT(q));
const f0 = await ev('__game.time.fixedTick'); await page.keyDown('KeyE'); await sleep(600); await page.keyUp('KeyE');
for (let i = 0; i < 6; i++) { await sleep(2500); const r = await evT(q); console.log('T+' + (i + 1) * 2.5, r); if (r === 'EVAL_TIMEOUT') { const s = await Promise.race([page.screenshot((REPO_ROOT + '/docs/bugs/qa-v0.1-batch7/s2-journal-hang.png')).then(() => 'shot'), sleep(15000).then(() => 'shot-timeout')]); console.log(s); } }
await Promise.race([page.screenshot((REPO_ROOT + '/docs/bugs/qa-v0.1-batch7/s2-journal-probe.png')), sleep(15000)]);
console.log('EV', JSON.stringify(await evT(`__ev.filter(x => x.ft >= ${f0}).map(x => [x.n, x.e?.id, x.ft])`)).slice(0, 1500));
console.log('ERR', JSON.stringify(page.errors ?? []).slice(0, 800));
process.exit(0);
