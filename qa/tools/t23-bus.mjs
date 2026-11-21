// batch23 ④ P3 EventBus：注入抛错监听器（排在 scene:change 全部监听器最前），切场景 S1→S2、S2→菜单仍完整；计数 / console.error / 后续监听器
import { open, sleep, SH16 as SH } from './b23lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/bus`; mkdirSync(D, { recursive: true });
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = { steps: [] }; const save = () => writeFileSync(`${D}/t23-bus.json`, JSON.stringify(out, null, 1));
const { page, ev, must, url, done } = await open(5752, { width: 1280, height: 720 });
let cons = []; page.onEvent((m) => { if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') cons.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
const INJ = (tag) => `(() => { const set = __game.events.handlers.get('scene:change'); const old = [...set]; window.__busMark = window.__busMark ?? [];
  const thrower = (p) => { window.__busMark.push('${tag}:thrower:' + p.to); throw new Error('QA23 injected ${tag}'); };
  const marker = (p) => { window.__busMark.push('${tag}:marker:' + p.to); };
  set.clear(); set.add(thrower); for (const h of old) set.add(h); set.add(marker); window.__busUnhook = () => { set.delete(thrower); set.delete(marker); }; return { before: old.length, after: set.size }; })()`;
const ST = `(() => { const g = __game, s = g.scenes.current; return { scene: s?.name ?? null, transitioning: g.flow.transitioning, ctx: g.input.context, listenerErrors: g.events.listenerErrors, recent: g.events.recentListenerErrors.map((r) => r.type + ': ' + String(r.error?.message ?? r.error)), marks: window.__busMark ?? [], s1: typeof window.__s1, s2: typeof window.__s2, frame: g.time.frame, fixedTick: g.time.fixedTick }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&quality=standard&autostart=1`));
  await must(`!!window.__s1?.rig && __game.input.context === 'explore'`, 900000, 's1');
  await must(`__game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 600000, 'loads');
  out.base = await ev(ST); log('base', JSON.stringify(out.base)); page.errors.length = 0; cons = [];
  out.inj1 = await ev(INJ('s2')); log('inj1', JSON.stringify(out.inj1));
  await ev(`(__game.flow.goToLevel('s2'), 1)`);
  const ok2 = await must(`__game.scenes.current?.name === 's2-keeper-house' && !!window.__s2?.rig && !__game.flow.transitioning && __game.input.context === 'explore'`, 600000, 's2').then(() => true, () => false);
  const f0 = await ev(`__game.time.fixedTick`); await sleep(3000);
  const s2 = await ev(ST); s2.ok = ok2; s2.ticksIn3s = s2.fixedTick - f0; s2.console = cons.slice(0, 5); s2.errors = page.errors.slice(0, 5).map(String); out.steps.push({ step: 'S1→S2 首位抛错监听器', ...s2 }); log('s2', JSON.stringify(s2)); save();
  await ev(`(__busUnhook(), 1)`); page.errors.length = 0; cons = [];
  out.inj2 = await ev(INJ('menu')); await ev(`(__game.flow.toMenu(), 1)`);
  const okm = await must(`__game.scenes.current?.name === 'menu' && !__game.flow.transitioning`, 300000, 'menu').then(() => true, () => false);
  await sleep(4000);
  const m = await ev(ST); m.ok = okm; m.menuVisible = await ev(`!!document.querySelector('.main-menu') && !document.querySelector('.main-menu').hidden`); m.lamp = await ev(`!!__game.scenes.current.lamp?.material`);
  m.console = cons.slice(0, 5); m.errors = page.errors.slice(0, 5).map(String); out.steps.push({ step: 'S2→菜单 首位抛错监听器', ...m }); log('menu', JSON.stringify(m)); save();
  await page.screenshot(`${D}/menu-after-throw.png`);
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
