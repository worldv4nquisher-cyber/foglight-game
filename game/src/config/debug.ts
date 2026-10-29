/**
 * 开发调试开关：开发服务器（vite dev）或 URL 带 ?debug=1 时开启。
 * 开启后：F3 帧率、F4 调试面板（输入上下文 / 最近 action / 速度等）、window.__game。
 * 写法兼容 Node 校验脚本（Node 里没有 import.meta.env / location）。
 */
const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;

export const isDev: boolean = env?.DEV ?? false;

export const debugEnabled: boolean =
  isDev || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'));

/** ?beamDebug=1：画出光线、镜面法线与接收器半径（v0.1-012；只读 URL，不需要 debug=1） */
export const beamDebugEnabled: boolean =
  typeof location !== 'undefined' && ['1', 'true', ''].includes(new URLSearchParams(location.search).get('beamDebug') ?? 'x');
