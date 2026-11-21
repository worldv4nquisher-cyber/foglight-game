import { open, sleep, SH } from './b5lib.mjs';
const T = 'v0.1-011';
const P = await open(5257);
const { page, ev, must, url, rec } = P;
await page.goto(url('?smoke=1&debug=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed?.tideArea && __game.input.context === 'explore'`, 180000, 'testbed');
await sleep(1000); await page.click(640, 400); await sleep(500);
const ft = () => ev('__game.time.fixedTick');
const waitSec = async (s) => { const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)}`, 300000, 'wait'); };
const tp = (x, y, z) => ev(`(() => { const tb = __testbed; tb.rig.body.teleport(new tb.rig.body.position.constructor(${x}, ${y}, ${z})); return 1; })()`);
const pos = () => ev(`__testbed.rig.body.position.toArray().map(v => +v.toFixed(2))`);
const phys = `(__testbed.physics ?? __game.physics)`;
console.log('phys?', await ev(`!!${phys} && ${phys}.colliders.length`));
// 真实敲钟落潮（Y）
await page.tap('KeyY'); await must(`!__testbed.tideArea.tide.transitioning && __testbed.tideArea.tide.state === 'low'`, 300000, 'low');
console.log('near gate', JSON.stringify(await ev(`${phys}.colliders.filter(c => c.enabled && c.bounds.min.z < 24.6 && c.bounds.max.z > 23.6 && c.bounds.min.x < 0.5 && c.bounds.max.x > -0.5 && c.bounds.max.y > 1.5).map(c => [c.source?.name, c.kind, c.bounds.min.toArray().map(v=>+v.toFixed(2)), c.bounds.max.toArray().map(v=>+v.toFixed(2))])`)));
for (const [label, start, yaw, sec] of [['岸台→南', [0, 2.02, 23.3], Math.PI, 4], ['坡上(0,~1.6,25)→南', [0, 1.8, 25], Math.PI, 4], ['坡底(0,0.12,30)→北', [0, 0.3, 30], 0, 8]]) {
  await tp(...start); await waitSec(0.5); await ev(`__testbed.cameraFollow.yaw = ${yaw}; 1`); await sleep(300);
  const p0 = await pos();
  const samp = ev(`__qa.sample(() => __testbed.rig.body.position.toArray().map(v => +v.toFixed(2)).concat([__testbed.rig.body.body?.onGround ?? __testbed.rig.body.onGround]), 9000)`);
  await page.keyDown('KeyW'); await waitSec(sec); await page.keyUp('KeyW'); await waitSec(0.3);
  const s = await samp; const p1 = await pos();
  console.log(label, 'start', p0, 'end', p1, 'path', JSON.stringify(s.filter((_, i) => i % 4 === 0)));
  await page.screenshot(`${SH}/011-reef-probe-${label.replace(/[^a-z0-9]/gi, '')}.png`);
}
await P.done(); process.exit(0);
