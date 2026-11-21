// batch12：S2 状态型文本（日志 / 钥匙木牌 / 拨盘铁门首次进入）
import { open, sleep, EVLOG } from './b12lib.mjs';
const T = 'b12-read2';
const { page, ev, must, url, rec, step, done } = await open(5546, { width: 480, height: 270 });
await page.addInit(EVLOG);
await step(T, 's2', async () => {
  await page.goto(url('?smoke=1&debug=1&scene=s2&art=1&quality=standard'));
  await must(`!!window.__s2?.rig && !!__s2.art && __game.input.context === 'explore'`, 400000, 's2');
  const all = await ev(`__s2.interaction.items.map(i => i.id + ':' + i.kind + ':' + (i.textId ?? '') + ':' + i.enabled)`);
  rec(T, 'S2 交互物清单', 'INFO', all);
  for (const [re, want, wait] of [['^journal-s2$', 'ch1.s2.journal.doc', 60000], ['key', 'ch1.s2.key.tag_inspect', 240000], ['dial|gate', 'ch1.s2.dial_gate.inspect', 120000]]) {
    const f0 = await ev('__game.time.fixedTick');
    const id = await ev(`(() => { const s = __s2; if (__game.ui.reader.isOpen) __game.ui.reader.close(); const it = s.interaction.items.find(i => new RegExp(${JSON.stringify(re)}).test(i.id) && i.kind !== 'read'); if (!it) return null; it.enabled = true; const p = it.standPoint ? it.standPoint(s.rig.body.position.clone()) : null; if (p) { s.rig.body.teleport(p.position.clone().setY(p.position.y + 0.03)); s.rig.body.velocity.set(0,0,0); } s.interaction.trigger(it); return it.id + ':' + it.kind; })()`);
    const ok = await page.waitFor(`__ev.some(e => e.ft >= ${f0} && ((e.n === 'reader:open' && e.e?.docId === '${want}') || (e.n === 'subtitle:show' && e.e?.id === '${want}')))`, wait, 300);
    const got = await ev(`__ev.filter(e => e.ft >= ${f0} && /reader:open|subtitle:show|puzzle:enter/.test(e.n)).map(e => e.n + ':' + (e.e?.docId ?? e.e?.id ?? e.e?.group))`);
    rec(T, `${want}（触发 ${id}）`, ok ? 'PASS' : 'FAIL', got.slice(0, 5));
    await ev(`(() => { if (__game.ui.reader.isOpen) __game.ui.reader.close(); if (__game.input.context === 'puzzle') __s2.cameraFollow.exitPuzzleView?.(); return 1; })()`);
    await sleep(1500);
  }
});
await done(); console.log('DONE');
