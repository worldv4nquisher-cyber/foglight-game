import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { TextId } from '@/content/text';
import { LevelScene } from './LevelScene';
import { LEVELS } from './levels';

const HALF = 14;
/** 去 S3 初望灯塔的出口（屋后小路尽头） */
export const S2_EXIT_TO_S3 = new THREE.Vector3(9, 0, -11);

/**
 * S2 守灯人小屋 —— 占位白盒（v0.1-010 只为跑通场景流程；正式白盒 + 谜题 3–4 在 014，美术 019）。
 * 崖顶平台 + 两层石屋体块（实心，进不去）+ 屋后去 S3 的出口。
 */
export class S2KeeperHouseScene extends LevelScene {
  readonly name = 's2-keeper-house';
  protected readonly locationName = '守灯人小屋';
  protected override goalId: TextId | null = 'ch1.s2.goal.home';

  constructor(game: Game) {
    super(game, LEVELS.s2);
  }

  protected buildLevel(): void {
    this.spawns.set('from-s1', { position: new THREE.Vector3(0, 0.01, 10), yaw: 0, pitch: -0.2 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x5f6461, roughness: 0.95, flatShading: true });
    const wall = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.9 });

    // 崖顶平台（顶面 y = 0）
    const ground = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 2, 4, HALF * 2 + 2), stone);
    ground.position.y = -2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.physics.addBox(new THREE.Box3(new THREE.Vector3(-30, -5, -30), new THREE.Vector3(30, 0, 30)));

    // 两层石屋体块 + 坡屋顶
    const house = new THREE.Mesh(new THREE.BoxGeometry(8, 5.6, 6), wall);
    house.position.set(0, 2.8, -3);
    house.castShadow = house.receiveShadow = true;
    this.scene.add(house);
    this.physics.addMesh(house);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.2 * Math.SQRT2, 2.2, 4, 1), stone);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 0.75);
    roof.position.set(0, 6.7, -3);
    roof.castShadow = true;
    this.scene.add(roof);
    // 门口一盏暖色窗光（家：暖色例外，style-guide）
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x2a1d12, emissive: 0xf2b072, emissiveIntensity: 0.6 }),
    );
    win.position.set(-2, 3.6, 0.01);
    this.scene.add(win);

    // 屋后小路 + 出口石柱
    const c = S2_EXIT_TO_S3;
    for (const dx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), stone);
      post.position.set(c.x + dx, 0.9, c.z);
      post.castShadow = post.receiveShadow = true;
      this.scene.add(post);
      this.physics.addMesh(post);
    }
    this.addExit({ target: 's3', entry: 'from-s2', center: c, radius: 1.0 });
  }

  protected override clampPlayer(p: THREE.Vector3): void {
    p.x = THREE.MathUtils.clamp(p.x, -HALF, HALF);
    p.z = THREE.MathUtils.clamp(p.z, -HALF, HALF);
  }
}
