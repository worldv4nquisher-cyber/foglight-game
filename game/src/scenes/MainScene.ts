import * as THREE from 'three';
import { BaseScene } from './BaseScene';
import type { Game } from '@/core/Game';
import { getAtmosphere, type AtmospherePreset } from '@/config/atmosphere';
import { gameConfig } from '@/config/gameConfig';
import { EntityManager } from '@/entities/EntityManager';
import { Entity } from '@/entities/Entity';
import { KinematicBody } from '@/entities/components/KinematicBody';
import { PlayerController } from '@/entities/components/PlayerController';
import { Spinner } from '@/entities/components/Spinner';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { SkyDome } from '@/world/SkyDome';
import { Water } from '@/world/Water';
import { Rain } from '@/world/Rain';
import { Lighthouse } from '@/world/Lighthouse';
import { applyLodDistances, describeLods } from '@/render/lod';

const ISLAND_RADIUS = 18;
const SPAWN = new THREE.Vector3(-1.5, 0.01, 10);
const tmpV = new THREE.Vector3();

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
 * 海岛地面 + 起伏水面 + 岩石 + 旋转立方体 + 胶囊主角（WASD/空格/鼠标拖拽）+ 第三人称相机 + 灯塔暖光对比 + 细雨。
 * 氛围参数全部来自 config/atmosphere.ts。
 */
export class MainScene extends BaseScene {
  readonly name = 'main';
  override usePostFX = true;

  private entities = new EntityManager(this.scene);
  private physics = new PhysicsSystem();
  private cameraFollow: CameraFollowSystem;
  private player!: Entity;
  private playerBody!: KinematicBody;
  private sky = new SkyDome(170);
  private water!: Water;
  private rain = new Rain();
  private lighthouse = new Lighthouse();
  private sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private nearLighthouse = false;

  constructor(game: Game) {
    super(game);
    this.atmosphere = getAtmosphere();
    this.cameraFollow = new CameraFollowSystem(this.camera, game.input);
  }

  override enter(): void {
    const a = this.atmosphere!;
    this.buildEnvironment(a);
    this.buildIsland();
    this.buildProps();
    this.buildPlayer();
    this.applyAtmosphere(a);
    this.applyQuality();

    this.physics.onFallOut = (b) => b.teleport(SPAWN);

    const { events, audio, ui } = this.game;
    this.cleanups.push(
      events.on('quality:change', () => this.applyQuality()),
      events.on('player:jump', () => audio.beep(220, 0.12, 'sine', 0.05)),
      events.on('player:land', ({ impactSpeed }) => {
        if (impactSpeed > 4) audio.beep(90, 0.1, 'triangle', Math.min(0.08, impactSpeed * 0.006));
      }),
    );

    ui.hud.show();
    ui.hud.setHint(
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>Shift</kbd> 快走　<kbd>空格</kbd> 跳跃　' +
        '<kbd>鼠标拖拽</kbd> 转视角　<kbd>E</kbd> 互动　<kbd>Esc</kbd> 暂停　<kbd>F3</kbd> 帧率',
    );
    ui.hud.setLocation('雾岬 · 第一座灯塔');
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
    this.physics.addStaticBox(new THREE.Box3(new THREE.Vector3(-30, -5, -30), new THREE.Vector3(30, 0, 30)));
  }

  private buildProps(): void {
    const rnd = mulberry32(42);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7173, roughness: 0.92, flatShading: true });
    const occluders: THREE.Object3D[] = [];

    // 散落的岩石方块（可碰撞、可跳上去）
    const rocks: Array<[number, number, number, number, number, number]> = [
      // x, z, 宽, 高, 深, 旋转
      [-6, 3, 2.2, 1.0, 1.8, 0],
      [-8.5, -2, 3.0, 2.0, 2.4, 0],
      [5, 6, 2.0, 1.4, 2.0, 0],
      [7.5, 3.5, 1.4, 0.7, 1.4, 0],
      [-3, -8, 4.0, 2.6, 2.5, 0],
      [11, 4, 2.5, 1.2, 3.0, 0],
      [-12, 6, 1.8, 0.9, 1.6, 0],
      // 通往灯塔平台的踏石（逐级升高，用于测试跳跃）
      [3.6, -3.6, 1.4, 0.6, 1.4, 0],
      [5.2, -5.4, 1.4, 1.2, 1.4, 0],
      [6.9, -7.0, 1.4, 1.8, 1.4, 0],
    ];
    for (const [x, z, w, h, d, r] of rocks) {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rockMat);
      rock.position.set(x, h / 2, z);
      rock.rotation.y = r;
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
      this.physics.addStaticFromObject(rock);
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
    this.physics.addStaticFromObject(plinth);
    occluders.push(plinth);

    this.lighthouse.position.set(11, 2.4, -11);
    this.scene.add(this.lighthouse);
    this.lighthouse.updateWorldMatrix(true, true);
    this.physics.addStaticFromObject(this.lighthouse.tower);
    occluders.push(this.lighthouse.tower);

    // 中央：石座 + 自动旋转的占位立方体
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 8), rockMat);
    pedestal.position.set(0, 0.5, 0);
    pedestal.castShadow = pedestal.receiveShadow = true;
    this.scene.add(pedestal);
    this.physics.addStaticFromObject(pedestal);

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
    this.cameraFollow.occluders = occluders;
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
      this.physics.addStaticFromObject(child);
      occluders.push(child);
    }
    if (import.meta.env.DEV) Object.assign(window, { __lods: () => describeLods(group) });
  }

  private buildPlayer(): void {
    const visual = new THREE.Group();
    const model = this.game.assets.getModel('hero', 'capsule', 0x9a8f80);
    if (this.game.assets.isMissing('hero')) {
      // 占位胶囊中心在原点，抬到脚底对齐；加一个「鼻子」标示朝向
      model.position.y = gameConfig.player.height / 2;
      const nose = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.12, 0.25),
        new THREE.MeshStandardMaterial({ color: 0x2d2a26, roughness: 0.8 }),
      );
      nose.position.set(0, 1.45, 0.38);
      nose.castShadow = true;
      visual.add(nose);
    }
    visual.add(model);

    const root = new THREE.Group();
    root.add(visual);
    root.position.copy(SPAWN);
    this.player = new Entity('player', root);
    this.player.tags.add('player');
    this.playerBody = this.player.add(new KinematicBody(gameConfig.player.radius, gameConfig.player.height));
    this.player.add(new PlayerController(this.game.input, () => this.cameraFollow.yaw, this.game.events, visual));
    this.entities.add(this.player);
    this.physics.addBody(this.playerBody);

    this.cameraFollow.target = root;
    // 初始视角：从岛的南侧望向中央立方体与东北方的灯塔
    this.cameraFollow.yaw = -0.3;
    this.cameraFollow.pitch = 0.22;
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
    this.rain.setCount(q.rainCount);
    const s = this.sun.shadow;
    if (s.mapSize.width !== q.shadowMapSize) {
      s.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      s.map?.dispose();
      s.map = null;
    }
    s.radius = q.shadowRadius;
    s.blurSamples = 16;
    this.sun.castShadow = q.shadows;
    // LOD 切换距离随档位变化；puzzleCritical 物体不受影响（加载时已只剩 LOD0，这里也会兜底强制 LOD0）
    applyLodDistances(this.scene, q.lodDistances);
  }

  // ---------------------------------------------------------------- 循环

  override fixedUpdate(dt: number): void {
    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.clampToIsland();
    this.updateInteraction();
  }

  /** 圆形岛屿边界：不让玩家走进海里 */
  private clampToIsland(): void {
    const p = this.playerBody.position;
    const r = Math.hypot(p.x, p.z);
    const max = ISLAND_RADIUS - 0.6;
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
  }

  private updateInteraction(): void {
    tmpV.copy(this.lighthouse.position).sub(this.playerBody.position);
    tmpV.y = 0;
    const near = tmpV.length() < 4.2;
    if (near !== this.nearLighthouse) {
      this.nearLighthouse = near;
      this.game.ui.hud.setPrompt(near ? 'E　熄灭 / 点亮灯塔' : null);
    }
    if (near && this.game.input.consumePressed('interact')) {
      this.lighthouse.toggle();
      this.game.audio.beep(this.lighthouse.on ? 440 : 160, 0.25, 'sine', 0.05);
    }
  }

  override update(dt: number, alpha: number): void {
    this.entities.update(dt, alpha);
    this.cameraFollow.update(dt);
    this.sky.follow(this.camera);
    this.water.update(dt);
    this.rain.update(dt, this.camera);
    this.lighthouse.update(dt);
    // 阴影相机跟随玩家（保证近处阴影精度），光照方向不变
    const a = this.atmosphere!;
    const p = this.player.object3D.position;
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
