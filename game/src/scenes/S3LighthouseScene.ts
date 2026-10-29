import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { TextId } from '@/content/text';
import { Lighthouse } from '@/world/Lighthouse';
import { Interactable } from '@/systems/interaction/Interactable';
import type { AtmospherePreset } from '@/config/atmosphere';
import { LevelScene } from './LevelScene';
import { LEVELS } from './levels';

const RADIUS = 14;
/** 点灯后多久进章节结束页（s）。结尾演出（035）做好后由演出结束触发 */
const END_DELAY = 1.5;

/**
 * S3 初望灯塔 —— 占位白盒（v0.1-010 只为跑通场景流程；正式白盒 + 谜题 5 在 015，美术 020）。
 * 岬角 + 灯塔；在塔门按 E「点灯」→ 灯亮 → 章节结束页（035 结尾演出接在这里）。
 */
export class S3LighthouseScene extends LevelScene {
  readonly name = 's3-lighthouse';
  protected readonly locationId = 'ch1.s3.location.title' as const;
  protected override goalId: TextId | null = 'ch1.s3.goal.light';
  private lighthouse = new Lighthouse();
  private ending = false;

  constructor(game: Game) {
    super(game, LEVELS.s3);
  }

  protected buildLevel(): void {
    this.spawns.set('from-s2', { position: new THREE.Vector3(0, 0.01, 9), yaw: 0, pitch: -0.12 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x585e57, roughness: 0.96, flatShading: true });
    const cape = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS + 1, RADIUS + 4, 3, 48), stone);
    cape.position.y = -1.5;
    cape.receiveShadow = true;
    this.scene.add(cape);
    this.physics.addBox(new THREE.Box3(new THREE.Vector3(-30, -5, -30), new THREE.Vector3(30, 0, 30)));

    this.lighthouse.position.set(0, 0, -5);
    this.scene.add(this.lighthouse);
    this.lighthouse.updateWorldMatrix(true, true);
    this.physics.addObject(this.lighthouse.tower);
  }

  protected override buildInteractables(): void {
    const base = this.lighthouse.position;
    this.interaction.add(
      new Interactable({
        id: 's3-lamp',
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
    this.cleanups.push(
      this.game.events.on('interact:used', ({ id }) => {
        if (id === 's3-lamp') this.lightTheLamp();
      }),
    );
  }

  /** 点灯（占位）：灯亮 → END_DELAY 秒后章节结束页。测试也直接调用 */
  lightTheLamp(): void {
    if (this.ending) return;
    this.ending = true;
    if (!this.lighthouse.on) this.lighthouse.toggle();
    this.game.audio.beep(440, 0.4, 'sine', 0.05);
    window.setTimeout(() => {
      if (this.game.scenes.current === this) void this.game.flow.completeChapter();
    }, END_DELAY * 1000);
  }

  protected override applyAtmosphere(a: AtmospherePreset): void {
    super.applyAtmosphere(a);
    this.lighthouse.applyAtmosphere(a);
  }

  protected override clampPlayer(p: THREE.Vector3): void {
    const r = Math.hypot(p.x, p.z);
    const max = RADIUS - 0.6;
    if (r > max) {
      p.x *= max / r;
      p.z *= max / r;
    }
  }

  override update(dt: number, alpha: number): void {
    super.update(dt, alpha);
    this.lighthouse.update(dt);
  }
}
