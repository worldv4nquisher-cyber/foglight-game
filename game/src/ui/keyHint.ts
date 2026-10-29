/**
 * 文本表里的按键提示（如 ui.hud.controls「W A S D 移动 / Shift 小跑 / …」，段间为全角空格）→ HUD 用的 HTML（BUG-005）。
 * 约定（text-ch1 ui.hud.controls 备注）：用全角空格（U+3000）分段；每段最后一个词是说明，前面空格分开的词各显示成一个按键框。
 * 文字全部转义，文本表里写 < > & 也不会变成标签。
 */
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function keyHintHtml(text: string): string {
  return text
    .split('\u3000')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const words = seg.split(/\s+/);
      if (words.length < 2) return esc(seg);
      const label = words.pop()!;
      return words.map((k) => `<kbd>${esc(k)}</kbd>`).join('') + ' ' + esc(label);
    })
    .join('\u3000');
}
