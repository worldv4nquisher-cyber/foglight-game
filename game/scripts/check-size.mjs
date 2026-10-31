// 分包体积检查（v0.1-010，npm run size；npm run check 在 build 之后跑）。
//
// 按 src/assets/manifest.ts 的分组统计 dist/ 里实际文件大小：
//   menu  = index.html + 全部代码（dist/static：JS / CSS / wasm）+ boot / menu 组资源（字体子集等）  预算 ≤ 15 MB
//   首场景包 = common + s1                                                                       预算 ≤ 150 MB
//   首次进入 S1 的总下载 = menu + common + s1                                                       也按 150 MB 检查
//   进场后懒加载（033 改；1031 加 S2、S3 两层、结尾曲）= 清单里 lazy 的 audio：进了场景、首帧渲染后才下载，按组单列，不计入上面两项
//   另列 6 首配乐（mus-*）合计
//   单个字体文件 ≤ 2 MB
// 超预算 → 退出码 1（构建失败）。dist/assets 里没登记进清单的文件只警告（不会被加载，但会打进包）。
// 另外列出 ../art 里已交付、还没登记进清单的运行时资源（glb / ktx2 / 音频）按文件名估算的分组，供 034 接入前预估（只提示，不判失败）。
//
//   npm run size            （需要先 npm run build）
//   node --import ./scripts/register-ts-paths.mjs scripts/check-size.mjs --json   机器可读输出
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest, ASSET_GROUPS } from '../src/assets/manifest.ts';
import { guessGroup, sizeBucket, sizeVerdict, BUDGET, WARN } from './lib/size-groups.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ART = join(ROOT, '../art');
const MB = 1024 * 1024;
export { BUDGET, WARN }; // 预算 / 140 MB 警戒线 / 判定逻辑在 lib/size-groups.mjs（batch17 D4，单测见 verify-assets）

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const size = (p) => (existsSync(p) ? statSync(p).size : 0);
const mb = (b) => `${(b / MB).toFixed(2)} MB`;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('  ✗ 没有 dist/index.html，先运行 npm run build');
  process.exit(1);
}

const groups = Object.fromEntries(ASSET_GROUPS.map((g) => [g, { bytes: 0, files: [], missing: [] }]));
const counted = new Set();
/** 进场后懒加载（lazy audio）：group → { bytes, files } */
const lazyAfter = {};
// 代码 + 页面 → menu（启动就要下载）
for (const f of [join(DIST, 'index.html'), ...walk(join(DIST, 'static'))]) {
  groups.menu.bytes += size(f);
  groups.menu.files.push(relative(DIST, f));
  counted.add(f);
}
// 字体授权随字体走（menu）
for (const f of walk(join(DIST, 'assets/fonts')).filter((f) => !/\.woff2$/.test(f))) {
  groups.menu.bytes += size(f);
  counted.add(f);
}
let ok = true;
const fail = (msg) => {
  ok = false;
  console.error(`  ✗ ${msg}`);
};

for (const e of manifest) {
  const p = join(DIST, e.url);
  const g = groups[e.group];
  if (!existsSync(p)) {
    g.missing.push(e.key);
    if (!e.optional) fail(`清单资源 ${e.key}（${e.url}）不在 dist 里`);
    continue;
  }
  counted.add(p);
  if (sizeBucket(e).lazyAfterEntry) {
    const l = (lazyAfter[e.group] ??= { bytes: 0, files: [] });
    l.bytes += size(p);
    l.files.push(e.url);
    continue;
  }
  g.bytes += size(p);
  g.files.push(e.url);
  if (e.type === 'font' && size(p) > BUDGET.fontMB * MB) fail(`字体 ${e.url} ${mb(size(p))} > ${BUDGET.fontMB} MB`);
}

// v0.1-013：GLB 引用的外部贴图（art/textures/*.ktx2）算进 GLB 所在分组（多组共用的算最早加载的那组）
const glbUris = (file) => {
  const b = readFileSync(file);
  if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF') return [];
  const j = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  return [...(j.images ?? []), ...(j.buffers ?? [])].map((x) => x.uri).filter((u) => u && !u.startsWith('data:'));
};
const externalNames = new Set();
for (const g of ASSET_GROUPS) {
  for (const e of manifest.filter((x) => x.group === g && x.type === 'gltf')) {
    const p = join(DIST, e.url);
    if (!existsSync(p)) continue;
    for (const u of glbUris(p)) {
      const t = resolve(dirname(p), decodeURIComponent(u));
      externalNames.add(basename(t));
      if (counted.has(t)) continue;
      if (!existsSync(t)) {
        fail(`${e.url} 引用的外部文件 ${u} 不在 dist 里`);
        continue;
      }
      groups[g].bytes += size(t);
      groups[g].files.push(relative(DIST, t));
      counted.add(t);
    }
  }
}

const unlisted = walk(join(DIST, 'assets')).filter((f) => !counted.has(f) && !basename(f).startsWith('.'));

// 1031：配乐（manifest 里 key 以 mus- 开头的 audio）合计
const music = { bytes: 0, lazyBytes: 0, files: [] };
for (const e of manifest.filter((x) => x.type === 'audio' && x.key.startsWith('mus-'))) {
  const p = join(DIST, e.url);
  if (!existsSync(p)) continue;
  music.bytes += size(p);
  if (sizeBucket(e).lazyAfterEntry) music.lazyBytes += size(p);
  music.files.push(e.key);
}
const first = groups.common.bytes + groups.s1.bytes;
const firstTotal = groups.menu.bytes + first;
const json = process.argv.includes('--json');

// ../art 里已交付、未进清单的运行时资源（估算；规则见 scripts/lib/size-groups.mjs）
const listedNames = new Set([...manifest.map((e) => basename(e.url)), ...externalNames]);
const art = { menu: 0, common: 0, s1: 0, s2: 0, s3: 0, files: 0 };
for (const f of walk(ART)) {
  const rel = relative(ART, f);
  if (/^(source|style|tools|ui)\//.test(rel) || rel.includes('/preview/')) continue;
  if (!/\.(glb|ktx2|ogg|mp3|m4a)$/.test(f) || listedNames.has(basename(f))) continue;
  art[guessGroup(basename(f))] += size(f);
  art.files++;
}

if (json) {
  console.log(JSON.stringify({ groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.bytes])), firstPackage: first, firstTotal, lazyAfterEntry: Object.fromEntries(Object.entries(lazyAfter).map(([k, v]) => [k, v.bytes])), music, unlisted: unlisted.map((f) => relative(DIST, f)), art, budget: BUDGET, warn: WARN }, null, 2));
} else {
  console.log('分包体积（dist/，按 src/assets/manifest.ts 分组）');
  for (const g of ASSET_GROUPS) {
    const v = groups[g];
    const extra = v.missing.length ? `（未交付、用占位：${v.missing.join(', ')}）` : '';
    console.log(`  ${g.padEnd(7)} ${mb(v.bytes).padStart(10)}  ${v.files.length} 个文件${extra}`);
  }
  console.log(`  主菜单包 menu+boot          ${mb(groups.menu.bytes + groups.boot.bytes)} / ${BUDGET.menuMB} MB`);
  console.log(`  首场景包 common+s1          ${mb(first)} / ${BUDGET.firstPackageMB} MB`);
  console.log(`  首次进入 S1 总下载           ${mb(firstTotal)} / ${BUDGET.firstPackageMB} MB（内部警戒线 ${WARN.firstTotalMB} MB）`);
  for (const [g, v] of Object.entries(lazyAfter)) {
    console.log(`  ${g} 进场后懒加载（首帧后）     ${mb(v.bytes)}  ${v.files.map((f) => basename(f)).join(', ')}（不计入上面两项）`);
  }
  if (music.files.length) console.log(`  配乐 mus-* 合计 ${music.files.length} 首        ${mb(music.bytes)}（${music.bytes.toLocaleString('en-US')} B；预加载 ${mb(music.bytes - music.lazyBytes)}，进场后懒加载 ${mb(music.lazyBytes)}）`);
  if (art.files) {
    const est = art.common + art.s1;
    console.log(
      `  [预估] ../art 已交付未登记 ${art.files} 个文件：menu ${mb(art.menu)}、common ${mb(art.common)}、s1 ${mb(art.s1)}、s2 ${mb(art.s2)}、s3 ${mb(art.s3)}` +
        `\n         全部接入后首场景包 ≈ ${mb(first + est)}，首次总下载 ≈ ${mb(firstTotal + est)}（按文件名猜的分组，034 接入后以上面为准）`,
    );
  }
}
const verdict = sizeVerdict({ menuBytes: groups.menu.bytes + groups.boot.bytes, firstPackageBytes: first, firstTotalBytes: firstTotal });
for (const w of verdict.warnings) console.warn(`  ! ${w}`);
for (const f of unlisted) console.warn(`  ! dist/${relative(DIST, f)} 没有登记在清单里（不会被加载，但打进了包）`);

for (const f of verdict.failures) fail(f);
if (!ok) process.exit(1);
if (!json) console.log('  ✓ 分包体积在预算内');
