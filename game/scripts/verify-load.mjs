// 037 加载时间（npm run check:release 的一环；需要先 npm run build）：本地生产构建（vite preview）+ 无头 Chrome，全新 profile、禁用缓存（= 清缓存），量
//   - 主菜单出现：从导航开始到主菜单「新游戏」按钮可见（页面里 performance.now()）—— 验收 ≤ 3000 ms；
//   - 首场景：点「新游戏」→ S1 首帧（scene:firstFrame）、S1 资源全部下载完（assets.loadStats 全 done），各自的耗时和下载字节数。
// 网络：默认本机回环不限速；LOAD_MBPS=50 LOAD_LATENCY_MS=40 用 CDP 模拟带宽 / 延迟（写进报告）。
// 注意：box 上是 swiftshader 软渲染，首帧 / 着色器编译偏慢，数字是上限参考；实机数字由制作人桌面复测（见 v0.1-perf-report.md）。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/verify-load.mjs    结果 → ../docs/releases/perf/verify-load.json
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { launchChrome, sleep } from './lib/cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, process.env.LOAD_OUT ?? '../docs/releases/perf');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) throw new Error('先 npm run build');
const MENU_BUDGET_MS = 3000;
const MBPS = +(process.env.LOAD_MBPS ?? 0);
const LATENCY = +(process.env.LOAD_LATENCY_MS ?? 0);

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
// 生产构建只有 ?smoke 才暴露 window.__game（读加载记录要用）；smoke 默认关美术，所以显式 art=1 —— 其余和玩家打开一样走主菜单
const url = `http://127.0.0.1:${server.httpServer.address().port}/?smoke=1&art=1`;
const network = MBPS ? `CDP 模拟 ${MBPS} Mbps 下行 / ${LATENCY} ms 延迟` : '本机回环（vite preview 127.0.0.1），不限速';
const report = { at: new Date().toISOString(), url, network, renderer: 'headless Chrome + swiftshader（软渲染）', cache: '全新 profile + Network.setCacheDisabled + clearBrowserCache', menuBudgetMs: MENU_BUDGET_MS };
const reportFile = join(OUT, `verify-load${MBPS ? `-${MBPS}mbps` : ''}.json`);
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));

const cdp = await launchChrome({ width: 1280, height: 720, tag: 'load', watchdogMs: +(process.env.LOAD_WATCHDOG_MS ?? 30 * 60_000) });
const { send, evaluate, until } = cdp;
let bytes = 0;
let requests = 0;
cdp.on((m) => {
  if (m.method === 'Network.loadingFinished') { bytes += m.params.encodedDataLength ?? 0; requests++; }
});
let ok = false;
try {
  await send('Network.enable');
  await send('Network.clearBrowserCache');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (MBPS) await send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: (MBPS * 1e6) / 8, uploadThroughput: (MBPS * 1e6) / 8 });
  // 主菜单出现时刻在页面里记（不受 CDP 轮询间隔影响）
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const f = () => { const b = document.querySelector('.main-menu [data-act="new"]'); if (b && b.checkVisibility && b.checkVisibility()) { window.__menuAt = performance.now(); return; } requestAnimationFrame(f); }; requestAnimationFrame(f); })();`,
  });
  await send('Page.navigate', { url });
  if (!(await until('typeof window.__menuAt === "number"', 120_000, 100))) throw new Error('2 分钟内主菜单没出现');
  const menu = await evaluate(`({ menuMs: Math.round(window.__menuAt), dcl: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? 0), scene: __game.scenes.current?.name })`);
  report.menu = { ...menu, bytes, requests, ok: menu.menuMs <= MENU_BUDGET_MS };
  console.log(`  ${report.menu.ok ? '✓' : '✗'} 主菜单出现 ${menu.menuMs} ms（≤ ${MENU_BUDGET_MS}），下载 ${(bytes / 1048576).toFixed(2)} MB / ${requests} 个请求`);
  save();
  // 点「新游戏」进 S1
  bytes = 0;
  requests = 0;
  await evaluate(`(() => { window.__clickAt = performance.now(); document.querySelector('.main-menu [data-act="new"]').click(); return 1; })()`);
  await sleep(300);
  // 有存档覆盖确认时点确认（全新 profile 不该出现）
  await evaluate(`(() => { const b = document.querySelector('.confirm-dialog [data-act="confirm"], .main-menu [data-act="confirm"]'); if (b && b.checkVisibility()) b.click(); return 1; })()`);
  await evaluate(`(() => { const t = setInterval(() => { const g = __game; const s = g.assets.loadStats; if (window.__s1FirstAt == null && g.lastFirstFrame?.scene === 's1-ebb-shore') window.__s1FirstAt = g.lastFirstFrame.at; if (g.scenes.current?.name === 's1-ebb-shore' && s.length && s.every((x) => x.done)) { window.__s1DoneAt = performance.now(); clearInterval(t); } }, 50); return 1; })()`);
  if (!(await until('typeof window.__s1DoneAt === "number"', 20 * 60_000, 500))) throw new Error('20 分钟内 S1 没加载完');
  // 美术分批请求：等 3 s 再看有没有新条目
  await sleep(3000);
  const s1 = await evaluate(`(() => { const s = __game.assets.loadStats; return { firstFrameMs: window.__s1FirstAt == null ? null : Math.round(window.__s1FirstAt - window.__clickAt), allLoadedMs: Math.round(window.__s1DoneAt - window.__clickAt), entries: s.length, pending: s.filter((x) => !x.done).length, failed: s.filter((x) => x.done && !x.ok).map((x) => x.url.split('/').pop()) }; })()`);
  report.firstScene = { scene: 's1-ebb-shore', ...s1, bytes, requests };
  console.log(`  ✓ 首场景 S1：首帧 ${s1.firstFrameMs} ms、资源全部完成 ${s1.allLoadedMs} ms（点「新游戏」起算），下载 ${(bytes / 1048576).toFixed(1)} MB / ${requests} 个请求，失败 ${s1.failed.length}`);
  ok = report.menu.ok && !s1.failed.length;
} catch (e) {
  report.error = String(e?.message ?? e);
  console.log('  ✗', report.error);
} finally {
  report.errors = cdp.errors.slice(0, 20);
  save();
  cdp.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(`\n加载校验${ok ? '通过' : '不通过'}（${network}）→ ${reportFile}`);
process.exit(ok ? 0 : 1);
