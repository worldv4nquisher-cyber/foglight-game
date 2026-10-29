import * as THREE from 'three';
import { missingGreyboxNodes, mountArtSlots, type ArtSlots } from '../artSlots';
import { S1_ART_SLOTS } from './artSlots';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import { greyboxVisible } from '@/config/debug';
import { LevelScene, type SpawnPoint } from '@/scenes/LevelScene';
import { LEVELS } from '@/scenes/levels';
import { CameraTrack } from '@/systems/CameraFollowSystem';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import type { Collider } from '@/systems/PhysicsSystem';
import { withTideLevel, WET_LINE_GLSL } from '@/render/tideUniforms';
import { t, type TextId } from '@/content/text';
import { S1, v3 } from './layout';
import { buildS1Greybox, defaultGreyboxMaterials, type S1Greybox } from './greybox';
import { buildS1Puzzles, type S1Puzzles } from './puzzles';
import { buildS1Art, type S1Art } from './art';

/** 跳过开场后接的 S1 建立镜头（画质检测第 1 轮没测完时；不可跳过） */
export const S1_HOLD_SHOT = 's1-establishing-hold';

/**
 * S1 落潮滩（v0.1-013 白盒 + 谜题 1、2；布局见 ./layout.ts，谜题见 ./puzzles.ts）。
 * - 白盒几何是碰撞的唯一来源；美术 GLB（018 / 020）按 layout 摆放只做外观，加载到了就隐藏白盒（?greybox=1 叠加显示）。
 * - 首次启动后第一次进入：画质自动检测第一轮和建立镜头同时进行，镜头停在最后一帧等第一轮测完（009）；
 *   第一轮没测完就跳过 → 接 3 s 不可跳过的 S1 建立镜头（013 裁定），最后一帧仍最多等 5 s。
 * - 退潮时按 R：浮台回原位（谜题 2 重置）。
 */
export class S1Scene extends LevelScene {
  readonly name: string = 's1-ebb-shore';
  protected readonly locationId = 'ch1.s1.location.title' as const;
  protected override goalId: TextId | null = 'ch1.s1.goal.find_bell';
  greybox!: S1Greybox;
  art!: S1Art;
  puzzles!: S1Puzzles;
  artSlots: ArtSlots | null = null;
  artSlotGreyboxMissing: string[] = [];
  private tideColliders: Collider[] = [];
  private readonly mats = defaultGreyboxMaterials();

  constructor(game: Game) {
    super(game, LEVELS.s1);
  }

  protected buildLevel(): void {
    const [sx, sy, sz] = S1.spawnStart;
    // 面朝陆地（码头局部 +Z）：CameraFollowSystem yaw 约定 forward = (−sin, 0, −cos)
    const r = S1.pier.rotationY;
    this.spawns.set('start', { position: new THREE.Vector3(sx, sy + 0.01, sz), yaw: Math.atan2(-Math.sin(r), -Math.cos(r)), pitch: -0.18 });

    // 白盒（石头 / 沙地带湿痕线）
    for (const m of [this.mats.stone, this.mats.sand, this.mats.reef, this.mats.wood]) withTideLevel(m, WET_LINE_GLSL);
    this.greybox = buildS1Greybox(this.mats);
    this.scene.add(this.greybox.root);
    for (const m of this.greybox.colliders) this.tideColliders.push(this.physics.addMesh(m));
    for (const m of this.greybox.walls) this.tideColliders.push(this.physics.addMesh(m, { kind: 'wall' }));

    // 美术
    this.art = buildS1Art(this.game.assets);
    this.scene.add(this.art.root);
    this.setGreyboxVisible(!this.art.loaded || greyboxVisible);

    this.addExit({ target: 's2', entry: 'from-s1', center: v3(S1.exitToS2), radius: 1.1 });
  }

  /** 白盒外观开关（碰撞不受影响；空气墙始终不可见） */
  setGreyboxVisible(on: boolean): void {
    for (const m of this.greybox.colliders) m.visible = on;
    for (const d of this.greybox.decor) d.visible = on || /footprint/.test(d.name);
  }

  protected override buildInteractables(): void {
    this.puzzles = buildS1Puzzles({
      game: this.game,
      root: this.scene,
      physics: this.physics,
      interaction: this.interaction,
      hints: this.hints,
      entities: this.entities,
      tideColliders: this.tideColliders,
      wood: this.mats.wood,
      metal: new THREE.MeshStandardMaterial({ name: 'gb-bell-copper', color: 0x5f746b, metalness: 0.85, roughness: 0.26, side: THREE.DoubleSide }),
      addLink: (l) => this.rig.controller.links.push(l),
    });
    this.tides.add(this.puzzles.tide);
    this.bells.push(this.puzzles.bell);
    // 021 / 022 未交付道具的替换入口（文件到了自动挂上，白盒逻辑不变）
    this.artSlots = mountArtSlots(this.game.assets, this.scene, S1_ART_SLOTS, { showGreybox: greyboxVisible });
    this.artSlotGreyboxMissing = missingGreyboxNodes(this.scene, S1_ART_SLOTS);
    if (this.artSlotGreyboxMissing.length) console.warn('[art-slot] 白盒节点名对不上：' + this.artSlotGreyboxMissing.join('、'));
  }

  protected override afterEnter(): void {
    this.cleanups.push(() => this.puzzles.dispose());
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.code !== 'KeyR' || this.game.isPaused || this.game.input.context !== 'explore' || this.rig.controller.busy) return;
      if (this.puzzles.resetRaft()) {
        this.game.audio.beep(180, 0.2, 'sine', 0.04);
        this.refreshResetPrompt();
      }
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) Object.assign(window, { __s1: this });
    // 首次启动后第一次进入 S1：画质自动检测（009）
    this.game.benchmark.start();
  }

  protected override establishingHold(): (() => boolean) | undefined {
    return () => this.game.benchmark.firstRoundDone;
  }

  /** 建立镜头（3 s）：开场构图（远景主岛 + 熄灭的 S3 灯塔）→ 扫过码头 → 钟台湿铜 → 角色身后 */
  protected override establishingKeys(spawn: SpawnPoint): CameraKey[] {
    const T = gameplay.camera.establishingTime;
    const oc = S1.openingCam;
    const [bx, by, bz] = S1.bellAnchor;
    return [
      { time: 0, position: v3(oc.position), lookAt: v3(oc.lookAt), fov: oc.fov },
      { time: T * 0.55, position: new THREE.Vector3(-2, 6.2, -16.5), lookAt: new THREE.Vector3(bx, by + 1.6, bz), fov: 45 },
      this.behindPlayer(spawn, T),
    ];
  }

  /** 013 裁定：检测第 1 轮没测完就跳过 → 3 s 不可跳过的 S1 建立镜头（开场构图慢推到角色身后），最后一帧仍最多等 5 s */
  protected override establishingAfterSkip(spawn: SpawnPoint, hold: (() => boolean) | undefined): CameraTrack | null {
    if (this.game.benchmark.firstRoundDone) return null;
    const T = gameplay.camera.establishingTime;
    const oc = S1.openingCam;
    return new CameraTrack({
      name: S1_HOLD_SHOT,
      skippable: false,
      duration: T,
      ...(hold ? { holdUntil: hold } : {}),
      keys: [{ time: 0, position: v3(oc.position).add(new THREE.Vector3(0, 0.6, 0)), lookAt: v3(oc.lookAt), fov: oc.fov }, this.behindPlayer(spawn, T)],
    });
  }

  private behindPlayer(spawn: SpawnPoint, time: number): CameraKey {
    const p = spawn.position;
    const f = new THREE.Vector3(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
    const rr = new THREE.Vector3(Math.cos(spawn.yaw), 0, -Math.sin(spawn.yaw));
    return {
      time,
      position: p.clone().addScaledVector(f, -5).addScaledVector(rr, 1.2).add(new THREE.Vector3(0, 2.6, 0)),
      lookAt: p.clone().addScaledVector(f, 2).add(new THREE.Vector3(0, 1.2, 0)),
      fov: 55,
    };
  }

  protected override applyQuality(): void {
    super.applyQuality();
    this.art?.applyQuality(this.game.quality.preset);
  }

  override fixedUpdate(dt: number): void {
    super.fixedUpdate(dt);
    if (this.rig && this.puzzles) this.puzzles.fixedUpdate(dt, this.rig.body.position);
  }

  private resetPromptShown = false;

  /** 「R 放回浮台」第二行提示（013 补充）：条件见 S1Puzzles.resetRaftPromptVisible；R 本身全 S1 有效 */
  private refreshResetPrompt(): void {
    const g = this.game;
    // 与 R 的按键判定一致（下方 keydown）：没暂停、输入在 explore、不在自动跨越 / 黑场送回中
    const explore = !g.isPaused && g.input.context === 'explore' && !this.rig.controller.busy;
    const show = this.puzzles.resetRaftPromptVisible(this.rig.body.position, explore);
    if (show === this.resetPromptShown) return;
    this.resetPromptShown = show;
    g.ui.hud.setSecondaryPrompt(show ? t('ui.prompt.reset_raft') : null);
  }

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha);
    if (this.rig) this.art.update(this.camera, this.puzzles.tide.level);
    if (this.rig && this.puzzles) this.refreshResetPrompt();
    this.artSlots?.update();
  }

  override exit(): void {
    // 画质检测没测完就离开：整次作废，下次进 S1 重测（BUG-002）
    this.game.benchmark.cancel();
    super.exit();
  }
}
