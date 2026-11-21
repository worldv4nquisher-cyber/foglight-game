// batch27 ①：生产 preview 带 ?quality=low&art=0&simulateFps=10&autostart=1&debug=1 与不带参数行为一致
process.env.QA_PROD = '1';
import { open, sleep, SH13 as SH } from './b27lib.mjs';
import { writeFileSync } from 'node:fs';
const D = `${SH}/hooks`; const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = { game: process.env.QA_GAME, runs: [] }; const save = () => writeFileSync(`${D}/t27-prodq.json`, JSON.stringify(out, null, 1));
const st = `(() => { const vis = (s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; };
  const c = document.querySelector('canvas'); const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k).slice(0, 400); }
  const res = performance.getEntriesByType('resource');
  return { search: location.search, hooks: ['__game','__qa','__s1','__perfSpot'].map((k) => k + ':' + typeof window[k]).join(' '), menu: vis('.main-menu'), hud: vis('.hud'),
    artReq: res.filter((r) => /\\/assets\\/art\\//.test(r.name)).length, resTotal: res.length, canvas: c ? [c.width, c.height] : null,
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 140), ls }; })()`;
const { page, ev, must, url, done } = await open(5781, { width: 1280, height: 720 });
const cons = []; page.onEvent((m) => { if (m.method === 'Runtime.consoleAPICalled') cons.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); });
try {
  for (const q of ['', '?quality=low&art=0&simulateFps=10&autostart=1&debug=1', '', '?quality=low&art=0&simulateFps=10&autostart=1&debug=1']) {
    const r = { q }; cons.length = 0;
    await page.goto(url('')); await sleep(800); await ev(`localStorage.clear(), sessionStorage.clear(), 1`);
    await page.goto(url(q)); await must(`document.readyState === 'complete'`, 120000);
    await page.waitFor(`!!document.querySelector('.main-menu') || !!document.querySelector('.hud')`, 180000, 300); await sleep(12000);
    r.menu = await ev(st); await page.screenshot(`${D}/b27-prodq-menu-${out.runs.length}.png`).catch(() => 0);
    // 真实点击「新游戏」进 S1，再等 45 s（够自动画质检测跑完）
    const b = await ev(`(() => { const e = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '新游戏' && x.getClientRects().length); if (!e) return null; const k = e.getBoundingClientRect(); return { x: k.x + k.width / 2, y: k.y + k.height / 2 }; })()`);
    r.btn = b; if (b) { await page.click(b.x, b.y); }
    await page.waitFor(`!!document.querySelector('.hud') && document.querySelector('.hud').getClientRects().length > 0`, 240000, 500); await sleep(45000);
    r.s1 = await ev(st); r.console = cons.filter((s) => /quality|画质|fps|art|美术|debug|autostart/i.test(s)).slice(0, 20); r.consoleN = cons.length;
    await page.screenshot(`${D}/b27-prodq-s1-${out.runs.length}.png`).catch(() => 0);
    out.runs.push(r); log(JSON.stringify({ q, menu: { ...r.menu, ls: undefined }, s1: { ...r.s1, ls: Object.keys(r.s1.ls) }, console: r.console }));
    save();
  }
  out.errors = page.errors.slice(0, 10); save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
await done(); process.exit(0);
