import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import { beamDebugEnabled, greyboxVisible } from '@/config/debug';
import { LevelScene, type SpawnPoint } from '@/scenes/LevelScene';
import { LEVELS } from '@/scenes/levels';
import { collectIndoorVolumes } from '@/systems/CameraFollowSystem';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import type { TextId } from '@/content/text';
import type { Collider } from '@/systems/PhysicsSystem';
import { S3, S3_FRAME, alongDoor, cameraYawFacing, toWorld } from './layout';
import { buildS3Greybox, defaultS3GreyboxMaterials, type S3Greybox } from './greybox';
import { buildS3Art, type S3Art } from './art';
import { buildS3Puzzles, type S3Puzzles } from './puzzles';

/** 点灯后多久进章节结束页（s）。结尾演出（035）做好后由演出结束触发 */
const END_DELAY = 1.5;

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
  private readonly colliderOf = new Map<THREE.Mesh, Collider>();
  private readonly mats = defaultS3GreyboxMaterials();
  private ending = false;

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
    for (const m of this.greybox.walls) this.physics.addMesh(m, { kind: 'wall' });
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
    });
    this.tides.add(this.puzzles.tide);
    this.bells.push(this.puzzles.bell);
    this.cleanups.push(() => this.puzzles.dispose());
  }

  /** 点灯：灯亮 → END_DELAY 秒后章节结束页（035 结尾演出接在这里）。smoke / 测试也直接调用 */
  lightTheLamp(): void {
    if (this.ending) return;
    this.ending = true;
    this.puzzles.state.ignited = true;
    this.puzzles.leverIx.enabled = false;
    this.hints.solve('p5');
    this.puzzles.lamp.setOn(true);
    window.setTimeout(() => {
      if (this.game.scenes.current === this) void this.game.flow.completeChapter();
    }, END_DELAY * 1000);
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
    super.update(dt, alpha);
    if (!this.rig) return;
    this.puzzles.update(dt);
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

  /** 白盒外观开关（碰撞不受影响；空气墙始终不可见）。门扇：有美术门扇时跟着白盒开关 */
  setGreyboxVisible(on: boolean): void {
    for (const m of this.greybox.colliders) m.visible = on;
    for (const d of this.greybox.decor) d.visible = on;
    this.greybox.doorLeaf.visible = on || !this.art.door;
  }

  protected override afterEnter(): void {
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) Object.assign(window, { __s3: this });
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
