import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { WhiteboxBeamRenderer } from '@/systems/light/BeamRenderer';
import { S3, v3 } from './layout';
import { buildS3Beam, type S3Beam } from './beam';
import type { S3Greybox } from './greybox';

/**
 * S3 谜题 5「灯塔光路」+ 点灯（v0.1-015，白盒）。
 * part A：光路（三面镜子 + 云缝天光 + 点火口）+ 灯室拉杆占位（E 直接点灯，part C 换成「光到了才能点」）。
 * 环境不发暖光：暖光只在点灯后打开（灯室 PointLight + 旋转光束）。
 */
export const S3_IDS = {
  lever: 'ignite-lever-s3',
} as const;

export interface S3PuzzleDeps {
  game: Game;
  /** S3 根节点（S3_WORLD_FRAME），所有谜题件挂在它下面（局部坐标） */
  frame: THREE.Object3D;
  scene: THREE.Scene;
  physics: PhysicsSystem;
  interaction: InteractionSystem;
  greybox: S3Greybox;
  beamDebug: boolean;
  /** 点灯（场景负责结束流程） */
  onIgnite: () => void;
}

export interface S3Lamp {
  root: THREE.Group;
  light: THREE.PointLight;
  beam: THREE.Group;
  on: boolean;
  setOn(on: boolean): void;
  update(dt: number): void;
}

export interface S3Puzzles {
  beam: S3Beam;
  renderer: WhiteboxBeamRenderer;
  lamp: S3Lamp;
  lever: THREE.Group;
  leverIx: Interactable;
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** 灯室暖光（点灯前关；颜色 = 美术 lamp-light-origin #FFB25E）+ 两束旋转光束 */
export function buildS3Lamp(parent: THREE.Object3D): S3Lamp {
  const root = new THREE.Group();
  root.name = 's3-lamp';
  root.position.copy(v3(S3.points.lampLightOrigin));
  parent.add(root);
  const light = new THREE.PointLight(0xffb25e, 0, 40, 1.6);
  light.name = 'lamp-light-s3';
  light.visible = false;
  root.add(light);
  const beam = new THREE.Group();
  beam.name = 'lamp-beam-s3';
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb25e, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const geo = new THREE.ConeGeometry(3.2, 60, 24, 1, true);
  geo.rotateZ(Math.PI / 2);
  geo.translate(30, 0, 0);
  for (const r of [0, Math.PI]) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = r;
    m.frustumCulled = false;
    m.renderOrder = 2;
    beam.add(m);
  }
  beam.visible = false;
  root.add(beam);
  const lamp: S3Lamp = {
    root,
    light,
    beam,
    on: false,
    setOn(on: boolean): void {
      lamp.on = on;
      light.visible = beam.visible = on;
      light.intensity = on ? 60 : 0;
    },
    update(dt: number): void {
      if (lamp.on) beam.rotation.y += dt * 0.35;
    },
  };
  return lamp;
}

export function buildS3Puzzles(d: S3PuzzleDeps): S3Puzzles {
  const { game, frame, scene, interaction } = d;
  const events = game.events;
  const offs: Array<() => void> = [];
  const root = new THREE.Group();
  root.name = 's3-puzzles';
  frame.add(root);

  const beam = buildS3Beam(d.physics, frame);
  const tracer = beam.tracer;
  offs.push(tracer.bind(events));
  const renderer = new WhiteboxBeamRenderer({ debug: d.beamDebug });
  scene.add(renderer.root);
  const lamp = buildS3Lamp(frame);

  // ---- 点火拉杆（白盒：枢轴 = ignite-lever-socket，杆长 0.3，绕局部 +X 拉 −60°）
  const metal = new THREE.MeshStandardMaterial({ name: 'gb-metal', color: 0x5f6b70, metalness: 0.6, roughness: 0.45 });
  const L = S3.igniteLever;
  const lever = new THREE.Group();
  lever.name = 'ignite-lever-s3';
  lever.position.copy(v3(L.pivot));
  root.add(lever);
  const grip = v3(L.gripRest).sub(v3(L.pivot));
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L.len, 8), metal);
  arm.name = 'ignite-lever-s3-arm';
  arm.position.copy(grip.clone().multiplyScalar(0.5));
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip.clone().normalize());
  lever.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), metal);
  knob.position.copy(grip);
  lever.add(knob);
  const stand = new THREE.Object3D();
  stand.name = 'ignite-lever-s3-interact';
  stand.position.copy(v3(L.interact));
  // +Z 朝灯机（局部 −X）
  stand.rotation.y = Math.atan2(L.facing[0], L.facing[2]);
  root.add(stand);
  root.updateMatrixWorld(true);
  const leverIx = new Interactable({
    id: S3_IDS.lever,
    kind: 'use',
    prompt: 'ui.prompt.ignite',
    object: lever,
    interactPoint: stand,
    focus: knob.getWorldPosition(new THREE.Vector3()),
    approach: false,
  });
  interaction.add(leverIx);
  offs.push(
    events.on('interact:used', ({ id }) => {
      if (id === S3_IDS.lever) d.onIgnite();
    }),
  );

  return {
    beam,
    renderer,
    lamp,
    lever,
    leverIx,
    fixedUpdate(dt: number): void {
      tracer.fixedUpdate(dt);
    },
    update(dt: number): void {
      renderer.update(dt, tracer);
      lamp.update(dt);
    },
    dispose(): void {
      for (const off of offs) off();
      renderer.dispose();
      scene.remove(renderer.root);
    },
  };
}
