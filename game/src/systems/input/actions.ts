/**
 * 抽象 action 层：玩法代码只认这些 action，不关心来自键盘、鼠标还是触屏。
 * 新增操作：1) 在此加 action 名；2) 在 bindings 里配键位；3) 触屏需要时在 TouchInput 加按钮。
 */
export type ButtonAction = 'jump' | 'pause' | 'interact' | 'sprint' | 'toggleFps';
export type AxisAction = 'moveX' | 'moveY';

/** 键盘绑定（KeyboardEvent.code，与键盘布局无关） */
export const keyBindings: Record<ButtonAction, readonly string[]> = {
  jump: ['Space'],
  pause: ['Escape', 'KeyP'],
  interact: ['KeyE'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  toggleFps: ['F3'],
};

/** 方向键绑定：正/负方向。moveY 正值 = 向前 */
export const axisBindings: Record<AxisAction, { positive: readonly string[]; negative: readonly string[] }> = {
  moveX: { positive: ['KeyD', 'ArrowRight'], negative: ['KeyA', 'ArrowLeft'] },
  moveY: { positive: ['KeyW', 'ArrowUp'], negative: ['KeyS', 'ArrowDown'] },
};
