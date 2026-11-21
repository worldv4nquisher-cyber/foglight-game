import { launch, sleep } from './cdp.mjs';
import { startDev, startPreview } from './server.mjs';
const mode = process.argv[2];
const srv = mode === 'preview' ? await startPreview(5210) : await startDev(5211);
const { page, close } = await launch();
const log = [];
await page.send('Log.enable');
for (let i = 0; i < 3; i++) {
  await page.goto(srv.url + '/?scene=testbed' + (mode === 'preview' ? '&smoke=1' : ''));
  const ok = await page.waitFor(`window.__testbed?.rig && __game.scenes.current?.name === 'testbed'`, 60000);
  await sleep(4000);
  const st = await page.evaluate(`({ scene: __game.scenes.current?.name, tb: !!window.__testbed, frame: __game.time.frame, href: location.href })`).catch((e) => String(e));
  log.push({ i, ok, st, errs: page.errors.length, first: page.errors[0]?.slice(0, 300) });
}
console.log(JSON.stringify(log, null, 1));
close(); await srv.close(); process.exit(0);
