// Node 校验脚本用的模块解析钩子：让 Node（原生 strip-types）能直接导入 src/ 里的 .ts 源码。
// - `@/xxx` → src/xxx.ts（与 tsconfig paths / vite alias 一致）
// - 相对路径省略扩展名时补 .ts（或 /index.ts）
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/verify-xxx.mjs
// 注意：被 Node 导入的源码不能用 TS 参数属性 / enum（strip-types 不支持），也不能在模块顶层访问 DOM。
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)};
function tryTs(href) {
  const p = fileURLToPath(href);
  if (existsSync(p) && !p.endsWith('/')) return href;
  for (const ext of ['.ts', '/index.ts']) if (existsSync(p + ext)) return pathToFileURL(p + ext).href;
  return null;
}
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const hit = tryTs(new URL(specifier.slice(2), SRC).href);
    if (hit) return { url: hit, shortCircuit: true };
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.endsWith('.ts')) {
    const hit = tryTs(new URL(specifier, context.parentURL).href);
    if (hit) return { url: hit, shortCircuit: true };
  }
  return next(specifier, context);
}
`),
);
