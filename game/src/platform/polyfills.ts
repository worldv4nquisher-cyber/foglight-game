/**
 * batch26 ②（制作人追加）：structuredClone 全局 polyfill 的模块版（兜底）。真正最早装的是 index.html 里的内联脚本
 * （普通脚本先于所有 type="module" 执行；生产构建里 three / vendor 分包会先于入口模块求值，入口里的 import 赶不上它们）。
 * 这里是 main.ts 的第一个 import，内联脚本没跑（index.html 被改坏等）时再装一次；已有就不动。
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
