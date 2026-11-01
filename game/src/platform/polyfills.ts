/**
 * batch26 ②（制作人追加）：structuredClone 全局 polyfill 的模块版（兜底）。真正最早装的是 index.html 里的内联脚本
 * （普通脚本先于所有 type="module" 执行；生产构建里 three / vendor 分包会先于入口模块求值，入口里的 import 赶不上它们）。
 * 这里是 main.ts 的第一个 import，内联脚本没跑（index.html 被改坏等）时再装一次；已有就不动。
 * batch27 第 2 项：实现只有一份——structuredClonePolyfill.js（index.html 内联脚本由 vite 插件从同一文件生成）。
 */
import { installStructuredClonePolyfill as install } from './structuredClonePolyfill.js';

/** 没有原生 structuredClone 时装上降级版；返回是否装了（单测用） */
export function installStructuredClonePolyfill(target: { structuredClone?: unknown } = globalThis): boolean {
  return install(target);
}

installStructuredClonePolyfill();
