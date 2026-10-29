import { TEXT_META, TEXT_ZH_CN, type TextMeta, type TextSpeaker, type TextType } from './zh-CN';

/**
 * 文本表入口（docs/gdd/text-ch1.md）。代码里只写文本 ID，显示文字一律从这里取。
 * zh-CN.ts 由 scripts/import-text.mjs 从 docs/gdd/text-ch1.json 生成；TextId 是表里全部 ID 的联合类型，
 * 写错 ID 在 typecheck 就会报错（动态拼出来的 ID 用 isTextId 判断）。
 */
export type TextId = keyof typeof TEXT_ZH_CN;
export type { TextMeta, TextSpeaker, TextType };

const table: Record<string, string | readonly string[]> = TEXT_ZH_CN;

export function isTextId(id: string): id is TextId {
  return Object.prototype.hasOwnProperty.call(table, id);
}

/** 占位符 {name} → vars.name（text-ch1.md §0：如 {time}） */
function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** 单条文本；多页文档返回各页用空行连接 */
export function t(id: TextId, vars?: Record<string, string | number>): string {
  const v = table[id];
  if (v === undefined) return id;
  return fill(typeof v === 'string' ? v : v.join('\n\n'), vars);
}

/** 多页文本（文档 / 日志）；单条文本当作 1 页 */
export function textPages(id: TextId): string[] {
  const v = table[id];
  if (v === undefined) return [id];
  return typeof v === 'string' ? [v] : [...v];
}

export function textMeta(id: TextId): TextMeta {
  return TEXT_META[id];
}
