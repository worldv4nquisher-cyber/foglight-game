import { open, sleep, SH } from './b7lib.mjs';
const { page, ev, must, url, done } = await open(5309);
await page.goto(url('?debug=1')); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=0'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 300000, 's2');
await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(-4.6, 3.02, -0.25)); s.rig.controller.facing = -Math.PI/2; s.cameraFollow.yaw = Math.PI/2; s.interaction.trigger(s.interaction.get('journal-s2')); return 1; })()`);
await page.waitFor(`__game.ui.reader.isOpen`, 120000, 100); await sleep(2000); await page.tap('Tab');
await page.waitFor(`!__game.ui.reader.isOpen && __game.input.context === 'explore'`, 60000, 100); await sleep(3000);
const probe = `(() => { const s = __s2, I = s.interaction; const V = s.rig.body.position.constructor; const out = [];
  for (const it of I.items) { const f = it.focus(new V()); const d = Math.hypot(f.x - s.rig.body.position.x, f.z - s.rig.body.position.z) - it.reach; const n = f.clone().project(s.camera);
    if (d < 3) out.push({ id: it.id, en: it.enabled, can: I.canInteract(it), d: +d.toFixed(2), f: f.toArray().map(v => +v.toFixed(2)), ndc: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(3)] }); }
  return { cur: I.current?.id ?? null, facing: +s.rig.controller.facing.toFixed(2), yaw: +s.cameraFollow.yaw.toFixed(2), pitch: +s.cameraFollow.pitch.toFixed(2), cam: s.camera.getWorldPosition(new V()).toArray().map(v => +v.toFixed(2)), lanternParent: s.puzzles.lantern.parent?.name, items: out }; })()`;
console.log('DEFAULT', JSON.stringify(await ev(probe)));
for (const p of [-0.3, -0.6]) for (const dy of [-0.3, -0.2, -0.12, -0.06, 0.06, 0.12, 0.2, 0.3]) { await ev(`(() => { __s2.cameraFollow.pitch = ${p}; __s2.cameraFollow.yaw = Math.PI/2 + ${dy}; return 1; })()`); await sleep(2500); const r = await ev(probe); console.log('SWEEP', p, dy, JSON.stringify({ cur: r.cur, yaw: r.yaw, pitch: r.pitch, facing: r.facing, lantern: r.items.find(i => i.id === 'lantern-s2')?.ndc, note: r.items.find(i => i.id === 'xi-note-s2')?.ndc, journal: r.items.find(i => i.id === 'journal-s2')?.ndc })); if (r.cur === 'lantern-s2') { await page.screenshot(`${SH}/s2-desk-lantern-target.png`); } }
await page.screenshot(`${SH}/s2-desk-pitch-down.png`);
await done(); process.exit(0);
