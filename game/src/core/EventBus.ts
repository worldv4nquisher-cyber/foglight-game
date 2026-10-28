/**
 * 类型安全的事件总线。事件名与负载类型在 GameEvents 中集中声明，
 * 新增事件只需扩展该接口（可在业务模块里用 declaration merging）。
 */
import type { QualityTier } from '@/config/quality';

export interface GameEvents {
  'game:pause': { reason: 'user' | 'visibility' | 'pointerlock' | 'system' };
  'game:resume': undefined;
  'scene:change': { from: string | null; to: string };
  'assets:progress': { loaded: number; total: number; ratio: number; url?: string };
  'assets:complete': { missing: string[] };
  'quality:change': { tier: QualityTier };
  'viewport:resize': { width: number; height: number; pixelRatio: number };
  'ui:toggle-fps': { visible: boolean };
  'player:land': { impactSpeed: number };
  /** 自动跨越开始 / 结束（v0.1-002 TraversalLink） */
  'player:traverse': { phase: 'start' | 'end' };
  /** 强制送回（teleportTo）瞬移的那一刻 */
  'player:teleport': { x: number; y: number; z: number };
}

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
