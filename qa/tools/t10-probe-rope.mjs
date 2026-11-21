import { open, sleep } from './b10lib.mjs';
const { page, ev, must, url, done } = await open(5433);
await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
await must(`!!(window.__s1 && __s1.art?.loaded)`, 400000, 'S1');
await sleep(2000);
console.log(JSON.stringify(await ev(`(() => { const out = []; __s1.scene.traverse(o => { if (/rope|bow-end|pier-wood-ch1$/.test(o.name)) { const path = []; let p = o; while (p) { path.push(p.name || p.type); p = p.parent; } out.push({ name: o.name, type: o.type, vis: o.visible, path: path.slice(0, 6).join(' < ') }); } }); return { rope: __s1.art.rope, artRootName: __s1.art.root.name, inArtRoot: out.length, out: out.slice(0, 30) }; })()`), null, 1));
await done();
