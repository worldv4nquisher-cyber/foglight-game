import { REPO_ROOT } from './paths.mjs';
// batch12：027 接入后 text-ch1 阅读 / 查看点逐个触发（art=1，S1/S2/S3）
import { open, sleep, EVLOG } from './b12lib.mjs';
import { readFileSync } from 'node:fs';
const T = 'b12-read';
const want = JSON.parse(readFileSync((REPO_ROOT + '/docs/gdd/text-ch1.json'), 'utf8')).entries.filter(e => ['inspect', 'doc', 'journal'].includes(e.type)).map(e => e.id);
const { page, ev, must, url, rec, step, done } = await open(5544, { width: 480, height: 270 });
await page.addInit(EVLOG);
const seen = {};
for (const [sc, q] of (process.argv[2] ?? 's1,s2,s3').split(',').map(s => [s, s === 's1' ? 'scene=s1' : 'scene=' + s])) await step(T, sc, async () => {
  await page.goto(url(`?smoke=1&debug=1&${q}&art=1&quality=standard`));
  await must(`!!window.__${sc}?.rig && !!__${sc}.art && __game.input.context === 'explore'`, 400000, sc);
  const items = await ev(`__${sc}.interaction.items.filter(i => i.kind === 'read' || i.kind === 'inspect').map(i => ({ id: i.id, kind: i.kind, text: i.textId, en: i.enabled }))`);
  const res = [];
  for (const it of items) {
    const f0 = await ev('__game.time.fixedTick');
    await ev(`(() => { const s = __${sc}; if (__game.ui.reader.isOpen) __game.ui.reader.close(); const it = s.interaction.get('${it.id}'); const p = it.standPoint ? it.standPoint(s.rig.body.position.clone()) : null; if (p) { s.rig.body.teleport(p.position.clone().setY(p.position.y + 0.03)); s.rig.body.velocity.set(0,0,0); } s.interaction.trigger(it); return 1; })()`);
    const hit = await page.waitFor(`__ev.some(e => e.ft >= ${f0} && ((e.n === 'reader:open' && e.e?.docId === '${it.text}') || (e.n === 'subtitle:show' && e.e?.id === '${it.text}')))`, 90000, 200);
    const got = await ev(`__ev.filter(e => e.ft >= ${f0} && (e.n === 'reader:open' || e.n === 'subtitle:show')).map(e => e.n.split(':')[0] + ':' + (e.e?.docId ?? e.e?.id))`);
    res.push({ ...it, ok: hit, got: got.slice(0, 3) });
    if (hit) seen[it.text] = sc;
    await ev(`(() => { if (__game.ui.reader.isOpen) __game.ui.reader.close(); return 1; })()`);
    await sleep(300);
  }
  rec(T, `${sc} 阅读 / 查看点 ${items.length} 个逐个触发出对应文本`, res.every(r => r.ok) ? 'PASS' : 'FAIL', res);
});
const missing = want.filter(id => !seen[id]);
rec(T, 'text-ch1 inspect/doc/journal 覆盖', 'INFO', { want: want.length, seen: Object.keys(seen).length, notTriggeredHere: missing });
await done(); console.log('DONE');
