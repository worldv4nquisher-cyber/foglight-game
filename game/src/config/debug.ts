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

/**
 * 美术资源开关（v0.1-013）：清单里 `art: true` 的条目（../art 交付的 GLB / KTX2）是否加载。
 * - 默认加载；`?art=0` 不加载（只看白盒，等同美术没交付）。
 * - 冒烟测试（?smoke=1）默认不加载：无头 SwiftShader 下 S1 美术 LOD0 近 300 万面，一帧要数秒，会拖垮所有交互检查；
 *   专门的美术检查用 `?smoke=1&art=1` 打开。
 * - `?greybox=1`：美术加载时也显示白盒几何（对位用）。
 */
export const artEnabled: boolean = (() => {
  if (typeof location === 'undefined') return true;
  const q = new URLSearchParams(location.search);
  const v = q.get('art');
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true' || v === '') return true;
  return !q.has('smoke');
})();

export const greyboxVisible: boolean = typeof location !== 'undefined' && ['1', 'true', ''].includes(new URLSearchParams(location.search).get('greybox') ?? 'x');

/**
 * v0.1-029 光照贴图开关：`?lightmap=0` 不挂（对比截图 / 排查用，走原来的半球光）。默认开。
 */
export const lightmapEnabled: boolean = typeof location === 'undefined' || !['0', 'false'].includes(new URLSearchParams(location.search).get('lightmap') ?? 'x');

/** v0.1-023 角色外扩描边开关：`?hull=0` 不挂（对比截图用）。默认开。 */
export const outlineHullEnabled: boolean = typeof location === 'undefined' || !['0', 'false'].includes(new URLSearchParams(location.search).get('hull') ?? 'x');

