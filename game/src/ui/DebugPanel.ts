import type { Game } from '@/core/Game';

/** 每帧可以往调试面板里塞几行（速度、相机对齐、碰撞耗时等），key 相同则覆盖 */
export type DebugLines = Map<string, string>;

/**
 * 开发调试面板（F4，仅开发模式或 ?debug=1）：显示输入上下文栈、指针模式、最近触发的 action，
 * 以及各系统通过 `game.ui.debug.set(key, text)` 写入的数值。
 */
export class DebugPanel {
  readonly lines: DebugLines = new Map();
  private el: HTMLDivElement;
  private game: Game;
  private accum = 0;
  visible = false;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'debug-panel';
    this.el.setAttribute('data-ui', '');
    this.el.style.cssText =
      'position:absolute;right:8px;top:8px;z-index:50;min-width:220px;padding:8px 10px;' +
      'font:12px/1.45 ui-monospace,monospace;color:#d8e2e8;background:rgba(8,12,16,.72);' +
      'border-radius:6px;pointer-events:none;white-space:pre;display:none;';
    root.appendChild(this.el);
  }

  set(key: string, text: string): void {
    this.lines.set(key, text);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.accum += dt;
    if (this.accum < 0.1) return;
    this.accum = 0;
    const input = this.game.input;
    const now = performance.now() / 1000;
    const rows = [
      `上下文  ${input.contextStack.join(' > ')}`,
      `指针    ${input.cursorMode}${document.pointerLockElement ? '（已锁定）' : ''}`,
      `灵敏度  ${input.lookSensitivity.toFixed(2)} ×${input.lookScale}${input.invertY ? '  Y反转' : ''}`,
      '最近 action：',
      ...input.recent.map((e) => `  ${(now - e.t).toFixed(1).padStart(5)}s  ${e.context}: ${e.action} (${e.code})`),
    ];
    for (const [k, v] of this.lines) rows.push(`${k}  ${v}`);
    this.el.textContent = rows.join('\n');
  }

  dispose(): void {
    this.el.remove();
  }
}
