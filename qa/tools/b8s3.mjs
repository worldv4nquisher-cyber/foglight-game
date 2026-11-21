// batch8 S3 公用：事件记录 + 局部坐标传送 + 机关真按键
import { open, sleep, SH } from './b8lib.mjs';
export { sleep, SH };
export const EVLOG = `(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v;
  const skip = new Set(['interact:holdProgress','interact:pushMoved','beam:updated','puzzle:partHover']);
  const emit = v.events.emit.bind(v.events);
  v.events.emit = (n, e) => { if (!skip.has(n)) { let c = null; try { c = JSON.parse(JSON.stringify(e ?? null)); } catch {} window.__ev.push({ n, e: c, ft: v.time.fixedTick }); } return emit(n, e); };
} }); })();`;
export async function s3(port, q = 'art=0') {
  const o = await open(port);
  const { page, ev, must, url } = o;
  await page.addInit(EVLOG);
  await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
  await page.goto(url(`?smoke=1&debug=1&beamDebug=1&scene=s3&${q}`));
  await must(`!!window.__s3?.puzzles && __game.input.context === 'explore' && !__s3.rig.controller.busy`, 400000, 's3 进场');
  const ft = () => ev('__game.time.fixedTick');
  const waitSec = async (s) => { if (await ev(`__game.ui.reader.isOpen`)) return sleep(s * 1000 + 500); const t0 = await ft(); await must(`__game.time.fixedTick >= ${t0 + Math.round(s * 60)} || __game.ui.reader.isOpen`, 900000, 'wait ' + s); };
  const evs = (n, f0 = 0) => ev(`__ev.filter(x => x.n === '${n}' && x.ft >= ${f0})`);
  const L = `((x,y,z) => __s3.frame.localToWorld(new __s3.rig.body.position.constructor(x,y,z)))`;
  const loc = () => ev(`(() => { const p = __s3.frame.worldToLocal(__s3.rig.body.position.clone()); return [p.x, p.y, p.z].map(v => +v.toFixed(3)); })()`);
  // 传送到局部 (x,y,z)，面朝局部 (fx,fz)
  const tpL = async (x, y, z, fx, fz) => { await ev(`(() => { const s = __s3, w = ${L}(${x}, ${y}, ${z}), t = ${L}(${fx}, ${y}, ${fz}); s.rig.body.teleport(w); s.rig.body.velocity.set(0,0,0); const f = Math.atan2(t.x - w.x, t.z - w.z); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; return 1; })()`); };
  const aimL = async (x, y, z, id, tries = 8) => { for (let i = 0; i < tries; i++) { await ev(`(() => { const s = __s3, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = ${L}(${x}, ${y}, ${z}).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${i % 3 === 2 ? 0.05 : 0}; s.cameraFollow.pitch = ${i % 2 ? -1 : 1} * Math.asin(t.y); return 1; })()`); await waitSec(0.3); if ((await ev(`__s3.interaction.current?.id ?? null`)) === id) return true; } return false; };
  const hold = async (code, cond, ms = 60000) => { await page.keyDown(code); const ok = await page.waitFor(cond, ms, 30); await page.keyUp(code); await waitSec(0.1); return ok; };
  const prompt = () => ev(`((p) => (p && !p.hidden ? p.textContent.trim() : null))(document.querySelector('.hud-prompt'))`);
  const angs = (k) => ev(`__s3.puzzles.beam.mirrors.${k}.part.angles.slice()`);
  const n360 = (a) => ((a % 360) + 360) % 360;
  // 机关模式里把镜子 k 的第 axis 轴真按键转到 target（每档按住到角度变化再松）
  const plus = {};
  async function turnTo(k, axis, target, log = []) {
    const keys = axis === 0 ? ['KeyD', 'KeyA'] : ['KeyW', 'KeyS'];
    for (let i = 0; i < 40; i++) {
      const cur = (await angs(k))[axis];
      const diff = axis === 0 ? ((n360(target - cur) + 180) % 360) - 180 : target - cur;
      if (Math.abs(diff) < 0.01) return true;
      const pk = plus[`${k}${axis}`];
      if (!pk) { // 先探方向
        const ok = await hold(keys[0], `__s3.puzzles.beam.mirrors.${k}.part.angles[${axis}] !== ${cur}`, 60000);
        const nv = (await angs(k))[axis]; const d = axis === 0 ? ((n360(nv - cur) + 180) % 360) - 180 : nv - cur;
        if (!ok || !d) { log.push(['nodir', k, axis, cur, nv]); return false; }
        plus[`${k}${axis}`] = d > 0 ? keys[0] : keys[1]; log.push(['dir', k, axis, keys[0], d]); continue;
      }
      const key = diff > 0 ? pk : (pk === keys[0] ? keys[1] : keys[0]);
      const ok = await hold(key, `__s3.puzzles.beam.mirrors.${k}.part.angles[${axis}] !== ${cur}`, 60000);
      if (!ok) { log.push(['stuck', k, axis, cur]); return false; }
    }
    return false;
  }
  async function pressE(cond, holdMs = 250, ms = 120000) { const f0 = await ft(); await page.keyDown('KeyE'); await sleep(holdMs); await page.keyUp('KeyE'); const ok = await page.waitFor(cond, ms, 100); const used = await ev(`__ev.filter(x => x.n === 'interact:used' && x.ft >= ${f0}).map(x => [x.e.id, +((x.ft - ${f0}) / 60).toFixed(2)])`); return { ok, used }; }
  return { ...o, ft, waitSec, evs, loc, tpL, aimL, hold, prompt, angs, turnTo, pressE, L };
}
