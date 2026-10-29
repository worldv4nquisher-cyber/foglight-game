import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import { greyboxVisible } from '@/config/debug';
import { LevelScene, type SpawnPoint } from '@/scenes/LevelScene';
import { LEVELS } from '@/scenes/levels';
import { collectIndoorVolumes } from '@/systems/CameraFollowSystem';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import { makeSkyLayer } from '@/render/skyLayer';
import type { TextId } from '@/content/text';
import { S2, S2_FAR, v3 } from './layout';
import { buildS2Greybox, defaultS2GreyboxMaterials, type S2Greybox } from './greybox';
import { buildS2Art, type S2Art } from './art';
import { buildS2Puzzles, type S2Puzzles } from './puzzles';
import { beamDebugEnabled } from '@/config/debug';
import type { Collider } from '@/systems/PhysicsSystem';

/**
 * S2 守灯人小屋（v0.1-014 白盒 + 美术 019 接入 + S3 灯塔远景；布局见 ./layout.ts）。取代 010 的占位 S2KeeperHouseScene。
 * - 白盒几何是碰撞的唯一来源；美术 GLB 按 layout 摆放只做外观，加载到了就隐藏白盒（?greybox=1 叠加显示）。
 * - 崖顶在海面上 16 m：海面放在局部 y −16（LevelScene 默认 −0.6 会淹掉西侧坡地的白石）。
 * - 环境不发暖光：暖光只来自汐的风灯（谜题流程见 puzzles.ts）。
 */
export class S2Scene extends LevelScene {
  readonly name: string = 's2-keeper-house';
  protected readonly locationId = 'ch1.s2.location.title' as const;
  protected override goalId: TextId | null = 'ch1.s2.goal.home';
  greybox!: S2Greybox;
  art!: S2Art;
  puzzles!: S2Puzzles;
  private readonly colliderOf = new Map<THREE.Mesh, Collider>();
  private readonly mats = defaultS2GreyboxMaterials();

  constructor(game: Game) {
    super(game, LEVELS.s2);
  }

  protected buildLevel(): void {
    const [sx, sy, sz] = S2.spawn;
    // 面朝北（+Z）：CameraFollowSystem yaw 约定 forward = (−sin, 0, −cos) ⇒ yaw = π
    this.spawns.set('from-s1', { position: new THREE.Vector3(sx, sy + 0.01, sz), yaw: Math.PI, pitch: -0.16 });

    this.water?.setLevel(S2.seaY);

    this.greybox = buildS2Greybox(this.mats);
    this.scene.add(this.greybox.root);
    for (const m of this.greybox.colliders) this.colliderOf.set(m, this.physics.addMesh(m));
    for (const m of this.greybox.walls) this.physics.addMesh(m, { kind: 'wall' });
    this.cameraFollow.indoorVolumes = collectIndoorVolumes(this.greybox.root);

    this.art = buildS2Art(this.game.assets);
    this.scene.add(this.art.root);
    if (this.art.cellarDoor) this.greybox.cellarDoor.add(this.art.cellarDoor);
    if (!this.art.far) this.addFarPlaceholder();
    this.setGreyboxVisible(!this.art.loaded || greyboxVisible);

    this.addExit({ target: 's3', entry: 'from-s2', center: v3(S2.exitToS3), radius: 1.2 });
  }

  protected override buildInteractables(): void {
    this.puzzles = buildS2Puzzles({
      game: this.game,
      scene: this.scene,
      physics: this.physics,
      interaction: this.interaction,
      hints: this.hints,
      rig: this.rig,
      cameraFollow: this.cameraFollow,
      camera: this.camera,
      greybox: this.greybox,
      collider: (m) => this.colliderOf.get(m),
      artRoot: this.art.root,
      artKey: this.art.cellarKey,
      artLantern: this.art.lantern,
      beamDebug: beamDebugEnabled,
    });
    this.cleanups.push(() => this.puzzles.dispose());
  }

  /** 观察点上替代 E 提示（text-ch1：ch1.s2.viewpoint.prompt） */
  protected override extraPrompt(): string | null {
    return this.puzzles?.viewpointPrompt() ?? null;
  }

  override fixedUpdate(dt: number): void {
    if (!this.rig) return;
    this.puzzles.fixedUpdate(dt);
    super.fixedUpdate(dt);
  }

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha);
    if (!this.rig) return;
    this.puzzles.update(dt);
    if (this.game.ui.debug.visible) {
      const s = this.puzzles.state;
      const b = this.puzzles.beam;
      this.game.ui.debug.set(
        'S2',
        `镜 A ${b.mirrorA.part.angles[0]}° B ${b.mirrorB.part.angles[0]}° · 锁 ${b.lock.state} · 门 ${(s.doorOpen * 100).toFixed(0)}% · 钥匙 ${s.hasKey ? '有' : '无'} · 观察 ${(this.puzzles.viewpoint.alignment * 100).toFixed(0)}% · 拨盘 ${this.puzzles.dials.map((p) => Math.round((p.angles[0] ?? 0) / 36) % 10).join('')}${s.gateOpen ? ' 开' : ''}`,
      );
    }
  }

  /** 没有美术时的远景占位：S3 灯塔位置一根高柱（天空层材质） */
  private addFarPlaceholder(): void {
    const g = new THREE.Group();
    g.name = 's2-far-s3-placeholder';
    const p = S2_FAR.tower.position;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 25, 10));
    col.position.set(p.x, p.y + 12.5, p.z);
    const isl = new THREE.Mesh(new THREE.CylinderGeometry(22, 30, p.y - S2.seaY + 2, 12));
    isl.position.set(p.x, (p.y + S2.seaY - 2) / 2, p.z);
    g.add(col, isl);
    makeSkyLayer(g, { ...S2.farLayer, pinDepth: false });
    this.scene.add(g);
  }

  /** 白盒外观开关（碰撞不受影响；空气墙始终不可见）。白石占位：021 交付前始终显示 */
  setGreyboxVisible(on: boolean): void {
    for (const m of this.greybox.colliders) m.visible = on;
    for (const d of this.greybox.decor) d.visible = on || d === this.greybox.whiteStones;
    // 门扇碰撞盒：有美术门扇时跟着白盒开关；拨盘铁门没有美术，始终显示
    this.greybox.cellarDoorLeaf.visible = on || !this.art.cellarDoor;
    this.greybox.dialGateLeaf.visible = true;
  }

  protected override afterEnter(): void {
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) Object.assign(window, { __s2: this });
  }

  /** 建立镜头（3 s）：院墙外东南低机位 → 扫过院墙看向小屋二层窗口 → 角色身后 */
  protected override establishingKeys(spawn: SpawnPoint): CameraKey[] {
    const T = gameplay.camera.establishingTime;
    const [a, b] = S2.establishing;
    const p = spawn.position;
    const f = new THREE.Vector3(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
    const r = new THREE.Vector3(Math.cos(spawn.yaw), 0, -Math.sin(spawn.yaw));
    return [
      { time: 0, position: v3(a.position), lookAt: v3(a.lookAt), fov: a.fov },
      { time: T * 0.55, position: v3(b.position), lookAt: v3(b.lookAt), fov: b.fov },
      {
        time: T,
        position: p.clone().addScaledVector(f, -5).addScaledVector(r, 1.2).add(new THREE.Vector3(0, 2.6, 0)),
        lookAt: p.clone().addScaledVector(f, 2).add(new THREE.Vector3(0, 1.2, 0)),
        fov: 55,
      },
    ];
  }
}
