import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { PhysicsSystem, Collider } from '@/systems/PhysicsSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { boxZone } from '@/systems/HintSystem';
import { TideController, type TideState } from '@/systems/tide/TideController';
import { TideBell } from '@/systems/tide/TideBell';
import { Floatable } from '@/systems/tide/Floatable';
import { Water } from '@/world/Water';
import { withTideLevel, WET_LINE_GLSL } from '@/render/tideUniforms';

/**
 * 测试场地潮汐区（v0.1-011，白盒）：起点往南（+Z）走，坡道上到岸台。
 *
 *   z 14–20  坡道（x = 0，0 → 2.0 m）
 *   z 20–24  岸台（顶面 2.0 m，安全点 (0, 2, 22)），潮汐钟在 (-4, 2, 21.4)
 *   z 24–44  海床（顶面 -0.6 m，退潮时水深 0.6 m 也会被送回）
 *     · 礁石路 x -1…1：z 24–29 斜坡下到 0.1 m，z 29–36 平路。入口 z = 24 有一道 walkableWhen=low 的空气墙（涨潮挡住）
 *     · 沙洲 x 1…8、z 24–34（顶面 0.1 m）：浮台搁浅在 (5, 0.35, 28.5)，退潮时向北推 3.85 m 到石槽锚位 (5, 0.35, 24.65)
 *     · 岸台边沿：深水空气墙（沙洲处水深 > 0.5 m 时挡住），锚位 x 4.2…5.8 留口 —— 涨潮时浮台在锚位，从岸台走上去
 *   刻度柱 (-2.5, 25.5)：湿痕线材质读 uTideLevel（水面以下变暗变冷）
 */
export interface TideTestArea {
  tide: TideController;
  bell: TideBell;
  raft: Floatable;
  raftPush: Interactable;
  water: Water;
  gauge: THREE.Mesh;
  /** 礁石路入口空气墙（walkableWhen = low） */
  reefGate: Collider;
  deepWalls: Collider[];
  anchors: {
    safe: THREE.Vector3;
    bellStand: THREE.Vector3;
    reef: THREE.Vector3;
    raftHome: THREE.Vector3;
    raftAnchor: THREE.Vector3;
    /** 推浮台的站位（浮台北推，人在南侧） */
    raftStand: THREE.Vector3;
    /** 锚位上浮台对应的岸台边（走上浮台的起点） */
    deckAtAnchor: THREE.Vector3;
  };
  update(dt: number): void;
}

const DECK_Y = 2.0;
const SAND_Y = 0.1;
const FLOOR_Y = -0.6;

export function buildTideTestArea(opts: {
  scene: THREE.Scene;
  physics: PhysicsSystem;
  interaction: InteractionSystem;
  events: EventBus;
  waterColor: number;
  initial?: TideState;
}): TideTestArea {
  const { physics, events } = opts;
  const root = new THREE.Group();
  root.name = 'tide-test-area';
  opts.scene.add(root);
  const stone = new THREE.MeshStandardMaterial({ color: 0x6f7477, roughness: 0.92 });
  const sand = new THREE.MeshStandardMaterial({ color: 0x8a8274, roughness: 0.95 });
  const reefMat = new THREE.MeshStandardMaterial({ color: 0x55605d, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e5d4b, roughness: 0.85 });

  const box = (name: string, min: [number, number, number], max: [number, number, number], m: THREE.Material | null, kind: 'collider' | 'wall' = 'collider'): Collider => {
    const sx = max[0] - min[0];
    const sy = max[1] - min[1];
    const sz = max[2] - min[2];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m ?? stone);
    mesh.name = name;
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    mesh.castShadow = mesh.receiveShadow = m !== null;
    mesh.visible = m !== null;
    root.add(mesh);
    return physics.addMesh(mesh, { kind });
  };
  /** 斜板：顶面从 (zA, yA) 到 (zB, yB)，x 居中 cx、宽 w */
  const slab = (name: string, cx: number, w: number, zA: number, yA: number, zB: number, yB: number, m: THREE.Material): Collider => {
    const thick = 0.3;
    const dz = zB - zA;
    const dy = yB - yA;
    const run = Math.hypot(dz, dy);
    // 只在低端多伸 0.2 m 埋进地面；高端与岸台顶面齐平（BUG-007：以前两端各伸 0.1，
    // 高端端面凸出岸台约 3.6 cm，被当成陡坡挡住）
    const ext = 0.2;
    const len = run + ext;
    const s = (yB < yA ? 1 : -1) * (ext / 2) / run; // 中心沿坡往低端挪 ext/2
    const theta = Math.atan2(-dy, dz);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thick, len), m);
    mesh.name = name;
    mesh.rotation.x = theta;
    mesh.position.set(
      cx,
      (yA + yB) / 2 + dy * s - (thick / 2) * Math.cos(theta),
      (zA + zB) / 2 + dz * s - (thick / 2) * Math.sin(theta),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return physics.addMesh(mesh);
  };

  // ---- 地形
  slab('tide-ramp-collider', 0, 2.4, 14, 0, 20, DECK_Y, stone);
  box('tide-deck-collider', [-12, -1.6, 20], [12, DECK_Y, 24], stone);
  box('tide-seafloor-collider', [-12, -1.6, 24], [12, FLOOR_Y, 44], sand);
  box('tide-sandbar-collider', [1, -1.6, 24], [8, SAND_Y, 34], sand);
  box('tide-reef-collider', [-1, -1.6, 29], [1, SAND_Y, 36], reefMat);
  slab('tide-reef-slope-collider', 0, 2, 24, DECK_Y, 29, SAND_Y, reefMat);
  // 外圈（永久空气墙）
  box('tide-outer-w-wall', [-12.4, -1.6, 20], [-12, 5, 44], null, 'wall');
  box('tide-outer-e-wall', [12, -1.6, 20], [12.4, 5, 44], null, 'wall');
  box('tide-outer-s-wall', [-12.4, -1.6, 44], [12.4, 5, 44.4], null, 'wall');

  // ---- 潮汐分区
  const safe = new THREE.Vector3(0, DECK_Y, 22);
  const tide = new TideController({
    id: 'test-tide',
    initial: opts.initial ?? 'high',
    events,
    region: (p) => p.z > 20 && p.z < 44.5 && Math.abs(p.x) < 12.5,
    safePoint: { position: safe, facing: Math.PI },
  });
  // 礁石路入口：涨潮挡住（walkableWhen = low 的空气墙；GLB 里同样写 extras.walkableWhen）
  const reefGate = box('tide-reef-gate-wall', [-1, SAND_Y, 23.95], [1, 5, 24.15], null, 'wall');
  reefGate.source!.userData.walkableWhen = 'low';
  // 岸台边沿深水墙（下面是沙洲 0.1 m）：锚位 x 4.2–5.8 留口
  const deepWalls = [
    box('tide-deep-w-wall', [-12, SAND_Y, 23.95], [-1, 5, 24.15], null, 'wall'),
    box('tide-deep-m-wall', [1, SAND_Y, 23.95], [4.2, 5, 24.15], null, 'wall'),
    box('tide-deep-e-wall', [5.8, SAND_Y, 23.95], [12, 5, 24.15], null, 'wall'),
  ];
  for (const w of deepWalls) w.source!.userData.deepFloorY = SAND_Y;
  tide.bindFromColliders([reefGate, ...deepWalls]);

  // ---- 水面（小片，降低波高：送回判定 0.3 m）
  const water = new Water(24, 96, opts.waterColor, 0.25);
  water.name = 'tide-water';
  water.position.set(0, tide.level, 32);
  root.add(water);

  // ---- 刻度柱（湿痕线材质读 uTideLevel）
  const gaugeMat = withTideLevel(new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.7 }), WET_LINE_GLSL);
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 16), gaugeMat);
  gauge.name = 'tide-gauge';
  gauge.position.set(-2.5, FLOOR_Y + 1.7, 25.5);
  gauge.castShadow = gauge.receiveShadow = true;
  root.add(gauge);
  for (const y of [0, 0.8, 1.6]) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.04), new THREE.MeshBasicMaterial({ color: 0x2a2f33 }));
    tick.position.set(-2.5, y, 25.38);
    root.add(tick);
  }

  // ---- 潮汐钟（岸台上）
  const bellRoot = new THREE.Group();
  bellRoot.name = 'tide-bell';
  bellRoot.position.set(-4, DECK_Y, 21.4);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.15), wood);
  frame.name = 'tide-bell-frame';
  frame.position.set(0, 0.95, -0.3);
  frame.castShadow = true;
  const swing = new THREE.Group();
  swing.name = 'tide-bell-swing';
  swing.position.set(0, 1.7, 0);
  const bellBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.32, 0.5, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x5f746b, metalness: 0.8, roughness: 0.32, side: THREE.DoubleSide }),
  );
  bellBody.position.y = -0.28;
  swing.add(bellBody);
  bellRoot.add(frame, swing);
  root.add(bellRoot);
  bellRoot.updateWorldMatrix(true, true);
  physics.addMesh(frame);
  const bellPoint = new THREE.Object3D();
  bellPoint.name = 'tide-bell-interact';
  bellPoint.position.set(-4, DECK_Y, 22.45);
  bellPoint.lookAt(-4, DECK_Y, 21.4);
  root.add(bellPoint);
  const bell = new TideBell({
    id: 'tide-bell',
    tide,
    object: bellRoot,
    swing,
    interactPoint: bellPoint,
    focus: new THREE.Vector3(-4, DECK_Y + 1.3, 21.4),
    events,
  });
  opts.interaction.add(bell.interactable);

  // ---- 浮台（沙洲上；退潮推进石槽锚位，涨潮浮到与岸台齐平）
  const raftHome = new THREE.Vector3(5, SAND_Y + 0.25, 28.5);
  const raftAnchor = new THREE.Vector3(5, SAND_Y + 0.25, 24.65);
  const raftMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.2), wood);
  raftMesh.name = 'tide-raft';
  raftMesh.position.copy(raftHome);
  raftMesh.castShadow = raftMesh.receiveShadow = true;
  root.add(raftMesh);
  raftMesh.updateWorldMatrix(true, false);
  physics.addMesh(raftMesh, { dynamic: true });
  const raftPoint = new THREE.Object3D();
  raftPoint.name = 'tide-raft-interact';
  raftPoint.position.set(0, -0.25, 0.95);
  raftPoint.rotation.y = Math.PI;
  raftMesh.add(raftPoint);
  const raftPush = new Interactable({
    id: 'tide-raft',
    kind: 'push',
    object: raftMesh,
    interactPoint: raftPoint,
    track: { from: raftHome.clone(), to: raftAnchor.clone() },
  });
  opts.interaction.add(raftPush);
  // 石槽（白盒标示）
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x3d4447, roughness: 0.9 });
  for (const x of [4.15, 5.85]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 1.3), slotMat);
    rail.position.set(x, SAND_Y + 0.15, 24.7);
    root.add(rail);
  }
  const raft = tide.addFloatable(
    new Floatable({
      id: 'tide-raft',
      object: raftMesh,
      restY: raftHome.y,
      floatOffset: 0.15,
      anchors: [boxZone({ x: 4.4, y: -5, z: 24.2 }, { x: 5.6, y: 10, z: 25.1 })],
      homePosition: raftHome,
      push: raftPush,
      events,
    }),
  );

  return {
    tide,
    bell,
    raft,
    raftPush,
    water,
    gauge,
    reefGate,
    deepWalls,
    anchors: {
      safe,
      bellStand: new THREE.Vector3(-4, DECK_Y + 0.02, 22.45),
      reef: new THREE.Vector3(0, SAND_Y + 0.02, 32),
      raftHome,
      raftAnchor,
      raftStand: new THREE.Vector3(5, SAND_Y + 0.02, 29.45),
      deckAtAnchor: new THREE.Vector3(5, DECK_Y + 0.02, 23.4),
    },
    update(dt: number): void {
      water.setLevel(tide.level);
      water.update(dt);
      bell.update(dt);
    },
  };
}
