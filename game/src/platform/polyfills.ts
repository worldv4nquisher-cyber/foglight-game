/**
 * batch26 ②（制作人追加）：全局 polyfill，main.ts 的第一个 import（副作用 import），
 * ES 模块按 import 顺序深度优先求值，所以它在其余所有模块（含第三方库）求值之前装好。
 * Safari 15.0–15.3（及更老的 WebView）没有 structuredClone（15.4 才有）：补一个只拷数据的版本
 * （普通对象 / 数组 / Date / Map / Set / 环引用，见 clone.ts 的 cloneFallback；存档和参数表都是纯 JSON 数据，够用）。
 * 有原生的不覆盖。transfer 选项不支持（全仓没人用）。
 */
import { cloneFallback } from './clone';

/** 没有原生 structuredClone 时装上降级版；返回是否装了（单测用） */
export function installStructuredClonePolyfill(target: { structuredClone?: unknown } = globalThis): boolean {
  if (typeof target.structuredClone === 'function') return false;
  Object.defineProperty(target, 'structuredClone', {
    value: function structuredClone<T>(value: T): T {
      return cloneFallback(value);
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return true;
}

installStructuredClonePolyfill();
