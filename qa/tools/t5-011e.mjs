import { open, sleep, SH } from './b5lib.mjs';
const P = await open(5260);
const { page, ev, must, url } = P;
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed?.tideArea && __game.input.context === 'explore'`, 180000, 'testbed');
await sleep(1000); await page.click(640, 400); await sleep(500);
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 300000, 'wait'); };
const tp = (x, y, z, f) => ev(`(() => { const tb = __testbed; tb.interaction.cancel?.(); tb.rig.body.teleport(new tb.rig.body.position.constructor(${x}, ${y}, ${z})); ${f !== undefined ? `tb.rig.controller.facing = ${f};` : ''} return 1; })()`);
const pos = () => ev(`__testbed.rig.body.position.toArray().map(v => +v.toFixed(2))`);
// 与 t5-011 同样：先在钟旁用 E 落潮


await page.tap('KeyY'); await must(`!__testbed.tideArea.tide.transitioning && __testbed.tideArea.tide.state === 'low'`, 300000, 'low');
const walkW = async (yaw, sec) => { await ev(`__testbed.cameraFollow.yaw = ${yaw}; 1`); await sleep(300); await page.keyDown('KeyW'); await waitSec(sec); await page.keyUp('KeyW'); await waitSec(0.3); return pos(); };
for (const x of [0, 0.5, -0.6]) { await tp(x, 2.02, 23); console.log('x', x, 'from z23 →', await walkW(Math.PI, 4)); }
await tp(0, 2.02, 23); console.log('stuck', await walkW(Math.PI, 4));
await page.screenshot(`${SH}/011-reef-seam-stuck.png`);
console.log('back 0.4s', await walkW(0, 0.4)); console.log('forward again', await walkW(Math.PI, 4));
await tp(0, 2.02, 23); console.log('stuck2', await walkW(Math.PI, 4));
await ev(`__testbed.cameraFollow.yaw = Math.PI; 1`); await page.keyDown('KeyW'); await waitSec(0.5); await page.tap('Space'); await waitSec(3); await page.keyUp('KeyW'); await waitSec(0.3); console.log('W+jump', await pos());
console.log('seam info', JSON.stringify(await ev(`(() => { const ph = __testbed.physics ?? __game.physics; const s = ph.colliders.find(c => c.source?.name === 'tide-reef-slope-collider'); const m = s.source; return { pos: m.position.toArray(), rotX: m.rotation.x, bmin: s.bounds.min.toArray(), bmax: s.bounds.max.toArray() }; })()`)));
await P.done(); process.exit(0);
