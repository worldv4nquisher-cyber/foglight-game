import * as THREE from 'three';
import { BaseScene } from './BaseScene';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import { getAtmosphere, type AtmospherePreset } from '@/config/atmosphere';
import { EntityManager } from '@/entities/EntityManager';
import { Entity } from '@/entities/Entity';
import { createPlayer, debugPlayerLine, type PlayerRig } from '@/entities/createPlayer';
import { Spinner } from '@/entities/components/Spinner';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { CameraFollowSystem, CameraTrack } from '@/systems/CameraFollowSystem';
import { SkyDome } from '@/world/SkyDome';
import { Water } from '@/world/Water';
import { Rain } from '@/world/Rain';
import { Lighthouse } from '@/world/Lighthouse';
import { Interactable } from '@/systems/interaction/Interactable';
import { InteractionSystem, actorFromRig } from '@/systems/interaction/InteractionSystem';
import { t } from '@/content/text';
import { applyLodDistances, describeLods } from '@/render/lod';

const ISLAND_RADIUS = 18;
const SPAWN = new THREE.Vector3(-1.5, 0.01, 10);

/** 简单可复现的伪随机（让占位岩石每次布局一致） */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 主场景（v0.1 占位 demo）：阴暗海岛。
 * 海岛地面 + 起伏水面 + 岩石 + 旋转立方体 + 胶囊主角（WASD / Shift / 指针锁定转视角）+ 第三人称相机 + 灯塔暖光对比 + 细雨。
 * 氛围参数全部来自 config/atmosphere.ts。
 */
export class MainScene extends BaseScene {
  readonly name = 'main';
  override usePostFX = true;

  private entities = new EntityManager(this.scene);
  private physics = new PhysicsSystem();
  private cameraFollow: CameraFollowSystem;
  /** 灰盒阶段的唯一玩法场景，先当作 S1 入口存档（场景流程 010 拆出 s1/s2/s3 后各自声明） */
  override savePoint = { chapterId: 'ch1', sceneId: 'main' };
  private rig!: PlayerRig;
  private sky = new SkyDome(170);
  private water!: Water;
  private rain = new Rain();
  private lighthouse = new Lighthouse();
  private sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  interaction!: InteractionSystem;

  constructor(game: Game) {
    super(game);
    this.atmosphere = getAtmosphere();
    this.cameraFollow = new CameraFollowSystem(this.camera, game.input, {
      physics: this.physics,
      events: game.events,
      isRunning: () => this.rig.controller.running,
      autoRecenter: () => game.settings.all.autoRecenter,
    });
  }

  override enter(): void {
    const a = this.atmosphere!;
    this.buildEnvironment(a);
    this.buildIsland();
    this.buildProps();
    this.buildPlayer();
    this.applyAtmosphere(a);
    this.applyQuality();

    // 掉出世界（理论上不会发生）：黑场送回出生点
    this.physics.onFallOut = () => void this.rig.controller.teleportTo(SPAWN);
    this.buildInteraction();

    const { events, audio, ui } = this.game;
    this.cleanups.push(
      events.on('quality:changed', () => this.applyQuality()),
      events.on('player:land', ({ impactSpeed }) => {
        if (impactSpeed > 4) audio.beep(90, 0.1, 'triangle', Math.min(0.08, impactSpeed * 0.006));
      }),
      // demo 灯塔（v0.1-004 起走 Interactable：use，不走位，按 E 切换）
      events.on('interact:used', ({ id }) => {
        if (id !== 'lighthouse') return;
        this.lighthouse.toggle();
        audio.beep(this.lighthouse.on ? 440 : 160, 0.25, 'sine', 0.05);
      }),
      () => this.interaction.dispose(),
    );

    ui.hud.show();
    ui.hud.setHint(
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>Shift</kbd> 小跑　' +
        '<kbd>点击画面</kbd> 锁定鼠标转视角　<kbd>E</kbd> 互动　<kbd>右键</kbd> 观察　<kbd>滚轮</kbd> 远近　<kbd>Esc</kbd> 暂停',
    );
    ui.hud.setLocation('雾岬 · 第一座灯塔');
    this.cleanups.push(() => this.cameraFollow.dispose());
    // 首次启动后第一次进入 S1：3 秒画质自动检测和建立镜头同时进行（009；开场演出做好后挪到演出最后 3 s，035）
    this.game.benchmark.start();
    this.playEstablishing();
  }

  /** 建立镜头（GDD §4：进入场景 3 s 低速推轨，从海面高处缓慢推向角色身后，结束交还控制；按住空格可跳过） */
  private playEstablishing(): void {
    const p = SPAWN;
    const track = new CameraTrack({
      name: 'establishing',
      duration: gameplay.camera.establishingTime,
      keys: [
        { time: 0, position: new THREE.Vector3(p.x + 6, 6.5, p.z + 12), lookAt: new THREE.Vector3(8, 4, -10), fov: 50 },
        { time: gameplay.camera.establishingTime, position: new THREE.Vector3(p.x + 1.6, 2.6, p.z + 5), lookAt: new THREE.Vector3(p.x, 1.2, p.z - 2), fov: 55 },
      ],
    });
    void this.cameraFollow.playEstablishing(track);
  }

  // ---------------------------------------------------------------- 搭建

  private buildEnvironment(a: AtmospherePreset): void {
    this.scene.fog = new THREE.FogExp2(a.fogColor, a.fogDensity);
    this.scene.background = new THREE.Color(a.fogColor);
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

    this.water = new Water(600, 200, a.waterColor);
    this.water.position.y = -0.6;
    this.scene.add(this.water);

    this.scene.add(this.rain);
  }

  private buildIsland(): void {
    // 海岛：顶面平整（y=0），侧面用噪声扰动出礁石感
    const geo = new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 4, 3, 64, 3);
    const pos = geo.getAttribute('position');
    const rnd = mulberry32(7);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 1.49) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const k = 1 + (rnd() - 0.5) * 0.12;
        pos.setXYZ(i, x * k, y + (rnd() - 0.5) * 0.4, z * k);
      }
    }
    geo.computeVertexNormals();
    const island = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x585e57, roughness: 0.96, flatShading: true }),
    );
    island.position.y = -1.5;
    island.receiveShadow = true;
    island.castShadow = true;
    island.name = 'island';
    this.scene.add(island);

    // 物理：一块大地面碰撞体（顶面 y=0），岛屿边缘用圆形边界限制（见 clampToIsland）
    this.physics.addBox(new THREE.Box3(new THREE.Vector3(-30, -5, -30), new THREE.Vector3(30, 0, 30)));
  }

  private buildProps(): void {
    const rnd = mulberry32(42);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7173, roughness: 0.92, flatShading: true });
    const occluders: THREE.Object3D[] = [];

    // 散落的岩石方块（可碰撞；本作没有跳跃，0.3 m 以下才能迈上去）
    const rocks: Array<[number, number, number, number, number, number]> = [
      // x, z, 宽, 高, 深, 旋转
      [-6, 3, 2.2, 1.0, 1.8, 0],
      [-8.5, -2, 3.0, 2.0, 2.4, 0],
      [5, 6, 2.0, 1.4, 2.0, 0],
      [7.5, 3.5, 1.4, 0.7, 1.4, 0],
      [-3, -8, 4.0, 2.6, 2.5, 0],
      [11, 4, 2.5, 1.2, 3.0, 0],
      [-12, 6, 1.8, 0.9, 1.6, 0],
      // 矮石（0.25 m，可以直接迈上去）
      [2.5, 4.5, 1.2, 0.25, 1.0, 0],
    ];
    for (const [x, z, w, h, d, r] of rocks) {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rockMat);
      rock.position.set(x, h / 2, z);
      rock.rotation.y = r;
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
      this.physics.addMesh(rock);
      occluders.push(rock);
    }
    // 岸边不可碰撞的碎石装饰
    for (let i = 0; i < 26; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = ISLAND_RADIUS + rnd() * 3;
      const sz = 0.5 + rnd() * 1.6;
      const deco = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * (0.5 + rnd()), sz * (0.7 + rnd() * 0.6)), rockMat);
      deco.position.set(Math.cos(ang) * rad, -0.4 + rnd() * 0.3, Math.sin(ang) * rad);
      deco.rotation.set(rnd() * 0.6, rnd() * Math.PI, rnd() * 0.6);
      deco.castShadow = deco.receiveShadow = true;
      this.scene.add(deco);
    }

    // 灯塔平台 + 灯塔
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 5), rockMat);
    plinth.position.set(10.5, 1.2, -10.5);
    plinth.castShadow = plinth.receiveShadow = true;
    this.scene.add(plinth);
    this.physics.addMesh(plinth);
    occluders.push(plinth);

    // 通往灯塔平台的石阶：12 级 × 0.2 m（平台西侧）
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * 0.2;
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.36, top, 1.6), rockMat);
      step.position.set(8 - (steps - i) * 0.35 + 0.175, top / 2, -10.5);
      step.castShadow = step.receiveShadow = true;
      this.scene.add(step);
      this.physics.addMesh(step);
    }

    this.lighthouse.position.set(11, 2.4, -11);
    this.scene.add(this.lighthouse);
    this.lighthouse.updateWorldMatrix(true, true);
    this.physics.addObject(this.lighthouse.tower);
    occluders.push(this.lighthouse.tower);

    // 中央：石座 + 自动旋转的占位立方体
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 8), rockMat);
    pedestal.position.set(0, 0.5, 0);
    pedestal.castShadow = pedestal.receiveShadow = true;
    this.scene.add(pedestal);
    this.physics.addMesh(pedestal);

    const cube = new Entity(
      'spinning-cube',
      new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0x6f7c86,
          roughness: 0.35,
          metalness: 0.6,
          emissive: 0x2a3540,
          emissiveIntensity: 0.4,
        }),
      ),
    );
    cube.object3D.castShadow = true;
    cube.object3D.position.set(0, 2.2, 0);
    cube.add(new Spinner(new THREE.Vector3(0.35, 0.8, 0.15), 0.18, 1.2));
    this.entities.add(cube);

    this.buildLodTest(occluders);
    // 相机遮挡改走 physics.sphereCast（同一套碰撞体），occluders 列表只用于登记碰撞
  }

  /**
   * LOD / 解谜关键物体用例（出生点左前方）：test-lod-puzzle-critical.glb 走真实 GLB 加载路径。
   * - 白石 white-stone（父级 extras.puzzleCritical）、刻度柱 tide-gauge（lod0 上标记）：三档都固定 LOD0
   * - 对照石 rock-control：普通 3 级 LOD，按画质档位 lodDistances 切换（LOD1 偏绿、LOD2 偏红）
   * 开发模式控制台：__lods() 查看各 LOD 当前层级。
   */
  private buildLodTest(occluders: THREE.Object3D[]): void {
    if (this.game.assets.isMissing('test-lod-puzzle')) {
      console.info('[lod] 测试模型缺失，运行 npm run assets:test-lod 生成');
      return;
    }
    const group = this.game.assets.getModel('test-lod-puzzle');
    group.name = 'lod-test';
    group.position.set(-5.2, 0, 6.2);
    group.rotation.y = 0.3;
    this.scene.add(group);
    group.updateWorldMatrix(true, true);
    for (const child of group.children) {
      // 模型里有 -collider 网格就用它，否则整个物体（LOD 取 LOD0）当碰撞体
      if (this.physics.addFromModel(child).length === 0) this.physics.addObject(child);
      occluders.push(child);
    }
    if (import.meta.env.DEV) Object.assign(window, { __lods: () => describeLods(group) });
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
      presenters: { say: (id) => this.game.ui.hud.toast(t(id), 3) },
    });
    // 灯塔塔身半径 1.4 m：判定距离从塔身表面算（站在台座上靠近塔即可），焦点取塔门高度
    const base = this.lighthouse.position;
    this.interaction.add(
      new Interactable({
        id: 'lighthouse',
        kind: 'use',
        prompt: 'ui.prompt.operate',
        object: this.lighthouse,
        focus: new THREE.Vector3(base.x, base.y + 1, base.z),
        reach: 1.4,
        approach: false,
      }),
    );
  }

  /** demo 灯塔是否点亮（测试用） */
  get lighthouseOn(): boolean {
    return this.lighthouse.on;
  }

  private buildPlayer(): void {
    this.rig = createPlayer(this.game, this.physics, SPAWN, () => this.cameraFollow.yaw);
    this.entities.add(this.rig.entity);
    this.cameraFollow.target = this.rig.entity.object3D;
    // 初始视角：从岛的南侧望向中央立方体与东北方的灯塔
    this.cameraFollow.yaw = -0.3;
    this.cameraFollow.pitch = -0.22;
    // 推荐构图（自动回正的目标）：望向中央立方体与灯塔
    this.cameraFollow.recommended = { yaw: -0.3, pitch: -0.22 };
  }

  // ---------------------------------------------------------------- 参数应用

  private applyAtmosphere(a: AtmospherePreset): void {
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
    this.water.material.color.set(a.waterColor);
    this.rain.applyAtmosphere(a);
    this.lighthouse.applyAtmosphere(a);
    this.game.postfx.applyAtmosphere(a);
  }

  private applyQuality(): void {
    const q = this.game.quality.preset;
    this.camera.far = q.viewDistance;
    this.camera.updateProjectionMatrix();
    this.rain.setCount(q.rainParticles.count);
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
    // LOD 切换距离随档位变化；puzzleCritical 物体不受影响（加载时已只剩 LOD0，这里也会兜底强制 LOD0）
    applyLodDistances(this.scene, q.lodDistances);
  }

  // ---------------------------------------------------------------- 循环

  override fixedUpdate(dt: number): void {
    if (!this.rig) return;
    this.interaction.fixedUpdate(dt);
    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
    this.clampToIsland();
  }

  /** 圆形岛屿边界：不让玩家走进海里 */
  private clampToIsland(): void {
    const p = this.rig.body.position;
    const r = Math.hypot(p.x, p.z);
    const max = ISLAND_RADIUS - 0.6;
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
  }

  override update(dt: number, alpha: number): void {
    this.entities.update(dt, alpha);
    this.cameraFollow.update(dt);
    this.interaction.update(dt);
    if (this.game.ui.debug.visible) {
      this.game.ui.debug.set('角色', debugPlayerLine(this.rig, this.physics));
      this.game.ui.debug.set('相机', this.cameraFollow.debugLine());
    }
    this.sky.follow(this.camera);
    this.water.update(dt);
    this.rain.update(dt, this.camera);
    this.lighthouse.update(dt);
    // 阴影相机跟随玩家（保证近处阴影精度），光照方向不变
    const a = this.atmosphere!;
    const p = this.rig.entity.object3D.position;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.set(p.x + a.sunDirection[0], a.sunDirection[1], p.z + a.sunDirection[2]);
  }

  override exit(): void {
    this.game.ui.hud.hide();
    this.game.ui.hud.setPrompt(null);
  }

  override dispose(): void {
    this.entities.clear();
    this.physics.clear();
    super.dispose();
  }
}
