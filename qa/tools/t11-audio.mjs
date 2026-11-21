import { QA_DIR } from './paths.mjs';
// batch11：032 音频（art=1）——登记 / 加载 / 404 / 别名变体增益 / 环境循环 / 脚步 / UI / 风吹钟 6–14 s / Esc 暂停
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
import { readFileSync } from 'node:fs';
const T = 'b11-audio';
const man = [...readFileSync((QA_DIR + '/snap-cd22761/game/src/assets/manifest.ts'), 'utf8').matchAll(/\{ key: '([^']+)', type: 'audio', url: '([^']+)', group: '([^']+)'([^}]*)\}/g)].map(m => ({ key: m[1], url: m[2], group: m[3], gainDb: +(m[4].match(/gainDb: (-?[\d.]+)/)?.[1] ?? 0) }));
const { page, ev, must, url, rec, step, done } = await open(5520);
const net = [], warns = [];
await page.send('Network.enable', {});
page.onEvent((m) => {
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) net.push({ st: m.params.response.status, url: m.params.response.url });
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) net.push({ failed: m.params.errorText, id: m.params.requestId });
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'warning' || m.params.type === 'error')) warns.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
await page.addInit(EVLOG);
const HOOK = `(() => { if (window.__hk) return 1; window.__hk = 1; const A = __game.audio, as = __game.assets.audio; const key = (b) => { for (const [k, v] of as) if (v === b) return k; return '?'; };
  window.__pb = []; window.__lp = []; const tk = () => __game.time.fixedTick;
  const pb = A.playBuffer.bind(A); A.playBuffer = (b, vol = 1, r) => { window.__pb.push({ k: key(b), vol: +vol.toFixed(4), ft: tk() }); return pb(b, vol, r); };
  const bp = A.beep.bind(A); A.beep = (...a) => { window.__pb.push({ beep: a[0], ft: tk() }); return bp(...a); };
  const sl = A.startLoop.bind(A); A.startLoop = (n, o = {}) => { const r = sl(n, o); window.__lp.push({ on: n, buf: o.buffer ? key(o.buffer) : null, fadeIn: o.fadeIn ?? null, ok: r, ft: tk() }); return r; };
  const so = A.stopLoop.bind(A); A.stopLoop = (n, o = {}) => { const r = so(n, o); window.__lp.push({ off: n, fadeOut: o.fadeOut ?? null, ok: r, ft: tk() }); return r; };
  return 1; })()`;
const keysLoaded = () => ev(`[...__game.assets.audio.keys()]`);
const seen = new Set();
await step(T, '主菜单 + UI 音', async () => {
  await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
  await page.goto(url('?smoke=1&debug=1'));
  await must(`!!window.__game && !!document.querySelector('[data-act="settings"]') && __game.assets.isGroupLoaded?.('menu') !== false`, 300000, 'menu');
  await sleep(3000);
  await ev(HOOK);
  const r = await ev(`(() => { const b = document.querySelector('[data-act="settings"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await page.click(r.x, r.y, 'left'); await sleep(800);
  const back = await ev(`(() => { const b = [...document.querySelectorAll('button[data-act="back"], button[data-act="cancel"]')].find(e => e.getClientRects().length && !e.closest('[hidden]')); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (back) { await page.click(back.x, back.y, 'left'); await sleep(800); }
  const pb = await ev('window.__pb');
  (await keysLoaded()).forEach(k => seen.add(k));
  rec(T, '主菜单：设置按钮 → sfx-ui-confirm、返回 → sfx-ui-back（用文件 buffer、带 gainDb 增益）', pb.some(p => p.k === 'sfx-ui-confirm' && Math.abs(p.vol - 10 ** (1.2 / 20)) < 1e-3) && (back ? pb.some(p => p.k === 'sfx-ui-back') : false) && !pb.some(p => p.beep) ? 'PASS' : 'FAIL', { pb, backBtn: !!back, ctx: await ev('__game.audio.context?.state') });
});
const scene = async (sc) => {
  await page.goto(url(`?smoke=1&debug=1&scene=${sc}&art=1`));
  await must(`!!window.__${sc}?.puzzles && __game.input.context === 'explore' && !__${sc}.rig.controller.busy`, 400000, sc);
  await page.click(640, 360, 'left'); await sleep(500);
  await ev(HOOK); await ev(counter(`__${sc}`));
};
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 1200000, 'ticks ' + k); };
await step(T, 'S1 环境 / 脚步 / 风吹钟 / Esc / 日志', async () => {
  await scene('s1'); await waitN(60);
  const amb = await ev(`({ loops: __game.audio.loopNames, lp: window.__lp, ctx: __game.audio.context?.state })`);
  const want = ['amb-waves-near', 'amb-rain-light', 'amb-wind-soft'];
  rec(T, 'S1 进场环境循环 amb-waves-near / rain-light / wind-soft 起播且用文件 buffer', want.every(w => amb.loops.includes(w) && amb.lp.some(l => l.on === w && l.buf === w && l.ok)) ? 'PASS' : 'FAIL', amb);
  // 脚步：真按 W 走 3 s
  const f0 = await ev('__game.time.fixedTick');
  await page.keyDown('KeyW'); await sleep(3000); await page.keyUp('KeyW'); await waitN(30);
  const st = await ev(`window.__pb.filter(p => p.ft >= ${f0} && /step/.test(p.k ?? ''))`);
  const steps = await ev(`__ev.filter(e => e.n === 'sfx:play' && /sfx-step/.test(e.e?.id) && e.ft >= ${f0}).map(e => e.e.id)`);
  const ks = st.map(s => s.k); const rep = ks.filter((k, i) => i && k === ks[i - 1]).length;
  rec(T, 'S1 真按 W 走：脚步 sfx-step-<地面> 按距离出声、a–d 变体随机且不连续重复', st.length >= 3 && rep === 0 && new Set(ks).size >= 2 && steps.length === st.length ? 'PASS' : 'FAIL', { events: steps.length, played: ks, consecutiveRepeat: rep });
  // Esc 暂停：AudioContext 挂起、循环保留；再 Esc 恢复
  const lp0 = await ev('__game.audio.loopNames');
  await page.keyDown('Escape'); await sleep(250); await page.keyUp('Escape'); await page.waitFor('__game.paused === true', 30000, 100); await sleep(800);
  const p1 = await ev(`({ ctx: __game.audio.context?.state, loops: __game.audio.loopNames, paused: __game.paused ?? null, uiBack: window.__pb.filter(p => p.k === 'sfx-ui-back').length })`);
  await page.keyDown('Escape'); await sleep(250); await page.keyUp('Escape'); const escResumed = await page.waitFor('__game.paused === false', 30000, 100); if (!escResumed) { const b = await ev(`(() => { const e = document.querySelector('.pause-menu [data-act="resume"]'); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`); if (b) await page.click(b.x, b.y, 'left'); await page.waitFor('__game.paused === false', 30000, 100); } await sleep(800);
  const p2 = await ev(`({ ctx: __game.audio.context?.state, loops: __game.audio.loopNames, paused: __game.paused ?? null })`);
  rec(T, 'Esc 暂停 → AudioContext suspended、循环不丢；再 Esc → running', p1.ctx === 'suspended' && p2.ctx === 'running' && JSON.stringify(p1.loops) === JSON.stringify(lp0) && JSON.stringify(p2.loops) === JSON.stringify(lp0) ? 'PASS' : 'FAIL', { before: lp0, p1, p2, escResumed });
  // 日志 J
  const f1 = await ev('__game.time.fixedTick'); const n1 = await ev('window.__pb.length');
  await page.click(640, 360, 'left'); await sleep(300);
  await page.tap('KeyJ'); await sleep(1500);
  const j = await ev(`window.__pb.slice(${n1})`);
  await page.tap('Escape'); await sleep(1200);
  const j2 = await ev(`window.__pb.slice(${n1})`);
  rec(T, 'J 打开日志 → sfx-ui-journal；Esc 关闭 → sfx-ui-back', j.some(p => p.k === 'sfx-ui-journal') && j2.some(p => p.k === 'sfx-ui-back') ? 'PASS' : 'FAIL', { pb: j2, ctx: await ev('__game.input.context') });
  if (await ev(`__game.input.context !== 'explore'`)) { await page.tap('Escape'); await sleep(1200); }
  // 风吹钟：站到钟 6 m 内，计 60 s 游戏时间
  await ev(`(() => { const s = __s1, b = s.puzzles.bell.interactable, r = b.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(r.position.clone().setY(r.position.y + 0.03)); s.rig.body.velocity.set(0,0,0); return 1; })()`);
  const g0 = await ev('__game.time.fixedTick');
  await waitN(60 * 62);
  const bw = await ev(`__ev.filter(e => e.n === 'sfx:play' && e.e?.id === 'sfx-bell-wind' && e.ft >= ${g0}).map(e => e.ft)`);
  const bwk = await ev(`window.__pb.filter(p => p.ft >= ${g0} && /bell-wind/.test(p.k ?? '')).map(p => p.k)`);
  const iv = bw.slice(1).map((t, i) => +((t - bw[i]) / 60).toFixed(2));
  rec(T, 'S1 钟 12 m 内：风吹轻响间隔 6–14 s 随机（游戏时间），变体 wind-a~c 不连续重复', iv.length >= 2 && iv.every(x => x >= 6 - 0.02 && x <= 14 + 0.02) && new Set(iv).size > 1 && bwk.length === bw.length && bwk.every((k, i) => !i || k !== bwk[i - 1]) ? 'PASS' : 'FAIL', { firstAfterSec: bw.length ? +((bw[0] - g0) / 60).toFixed(2) : null, intervalsSec: iv, variants: bwk });
  (await keysLoaded()).forEach(k => seen.add(k));
});
await step(T, 'S2 环境 / 光感锁连通音', async () => {
  await scene('s2'); await waitN(60);
  const a = await ev(`({ loops: __game.audio.loopNames })`);
  rec(T, 'S2 室外环境循环（rain-light / eaves-drip / waves-far / wind-soft）', ['amb-rain-light', 'amb-eaves-drip', 'amb-waves-far', 'amb-wind-soft'].every(w => a.loops.includes(w)) ? 'PASS' : 'FAIL', a);
  (await keysLoaded()).forEach(k => seen.add(k));
});
await step(T, 'S3 环境', async () => {
  await scene('s3'); await waitN(60);
  const a = await ev(`({ loops: __game.audio.loopNames })`);
  rec(T, 'S3 室外环境循环（waves-crash / rain-heavy / wind-soft），S2 的循环已停', ['amb-waves-crash', 'amb-rain-heavy', 'amb-wind-soft'].every(w => a.loops.includes(w)) && !a.loops.includes('amb-eaves-drip') ? 'PASS' : 'FAIL', a);
  (await keysLoaded()).forEach(k => seen.add(k));
});
await step(T, '全部登记音频加载 / 解码', async () => {
  const notLoaded = man.filter(m => !seen.has(m.key)).map(m => m.key);
  const dec = await ev(`(async () => { const ctx = new OfflineAudioContext(2, 44100, 44100); const out = []; for (const u of ${JSON.stringify(man.map(m => m.url))}) { try { const r = await fetch(u); if (!r.ok) { out.push([u, 'HTTP ' + r.status]); continue; } const b = await ctx.decodeAudioData(await r.arrayBuffer()); if (!(b.duration > 0)) out.push([u, 'dur0']); } catch (e) { out.push([u, String(e)]); } } return out; })()`);
  const loopKeys = man.filter(m => /loop|^amb-(?!foghorn|pier|seabird)/.test(m.key)).map(m => m.key);
  rec(T, `manifest 音频 ${man.length} 条（期望 79）：逐条 fetch + decodeAudioData 成功，进 menu / S1 / S2 / S3 后全部进 AssetLoader`, man.length === 79 && !dec.length && !notLoaded.length ? 'PASS' : 'FAIL', { n: man.length, byGroup: man.reduce((a, m) => (a[m.group] = (a[m.group] ?? 0) + 1, a), {}), decodeFail: dec, notLoaded });
  const miss = await ev(`[...__game.assets.missing].filter(k => /^(sfx|amb)-/.test(k))`);
  rec(T, '无缺文件 / 404 / 加载失败；控制台无音频相关报错', !net.length && !miss.length && !warns.some(w => /audio|\.ogg|sfx-|amb-/.test(w)) && !page.errors.length ? 'PASS' : 'FAIL', { net, missingAudio: miss, warns: warns.slice(0, 20), errors: page.errors });
});
await done(); console.log('DONE');
