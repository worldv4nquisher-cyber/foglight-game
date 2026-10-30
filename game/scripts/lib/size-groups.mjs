// check-size 用的「art/ 里已交付、还没进清单的运行时资源」按文件名估分组（只提示，不判失败）。
// 独立成模块：check-size.mjs 在没有 dist 时导入即退出，单元测试（verify-assets）从这里直接测规则。
//
// 规则（先匹配先用）：
//   0. mus-menu*（033 主菜单曲）→ menu（036：主菜单包只有 mus-menu 和 UI 音效）；mus-ending-*（1031 结尾曲，S3 点燃时起播）→ s3；
//      mus-s1-* / mus-s2-* / mus-s3-* 由 2 / 4 条归 s1 / s2 / s3
//   1. char-father* / tex-father-* → s3（父亲只在 S3 灯室出现，031 接入；模型不能被下面的 char-* 吞进常驻包，贴图不能落进 s1）
//   2. 文件名带 -s2 / -s3      → s2 / s3
//   3. char-*（默认）、tex-xi、提灯、机关 / 石墙 / 木纹通用贴图 → common（角色默认常驻）
//   4. 其余                    → s1
/** 只出现在某一场景的角色：前缀 → 分组 */
export const CHAR_SCENE = Object.freeze({ 'char-father': 's3', 'tex-father': 's3' });

export function guessGroup(name) {
  if (/^mus-menu([.-]|$)/.test(name)) return 'menu';
  if (/^mus-ending([.-]|$)/.test(name)) return 's3';
  for (const [prefix, g] of Object.entries(CHAR_SCENE)) if (name === prefix || name.startsWith(`${prefix}-`) || name.startsWith(`${prefix}.`)) return g;
  if (/-s2\b|-s2-|-s2\./.test(name)) return 's2';
  if (/-s3\b|-s3-|-s3\./.test(name)) return 's3';
  if (/^(char-|tex-xi|prop-lantern-brass|tex-props-puzzle|tex-stone-masonry|tex-wood)/.test(name)) return 'common';
  return 's1';
}

/**
 * 清单条目算进哪个体积桶（033 改，制作人 c0d81c9 反馈）：
 *   lazy 的 audio（场景曲 mus-s1 / s2 / s3 两层、结尾曲 mus-ending-ch1：进场首帧渲染后才 loadAudio）→ 「<group> 进场后懒加载」，不计入首场景包 / 首次总下载
 *   其余（包括 lazy 的 image：纸张 / 结尾插画仍按 030 计入所在组）→ 所在组
 * 返回 { group, lazyAfterEntry }
 */
export function sizeBucket(entry) {
  return { group: entry.group, lazyAfterEntry: entry.type === 'audio' && entry.lazy === true };
}
