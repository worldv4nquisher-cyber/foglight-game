/**
 * 开发调试开关：开发服务器（vite dev）默认开；测试构建（vite build --mode smoke）里 URL 带 ?debug=1 时开。
 * 开启后：F3 详细面板、F4 调试面板（输入上下文 / 最近 action / 速度等）、?scene=sandbox。
 * batch26：生产构建（mode production）里 ?debug=1 和 ?scene= 直进场景都不存在——下面的 TEST_BUILD 是构建期常量 false，
 * 读 URL 的代码整段被摇树删掉（npm run verify:prod-hooks 断言 dist 里没有读 debug / scene 参数的代码）。
 * 写法兼容 Node 校验脚本（Node 里没有 import.meta.env / location）。
 */
const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;

export const isDev: boolean = env?.DEV ?? false;

/** 开发服务器或测试构建（--mode smoke，见 scripts/lib/test-server.mjs）。生产构建里是常量 false；Node 里 false */
export const TEST_BUILD: boolean = typeof import.meta.env === 'undefined' ? false : import.meta.env.DEV || import.meta.env.MODE === 'smoke';

export const debugEnabled: boolean =
  TEST_BUILD && (isDev || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')));

/**
 * batch26：?smoke=1（冒烟 / 截图 / 量测脚本带的参数）也只在开发服务器 / 测试构建里认。生产构建里恒为 false，
 * 下面四处依赖它的行为（默认关美术、帧率面板详细模式、?hintScale、S3 ?father= 预览）连同读参数的代码一起被摇树删掉。
 */
export const smokeQuery: boolean = TEST_BUILD && typeof location !== 'undefined' && new URLSearchParams(location.search).has('smoke');

/** batch26：?scene=s1|s2|s3|sandbox|testbed 直进场景，只在开发服务器 / 测试构建里读（生产构建里恒为 null） */
export const sceneParam: string | null = TEST_BUILD && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scene') : null;

/** ?beamDebug=1：画出光线、镜面法线与接收器半径（v0.1-012；只读 URL，不需要 debug=1） */
export const beamDebugEnabled: boolean =
  typeof location !== 'undefined' && ['1', 'true', ''].includes(new URLSearchParams(location.search).get('beamDebug') ?? 'x');

/**
 * 美术资源开关（v0.1-013）：清单里 `art: true` 的条目（../art 交付的 GLB / KTX2）是否加载。
 * - 默认加载；`?art=0` 不加载（只看白盒，等同美术没交付）。
 * - 冒烟测试（?smoke=1，只在 dev / 测试构建里认，batch26）默认不加载：无头 SwiftShader 下 S1 美术 LOD0 近 300 万面，一帧要数秒，会拖垮所有交互检查；
 *   专门的美术检查用 `?smoke=1&art=1` 打开。
 * - `?greybox=1`：美术加载时也显示白盒几何（对位用）。
 */
export const artEnabled: boolean = (() => {
  if (typeof location === 'undefined') return true;
  const q = new URLSearchParams(location.search);
  const v = q.get('art');
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true' || v === '') return true;
  return !smokeQuery;
})();

export const greyboxVisible: boolean = typeof location !== 'undefined' && ['1', 'true', ''].includes(new URLSearchParams(location.search).get('greybox') ?? 'x');

/**
 * v0.1-029 光照贴图开关：`?lightmap=0` 不挂（对比截图 / 排查用，走原来的半球光）。默认开。
 */
export const lightmapEnabled: boolean = typeof location === 'undefined' || !['0', 'false'].includes(new URLSearchParams(location.search).get('lightmap') ?? 'x');

/**
 * BUG-030 对比开关：`?rampfix=0` 模拟修前——KTX2 不按宽高分流（256×1 的 ramp 也走 BC7 / BC3 压缩上传 → 0x502、采样为 0），
 * ramp 保留整条 mip 链和 LinearMipmapLinear。只给前后对比截图用，默认开（修后）。
 */
export const rampFixEnabled: boolean = typeof location === 'undefined' || !['0', 'false'].includes(new URLSearchParams(location.search).get('rampfix') ?? 'x');

/** v0.1-023 角色外扩描边开关：`?hull=0` 不挂（对比截图用）。默认开。 */
export const outlineHullEnabled: boolean = typeof location === 'undefined' || !['0', 'false'].includes(new URLSearchParams(location.search).get('hull') ?? 'x');

/**
 * r4 第 6 项肤色对比（只给截图 / 制作人看，默认值不变）：
 * - `?xiShadow=warm`：汐的暗部色换成暖色 XI_SHADOW_TINT_WARM（默认冷色 XI_SHADOW_TINT）
 * - `?lutKeepSat=0.5`：LUT 之后把色度往 LUT 之前拉回这个比例（亮度仍用 LUT 的；0 = 原样，整帧生效，不只皮肤）
 */
const q0 = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
export const xiShadowWarm: boolean = q0?.get('xiShadow') === 'warm';
export const lutKeepSat: number = (() => {
  const v = Number(q0?.get('lutKeepSat') ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
})();
