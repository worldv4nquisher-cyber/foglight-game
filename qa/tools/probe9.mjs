import { launch, sleep } from './cdp.mjs';
import { startDev } from './server.mjs';
const dev = await startDev(5212);
const { page, close } = await launch();
const out = {};
for (const q of ['/?scene=testbed', '/']) {
  await page.goto(dev.url + q);
  await page.waitFor(`window.__game?.scenes.current && __game.scenes.current.name !== 'loading'`, 90000);
  await sleep(3000);
  await page.evaluate(`__game.pause('user')`); await sleep(800);
  const menu = await page.evaluate(`({ shown: !document.querySelector('.pause-menu')?.hidden, foot: document.querySelector('.pause-menu .menu-foot')?.textContent })`);
  await page.evaluate(`__game.resume()`); await sleep(2000);
  out[q] = { scene: await page.evaluate(`__game.scenes.current.name`), menu, errs: page.errors.length, first: page.errors.slice(0, 2).map((e) => e.slice(0, 200)) };
}
console.log(JSON.stringify(out, null, 1));
close(); await dev.close(); process.exit(0);
