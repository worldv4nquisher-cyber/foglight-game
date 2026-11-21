// F01 回归：真实键盘输入（CDP Input.dispatchKeyEvent）验证每次场景切换后都能走动。需要 dev 服务器（npm run dev）。
// 用法：node scripts/check-transition-unlock.mjs chain   # ?scene=s1 → 走出口 S1→S2 → S2→S3
//       node scripts/check-transition-unlock.mjs s2|s3   # 先在该场景入口存档，再从主菜单「继续」进场
import { launchChrome, sleep } from './lib/cdp.mjs';
const BASE = process.env.BASE ?? 'http://localhost:5173/';
const c = await launchChrome({ tag: 'f01', watchdogMs: 15 * 60_000 });
const st = () => c.evaluate(`(() => { const s = __game.scenes.current; const r = s?.rig; return { scene: s?.name, ctx: __game.input.context, tr: __game.flow.transitioning, locked: r?.controller.locked ?? null, pos: r ? [r.body.position.x, r.body.position.z].map(v => +v.toFixed(2)) : null }; })()`);
const key = (type, code, k, vk) => c.send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
async function walk(label) {
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  const a = await st();
  await key('keyDown', 'KeyW', 'w', 87);
  await sleep(1500);
  await key('keyUp', 'KeyW', 'w', 87);
  await sleep(300);
  const b = await st();
  const d = a.pos && b.pos ? Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) : 0;
  console.log(`${label}: scene=${b.scene} locked=${b.locked} ctx=${b.ctx} moved=${d.toFixed(2)}m ${d > 0.5 ? 'PASS' : 'FAIL'}`);
  return d > 0.5;
}
const settle = async (scene) => {
  await c.until(`__game?.scenes.current?.name === '${scene}' && !__game.flow.transitioning`, 240_000);
  await c.until(`__game.scenes.current.cameraFollow?.modeName === 'follow'`, 60_000).catch(() => {});
  await sleep(6000);
};
const exitThrough = async () => c.evaluate(`(() => { const s = __game.scenes.current; const e = s.exits[0].opts.center; void s.rig.controller.teleportTo(e.clone ? e.clone() : e, { fade: 0 }); return true; })()`);
let ok = true;
const mode = process.argv[2] ?? 'chain';
if (mode === 'chain') {
  await c.send('Page.navigate', { url: `${BASE}?debug=1&scene=s1&quality=low` });
  await settle('s1-ebb-shore');
  ok = (await walk('S1 direct load')) && ok;
  await exitThrough();
  await settle('s2-keeper-house');
  ok = (await walk('S1->S2')) && ok;
  await exitThrough();
  await settle('s3-lighthouse');
  ok = (await walk('S2->S3')) && ok;
} else {
  // menu: seed a save at sceneId, then Continue from the main menu with real clicks
  const scene = mode; // s2 / s3
  await c.send('Page.navigate', { url: `${BASE}?debug=1&scene=${scene}&quality=low` });
  await settle(scene === 's2' ? 's2-keeper-house' : 's3-lighthouse');
  await c.send('Page.navigate', { url: `${BASE}?quality=low` });
  await c.until(`__game?.scenes.current?.name === 'menu'`, 120_000);
  await sleep(3000);
  const btn = await c.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && /继续|Continue/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, b.textContent]; })()`);
  console.log('continue button', btn);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn[0], y: btn[1], button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn[0], y: btn[1], button: 'left', clickCount: 1 });
  await settle(scene === 's2' ? 's2-keeper-house' : 's3-lighthouse');
  ok = (await walk(`menu Continue -> ${scene}`)) && ok;
}
if (c.errors.length) console.log('errors:', c.errors.slice(0, 5));
c.close();
process.exit(ok ? 0 : 1);
