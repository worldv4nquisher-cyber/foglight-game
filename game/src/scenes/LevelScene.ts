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
import { Water, WATER_NORMAL_KEY, RAIN_RIPPLE_KEY } from '@/world/Water';
import { ATMO028, type Atmo028Tier } from '@/config/atmosphere028';
import { Rain, RAIN_STREAK_KEY, RAIN_SPLASH_KEY, collectIndoorShapes } from '@/world/Rain';
import { applyLodDistances } from '@/render/lod';
import { applySceneLightmaps, presetLightmapScale, type LightmapHandle } from '@/render/lightmap';
import { lightmapEnabled } from '@/config/debug';
import { manifest } from '@/assets/manifest';
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
import { switchMusic, switchMusicLazy, switchLayeredMusicLazy, musicTrackGain } from '@/systems/audio/music';
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
  /** v0.1-029 本场景挂上的光照贴图（每个 GLB 根一个）；倍率 = 预设（雨夜 ×0.35）× doorScale（开门角等，子类设） */
  protected readonly lightmaps: LightmapHandle[] = [];
  /** 每个光照贴图根的附加倍率（S3 塔门 / S2 地窖门，key = 根上 userData.name） */
  protected readonly lightmapExtraScale = new Map<string, number>();
  private lightmapPresetScale = 1;
  private readonly viewSize = new THREE.Vector2();
  private qualityTier: Atmo028Tier = 'high';
  /** 028 镜头水滴：ultra + 下雨 + 过场（cutsceneOnly）才开，fadeIn 0.6 s；?lens=1 强制（截图 / 调试） */
  private lensAmt = 0;
  private readonly lensForced = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lens') === '1';
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
  /** 033 改：懒加载场景曲的调试记录（冒烟读）——首帧时刻、发起请求时刻（performance.now() ms）、结果 */
  musicFirstFrameAt: number | null = null;
  musicRequestedAt: number | null = null;
  musicLazyResult: string | null = null;
  /** 1031：同步上层的结果（with-base 同时起播 / aligned 晚到对齐 / missing …） */
  musicUpperResult: string | null = null;
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
    // BUG-020：雨丝 / 溅水的室内剔除体积 = 场景里所有 -indoor 节点（白盒按 layout 生成；美术 GLB 带的也算）
    this.rain?.setIndoor(collectIndoorShapes(this.scene));
    this.attachLightmaps();
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
    // 033 / 036：场景曲（LevelDef.music）和上一首（主菜单曲 / 上一场景曲）2 s 交叉淡化；没有场景曲则上一首淡出。
    // 033 改（制作人 c0d81c9 反馈）：懒加载的场景曲（S1 mus-s1-ebb-shore）不随组预下载——本场景首帧真正渲染出来后
    // 才 loadAudio，解码完再交叉淡化（上一首已停就从 0 淡入）；404 / 超时 → 上一首照常淡出、不放音乐、不报错
    const music = this.level.music;
    if (music !== null && manifest.some((e) => e.key === music && e.type === 'audio' && e.lazy)) {
      const offFirst = events.on('scene:firstFrame', ({ at }) => {
        offFirst();
        if (this.disposed) return;
        this.musicRequestedAt = performance.now();
        this.musicFirstFrameAt = at;
        const upper = this.level.musicUpper;
        if (upper) {
          // 1031 S3 两层：并行下载；都到了同一时刻起播，只到底层先放底层、上层到了按底层位置对齐（见 switchLayeredMusicLazy）
          void switchLayeredMusicLazy(audio, (k) => this.game.assets.loadAudio(k), music, upper, () => !this.disposed, () => this.upperLayerLevel()).then((r) => {
            this.musicLazyResult = r.base;
            this.musicUpperResult = r.upper;
          });
        } else
          void switchMusicLazy(audio, (k) => this.game.assets.loadAudio(k), music, () => !this.disposed).then((r) => {
            this.musicLazyResult = r;
          });
      });
      this.cleanups.push(offFirst);
    } else switchMusic(audio, (k) => this.game.assets.getAudio(k), music);
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
      const tex = (k: string): THREE.Texture | null => (this.game.assets.has(k) ? this.game.assets.getTexture(k) : null);
      this.water.setDetail(tex(WATER_NORMAL_KEY), tex(RAIN_RIPPLE_KEY));
      this.scene.add(this.water);
      // 028 雨：ultra / high 带贴图细长 quad、standard 1 px 线；溅水落点 = 物理射线（地面 / 礁石）与水面取高者
      this.rain = new Rain(46, 26, tex(RAIN_STREAK_KEY), tex(RAIN_SPLASH_KEY));
      const down = new THREE.Vector3(0, -1, 0);
      const from = new THREE.Vector3();
      this.rain.setGround((x, z, fromY) => {
        const d = this.physics.raycast(from.set(x, fromY, z), down, 40);
        const ground = d === null ? null : fromY - d;
        const water = this.water ? this.water.level : null;
        if (ground === null) return water;
        return water === null ? ground : Math.max(ground, water);
      });
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
    this.lightmapPresetScale = presetLightmapScale(a.hemiIntensity);
    this.updateLightmapScales();
    this.sun.color.set(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.sun.position.set(...a.sunDirection);
    this.water?.applyAtmosphere(a);
    this.rain?.applyAtmosphere(a);
    for (const f of this.midFogs) f.density = a.midFogDensity;
    for (const s of this.farSilhouettes) applySkyLayerAtmosphere(s.handle, a, s.fog === 'mid' ? a.midFogDensity : 0);
    this.game.postfx.applyAtmosphere(a);
  }

  /**
   * v0.1-029：按 GLB 根 extras.lightmap 挂光照贴图。只用本场景资源组登记的贴图
   * （S1 的中景塔 / S2 远景塔同一个 GLB 根上也写着 tex-s3-tower，不挂，照旧半球光 + 雾）。
   */
  private attachLightmaps(): void {
    if (!lightmapEnabled) return;
    const own = new Set(manifest.filter((m) => m.group === this.level.group && m.type === 'ktx2').map((m) => m.key));
    const assets = this.game.assets;
    const handles = applySceneLightmaps(this.scene, (k) => (own.has(k) && assets.has(k) ? assets.getTexture(k) : null));
    this.lightmaps.push(...handles);
  }

  /** 关卡逻辑改了附加倍率（开门角）后调用 */
  protected setLightmapScale(rootName: string, k: number): void {
    if (this.lightmapExtraScale.get(rootName) === k) return;
    this.lightmapExtraScale.set(rootName, k);
    this.updateLightmapScales();
  }

  private updateLightmapScales(): void {
    for (const h of this.lightmaps) {
      const name = (h.root.userData.name as string | undefined) ?? h.root.name;
      h.setScale(this.lightmapPresetScale * (this.lightmapExtraScale.get(name) ?? 1));
    }
  }

  protected applyQuality(): void {
    const q = this.game.quality.preset;
    this.camera.far = q.viewDistance;
    this.camera.updateProjectionMatrix();
    this.rain?.setTier(q.tier, q.rainParticles.count);
    this.qualityTier = q.tier;
    this.water?.setRipples(ATMO028.rainTiers[q.tier].ripples);
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

  /** 1031：同步上层增益（0–1，LevelDef.musicUpper 有才用；默认 0，S3 按玩家高度） */
  protected musicUpperGain(): number {
    return 0;
  }

  /** 上层实际增益 = musicUpperGain() × 上层曲目增益（manifest gainDb） */
  private upperLayerLevel(): number {
    const upper = this.level.musicUpper;
    return upper ? this.musicUpperGain() * musicTrackGain(upper) : 0;
  }

  override update(dt: number, alpha: number): void {
    if (!this.rig) return;
    // 1031：上层（S3 紧张层）增益跟玩家高度走；层还没到 / 结尾曲已接管时 setMusicLayerGain 什么都不做
    if (this.level.musicUpper) this.game.audio.setMusicLayerGain(this.level.musicUpper, this.upperLayerLevel());
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
    if (this.rain) {
      this.rain.setViewHeight(this.game.renderer.getDrawingBufferSize(this.viewSize).y);
      this.rain.update(dt, this.camera);
    }
    this.updateLensDroplets(dt);
    // 汐淋雨变湿（室外有雨）；室内（场景的 -indoor 触发体：S2 小屋 / 地窖、S3 塔内）/ 无雨慢慢干
    if (this.rig.look) this.rig.look.wetTarget = xiWetTarget(!!this.rain?.visible, this.rig.entity.object3D.position, this.cameraFollow.indoorVolumes);
    // 阴影相机跟随玩家（保证近处阴影精度），光照方向不变
    const a = this.atmosphere!;
    const p = this.rig.entity.object3D.position;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.set(p.x + a.sunDirection[0], a.sunDirection[1], p.z + a.sunDirection[2]);
  }

  private updateLensDroplets(dt: number): void {
    const ld = ATMO028.rainTiers.ultra.lensDroplets;
    const raining = !!this.rain?.visible && !this.cameraFollow.indoor;
    const want = raining && this.qualityTier === 'ultra' && (this.lensForced || !ld.cutsceneOnly || this.cameraFollow.cutsceneName !== null);
    const k = dt / ld.fadeIn;
    this.lensAmt = want ? Math.min(1, this.lensAmt + k) : Math.max(0, this.lensAmt - k);
    if (this.lensAmt > 0 || this.game.postfx.lensDroplets > 0) this.game.postfx.setLensDroplets(this.lensAmt);
  }

  /** 角色位置（测试用） */
  get playerPosition(): THREE.Vector3 {
    return this.rig.body.position;
  }

  override exit(): void {
    this.lensAmt = 0;
    this.game.postfx.setLensDroplets(0);
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
