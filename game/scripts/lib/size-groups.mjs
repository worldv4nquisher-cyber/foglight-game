// check-size 用的「art/ 里已交付、还没进清单的运行时资源」按文件名估分组（只提示，不判失败）。
// 独立成模块：check-size.mjs 在没有 dist 时导入即退出，单元测试（verify-assets）从这里直接测规则。
//
// 规则（先匹配先用）：
//   0. mus-menu*（033 主菜单曲）→ menu（036：主菜单包只有 mus-menu 和 UI 音效）；mus-s1-* / mus-s3-* 由 2 / 4 条归 s1 / s3
//   1. char-father* / tex-father-* → s3（父亲只在 S3 灯室出现，031 接入；模型不能被下面的 char-* 吞进常驻包，贴图不能落进 s1）
//   2. 文件名带 -s2 / -s3      → s2 / s3
//   3. char-*（默认）、tex-xi、提灯、机关 / 石墙 / 木纹通用贴图 → common（角色默认常驻）
//   4. 其余                    → s1
/** 只出现在某一场景的角色：前缀 → 分组 */
export const CHAR_SCENE = Object.freeze({ 'char-father': 's3', 'tex-father': 's3' });

export function guessGroup(name) {
  if (/^mus-menu([.-]|$)/.test(name)) return 'menu';
  for (const [prefix, g] of Object.entries(CHAR_SCENE)) if (name === prefix || name.startsWith(`${prefix}-`) || name.startsWith(`${prefix}.`)) return g;
  if (/-s2\b|-s2-|-s2\./.test(name)) return 's2';
  if (/-s3\b|-s3-|-s3\./.test(name)) return 's3';
  if (/^(char-|tex-xi|prop-lantern-brass|tex-props-puzzle|tex-stone-masonry|tex-wood)/.test(name)) return 'common';
  return 's1';
}
