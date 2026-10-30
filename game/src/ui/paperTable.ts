/**
 * BUG-021：印了表格的纸（ui-paper-logbook，README-030 §2.2）上，正文按纸面的列排，不再一行流水字压竖线。
 *
 * 纸张按 544×672 css（2x 出图）画；在纸图上实测（1088×1344 的竖线 x = 59 / 292 / 356 / 464 / 1030，÷2）：
 *   日期 29.5–146、时 146–178、天气 178–232、记事 232–515（css px，相对 .reader-paper 左沿）。
 * 横线照旧是 y = 71.2 + 32.3·(k+1) − 1.5：正文第 0 行在表格上面（空着），第 1 行是印好的表头（日期 / 时 / 天气 / 记事），
 * 第 2 行起是表格行。.reader-paper 的宽度在 ≥ 632 px 的窗口里恒为 544（min(86vw, 34em)），纸图 100% auto，所以列按 px 定。
 *
 * 文本仍来自 text-ch1（自动生成，不改）：一行一条记录，字段之间是全角空格 U+3000，多出来的「」都归到最后一列（记事）。
 * 正文第一行和文档标题相同时（「值班簿」）不再画——标题只留 .reader-title 一个。
 */
export interface PaperTableSpec {
  /** 列边界（css px，相对 .reader-paper 左沿），n 列 = n+1 个数 */
  readonly edges: readonly number[];
  /** 每列对齐 */
  readonly align: readonly ('start' | 'center')[];
  /** 表头印在正文第几行（这一行留空） */
  readonly headerRow: number;
  /** 字段分隔符 */
  readonly sep: string;
}

export const PAPER_TABLES: Readonly<Record<string, PaperTableSpec>> = {
  'ui-paper-logbook': { edges: [29.5, 146, 178, 232, 515], align: ['start', 'center', 'center', 'start'], headerRow: 1, sep: '\u3000' },
};

/** .reader-body 左内边距（2.4em × 16 px），列坐标换成正文坐标时要减掉 */
export const READER_BODY_LEFT = 38.4;
/** 单元格左右留白（px）：字不贴竖线 */
export const CELL_PAD = 5;
/** 正文字号 / 行高（styles.css .reader-body：17 px × 1.9） */
export const BODY_FONT = 17;
export const BODY_LINE = 17 * 1.9;

export interface TableCell {
  text: string;
  /** 实际字号：一行放不下时缩小，必要时折成两行（仍在一格 32.3 px 行高内） */
  font: number;
  lines: 1 | 2;
}

export interface TableRow {
  /** 'blank' = 空行（标题重复行 / 印好的表头行 / 空行）；'cells' = 按列排；'free' = 不是表格行，整行照旧写 */
  kind: 'blank' | 'cells' | 'free';
  cells: TableCell[];
  text: string;
}

/** 全角字宽估算：CJK / 全角标点 1em，其它（ASCII 数字、空格）0.55em */
export function textEm(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u2E80-\uFFEF\u3000-\u303F]/.test(ch) ? 1 : 0.55;
  return w;
}

/** 一格放得下的字号与行数：先 17 px 一行，不行就缩到不小于 13 px 一行，再不行折两行（行高 ≤ 32.3 / 2 → 字号 ≤ 14） */
export function fitCell(text: string, width: number): TableCell {
  const em = textEm(text);
  const avail = width - 2 * CELL_PAD;
  if (em * BODY_FONT <= avail) return { text, font: BODY_FONT, lines: 1 };
  const one = Math.floor((avail / em) * 10) / 10;
  if (one >= 13) return { text, font: one, lines: 1 };
  const two = Math.min(14, Math.floor((avail / Math.ceil(em / 2)) * 10) / 10);
  return { text, font: two, lines: 2 };
}

export function layoutTable(page: string, title: string | null, spec: PaperTableSpec): TableRow[] {
  const n = spec.edges.length - 1;
  return page.split('\n').map((line, k): TableRow => {
    const text = line.trim();
    if (!text || k === spec.headerRow || (k === 0 && title && text === title.trim())) return { kind: 'blank', cells: [], text: '' };
    const parts = text.split(spec.sep).filter((p) => p.length);
    if (parts.length < 2) return { kind: 'free', cells: [], text };
    const fields = [...parts.slice(0, n - 1), parts.slice(n - 1).join(spec.sep)];
    while (fields.length < n) fields.push('');
    return { kind: 'cells', cells: fields.map((f, i) => fitCell(f, spec.edges[i + 1]! - spec.edges[i]!)), text };
  });
}
