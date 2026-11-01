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

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = [join(DIST, 'index.html'), ...walk(join(DIST, 'static')).filter((f) => /\.(js|mjs|html|css)$/.test(f))];
const hits = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const w of FORBIDDEN) {
    const i = s.indexOf(w);
    if (i >= 0) hits.push(`${relative(root, f)}：「${w}」…${s.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, ' ')}…`);
  }
}
if (hits.length) {
  console.error(`✗ 生产构建里还有调试 / QA 钩子（${hits.length} 处）——是不是用 --mode smoke 建的 dist，或新加的钩子没用构建期条件？`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`✓ 生产构建不含调试 / QA 钩子：${files.length} 个文件（index.html + static/*.js|css）里没有 ${FORBIDDEN.join(' / ')}`);
