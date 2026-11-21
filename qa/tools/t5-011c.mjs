import { open, sleep, SH } from './b5lib.mjs';
const P = await open(5258);
const { page, ev, must, url } = P;
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed?.tideArea && __game.input.context === 'explore'`, 180000, 'testbed');
await sleep(1000); await page.click(640, 400); await sleep(500);
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 300000, 'wait'); };
const tp = (x, y, z, f) => ev(`(() => { const tb = __testbed; tb.interaction.cancel?.(); tb.rig.body.teleport(new tb.rig.body.position.constructor(${x}, ${y}, ${z})); ${f !== undefined ? `tb.rig.controller.facing = ${f};` : ''} return 1; })()`);
const pos = () => ev(`__testbed.rig.body.position.toArray().map(v => +v.toFixed(2))`);
// 与 t5-011 同样：先在钟旁用 E 落潮
await tp(-4, 2.02, 22.45, Math.PI); await sleep(500);
await must(`__testbed.interaction.current?.id === 'tide-bell'`, 30000, 'bell');
await page.tap('KeyE'); await must(`!__testbed.tideArea.tide.transitioning && __testbed.tideArea.tide.state === 'low'`, 300000, 'low');
for (let i = 0; i < 3; i++) {
  await tp(0, 2.02, 23); await ev(`__testbed.cameraFollow.yaw = Math.PI; 1`); await sleep(300);
  const samp = ev(`__qa.sample(() => __testbed.rig.body.position.toArray().map(v => +v.toFixed(2)).concat([__game.input.context, +__testbed.rig.controller.speed?.toFixed?.(2)]), 8000)`);
  await page.keyDown('KeyW'); await waitSec(5); await page.keyUp('KeyW'); await waitSec(0.3);
  const s = await samp;
  console.log('trial', i, 'end', await pos(), 'path', JSON.stringify(s.filter((_, j) => j % 3 === 0)));
}
await P.done(); process.exit(0);
