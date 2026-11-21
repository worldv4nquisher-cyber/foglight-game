// batch26 §5b：a9865b0 生产 preview ?autostart=1 应停主菜单；preview:smoke ?autostart=1 仍直进
import { open, sleep, SH13 as SH } from './b26alib.mjs';
import { writeFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const D = `${SH}/hooks`; const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = { game: process.env.QA_GAME }; const save = () => writeFileSync(`${D}/t26-auto.json`, JSON.stringify(out, null, 1));
const pres = `(() => { const vis = (s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; };
  return { game: typeof window.__game, menu: vis('.main-menu'), hud: vis('.hud'), art: performance.getEntriesByType('resource').filter((r) => /\\/assets\\/art\\//.test(r.name)).length, text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 100) }; })()`;
const { page, ev, must, url, done } = await open(5774, { width: 1280, height: 720 });
let sp = null;
try {
  for (const q of ['?autostart=1', '?autostart', '?autostart=1&smoke=1', '?autostart=1&debug=1&scene=s1']) {
    await ev(`localStorage.clear(), 1`).catch(() => 0); await page.goto(url(q)); await sleep(1500);
    await must(`document.readyState === 'complete'`, 120000);
    await page.waitFor(`!!document.querySelector('.main-menu') || !!document.querySelector('.hud')`, 180000, 300); await sleep(15000);
    const r = await ev(pres); r.q = q; (out.prod ??= []).push(r); log('prod', q, JSON.stringify(r));
    await page.screenshot(`${D}/a98-prod-${q.replace(/[^a-z0-9]+/gi, '_')}.png`).catch(() => 0);
  }
  const before = readdirSync('/tmp').filter((n) => n.startsWith('foglight-smoke-dist-'));
  sp = spawn('npm', ['run', 'preview:smoke'], { cwd: process.env.QA_GAME, env: { ...process.env, PORT: '5776' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let so = ''; sp.stdout.on('data', (d) => (so += d)); sp.stderr.on('data', (d) => (so += d));
  for (let k = 0; k < 180 && !/测试构建已起/.test(so); k++) await sleep(1000);
  const mine = readdirSync('/tmp').filter((n) => n.startsWith('foglight-smoke-dist-') && !before.includes(n)); out.smokeDir = mine;
  for (const q of ['?smoke=1&art=0&autostart=1', '?smoke=1&art=0']) {
    await ev(`localStorage.clear(), 1`).catch(() => 0); await page.goto(`http://127.0.0.1:5776/${q}`);
    await must(`!!window.__game`, 300000, 'hooks');
    await page.waitFor(q.includes('autostart') ? `!!window.__s1 && __game.input.context === 'explore'` : `!!document.querySelector('.main-menu')`, 300000, 300); await sleep(3000);
    const r = await ev(pres); r.q = q; r.scene = await ev(`__game.scenes.current?.constructor?.name ?? null`).catch(() => null); r.ctx = await ev(`__game.input.context`); (out.smoke ??= []).push(r); log('smoke', q, JSON.stringify(r));
  }
  process.kill(-sp.pid, 'SIGINT'); await new Promise((r) => { sp.on('exit', r); setTimeout(r, 15000); }); await sleep(1500);
  out.smokeDirAfter = mine.map((n) => ({ n, exists: existsSync('/tmp/' + n) })); sp = null;
  out.errors = page.errors.slice(0, 10); save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
if (sp) { try { process.kill(-sp.pid, 'SIGINT'); } catch {} await sleep(3000); }
await done(); process.exit(0);
