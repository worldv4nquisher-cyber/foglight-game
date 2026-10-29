import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { t as text } from '@/content/text';
import { Component } from '../Component';

export interface TraversalLinkOptions {
  /** 起点（脚底，世界坐标） */
  start: THREE.Vector3;
  /** 终点（脚底，世界坐标） */
  end: THREE.Vector3;
  /** 中间路径点（可选，比如翻过矮墙时的最高点） */
  path?: THREE.Vector3[];
  /** 起点触发半径（m） */
  radius?: number;
  /** 额外条件（比如某个谜题解开后才可通过）；不传 = 总是可用 */
  condition?: () => boolean;
  /** 在起点朝终点方向推摇杆也能触发（GDD §2：E 或直接往前走） */
  walkInto?: boolean;
  /** HUD 提示文本 */
  prompt?: string;
  /** 和交互物比的优先级（默认 10：高于 inspect / read 的 0，低于操作类的 20），见 Interactable.priority */
  priority?: number;
}

const tmp = new THREE.Vector3();

/**
 * 自动跨越点（v0.1-002）：矮墙、窄缝、小沟。角色走到起点附近，按 E 或朝终点方向走，
 * 由 PlayerController 接管：沿路径平滑移动 1–2 s（时长 = 路径长 / traversal.speed），期间忽略输入、不跑物理。
 * 路径是 start → path… → end 的折线，按弧长参数化，速度曲线 smoothstep（起停不突兀）。
 * 不依赖 DOM，Node 单测可直接导入。
 */
export class TraversalLink extends Component {
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly points: THREE.Vector3[];
  readonly radius: number;
  readonly walkInto: boolean;
  readonly prompt: string;
  readonly priority: number;
  readonly length: number;
  readonly duration: number;
  private readonly condition: (() => boolean) | undefined;
  private readonly cum: number[] = [0];

  constructor(opts: TraversalLinkOptions) {
    super();
    this.start = opts.start.clone();
    this.end = opts.end.clone();
    this.points = [this.start, ...(opts.path ?? []).map((p) => p.clone()), this.end];
    this.radius = opts.radius ?? 0.8;
    this.walkInto = opts.walkInto ?? true;
    this.prompt = opts.prompt ?? text('ui.prompt.traverse');
    this.priority = opts.priority ?? 10;
    this.condition = opts.condition;
    let len = 0;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      if (a && b) len += a.distanceTo(b);
      this.cum.push(len);
    }
    this.length = len;
    const t = gameplay.traversal;
    this.duration = THREE.MathUtils.clamp(len / t.speed, t.minTime, t.maxTime);
  }

  get available(): boolean {
    return this.enabled && (this.condition?.() ?? true);
  }

  /** 角色是否站在起点触发范围内（水平距离 + 高度差 < 0.5 m） */
  inRange(feet: THREE.Vector3): boolean {
    tmp.subVectors(feet, this.start);
    return Math.abs(tmp.y) < 0.5 && Math.hypot(tmp.x, tmp.z) <= this.radius;
  }

  /** 推摇杆的方向（世界 XZ，已归一化或为 0）是否朝着终点（夹角 < 40°） */
  pushingToward(dx: number, dz: number): boolean {
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return false;
    const first = this.points[1] ?? this.end;
    const tx = first.x - this.start.x;
    const tz = first.z - this.start.z;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-3) return false;
    return (dx * tx + dz * tz) / (l * tl) > Math.cos((40 * Math.PI) / 180);
  }

  /** 归一化时间 u ∈ [0,1] → 路径上的位置（smoothstep 缓入缓出） */
  sample(u: number, out: THREE.Vector3): THREE.Vector3 {
    const k = THREE.MathUtils.clamp(u, 0, 1);
    const s = k * k * (3 - 2 * k) * this.length;
    for (let i = 1; i < this.points.length; i++) {
      const c0 = this.cum[i - 1] ?? 0;
      const c1 = this.cum[i] ?? 0;
      if (s <= c1 || i === this.points.length - 1) {
        const a = this.points[i - 1] ?? this.start;
        const b = this.points[i] ?? this.end;
        return out.lerpVectors(a, b, c1 > c0 ? (s - c0) / (c1 - c0) : 1);
      }
    }
    return out.copy(this.end);
  }
}

/**
 * 站在 feet 处能触发的跨越：可用、在范围内的里取起点（水平）最近的一条；没有则 null。
 * （S1 浮台南沿：岸台→浮台 的起点范围会盖到浮台边上 5 cm，回程起点更近，得选回程。）
 */
export function pickTraversalLink(links: Iterable<TraversalLink>, feet: THREE.Vector3): TraversalLink | null {
  let best: TraversalLink | null = null;
  let bestD = Infinity;
  for (const link of links) {
    if (!link.available || !link.inRange(feet)) continue;
    const d = Math.hypot(feet.x - link.start.x, feet.z - link.start.z);
    if (d < bestD) {
      bestD = d;
      best = link;
    }
  }
  return best;
}
