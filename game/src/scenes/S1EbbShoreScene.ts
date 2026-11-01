import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import type { AtmospherePreset } from '@/config/atmosphere';
import { Entity } from '@/entities/Entity';
import { Spinner } from '@/entities/components/Spinner';
import { Lighthouse } from '@/world/Lighthouse';
import { Interactable } from '@/systems/interaction/Interactable';
import { describeLods } from '@/render/lod';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import { LevelScene, type SpawnPoint } from './LevelScene';
import { LEVELS } from './levels';
import type { TextId } from '@/content/text';

const ISLAND_RADIUS = 18;
const SPAWN = new THREE.Vector3(-1.5, 0.01, 10);
/** 去 S2 守灯人小屋的出口（岛西北角的石路尽头；正式位置由 013 白盒定） */
export const S1_EXIT_TO_S2 = new THREE.Vector3(-10, 0, -12);

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
 * v0.1 demo 岛（原 S1 占位；013 起正式 S1 是 `@/levels/s1/S1Scene`，这里只作为 `?scene=sandbox` 的基类）：
 * 海岛地面 + 岩石 + 旋转立方体 + demo 灯塔（E 开关）+ LOD 测试石，入口 start、去 S2 的出口。
 */
export class S1EbbShoreScene extends LevelScene {
  readonly name: string = 's1-ebb-shore';
  protected readonly locationId = 'ch1.s1.location.title' as const;
  protected override goalId: TextId | null = 'ch1.s1.goal.find_bell';
  /** 沙盒（dev 用的 demo 岛）：不存档、不跑画质检测、没有出口、不预加载 */
  protected readonly sandbox: boolean;
  private lighthouse = new Lighthouse();

  constructor(game: Game, opts: { sandbox?: boolean } = {}) {
    super(game, LEVELS.s1);
    this.sandbox = opts.sandbox ?? false;
    if (this.sandbox) {
      this.savePoint = null;
      this.preloadNext = false;
    }
  }

  protected buildLevel(): void {
    this.spawns.set('start', { position: SPAWN.clone(), yaw: -0.3, pitch: -0.22 });
    this.buildIsland();
    this.buildProps();
    if (!this.sandbox) this.buildExitToS2();
  }

  protected override buildInteractables(): void {
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

  protected override afterEnter(): void {
    const { events, audio } = this.game;
    this.cleanups.push(
      // demo 灯塔（v0.1-004 起走 Interactable：use，不走位，按 E 切换）
      events.on('interact:used', ({ id }) => {
        if (id !== 'lighthouse') return;
        this.lighthouse.toggle();
        audio.beep(this.lighthouse.on ? 440 : 160, 0.25, 'sine', 0.05);
      }),
    );
    // 首次启动后第一次进入 S1：画质自动检测第一轮和建立镜头同时进行、镜头等第一轮测完再交还；后续轮次在玩家可操作后继续（009 裁定；035 开场演出尾段留 9 s）
    if (!this.sandbox) this.game.benchmark.start();
  }

  protected override establishingHold(): (() => boolean) | undefined {
    // 009 制作人裁定：画质检测第一轮必须在建立镜头内测完（热身帧 + 3 s 比镜头略长，停在最后一帧等）
    return () => this.game.benchmark.firstRoundDone;
  }

  /** 建立镜头：从海面高处缓慢推向角色身后，望向灯塔 */
  protected override establishingKeys(spawn: SpawnPoint): CameraKey[] {
    const p = spawn.position;
    return [
      { time: 0, position: new THREE.Vector3(p.x + 6, 6.5, p.z + 12), lookAt: new THREE.Vector3(8, 4, -10), fov: 50 },
      { time: gameplay.camera.establishingTime, position: new THREE.Vector3(p.x + 1.6, 2.6, p.z + 5), lookAt: new THREE.Vector3(p.x, 1.2, p.z - 2), fov: 55 },
    ];
  }

  // ---------------------------------------------------------------- 搭建

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
    if (!this.game.assets.has('test-lod-puzzle')) {
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

  /** 去 S2 的出口：两根矮石柱 + 柱间一盏冷白小灯（占位，GDD：S1 冷色引导），走进柱间 → 黑场 → S2 */
  private buildExitToS2(): void {
    const c = S1_EXIT_TO_S2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x5d6466, roughness: 0.9, flatShading: true });
    for (const dx of [-1.3, 1.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), mat);
      post.position.set(c.x + dx * 0.7, 0.9, c.z + dx * 0.7);
      post.castShadow = post.receiveShadow = true;
      this.scene.add(post);
      this.physics.addMesh(post);
    }
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xcfd8de, emissive: 0xcfd8de, emissiveIntensity: 1.6 }),
    );
    glow.position.set(c.x, 1.9, c.z);
    this.scene.add(glow);
    this.addExit({ target: 's2', entry: 'from-s1', center: c, radius: 1.1 });
  }

  /** demo 灯塔是否点亮（测试用） */
  get lighthouseOn(): boolean {
    return this.lighthouse.on;
  }

  protected override applyAtmosphere(a: AtmospherePreset): void {
    super.applyAtmosphere(a);
    this.lighthouse.applyAtmosphere(a);
  }

  /** 圆形岛屿边界：不让玩家走进海里 */
  protected override clampPlayer(p: THREE.Vector3): void {
    const r = Math.hypot(p.x, p.z);
    const max = ISLAND_RADIUS - 0.6;
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
  }

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha);
    this.lighthouse.update(dt);
  }

  override exit(): void {
    // 画质检测没测完就离开（回到主菜单 / 去 S2）：整次作废，下次进 S1 重测（BUG-002）
    if (!this.sandbox) this.game.benchmark.cancel();
    super.exit();
  }
}

/** 沙盒（?scene=sandbox：开发服务器，或测试构建加 ?debug=1；生产构建进不去，batch26）：原 v0.1 demo 岛，不存档、不跑画质检测、没有出口 */
export class SandboxScene extends S1EbbShoreScene {
  override readonly name: string = 'sandbox';
  constructor(game: Game) {
    super(game, { sandbox: true });
  }
}
