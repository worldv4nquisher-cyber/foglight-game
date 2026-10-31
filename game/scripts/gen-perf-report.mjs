// 037 生成 docs/releases/v0.1-perf-report.md（npm run check:release 最后一步）：把 verify-budget / verify-load / verify-memory 的 JSON 和 npm run size 的结果填进表；
// 「FPS / 1% low / 帧时间」栏留空，由用户 M8 实机填（裁定第 8 条）。重新生成会覆盖整份报告 —— 实机数字请填在 v0.1-perf-report-m8.md 或生成后再填。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/gen-perf-report.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUALITY_PRESETS } from '../src/config/quality.ts';
import { PERF_SPOTS } from '../src/config/perf-spots.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PERF = resolve(root, '../docs/releases/perf');
const OUT = resolve(root, '../docs/releases/v0.1-perf-report.md');
const j = (f) => (existsSync(resolve(PERF, f)) ? JSON.parse(readFileSync(resolve(PERF, f), 'utf8')) : null);
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const MB = (b) => (b / 1048576).toFixed(2);
const M = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k' : String(n));
const bj = (s) => new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Bangkok', hour12: false }) + '（UTC+7）';
const TIERS = ['ultra', 'high', 'standard'];
const TN = { ultra: '极致', high: '高', standard: '标准' };
const L = [];
const p = (...a) => L.push(...a);

const commit = sh('git', ['log', '-1', '--format=%h %s']);
p('# v0.1 性能报告', '', `> 自动生成：${bj(new Date().toISOString())}，代码 ${commit}。生成脚本 game/scripts/gen-perf-report.mjs，原始数据 docs/releases/perf/*.json。`);
p('> box 上的数字来自无头 Chrome + swiftshader（软件渲染），只用于三角面 / draw call / 贴图 / 包体 / 加载 / 内存这些与 GPU 无关的计数；帧率不在这里量。', '');

p('## 1 帧率（由用户 M8 实机填写）', '');
p('> **由用户 M8 实机填写（基准 RTX 3060 级 1440p 极致档 60fps；最低 GTX 1650 级标准档）**。开发期 F3 面板看到的帧率只作自测参考，不写进本栏。', '');
p('| 机器 | 分辨率 | 档位 | 场景 / 机位 | FPS | 1% low | 帧时间 (ms) | 浏览器 | 备注 |', '|---|---|---|---|---|---|---|---|---|');
for (const [m, r, t] of [['RTX 3060 级', '2560×1440', '极致'], ['RTX 3060 级', '2560×1440', '高'], ['GTX 1650 级', '1920×1080', '标准']])
  for (const s of ['S1', 'S2', 'S3']) p(`| ${m} | ${r} | ${t} | ${s} 最差机位 |  |  |  |  |  |`);
p('');

// 全量跑（verify-budget.json）和按场景跑（verify-budget-s1.json …）合并：同一场景取较新的那次
const b = (() => {
  const files = readdirSync(PERF).filter((f) => /^verify-budget(-s[123](\+s[123])*)?\.json$/.test(f)).map((f) => j(f)).filter((x) => x?.mode === 'verify');
  if (!files.length) return null;
  const m = { at: files.map((f) => f.at).sort().at(-1), view: files[0].view, scenes: {}, failures: [], warnings: [] };
  const at = {};
  for (const f of files)
    for (const [sid, sr] of Object.entries(f.scenes)) if (!at[sid] || f.at > at[sid]) { at[sid] = f.at; m.scenes[sid] = sr; }
  for (const f of files) for (const [list, out] of [[f.failures, m.failures], [f.warnings ?? [], m.warnings]]) for (const x of list) { const sid = /^(s[123])/.exec(x)?.[1]; if (!sid || at[sid] === f.at) out.push(x); }
  return m;
})();
p('## 2 预算校验（verify-budget）', '');
p('三档预算（style-guide §8，不改参数）：', '', '| 档 | 可见面数 | draw call | 主角 | NPC | 贴图（角色道具 / 环境） |', '|---|---|---|---|---|---|');
for (const t of TIERS) { const q = QUALITY_PRESETS[t]; p(`| ${TN[t]} | ${M(q.sceneVisibleTris)} | ${q.maxDrawCalls} | ${M(q.heroCharTris)} | ${M(q.npcCharTris)} | ${q.textureMaxSize} / ${q.textureMaxSizeEnv} |`); }
p('');
if (!b) p('（还没跑：npm run verify:budget）', '');
else {
  p(`跑于 ${bj(b.at)}，视口 ${b.view.join('×')}；「主 pass」= 场景相机那一次 renderer.render 扣掉阴影；「整帧」含阴影、水面反射、后处理法线 / 深度 pass（只列不判）。结论：**${b.failures.length ? `${b.failures.length} 项不通过` : '全部通过'}**${b.warnings.length ? `（另有已知警告 ${b.warnings.length} 项，见下「已知项」）` : ''}。`, '');
  p('| 场景 | 档 | 机位 | 主 pass 面数 | 主 pass call | 整帧面数 | 整帧 call | 阴影面数 / call | 角色当前 LOD | 结果 |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const [sid, sr] of Object.entries(b.scenes))
    for (const t of TIERS) for (const sp of sr.tiers?.[t]?.spots ?? [])
      p(`| ${sid.toUpperCase()} | ${TN[t]} | ${sp.id} | ${M(sp.main?.tris)} | ${sp.main?.calls ?? '—'} | ${M(sp.frame.tris)} | ${sp.frame.calls} | ${M(sp.frame.shadowTris)} / ${sp.frame.shadowCalls} | ${Object.entries(sp.charLevels).map(([k, v]) => `${k.replace('char-', '')} ${v}`).join('，') || '—'} | ${sp.ok ? '过' : sp.known ? '已知项' : '**不过**'} |`);
  p('', '贴图 / 角色 LOD / puzzleCritical：', '', '| 场景 | 档 | 资源贴图 | 最大边 | 超限 | 角色最高可用级（面数 / 预算） | puzzleCritical |', '|---|---|---|---|---|---|---|');
  for (const [sid, sr] of Object.entries(b.scenes))
    for (const t of TIERS) { const tr = sr.tiers?.[t]; if (!tr?.textures) continue;
      p(`| ${sid.toUpperCase()} | ${TN[t]} | ${tr.textures.count}（KTX2 ${tr.textures.compressed}） | ${tr.textures.max} | ${tr.textures.over.length ? tr.textures.over.map((x) => `${x.name || x.users[0]} ${x.w}`).slice(0, 4).join('，') + (tr.textures.over.length > 4 ? ` 等 ${tr.textures.over.length} 张` : '') : '0'} | ${tr.chars.map((c) => `${c.name.replace('char-', '')} lod${c.topLevel} ${M(c.topTris)} / ${M(c.budget)}`).join('，') || '—'} | ${tr.critical.count} 个，不合格 ${tr.critical.bad.length} |`); }
  p('', '机位（game/src/config/perf-spots.ts；截图 docs/releases/perf/<机位>.png，极致档 1280×720）：', '');
  for (const [sid, spots] of Object.entries(PERF_SPOTS)) for (const sp of spots) p(`- ${sid.toUpperCase()} \`${sp.id}\` ${sp.label}：eye [${sp.eye}] → at [${sp.at}]，fov ${sp.fov}${existsSync(resolve(PERF, `${sp.id}.png`)) ? ` ![](perf/${sp.id}.png)` : ''}`);
  if (b.failures.length) p('', '不通过项：', '', ...b.failures.map((f) => `- ${f}`));
  p('', '### 已知项（裁定 28 第 3 条）', '');
  p('- **标准档 S1 主 pass 面数超预算**（1.5 M）：S1 美术场景在标准档可见面数 2.2–2.6 M。按裁定不做 LOD、不改预算，记为已知项，**等 M8 实机帧率（GTX 1650 级 1080p 标准档）再定**：帧率达标则保留，不达标再定是做环境 LOD 还是调预算。',
    '  verify-budget 把它标成已知警告（只放过「S1 × 标准档 × 主 pass 面数」且 ≤ 2.7 M、draw call 仍须达标），不卡 check:release；其他场景 / 档位 / call / 贴图 / 角色 LOD / puzzleCritical 超限照样算失败。');
  if (b.warnings.length) p('', '本次已知警告：', '', ...b.warnings.map((f) => `- ⚠ ${f}`));
  p('');
}

p('## 3 包体（npm run size）', '');
const sz = (() => { try { return JSON.parse(sh('node', ['--import', './scripts/register-ts-paths.mjs', 'scripts/check-size.mjs', '--json'])); } catch { return null; } })();
if (!sz) p('（没拿到：先 npm run build）', '');
else {
  const menu = sz.groups.menu + sz.groups.boot;
  p('| 项 | 大小 | 预算 | 结果 |', '|---|---|---|---|');
  p(`| 主菜单包（代码 + menu + boot） | ${MB(menu)} MB | 15 MB | ${menu <= 15 * 1048576 ? '过' : '**不过**'} |`);
  p(`| 首场景包（common + s1） | ${MB(sz.firstPackage)} MB | 150 MB | ${sz.firstPackage <= 150 * 1048576 ? '过' : '**不过**'} |`);
  p(`| 首次进 S1 总下载（menu + common + s1） | ${MB(sz.firstTotal)} MB | 150 MB（警戒 140） | ${sz.firstTotal <= 150 * 1048576 ? '过' : '**不过**'} |`);
  p(`| S2 / S3 场景包 | ${MB(sz.groups.s2)} / ${MB(sz.groups.s3)} MB | — | 切场景时加载 |`);
  p(`| 进场后懒加载配乐 S1 / S2 / S3 | ${Object.values(sz.lazyAfterEntry).map(MB).join(' / ')} MB | — | 不计入上面 |`);
  p('', '压缩：`npm run size` 同时检查 dist 里每个 GLB 网格是 Meshopt、贴图是 KTX2（结果见 size 输出；测试模型 test-lod-puzzle-critical.glb 未压缩，只警告；它在 dev 组，只有 ?scene=sandbox 下载，不计首场景包）。', '');
}

const ld = j('verify-load.json');
p('## 4 加载时间（verify-load）', '');
if (!ld) p('（还没跑：npm run verify:load）', '');
else {
  p(`跑于 ${bj(ld.at)}；网络：${ld.network}；缓存：${ld.cache}；渲染：${ld.renderer}。`, '');
  p('| 项 | 数值 | 预算 | 结果 |', '|---|---|---|---|');
  if (ld.menu) p(`| 主菜单出现（导航起） | ${ld.menu.menuMs} ms，下载 ${MB(ld.menu.bytes)} MB / ${ld.menu.requests} 个请求 | ≤ ${ld.menuBudgetMs} ms | ${ld.menu.ok ? '过' : '**不过**'} |`);
  if (ld.firstScene) {
    p(`| 首场景 S1 首帧（点「新游戏」起） | ${ld.firstScene.firstFrameMs} ms | — | 记录 |`);
    p(`| 首场景 S1 资源全部加载完 | ${ld.firstScene.allLoadedMs} ms，下载 ${MB(ld.firstScene.bytes)} MB / ${ld.firstScene.requests} 个请求，失败 ${ld.firstScene.failed.length} | — | 记录 |`);
  }
  if (ld.error) p(`| 出错 | ${ld.error} | | **不过** |`);
  p('');
}

const mm = j('verify-memory.json');
p('## 5 内存 / 显存（verify-memory）', '');
if (!mm) p('（还没跑：npm run verify:memory）', '');
else {
  p(`跑于 ${bj(mm.at)}，${TN[mm.tier] ?? mm.tier}档；路径 S1 → S2 → S3 → 主菜单 → 再进 S1；每站 GC 后量。估算显存 = 包住 WebGL 分配调用按格式累加（近似，不含驱动开销）。`, '');
  p('| 站 | 场景 | 估算显存 MB（贴图 / 缓冲 / RB） | 几何体 | 贴图 | 着色器程序 | JS 堆 MB |', '|---|---|---|---|---|---|---|');
  for (const s of mm.steps) p(`| ${s.label} | ${s.scene ?? '主菜单'} | ${s.glMB}（${s.texMB} / ${s.bufMB} / ${s.rbMB}） | ${s.geometries} | ${s.textures} | ${s.programs} | ${s.heapMB} |`);
  if (mm.menu) p('', `回主菜单 vs 第一次进 S1（≤ ×${mm.menu.max}）：${mm.menu.glMB} / ${mm.menu.firstS1} MB（×${mm.menu.ratio}，${mm.menu.ok ? '过' : '**不过**'}）`);
  if (mm.compare) p('', `通关回 S1 vs 第一次进 S1（±${mm.tolerance * 100}%）：` + Object.entries(mm.compare).map(([k, v]) => `${k} ${v.first} → ${v.again}（×${v.ratio}，${v.ok ? '过' : '**不过**'}）`).join('；'));
  if (mm.failures.length) p('', ...mm.failures.map((f) => `- ✗ ${f}`));
  p('');
}

p('## 6 需要真 GPU / 真浏览器的项（制作人桌面测试清单）', '');
p(readFileSync(resolve(root, 'scripts/perf-checklist.md'), 'utf8').trim(), '');
writeFileSync(OUT, L.join('\n') + '\n');
console.log(`性能报告 → ${OUT}`);
