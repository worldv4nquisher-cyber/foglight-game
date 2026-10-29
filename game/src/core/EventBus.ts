/**
 * 类型安全的事件总线。事件名与负载类型在 GameEvents 中集中声明，
 * 新增事件只需扩展该接口（可在业务模块里用 declaration merging）。
 */
import type { QualityChangeSource, QualityTier } from '@/config/quality';

export interface GameEvents {
  'game:pause': { reason: 'user' | 'visibility' | 'pointerlock' | 'system' };
  'game:resume': undefined;
  'scene:change': { from: string | null; to: string };
  'assets:progress': { loaded: number; total: number; ratio: number; url?: string };
  'assets:complete': { missing: string[] };
  /** 画质档位运行时切换（v0.1-009）：收到后重建阴影贴图 / 渲染目标等，不重载场景 */
  'quality:changed': { tier: QualityTier; previous: QualityTier; source: QualityChangeSource };
  /** 首次启动的 3 秒画质自动检测完成 */
  'quality:detected': { tier: QualityTier; drops: number; rounds: Array<{ tier: QualityTier; fps: number; simulated: boolean }> };
  'viewport:resize': { width: number; height: number; pixelRatio: number };
  'ui:toggle-fps': { visible: boolean };
  /** 观察模式（右键）开关与焦点距离（PostFX 景深用，026） */
  'camera:observe': { active: boolean; focusDistance: number };
  'player:land': { impactSpeed: number };
  /** 自动跨越开始 / 结束（v0.1-002 TraversalLink） */
  'player:traverse': { phase: 'start' | 'end' };
  /** 强制送回（teleportTo）瞬移的那一刻 */
  'player:teleport': { x: number; y: number; z: number };

  // ---------------------------------------------------------------- 交互（v0.1-004）：谜题逻辑只监听这些事件
  /** 一次交互完成（所有类型；hold 为按满时、push 为到达终点时、puzzle 为进入时） */
  'interact:used': { id: string; kind: InteractKindName };
  /** inspect：显示了一句描述字幕 */
  'interact:inspect': { id: string; textId: string };
  /** read：请求打开阅读界面 */
  'interact:read': { id: string; textId: string };
  /** hold 进度（0–1，每个物理步；松开归零时发 0） */
  'interact:holdProgress': { id: string; progress: number };
  /** push：物体沿轨道移动（t = 0–1） */
  'interact:pushMoved': { id: string; t: number };
  /** push：到达轨道终点卡位，之后不能再推 */
  'interact:pushEnd': { id: string };
  /** 手持物（v0.1 只有风灯） */
  'item:pickup': { item: string; from: string | null };
  'item:place': { item: string; socket: string };
  /** 机关模式 */
  'puzzle:enter': { group: string };
  'puzzle:exit': { group: string };
  'puzzle:partSelected': { group: string; part: string; index: number };
  /** 每转一档（咔哒音效）：angle = 该轴新角度（°），angles = 部件全部轴 */
  'puzzle:partRotated': { group: string; part: string; axis: number; angle: number; angles: number[]; fine: boolean };
  'puzzle:reset': { group: string };
  /** 高亮（提示系统二级提示） */
  'highlight:start': { ids: string[]; seconds: number };
  'highlight:end': { ids: string[] };
  /** 005：文档首次阅读（写入日志）/ 当前目标变化 / 字幕显示与结束 / 阅读界面与日志开关 */
  'journal:updated': { docId: string; entries: string[] };
  'goal:changed': { goal: string | null };
  'subtitle:show': { id: string; duration: number; locked: boolean };
  /** shown = 这一行实际显示了多久（游戏时间，s） */
  'subtitle:hide': { id: string; reason: 'timeout' | 'advance' | 'replaced' | 'clear'; shown: number };
  'reader:open': { docId: string; pages: number };
  'reader:close': { docId: string };
  'journal:open': undefined;
  'journal:close': undefined;
}

/** 交互类型名（与 systems/interaction/Interactable.ts 的 InteractKind 一致；放这里避免 core 依赖 systems） */
export type InteractKindName = 'inspect' | 'read' | 'pickup' | 'place' | 'use' | 'hold' | 'push' | 'puzzle';

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object = GameEvents> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  once<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit<K extends keyof Events>(
    type: K,
    ...args: Events[K] extends undefined ? [] : [payload: Events[K]]
  ): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) {
      (h as Handler<Events[K] | undefined>)(args[0]);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
