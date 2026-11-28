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
const framingDir = new THREE.Vector3();
const whisker = new THREE.Vector3();
const whiskerQ = new THREE.Quaternion();
const framingQ = new THREE.Quaternion();
const left = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const lifted = new THREE.Vector3();

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
  | { kind: 'cutscene'; track: CameraTrack; t: number; resolve: () => void; popInput: () => void; onHandoff?: () => void };

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
  /** 相机参数（= gameplay.camera，同一对象；smoke / 截图脚本运行时调参用，例：BUG-028 前后对比把新参数关掉模拟修前） */
  readonly cfg = cfg;
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
  private walkNoLook = false;
  /** 楼梯辅助转向期间锁住的移动朝向：按住同一组方向键时不跟着相机转（不然按 D 会被带进墙里），松键 / 换键 / 动鼠标后回到相机朝向 */
  private latchedYaw: number | null = null;
  private lastMoveX = 0;
  private lastMoveY = 0;

  /** 角色移动用的水平朝向 */
  get moveYaw(): number {
    return this.modeName === 'explore' && this.latchedYaw !== null ? this.latchedYaw : this.yaw;
  }
  /** BUG-028：当前肩后偏移（m，+ = 右肩，− = 左肩；平滑换边后、碰撞夹住前） */
  shoulder: number = cfg.shoulderOffset;
  /** BUG-028：本帧实际偏移（碰撞夹住后，m，同号约定） */
  side: number = cfg.shoulderOffset;
  /** BUG-028：空间不够时跟随支点抬高量（m） */
  lift = 0;
  /** BUG-028：本帧相机到头部跟随点（未偏移、未抬高）的距离（m；非探索模式为 Infinity） */
  headDistance = Infinity;
  /** BUG-028：本帧实际跟随支点（偏移 + 抬高之后；测试读） */
  readonly pivotPoint = new THREE.Vector3();
  /** BUG-019：外扩过渡区的限高带（由 heightCaps 派生，换数组时重算） */
  private leadCaps: CameraHeightCap[] = [];
  private leadCapsOf: CameraHeightCap[] | null = null;
  indoor = false;
  observing = false;
  /** 观察模式焦点距离（屏幕中心射线命中，m） */
  focusDistance = 0;
  /** 观察时的固定眼位提供者（场景设置；返回 null = 普通第三人称观察） */
  observeEye: (() => ObserveEye | null) | null = null;
  targetFramingWeight: ((position: THREE.Vector3) => number) | null = null;
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
   * 轨道结束时先通知 onHandoff（主动中断不通知），再放开输入；0.8 s 相机过渡完成时 resolve。
   */
  playCutscene(track: CameraTrack, onHandoff?: () => void): Promise<void> {
    if (this.mode.kind === 'cutscene') this.finishCutscene(true);
    if (this.mode.kind === 'puzzle') this.mode = { kind: 'explore' };
    this.setObserving(false);
    this.dropEye();
    this.blend = null;
    return new Promise((resolve) => {
      this.mode = { kind: 'cutscene', track, t: 0, resolve, popInput: this.input.pushContext('cutscene'), onHandoff };
    });
  }

  /** 当前在播、可按住空格跳过的演出轨道（035 跳过提示借它显示） */
  get cutsceneSkippable(): boolean {
    return this.mode.kind === 'cutscene' && this.mode.track.skippable;
  }

  /** 035：立即结束当前演出（交还输入上下文，不做 0.8 s 交还过渡） */
  stopCutscene(): void {
    if (this.mode.kind === 'cutscene') this.finishCutscene(true);
  }

  /** 场景建立镜头（GDD §4：进入新场景 3 s，结束交还控制） */
  playEstablishing(track: CameraTrack, onHandoff?: () => void): Promise<void> {
    return this.playCutscene(track, onHandoff);
  }

  /** 镜头朝前方向（世界，单位向量） */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number): void {
    this.clock += dt;
    this.headDistance = Infinity;
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
    this.walkNoLook = look.x === 0 && look.y === 0 && (move.x !== 0 || move.y !== 0);
    if (!this.walkNoLook || move.x !== this.lastMoveX || move.y !== this.lastMoveY) this.latchedYaw = null;
    this.lastMoveX = move.x;
    this.lastMoveY = move.y;
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
    // BUG-028：扫掠停在接触点后再让 shoulderSkin（否则后拉扫掠一出发就算碰到 → 距离 0）；右侧被挡时平滑换左肩 / 取宽侧，滞回不来回跳
    const physics = this.opts.physics;
    const r = cfg.collisionRadius;
    const off = cfg.shoulderOffset;
    const skin = cfg.shoulderSkin;
    const room = (dir: THREE.Vector3): number => (physics ? Math.max(0, Math.min(off, physics.sphereCast(head, dir, r, off + skin) - skin)) : off);
    left.copy(right).negate();
    const roomR = room(right);
    let roomL = -1;
    const getL = (): number => (roomL < 0 ? (roomL = room(left)) : roomL);
    // 后拉扫掠（从偏移 s 处的支点，未抬高）
    const backAt = (sd: number): number => {
      if (!physics) return maxD;
      lifted.copy(head).addScaledVector(right, sd);
      return physics.sphereCast(lifted, back, r, maxD);
    };
    const gain = cfg.shoulderSwitchGain;
    let want: number = off;
    if (physics) {
      const dR = backAt(Math.min(off, roomR));
      const rightBlocked = roomR < off * cfg.shoulderSwitchRatio;
      if (this.shoulder < 0) {
        // 已在左肩：右侧完全放开、且右肩后拉不比左肩差才换回来（滞回）
        const l = getL();
        const dL = backAt(-l);
        want = roomR >= off - 1e-4 && dR >= dL - 0.05 ? off : -l;
      } else if (rightBlocked || dR < maxD - gain) {
        // 右侧明显不够，或右肩后拉被挡：左肩更好（偏移更宽 / 后拉多 gain 以上）才换
        const l = getL();
        const dL = backAt(-l);
        want = (rightBlocked && l >= roomR) || dL > dR + gain ? -l : Math.min(off, roomR);
      } else want = Math.min(off, Math.max(roomR, this.shoulder));
    }
    if (!this.initialized) this.shoulder = want;
    else {
      const k = THREE.MathUtils.damp(this.shoulder, want, 8, dt) - this.shoulder;
      const lim = cfg.shoulderSwitchSpeed * dt;
      this.shoulder += THREE.MathUtils.clamp(k, -lim, lim);
      if (Math.abs(this.shoulder - want) < 1e-4) this.shoulder = want;
    }
    // 碰撞优先：实际偏移按该侧可用空间夹住
    let side = this.shoulder >= 0 ? Math.min(this.shoulder, roomR) : -Math.min(-this.shoulder, getL());
    const lookUp = THREE.MathUtils.smoothstep(this.pitch, 0, 20 * DEG);
    const framing = this.observing ? 0 : (this.targetFramingWeight?.(tp) ?? 0) * (1 - lookUp);
    if (framing > 0) {
      const centeredRoom = backAt(0);
      side *= 1 - framing * (1 - THREE.MathUtils.smoothstep(centeredRoom, 0.35, cfg.lowSpaceDistance));
    }
    // 楼梯井里相机被挤近又高过头顶时，过肩偏移按距离收掉：0.5 m 处还偏 0.5 m 会把汐挤到画面左下角（平视贴墙的窄缝不收，偏移是在躲墙）
    if (this.initialized) {
      const above = THREE.MathUtils.smoothstep(this.live.position.y - head.y, 0.6, 1.0);
      side *= 1 - above * (1 - THREE.MathUtils.smoothstep(this.currentDistance, 0.5, 1.6));
    }
    this.side = side;
    pivot.copy(head).addScaledVector(right, side);
    // BUG-028：后拉空间不够 → 支点平滑抬高（决策用未抬高支点的扫掠，不形成反馈；抬高量再按向上扫掠夹住）
    if (physics) {
      const d0 = physics.sphereCast(pivot, back, r, maxD);
      const need = smoothstep01(1 - d0 / cfg.lowSpaceDistance);
      const upRoom = need > 0 || this.lift > 0 ? Math.max(0, physics.sphereCast(pivot, UP, r, cfg.lowSpaceLift + skin) - skin) : 0;
      const liftWant = Math.min(cfg.lowSpaceLift * need, upRoom);
      if (!this.initialized) this.lift = liftWant;
      else {
        const lim = cfg.lowSpaceLiftSpeed * dt;
        this.lift += THREE.MathUtils.clamp(liftWant - this.lift, -lim, lim);
      }
      this.lift = Math.min(this.lift, upRoom);
      if (this.lift > 1e-4) {
        lifted.copy(pivot).addScaledVector(UP, this.lift);
        pivot.copy(lifted);
        maxD = physics.sphereCast(pivot, back, r, maxD);
      } else {
        this.lift = 0;
        maxD = d0;
      }
    }
    // 室外限高（裁定 19；室内不管，观察固定眼位在上面已 return）
    // BUG-019：hardD = 真实带（硬上限，立即生效）；leadD = 外扩过渡区（≤ hardD），限速往里收，走 / 跑进带时在过渡区里就收完，不再一帧 6 m → 0.87 m
    const physD = maxD;
    let leadD = maxD;
    if (!this.indoor && this.heightCaps.length) {
      if (this.leadCapsOf !== this.heightCaps) {
        this.leadCapsOf = this.heightCaps;
        this.leadCaps = expandHeightCaps(this.heightCaps, cfg.heightCapLeadPad, cfg.heightCapLeadDrop);
      }
      const floor = Math.min(physD, cfg.minCollisionDistance);
      const capD = cameraHeightCapDistance(this.heightCaps, pivot, back, physD);
      this.heightCapped = capD < physD - 1e-4;
      maxD = Math.max(floor, capD);
      leadD = Math.min(maxD, Math.max(floor, cameraHeightCapDistance(this.leadCaps, pivot, back, physD)));
    } else this.heightCapped = false;
    this.targetDistance = maxD;

    // 物理遮挡立即前拉（普通碰撞相机）；限高（真实带 / 过渡区）限速往里收——BUG-019 batch13：真实带的「沿后退射线第一次碰限高」
    // 距离随支点移动会突变（视线擦过斜天花板时 4.5 → 1.9 m），硬上限一帧到位就是 2.6 m 的跳；改成真实带比当前近时按
    // heightCapHardPullSpeed、只在过渡区时按 heightCapPullSpeed 收。解除后 0.25 s 恢复（缓入缓出），每帧再限 recoverMaxSpeed：
    // 恢复途中目标距离变大不会按旧起点一下跳过去（原 1.9 m 回弹），远距离恢复也不超速（原 0.6–0.9 m/帧）。全按 m/s，帧率换算一致。
    const eps = 1e-4;
    if (!this.initialized) {
      this.currentDistance = leadD;
      this.recover = null;
    } else if (leadD < this.currentDistance - eps) {
      let d = Math.min(this.currentDistance, physD);
      if (leadD < d - eps) {
        const speed = maxD < d - eps ? cfg.heightCapHardPullSpeed : cfg.heightCapPullSpeed;
        d = Math.max(leadD, d - speed * dt);
      }
      this.currentDistance = d;
      this.recover = null;
    } else if (leadD > this.currentDistance + eps) {
      this.recover ??= { from: this.currentDistance, t: 0 };
      this.recover.t += dt;
      const k = smoothstep01(this.recover.t / cfg.recoverTime);
      const want = k >= 1 ? leadD : this.recover.from + (leadD - this.recover.from) * k;
      const step = THREE.MathUtils.clamp(want - this.currentDistance, 0, cfg.recoverMaxSpeed * dt);
      this.currentDistance = Math.min(leadD, this.currentDistance + step);
      if (this.currentDistance >= leadD - eps) this.recover = null;
    } else {
      this.currentDistance = leadD;
      this.recover = null;
    }
    this.initialized = true;

    this.live.position.copy(pivot).addScaledVector(back, this.currentDistance);
    // 窄楼梯 / 螺旋梯里横着看（相机被挤到 1 m 内）时看不到前路：左右各探 0.9 rad，往空间大的一侧慢慢转；只在走动且没动鼠标时转（不跟移动方向走，A/D 不会绕圈）
    if (physics && this.walkNoLook && !this.heightCapped && this.modeName === 'explore' && !this.observing && this.currentDistance < 1) {
      let best = 0;
      let bestD = this.currentDistance + 0.2;
      for (const sgn of [-1, 1]) {
        euler.set(this.pitch, this.yaw + sgn * 0.9, 0, 'YXZ');
        whisker.set(0, 0, 1).applyQuaternion(whiskerQ.setFromEuler(euler));
        const d = physics.sphereCast(pivot, whisker, r, this.distance);
        if (d > bestD) {
          bestD = d;
          best = sgn;
        }
      }
      if (best !== 0) {
        this.latchedYaw ??= this.yaw;
        this.yaw += best * Math.min(1.8 * dt, 0.6);
      }
    }
    this.live.fov = this.fov.value;
    this.headDistance = this.live.position.distanceTo(head);
    this.pivotPoint.copy(pivot);

    if (framing > 0) this.frameTarget(head.y, framing);
    // 放在 frameTarget 之后（它按 this.pitch 重写朝向）。窄楼梯井里相机被拉近、枢轴又抬高时，汐可能落到画面下沿外：只往下补俯角（不动 yaw，W 仍是画面正前方），
    // 补量 = 小腿（脚底 + 0.15 m）低出竖直半视角 80% 的部分（整个人留在画面里），从 0 连续增长，不跳变；贴墙仰视（pitch > 0）不管
    if (this.modeName === 'explore' && this.pitch <= 0 && this.live.position.y > head.y + 0.3) {
      // 相机空间里的竖直角（含过肩偏移，绕本地 X 转 = 改 euler.x）
      framingDir.set(tp.x, this.pivotY + 0.15, tp.z).sub(this.live.position);
      framingDir.applyQuaternion(framingQ.copy(this.live.quaternion).invert());
      euler.setFromQuaternion(this.live.quaternion, 'YXZ');
      const below = -Math.atan2(framingDir.y, Math.max(-framingDir.z, 1e-3));
      const limit = THREE.MathUtils.degToRad(this.fov.value) * 0.4;
      if (below > limit) {
        // 贴得太近、整个人装不下时以头顶为准：下补不能把头顶推出同样的上沿
        framingDir.copy(head).sub(this.live.position).applyQuaternion(framingQ);
        const headUp = Math.atan2(framingDir.y, Math.max(-framingDir.z, 1e-3));
        const tilt = Math.min(below - limit, Math.max(0, limit - headUp));
        if (tilt > 0) {
          euler.x -= tilt;
          this.live.quaternion.setFromEuler(euler);
        }
      }
    }
    if (this.observing) this.updateFocus();
  }

  private frameTarget(headY: number, weight: number): void {
    const depth = this.currentDistance * Math.cos(this.pitch);
    const targetPitch = Math.atan2(headY - 0.16 - this.live.position.y, depth);
    const margin = this.live.fov * DEG / 4;
    const pitch = THREE.MathUtils.clamp(this.pitch, targetPitch - margin, targetPitch + margin);
    this.live.quaternion.setFromEuler(euler.set(THREE.MathUtils.lerp(this.pitch, pitch, weight), this.yaw, 0, 'YXZ'));
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
    mode.t = mode.track.clock ? Math.max(mode.t, mode.track.clock()) : mode.t + dt;
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
    const endTolerance = tr.clock ? 0 : 1e-6;
    if (mode.t < tr.duration - endTolerance) return;
    // 停在最后一帧等外部条件（建立镜头等画质检测第一轮），超时也交还
    if (tr.holdUntil && !tr.holdUntil() && mode.t < tr.duration + tr.maxHold) return;
    this.finishCutscene(false);
  }

  private finishCutscene(immediate: boolean): void {
    const mode = this.mode;
    if (mode.kind !== 'cutscene') return;
    if (!immediate) mode.onHandoff?.();
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

/**
 * BUG-019：限高带外扩 pad（沿视线两端、横向各加 pad，fade 不变）做进入过渡区，过渡区天花板再低 drop 米
 * （batch13：只外扩不压低时，视线擦过天花板的情形过渡区和真实带同时突变，提前量为 0）；外扩带的限高处处 ≤ 原带
 */
export function expandHeightCaps(caps: readonly CameraHeightCap[], pad: number, drop = 0): CameraHeightCap[] {
  return caps.map((c) => ({ ...c, from: c.from - pad, to: c.to + pad, halfWidth: c.halfWidth + pad, margin: c.margin + drop }));
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
