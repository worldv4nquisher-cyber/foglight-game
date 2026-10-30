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
  /** GLB / 贴图重试后仍失败、换成了占位（BUG-012） */
  'assets:fallback': { url: string; kind: 'glb' | 'ktx2' };
  /** 画质档位运行时切换（v0.1-009）：收到后重建阴影贴图 / 渲染目标等，不重载场景 */
  'quality:changed': { tier: QualityTier; previous: QualityTier; source: QualityChangeSource };
  /** 首次启动的 3 秒画质自动检测完成 */
  'quality:detected': { tier: QualityTier; drops: number; rounds: Array<{ tier: QualityTier; fps: number; simulated: boolean }> };
  'viewport:resize': { width: number; height: number; pixelRatio: number };
  'ui:toggle-fps': { visible: boolean };
  /** 不可暂停的场景（主菜单 / 章节结束页）里按 Esc：从子界面返回（v0.1-008） */
  'ui:back': undefined;
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
  /** 阅读器翻页（按钮 / 键盘），page 从 0 起 */
  'reader:page': { docId: string; page: number };
  'journal:open': undefined;
  /** 007：提示层级解锁（右下角风灯淡入）/ H 弹窗开关（level = 弹窗打开时已解锁的层级；puzzleId=null 表示不在任何谜题里） */
  'hint:unlocked': { puzzleId: string; level: 1 | 2 | 3 };
  'hint:open': { puzzleId: string | null; level: number; step: string | null };
  'hint:close': undefined;
  'journal:close': undefined;
  /** 011：潮汐开始涨落（state = 目标状态）/ 到位；潮汐钟敲响；浮物状态（搁浅 / 浮起 / 漂回中）；送回 */
  'tide:changing': { zone: string; state: 'high' | 'low'; from: 'high' | 'low' };
  'tide:changed': { zone: string; state: 'high' | 'low' };
  'tide:bell': { id: string; zone: string; state: 'high' | 'low' };
  'tide:recall': { zone: string };
  'float:state': { id: string; state: 'grounded' | 'floating' | 'drifting' };
  /** 音效请求（id = manifest 音频 key；没有资源时场景用合成音兜底，见 systems/tide/tideScene.ts bindSfxFallback） */
  /** optional：文件缺失时静默（不播合成占位音），如 032 补音 sfx-tide-bell-clapper */
  'sfx:play': { id: string; optional?: boolean };
  /** 循环音按名字启停（id 同 sfx:play；同名重复 loop 不叠加；fade 缺省用 gameplay.audio；切场景自动停） */
  'sfx:loop': { id: string; fadeIn?: number; volume?: number };
  'sfx:loopStop': { id: string; fadeOut?: number };
  /** 012 光路：重算完成（ms = 本次耗时）；接收器触发 / 前置条件未满足（红光）/ 光离开后进度归零 */
  'beam:traced': { ms: number; paths: number };
  'receiver:activated': { id: string; emitter: string };
  'receiver:blocked': { id: string; emitter: string };
  'receiver:reset': { id: string };
  /** 015 点火口 manual 模式：连续受光满 holdSec 进入可点灯状态 / 断光超过 graceSec 退出 */
  'receiver:ready': { id: string; emitter: string };
  'receiver:lost': { id: string };
  /** 015 可点灯状态 20 s 没按 E：嗡鸣 + 微光加强一次（每次进入可点灯状态最多一次） */
  'ignition:reminder': { id: string };
  /** 015 点灯（xi-ignite-lever 的 ignite 事件帧，全局只发一次） */
  'lighthouse:ignited': undefined;
  /** 光源开关（lit = 逻辑上亮着，淡入过半算亮）/ 换颜色 / 天光切常亮（谜题 5 开油阀后） */
  'beam:emitter': { id: string; lit: boolean };
  'beam:setColor': { id: string; color: 'warm' | 'coldWhite' };
  'beam:skyAlwaysOn': { id: string; alwaysOn: boolean };
  /** 门等非镜子的状态变化后请求重算光路 */
  'beam:invalidate': undefined;
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
