/**
 * 抽象 action 层（GDD §3）：玩法代码只认 action，不关心来自键盘、鼠标还是以后的手柄。
 * 同一个物理按键在不同「输入上下文」（见 InputContext.ts）映射到不同 action：
 *   E 在 explore = interact，在 puzzle = partNext；右键在 explore = observe（按住），在 puzzle/reading = exitPuzzle。
 *
 * 新增操作：1) 在 ButtonAction 加名字；2) 在 GLOBAL_BINDINGS 或 CONTEXTS[ctx].buttons 里配键位。
 * 以后接手柄：只要再加一个输入源，把手柄按键写成 'Pad0' 之类的原始码，在这里配绑定即可。
 *
 * 原始输入码：键盘用 KeyboardEvent.code（与键盘布局无关）；鼠标按键 'Mouse0' 左键 / 'Mouse1' 中键 / 'Mouse2' 右键；
 * 滚轮每滚一格产生一次 'WheelUp' / 'WheelDown' 按下（连续值另见 InputManager.getZoomDelta）。
 *
 * 注意浏览器限制（制作人裁定，docs/releases/v0.1.md）：指针锁定时 Esc 由浏览器先处理（解锁），
 * 页面不一定收到 keydown，解锁后约 1 秒内不能重新锁定。所以 Esc 一律 = 暂停；退出机关 / 关闭阅读用右键或 Tab。
 */
export type ButtonAction =
  /** Shift 按住小跑（explore） */
  | 'sprint'
  /** E 交互（explore） */
  | 'interact'
  /** Q / 滚轮上：机关模式切换到上一个部件 */
  | 'partPrev'
  /** E / 滚轮下：机关模式切换到下一个部件 */
  | 'partNext'
  /** 鼠标右键按住：观察（拉近 + 景深，explore） */
  | 'observe'
  /** 鼠标右键单击 / Tab：退出机关、关闭阅读（puzzle / reading） */
  | 'exitPuzzle'
  /** Shift 按住：机关精调（puzzle，与 sprint 同键，按上下文区分） */
  | 'fineAdjust'
  /** R：重置当前机关（puzzle） */
  | 'resetPuzzle'
  /** H：提示 */
  | 'hint'
  /** J：日志 */
  | 'journal'
  /** Esc：暂停（全局，任何上下文） */
  | 'pause'
  /** 鼠标左键 / Space：推进字幕 */
  | 'advance'
  /** 按住 Space 1 秒：跳过演出（cutscene；按住满 HOLD_SECONDS 才算一次「按下」） */
  | 'skipHold'
  /** F3：显示/隐藏帧率（仅开发模式或 ?debug=1） */
  | 'toggleFps'
  /** F4：开发调试面板（当前上下文、最近 action、速度等；仅开发模式或 ?debug=1） */
  | 'toggleDebug';

export type AxisAction = 'moveX' | 'moveY';

export type InputContextName = 'explore' | 'puzzle' | 'reading' | 'cutscene' | 'menu';

/** 指针模式：locked = 指针锁定、鼠标移动直接转视角；free = 显示光标（阅读、菜单） */
export type CursorMode = 'locked' | 'free';

export interface ContextBindings {
  /** 该上下文里有效的按钮 action → 原始码 */
  buttons: Partial<Record<ButtonAction, readonly string[]>>;
  /** WASD / 方向键轴是否有效（explore 移动；puzzle 里 A/D 旋转机关） */
  axes: boolean;
  /** 鼠标移动是否产生视角增量（explore 转视角；puzzle 旋转机关/小范围转镜头） */
  look: boolean;
  /** 连续滚轮值的用途：zoom = 相机距离（explore）；none = 不提供（puzzle 里滚轮走 partPrev/partNext） */
  wheel: 'zoom' | 'none';
  cursor: CursorMode;
}

/** 全局绑定：任何上下文（包括暂停菜单）都有效 */
export const GLOBAL_BINDINGS: Partial<Record<ButtonAction, readonly string[]>> = {
  pause: ['Escape'],
  toggleFps: ['F3'],
  toggleDebug: ['F4'],
};

const SHIFT = ['ShiftLeft', 'ShiftRight'] as const;

export const CONTEXTS: Record<InputContextName, ContextBindings> = {
  explore: {
    buttons: {
      sprint: SHIFT,
      interact: ['KeyE'],
      observe: ['Mouse2'],
      hint: ['KeyH'],
      journal: ['KeyJ'],
      advance: ['Mouse0', 'Space'],
    },
    axes: true,
    look: true,
    wheel: 'zoom',
    cursor: 'locked',
  },
  puzzle: {
    buttons: {
      partPrev: ['KeyQ', 'WheelUp'],
      partNext: ['KeyE', 'WheelDown'],
      exitPuzzle: ['Mouse2', 'Tab'],
      fineAdjust: SHIFT,
      resetPuzzle: ['KeyR'],
      hint: ['KeyH'],
      advance: ['Space'],
    },
    axes: true,
    look: true,
    wheel: 'none',
    cursor: 'locked',
  },
  reading: {
    buttons: {
      exitPuzzle: ['Mouse2', 'Tab'],
      advance: ['Mouse0', 'Space'],
    },
    axes: false,
    look: false,
    wheel: 'none',
    cursor: 'free',
  },
  cutscene: {
    buttons: {
      advance: ['Mouse0', 'Space'],
      skipHold: ['Space'],
    },
    axes: false,
    look: false,
    wheel: 'none',
    cursor: 'locked',
  },
  menu: {
    buttons: {},
    axes: false,
    look: false,
    wheel: 'none',
    cursor: 'free',
  },
};

/** 需要「按住满 N 秒」才触发一次按下的 action */
export const HOLD_SECONDS: Partial<Record<ButtonAction, number>> = {
  skipHold: 1.0,
};

/** 方向键绑定：正/负方向。moveY 正值 = 向前（puzzle 里 moveX 用作 A/D 旋转） */
export const axisBindings: Record<AxisAction, { positive: readonly string[]; negative: readonly string[] }> = {
  moveX: { positive: ['KeyD', 'ArrowRight'], negative: ['KeyA', 'ArrowLeft'] },
  moveY: { positive: ['KeyW', 'ArrowUp'], negative: ['KeyS', 'ArrowDown'] },
};

/** 滚轮多少像素算一格（deltaMode=LINE 按 1 行 ≈ 33px 换算） */
export const WHEEL_NOTCH_PX = 100;

/** 所有上下文里出现过的原始码（用来决定 keydown 是否 preventDefault，比如 Tab 不让焦点跑掉） */
export function allBoundCodes(): Set<string> {
  const set = new Set<string>();
  const add = (b: Partial<Record<ButtonAction, readonly string[]>>): void => {
    for (const codes of Object.values(b)) for (const c of codes ?? []) set.add(c);
  };
  add(GLOBAL_BINDINGS);
  for (const ctx of Object.values(CONTEXTS)) add(ctx.buttons);
  for (const b of Object.values(axisBindings)) for (const c of [...b.positive, ...b.negative]) set.add(c);
  return set;
}

/** 某上下文下，某原始码对应的 action（含全局绑定） */
export function actionsForCode(ctx: InputContextName, code: string): ButtonAction[] {
  const out: ButtonAction[] = [];
  for (const [a, codes] of Object.entries(GLOBAL_BINDINGS) as Array<[ButtonAction, readonly string[]]>) {
    if (codes.includes(code)) out.push(a);
  }
  for (const [a, codes] of Object.entries(CONTEXTS[ctx].buttons) as Array<[ButtonAction, readonly string[]]>) {
    if (codes.includes(code)) out.push(a);
  }
  return out;
}

/** 某上下文下 action 绑定的原始码（含全局） */
export function codesForAction(ctx: InputContextName, action: ButtonAction): readonly string[] {
  return [...(GLOBAL_BINDINGS[action] ?? []), ...(CONTEXTS[ctx].buttons[action] ?? [])];
}
