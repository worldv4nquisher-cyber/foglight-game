// batch27 ④ 抽查：清存档、测试构建 autostart 进 S1；检测进行中每 4 s 进 / 退全屏一次（CDP userGesture），每 0.5 s 采样 像素比 / 档位 / 检测状态 / 全屏；
// 判据：像素比只在档位 = standard（renderScale 0.8）时变 0.8，全屏切换本身不改像素比。之后固定 ultra（user）再进退全屏 3 次，像素比恒 1。
process.env.SMOKE_DIST ||= '/tmp/foglight-smoke-dist-b27qa';
import { open, sleep, SH13 as SH } from './b27lib.mjs';
import { writeFileSync } from 'node:fs';
const D = `${SH}/hooks`; const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = { samples: [] }; const save = () => writeFileSync(`${D}/t27-fsdpr.json`, JSON.stringify(out, null, 1));
const { page, ev, url, done } = await open(5784, { width: 1280, height: 720 });
const gest = (e) => page.send('Runtime.evaluate', { expression: e, userGesture: true, awaitPromise: true, returnByValue: true });
const S = `({ t: +(performance.now() / 1000).toFixed(1), pr: __game.renderer.getPixelRatio(), dpr: devicePixelRatio, tier: __game.quality.tier, bench: __game.benchmark?.state, fs: !!document.fullscreenElement, paused: __game.isPaused, cw: __game.renderer.domElement.width })`;
try {
  await page.goto(url('?smoke=1&art=0')); await page.waitFor(`!!window.__game`, 300000, 300); await ev(`localStorage.clear(), 1`);
  await page.goto(url('?smoke=1&art=0&autostart=1')); await page.waitFor(`!!window.__game && __game.input.context === 'explore'`, 300000, 300);
  const t0 = Date.now(); let k = 0;
  while (Date.now() - t0 < 50000) {
    const s = await ev(S); s.phase = 'B'; out.samples.push(s);
    if (Date.now() - t0 > (k + 1) * 4000) { k++; if (k % 2) await gest(`document.documentElement.requestFullscreen().then(() => 1, (e) => String(e))`); else { await gest(`document.exitFullscreen().then(() => 1, () => 0)`); await sleep(300); if (await ev(`__game.isPaused`)) await ev(`__game.resume(), 1`); } }
    await sleep(500);
  }
  if (await ev(`!!document.fullscreenElement`)) await gest(`document.exitFullscreen()`); await sleep(500); if (await ev(`__game.isPaused`)) await ev(`__game.resume(), 1`);
  await ev(`__game.settings.update({ quality: 'ultra' }), 1`); await sleep(3000);
  for (let i = 0; i < 3; i++) {
    await gest(`document.documentElement.requestFullscreen().then(() => 1, (e) => String(e))`); await sleep(1500); const a = await ev(S); a.phase = 'C-in'; out.samples.push(a);
    await gest(`document.exitFullscreen()`); await sleep(1500); const b = await ev(S); b.phase = 'C-out'; out.samples.push(b); if (b.paused) await ev(`__game.resume(), 1`); await sleep(800);
  }
  const B = out.samples.filter((s) => s.phase === 'B'); const C = out.samples.filter((s) => s.phase.startsWith('C'));
  out.check = { fsSamplesB: B.filter((s) => s.fs).length, prNot1WhileNotStandard: B.filter((s) => s.pr !== 1 && s.tier !== 'standard').length, standardWithPr1: B.filter((s) => s.tier === 'standard' && s.pr === 1).length,
    firstStandard: B.find((s) => s.tier === 'standard') ?? null, firstPr08: B.find((s) => s.pr < 1) ?? null, C_prAll1: C.every((s) => s.pr === 1 && s.tier === 'ultra'), C_fsIn: C.filter((s) => s.fs).length };
  out.errors = page.errors.slice(0, 10); save(); log(JSON.stringify(out.check)); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); save(); log('FAIL', out.fail); }
await done(); process.exit(0);
