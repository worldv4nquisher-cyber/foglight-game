import * as THREE from 'three';
import { BaseScene } from './BaseScene';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import { getAtmosphere, type AtmospherePreset } from '@/config/atmosphere';
import { EntityManager } from '@/entities/EntityManager';
import { Entity } from '@/entities/Entity';
import { createPlayer, debugPlayerLine, type PlayerRig } from '@/entities/createPlayer';
import { SceneExit, type SceneExitOptions } from '@/entities/components/SceneExit';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { CameraFollowSystem, CameraTrack } from '@/systems/CameraFollowSystem';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import { InteractionSystem, actorFromRig } from '@/systems/interaction/InteractionSystem';
import { SkyDome, SKY_CLOUDS_KEY } from '@/world/SkyDome';
import { Water } from '@/world/Water';
import { Rain } from '@/world/Rain';
import { applyLodDistances } from '@/render/lod';
import { applySkyLayerAtmosphere, type SkyLayerHandle } from '@/render/skyLayer';
import type { ObjectFogHandle } from '@/render/objectFog';
import { xiWetTarget } from '@/entities/xi/XiLook';
import type { LevelDef } from './levels';
import { t, type TextId } from '@/content/text';
import { keyHintHtml } from '@/ui/keyHint';
import type { HintSystem } from '@/systems/HintSystem';
import { createSceneHints } from './sceneHints';
import { TideSet } from '@/systems/tide/TideController';
import type { TideBell } from '@/systems/tide/TideBell';
import { bindSfxFallback, recallToSafePoint } from '@/systems/tide/tideScene';
import { PushLoop } from '@/systems/audio/loops';
import { bindPuzzleSfx } from '@/systems/audio/puzzleSfx';
import { Footsteps } from '@/systems/audio/footsteps';
import { AMBIENCE, Ambience } from '@/levels/ambience';

/** 建立镜头迟迟不结束时（慢机器上画质检测拖住），进场多久后无论如何开始预加载下一个场景 */
const PRELOAD_FALLBACK_MS = 8000;

/** 入口点：位置（脚底）+ 进场时的相机水平朝向（CameraFollowSystem.yaw 约定，0 = 看向 -Z） */
export interface SpawnPoint {
  position: THREE.Vector3;
  yaw: number;
  pitch?: number;
}

/**
 * 第一章场景基类（v0.1-010）：S1 落潮滩 / S2 守塔人小屋 / S3 灯塔共用的部分。
 * - 环境：雾、天空、半球光、主光（阴影）、水面、细雨（室内场景可关掉水面 / 雨）
 * - 玩家（createPlayer）、第三人称相机、物理、交互系统
 * - 入口点：spawns（`-spawn-<id>`）；进场时用 GameFlow 给的入口 id（场景出口带过来），没有就用默认入口
 * - 出口：addExit() 放 SceneExit 触发体，走进去 → GameFlow.goToLevel（黑场 1.0 s、加载、存档）
 * - 进场：建立镜头（GDD §4，3 s）；镜头结束后后台预加载下一个场景的资源组（GDD §14）
 * - 存档点 = 关卡 id（s1 / s2 / s3），SceneManager 切换时自动存（黑场中）
 * 子类只负责 buildLevel()：地形 / 道具 / 碰撞 / 入口点 / 出口 / 可交互物。
 */
export abstract class LevelScene extends BaseScene {
  override usePostFX = true;
  readonly level: LevelDef;

  protected entities = new EntityManager(this.scene);
  protected physics = new PhysicsSystem();
  protected cameraFollow: CameraFollowSystem;
  protected rig!: PlayerRig;
  protected sky = new SkyDome(170);
  protected water: Water | null = null;
  protected rain: Rain | null = null;
  /**
   * 028 远景（README-028 §3）：天空层剪影按预设换色；fog 'none' = 不吃雾（S1 天空层小灯塔），'mid' = 用预设主岛 hint（S2 远景 S3 灯塔）。
   * 子类 buildLevel 里登记；applyAtmosphere 统一设置。
   */
  protected readonly farSilhouettes: Array<{ handle: SkyLayerHandle; fog: 'none' | 'mid' }> = [];
  /** 028 主岛 / 灯塔（fogLayer 'mid'）的按物体雾：密度按预设 fogDensityHint 覆盖 GLB extras */
  protected readonly midFogs: ObjectFogHandle[] = [];
  protected sun = new THREE.DirectionalLight();
  protected hemi = new THREE.HemisphereLight();
  interaction!: InteractionSystem;
  /** 三级提示（007）：谜题区域在 buildInteractables 里用 this.hints.add({ id, zone, l1, … }) 登记（013–015） */
  hints!: HintSystem;
  /** 潮汐（011）：S1 / S3 在 buildLevel / buildInteractables 里 this.tides.add(new TideController(…))；有主分区时水面高度跟随潮位 */
  readonly tides = new TideSet();
  /** 潮汐钟（011）：每帧摆动 */
  protected readonly bells: TideBell[] = [];
  /** 032 推动循环音（木筏 sfx-raft-push-loop） */
  protected pushLoop: PushLoop | null = null;
  /** 032 脚步（按距离 + 地面材质）与环境音（按场景 / 室内外交叉淡化） */
  protected footsteps: Footsteps | null = null;
  protected ambience: Ambience | null = null;

  /** 入口点（buildLevel 里登记；也可以从模型 collectSceneMarkers 收集） */
  readonly spawns = new Map<string, SpawnPoint>();
  /** 出口（addExit 创建） */
  readonly exits: SceneExit[] = [];
  /** 本次进入用的入口 id */
  entryId = '';
  /** 场景有没有室外水面 / 雨（室内场景关掉） */
  protected outdoor = true;
  /** 进入时显示的地名标题（HUD，文本表 ch1.sN.location.title；地名以 gdd §5.5 世界观名词表为准） */
  protected abstract readonly locationId: TextId;
  /** 进入时设置的当前目标（日志顶部）；null = 不改 */
  protected goalId: TextId | null = null;
  /** 建立镜头结束后是否后台预加载下一个场景（沙盒关掉） */
  protected preloadNext = true;
  private disposed = false;
  private pendingExits: SceneExitOptions[] = [];

  constructor(game: Game, level: LevelDef) {
    super(game);
    this.level = level;
    this.savePoint = { chapterId: 'ch1', sceneId: level.id };
    this.atmosphere = getAtmosphere();
    this.cameraFollow = new CameraFollowSystem(this.camera, game.input, {
      physics: this.physics,
      events: game.events,
      isRunning: () => this.rig.controller.running,
      autoRecenter: () => game.settings.all.autoRecenter,
    });
  }

  /** 搭建场景内容：地形、道具、碰撞、入口点（this.spawns）、出口（this.addExit） */
  protected abstract buildLevel(): void;
  /** 可交互物（this.interaction 已就绪、玩家已创建） */
  protected buildInteractables(): void {}
  /** 场景边界：每个物理步之后把角色限制在可走区域里（默认不限制） */
  protected clampPlayer(_p: THREE.Vector3): void {}
  /** 进入完成后的场景专属逻辑（事件订阅等）。cleanups 里登记清理 */
  protected afterEnter(): void {}

  /** 附近没有可交互物时的提示（S2 观察点「按住右键 观察」）；默认无 */
  protected extraPrompt(): string | null {
    return null;
  }

  /** 放一个出口（buildLevel 里调用）：走进触发体 → 去 target 场景的 entry 入口 */
  protected addExit(opts: Omit<SceneExitOptions, 'player' | 'onEnter'>): void {
    this.pendingExits.push({
      ...opts,
      player: () => this.rig.body.position,
      onEnter: (exit) => void this.game.flow.goToLevel(exit.target, exit.entry),
    });
  }

  override enter(): void {
    const a = this.atmosphere!;
    this.buildEnvironment(a);
    this.buildLevel();
    const spawn = this.pickSpawn();
    this.buildPlayer(spawn);
    this.buildInteraction();
    const [hints, unbindHints] = createSceneHints(this.game, this.interaction, this.scene);
    this.hints = hints;
    this.cleanups.push(unbindHints);
    this.buildInteractables();
    for (const opts of this.pendingExits) {
      const e = new Entity(`exit-${opts.target}`, new THREE.Object3D());
      const exit = e.add(new SceneExit(opts));
      this.entities.add(e);
      this.exits.push(exit);
    }
    this.pendingExits = [];
    this.applyAtmosphere(a);
    this.applyQuality();

    // 掉出世界（理论上不会发生）：黑场送回本次入口
    this.physics.onFallOut = () => void this.rig.controller.teleportTo(spawn.position);
    // 潮水送回（011）：水深 > 0.3 m → 黑场 0.5 s 送回分区安全点 + 「水太冷了。」
    this.tides.onRecall = (zone) => recallToSafePoint(this.game, this.rig, zone);
    if (this.goalId) this.game.narrative.setGoal(this.goalId);

    const { events, audio, ui } = this.game;
    this.pushLoop = new PushLoop(events);
    this.footsteps = new Footsteps(events, this.level.id);
    const amb = AMBIENCE[this.level.id];
    this.ambience = amb ? new Ambience(events, amb) : null;
    this.cleanups.push(
      events.on('quality:changed', () => this.applyQuality()),
      events.on('player:land', ({ impactSpeed }) => {
        if (impactSpeed > 4) audio.beep(90, 0.1, 'triangle', Math.min(0.08, impactSpeed * 0.006));
      }),
      () => this.interaction.dispose(),
      () => this.cameraFollow.dispose(),
      bindSfxFallback(events, audio, (id) => this.game.assets.getAudio(id)),
      () => this.pushLoop?.dispose(),
      bindPuzzleSfx(events),
      () => {
        for (const b of this.bells) b.dispose();
      },
    );

    ui.hud.show();
    ui.hud.setHint(keyHintHtml(t('ui.hud.controls')));
    ui.hud.setLocation(t(this.locationId));
    this.afterEnter();
    const est = this.playEstablishing(spawn);
    // 建立镜头结束（玩家可操作）后再后台预加载下一个场景：不和首场景加载 / 画质检测抢带宽和主线程；
    // 画质检测在慢机器上可能拖住建立镜头，所以最晚进场 PRELOAD_FALLBACK_MS 后也开始预加载（重复调用无副作用）
    const preload = (): void => {
      if (!this.disposed && this.preloadNext) this.game.flow.preloadNext(this.level);
    };
    void est.then(preload);
    const timer = window.setTimeout(preload, PRELOAD_FALLBACK_MS);
    this.cleanups.push(() => window.clearTimeout(timer));
  }

  private pickSpawn(): SpawnPoint {
    const want = this.game.flow.takeEntry();
    const id = want && this.spawns.has(want) ? want : this.level.defaultEntry;
    if (want && !this.spawns.has(want)) console.warn(`[scene] ${this.name} 没有入口 ${want}，用默认入口 ${id}`);
    this.entryId = id;
    return this.spawns.get(id) ?? this.spawns.values().next().value ?? { position: new THREE.Vector3(), yaw: 0 };
  }

  /** 建立镜头关键帧（默认：从入口后上方高处缓慢推向角色身后）；子类可覆盖 */
  protected establishingKeys(spawn: SpawnPoint): CameraKey[] {
    const p = spawn.position;
    const f = new THREE.Vector3(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
    const r = new THREE.Vector3(Math.cos(spawn.yaw), 0, -Math.sin(spawn.yaw));
    const T = gameplay.camera.establishingTime;
    return [
      {
        time: 0,
        position: p.clone().addScaledVector(f, -9).addScaledVector(r, 4).add(new THREE.Vector3(0, 5.5, 0)),
        lookAt: p.clone().addScaledVector(f, 10).add(new THREE.Vector3(0, 2.5, 0)),
        fov: 50,
      },
      {
        time: T,
        position: p.clone().addScaledVector(f, -5).addScaledVector(r, 1.2).add(new THREE.Vector3(0, 2.6, 0)),
        lookAt: p.clone().addScaledVector(f, 2).add(new THREE.Vector3(0, 1.2, 0)),
        fov: 55,
      },
    ];
  }

  /** 建立镜头的额外等待条件（S1：画质检测第一轮） */
  protected establishingHold(): (() => boolean) | undefined {
    return undefined;
  }

  /**
   * 开场演出被跳过时接着播的镜头（默认无 = 直接跳到最后一帧）。
   * v0.1-013 制作人裁定：S1 在画质检测第 1 轮没测完时返回 3 s 不可跳过（skippable: false）的建立镜头，播完仍按 hold 最多再等 5 s。
   */
  protected establishingAfterSkip(_spawn: SpawnPoint, _hold: (() => boolean) | undefined): CameraTrack | null {
    return null;
  }

  /** 建立镜头（GDD §4：进入场景 3 s 低速推轨，结束交还控制；按住空格可跳过） */
  private playEstablishing(spawn: SpawnPoint): Promise<void> {
    const hold = this.establishingHold();
    const track = new CameraTrack({
      name: 'establishing',
      duration: gameplay.camera.establishingTime,
      ...(hold ? { holdUntil: hold } : {}),
      keys: this.establishingKeys(spawn),
      onSkip: () => this.establishingAfterSkip(spawn, hold),
    });
    return this.cameraFollow.playEstablishing(track);
  }

  // ---------------------------------------------------------------- 搭建

  private buildEnvironment(a: AtmospherePreset): void {
    this.scene.fog = new THREE.FogExp2(a.fogColor, a.fogDensity);
    this.scene.background = new THREE.Color(a.fogColor);
    // 028 天空：三段渐变 + 层云（贴图缺失 / ?art=0 时只有渐变）
    this.sky.setClouds(this.game.assets.has(SKY_CLOUDS_KEY) ? this.game.assets.getTexture(SKY_CLOUDS_KEY) : null);
    this.scene.add(this.sky);
    this.scene.add(this.hemi);

    const s = this.sun;
    s.castShadow = true;
    s.shadow.camera.left = -26;
    s.shadow.camera.right = 26;
    s.shadow.camera.top = 26;
    s.shadow.camera.bottom = -26;
    s.shadow.camera.near = 1;
    s.shadow.camera.far = 90;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.03;
    this.scene.add(s, s.target);

    if (this.outdoor) {
      this.water = new Water(600, 200, a.waterColor);
      this.water.position.y = -0.6;
      this.scene.add(this.water);
      this.rain = new Rain();
      this.scene.add(this.rain);
    }
  }

  private buildInteraction(): void {
    this.interaction = new InteractionSystem({
      events: this.game.events,
      input: this.game.input,
      physics: this.physics,
      actor: actorFromRig(this.rig),
      camera: this.camera,
      cameraFollow: this.cameraFollow,
      hud: this.game.ui.hud,
      // inspect → 字幕（汐的一句描述，text-ch1 §0.10）；read → 阅读界面（首次阅读写进日志）
      presenters: {
        say: (id) => this.game.ui.subtitles.play([id]),
        read: (id) => this.game.ui.reader.open(id),
      },
      // 跨越点（TraversalLink，S1 浮台）：附近没有可交互物时显示跨越提示
      fallbackPrompt: () => this.extraPrompt() ?? this.rig.controller.nearLink?.prompt ?? null,
      linkPriority: () => this.rig?.controller.nearLink?.priority ?? null,
    });
  }

  private buildPlayer(spawn: SpawnPoint): void {
    this.rig = createPlayer(this.game, this.physics, spawn.position, () => this.cameraFollow.yaw);
    this.rig.controller.facing = spawn.yaw + Math.PI;
    this.entities.add(this.rig.entity);
    this.cameraFollow.target = this.rig.entity.object3D;
    this.cameraFollow.yaw = spawn.yaw;
    this.cameraFollow.pitch = spawn.pitch ?? -0.22;
    // 推荐构图（自动回正的目标）
    this.cameraFollow.recommended = { yaw: spawn.yaw, pitch: spawn.pitch ?? -0.22 };
  }

  // ---------------------------------------------------------------- 参数应用

  protected applyAtmosphere(a: AtmospherePreset): void {
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(a.fogColor);
    fog.density = a.fogDensity;
    (this.scene.background as THREE.Color).set(a.fogColor);
    this.sky.applyAtmosphere(a);
    this.hemi.color.set(a.hemiSky);
    this.hemi.groundColor.set(a.hemiGround);
    this.hemi.intensity = a.hemiIntensity;
    this.sun.color.set(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.sun.position.set(...a.sunDirection);
    this.water?.material.color.set(a.waterColor);
    this.rain?.applyAtmosphere(a);
    for (const f of this.midFogs) f.density = a.midFogDensity;
    for (const s of this.farSilhouettes) applySkyLayerAtmosphere(s.handle, a, s.fog === 'mid' ? a.midFogDensity : 0);
    this.game.postfx.applyAtmosphere(a);
  }

  protected applyQuality(): void {
    const q = this.game.quality.preset;
    this.camera.far = q.viewDistance;
    this.camera.updateProjectionMatrix();
    this.rain?.setCount(q.rainParticles.count);
    // 阴影贴图尺寸 = §8 shadowType.mapSize（CSM 级数 / PCSS / 接触阴影在 023 做）；尺寸变了就丢掉旧贴图，下一帧按新尺寸重建
    const s = this.sun.shadow;
    const size = q.shadowType.mapSize;
    if (s.mapSize.width !== size) {
      s.mapSize.set(size, size);
      s.map?.dispose();
      s.map = null;
    }
    s.radius = q.shadowRadius;
    s.blurSamples = 16;
    this.sun.castShadow = true;
    // LOD 切换距离随档位变化；puzzleCritical 物体不受影响
    applyLodDistances(this.scene, q.lodDistances);
  }

  // ---------------------------------------------------------------- 循环

  override fixedUpdate(dt: number): void {
    if (!this.rig) return;
    // 场景切换黑场期间：角色停住（新场景会重新创建角色，不用解锁）
    if (this.game.flow.transitioning) this.rig.controller.locked = true;
    this.interaction.fixedUpdate(dt);
    this.pushLoop?.update(dt);
    this.entities.fixedUpdate(dt);
    // 潮汐在角色物理之前：浮物（dynamic 碰撞体）先移动，站在上面的角色被带着走
    this.tides.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
    this.clampPlayer(this.rig.body.position);
    const pb = this.rig.body.body;
    const indoor = this.cameraFollow.indoor;
    this.footsteps?.update({ dist: Math.hypot(pb.actualVelocity.x, pb.actualVelocity.z) * dt, onGround: pb.onGround, running: this.rig.controller.running, busy: this.rig.controller.busy, ground: pb.ground?.name, indoor });
    this.ambience?.update(dt, { indoor, pos: this.rig.body.position });
    this.tides.checkRecall({ position: this.rig.body.position, onGround: this.rig.body.body.onGround, busy: this.rig.controller.busy });
    this.hints.fixedUpdate(dt, this.rig.body.position);
  }

  override update(dt: number, alpha: number): void {
    if (!this.rig) return;
    this.entities.update(dt, alpha);
    this.cameraFollow.update(dt);
    this.interaction.update(dt);
    if (this.game.ui.debug.visible) {
      this.game.ui.debug.set('角色', debugPlayerLine(this.rig, this.physics));
      this.game.ui.debug.set('相机', this.cameraFollow.debugLine());
      this.game.ui.debug.set('提示', this.hints.debugLine());
      if (this.tides.zones.length) this.game.ui.debug.set('潮汐', this.tides.debugLine());
      this.game.ui.debug.set('场景', `${this.name} · 入口 ${this.entryId} · 资源组 ${this.game.assets.loadedGroups.join(' ')}`);
    }
    this.sky.follow(this.camera);
    this.sky.update(dt);
    if (this.water && this.tides.primary) this.water.setLevel(this.tides.primary.level);
    this.water?.update(dt);
    for (const b of this.bells) b.update(dt);
    this.rain?.update(dt, this.camera);
    // 汐淋雨变湿（室外有雨）；室内（场景的 -indoor 触发体：S2 小屋 / 地窖、S3 塔内）/ 无雨慢慢干
    if (this.rig.look) this.rig.look.wetTarget = xiWetTarget(!!this.rain?.visible, this.rig.entity.object3D.position, this.cameraFollow.indoorVolumes);
    // 阴影相机跟随玩家（保证近处阴影精度），光照方向不变
    const a = this.atmosphere!;
    const p = this.rig.entity.object3D.position;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.set(p.x + a.sunDirection[0], a.sunDirection[1], p.z + a.sunDirection[2]);
  }

  /** 角色位置（测试用） */
  get playerPosition(): THREE.Vector3 {
    return this.rig.body.position;
  }

  override exit(): void {
    this.game.ui.hud.hide();
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.setSecondaryPrompt(null);
  }

  override dispose(): void {
    this.disposed = true;
    this.entities.clear();
    this.physics.clear();
    super.dispose();
  }
}
