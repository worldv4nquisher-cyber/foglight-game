import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { PlayerRig } from '@/entities/createPlayer';
import type { FatherActor } from '@/entities/father/FatherActor';
import { xiClipDuration } from '@/entities/xi/clips';
import type { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { CameraTrack, makePose } from '@/systems/camera/CameraTrack';
import { CutsceneClock } from '@/systems/cutscene/CutsceneClock';
import { CutscenePlayer, sampleShots, shotAt, type CutsceneEnd, type Shot, type ShotKey } from '@/systems/cutscene/CutscenePlayer';
import { ENDING_MUSIC, ENDING_SKIP_FADE_SEC, type EndingMusic } from '@/systems/audio/endingMusic';
import { makeSkyLayer, silhouetteColor, type SkyLayerHandle } from '@/render/skyLayer';
import { makeGhost, type Ghost } from '@/render/ghost';
import { makeSpecularGate, type SpecularGate } from '@/render/specularGate';
import { ATMOSPHERE_PRESETS, type AtmospherePreset } from '@/config/atmosphere';
import type { SubtitleCue } from '@/ui/Subtitles';
import {
  ENDING_CUE_LIST,
  ENDING_ID,
  ENDING_SUBTITLES,
  ENDING_T,
  FOG_OPEN_K,
  fadeAt,
  fatherOpacityAt,
  fogOpenAt,
  glassReflectionAt,
  GAZE_BACKOFF,
  silhouetteAt,
  xiPoseAt,
} from '@/content/cutscenes/ending';
import { S3, toWorld } from './layout';
import { IGNITE_MONO_DELAY, IGNITE_MONO_SEC } from './puzzles';

/**
 * S3 结尾演出执行（035）：时间轴数据见 content/cutscenes/ending.ts，时钟见 systems/cutscene/CutsceneClock.ts。
 * lighthouse:ignited 那一帧 start()：
 * - 0:00–0:04 探索相机（点灯动作 + 独白），0:04 起镜头交给演出节点（CameraTrack node + clock：镜头时间 = 演出时钟）；
 * - 0:00 切 026 after-lit 预设（点燃闪光盖住）；0:14–0:22 雾密度降到 0.4 倍（雾口）；0:24–0:29 远处第二座灯塔（F2）从雾里显出；
 * - 0:30 汐瞬移到灯室眺望站位（后退 GAZE_BACKOFF，给父亲留位置）播 xi-stand-gaze；0:36（眺望第 2 循环第 0 帧）父亲回忆
 *   hand-on-head（同帧起播，幽灵材质淡入淡出，父亲时间 = 演出时钟 − 36）；
 * - 0:50 / 1:06 字幕走字幕时间轴 playAt(t)；1:06 写进日志第 6 页；0:58 坐下写日志；1:14 后拉；1:35 黑场；1:46 → 章节结束页。
 * - 跳过（SkipController，按住 Space 1 s）：发 cutscene:skip（结尾曲 0.75 s 淡出）→ 套终态（日志第 6 页、独白已看过）→ 0.75 s 黑场 → 章节结束页。
 */
export interface S3EndingHost {
  game: Game;
  scene: THREE.Scene;
  frame: THREE.Group;
  rig: () => PlayerRig | undefined;
  cameraFollow: CameraFollowSystem;
  father: FatherActor | null;
  endingMusic: EndingMusic | null;
  gazePlace(): { position: THREE.Vector3; facing: THREE.Vector3 };
  setAtmosphere(a: AtmospherePreset): void;
  /** 灯室玻璃所在的美术根（env-lighthouse-ch1-s3；白盒 / art=0 时 null） */
  lampGlassRoot?: () => THREE.Object3D | null;
  /** 美术节点在 S3 局部的位置（没有 / 白盒时 null）：日志 socket 等跟 GLB 走，不硬写 */
  artPoint?: (name: string) => THREE.Vector3 | null;
  alive(): boolean;
}

export { GAZE_BACKOFF } from '@/content/cutscenes/ending';
/** 远景剪影 F2：与 S1 天空层第 2 座同一世界摆位（s3-layout.json silhouettes F2.world） */
const F2_WORLD = { translation: [142.9, -0.5, -268.5] as const, rotationY: 1.9, scale: 0.72 };
/** 剪影按物体雾：藏在雾里 → 显出 */
const SIL_FOG_HIDDEN = 0.03;
const SIL_FOG_SHOWN = 0.0045;
export const SILHOUETTE_KEY = 'env-lighthouse-silhouette-far-s3';
/** 灯室灯笼 12 面玻璃的材质（和风化贴花同一个，alpha 混合；art/tools/build-env-s3.mjs） */
export const LAMP_GLASS_MATERIAL = /^mat-env-lighthouse-weather/;

const UP = new THREE.Vector3(0, 1, 0);

export class S3Ending {
  readonly clock: CutsceneClock;
  readonly player: CutscenePlayer;
  readonly shots: Shot[] = [];
  readonly cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  silhouette: THREE.Object3D | null = null;
  private silHandle: SkyLayerHandle | null = null;
  private fogBase = 0;
  private offs: Array<() => void> = [];
  /** 父亲幽灵材质（半透明 + 深度预写，裁定 25 ③） */
  ghost: Ghost | null = null;
  /** 灯室玻璃镜面开关（裁定 25 ②） */
  readonly glass: SpecularGate;
  /** 冒烟 / 截图对比：false = 不按 cue 关玻璃反射（看改之前的样子） */
  glassGateEnabled = true;
  private fatherStarted = false;
  private fatherDone = false;
  private posePlace: 'gaze' | 'sit' | null = null;
  private skipFade: { from: number; t0: number } | null = null;
  private finishing = false;
  /** 结束方式（冒烟读） */
  endedBy: CutsceneEnd | null = null;
  private readonly pose = makePose();

  constructor(private readonly h: S3EndingHost) {
    const { game } = h;
    const audio = game.audio;
    this.clock = new CutsceneClock({
      audio: () => {
        const em = h.endingMusic;
        if (!em || em.ignitedAt === null || audio.musicKey !== ENDING_MUSIC || !audio.running) return null;
        return audio.audioTime - em.ignitedAt;
      },
      now: () => performance.now(),
      paused: () => game.isPaused,
    });
    const cues = ENDING_CUE_LIST.map(([id, at]) => ({ id, at, run: () => this.onCue(id) }));
    this.player = new CutscenePlayer({
      id: ENDING_ID,
      duration: ENDING_T.end,
      cues,
      clock: this.clock,
      onUpdate: (t) => this.step(t),
      onFinish: (how) => this.finish(how),
    });
    // 进场就挂好（uniform 开关，演出里切换不重新编译）
    this.glass = makeSpecularGate(h.lampGlassRoot?.() ?? null, LAMP_GLASS_MATERIAL);
    this.cam.name = 'ch1-ending-cam';
    h.scene.add(this.cam);
    this.buildSilhouette();
  }

  get t(): number {
    return this.player.t;
  }

  /** lighthouse:ignited 同一帧 */
  start(): void {
    const { game } = this.h;
    // 026：点灯后预设（点燃闪光里切）；雾口从这一套的雾密度往下降
    this.h.setAtmosphere(ATMOSPHERE_PRESETS['after-lit']);
    this.fogBase = (this.h.scene.fog as THREE.FogExp2 | null)?.density ?? 0;
    if (this.silHandle) silhouetteColor(ATMOSPHERE_PRESETS['after-lit'], this.silHandle.material.color);
    // 字幕时间轴：点灯独白（只一次）+ 那边没有亮 + 日志
    const cues: SubtitleCue[] = [];
    if (!game.narrative.hasSeen('ch1.s3.ignite.mono')) cues.push({ at: IGNITE_MONO_DELAY, id: 'ch1.s3.ignite.mono', duration: IGNITE_MONO_SEC });
    cues.push(...ENDING_SUBTITLES);
    game.ui.subtitles.track.setTimeline(cues);
    this.buildShots();
    this.offs.push(game.ui.skip.register({ id: ENDING_ID, onSkip: () => this.skip() }, performance.now()));
    this.player.update();
  }

  /** 每帧（S3Scene.update，实体更新之前：先写汐 / 父亲的姿势和镜头节点） */
  update(): void {
    if (this.skipFade) {
      const k = Math.min(1, (performance.now() - this.skipFade.t0) / (ENDING_SKIP_FADE_SEC * 1000));
      this.h.game.ui.fade.set(this.skipFade.from + (1 - this.skipFade.from) * k);
      if (k >= 1) {
        this.skipFade = null;
        void this.toChapterEnd();
      }
      return;
    }
    if (!this.player.done) this.player.update();
  }

  /** 跳过（SkipController / 冒烟） */
  skip(): boolean {
    return this.player.skip();
  }

  /** 调试 / 冒烟：把演出时钟推到 t（只能往前；跨过的 cue 下一帧按顺序触发） */
  seek(t: number): void {
    this.clock.seek(t);
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.cam.removeFromParent();
    this.silhouette?.removeFromParent();
  }

  // ---------------------------------------------------------------- 内部

  private onCue(id: string): void {
    const h = this.h;
    if (id === 'lens') {
      // 0:04 透镜转（032 声音已在 1.5 s 起）→ 切塔外远景：镜头交给演出节点，时间 = 演出时钟
      h.game.ui.hud.hide();
      void h.cameraFollow.playCutscene(
        new CameraTrack({ name: ENDING_ID, node: this.cam, duration: ENDING_T.end + 10, skippable: false, ease: false, clock: () => this.player.t }),
      );
    } else if (id === 'silhouette') {
      if (this.silhouette) this.silhouette.visible = true;
    } else if (id === 'gaze') {
      this.placeXi('gaze');
    } else if (id === 'sit_write') {
      this.endFather();
      this.placeXi('sit');
    } else if (id === 'journal') {
      // text-ch1 §5：同时写进日志第 6 页
      h.game.narrative.unlockOutroEntry();
    }
  }

  private step(t: number): void {
    const h = this.h;
    h.game.ui.subtitles.track.playAt(t);
    // 雾口
    const fog = h.scene.fog as THREE.FogExp2 | null;
    if (fog && this.fogBase > 0) fog.density = this.fogBase * (1 - (1 - FOG_OPEN_K) * fogOpenAt(t));
    if (this.silHandle) this.silHandle.fog.value = SIL_FOG_HIDDEN + (SIL_FOG_SHOWN - SIL_FOG_HIDDEN) * silhouetteAt(t);
    // 汐的姿势（父亲 hand 段由 FatherActor 写同一个 clip、同一个时间）
    this.stepXi(t);
    this.stepFather(t);
    // 镜头节点
    if (t >= ENDING_T.lens && this.shots.length) {
      sampleShots(this.shots, t, this.pose);
      this.cam.position.copy(this.pose.position);
      this.cam.quaternion.copy(this.pose.quaternion);
      if (this.cam.fov !== this.pose.fov) {
        this.cam.fov = this.pose.fov;
        this.cam.updateProjectionMatrix();
      }
      this.cam.updateMatrixWorld(true);
    }
    h.game.ui.fade.set(fadeAt(t));
    this.glass.value = this.glassGateEnabled ? glassReflectionAt(t) : 1;
  }

  private stepXi(t: number): void {
    const an = this.h.rig()?.animator;
    const p = xiPoseAt(t);
    if (!an || !p) return;
    if (this.h.father?.mode === 'hand') return;
    const d = xiClipDuration(p.clip);
    an.setPose(p.clip, d > 0 ? p.time % d : p.time);
  }

  private stepFather(t: number): void {
    const f = this.h.father;
    const rig = this.h.rig();
    if (!f || !rig?.animator || this.fatherDone) return;
    if (!this.fatherStarted && t >= ENDING_T.fatherIn && t < ENDING_T.fatherOut) {
      this.fatherStarted = true;
      this.makeGhost(f);
      rig.visual.updateMatrixWorld(true);
      f.playHandOnHead({ model: rig.animator.model, animator: rig.animator });
    }
    if (!this.fatherStarted) return;
    if (t >= ENDING_T.fatherOut) {
      this.endFather();
      return;
    }
    // 父亲时间 = 演出时钟 − 36 s（FatherActor hand 模式按 elapsed 定帧，dt 可以是任意正数）
    const want = t - ENDING_T.fatherIn;
    f.update(Math.max(0, want - f.time));
    const op = fatherOpacityAt(t);
    this.ghost?.setOpacity(op);
  }

  private endFather(): void {
    if (this.fatherDone) return;
    this.fatherDone = true;
    if (this.fatherStarted) this.h.father?.hide();
  }

  /** 父亲回忆段：材质换成半透明（克隆，不改共享材质）+ 深度预写（自身内层不透出）、不投影；见 render/ghost.ts */
  private makeGhost(f: FatherActor): void {
    this.ghost = makeGhost(f.model, 0);
  }

  private placeXi(where: 'gaze' | 'sit'): void {
    const rig = this.h.rig();
    if (!rig || this.posePlace === where) return;
    this.posePlace = where;
    const { position, facing } = where === 'gaze' ? this.gazeLocal() : this.sitLocal();
    const at = position.clone().applyMatrix4(this.h.frame.matrixWorld);
    const dir = facing.clone().transformDirection(this.h.frame.matrixWorld);
    rig.controller.halt();
    rig.controller.locked = true;
    void rig.controller.teleportTo(at, { fade: 0, facing: Math.atan2(dir.x, dir.z) });
    rig.visual.updateMatrixWorld(true);
  }

  private gazeLocal(): { position: THREE.Vector3; facing: THREE.Vector3 } {
    const g = this.h.gazePlace();
    const f = g.facing.clone().setY(0).normalize();
    return { position: g.position.clone().addScaledVector(f, -GAZE_BACKOFF), facing: f };
  }

  private sitLocal(): { position: THREE.Vector3; facing: THREE.Vector3 } {
    const p = new THREE.Vector3(...S3.points.sitWrite);
    const f = new THREE.Vector3(...S3.points.deskCenter).sub(p).setY(0).normalize();
    return { position: p, facing: f };
  }

  private buildSilhouette(): void {
    const { game, scene } = this.h;
    const a = game.assets;
    let o: THREE.Object3D;
    if (a.has(SILHOUETTE_KEY)) {
      o = a.getModel(SILHOUETTE_KEY);
      o.scale.setScalar(F2_WORLD.scale);
    } else {
      // ?art=0 / 没到：白盒剪影（塔身 + 灯室），同样走天空层材质
      o = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 22, 10));
      body.position.y = 11;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 4, 10));
      top.position.y = 24;
      o.add(body, top);
    }
    const g = new THREE.Group();
    g.name = 's3-ending-silhouette';
    o.position.set(...F2_WORLD.translation);
    o.rotation.y = F2_WORLD.rotationY;
    g.add(o);
    this.silHandle = makeSkyLayer(g, { color: silhouetteColor(ATMOSPHERE_PRESETS['after-lit']).getHex(), fogDensity: SIL_FOG_HIDDEN });
    g.visible = false;
    scene.add(g);
    this.silhouette = g;
  }

  /** 镜头分段（S3 局部 → 世界；眺望 / 坐写的镜头按汐实际站位算） */
  private buildShots(): void {
    const W = (x: number, y: number, z: number): THREE.Vector3 => toWorld([x, y, z]);
    const P = (r: number, th: number, y: number): THREE.Vector3 => W(r * Math.cos((th * Math.PI) / 180), y, r * Math.sin((th * Math.PI) / 180));
    const K = (position: THREE.Vector3, lookAt: THREE.Vector3, fov: number): ShotKey => ({ position, lookAt, fov });
    const frameM = this.h.frame.matrixWorld;
    const L = (v: THREE.Vector3): THREE.Vector3 => v.clone().applyMatrix4(frameM);
    // 眺望站位（S3 局部）：f 朝外，r 右手
    const g = this.gazeLocal();
    const gp = g.position;
    const gf = g.facing;
    const gr = new THREE.Vector3().crossVectors(gf, UP).normalize();
    const at = (base: THREE.Vector3, f: number, r: number, y: number, fv = gf, rv = gr): THREE.Vector3 =>
      L(base.clone().addScaledVector(fv, f).addScaledVector(rv, r).addScaledVector(UP, y));
    // 坐写
    const s = this.sitLocal();
    const sp = s.position;
    const sf = s.facing;
    const sr = new THREE.Vector3().crossVectors(sf, UP).normalize();
    // 镜头目标 = 摊开的日志：优先 GLB lamp-room-journal-socket（035 桌面降到 0.68），没有用 layout
    const journal = L(this.h.artPoint?.('lamp-room-journal-socket') ?? new THREE.Vector3(...S3.points.journal));
    const thDesk = (Math.atan2(sp.z, sp.x) * 180) / Math.PI;
    const T = ENDING_T;
    const pb1 = K(at(sp, -1.5, 0.5, 1.95, sf, sr), journal.clone().add(new THREE.Vector3(0, -0.1, 0)), 46);
    const pb2 = K(P(8.5, thDesk + 6, 24.6), W(0, 23.0, 0), 44);
    const pb3 = K(P(30, thDesk + 18, 21), W(0, 20.5, 0), 42);
    const pb4 = K(P(68, thDesk + 28, 24), W(0, 14, 0), 40);
    this.shots.push(
      // 0:04 塔外远景：海上低机位，塔顶 + 暖光束扫海面
      { name: 'far-exterior', start: T.lens, end: T.fogOpen, from: K(P(44, 288, 10), W(0, 21, 6), 42), to: K(P(40, 292, 11), W(0, 22, 10), 40), ease: 'linear' },
      // 0:14 雾口：塔顶后上方顺着眺望方向看出去，雾被推开
      { name: 'fog-gap', start: T.fogOpen, end: T.silhouette, from: K(P(14, 262, 27), W(12, 10, 70), 45), to: K(P(12, 262, 28), W(22, 8, 120), 40), ease: 'linear' },
      // 0:24 雾口里的第二座灯塔
      { name: 'silhouette', start: T.silhouette, end: T.gaze, from: K(P(12, 262, 28), W(22, 8, 120), 40), to: K(P(10.5, 262, 28.4), W(30, 8, 176), 32), ease: 'out' },
      // 0:30 灯室玻璃前眺望：身后侧机位长镜头
      { name: 'gaze', start: T.gaze, end: T.fatherIn, from: K(at(gp, -1.75, 0.9, 1.45), at(gp, 20, 0, 0.7), 50), to: K(at(gp, -1.5, 0.8, 1.45), at(gp, 20, 0, 0.7), 48), ease: 'linear' },
      // 0:36 父亲回忆：侧面中近景（两人头部）
      { name: 'father', start: T.fatherIn, end: T.regaze, from: K(at(gp, -0.85, 1.3, 1.5), at(gp, 0.3, 0, 1.38), 42), to: K(at(gp, -0.75, 1.15, 1.5), at(gp, 0.28, 0, 1.38), 38), ease: 'linear' },
      // 0:42 回到眺望（另一侧，更宽）；0:50「那边没有亮。」
      { name: 'regaze', start: T.regaze, end: T.sitWrite, from: K(at(gp, -1.9, -0.95, 1.6), at(gp, 25, 0, 0.4), 52), to: K(at(gp, -1.6, -0.7, 1.55), at(gp, 25, 0, 0.5), 46), ease: 'linear' },
      // 0:58 坐下写日志：过肩
      { name: 'over-shoulder', start: T.sitWrite, end: T.pullBack, from: K(at(sp, -0.6, 0.38, 1.5, sf, sr), journal, 42), to: K(at(sp, -0.45, 0.3, 1.4, sf, sr), journal, 36), ease: 'linear' },
      // 1:14 后拉：灯室 → 塔 → 海（分段线性，段间速度连续用 in / linear / out）
      { name: 'pull-room', start: T.pullBack, end: T.pullBack + 6, from: K(at(sp, -0.45, 0.3, 1.4, sf, sr), journal, 36), to: pb1, ease: 'in' },
      { name: 'pull-tower', start: T.pullBack + 6, end: T.pullBack + 14, from: pb1, to: pb2, ease: 'linear' },
      { name: 'pull-sea', start: T.pullBack + 14, end: T.fadeOut, from: pb2, to: pb3, ease: 'linear' },
      { name: 'pull-end', start: T.fadeOut, end: T.end, from: pb3, to: pb4, ease: 'out' },
    );
  }

  /** 当前镜头名（冒烟读） */
  get shot(): string | null {
    return this.player.t >= ENDING_T.lens ? (shotAt(this.shots, this.player.t)?.name ?? null) : null;
  }

  private finish(how: CutsceneEnd): void {
    if (this.finishing) return;
    this.finishing = true;
    this.endedBy = how;
    this.glass.value = 1;
    const { game } = this.h;
    // 终态（跳过与完整播放一致）：独白已看过、日志第 6 页、父亲收起
    game.narrative.markSeen('ch1.s3.ignite.mono');
    game.narrative.unlockOutroEntry();
    this.endFather();
    for (const off of this.offs.splice(0)) off();
    if (how === 'skip') {
      // 结尾曲 0.75 s 淡出（EndingMusic 监听），画面同时 0.75 s 黑场，然后进结束页
      game.events.emit('cutscene:skip', { id: ENDING_ID });
      game.ui.subtitles.track.endTimeline();
      this.skipFade = { from: game.ui.fade.opacity, t0: performance.now() };
      return;
    }
    game.ui.fade.set(1);
    void this.toChapterEnd();
  }

  private async toChapterEnd(): Promise<void> {
    const { game, cameraFollow } = this.h;
    game.ui.subtitles.track.endTimeline();
    cameraFollow.stopCutscene();
    if (!this.h.alive()) return;
    await game.flow.completeChapter();
  }
}
