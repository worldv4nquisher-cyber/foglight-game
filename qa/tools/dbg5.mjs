import { launch, sleep } from './cdp.mjs';
const { page, close } = await launch({});
await page.addInit(`(() => { const f = window.fetch; window.__fl = []; window.fetch = function(u, o) { const p = f.apply(this, arguments); p.then(r => __fl.push([String(u), r.status, performance.now()|0]), e => __fl.push([String(u), 'ERR ' + e, performance.now()|0])); return p; }; })()`);
await page.goto('http://127.0.0.1:5248/?smoke=1'); await sleep(9000);
console.log(JSON.stringify(await page.evaluate('__fl')), await page.evaluate('window.__game?.scenes.current?.name'));
await page.goto('http://127.0.0.1:5248/?smoke=1'); await sleep(7000);
console.log('reload', JSON.stringify(await page.evaluate('__fl')));
close(); process.exit(0);
