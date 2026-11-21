// batch25 ①：生产 dist（vite preview）+ ?smoke=1 无钩子；?debug=1&scene= 仍可直进（记录）；npm run preview:smoke 有钩子、退出删临时构建
import { open, sleep, SH13 as SH } from './b25lib.mjs';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const D = `${SH}/hooks`; mkdirSync(D, { recursive: true });
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = {}; const save = () => writeFileSync(`${D}/t25-hooks.json`, JSON.stringify(out, null, 1));
// 注意：qa-tools/common.mjs 自己注入 window.__qa（sleep/until/el…），所以看 __qa.puzzles 而不是 typeof __qa
const pres = `(() => { const vis = (s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; };
  return { game: typeof window.__game, qaPuzzles: typeof window.__qa?.puzzles, qaKeys: window.__qa ? Object.keys(window.__qa).join(',') : null, perfSpot: typeof window.__perfSpot,
    s1: typeof window.__s1, s2: typeof window.__s2, s3: typeof window.__s3, testbed: typeof window.__testbed,
    menu: vis('.main-menu'), menuNew: vis('.main-menu [data-act="new"]'), loading: vis('.loading-screen') || vis('.loading'), hud: vis('.hud'), fatal: (document.body.innerText.match(/无法启动游戏/) || [null])[0],
    canvas: !!document.querySelector('canvas'), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160) }; })()`;
const { page, ev, must, url, done } = await open(5770, { width: 1280, height: 720 });
let smokeProc = null;
try {
  for (const q of ['', '?smoke=1', '?smoke=1&autostart=1', '?smoke=1&debug=1&scene=s2&art=0&autostart=1', '?debug=1&scene=s2&art=0&autostart=1', '?debug=1&scene=s3&art=0']) {
    await ev(`localStorage.clear(), 1`).catch(() => 0);
    await page.goto(url(q)); await sleep(1500);
    await must(`document.readyState === 'complete'`, 120000);
    await page.waitFor(`!!document.querySelector('canvas')`, 120000, 300);
    await sleep(20000);
    const r = await ev(pres); r.q = q; (out.prod ??= []).push(r); log('prod', q, JSON.stringify(r));
    await page.screenshot(`${D}/prod-${(q || 'plain').replace(/[^a-z0-9]+/gi, '_')}.png`).catch((e) => log('shot', e.message));
  }
  // preview:smoke
  const G = process.env.QA_GAME;
  const before = readdirSync('/tmp').filter((n) => n.startsWith('foglight-smoke-dist-'));
  smokeProc = spawn('npm', ['run', 'preview:smoke'], { cwd: G, env: { ...process.env, PORT: '5772' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let sout = ''; smokeProc.stdout.on('data', (d) => (sout += d)); smokeProc.stderr.on('data', (d) => (sout += d));
  for (let k = 0; k < 120 && !/测试构建已起/.test(sout); k++) await sleep(1000);
  out.smokeServer = sout.trim().split('\n').slice(-3); log('preview:smoke', out.smokeServer.join(' | '));
  const mine = readdirSync('/tmp').filter((n) => n.startsWith('foglight-smoke-dist-') && !before.includes(n));
  out.smokeDir = mine;
  for (const q of ['?smoke=1', '?smoke=1&debug=1&scene=s1&art=0&autostart=1']) {
    await ev(`localStorage.clear(), 1`).catch(() => 0);
    await page.goto(`http://127.0.0.1:5772/${q}`);
    await must(`typeof window.__qa?.puzzles === 'function' && !!window.__game`, 300000, 'smoke hooks ' + q);
    if (q.includes('scene=s1')) await must(`!!window.__s1 && __game.input.context === 'explore'`, 600000, 's1 explore');
    else await must(`!!document.querySelector('.main-menu')`, 120000);
    await sleep(1500);
    const r = await ev(pres); r.q = q; r.qaScene = await ev(`JSON.stringify(__qa.scene())`); r.puzzles = await ev(`JSON.stringify(__qa.puzzles()).slice(0, 300)`); r.perfSpotFn = await ev(`typeof __perfSpot`);
    (out.smoke ??= []).push(r); log('smoke', q, JSON.stringify(r));
  }
  // Ctrl+C 退出 → 临时构建应删除
  process.kill(-smokeProc.pid, 'SIGINT');
  await new Promise((r) => { smokeProc.on('exit', r); setTimeout(r, 15000); });
  await sleep(1500);
  out.smokeDirAfterSigint = mine.map((n) => ({ n, exists: existsSync('/tmp/' + n) }));
  log('after SIGINT', JSON.stringify(out.smokeDirAfterSigint));
  smokeProc = null;
  out.errors = page.errors.slice(0, 10);
  save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
if (smokeProc) { try { process.kill(-smokeProc.pid, 'SIGINT'); } catch {} await sleep(3000); }
await done(); process.exit(0);
