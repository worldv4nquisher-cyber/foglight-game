import * as THREE from 'three';
import { prepareArt } from '@/levels/artSlots';

export const SEABIRD_KEY = 'prop-seabird-far';
export const SEABIRD_CLIP = 'seabird-flap';

export interface SeabirdRoute {
  /** 航线圆心（世界）与半径、高度起伏 */
  center: readonly [number, number, number];
  radius: number;
  bob: number;
  /** 飞行速度 m/s */
  speed: number;
  /** 每隔 period 秒出现一次，飞 arc 弧度后消失（「远景偶尔出现」，GDD：零星单只，不做鸟群） */
  period: number;
  arc: number;
  /** 扇翅 flapSeconds 秒 → 滑翔 glideSeconds 秒（滑翔时权重停在 0，README-027 extras） */
  flapSeconds: number;
  glideSeconds: number;
}

/**
 * v0.1-027 远处单只海鸟：prop-seabird-far.glb（原点 = 身体中心，朝 +Z；morph flap-up / flap-down，动画 seabird-flap 0.6 s 循环）。
 * 沿 layout 给的圆弧飞一段就消失，过 period 秒换个起点再来；扇翅 / 滑翔交替（滑翔 = 动作淡出，morph 权重回 0）。
 */
export class Seabird {
  readonly object: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly action: THREE.AnimationAction | null;
  private t = 0;
  private start = 0;
  private flapT = 0;
  private flapping = true;
  private rand: () => number;

  readonly route: SeabirdRoute;

  constructor(model: THREE.Object3D, clips: readonly THREE.AnimationClip[], route: SeabirdRoute, seed = 3) {
    this.route = route;
    this.object = model;
    model.name = 'seabird-far';
    prepareArt(model);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = false;
    });
    this.mixer = new THREE.AnimationMixer(model);
    const clip = clips.find((c) => c.name === SEABIRD_CLIP) ?? null;
    this.action = clip ? this.mixer.clipAction(clip) : null;
    this.action?.setLoop(THREE.LoopRepeat, Infinity).play();
    let s = seed >>> 0;
    this.rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.start = this.rand() * Math.PI * 2;
    this.place();
  }

  /** 当前在航线上的哪一段（0..1 = 在飞；>1 = 隐身等待） */
  get phase(): number {
    return (this.t * this.route.speed) / this.route.radius / this.route.arc;
  }

  get flappingNow(): boolean {
    return this.flapping;
  }

  update(dt: number): void {
    const r = this.route;
    this.t += dt;
    if (this.t >= r.period) {
      this.t -= r.period;
      this.start = this.rand() * Math.PI * 2;
    }
    this.object.visible = this.phase <= 1;
    this.flapT += dt;
    const lim = this.flapping ? r.flapSeconds : r.glideSeconds;
    if (this.flapT >= lim) {
      this.flapT = 0;
      this.flapping = !this.flapping;
      if (this.action) {
        if (this.flapping) this.action.reset().fadeIn(0.25).play();
        else this.action.fadeOut(0.4);
      }
    }
    if (this.object.visible) {
      this.mixer.update(dt);
      this.place();
    }
  }

  private place(): void {
    const r = this.route;
    const a = this.start + (this.t * r.speed) / r.radius;
    const [cx, cy, cz] = r.center;
    const o = this.object;
    o.position.set(cx + Math.cos(a) * r.radius, cy + Math.sin(this.t * 0.7) * r.bob, cz + Math.sin(a) * r.radius);
    // 切向（逆时针）= (−sin a, 0, cos a)；模型朝 +Z；轻微向圆心侧倾
    o.rotation.set(0, Math.atan2(-Math.sin(a), Math.cos(a)), -0.18, 'YXZ');
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
    this.object.removeFromParent();
  }
}
