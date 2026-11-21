import { open, sleep } from './b4lib.mjs';
const P = await open(5247);
const { page, ev, url, must } = P;
await page.addInit(`(() => { const f = window.fetch; window.__fl = []; window.fetch = function(u, o) { const p = f.apply(this, arguments); p.then(r => __fl.push([String(u), r.status, performance.now()|0]), e => __fl.push([String(u), 'ERR ' + e, performance.now()|0])); return p; }; })()`);
await page.send('Runtime.enable');
await page.goto(url('?smoke=1')); await must(`window.__game?.scenes.current?.name === 'menu'`, 90000); await sleep(1500);
console.log(JSON.stringify(await ev('__fl')));
await P.done(); process.exit(0);
