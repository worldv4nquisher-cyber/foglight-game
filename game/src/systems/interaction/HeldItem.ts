import type * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';

/**
 * 手持物（v0.1-004；v0.1 只有风灯一种，谜题 3）：同一时间最多拿一个。
 * 拾起 = 把物体挂到角色手部节点；放下 = 挂到指定 `-socket` 节点原点（只能放在 socket 上）。
 * 记录每个 socket 上放的是什么，谜题逻辑监听 item:pickup / item:place 判断光路。
 */
export class HeldItem {
  /** 当前拿着的手持物 ID 与物体 */
  current: { id: string; object: THREE.Object3D } | null = null;
  /** socket 名 → 上面放的手持物 ID */
  readonly sockets = new Map<string, string>();
  private readonly hand: THREE.Object3D;
  private readonly events: EventBus;
  /** 手持物 → 它当前所在的 socket（从 socket 上拾起时清掉） */
  private readonly itemSocket = new Map<string, THREE.Object3D>();

  constructor(hand: THREE.Object3D, events: EventBus) {
    this.hand = hand;
    this.events = events;
  }

  get holding(): boolean {
    return this.current !== null;
  }

  isHolding(id: string): boolean {
    return this.current?.id === id;
  }

  /** socket 上是否空着 */
  socketFree(socket: THREE.Object3D): boolean {
    return !this.sockets.has(socket.name);
  }

  /** 场景初始化：某手持物一开始就放在某个 socket 上 */
  setPlaced(id: string, object: THREE.Object3D, socket: THREE.Object3D): void {
    socket.add(object);
    object.position.set(0, 0, 0);
    object.quaternion.identity();
    object.updateMatrixWorld(true);
    this.sockets.set(socket.name, id);
    this.itemSocket.set(id, socket);
  }

  pickUp(id: string, object: THREE.Object3D): boolean {
    if (this.current) return false;
    const from = this.itemSocket.get(id) ?? null;
    if (from) {
      this.sockets.delete(from.name);
      this.itemSocket.delete(id);
    }
    this.hand.add(object);
    object.position.set(0, 0, 0);
    object.quaternion.identity();
    object.updateMatrixWorld(true);
    this.current = { id, object };
    this.events.emit('item:pickup', { item: id, from: from?.name ?? null });
    return true;
  }

  place(socket: THREE.Object3D): boolean {
    const cur = this.current;
    if (!cur || !this.socketFree(socket)) return false;
    socket.add(cur.object);
    cur.object.position.set(0, 0, 0);
    cur.object.quaternion.identity();
    cur.object.updateMatrixWorld(true);
    this.sockets.set(socket.name, cur.id);
    this.itemSocket.set(cur.id, socket);
    this.current = null;
    this.events.emit('item:place', { item: cur.id, socket: socket.name });
    return true;
  }
}
