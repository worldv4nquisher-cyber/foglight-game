import { open, sleep } from './b10lib.mjs';
const { page, ev, must, url, done } = await open(5434); console.log("GAME", process.env.QA_GAME);
await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
await must(`!!(window.__s1 && __s1.art?.loaded)`, 400000, 'S1');
await sleep(1000);
console.log(JSON.stringify(await ev(`(async () => { const rs = performance.getEntriesByType('resource').filter(r => /pier/.test(r.name)).map(r => [r.name, r.transferSize, r.encodedBodySize]);
 const u = rs[0]?.[0]; let nodes = null; if (u) { const b = await (await fetch(u)).arrayBuffer(); const dv = new DataView(b); const len = dv.getUint32(12, true); const j = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 20, len))); nodes = j.nodes.map(n => n.name).filter(n => /rope/.test(n)); }
 const m = __game.assets?.getModel ? (() => { try { const o = __game.assets.getModel('env-pier-wood-ch1'); const n = []; o.traverse(x => n.push(x.name)); return n; } catch (e) { return String(e); } })() : 'no getModel';
 return { rs, nodes, model: m }; })()`), null, 1));
await done();
