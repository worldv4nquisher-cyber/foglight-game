import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { InteractKindName } from '@/core/EventBus';
import type { TextId } from '@/content/text';
import { Component } from '@/entities/Component';
import type { PuzzleGroup } from './PuzzleMode';
import { asXiClip, type XiClipName } from '@/entities/xi/clips';

export type InteractKind = InteractKindName;

/** 各类型默认的提示文本（text-ch1.md §8）；use 一般要按物体指定（敲钟 / 开锁 / 打开） */
export const DEFAULT_PROMPT: Record<InteractKind, TextId> = {
  inspect: 'ui.prompt.inspect',
  read: 'ui.prompt.read',
  pickup: 'ui.prompt.pickup',
  place: 'ui.prompt.place',
  use: 'ui.prompt.open',
  hold: 'ui.prompt.turn_hold',
  push: 'ui.prompt.push',
  puzzle: 'ui.prompt.operate',
};

/** push 的轨道：物体从 from 沿直线移动到 to（世界坐标，物体根节点位置） */
export interface PushTrack {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** m/s，默认 gameplay.interaction.pushSpeed = 0.8 */
  speed?: number;
}

export interface InteractableOptions {
  id: string;
  kind: InteractKind;
  /** 物体根节点：焦点（距离 / 夹角 / 屏幕中心判定）取它的包围盒中心，除非给了 focus */
  object: THREE.Object3D;
  /** 提示文本 ID（ui.prompt.*），默认按类型 */
  prompt?: TextId;
  /** inspect：字幕文本；read：文档 ID */
  textId?: TextId;
  /**
   * 角色站位 + 朝向（GLB 的 `-interact` 空节点，+Z 指向物体）。
   * 不给时先在 object 下找名字以 `-interact` 结尾的节点；都没有则取物体前方（+Z）1 m、面向物体。
   */
  interactPoint?: THREE.Object3D;
  /** 焦点（不给 = 包围盒中心） */
  focus?: THREE.Object3D | THREE.Vector3;
  /** 物体「半径」（m）：判定距离 = 到焦点的水平距离 − reach（大物体如灯塔） */
  reach?: number;
  enabled?: boolean;
  /** hold：按住时长（s），默认 2 */
  holdSeconds?: number;
  /** push：轨道 */
  track?: PushTrack;
  /** puzzle：机关组 */
  puzzle?: PuzzleGroup;
  /** pickup：手持物 ID（默认 = id）；place：接受哪个手持物 */
  item?: string;
  /** place：放置点（`-socket` 节点）；不给时在 object 下找 `-socket` */
  socket?: THREE.Object3D;
  /** use / hold / push 前是否自动走到交互点，默认 true（inspect / read / pickup / place / puzzle 不走） */
  approach?: boolean;
  /**
   * 优先级（和跨越点比）：附近有跨越点、且它的优先级更高时，这个物体不当候选，E 归跨越。
   * 默认 inspect / read = 0（看看而已），其余 = 20（操作类）；跨越点默认 10（TraversalLink.priority）。
   * 例：站在浮台上，「E 跨过去」压过石槽的「E 查看」。
   */
  priority?: number;
  /**
   * v0.1-017 汐的交互动作 clip（有动画时：先走到站位，再播 clip，在事件帧生效——拿起 grab / 放下 release / 敲钟 ring…）。
   * 交互点节点（GLB `-interact`）的 extras.anim 优先；可以是函数（每次触发时求值，如风灯在桌上 / 灯台上用不同 clip）。
   */
  anim?: XiClipName | (() => XiClipName | null);
  /** 没有交互点时，按 socket / 物体到角色的方向、离它这么远站（m；灯台 0.65、桌面 0.45） */
  animStand?: number;
}

const INTERACT_NODE = /-interact(\.\d+)?$/i;
const SOCKET_NODE = /-socket(\.\d+)?$/i;
const box = new THREE.Box3();
const tmp = new THREE.Vector3();

export function findNode(root: THREE.Object3D, re: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o !== root && re.test(o.name)) found = o;
  });
  if (!found && re.test(root.name)) found = root;
  return found;
}

/**
 * 可交互物体（v0.1-004）。可以挂在实体上（Entity.add），也可以单独 new 出来交给 InteractionSystem.add()。
 * 只存数据和几何查询；按键、提示、动作都在 InteractionSystem。
 */
export class Interactable extends Component {
  readonly id: string;
  readonly kind: InteractKind;
  readonly object: THREE.Object3D;
  prompt: TextId;
  textId: TextId | null;
  override enabled: boolean;
  readonly reach: number;
  readonly holdSeconds: number;
  readonly track: PushTrack | null;
  readonly puzzle: PuzzleGroup | null;
  readonly item: string | null;
  readonly socket: THREE.Object3D | null;
  readonly approach: boolean;
  /** 见 InteractableOptions.priority */
  readonly priority: number;
  readonly animStand: number | null;
  private readonly animSpec: XiClipName | (() => XiClipName | null) | null;
  /** push：轨道进度 0–1；到 1 后 locked */
  pushT = 0;
  /** push 到终点 / 一次性物体用完：不再可交互 */
  locked = false;
  /**
   * 暂时不可用但仍显示（v0.1-011 潮汐钟过渡中）：仍是候选、提示变灰，按 E 无效。可以是函数（每步求值）。
   */
  blocked: boolean | (() => boolean) = false;
  private readonly point: THREE.Object3D | null;
  private readonly focusSpec: THREE.Object3D | THREE.Vector3 | null;

  constructor(opts: InteractableOptions) {
    super();
    this.id = opts.id;
    this.kind = opts.kind;
    this.object = opts.object;
    this.prompt = opts.prompt ?? DEFAULT_PROMPT[opts.kind];
    this.textId = opts.textId ?? null;
    this.enabled = opts.enabled ?? true;
    this.reach = opts.reach ?? 0;
    this.holdSeconds = opts.holdSeconds ?? gameplay.interaction.holdSeconds;
    this.track = opts.track ?? null;
    this.puzzle = opts.puzzle ?? null;
    this.item = opts.item ?? (opts.kind === 'pickup' ? opts.id : null);
    this.socket = opts.socket ?? (opts.kind === 'place' ? findNode(opts.object, SOCKET_NODE) : null);
    this.approach = opts.approach ?? (opts.kind === 'use' || opts.kind === 'hold' || opts.kind === 'push');
    this.priority = opts.priority ?? (opts.kind === 'inspect' || opts.kind === 'read' ? 0 : 20);
    this.point = opts.interactPoint ?? findNode(opts.object, INTERACT_NODE);
    this.focusSpec = opts.focus ?? null;
    this.animSpec = opts.anim ?? null;
    this.animStand = opts.animStand ?? null;
    if ((opts.kind === 'inspect' || opts.kind === 'read') && !this.textId) throw new Error(`Interactable ${opts.id}: ${opts.kind} 需要 textId`);
    if (opts.kind === 'push' && !this.track) throw new Error(`Interactable ${opts.id}: push 需要 track`);
    if (opts.kind === 'puzzle' && !this.puzzle) throw new Error(`Interactable ${opts.id}: puzzle 需要 puzzle 机关组`);
    if (opts.kind === 'place' && !this.socket) throw new Error(`Interactable ${opts.id}: place 只能放在 -socket 节点上`);
  }

  /** 是否参与判定（enabled 且没用完） */
  get available(): boolean {
    return this.enabled && !this.locked;
  }

  /** 当前是否被 blocked（提示变灰、E 无效） */
  get isBlocked(): boolean {
    return typeof this.blocked === 'function' ? this.blocked() : this.blocked;
  }

  /** 焦点世界坐标 */
  focus(out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.focusSpec;
    if (f instanceof THREE.Vector3) return out.copy(f);
    if (f) return f.getWorldPosition(out);
    this.object.updateWorldMatrix(true, true);
    box.setFromObject(this.object);
    if (box.isEmpty()) return this.object.getWorldPosition(out);
    return box.getCenter(out);
  }

  /** 交互动作 clip：交互点节点 extras.anim（GLTFLoader → userData.anim）优先，其次 opts.anim */
  resolveAnim(): XiClipName | null {
    const fromNode = asXiClip(this.point?.userData?.anim);
    if (fromNode) return fromNode;
    const a = this.animSpec;
    return typeof a === 'function' ? a() : a;
  }

  /** 交互点节点（没有 = null） */
  get interactPoint(): THREE.Object3D | null {
    return this.point;
  }

  /** 角色站位（世界坐标，y 取节点高度）与朝向（yaw，与 PlayerController.facing 同约定：前方 = (sin, 0, cos)） */
  standPoint(out = new THREE.Vector3()): { position: THREE.Vector3; facing: number } {
    if (this.point) {
      this.point.getWorldPosition(out);
      tmp.set(0, 0, 1).transformDirection(this.point.matrixWorld);
      return { position: out, facing: Math.atan2(tmp.x, tmp.z) };
    }
    // 没有 -interact：物体前方（+Z）reach + 1 m，面向物体
    const f = this.focus(new THREE.Vector3());
    this.object.updateWorldMatrix(true, false);
    tmp.set(0, 0, 1).transformDirection(this.object.matrixWorld).setY(0);
    if (tmp.lengthSq() < 1e-8) tmp.set(0, 0, 1);
    tmp.normalize();
    out.copy(f).addScaledVector(tmp, this.reach + gameplay.interaction.defaultPointDistance);
    this.object.getWorldPosition(tmp2);
    out.y = tmp2.y;
    return { position: out, facing: Math.atan2(-tmp.x, -tmp.z) };
  }
}

const tmp2 = new THREE.Vector3();
