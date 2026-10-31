import * as THREE from 'three';

/**
 * 跟 clip 走的手持道具（P3 钢笔 prop-fountain-pen 起）：挂点、clip、局部矩阵全读 GLB 根 extras.attach，不在代码里写死。
 *   extras.attach = { socket: 'hand_r_socket', clip: 'xi-sit-write', localMatrix: 'identity' | number[16]（列主序） }
 * 可见规则：只在 attach.clip 是汐当前的覆盖 clip（setPose / setLoop）且它的混合权重 ≥ VISIBLE_W 时显示；
 *   换 clip（淡出过半就藏）、clearPose、演出跳过（suppress）都藏。
 * 本文件只依赖 three，Node 校验脚本（scripts/verify-xi.mjs）直接用。
 */

/** 权重过半才显示：交叉淡入淡出 0.2 s 的中点换，避免手还在别的姿势时笔先出现 */
export const CLIP_PROP_VISIBLE_W = 0.5;

export interface ClipPropAttach {
  socket: string;
  clip: string;
  matrix: THREE.Matrix4;
  /** extras 里写的原值（日志 / 冒烟读） */
  localMatrix: unknown;
}

/** 动画器需要的最小接口（XiAnimator 满足） */
export interface ClipPropAnimator {
  readonly posing: string | null;
  readonly looping: string | null;
  resolve(name: string): string | null;
  weightOf(name: string): number;
}

/** 读 GLB 根 extras.attach；缺字段 / 格式不对返回 null（附原因） */
export function readClipPropAttach(root: THREE.Object3D): { attach: ClipPropAttach | null; error: string | null } {
  let ud: Record<string, unknown> | undefined;
  root.traverse((o) => {
    if (!ud && o.userData && typeof o.userData === 'object' && 'attach' in o.userData) ud = o.userData;
  });
  const a = ud?.attach as { socket?: unknown; clip?: unknown; localMatrix?: unknown } | undefined;
  if (!a) return { attach: null, error: '根节点没有 extras.attach' }; // text-ok: 资源错误原因，只进 console.warn / 冒烟
  if (typeof a.socket !== 'string' || !a.socket) return { attach: null, error: 'extras.attach.socket 缺失' }; // text-ok: 资源错误原因，只进 console.warn / 冒烟
  if (typeof a.clip !== 'string' || !a.clip) return { attach: null, error: 'extras.attach.clip 缺失' }; // text-ok: 资源错误原因，只进 console.warn / 冒烟
  const m = new THREE.Matrix4();
  const lm = a.localMatrix ?? 'identity';
  if (Array.isArray(lm) && lm.length === 16 && lm.every((x) => typeof x === 'number' && Number.isFinite(x))) m.fromArray(lm as number[]);
  else if (lm !== 'identity') return { attach: null, error: `extras.attach.localMatrix 不支持：${JSON.stringify(lm)}` }; // text-ok: 资源错误原因，只进 console.warn / 冒烟
  return { attach: { socket: a.socket, clip: a.clip, matrix: m, localMatrix: lm }, error: null };
}

export class ClipProp {
  private suppressed = false;
  readonly root: THREE.Object3D;
  readonly attach: ClipPropAttach;
  readonly socket: THREE.Object3D;
  private readonly animator: ClipPropAnimator;
  /** 动画器里实际播的 clip 名（别名已归一） */
  readonly clip: string;

  private constructor(root: THREE.Object3D, attach: ClipPropAttach, socket: THREE.Object3D, animator: ClipPropAnimator, clip: string) {
    this.root = root;
    this.attach = attach;
    this.socket = socket;
    this.animator = animator;
    this.clip = clip;
  }

  /**
   * 把道具根挂到 model 里 extras.attach.socket 下（局部变换 = extras.attach.localMatrix），初始隐藏。
   * 找不到 socket / 动画器没有这个 clip 时不挂，返回 { prop: null, error }。
   */
  static mount(root: THREE.Object3D, model: THREE.Object3D, animator: ClipPropAnimator): { prop: ClipProp | null; error: string | null } {
    const { attach, error } = readClipPropAttach(root);
    if (!attach) return { prop: null, error };
    const socket = model.getObjectByName(attach.socket);
    if (!socket) return { prop: null, error: `模型里没有挂点 ${attach.socket}` }; // text-ok: 资源错误原因，只进 console.warn / 冒烟
    const clip = animator.resolve(attach.clip);
    if (!clip) return { prop: null, error: `动画里没有 clip ${attach.clip}` }; // text-ok: 资源错误原因，只进 console.warn / 冒烟
    root.matrixAutoUpdate = true;
    attach.matrix.decompose(root.position, root.quaternion, root.scale);
    root.visible = false;
    socket.add(root);
    root.updateMatrixWorld(true);
    return { prop: new ClipProp(root, attach, socket, animator, clip), error: null };
  }

  /** 当前该不该显示（不含 suppress） */
  get playing(): boolean {
    const a = this.animator;
    const cur = a.posing ?? a.looping;
    if (!cur || a.resolve(cur) !== this.clip) return false;
    return a.weightOf(this.clip) >= CLIP_PROP_VISIBLE_W;
  }

  /** 每帧（动画器更新之后、渲染之前） */
  update(): boolean {
    const v = !this.suppressed && this.playing;
    this.root.visible = v;
    return v;
  }

  /** 演出跳过 / 结束：强制藏（clip 还在播也藏），立即生效 */
  suppress(on = true): void {
    this.suppressed = on;
    this.update();
  }

  get isSuppressed(): boolean {
    return this.suppressed;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
