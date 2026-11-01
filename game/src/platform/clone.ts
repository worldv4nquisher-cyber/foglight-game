/**
 * batch26 ②：深拷贝。Safari 15.0–15.3（及更老的 WebView）没有 structuredClone（15.4 才有），
 * 直接调用会在第一次存档 / 读档（SaveSystem 构造里 load）时抛 ReferenceError。
 * 有原生就用原生；没有就走降级：递归拷贝普通对象 / 数组 / Date / Map / Set（存档和参数表都是纯 JSON 数据，够用）。
 * 制作人追加：另有全局 polyfill（index.html 内联脚本 + platform/polyfills.ts 兜底），所以直接写 structuredClone 也安全；
 * 仓库代码仍统一用 deepClone（Node 校验脚本里不经过 main.ts 也能用）。
 * batch27 第 2 项：降级实现只有一份——structuredClonePolyfill.js，index.html 内联脚本由 vite 插件从它生成。
 */
import { cloneFallback } from './structuredClonePolyfill.js';

export function deepClone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (typeof sc === 'function') return sc(value);
  return cloneFallback(value, new Map());
}

/** 无 structuredClone 时的降级（batch27：唯一实现在 structuredClonePolyfill.js，index.html 内联的也是它；导出给单测直接比对） */
export { cloneFallback };
