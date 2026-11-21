import { QA_DIR } from './paths.mjs';
import { open, sleep, SH } from './b4lib.mjs';
const T = 'v0.1-010';
const P = await open(5244);
const { page, ev, must, clickSel, url, rec, step } = P;
const res = () => ev(`performance.getEntriesByType('resource').map(e => ({ n: e.name.replace(location.origin + '/', ''), t: e.transferSize, b: e.encodedBodySize, s: Math.round(e.startTime) }))`);
const st = () => ev(`({ scene: __game.scenes.current?.name, groups: __game.assets.loadedGroups.slice(), save: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null'), mem: { ...__game.renderer.info.memory }, loc: document.querySelector('.hud-location, [class*=location]')?.textContent ?? null })`);
const pos = () => ev(`(() => { const p = __game.scenes.current.rig.body.position; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; })()`);
const tp = (x, z) => ev(`(() => { const r = __game.scenes.current.rig; const p = r.body.position.clone(); p.set(${x}, 0.01, ${z}); r.body.teleport(p); return true; })()`);
const waitScene = (n, ms = 120000) => must(`window.__game?.scenes.current?.name === '${n}' && !!__game.scenes.current.rig && !__game.flow.transitioning`, ms, n);
const waitMenu = () => must(`window.__game?.scenes.current?.name === 'menu' && !document.querySelector('.main-menu').hidden`, 90000, '主菜单');
const diff = (a, b) => b.filter((x) => !a.some((y) => y.n === x.n && y.s === x.s));
const sum = (l) => l.reduce((s, x) => s + x.t, 0);
const fmt = (l) => l.map((x) => `${x.n.replace(/^static\//, '')} ${(x.t / 1024).toFixed(1)}kB`).join('，');
const out = {};

await page.goto(url('?smoke=1')); await must('!!window.__game'); await ev('localStorage.clear()');
await page.goto(url('?smoke=1'));

let r0;
await step(T, '启动只加载 boot+menu', async () => {
  await waitMenu(); await sleep(1500);
  r0 = await res(); const s = await st();
  const ready = await ev('({ m: __game.flow.menuReadyMs, b: __game.flow.bootStartMs, fonts: [...document.fonts].filter(f => f.status === "loaded").map(f => f.family) })');
  out.boot = { res: r0, s, ready };
  const glb = r0.filter((x) => /\.(glb|ktx2|wasm)$/.test(x.n));
  rec(T, '启动只加载 boot+menu', s.groups.join(',') === 'boot,menu' && glb.length === 0 ? 'PASS' : 'FAIL',
    `loadedGroups=${s.groups}；请求 ${r0.length} 个、传输 ${(sum(r0) / 1024).toFixed(1)} kB：${fmt(r0)}；menuReadyMs=${ready.m?.toFixed(0)} bootStart=${ready.b?.toFixed(0)}；已加载字体 ${JSON.stringify(ready.fonts)}`);
});

let r1;
await step(T, '新游戏加载 common+s1、进 S1 存档', async () => {
  await clickSel('.main-menu [data-act="new"]');
  const sawLoading = await page.waitFor(`!document.querySelector('.loading-screen').hidden`, 10000, 20);
  await waitScene('s1-ebb-shore'); await sleep(800);
  r1 = await res(); const s = await st(); const n = diff(r0, r1);
  out.s1 = { res: n, s };
  rec(T, '新游戏加载 common+s1、进 S1 存档', s.groups.includes('common') && s.groups.includes('s1') && s.save?.sceneId === 's1' ? 'PASS' : 'FAIL',
    `加载页出现=${sawLoading}；loadedGroups=${s.groups}；新请求 ${n.length} 个 ${(sum(n) / 1024).toFixed(1)} kB：${fmt(n)}；存档 sceneId=${s.save?.sceneId} chapter=${s.save?.chapterId}；地名「${s.loc}」`);
  await page.screenshot(`${SH}/010-s1-enter.png`);
});

await step(T, 'S1 建立镜头后预加载 s2', async () => {
  const ok = await page.waitFor(`__game.assets.isGroupLoaded('s2')`, 120000, 200);
  const s = await st(); const n = diff(r1, await res());
  out.pre = { s, n, mem: s.mem };
  rec(T, 'S1 建立镜头后预加载 s2', ok ? 'PASS' : 'FAIL', `isGroupLoaded(s2)=${ok}；loadedGroups=${s.groups}；新网络请求 ${n.length} 个（s2 组 manifest 里没有文件，组为空）${fmt(n)}；memory ${JSON.stringify(s.mem)}`);
});

async function transit(from, to, ex, ez, shot) {
  const before = await st();
  await tp(ex, ez + 3); await sleep(400);
  // 采样黑场不透明度（真实时间）
  const samp = ev(`__qa.sample(() => [Math.round(performance.now()), __game.ui.fade.opacity, !document.querySelector('.screen-fade-progress').hidden, __game.scenes.current?.name], 4000)`);
  await tp(ex, ez);
  let shotDone = false;
  for (let i = 0; i < 40 && !shotDone; i++) { await sleep(50); if (await ev('__game.ui.fade.opacity >= 0.99')) { await page.screenshot(`${SH}/${shot}`); shotDone = true; } }
  const smp = await samp;
  await waitScene(to);
  await sleep(600);
  const after = await st(); const lt = await ev('__game.flow.lastTransition');
  const firstUp = smp.find((x) => x[1] > 0); const black = smp.filter((x) => x[1] >= 0.999); const lastBlack = black.at(-1); const end = smp.find((x, i) => i > smp.indexOf(lastBlack ?? smp[0]) && x[1] === 0);
  return { before, after, lt, p: await pos(), visual: firstUp && end ? { totalMs: end[0] - firstUp[0], blackMs: lastBlack && black[0] ? lastBlack[0] - black[0][0] : null, progress: smp.some((x) => x[2]) } : null };
}

await step(T, 'S1→S2 黑场切换、存档、释放', async () => {
  const r = await transit('s1-ebb-shore', 's2-keeper-house', -10, -12, '010-s1-s2-black.png');
  out.t12 = r;
  const ok = r.after.save?.sceneId === 's2' && r.lt?.to === 's2-keeper-house' && r.lt.ms <= 1000 && !r.lt.waitedForLoad && !r.after.groups.includes('s1') && r.after.groups.includes('s3');
  rec(T, 'S1→S2 黑场切换、存档、释放', ok ? 'PASS' : 'FAIL',
    `lastTransition ms=${r.lt?.ms?.toFixed(0)} hold=${r.lt?.holdMs?.toFixed(0)} phases=${JSON.stringify(Object.fromEntries(Object.entries(r.lt?.phases ?? {}).map(([k, v]) => [k, Math.round(v)])))} maxFrame=${r.lt?.maxFrameMs?.toFixed(0)} waitedForLoad=${r.lt?.waitedForLoad} progressShown=${r.lt?.progressShown}；采样：总 ${r.visual?.totalMs} ms、全黑 ${r.visual?.blackMs} ms；存档 sceneId=${r.after.save?.sceneId}；groups ${r.before.groups} → ${r.after.groups}；memory ${JSON.stringify(r.before.mem)} → ${JSON.stringify(r.after.mem)}；入口位置 ${r.p}；地名「${r.after.loc}」`);
  await page.screenshot(`${SH}/010-s2-enter.png`);
});

await step(T, 'S2→S3 黑场切换、存档、释放', async () => {
  await page.waitFor(`__game.assets.isGroupLoaded('s3')`, 60000, 200);
  const r = await transit('s2-keeper-house', 's3-lighthouse', 9, -11, '010-s2-s3-black.png');
  out.t23 = r;
  const ok = r.after.save?.sceneId === 's3' && r.lt?.ms <= 1000 && !r.after.groups.includes('s2') && !r.after.groups.includes('s1');
  rec(T, 'S2→S3 黑场切换、存档、释放', ok ? 'PASS' : 'FAIL',
    `lastTransition ms=${r.lt?.ms?.toFixed(0)} hold=${r.lt?.holdMs?.toFixed(0)} phases=${JSON.stringify(Object.fromEntries(Object.entries(r.lt?.phases ?? {}).map(([k, v]) => [k, Math.round(v)])))} waitedForLoad=${r.lt?.waitedForLoad}；采样：总 ${r.visual?.totalMs} ms、全黑 ${r.visual?.blackMs} ms；存档 sceneId=${r.after.save?.sceneId}；groups ${r.before.groups} → ${r.after.groups}；memory ${JSON.stringify(r.before.mem)} → ${JSON.stringify(r.after.mem)}；入口位置 ${r.p}；地名「${r.after.loc}」`);
  await page.screenshot(`${SH}/010-s3-enter.png`);
});

await step(T, '刷新后「继续」回到当前场景（S3）入口', async () => {
  await tp(3, 3); await sleep(500); const moved = await pos();
  await page.goto(url('?smoke=1')); await waitMenu(); await sleep(1000);
  const btns = await ev(`[...document.querySelectorAll('.main-menu .main-buttons button')].filter(b => !b.hidden).map(b => b.textContent)`);
  await clickSel('.main-menu [data-act="continue"]');
  await waitScene('s3-lighthouse'); await sleep(800);
  const s = await st(); const p = await pos();
  rec(T, '刷新后「继续」回到当前场景（S3）入口', s.scene === 's3-lighthouse' && Math.abs(p[0]) < 0.05 && Math.abs(p[2] - 9) < 0.05 ? 'PASS' : 'FAIL',
    `刷新前移到 ${moved}；主菜单按钮 ${JSON.stringify(btns)}；继续后 scene=${s.scene} 位置 ${p}（入口 from-s2 = 0,0,9）；groups=${s.groups}`);
});

await step(T, 'S3 点灯 → 章节结束页', async () => {
  await tp(0, -2.6); await sleep(300);
  await ev(`__game.scenes.current.rig.controller.facing = Math.PI`);
  await page.waitFor(`__game.scenes.current.interaction.current?.id === 's3-lamp'`, 15000, 100);
  const cur = await ev(`({ id: __game.scenes.current.interaction.current?.id ?? null, prompt: document.querySelector('.hud-prompt')?.textContent ?? null })`);
  await page.tap('KeyE');
  const lit = await page.waitFor(`__game.scenes.current.lighthouse?.on === true`, 15000, 50);
  await sleep(300); await page.screenshot(`${SH}/010-s3-lamp-lit.png`);
  const end = await page.waitFor(`__game.scenes.current?.name === 'chapter-end'`, 30000, 100);
  await sleep(1200);
  const txt = await ev(`document.querySelector('.chapter-end')?.innerText ?? null`);
  const save = await ev(`JSON.parse(localStorage.getItem('foglight.save.v1'))`);
  await page.screenshot(`${SH}/010-chapter-end.png`);
  rec(T, 'S3 点灯 → 章节结束页', cur.id === 's3-lamp' && lit && end ? 'PASS' : 'FAIL', `当前交互 ${cur.id} 提示「${cur.prompt}」；E 后灯亮=${lit}；结束页=${end}；文字「${(txt || '').replace(/\n+/g, ' | ')}」；存档 chapterComplete=${save?.chapterComplete} groups=${(await st()).groups}`);
});

P.save('b4-010'); out.errors = page.errors;
(await import('node:fs')).writeFileSync((QA_DIR + '/out/b4-010-detail.json'), JSON.stringify(out, null, 1));
console.log('errors', JSON.stringify(page.errors));
await P.done(); process.exit(0);
