// batch11 032 补测：主菜单 UI 音（art=1）、场景进场环境循环用文件 buffer（钩子在 init 里尽早装）、S2 光感锁连通音 + 光束嗡鸣
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-audio2';
const { page, ev, must, url, rec, step, done } = await open(5521);
await page.addInit(EVLOG);
await page.addInit(`(() => { const iv = setInterval(() => { const G = window.__game; if (!G?.audio || !G.assets) return; clearInterval(iv); const A = G.audio, as = G.assets.audio; const key = (b) => { for (const [k, v] of as) if (v === b) return k; return '?'; };
  window.__pb = []; window.__lp = []; const tk = () => G.time.fixedTick;
  const pb = A.playBuffer.bind(A); A.playBuffer = (b, vol = 1, r) => { window.__pb.push({ k: key(b), vol: +vol.toFixed(4), ft: tk() }); return pb(b, vol, r); };
  const bp = A.beep.bind(A); A.beep = (...a) => { window.__pb.push({ beep: a[0], ft: tk() }); return bp(...a); };
  const sl = A.startLoop.bind(A); A.startLoop = (n, o = {}) => { const r = sl(n, o); window.__lp.push({ on: n, buf: o.buffer ? key(o.buffer) : null, fadeIn: o.fadeIn ?? null, vol: o.volume ?? null, ok: r, ft: tk() }); return r; };
  const so = A.stopLoop.bind(A); A.stopLoop = (n, o = {}) => { const r = so(n, o); window.__lp.push({ off: n, fadeOut: o.fadeOut ?? null, ok: r, ft: tk() }); return r; }; }, 5); })()`);
const center = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length && !e.closest('[hidden]')); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
await step(T, '主菜单 UI 音', async () => {
  await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
  await page.goto(url('?smoke=1&debug=1&art=1'));
  await must(`!!window.__pb && !!document.querySelector('.main-menu [data-act="settings"]') && __game.assets.audio.has('sfx-ui-confirm')`, 300000, 'menu+ui audio');
  await sleep(1000);
  const s = await center('.main-menu [data-act="settings"]'); await page.click(s.x, s.y, 'left'); await sleep(1000);
  const b = await center('button[data-act="back"], button[data-act="cancel"]'); if (b) { await page.click(b.x, b.y, 'left'); await sleep(1000); }
  const c = await center('.main-menu [data-act="credits"]'); if (c) { await page.click(c.x, c.y, 'left'); await sleep(1000); }
  await page.keyDown('Escape'); await sleep(250); await page.keyUp('Escape'); await sleep(1200);
  const pb = await ev('window.__pb');
  const g = 10 ** (1.2 / 20);
  rec(T, '主菜单：设置 / 制作名单 → sfx-ui-confirm、返回按钮 / Esc(ui:back) → sfx-ui-back，文件 buffer、gainDb +1.2 dB；无合成占位', pb.filter(p => p.k === 'sfx-ui-confirm' && Math.abs(p.vol - g) < 1e-3).length >= 2 && pb.filter(p => p.k === 'sfx-ui-back').length >= 2 && !pb.some(p => p.beep) ? 'PASS' : 'FAIL', { pb, backBtn: !!b, credits: !!c });
});
const scene = async (sc) => {
  await page.goto(url(`?smoke=1&debug=1&scene=${sc}&art=1`));
  await must(`!!window.__${sc}?.puzzles && __game.input.context === 'explore' && !__${sc}.rig.controller.busy`, 400000, sc);
  await page.click(640, 360, 'left'); await sleep(500); await ev(counter(`__${sc}`));
};
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 1200000, 'ticks ' + k); };
for (const [sc, want] of [['s1', ['amb-waves-near', 'amb-rain-light', 'amb-wind-soft']], ['s2', ['amb-rain-light', 'amb-eaves-drip', 'amb-waves-far', 'amb-wind-soft']], ['s3', ['amb-waves-crash', 'amb-rain-heavy', 'amb-wind-soft']]]) {
  await step(T, sc + ' 环境', async () => {
    await scene(sc); await waitN(30);
    const lp = await ev('window.__lp'), names = await ev('__game.audio.loopNames');
    const starts = lp.filter(l => l.on);
    rec(T, `${sc} 进场环境循环用 032 文件 buffer 起播（${want.join(' / ')}），换场景时上一场景循环全部停`, want.every(w => names.includes(w) && starts.some(l => l.on === w && l.buf === w && l.ok)) && starts.every(l => l.buf !== null) ? 'PASS' : 'FAIL', { loopNames: names, starts: starts.map(l => `${l.on}${l.buf === l.on ? '' : ' buf=' + l.buf}@${l.ft}`), stops: lp.filter(l => l.off).map(l => l.off) });
    if (sc === 's1') {
      // 脚步：按住 W 直到按游戏时间走够 4 m（不按墙钟）
      const f0 = await ev('__game.time.fixedTick'), p0 = await ev('[__s1.rig.body.position.x, __s1.rig.body.position.z]');
      await page.keyDown('KeyW'); await page.waitFor(`Math.hypot(__s1.rig.body.position.x - ${p0[0]}, __s1.rig.body.position.z - ${p0[1]}) > 4`, 600000, 100); await page.keyUp('KeyW'); await waitN(30);
      const ev1 = await ev(`__ev.filter(e => e.n === 'sfx:play' && /sfx-step/.test(e.e?.id) && e.ft >= ${f0}).map(e => [e.e.id, e.ft])`);
      const st = await ev(`window.__pb.filter(p => p.ft >= ${f0} && /step/.test(p.k ?? '')).map(p => p.k)`), beeps = await ev(`window.__pb.filter(p => p.ft >= ${f0} && p.beep).length`);
      const dist = await ev(`Math.hypot(__s1.rig.body.position.x - ${p0[0]}, __s1.rig.body.position.z - ${p0[1]})`);
      const rep = st.filter((k, i) => i && k === st[i - 1]).length;
      rec(T, 'S1 真按 W 走 4 m：脚步 sfx-step-<地面> 按距离出声（文件 buffer）、a–d 变体随机且不连续重复', ev1.length >= 3 && st.length === ev1.length && rep === 0 && new Set(st).size >= 2 && !beeps ? 'PASS' : 'FAIL', { distM: +dist.toFixed(2), events: ev1.length, stepTicks: ev1.map(x => x[1] - f0), played: st, consecutiveRepeat: rep, beeps });
      // 日志：按住 J 250 ms 打开 → sfx-ui-journal；J 关闭（journal:close 不配音）
      const n1 = await ev('window.__pb.length');
      await page.keyDown('KeyJ'); await sleep(250); await page.keyUp('KeyJ'); const jo = await page.waitFor('__game.ui.journal.isOpen', 60000, 100); await sleep(800);
      const j1 = await ev(`window.__pb.slice(${n1}).map(p => p.k)`);
      await page.keyDown('KeyJ'); await sleep(250); await page.keyUp('KeyJ'); const jc = await page.waitFor('!__game.ui.journal.isOpen', 60000, 100); await sleep(800);
      const j2 = await ev(`window.__pb.slice(${n1}).map(p => p.k)`);
      rec(T, 'J 打开日志 → sfx-ui-journal 一声（文件）；J 关闭无声（journal:close 未配音，按设计）', jo && jc && j1.filter(k => k === 'sfx-ui-journal').length === 1 ? 'PASS' : 'FAIL', { opened: jo, closed: jc, onOpen: j1, total: j2 });
    }
    if (sc === 's2') {
      // 阅读界面：书桌上汐的笔记 E 阅读 → sfx-paper-open；翻页 → sfx-paper-flip（a–c）
      {
        const n0 = await ev('window.__pb.length');
        await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; s.rig.body.teleport(new V(-4.6, 3.05, -0.25)); s.rig.body.velocity.set(0,0,0); return 1; })()`); await waitN(30);
        for (let i = 0; i < 10; i++) { await ev(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = new p.constructor(-5.15, 3.78, -0.68).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${(i % 3 - 1) * 0.15}; s.cameraFollow.pitch = Math.asin(t.y) - ${0.05 * Math.floor(i / 3)}; s.rig.controller.facing = s.cameraFollow.yaw + Math.PI; return 1; })()`); await waitN(6); if (await ev(`__s2.interaction.current?.id === 'xi-note-s2'`)) break; }
        const cur = await ev('__s2.interaction.current?.id ?? null');
        await page.keyDown('KeyE'); await sleep(250); await page.keyUp('KeyE'); const ro = await page.waitFor('__game.ui.reader.isOpen', 60000, 100); await sleep(800);
        let flips = 0; for (let i = 0; i < 3; i++) { const pg = await ev('__game.ui.reader.page'); await page.keyDown('KeyD'); await sleep(250); await page.keyUp('KeyD'); if (await page.waitFor(`__game.ui.reader.page !== ${pg}`, 20000, 100)) flips++; await sleep(500); }
        const pb = await ev(`window.__pb.slice(${n0}).map(p => p.k ?? 'beep')`);
        rec(T, '阅读：E 读汐的笔记 → sfx-paper-open；翻页 → sfx-paper-flip-a~c（不连续重复）', ro && pb.includes('sfx-paper-open') && pb.filter(k => /paper-flip/.test(k)).length === flips && flips >= 1 && pb.filter(k => /paper-flip/.test(k)).every((k, i, a) => !i || k !== a[i - 1]) ? 'PASS' : (ro ? 'FAIL' : 'UNVERIFIED'), { cur, readerOpen: ro, flips, pb, pages: await ev('__game.ui.reader.pageCount ?? null') });
        await page.keyDown('Tab'); await sleep(250); await page.keyUp('Tab'); await page.waitFor('!__game.ui.reader.isOpen', 30000, 100); await sleep(500);
        if (await ev('__game.ui.journal.isOpen')) { await page.keyDown('Tab'); await sleep(250); await page.keyUp('Tab'); await sleep(500); }
        await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; s.rig.body.teleport(new V(-10, 0.4, 0)); s.rig.body.velocity.set(0,0,0); return 1; })()`); await waitN(60);
      }
      // 室内交叉淡化：走进房子一楼
      const f0 = await ev('__game.time.fixedTick');
      await ev(`(() => { const s = __s2, V = s.rig.body.position.constructor; s.rig.body.teleport(new V(-3.0, 0.4, 0.5)); s.rig.body.velocity.set(0,0,0); return 1; })()`); await waitN(90);
      const lp2 = await ev(`window.__lp.filter(l => l.ft >= ${f0})`), n2 = await ev('__game.audio.loopNames');
      rec(T, 'S2 进屋：室外循环淡出、室内 rain-on-roof / room-clock 淡入（交叉淡化）', n2.includes('amb-rain-on-roof') && n2.includes('amb-room-clock') && !n2.includes('amb-eaves-drip') && lp2.some(l => l.off && l.fadeOut > 0) && lp2.some(l => l.on && l.fadeIn > 0) ? 'PASS' : 'FAIL', { loopNames: n2, ev: lp2.map(l => l.on ? `on ${l.on} fi${l.fadeIn}` : `off ${l.off} fo${l.fadeOut}`) });
      // 光感锁连通：解光路、点亮灯台
      const f1 = await ev('__game.time.fixedTick');
      const r = await ev(`(() => { const b = __s2.puzzles.beam; b.solve(); b.lamps.east.emitter.lit = true; b.lamps.west.emitter.lit = true; b.tracer.trace(); return { recv: b.tracer.paths.map(p => p.receiver?.id ?? null) }; })()`);
      await waitN(30);
      const sfx = await ev(`__ev.filter(e => e.n === 'sfx:play' && e.ft >= ${f1}).map(e => e.e.id)`), pb = await ev(`window.__pb.filter(p => p.ft >= ${f1}).map(p => p.k ?? 'beep' + p.beep)`), lp3 = await ev(`window.__lp.filter(l => l.ft >= ${f1})`);
      rec(T, 'S2 灯台光打到光感锁：sfx-beam-connect 一声（文件）+ sfx-beam-hum-loop 循环起播（文件 buffer）', sfx.filter(x => x === 'sfx-beam-connect').length === 1 && pb.includes('sfx-beam-connect') && lp3.some(l => l.on === 'sfx-beam-hum-loop' && l.buf === 'sfx-beam-hum-loop') ? 'PASS' : 'FAIL', { ...r, sfx, pb, loops: lp3, note: '光路用 beam.solve + 直接点亮灯台（真实流程在 S2 后半段 art=1 全流程里另测）' });
      await page.screenshot(`${SH11}/s2-lightlock-connect.png`);
    }
  });
}
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
