import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { InputManager } from './input/InputManager';
import type { PhysicsSystem } from './PhysicsSystem';
import { CameraTrack, copyPose, makePose, mixPose, smoothstep01, type CameraPose } from './camera/CameraTrack';

const cfg = gameplay.camera;
const DEG = Math.PI / 180;

const head = new THREE.Vector3();
const pivot = new THREE.Vector3();
const back = new THREE.Vector3();
const right = new THREE.Vector3();
const fwd = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qOff = new THREE.Quaternion();
const tmpBox = new THREE.Vector3();

/** 固定时长的缓入缓出补间（目标变化时从当前值重新开始） */
class Tween {
  value: number;
  private from: number;
  private to: number;
  private t = 0;
  private readonly duration: number;

  constructor(value: number, duration: number) {
    this.value = this.from = this.to = value;
    this.duration = duration;
  }

  get target(): number {
    return this.to;
  }

  set(target: number): void {
    if (target === this.to) return;
    this.from = this.value;
    this.to = target;
    this.t = 0;
  }

  update(dt: number): number {
    if (this.value === this.to) return this.value;
    this.t += dt;
    const k = smoothstep01(this.t / this.duration);
    this.value = k >= 1 ? this.to : this.from + (this.to - this.from) * k;
    return this.value;
  }
}

export interface CameraFollowOptions {
  /** 遮挡检测用（球形扫掠 / 观察模式焦点射线）；不传则不做遮挡 */
  physics?: PhysicsSystem;
  /** camera:observe 事件；player:teleport 时重置跟随 */
  events?: EventBus;
  /** 角色是否在小跑（FOV +3°） */
  isRunning?: () => boolean;
  /** 设置里的「自动回正」（默认关） */
  autoRecenter?: () => boolean;
}

export interface PuzzleViewOptions {
  /** 允许在预设朝向 ±20° 内用鼠标小范围转动（机关自己要用鼠标转动部件时传 false） */
  freeLook?: boolean;
  /** 机位 FOV；默认读节点 userData.fov，没有则 55 */
  fov?: number;
}

/**
 * 固定观察眼位（制作人裁定 16）：观察点上按住右键时相机切到这个第一人称眼位（不随站位变），FOV 固定；
 * 鼠标仍转视线；进入时朝 enterYaw / enterPitch（弧度，同 yaw / pitch 约定），松开回到进入前的第三人称朝向。
 */
export interface ObserveEye {
  position: THREE.Vector3;
  fov: number;
  enterYaw: number;
  enterPitch: number;
}

type Mode =
  | { kind: 'explore' }
  | { kind: 'puzzle'; node: THREE.Object3D; freeLook: boolean; fov: number; offYaw: number; offPitch: number }
  | { kind: 'cutscene'; track: CameraTrack; t: number; resolve: () => void; popInput: () => void };

/**
 * 第三人称相机（v0.1-003，GDD §4）。由 CameraFollowSystem 扩展而来，一个类管四种状态：
 * - 探索：跟随头部 1.35 m、肩后偏右 0.4 m；距离默认 4.0（滚轮 2.5–6.0）；俯仰 -35°（俯视）到 +55°（仰视）；
 *   遮挡用半径 0.2 m 的球形扫掠（PhysicsSystem.sphereCast），挡住立即前拉，解除后 0.25 s 平滑恢复；
 *   站在 -indoor 触发体里最大距离 2.0 m；FOV 55°，小跑 +3°，按住右键观察 30°（灵敏度 ×0.5，发 camera:observe）；
 *   设置开启自动回正后，静止 8 s 向场景的推荐构图极慢漂移。
 * - 机关：enterPuzzleView(-cam 节点) 0.6 s 过渡到预设机位，可 ±20° 小范围转动；exitPuzzleView() 0.6 s 回到进入前的 yaw/pitch。
 * - 演出：playCutscene(track) 播放镜头轨道（输入切到 cutscene 上下文，角色不能动；按住空格 1 s 跳过），结束后 0.8 s 交还，朝向保持演出前。
 * - 建立镜头：playEstablishing(track)，场景进入时 3 s。
 * 不依赖 DOM，Node 单测（scripts/verify-camera.mjs）直接构造。
 */
export class CameraFollowSystem {
  /** 水平朝向（弧度；0 = 看向 -Z）。角色移动方向相对它 */
  yaw = 0;
  /** 俯仰（弧度；负 = 俯视，正 = 仰视） */
  pitch = -0.3;
  /** 玩家用滚轮选的距离（m） */
  distance: number = cfg.distance;
  target: THREE.Object3D | null = null;
  /** -indoor 触发体（世界 AABB），见 collectIndoorVolumes() */
  indoorVolumes: THREE.Box3[] = [];
  /** 推荐构图（自动回正的目标）；null = 不回正 */
  recommended: { yaw: number; pitch: number } | null = null;
  /** 当前（遮挡、室内限制、恢复补间之后的）相机距离 */
  currentDistance: number = cfg.distance;
  /** 本帧遮挡 / 室内限制后的目标距离 */
  targetDistance: number = cfg.distance;
  /** 室外相机限高带（制作人裁定 19：S2 西窗外，室外第三人称相机到不了固定眼位视线），见 cameraHeightCapDistance() */
  heightCaps: CameraHeightCap[] = [];
  /** 本帧相机距离被限高压短 */
  heightCapped = false;
  indoor = false;
  observing = false;
  /** 观察模式焦点距离（屏幕中心射线命中，m） */
  focusDistance = 0;
  /** 观察时的固定眼位提供者（场景设置；返回 null = 普通第三人称观察） */
  observeEye: (() => ObserveEye | null) | null = null;
  /** 正在用固定眼位（角色模型此时应隐藏） */
  eyeActive = false;
  private eyeSaved: { yaw: number; pitch: number } | null = null;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private readonly opts: CameraFollowOptions;
  private mode: Mode = { kind: 'explore' };
  private blend: { from: CameraPose; t: number; duration: number; onDone?: () => void; observe?: boolean } | null = null;
  private readonly fov = new Tween(cfg.fov, cfg.fovBlendTime);
  private readonly live = makePose();
  private readonly out = makePose();
  private initialized = false;
  private pivotY = 0;
  private recover: { from: number; t: number } | null = null;
  private idle = 0;
  private lastFocusEmit = { t: 0, d: 0 };
  private clock = 0;
  private offs: Array<() => void> = [];

  constructor(camera: THREE.PerspectiveCamera, input: InputManager, opts: CameraFollowOptions = {}) {
    this.camera = camera;
    this.input = input;
    this.opts = opts;
    if (opts.events) this.offs.push(opts.events.on('player:teleport', () => this.snap()));
  }

  get modeName(): Mode['kind'] {
    return this.mode.kind;
  }

  /** 是否在过渡中（机关进出 / 演出交还） */
  /** 正在播的轨道名（不在演出里为 null；smoke / 测试读） */
  get cutsceneName(): string | null {
    return this.mode.kind === 'cutscene' ? this.mode.track.name : null;
  }

  get blending(): boolean {
    return this.blend !== null;
  }

  /** 下一帧直接到位（瞬移、换场景后） */
  snap(): void {
    this.initialized = false;
  }

  /** 场景退出时调用：中断演出（交还输入上下文）、恢复观察灵敏度、取消订阅 */
  dispose(): void {
    if (this.mode.kind === 'cutscene') this.finishCutscene(true);
    for (const off of this.offs) off();
    this.offs = [];
    if (this.observing) this.input.lookScale = 1;
  }

  // ---------------------------------------------------------------- 机关 / 演出接口

  /** 进入机关机位（-cam 空节点：位置 + 朝向，three 约定看向节点 -Z） */
  enterPuzzleView(node: THREE.Object3D, opts: PuzzleViewOptions = {}): void {
    if (this.mode.kind === 'cutscene') return;
    const fov = opts.fov ?? (typeof node.userData.fov === 'number' ? node.userData.fov : cfg.fov);
    this.startBlend(cfg.puzzleBlendTime);
    this.mode = { kind: 'puzzle', node, freeLook: opts.freeLook ?? true, fov, offYaw: 0, offPitch: 0 };
    this.setObserving(false);
    this.dropEye();
  }

  /** 退出机关：0.6 s 回到探索相机（yaw / pitch 保持进入前的值） */
  exitPuzzleView(): void {
    if (this.mode.kind !== 'puzzle') return;
    this.startBlend(cfg.puzzleBlendTime);
    this.mode = { kind: 'explore' };
  }

  /**
   * 播放镜头轨道。期间输入切到 cutscene 上下文（角色不能动、不能转视角），按住空格 1 s 可跳过（track.skippable）。
   * 轨道结束后 0.8 s 平滑交还，朝向保持演出前；交还完成时 resolve。
   */
  playCutscene(track: CameraTrack): Promise<void> {
    if (this.mode.kind === 'cutscene') this.finishCutscene(true);
    if (this.mode.kind === 'puzzle') this.mode = { kind: 'explore' };
    this.setObserving(false);
    this.dropEye();
    this.blend = null;
    return new Promise((resolve) => {
      this.mode = { kind: 'cutscene', track, t: 0, resolve, popInput: this.input.pushContext('cutscene') };
    });
  }

  /** 场景建立镜头（GDD §4：进入新场景 3 s，结束交还控制） */
  playEstablishing(track: CameraTrack): Promise<void> {
    return this.playCutscene(track);
  }

  /** 镜头朝前方向（世界，单位向量） */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    this.clock += dt;
    const mode = this.mode;
    if (mode.kind === 'explore') this.updateExplore(dt);
    else if (mode.kind === 'puzzle') this.updatePuzzle(mode);
    else this.updateCutscene(mode, dt);

    let pose: CameraPose = this.live;
    if (this.blend) {
      const b = this.blend;
      b.t += dt;
      const k = smoothstep01(b.t / b.duration);
      pose = mixPose(this.out, b.from, this.live, k);
      if (k >= 1) {
        this.blend = null;
        b.onDone?.();
      }
    }
    this.apply(pose);
  }

  private apply(pose: CameraPose): void {
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    if (Math.abs(this.camera.fov - pose.fov) > 1e-4) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  private startBlend(duration: number, onDone?: () => void, observe = false): void {
    const from = makePose();
    from.position.copy(this.camera.position);
    from.quaternion.copy(this.camera.quaternion);
    from.fov = this.camera.fov;
    this.blend = { from, t: 0, duration, ...(onDone ? { onDone } : {}), ...(observe ? { observe } : {}) };
  }

  private updateExplore(dt: number): void {
    const input = this.input;
    const look = input.getLookDelta();
    const move = input.getMove();
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, cfg.minPitchDeg * DEG, cfg.maxPitchDeg * DEG);
    const zoom = input.getZoomDelta();
    if (zoom !== 0) this.distance = THREE.MathUtils.clamp(this.distance + zoom * cfg.zoomStep, cfg.minDistance, cfg.maxDistance);

    // 自动回正（设置开启时）：静止 8 s 后极慢地漂向推荐构图
    const still = look.x === 0 && look.y === 0 && move.x === 0 && move.y === 0 && zoom === 0;
    this.idle = still ? this.idle + dt : 0;
    if (this.recommended && this.opts.autoRecenter?.() && this.idle >= cfg.autoRecenterDelay) {
      const step = cfg.autoRecenterSpeedDeg * DEG * dt;
      const dy = Math.atan2(Math.sin(this.recommended.yaw - this.yaw), Math.cos(this.recommended.yaw - this.yaw));
      this.yaw += THREE.MathUtils.clamp(dy, -step, step);
      this.pitch += THREE.MathUtils.clamp(this.recommended.pitch - this.pitch, -step, step);
    }

    // 观察模式（按住右键）；进 / 出固定眼位的过渡里也能继续按住
    this.setObserving(input.isDown('observe') && (this.blend === null || this.blend.observe === true));
    const running = this.opts.isRunning?.() ?? false;
    const eye = this.observing ? (this.observeEye?.() ?? null) : null;
    if (eye && !this.eyeActive) {
      this.eyeActive = true;
      this.eyeSaved = { yaw: this.yaw, pitch: this.pitch };
      this.yaw = eye.enterYaw;
      this.pitch = eye.enterPitch;
      this.startBlend(cfg.observeEyeBlendTime, undefined, true);
    } else if (!eye && this.eyeActive) {
      this.eyeActive = false;
      if (this.eyeSaved) ({ yaw: this.yaw, pitch: this.pitch } = this.eyeSaved);
      this.eyeSaved = null;
      this.startBlend(cfg.observeEyeBlendTime, undefined, true);
    }
    this.fov.set(eye ? eye.fov : this.observing ? cfg.observeFov : cfg.fov + (running ? cfg.sprintFovBoost : 0));
    this.fov.update(dt);
    if (eye) {
      // 固定第一人称眼位：位置不随站位，鼠标转视线
      euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this.live.quaternion.setFromEuler(euler);
      this.live.position.copy(eye.position);
      this.live.fov = eye.fov;
      this.updateFocus();
      return;
    }

    if (!this.target) {
      this.live.fov = this.fov.value;
      return;
    }
    const tp = this.target.position;
    if (!this.initialized) this.pivotY = tp.y;
    else this.pivotY = THREE.MathUtils.damp(this.pivotY, tp.y, cfg.pivotYDamping, dt);
    head.set(tp.x, this.pivotY + cfg.pivotHeight, tp.z);

    euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.live.quaternion.setFromEuler(euler);
    back.set(0, 0, 1).applyQuaternion(this.live.quaternion);
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // 室内触发体
    tmpBox.set(tp.x, tp.y + 0.5, tp.z);
    this.indoor = this.indoorVolumes.some((b) => b.containsPoint(tmpBox));
    let maxD = this.indoor ? Math.min(this.distance, cfg.indoorMaxDistance) : this.distance;

    // 肩后偏右：先从头部往右扫，避免贴右侧墙时跟随点进墙
    const physics = this.opts.physics;
    const r = cfg.collisionRadius;
    const side = physics ? physics.sphereCast(head, right, r, cfg.shoulderOffset) : cfg.shoulderOffset;
    pivot.copy(head).addScaledVector(right, side);
    if (physics) maxD = physics.sphereCast(pivot, back, r, maxD);
    // 室外限高（裁定 19；室内不管，观察固定眼位在上面已 return）
    if (!this.indoor && this.heightCaps.length) {
      const capD = cameraHeightCapDistance(this.heightCaps, pivot, back, maxD);
      this.heightCapped = capD < maxD - 1e-4;
      maxD = Math.max(Math.min(maxD, cfg.minCollisionDistance), capD);
    } else this.heightCapped = false;
    this.targetDistance = maxD;

    // 被挡立即前拉；解除后 0.25 s 恢复（缓入缓出）
    if (!this.initialized) {
      this.currentDistance = maxD;
      this.recover = null;
    } else if (maxD < this.currentDistance - 1e-4) {
      this.currentDistance = maxD;
      this.recover = null;
    } else if (maxD > this.currentDistance + 1e-4) {
      this.recover ??= { from: this.currentDistance, t: 0 };
      this.recover.t += dt;
      const k = smoothstep01(this.recover.t / cfg.recoverTime);
      this.currentDistance = k >= 1 ? maxD : this.recover.from + (maxD - this.recover.from) * k;
      if (k >= 1) this.recover = null;
    } else {
      this.currentDistance = maxD;
      this.recover = null;
    }
    this.initialized = true;

    this.live.position.copy(pivot).addScaledVector(back, this.currentDistance);
    this.live.fov = this.fov.value;

    if (this.observing) this.updateFocus();
  }

  private setObserving(active: boolean): void {
    if (active === this.observing) return;
    this.observing = active;
    this.input.lookScale = active ? cfg.observeLookScale : 1;
    if (active) this.updateFocus(true);
    else this.opts.events?.emit('camera:observe', { active: false, focusDistance: this.focusDistance });
  }

  /** 机关 / 演出打断观察：固定眼位直接退出（朝向回到进入前，由机关 / 演出自己的过渡接手） */
  private dropEye(): void {
    if (!this.eyeActive) return;
    this.eyeActive = false;
    if (this.eyeSaved) ({ yaw: this.yaw, pitch: this.pitch } = this.eyeSaved);
    this.eyeSaved = null;
  }

  /** 焦点 = 屏幕中心射线命中点；最多 10 次 / 秒发事件，变化 < 5% 不发 */
  private updateFocus(force = false): void {
    const physics = this.opts.physics;
    this.camera.getWorldDirection(fwd);
    const d = physics?.raycast(this.camera.position, fwd, 200) ?? 200;
    this.focusDistance = d;
    const last = this.lastFocusEmit;
    if (force || (this.clock - last.t >= 0.1 && Math.abs(d - last.d) > last.d * 0.05)) {
      last.t = this.clock;
      last.d = d;
      this.opts.events?.emit('camera:observe', { active: true, focusDistance: d });
    }
  }

  private updatePuzzle(mode: Extract<Mode, { kind: 'puzzle' }>): void {
    const look = this.input.getLookDelta();
    const lim = cfg.puzzleFreeLookDeg * DEG;
    if (mode.freeLook) {
      mode.offYaw = THREE.MathUtils.clamp(mode.offYaw - look.x, -lim, lim);
      mode.offPitch = THREE.MathUtils.clamp(mode.offPitch - look.y, -lim, lim);
    }
    mode.node.updateWorldMatrix(true, false);
    mode.node.matrixWorld.decompose(this.live.position, this.live.quaternion, tmpBox);
    euler.set(mode.offPitch, mode.offYaw, 0, 'YXZ');
    this.live.quaternion.multiply(qOff.setFromEuler(euler));
    this.live.fov = mode.fov;
    this.fov.set(cfg.fov);
  }

  /** 机关模式下的小范围转动偏移（°，测试 / 调试用） */
  get puzzleOffsetDeg(): { yaw: number; pitch: number } {
    const m = this.mode;
    return m.kind === 'puzzle' ? { yaw: m.offYaw / DEG, pitch: m.offPitch / DEG } : { yaw: 0, pitch: 0 };
  }

  private updateCutscene(mode: Extract<Mode, { kind: 'cutscene' }>, dt: number): void {
    mode.t += dt;
    if (mode.track.skippable && this.input.consumePressed('skipHold')) {
      const next = mode.track.onSkip?.() ?? null;
      if (next) {
        // 跳过后接一段新轨道（如 3 s 不可跳过的建立镜头），从头播
        mode.track = next;
        mode.t = 0;
      } else mode.t = mode.track.duration;
    }
    const tr = mode.track;
    mode.track.sample(Math.min(mode.t, tr.duration), this.live);
    if (mode.t < tr.duration - 1e-6) return;
    // 停在最后一帧等外部条件（建立镜头等画质检测第一轮），超时也交还
    if (tr.holdUntil && !tr.holdUntil() && mode.t < tr.duration + tr.maxHold) return;
    this.finishCutscene(false);
  }

  private finishCutscene(immediate: boolean): void {
    const mode = this.mode;
    if (mode.kind !== 'cutscene') return;
    mode.popInput();
    this.apply(this.live);
    this.mode = { kind: 'explore' };
    // 跟随点直接到位（演出期间角色可能被脚本移动过），距离从当前目标开始
    this.initialized = false;
    if (immediate) {
      mode.resolve();
      return;
    }
    this.startBlend(cfg.cutsceneReturnTime, mode.resolve);
  }

  /** dev 面板读数 */
  debugLine(): string {
    const fovS = `${this.camera.fov.toFixed(1)}°`;
    const m = this.mode.kind + (this.blend ? '（过渡中）' : '');
    return (
      `${m} · 距离 ${this.currentDistance.toFixed(2)} / ${this.distance.toFixed(1)} m${this.indoor ? ' · 室内' : ''}\n` +
      `FOV ${fovS} · 俯仰 ${(this.pitch / DEG).toFixed(0)}° · yaw ${(this.yaw / DEG).toFixed(0)}°${this.observing ? ` · 观察 焦点 ${this.focusDistance.toFixed(1)} m` : ''}`
    );
  }
}

/**
 * 室外相机限高（制作人裁定 19）：沿一条视线（如 S2 固定眼位 → 字组中心）铺一条斜“天花板”——
 * 相机水平位置落在带内（视线水平投影 s ∈ [from, to]、横向 ≤ halfWidth）时，相机高度 ≤ 视线在该处的高度 − margin；
 * 带外 fade 米内 smoothstep 平滑放开（+HEIGHT_CAP_RELEASE），最低不压到支点 + floorAbovePivot 以下。
 * 不是禁区锥：只沿相机后退射线把距离收短，与相机碰撞同一套“被挡前拉 / 解除 0.25 s 恢复”，不会跳。
 */
export interface CameraHeightCap {
  origin: { x: number; y: number; z: number };
  /** 视线方向（单位向量，需有水平分量） */
  dir: { x: number; y: number; z: number };
  from: number;
  to: number;
  halfWidth: number;
  margin: number;
  fade: number;
}
const HEIGHT_CAP_RELEASE = 30;
const CAP_FLOOR_ABOVE_PIVOT = 0.5;
const CAP_STEP = 0.05;

/** 相机在水平 (x, z) 处的限高（m）；不在任何带（含 fade）= Infinity */
export function cameraHeightCeiling(caps: readonly CameraHeightCap[], x: number, z: number): number {
  let out = Infinity;
  for (const c of caps) {
    const hl = Math.hypot(c.dir.x, c.dir.z);
    if (hl < 1e-6) continue;
    const hx = c.dir.x / hl, hz = c.dir.z / hl;
    const px = x - c.origin.x, pz = z - c.origin.z;
    const s = px * hx + pz * hz;
    const lat = Math.abs(px * hz - pz * hx);
    const ds = Math.max(c.from - s, 0, s - c.to);
    const dl = Math.max(lat - c.halfWidth, 0);
    const d = Math.hypot(ds, dl);
    if (d >= c.fade) continue;
    const w = c.fade > 0 ? smoothstep01(1 - d / c.fade) : 1;
    const lineY = c.origin.y + (c.dir.y / hl) * s;
    out = Math.min(out, lineY - c.margin + (1 - w) * HEIGHT_CAP_RELEASE);
  }
  return out;
}

/** 从支点沿后退方向走，返回不超过限高的最大距离（≤ maxD；限高不低于支点 + 0.5 m） */
export function cameraHeightCapDistance(caps: readonly CameraHeightCap[], pivot: THREE.Vector3, back: THREE.Vector3, maxD: number): number {
  if (!caps.length || back.y <= 1e-3) return maxD;
  const floorY = pivot.y + CAP_FLOOR_ABOVE_PIVOT;
  for (let d = CAP_STEP; d <= maxD + 1e-6; d += CAP_STEP) {
    const y = pivot.y + back.y * d;
    const ceil = Math.max(floorY, cameraHeightCeiling(caps, pivot.x + back.x * d, pivot.z + back.z * d));
    if (y > ceil) {
      // 本步内线性插到正好碰限高
      const yPrev = pivot.y + back.y * (d - CAP_STEP);
      const k = yPrev >= ceil ? 0 : (ceil - yPrev) / (y - yPrev);
      return Math.max(0, d - CAP_STEP + k * CAP_STEP);
    }
  }
  return maxD;
}

const INDOOR_NAME = /-indoor(\.\d+)?$/i;

/** 收集模型里名字以 -indoor 结尾的网格为室内触发体（世界 AABB），并隐藏它们 */
export function collectIndoorVolumes(root: THREE.Object3D): THREE.Box3[] {
  root.updateWorldMatrix(true, true);
  const out: THREE.Box3[] = [];
  root.traverse((o) => {
    if (!INDOOR_NAME.test(o.name)) return;
    out.push(new THREE.Box3().setFromObject(o));
    o.visible = false;
  });
  return out;
}

export { CameraTrack, copyPose };
