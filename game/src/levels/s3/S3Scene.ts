import * as THREE from 'three';
import { applyArtClapperHitRad } from '@/systems/tide/TideBell';
import { findNode, missingGreyboxNodes, mountArtSlots, snapObjectTo, snapToArt, type ArtSlots } from '../artSlots';
import { S3_ART_SLOTS } from './artSlots';
import { interactNode, mountDressing, type MountedDressing } from '../dressing';
import { s3DressingSpecs } from './dressing';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import { beamDebugEnabled, debugEnabled, greyboxVisible, smokeQuery, TEST_BUILD } from '@/config/debug';
import { FatherActor, FATHER_ANIMS_KEY, FATHER_MODEL_KEY } from '@/entities/father/FatherActor';
import { ClipProp } from '@/entities/xi/clipProp';
import { parseFatherMode, type FatherMode } from '@/entities/father/clips';
import { LevelScene, type SpawnPoint } from '@/scenes/LevelScene';
import { LEVELS } from '@/scenes/levels';
import { collectIndoorVolumes } from '@/systems/CameraFollowSystem';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import type { TextId } from '@/content/text';
import type { Collider } from '@/systems/PhysicsSystem';
import { S3, S3_FRAME, alongDoor, cameraYawFacing, toLocal, toWorld } from './layout';
import { buildS3Greybox, defaultS3GreyboxMaterials, setS3FixtureFallbacks, type S3Greybox } from './greybox';
import { buildS3Art, S3_DOOR_PROP_KEY, type S3Art } from './art';
import { buildS3Puzzles, type S3Puzzles } from './puzzles';
import { S3Ending } from './ending';
import { doorLightmapScale } from '@/render/lightmap';
import { EndingMusic } from '@/systems/audio/endingMusic';
import { s3UpperLayerGain } from './music';
import { S3_TOWER_CLOSED_LM } from '@/levels/lightmaps';

/** P3 钢笔（manifest s3 组） */
export const PEN_KEY = 'prop-fountain-pen';

/**
 * S3 初望灯塔（v0.1-015 白盒 + 美术 020 接入；布局见 ./layout.ts，取代 010 的占位 S3LighthouseScene）。
 * - 场景根节点 = S3_WORLD_FRAME（塔心 (39.73, 0, −122.75)，绕 Y 135°）：白盒 / 美术 / 谜题件都在 S3 局部坐标里摆，
 *   出生点、水面、建立镜头按世界坐标算（toWorld）。
 * - 白盒几何是碰撞的唯一来源；美术 GLB 只做外观，加载到了就隐藏白盒（?greybox=1 叠加显示）。
 * - 环境不发暖光：点灯前灯室全暗，暖光只在点灯后打开。
 */
export class S3Scene extends LevelScene {
  readonly name: string = 's3-lighthouse';
  protected readonly locationId = 'ch1.s3.location.title' as const;
  protected override goalId: TextId | null = 'ch1.s3.goal.door';
  frame!: THREE.Group;
  greybox!: S3Greybox;
  art!: S3Art;
  puzzles!: S3Puzzles;
  artSlots: ArtSlots | null = null;
  artSlotGreyboxMissing: string[] = [];
  /** 027 剧情物件 */
  dressing: MountedDressing[] = [];
  private readonly colliderOf = new Map<THREE.Mesh, Collider>();
  private readonly mats = defaultS3GreyboxMaterials();
  private ending = false;
  /** 035 结尾演出（afterEnter 建；点燃那一帧 start） */
  endingCutscene: S3Ending | null = null;
  /** 031 父亲（BUG-023）：有 char-father + anims 才有；默认隐藏，回忆演出（035）/ dev 预览 ?father=gaze|walk|hand 调 playFather */
  father: FatherActor | null = null;
  /** 1031 结尾曲：进场首帧后预取，lighthouse:ignited 那一帧起播（systems/audio/endingMusic.ts） */
  endingMusic: EndingMusic | null = null;
  /** P3 钢笔（挂汐 extras.attach.socket，只在 extras.attach.clip 播放时显示；没有资源 / 白盒时 null） */
  pen: ClipProp | null = null;
  /** 钢笔挂不上的原因（冒烟读） */
  penError: string | null = null;
  private penModel: THREE.Object3D | null = null;

  constructor(game: Game) {
    super(game, LEVELS.s3);
  }

  protected buildLevel(): void {
    // 桥尾出生，面朝灯塔（局部 +X+Z 方向）
    const sp = toWorld(S3.points.spawnFromS2);
    this.spawns.set('from-s2', { position: sp.setY(sp.y + 0.01), yaw: cameraYawFacing([0.7071, 0, 0.7071]), pitch: -0.08 });

    this.frame = new THREE.Group();
    this.frame.name = 's3-frame';
    this.frame.position.set(...S3_FRAME.position);
    this.frame.rotation.y = S3_FRAME.rotationY;
    this.scene.add(this.frame);

    // 海面：LevelScene 的 600 m 水面挪到塔心（机房里的水也是它：底层地面 0.2，低潮 0 不淹、涨潮 1.6 水深 1.4）
    if (this.water) {
      this.water.position.x = S3_FRAME.position[0];
      this.water.position.z = S3_FRAME.position[2];
      this.water.setLevel(S3.tide.high);
    }

    this.greybox = buildS3Greybox(this.mats);
    this.frame.add(this.greybox.root);
    this.frame.updateMatrixWorld(true);
    for (const m of this.greybox.colliders) this.colliderOf.set(m, this.physics.addMesh(m));
    for (const m of this.greybox.walls) this.physics.addMesh(m, { kind: 'wall', blocksCamera: m.userData.blocksCamera === true });
    this.cameraFollow.indoorVolumes = collectIndoorVolumes(this.greybox.root);

    this.art = buildS3Art(this.game.assets);
    this.frame.add(this.art.root);
    if (this.art.door) this.greybox.door.add(this.art.door);
    this.setGreyboxVisible(!this.art.loaded || greyboxVisible);
    this.frame.updateMatrixWorld(true);
  }

  protected override buildInteractables(): void {
    this.puzzles = buildS3Puzzles({
      game: this.game,
      frame: this.frame,
      scene: this.scene,
      physics: this.physics,
      interaction: this.interaction,
      hints: this.hints,
      rig: () => this.rig,
      cameraFollow: this.cameraFollow,
      greybox: this.greybox,
      collider: (m) => this.colliderOf.get(m),
      beamDebug: beamDebugEnabled,
      onIgnite: () => this.lightTheLamp(),
      artRoot: this.art.root,
    });
    this.tides.add(this.puzzles.tide);
    this.bells.push(this.puzzles.bell);
    this.cleanups.push(() => this.puzzles.dispose());
    // 021 / 022 未交付道具的替换入口（文件到了自动挂上，白盒逻辑不变）
    this.artSlots = mountArtSlots(this.game.assets, this.scene, S3_ART_SLOTS, { showGreybox: greyboxVisible });
    // 021 潮汐钟：汐的站位直接读美术 prop-tide-bell-interact（白盒 1.05 m → 模型 0.98 m）
    snapToArt(this.artSlots, 'prop-tide-bell-s3', 'prop-tide-bell-interact', this.puzzles.bell.interactable.interactPoint);
    // 1030c 油阀：站位读美术 prop-oil-valve-s3-interact（手轮正前 0.40 m 地面，+Z 朝手轮；与白盒 vStand 重合）
    snapToArt(this.artSlots, 'prop-oil-valve-s3', 'prop-oil-valve-s3-interact', this.puzzles.valveIx.interactPoint);
    // 1030c 窗口镜：站位读美术 prop-guide-mirror-window-s3-interact（= 白盒 (1.45, 0.2, 0)，+Z 朝镜）
    snapToArt(this.artSlots, 'prop-guide-mirror-window-s3', 'prop-guide-mirror-window-s3-interact', this.puzzles.mirrorIx.window.interactPoint);
    // 1030c 点火口 + 拉杆：站位读美术 prop-ignition-port-s3-interact（= env ignite-lever-interact S3 (1.45, 22, −0.15)，+Z 朝 −X）
    snapToArt(this.artSlots, 'prop-ignition-port-s3', 'prop-ignition-port-s3-interact', this.puzzles.leverIx.interactPoint);
    // 1030c 塔门 prop-lighthouse-door-s3：-interact 在门扇下、跟门转 —— 门还关着（建场景时）缓存它的世界位置给 doorStand，之后不再跟
    if (this.art.door?.name === S3_DOOR_PROP_KEY) snapObjectTo(findNode(this.art.door, 'prop-lighthouse-door-s3-interact'), this.puzzles.doorIx.interactPoint);
    // 钟锤碰壁阈值：美术根 extras.clapperHitRad 优先（1030b 方案 A，缺省 0.055；1030c 重建钟根 0.0537）
    applyArtClapperHitRad(this.puzzles.bell, this.artSlots?.mounted.find((m) => m.id === 'prop-tide-bell-s3')?.model);
    // 027 剧情物件：值班簿 / 点灯说明挂白盒交互物下，摊开的日志放灯室 socket
    this.dressing = mountDressing(this.game.assets, this.scene, s3DressingSpecs(), { showGreybox: greyboxVisible });
    const logFocus = interactNode(this.dressing.find((m) => m.id === 'prop-logbook-s3'));
    if (logFocus) this.interaction.get('logbook-s3')?.setFocus(logFocus);
    this.buildFather();
    this.artSlotGreyboxMissing = missingGreyboxNodes(this.scene, S3_ART_SLOTS);
    if (this.artSlotGreyboxMissing.length) console.warn('[art-slot] 白盒节点名对不上：' + this.artSlotGreyboxMissing.join('、'));
  }

  /**
   * 点灯：xi-ignite-lever 第 34 帧（puzzles.igniteNow → onIgnite）调到这里；灯亮 → 035 结尾演出（levels/s3/ending.ts，按音频时钟走，
   * 1:46 演出结束 / 按住 Space 跳过 → 章节结束页）。0:00–0:04 之间是点灯独白（0.5 s 起 3.0 s，锁定）。
   * smoke / 测试也可直接调用（跳过按 E 演出，同样只发一次 lighthouse:ignited）
   */
  protected override sceneMusicAllowed(): boolean {
    return !this.ending;
  }

  lightTheLamp(): void {
    if (this.ending) return;
    this.ending = true;
    this.puzzles.igniteNow();
    // lighthouse:ignited 已在 igniteNow 里发出（结尾曲同一帧 start(0)）→ 演出 t = 0
    this.endingCutscene?.start();
  }

  private readonly upperTmp = new THREE.Vector3();
  /** 1031：紧张层增益 = 玩家（S3 局部）高度，楼梯底 0 → 灯室 1（levels/s3/music.ts） */
  protected override musicUpperGain(): number {
    return this.rig ? s3UpperLayerGain(toLocal(this.rig.body.position, this.upperTmp)) : 0;
  }

  /** 灯是否亮着（smoke / 测试读） */
  get lighthouseOn(): boolean {
    return this.puzzles?.lamp.on ?? false;
  }

  override fixedUpdate(dt: number): void {
    if (!this.rig) return;
    this.puzzles.fixedUpdate(dt);
    super.fixedUpdate(dt);
  }

  override update(dt: number, alpha: number): void {
    // 父亲先于实体更新：hand-on-head 同一帧里先写汐的 xi-stand-gaze 时间，XiAnimator 再取（两人帧号一一对应）
    // 035 结尾演出：演出时钟推进 → 汐 / 父亲姿势、镜头节点、字幕、雾（父亲时间由演出时钟定，不再按 dt）
    const cut = this.endingCutscene;
    if (cut && this.ending) cut.update();
    else if (this.rig) this.father?.update(dt);
    super.update(dt, alpha);
    if (!this.rig) return;
    this.stepPen();
    this.puzzles.update(dt);
    // 029：塔内按门开 −100° 烘的；门关着按门角把塔内光照贴图压到 S3_TOWER_CLOSED_LM。
    // C 项（035 美术问）：只压塔身室内。灯室在 22 m 高的塔顶、四周 2.3 m 高的玻璃，光照全来自玻璃，塔门在底层、
    // 中间隔着 22 m 楼梯井，开关门对灯室亮度没有可感知的影响 → 灯室（env-lamp-room-ch1）不跟门走，保持 1
    this.setLightmapScale('env-lighthouse-ch1-interior', doorLightmapScale(this.puzzles.state.doorOpen, S3_TOWER_CLOSED_LM));
    this.artSlots?.update();
    if (this.game.ui.debug.visible) {
      const b = this.puzzles.beam;
      const m = b.mirrors;
      const sky = b.sky;
      this.game.ui.debug.set(
        'S3',
        `窗镜 ${m.window.part.angles.map((a) => a.toFixed(1)).join('/')}° · A ${m.a.part.angles[0]}° · B ${m.b.part.angles[0]}° · 天光 ${sky.alwaysOn ? '常亮' : `${sky.skyTime.toFixed(0)}/${sky.periodSec}s ${sky.lit ? '亮' : '暗'}`} · 点火口 ${b.igniter.state} · 阀 ${this.puzzles.state.valveOpen ? '开' : '关'} · 光到 ${this.puzzles.state.reached}/3 · 灯 ${this.lighthouseOn ? '亮' : '灭'}`,
      );
    }
  }

  /** 白盒外观开关（碰撞不变）；门扇和家具在各自美术缺失时保留白盒外观。 */
  setGreyboxVisible(on: boolean): void {
    for (const m of this.greybox.colliders) m.visible = on;
    for (const d of this.greybox.decor) d.visible = on;
    setS3FixtureFallbacks(this.greybox, this.art.root, on);
    this.greybox.doorLeaf.visible = on || !this.art.door;
  }

  protected override afterEnter(): void {
    // 1031 结尾曲：要在点燃那一帧就有 buffer → 进 S3 首帧渲染后就开始下载解码（和场景曲一样不进首场景包）。
    // 演出结束 / 跳过才切章节结束页；结尾曲在结束页上还可能在放（1:46 静音、107 s 文件尾）：补位起播的存活条件是「还在 S3 或已到结束页」
    const { audio, events, assets, scenes } = this.game;
    const ending = new EndingMusic(audio, events, (k) => assets.loadAudio(k), () => scenes.current === this || scenes.current?.name === 'chapter-end');
    this.endingMusic = ending;
    const offFirst = events.on('scene:firstFrame', () => {
      offFirst();
      void ending.prefetch();
    });
    this.cleanups.push(offFirst, () => ending.dispose());
    // 035 结尾演出
    const cut = new S3Ending({
      game: this.game,
      scene: this.scene,
      frame: this.frame,
      rig: () => this.rig,
      cameraFollow: this.cameraFollow,
      father: this.father,
      endingMusic: ending,
      gazePlace: () => this.fatherGazePlace(),
      setAtmosphere: (a) => {
        this.atmosphere = a;
        this.applyAtmosphere(a);
      },
      alive: () => scenes.current === this,
      lampGlassRoot: () => this.art.root.getObjectByName('env-lighthouse-ch1-s3') ?? null,
      lampBeam: () => this.puzzles?.lamp.beam ?? null,
      pen: () => this.pen,
      artPoint: (name) => {
        const node = this.art.root.getObjectByName(name);
        if (!node) return null;
        this.frame.updateMatrixWorld(true);
        return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.frame.matrixWorld.clone().invert());
      },
    });
    this.endingCutscene = cut;
    this.cleanups.push(() => cut.dispose());
    if (import.meta.env.DEV || import.meta.env.MODE === 'smoke') Object.assign(window, { __s3: this }); // 测试构建 / dev 才有（batch25）
    // dev 预览：?father=gaze|walk|hand（dev / 测试构建的 ?debug / ?smoke 才认；生产构建里整段摇树删掉，batch26）
    if (TEST_BUILD && (debugEnabled || smokeQuery)) {
      const preview = parseFatherMode(new URLSearchParams(location.search).get('father'));
      if (preview) void this.playFather(preview);
    }
  }

  /**
   * 031 父亲接入（BUG-023）：char-father（s3 组）挂 S3 frame 下，隐藏；LOD 距离随 applyQuality → applyLodDistances（buildInteractables 之后才调，
   * 所以这里加进场景就会被设上，画质切换时再设）。缺模型或缺动画就不建（白盒 / ?art=0 / 美术没到）。
   */
  private buildFather(): void {
    const a = this.game.assets;
    if (!a.has(FATHER_MODEL_KEY)) return;
    const clips = a.getAnimations(FATHER_ANIMS_KEY);
    if (!clips.length) return;
    this.father = new FatherActor(a.getModel(FATHER_MODEL_KEY), clips);
    this.frame.add(this.father.root);
    if (this.father.missing.length) console.warn('[father] char-father-anims 缺 clip：' + this.father.missing.join('、'));
    this.cleanups.push(() => this.father?.dispose());
  }

  /**
   * P3 钢笔：汐的模型到了就挂（换了 rig 重挂），之后每帧按动画器定显隐（实体更新 = 动画器权重之后、渲染之前）。
   * 资源在 s3 组（进 S3 才加载）；挂点、clip、局部矩阵全读 GLB 根 extras.attach。
   */
  private stepPen(): void {
    const an = this.rig?.animator;
    if (!an) return;
    if (this.penModel !== an.model) {
      this.pen?.dispose();
      this.pen = null;
      this.penModel = an.model;
      if (!this.game.assets.has(PEN_KEY)) return;
      const { prop, error } = ClipProp.mount(this.game.assets.getModel(PEN_KEY), an.model, an);
      this.pen = prop;
      this.penError = error;
      if (error) console.warn(`[pen] ${PEN_KEY} 没挂上：${error}`);
      if (prop) this.cleanups.push(() => prop.dispose());
    }
    this.pen?.update();
  }

  /** 灯室眺望站位（S3 局部）：美术 lamp-room-stand-gaze 节点（矮墙内面前 0.45 m，+Z 朝外）优先，没有用 layout standGaze */
  fatherGazePlace(): { position: THREE.Vector3; facing: THREE.Vector3 } {
    const node = this.art.root.getObjectByName('lamp-room-stand-gaze');
    if (node) {
      this.frame.updateMatrixWorld(true);
      const inv = this.frame.matrixWorld.clone().invert();
      const m = node.matrixWorld.clone().premultiply(inv);
      const position = new THREE.Vector3().setFromMatrixPosition(m);
      const facing = new THREE.Vector3(0, 0, 1).transformDirection(m).setY(0);
      return { position, facing };
    }
    return { position: new THREE.Vector3(...S3.points.standGaze), facing: new THREE.Vector3(...S3.points.standGazeFacing) };
  }

  /**
   * 播父亲的一段（035 回忆演出 / dev 预览调用；没有父亲资源返回 false）：
   * - gaze：灯室眺望站位；
   * - walk：石桥上从桥头走向桥尾（背对塔，1.3 m/s），到头从桥头重来；
   * - hand：汐瞬移到灯室眺望站位、锁输入，父亲按 README-031 §4 对位到汐面前，两人同帧起播（父亲 hand-on-head、汐 xi-stand-gaze 第 0 帧）。
   */
  async playFather(mode: FatherMode): Promise<boolean> {
    const f = this.father;
    if (!f) return false;
    if (mode === 'gaze') f.playGaze(this.fatherGazePlace());
    else if (mode === 'walk') f.playWalk(new THREE.Vector3(...S3.points.bridgeHead), new THREE.Vector3(...S3.points.bridgeExit));
    else {
      const xi = this.rig?.animator;
      if (!xi) return false;
      const g = this.fatherGazePlace();
      const at = g.position.clone().applyMatrix4(this.frame.matrixWorld);
      const dir = g.facing.clone().transformDirection(this.frame.matrixWorld);
      this.rig.controller.locked = true;
      await this.rig.controller.teleportTo(at, { fade: 0, facing: Math.atan2(dir.x, dir.z) });
      this.rig.visual.updateMatrixWorld(true);
      f.playHandOnHead({ model: xi.model, animator: xi });
    }
    return true;
  }

  /** 收起父亲（hand 模式同时解锁汐） */
  hideFather(): void {
    if (this.father?.mode === 'hand' && this.rig) this.rig.controller.locked = false;
    this.father?.hide();
  }

  /** 建立镜头（3 s）：桥尾外侧低机位看石桥 → 塔基仰拍塔身 → 角色身后（塔外礁石上的冷光预告在画面右侧） */
  protected override establishingKeys(spawn: SpawnPoint): CameraKey[] {
    const T = gameplay.camera.establishingTime;
    const p = spawn.position;
    const f = new THREE.Vector3(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
    const r = new THREE.Vector3(Math.cos(spawn.yaw), 0, -Math.sin(spawn.yaw));
    return [
      { time: 0, position: toWorld(alongDoor(30, 4.5, 4.2)), lookAt: toWorld(alongDoor(12, 0, 5)), fov: 48 },
      { time: T * 0.55, position: toWorld(alongDoor(11, -2.5, 3.6)), lookAt: toWorld([0, 17, 0]), fov: 50 },
      {
        time: T,
        position: p.clone().addScaledVector(f, -5).addScaledVector(r, 1.2).add(new THREE.Vector3(0, 2.6, 0)),
        lookAt: p.clone().addScaledVector(f, 2).add(new THREE.Vector3(0, 1.2, 0)),
        fov: 55,
      },
    ];
  }
}
