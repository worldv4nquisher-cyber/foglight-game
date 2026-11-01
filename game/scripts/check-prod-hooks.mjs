// batch25 第 1 项：断言生产构建（dist/）不含调试 / QA 钩子。check:release 在 build 之后跑。
// __game / __qa / __perfSpot / __s1..__s3 / __testbed 只在 vite dev 和测试构建（--mode smoke，见 scripts/lib/test-server.mjs）里有；
// 生产构建里 main.ts 的条件是构建期常量，整段连同 debug/qaHooks、debug/perfSpot 模块被摇树删掉，线上加 ?smoke=1 也拿不到。
// 用法：npm run verify:prod-hooks（DIST=别的目录 可选，默认 dist）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(root, process.env.DIST ?? 'dist');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`✗ ${DIST}/index.html 不存在，先 npm run build`);
  process.exit(1);
}
/** 只在钩子代码里出现的字符串（游戏代码自己的属性名如 puzzles 不算） */
export const FORBIDDEN = ['__qa', '__game', '__perfSpot', '__testbed', '__s1', '__s2', '__s3', '__lods', 'installQaHooks', 'unparsable'];
/**
 * batch26：?debug=1 和 ?scene= 直进场景也只在 dev / 测试构建里（src/config/debug.ts 的 TEST_BUILD 是构建期常量）。
 * 生产构建里不能还有读这两个 URL 参数的代码，也不能还有直进 testbed / sandbox 的分支（压缩后引号可能是 ` ' "）。
 */
export const FORBIDDEN_RE = [
  [/\.(?:has|get)\(\s*[`'"](?:debug|scene)[`'"]\s*\)/, '读 ?debug / ?scene 参数'],
  // batch26 追加：?smoke 的 4 处行为（默认关美术、帧率面板详细模式、?hintScale、S3 ?father= 预览）也只在 dev / 测试构建里
  [/\.(?:has|get)\(\s*[`'"]smoke[`'"]\s*\)/, '读 ?smoke 参数'],
  [/\.(?:has|get)\(\s*[`'"]hintScale[`'"]\s*\)/, '读 ?hintScale 参数'],
  [/\.(?:has|get)\(\s*[`'"]father[`'"]\s*\)/, '读 ?father= 预览参数'],
  // batch26 再追加（同裁决 31）：?autostart 跳过主菜单也只在 dev / 测试构建里
  [/\.(?:has|get)\(\s*[`'"]autostart[`'"]\s*\)/, '读 ?autostart 参数'],
  [/startLoading\(\s*[`'"](?:testbed|sandbox)[`'"]\s*\)/, '?scene=testbed / sandbox 直进分支'],
];

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
// batch26：除了 static/，dist/assets/ 下所有 JS（含以后放进去的 worker / 解码器等）也扫；目录不存在就跳过
const scan = (d, re) => (existsSync(d) ? walk(d).filter((f) => re.test(f)) : []);
const staticFiles = scan(join(DIST, 'static'), /\.(js|mjs|html|css)$/);
const assetJs = scan(join(DIST, 'assets'), /\.(js|mjs|cjs)$/);
const files = [join(DIST, 'index.html'), ...staticFiles, ...assetJs];
const hits = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const w of FORBIDDEN) {
    const i = s.indexOf(w);
    if (i >= 0) hits.push(`${relative(root, f)}：「${w}」…${s.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, ' ')}…`);
  }
  for (const [re, what] of FORBIDDEN_RE) {
    const m = re.exec(s);
    if (m) hits.push(`${relative(root, f)}：${what}「${m[0]}」…${s.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ')}…`);
  }
}
if (hits.length) {
  console.error(`✗ 生产构建里还有调试 / QA 钩子（${hits.length} 处）——是不是用 --mode smoke 建的 dist，或新加的钩子没用构建期条件？`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`✓ 生产构建不含调试 / QA 钩子：${files.length} 个文件（index.html + static/*.js|css ${staticFiles.length} 个 + assets/**/*.js ${assetJs.length} 个）里没有 ${FORBIDDEN.join(' / ')}；也没有 ${FORBIDDEN_RE.map(([, w]) => w).join(' / ')}`);
