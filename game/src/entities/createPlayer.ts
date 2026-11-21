import * as THREE from 'three';
import { applyXiMaterials } from '@/render/xiMaterials';
import { addOutlineHull } from '@/render/OutlineHull';
import { outlineHullEnabled } from '@/config/debug';
import { XiLookComponent } from '@/entities/xi/XiLook';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { Entity } from './Entity';
import { KinematicBody } from './components/KinematicBody';
import { PlayerController } from './components/PlayerController';
import { XiAnimator } from './xi/XiAnimator';

export interface PlayerRig {
  entity: Entity;
  body: KinematicBody;
  controller: PlayerController;
  visual: THREE.Group;
  /** 汐的动画（只有 char-xi 模型 + 动画都在时才有；白盒胶囊没有） */
  animator?: XiAnimator;
  /** 汐的材质（ramp 卡通明暗 + 脸 SDF + 湿痕；有 char-xi 和 tex-xi-ramp 时才有） */
  look?: XiLookComponent;
}

/** 汐模型 / 动画的资源 key（manifest，美术资源，common 组） */
export const XI_MODEL_KEY = 'char-xi';
export const XI_ANIMS_KEY = 'char-xi-anims';
/** 右手提物挂点（char-xi.glb 里的骨骼；风灯 prop socket） */
export const XI_HAND_SOCKET = 'hand_r_socket';
/** 汐的卡通 ramp / 脸部 SDF 贴图（manifest common 组，art） */
export const XI_RAMP_KEY = 'tex-xi-ramp';
export const XI_SDF_KEY = 'tex-xi-sdf-face';

/**
 * 创建玩家实体（LevelScene / TestbedScene 共用）：模型 + KinematicBody（胶囊 1.5 × 0.25）+ PlayerController。
 * 有 char-xi（v0.1-017 美术定稿，73 骨、3 档 LOD）时用真模型 + XiAnimator（动画在 char-xi-anims.glb），
 * 交互的 hand-item 挂在右手 hand_r_socket 骨上；没有（?art=0、smoke 默认、加载失败）时用与碰撞胶囊同尺寸的占位胶囊 + 「鼻子」标示朝向。
 */
export function createPlayer(game: Game, physics: PhysicsSystem, spawn: THREE.Vector3, cameraYaw: () => number): PlayerRig {
  const { height, radius } = gameplay.player;
  const visual = new THREE.Group();
  let model: THREE.Object3D | null = null;
  if (game.assets.has(XI_MODEL_KEY)) {
    model = game.assets.getModel(XI_MODEL_KEY);
    model.traverse((o) => {
      // 蒙皮包围盒按绑定姿势算，动作大时会被误剔除；角色就一个，直接不剔
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
    visual.add(model);
    const socket = model.getObjectByName(XI_HAND_SOCKET);
    if (socket) {
      const hand = new THREE.Object3D();
      hand.name = 'hand-item';
      socket.add(hand);
    }
  } else {
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
  let animator: XiAnimator | undefined;
  const clips = game.assets.getAnimations(XI_ANIMS_KEY);
  if (model && clips.length) {
    const hand = visual.getObjectByName('hand-item');
    animator = entity.add(new XiAnimator({ model, clips, lantern: () => !!hand && hand.children.length > 0 }));
  }
  let look: XiLookComponent | undefined;
  if (model && game.assets.has(XI_RAMP_KEY)) {
    const sdf = game.assets.has(XI_SDF_KEY) ? game.assets.getTexture(XI_SDF_KEY) : null;
    look = entity.add(new XiLookComponent(applyXiMaterials(model, { ramp: game.assets.getTexture(XI_RAMP_KEY), sdf })));
  }
  // 023 外扩描边：极致 / 高 / 标准档 outlineHull 都含 'character'，汐始终描（头发走同一张贴图的 alpha test）；最低档由 LevelScene.applyQuality 把壳隐藏
  if (model && outlineHullEnabled) model.userData.outlineHull = addOutlineHull(model);
  return { entity, body, controller, visual, ...(animator ? { animator } : {}), ...(look ? { look } : {}) };
}

/** dev 面板（F4）里的角色物理读数：实际水平速度、是否着地、碰撞耗时 */
export function debugPlayerLine(rig: PlayerRig, physics: PhysicsSystem): string {
  const b = rig.body.body;
  const v = Math.hypot(b.actualVelocity.x, b.actualVelocity.z);
  const state = rig.controller.busy ? '接管中' : b.onGround ? '着地' : '空中';
  return (
    `速度 ${v.toFixed(2)} m/s · ${state} · y ${b.position.y.toFixed(2)}\n` +
    `碰撞 ${physics.lastStepMs.toFixed(3)} ms / 步 · 碰撞体 ${physics.colliders.length}` +
    (rig.animator ? `\n动画 ${rig.animator.state} · 走 ${rig.animator.blend.walk.toFixed(2)}×${rig.animator.blend.walkRate.toFixed(2)} 跑 ${rig.animator.blend.jog.toFixed(2)}×${rig.animator.blend.jogRate.toFixed(2)}` : '') +
    (rig.look ? ` · wet ${rig.look.look.wetness.toFixed(2)}` : '')
  );
}
