// batch16 ⑨ 自测：S3 沿螺旋楼梯逐级传送（每级等 2 帧），每级读上层目标/实际增益、两层 start/offset、musicLog play 次数
import { open, sleep, SH16 } from './b16lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH16}/music`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5610, { width: 480, height: 270 });
const out = {};
try {
  await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=low`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(240, 135); await sleep(500); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  out.ctx = await ev(`__game.audio.context?.state`); console.log('loaded ctx', out.ctx, await ev(`JSON.stringify({ k: __game.audio.musicKey, n: __game.audio.musicLayers.length, ic: __game.input.context, busy: __s3.rig.controller.busy, log: __game.audio.musicLog.length })`));
  await must(`__game.audio.musicLayers.length > 0`, 240000, 'layers'); console.log('layers ok');
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore'); console.log('explore ok');
  await ev(`(__s3.puzzles.tide.set('low', { instant: true }), 1)`);
  out.sync = await ev(`(() => { const a = __game.audio; return { key: a.musicKey, startAt: a.musicStartAt, layers: a.musicLayers, log: a.musicLog.map((e) => ({ op: e.op, key: e.key, at: e.at, offset: e.offset, layers: e.layers, loop: e.loop })) }; })()`);
  console.log('sync', JSON.stringify(out.sync).slice(0, 900));
  await ev(`(() => { const s = __s3, V = s.rig.body.position.constructor, DEG = Math.PI / 180; const first = 152, land = { 11: 26, 24: 28, 49: 36, 79: 36 };
    window.__treadMid = (k) => { let a = first; for (let i = 1; i < k; i++) a += land[i] ?? 6; return (a + (land[k] ?? 6) / 2) * DEG; };
    window.__tpL = (x, y, z) => { s.interaction.cancel?.(); s.frame.updateMatrixWorld(true); s.rig.body.teleport(s.frame.localToWorld(new V(x, y + 0.05, z))); };
    window.__rd = () => { const a = __game.audio, l = a.musicLayers[0], w = s.rig.body.position; const loc = s.frame.worldToLocal(w.clone()); return { y: +loc.y.toFixed(3), r: +Math.hypot(loc.x, loc.z).toFixed(2), target: +l.target.toFixed(4), gain: +l.gain.toFixed(4), when: l.when, off: l.offset, startAt: a.musicStartAt, plays: a.musicLog.filter((e) => e.op === 'play' || e.op === 'layer').length, t: a.context.currentTime }; };
    window.__raf = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r(1) : requestAnimationFrame(f)); requestAnimationFrame(f); });
    return 1; })()`);
  const rows = [];
  await ev(`(__tpL(-2.12, 0.2, 1.325), 1)`); await ev(`__raf(4)`); rows.push({ k: 0, ...(await ev(`__rd()`)) });
  for (let k = 1; k <= 108; k++) { await ev(`(() => { const a = __treadMid(${k}); __tpL(2.5 * Math.cos(a), 0.2 + 0.2 * ${k}, 2.5 * Math.sin(a)); return 1; })()`); await ev(`__raf(2)`); rows.push({ k, ...(await ev(`__rd()`)) }); }
  await ev(`(__tpL(-2.462, 22, -0.434), 1)`); await ev(`__raf(4)`); await sleep(1500); rows.push({ k: 'lamp', ...(await ev(`__rd()`)) });
  out.rows = rows;
  const r0 = rows[0]; let maxDT = 0, maxLag = 0, maxDY = 0;
  for (let i = 1; i < rows.length; i++) { maxDT = Math.max(maxDT, Math.abs(rows[i].target - rows[i - 1].target)); maxDY = Math.max(maxDY, Math.abs(rows[i].y - rows[i - 1].y)); maxLag = Math.max(maxLag, Math.abs(rows[i].gain - rows[i].target)); }
  const bad = rows.filter((r) => Math.abs(r.target - Math.min(1, Math.max(0, (r.y - 0.2) / 21.8))) > 0.01);
  const pick = (k) => rows.find((r) => r.k === k);
  out.summary = { ctx: out.ctx, bottom: pick(0), A: pick(49), B: pick(79), lamp: pick('lamp'), maxStepTarget: +maxDT.toFixed(4), maxStepY: +maxDY.toFixed(3), maxGainLag: +maxLag.toFixed(4), targetMismatch: bad.length,
    restarted: rows.some((r) => r.plays !== r0.plays || r.startAt !== r0.startAt || r.when !== r0.when || r.off !== r0.off), audioSec: +(rows.at(-1).t - r0.t).toFixed(1) };
  console.log('summary', JSON.stringify(out.summary));
  out.errors = page.errors.slice(0, 6).map((e) => String(e).slice(0, 200));
} finally { writeFileSync(`${D}/t16-climb.json`, JSON.stringify(out, null, 1)); await done(); console.log('DONE'); }
