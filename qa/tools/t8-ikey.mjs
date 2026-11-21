import { open, sleep } from './b8lib.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5413);
await step('I键', 'testbed autoIgnite 默认关、I 键切换', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=testbed'));
  await must(`!!window.__testbed?.rig && __game.scenes.current?.name === 'testbed' && __game.input.context === 'explore'`, 600000, 'testbed');
  const v0 = await ev(`__testbed.beamArea?.autoIgnite ?? __game.scenes.current.beamArea.autoIgnite`);
  await page.tap('KeyI'); await sleep(500);
  const v1 = await ev(`__game.scenes.current.beamArea.autoIgnite`);
  await page.tap('KeyI'); await sleep(500);
  const v2 = await ev(`__game.scenes.current.beamArea.autoIgnite`);
  rec('I键', 'autoIgnite 默认 false，I → true，再 I → false', v0 === false && v1 === true && v2 === false ? 'PASS' : 'FAIL', { v0, v1, v2, errors: page.errors });
});
save('t8-ikey'); await done();
