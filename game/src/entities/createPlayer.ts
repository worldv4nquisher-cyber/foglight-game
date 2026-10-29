import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { Entity } from './Entity';
import { KinematicBody } from './components/KinematicBody';
import { PlayerController } from './components/PlayerController';

export interface PlayerRig {
  entity: Entity;
  body: KinematicBody;
  controller: PlayerController;
  visual: THREE.Group;
}

/**
 * 创建玩家实体（LevelScene / TestbedScene 共用）：模型 + KinematicBody（胶囊 1.5 × 0.25）+ PlayerController。
 * 没有 hero 模型时用与碰撞胶囊同尺寸的占位胶囊 + 「鼻子」标示朝向。
 */
export function createPlayer(game: Game, physics: PhysicsSystem, spawn: THREE.Vector3, cameraYaw: () => number): PlayerRig {
  const { height, radius } = gameplay.player;
  const visual = new THREE.Group();
  if (!game.assets.has('hero')) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.8 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, height - 2 * radius, 6, 16), mat);
    capsule.position.y = height / 2;
    capsule.castShadow = true;
    visual.add(capsule);
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x2d2a26, roughness: 0.8 }),
    );
    nose.position.set(0, height - 0.3, radius + 0.04);
    nose.castShadow = true;
    visual.add(nose);
  } else {
    visual.add(game.assets.getModel('hero', 'capsule', 0x9a8f80));
  }

  const root = new THREE.Group();
  root.add(visual);
  root.position.copy(spawn);
  const entity = new Entity('player', root);
  entity.tags.add('player');
  const body = entity.add(new KinematicBody(radius, height));
  const controller = entity.add(
    new PlayerController({
      input: game.input,
      cameraYaw,
      events: game.events,
      visual,
      setFade: (a) => game.ui.fade.set(a),
    }),
  );
  physics.addBody(body.body);
  return { entity, body, controller, visual };
}

/** dev 面板（F4）里的角色物理读数：实际水平速度、是否着地、碰撞耗时 */
export function debugPlayerLine(rig: PlayerRig, physics: PhysicsSystem): string {
  const b = rig.body.body;
  const v = Math.hypot(b.actualVelocity.x, b.actualVelocity.z);
  const state = rig.controller.busy ? '接管中' : b.onGround ? '着地' : '空中';
  return (
    `速度 ${v.toFixed(2)} m/s · ${state} · y ${b.position.y.toFixed(2)}\n` +
    `碰撞 ${physics.lastStepMs.toFixed(3)} ms / 步 · 碰撞体 ${physics.colliders.length}`
  );
}
