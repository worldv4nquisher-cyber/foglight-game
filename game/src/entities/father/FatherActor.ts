import * as THREE from "three";
import type { XiAnimator } from "@/entities/xi/XiAnimator";
import {
  FATHER_CLIP_NAMES,
  FATHER_CLIP_SPECS,
  FATHER_HAND_ON_HEAD,
  FATHER_MODES,
  fatherClipDuration,
  handOnHeadEventsBetween,
  handOnHeadTimes,
  walkDistance,
  type FatherClipName,
  type FatherEvent,
  type FatherMode,
} from "./clips";

/** 模型 / 动画资源 key（manifest s3 组，art） */
export const FATHER_MODEL_KEY = "char-father";
export const FATHER_ANIMS_KEY = "char-father-anims";

/** 摆位：S3 局部（或任意父节点局部）位置 + 朝向（模型 +Z 朝 facing） */
export interface FatherPlace {
  position: THREE.Vector3;
  /** 朝向（父节点局部 XZ 方向，不用归一化） */
  facing: THREE.Vector3;
}

/** hand-on-head 的另一方：汐的模型根（char-xi 场景根，局部 +Z = 正面）+ 可选动画器（有就由这里驱动 xi-stand-gaze） */
export interface FatherXiLink {
  model: THREE.Object3D;
  animator?: Pick<XiAnimator, "setPose" | "clearPose" | "has">;
}

/** hand-on-head 时父亲根相对汐根的矩阵：T(0, 0, 0.48) · R_y(180°) */
export function fatherInXiMatrix(out = new THREE.Matrix4()): THREE.Matrix4 {
  const [x, y, z] = FATHER_HAND_ON_HEAD.fatherRootInXi;
  return out
    .makeRotationY(
      THREE.MathUtils.degToRad(FATHER_HAND_ON_HEAD.fatherYawDegInXi),
    )
    .setPosition(x, y, z);
}

const tmpM = new THREE.Matrix4();
const tmpInv = new THREE.Matrix4();
const tmpS = new THREE.Vector3();

/**
 * 父亲（v0.1-031 / BUG-023）：char-father.glb（73 骨，3 档 LOD，LOD 距离由 LevelScene.applyQuality → applyLodDistances 设）
 * + char-father-anims.glb（3 个 clip，和汐一样按骨骼名绑到 AnimationMixer）。
 *
 * GDD §5.2 / §5.3 / §12.2：父亲只在回忆演出里出现（035 决定剪影 / 半透明材质和是否保留结尾叠现），所以默认隐藏，
 * 由 play() 显示并播一段：
 *   - gaze：灯室眺望（父亲根放在 lamp-room-stand-gaze，面朝 +Z 外），LoopRepeat；
 *   - walk：原地走 clip + 根沿 from → to 以 strideSpeed 1.3 m/s 移动（到头从起点重来），LoopRepeat；
 *   - hand：抚摸汐的头（README-031 §4）：父亲根 = 汐局部 (0, 0, 0.48) 绕 Y 180°，每帧跟汐根；
 *           两人同一帧开始：父亲 LoopOnce 停末帧，汐 xi-stand-gaze 从第 0 帧 LoopRepeat（由这里按同一个 elapsed 写 setPose）。
 * 时间一律是游戏时间（update(dt) 的 dt）。事件（reachStart / handOn / strokeA / strokeB / handOff / armDown）经 onEvent 发出。
 */
export class FatherActor {
  /** 摆位节点（挂到场景 / S3 frame 下）；模型在它下面 */
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<FatherClipName, THREE.AnimationAction>();
  readonly missing: FatherClipName[] = [];
  onEvent: ((e: FatherEvent) => void) | null = null;
  private _mode: FatherMode | null = null;
  private elapsed = 0;
  private xi: FatherXiLink | null = null;
  private walk: { from: THREE.Vector3; to: THREE.Vector3 } | null = null;

  constructor(model: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    this.model = model;
    this.root.name = "father";
    this.root.visible = false;
    this.root.add(model);
    model.traverse((o) => {
      // 蒙皮包围盒按绑定姿势算，抬手 / 走路时会被误剔（同汐）
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of FATHER_CLIP_NAMES) {
      const c = clips.find((k) => k.name === name);
      if (!c) {
        this.missing.push(name);
        continue;
      }
      const a = this.mixer.clipAction(c);
      a.setLoop(
        FATHER_CLIP_SPECS[name].loop ? THREE.LoopRepeat : THREE.LoopOnce,
        Infinity,
      );
      a.clampWhenFinished = true;
      this.actions.set(name, a);
    }
  }

  get mode(): FatherMode | null {
    return this._mode;
  }

  /** 当前 clip 时间（s；没在播为 0） */
  get clipTime(): number {
    return this._mode
      ? (this.actions.get(FATHER_MODES[this._mode])?.time ?? 0)
      : 0;
  }

  /** 从开始播到现在的游戏时间（s） */
  get time(): number {
    return this.elapsed;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 眺望：父亲根放在 place（父节点局部），LoopRepeat */
  playGaze(place: FatherPlace): void {
    this.start("gaze");
    this.placeAt(place.position, place.facing);
  }

  /** 走开的背影：from → to（父节点局部），根以 1.3 m/s 移动、面朝 to */
  playWalk(from: THREE.Vector3, to: THREE.Vector3): void {
    this.start("walk");
    this.walk = { from: from.clone(), to: to.clone() };
    this.placeAt(from, to.clone().sub(from));
  }

  /** 抚摸汐的头：跟 xi.model 对位；有 animator 时同帧起播 xi-stand-gaze（第 0 帧） */
  playHandOnHead(xi: FatherXiLink): void {
    this.start("hand");
    this.xi = xi;
    this.alignToXi();
    this.driveXi();
  }

  /** 收起（回忆结束）：停动画、隐藏；hand 模式把汐的 xi-stand-gaze 姿势放掉 */
  hide(): void {
    if (this.xi?.animator && this._mode === "hand")
      this.xi.animator.clearPose();
    this._mode = null;
    this.xi = null;
    this.walk = null;
    this.root.visible = false;
    this.mixer.stopAllAction();
  }

  /** 每帧（游戏时间）。hand 模式要在汐的 XiAnimator.update 之前调（同一帧里 setPose 先写、汐再取） */
  update(dt: number): void {
    const mode = this._mode;
    if (!mode) return;
    const prev = this.elapsed;
    this.elapsed += dt;
    const a = this.actions.get(FATHER_MODES[mode]);
    if (mode === "hand") {
      const t = handOnHeadTimes(this.elapsed);
      if (a) a.time = t.father;
      this.alignToXi();
      this.driveXi();
      for (const e of handOnHeadEventsBetween(prev, this.elapsed))
        this.onEvent?.(e);
      this.mixer.update(0);
      return;
    }
    if (mode === "walk" && this.walk) {
      const { from, to } = this.walk;
      const len = from.distanceTo(to);
      this.root.position.lerpVectors(
        from,
        to,
        len > 0 ? walkDistance(this.elapsed, len) / len : 0,
      );
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.hide();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
  }

  private start(mode: FatherMode): void {
    if (this._mode) this.hide();
    this._mode = mode;
    this.elapsed = 0;
    this.root.visible = true;
    const a = this.actions.get(FATHER_MODES[mode]);
    if (a) {
      a.reset();
      a.timeScale = mode === "hand" ? 0 : 1;
      a.setEffectiveWeight(1).play();
      a.time = 0;
    }
    this.mixer.update(0);
  }

  private placeAt(p: THREE.Vector3, facing: THREE.Vector3): void {
    this.root.position.copy(p);
    this.root.rotation.set(0, Math.atan2(facing.x, facing.z), 0);
  }

  /** 父亲根 = 汐根世界矩阵 · T(0,0,0.48) · R_y(180°)，换回 root 父节点局部 */
  private alignToXi(): void {
    const xi = this.xi;
    if (!xi) return;
    xi.model.updateWorldMatrix(true, false);
    tmpM.multiplyMatrices(xi.model.matrixWorld, fatherInXiMatrix());
    const parent = this.root.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      tmpM.premultiply(tmpInv.copy(parent.matrixWorld).invert());
    }
    tmpM.decompose(this.root.position, this.root.quaternion, tmpS);
  }

  private driveXi(): void {
    const an = this.xi?.animator;
    if (an?.has(FATHER_HAND_ON_HEAD.xiClip))
      an.setPose(FATHER_HAND_ON_HEAD.xiClip, handOnHeadTimes(this.elapsed).xi);
  }
}

/** 时长（s），给 035 / smoke */
export const FATHER_HAND_ON_HEAD_SEC = fatherClipDuration(
  "father-hand-on-head",
);
