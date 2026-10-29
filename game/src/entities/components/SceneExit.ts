import * as THREE from 'three';
import { Component } from '../Component';
import { isLevelId, type LevelId } from '@/scenes/levels';

export interface SceneExitOptions {
  /** 目标场景（关卡 id：s1 / s2 / s3） */
  target: LevelId;
  /** 目标场景的入口点 id（对应 `<名>-spawn-<id>` 节点）；不填用目标场景的默认入口 */
  entry?: string;
  /** 触发体：世界坐标盒子；或者中心 + 半径（水平圆柱，高度不限） */
  box?: THREE.Box3;
  center?: THREE.Vector3;
  radius?: number;
  /** 角色脚底位置 */
  player: () => THREE.Vector3;
  /** 角色从外面走进触发体时调用（只在「外 → 内」那一步触发一次；出生在触发体里不会触发） */
  onEnter: (exit: SceneExit) => void;
}

/**
 * 场景出口（v0.1-010）：角色走进触发体 → 交给场景流程（黑场 1.0 s、加载、存档、进下一个场景的入口点）。
 * 白盒里由 013–015 放置；美术模型里也可以用 `<名>-exit-<目标>` 命名的盒子网格（见 collectSceneMarkers）。
 */
export class SceneExit extends Component {
  readonly target: LevelId;
  readonly entry: string | undefined;
  private box: THREE.Box3 | null;
  private center: THREE.Vector3 | null;
  private radius: number;
  private inside = true;
  private primed = false;
  private readonly opts: SceneExitOptions;

  constructor(opts: SceneExitOptions) {
    super();
    this.opts = opts;
    this.target = opts.target;
    this.entry = opts.entry;
    this.box = opts.box?.clone() ?? null;
    this.center = opts.center?.clone() ?? null;
    this.radius = opts.radius ?? 1.5;
    if (!this.box && !this.center) throw new Error('SceneExit 需要 box 或 center');
  }

  contains(p: THREE.Vector3): boolean {
    if (this.box) return this.box.containsPoint(p);
    const c = this.center!;
    return Math.hypot(p.x - c.x, p.z - c.z) <= this.radius;
  }

  override fixedUpdate(): void {
    const now = this.contains(this.opts.player());
    // 第一步只记录初始状态：出生 / 送回到触发体里面不算「走进去」
    if (this.primed && now && !this.inside && this.enabled) this.opts.onEnter(this);
    this.inside = now;
    this.primed = true;
  }
}

export interface SceneMarkers {
  /** 入口点 id → 世界坐标位置与进场时的相机朝向（yaw 同 CameraFollowSystem.yaw 约定；节点 +Z = 面朝 / 看向的方向） */
  spawns: Map<string, { position: THREE.Vector3; yaw: number }>;
  /** `<名>-exit-<目标>` 盒子网格（已隐藏）：目标、世界坐标包围盒、入口（userData.entry） */
  exits: Array<{ target: LevelId; box: THREE.Box3; entry?: string; name: string }>;
}

const SPAWN_RE = /-spawn-([a-z0-9-]+?)(?:\.\d+)?$/;
const EXIT_RE = /-exit-(s[123])(?:\.\d+)?$/;
const q = new THREE.Quaternion();
const fwd = new THREE.Vector3();

/** 从场景树里收集入口点 `-spawn-<id>` 与出口 `-exit-<s1|s2|s3>`（Blender 的 .001 后缀忽略） */
export function collectSceneMarkers(root: THREE.Object3D): SceneMarkers {
  root.updateWorldMatrix(true, true);
  const out: SceneMarkers = { spawns: new Map(), exits: [] };
  root.traverse((o) => {
    const s = SPAWN_RE.exec(o.name);
    if (s?.[1]) {
      o.getWorldQuaternion(q);
      fwd.set(0, 0, 1).applyQuaternion(q);
      out.spawns.set(s[1], { position: o.getWorldPosition(new THREE.Vector3()), yaw: Math.atan2(-fwd.x, -fwd.z) });
      return;
    }
    const e = EXIT_RE.exec(o.name);
    if (e?.[1] && isLevelId(e[1])) {
      const box = new THREE.Box3().setFromObject(o);
      o.visible = false;
      const entry = typeof o.userData.entry === 'string' ? o.userData.entry : undefined;
      out.exits.push({ target: e[1], box, name: o.name, ...(entry ? { entry } : {}) });
    }
  });
  return out;
}
