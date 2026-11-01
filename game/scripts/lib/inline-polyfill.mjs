// batch27 第 2 项：把 src/platform/structuredClonePolyfill.js（structuredClone 降级的唯一实现）变成 index.html 的内联脚本。
// vite.config.ts 的 transformIndexHtml（dev + 构建）和 verify-save 单测都用这一个函数，保证内联版与模块版是同一份源码。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const POLYFILL_SRC = fileURLToPath(new URL('../../src/platform/structuredClonePolyfill.js', import.meta.url));
/** index.html 里的占位（构建 / dev 时整段换成内联代码） */
export const POLYFILL_PLACEHOLDER = '/* @inline src/platform/structuredClonePolyfill.js */';

/** 内联脚本正文：去掉 export、包一层 IIFE、在 window 上装 */
export function polyfillInlineScript(src = readFileSync(POLYFILL_SRC, 'utf8')) {
  if (/^\s*import\s/m.test(src)) throw new Error('structuredClonePolyfill.js 不能 import（要内联进 index.html）');
  if (/<\/script/i.test(src)) throw new Error('structuredClonePolyfill.js 里不能出现 </script>');
  const body = src.replace(/^export\s+(?=function\s)/gm, '');
  if (/^\s*export\s/m.test(body)) throw new Error('structuredClonePolyfill.js 只能导出顶层 function 声明');
  return `(function () {\n${body}\ninstallStructuredClonePolyfill(window);\n})();`;
}

/** 把 HTML 里的占位换成内联代码；没有占位就报错（防止 index.html 被改坏后悄悄没了 polyfill） */
export function inlinePolyfillIntoHtml(html, src) {
  if (!html.includes(POLYFILL_PLACEHOLDER)) throw new Error(`index.html 里没有 polyfill 占位 ${POLYFILL_PLACEHOLDER}`);
  return html.replace(POLYFILL_PLACEHOLDER, () => polyfillInlineScript(src));
}
