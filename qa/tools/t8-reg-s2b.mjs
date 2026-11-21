// 358a1a1 BUG-014 补：journal standPoint，yaw × pitch 网格，读日志前后各扫一遍
import { open, sleep } from './b8lib.mjs';
const { page, ev, must, url, rec, step, save, done } = await open(5412);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=0'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 600000, 's2');
await ev(`(() => { const s = __s2; window.__n = 0; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; }; return 1; })()`);
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 600000, 'ticks'); };
const P0 = await ev('__s2.cameraFollow.pitch');
const view = async (dyaw, pitch) => { await ev(`(() => { const s = __s2; s.interaction.cancel?.(); const st = s.interaction.get('journal-s2').standPoint(new s.rig.body.position.constructor()); const p = st.position; s.rig.body.teleport(p.clone().setY(p.y + 0.02)); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = st.facing; s.cameraFollow.yaw = st.facing + Math.PI + ${dyaw}; s.cameraFollow.pitch = ${pitch}; return 1; })()`); await waitN(12); return ev(`__s2.interaction.current?.id ?? null`); };
const grid = async () => { const g = {}; for (const dy of [-0.4, -0.2, 0, 0.2, 0.3, 0.4]) for (const p of [-0.45, -0.3, P0, 0, 0.15, 0.3]) { const c = await view(dy, p); (g[c] ??= []).push([dy, +p.toFixed(2)]); } return g; };
await step('reg-BUG-014', '书桌网格（读前 / 读后）', async () => {
  const d0 = await view(0, P0); const before = await grid();
  await view(0, P0); await page.tap('KeyE');
  const opened = await page.waitFor(`__game.ui.reader.isOpen`, 120000, 100); await sleep(800); await page.tap('Tab');
  await page.waitFor(`!__game.ui.reader.isOpen && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 120000, 100); await waitN(60);
  const d1 = await view(0, P0); const after = await grid();
  const ok = d0 === 'journal-s2' && d1 === 'lantern-s2' && before['chart-s2'] && before['xi-note-s2'] && after['chart-s2'] && after['xi-note-s2'];
  rec('reg-BUG-014', '默认 → 日志；读后 → 风灯；抬头能选海图、低头能选纸条（读前 / 读后）', ok ? 'PASS' : 'FAIL', { P0, d0, opened, d1, before, after });
});
save('t8-reg-s2b'); await done();
