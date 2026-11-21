import type * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import { t } from '@/content/text';
import type { InputManager } from '@/systems/input/InputManager';
import type { Highlighter } from './Highlight';
import type { RotatablePart } from './RotatablePart';

/** 一个机关组：1–N 个可旋转部件 + 机位（`-cam` 空节点） */
export class PuzzleGroup {
  readonly id: string;
  readonly parts: readonly RotatablePart[];
  readonly camNode: THREE.Object3D;
  index = 0;

  constructor(opts: { id: string; parts: RotatablePart[]; camNode: THREE.Object3D }) {
    if (opts.parts.length === 0) throw new Error(`机关组 ${opts.id} 没有部件`);
    this.id = opts.id;
    this.parts = opts.parts;
    this.camNode = opts.camNode;
  }

  get current(): RotatablePart {
    return this.parts[this.index] ?? (this.parts[0] as RotatablePart);
  }

  /** 全部部件回到初始角度 */
  reset(): void {
    for (const p of this.parts) p.reset();
  }
}

/** 机关模式用到的相机接口（CameraFollowSystem 满足） */
export interface PuzzleCamera {
  enterPuzzleView(node: THREE.Object3D, opts?: { freeLook?: boolean }): void;
  exitPuzzleView(): void;
}

export interface PuzzleBarHud {
  setPuzzleBar(text: string | null): void;
}

/** 底部按键提示条按当前部件的轴与档位显示。 */
export function puzzleBarText(partCount: number, part?: RotatablePart, index = 0): string {
  const dial = part?.axes[0]?.axis === 'z';
  const full = t(dial ? 'ui.prompt.puzzle_bar_dial' : 'ui.prompt.puzzle_bar');
  const bar = full
    .split('　')
    .filter((seg) => (partCount > 1 || !/Q·E/.test(seg)) && (part?.dualAxis || !/W·S/.test(seg)) && (!part || part.fineStepDeg !== part.stepDeg || !/Shift/.test(seg)))
    .join('　');
  return partCount > 1 ? `${bar}\u3000${index + 1}/${partCount}` : bar;
}

interface KeyRepeat {
  dir: 0 | 1 | -1;
  t: number;
}

/**
 * 机关操作模式（v0.1-004）：
 * - 进入：压 puzzle 输入上下文、相机到机位（鼠标被用来转部件，所以机位不能自由转）、显示底部按键提示条、当前部件微弱描边。
 * - 鼠标左右（双轴时上下控制第二轴）或 A/D（W/S）旋转，按档吸附（15°，Shift 7.5°），每档发 puzzle:partRotated。
 * - Q / E / 滚轮切换部件；R 全组复位；右键 / Tab 退出；Esc 暂停（暂停菜单压在 puzzle 上，继续后仍在机关里）。
 * 在场景 update（每帧）里调用 update：鼠标增量按帧累计。
 */
export class PuzzleMode {
  active: PuzzleGroup | null = null;
  private pop: (() => void) | null = null;
  private accX = 0;
  private accY = 0;
  private keyX: KeyRepeat = { dir: 0, t: 0 };
  private keyY: KeyRepeat = { dir: 0, t: 0 };
  private readonly input: InputManager;
  private readonly events: EventBus;
  private readonly camera: PuzzleCamera;
  private readonly highlighter: Highlighter;
  private readonly hud: PuzzleBarHud;
  private readonly actor: THREE.Object3D | undefined;
  private actorVisible: boolean | null = null;
  /** 退出时回调（InteractionSystem 用来解锁角色） */
  onExit: (() => void) | null = null;

  constructor(deps: { input: InputManager; events: EventBus; camera: PuzzleCamera; highlighter: Highlighter; hud: PuzzleBarHud; actor?: THREE.Object3D }) {
    this.input = deps.input;
    this.events = deps.events;
    this.camera = deps.camera;
    this.highlighter = deps.highlighter;
    this.hud = deps.hud;
    this.actor = deps.actor;
  }

  enter(group: PuzzleGroup): void {
    if (this.active) this.exit();
    this.active = group;
    if (this.actor) {
      this.actorVisible = this.actor.visible;
      this.actor.visible = false;
    }
    this.pop = this.input.pushContext('puzzle');
    this.camera.enterPuzzleView(group.camNode, { freeLook: false });
    this.hud.setPuzzleBar(puzzleBarText(group.parts.length, group.current, group.index));
    this.accX = this.accY = 0;
    this.keyX = { dir: 0, t: 0 };
    this.keyY = { dir: 0, t: 0 };
    this.markCurrent();
    this.events.emit('puzzle:enter', { group: group.id });
  }

  exit(): void {
    const g = this.active;
    if (!g) return;
    this.unmark(g);
    this.active = null;
    if (this.actor && this.actorVisible !== null) this.actor.visible = this.actorVisible;
    this.actorVisible = null;
    this.pop?.();
    this.pop = null;
    this.camera.exitPuzzleView();
    this.hud.setPuzzleBar(null);
    this.events.emit('puzzle:exit', { group: g.id });
    this.onExit?.();
  }

  select(index: number): void {
    const g = this.active;
    if (!g) return;
    const n = g.parts.length;
    const i = ((index % n) + n) % n;
    if (i === g.index) return;
    this.unmark(g);
    g.index = i;
    this.hud.setPuzzleBar(puzzleBarText(g.parts.length, g.current, g.index));
    this.markCurrent();
    this.events.emit('puzzle:partSelected', { group: g.id, part: g.current.id, index: i });
  }

  /** 当前部件转一档（键盘 / 鼠标 / 测试共用） */
  rotate(axis: number, dir: 1 | -1, fine = false): boolean {
    const g = this.active;
    if (!g) return false;
    const part = g.current;
    if (axis >= part.axes.length) return false;
    if (!part.step(axis, dir, fine)) return false;
    this.events.emit('puzzle:partRotated', {
      group: g.id,
      part: part.id,
      axis,
      angle: part.angles[axis] ?? 0,
      angles: [...part.angles],
      fine,
    });
    return true;
  }

  reset(): void {
    const g = this.active;
    if (!g) return;
    g.reset();
    this.events.emit('puzzle:reset', { group: g.id });
  }

  update(dt: number): void {
    const g = this.active;
    const input = this.input;
    // 暂停时 menu 压在 puzzle 上：什么都不做，继续后接着在机关里
    if (!g || input.context !== 'puzzle') return;
    if (input.consumePressed('exitPuzzle')) {
      this.exit();
      return;
    }
    if (input.consumePressed('partPrev')) this.select(g.index - 1);
    if (input.consumePressed('partNext')) this.select(g.index + 1);
    if (input.consumePressed('resetPuzzle')) this.reset();
    const fine = input.isDown('fineAdjust');
    const cfg = gameplay.puzzle;
    const dual = g.current.dualAxis;

    // 鼠标：累计到一档的量才转（右 = 正方向；双轴时上下 = 第二轴，上 = 正）
    const look = input.getLookDelta();
    this.accX += look.x;
    this.accY += dual ? -look.y : 0;
    while (Math.abs(this.accX) >= cfg.mouseStepRad) {
      const dir = this.accX > 0 ? 1 : -1;
      this.accX -= dir * cfg.mouseStepRad;
      this.rotate(0, dir, fine);
    }
    while (Math.abs(this.accY) >= cfg.mouseStepRad) {
      const dir = this.accY > 0 ? 1 : -1;
      this.accY -= dir * cfg.mouseStepRad;
      this.rotate(1, dir, fine);
    }

    // 键盘：按下转一档，按住连发
    const ax = input.getAxis('moveX');
    const ay = dual ? input.getAxis('moveY') : 0;
    this.keyStep(this.keyX, ax, 0, dt, fine);
    this.keyStep(this.keyY, ay, 1, dt, fine);
  }

  private keyStep(k: KeyRepeat, value: number, axis: number, dt: number, fine: boolean): void {
    const dir: 0 | 1 | -1 = value > 0.5 ? 1 : value < -0.5 ? -1 : 0;
    if (dir === 0) {
      k.dir = 0;
      return;
    }
    if (dir !== k.dir) {
      k.dir = dir;
      k.t = gameplay.puzzle.keyRepeatDelay;
      this.rotate(axis, dir, fine);
      return;
    }
    k.t -= dt;
    if (k.t <= 0) {
      k.t += gameplay.puzzle.keyRepeatInterval;
      this.rotate(axis, dir, fine);
    }
  }

  private markCurrent(): void {
    const g = this.active;
    if (!g) return;
    this.highlighter.add(partKey(g, g.current), g.current.node, 'part');
  }

  private unmark(g: PuzzleGroup): void {
    for (const p of g.parts) this.highlighter.remove(partKey(g, p));
  }
}

function partKey(g: PuzzleGroup, p: RotatablePart): string {
  return `puzzle:${g.id}:${p.id}`;
}
