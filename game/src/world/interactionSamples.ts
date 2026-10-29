import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { PuzzleGroup } from '@/systems/interaction/PuzzleMode';
import { RotatablePart } from '@/systems/interaction/RotatablePart';

/**
 * 测试场地的交互示例（v0.1-004 验收：八种交互各一例）。白盒几何，全部在 x = 13–18、z = -3–10 一带，
 * 玩家沿 x = 16 的「交互走廊」走：东侧 inspect / read / pickup / place-A / 多页日志（z = 10，005），西侧 use / hold / place-B / push；
 * puzzle 是原来西边的测试机关底座（v0.1-003 机位）上的两个部件（单轴转盘 + 双轴小镜）。
 */
export interface InteractionSamples {
  root: THREE.Group;
  /** 各示例的站位（测试用）：站在这里、朝 facing 方向就能交互 */
  stands: Record<string, { position: THREE.Vector3; facing: number }>;
  puzzle: PuzzleGroup;
  bellSwing: { t: number };
  update(dt: number): void;
}

const LANE_X = 16;
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, name: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.name = name;
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

/** -interact 空节点：站位 + 朝向（+Z 指向物体） */
function interactNode(name: string, x: number, z: number, faceX: number, faceZ: number): THREE.Object3D {
  const n = new THREE.Object3D();
  n.name = `${name}-interact`;
  n.position.set(x, 0, z);
  n.lookAt(faceX, 0, faceZ);
  return n;
}

export function buildInteractionSamples(opts: {
  scene: THREE.Scene;
  physics: PhysicsSystem;
  interaction: InteractionSystem;
  events: EventBus;
  /** 测试机关底座中心（顶面）与机位节点（testCourse.anchors.mechanism） */
  mechanism: { center: THREE.Vector3; stand: THREE.Vector3; cam: THREE.Object3D };
  beep?: (freq: number, dur: number) => void;
}): InteractionSamples {
  const { physics, interaction: ix, events } = opts;
  const root = new THREE.Group();
  root.name = 'interaction-samples';
  opts.scene.add(root);
  const wood = mat(0x7a6a58);
  const stone = mat(0x8a8f92);
  const metal = mat(0x6f7b80, { metalness: 0.6, roughness: 0.45 });
  const stands: InteractionSamples['stands'] = {};
  const addStand = (id: string, x: number, z: number, fx: number, fz: number): void => {
    stands[id] = { position: new THREE.Vector3(x, 0.02, z), facing: Math.atan2(fx - x, fz - z) };
  };
  const solid = (o: THREE.Mesh): THREE.Mesh => {
    root.add(o);
    o.updateWorldMatrix(true, false);
    physics.addMesh(o);
    return o;
  };

  // ---- 东侧 ----
  // inspect：晾着的网（木箱 + 网）
  const crate = solid(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), wood, 'sample-inspect', 17.6, 0.35, -2));
  ix.add(new Interactable({ id: 'sample-inspect', kind: 'inspect', object: crate, textId: 'ch1.s1.nets.inspect' }));
  addStand('sample-inspect', LANE_X, -2, 17.6, -2);

  // read：告示牌
  const board = new THREE.Group();
  board.name = 'sample-read';
  board.position.set(17.7, 0, 1);
  const post = mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), wood, 'sample-read-post', 0, 0.75, 0);
  const panel = mesh(new THREE.BoxGeometry(0.06, 0.6, 0.8), mat(0xd8d2c4), 'sample-read-panel', -0.08, 1.25, 0);
  board.add(post, panel);
  root.add(board);
  physics.addMesh(post);
  ix.add(new Interactable({ id: 'sample-read', kind: 'read', object: board, textId: 'ch1.s1.notice.doc', focus: panel }));
  addStand('sample-read', LANE_X, 1, 17.7, 1);

  // read（多页）：桌上父亲的日志（ch1.s2.journal.doc，5 页；v0.1-005 翻页验收）
  const desk = solid(mesh(new THREE.BoxGeometry(0.6, 0.75, 0.9), wood, 'sample-journal-desk', 17.6, 0.375, 10));
  const book = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.3), mat(0x4b3b2e), 'sample-journal', 17.55, 0.775, 10);
  root.add(book);
  ix.add(new Interactable({ id: 'sample-journal', kind: 'read', object: book, textId: 'ch1.s2.journal.doc', focus: desk }));
  addStand('sample-journal', LANE_X, 10, 17.6, 10);

  // pickup：底座上的风灯（底座本身也是一个 socket，风灯可以放回来）
  const lantern = new THREE.Group();
  lantern.name = 'sample-lantern';
  lantern.add(
    mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.06, 12), metal, 'lantern-base', 0, 0.03, 0),
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12), mat(0xffd38a, { emissive: 0xffa040, emissiveIntensity: 1.2 }), 'lantern-glass', 0, 0.15, 0),
    mesh(new THREE.ConeGeometry(0.11, 0.08, 12), metal, 'lantern-cap', 0, 0.28, 0),
  );
  const lanternLight = new THREE.PointLight(0xffb060, 1.2, 4, 2);
  lanternLight.position.y = 0.15;
  lantern.add(lanternLight);

  const socketStand = (id: string, x: number, z: number, h: number): THREE.Group => {
    const g = new THREE.Group();
    g.name = id;
    g.position.set(x, 0, z);
    const col = mesh(new THREE.CylinderGeometry(0.18, 0.22, h, 12), stone, `${id}-column`, 0, h / 2, 0);
    g.add(col);
    const socket = new THREE.Object3D();
    socket.name = `${id}-socket`;
    socket.position.y = h;
    g.add(socket);
    root.add(g);
    physics.addMesh(col);
    return g;
  };
  const pedestal = socketStand('sample-pedestal', 17.6, 4, 0.9);
  ix.held.setPlaced('lantern', lantern, pedestal.getObjectByName('sample-pedestal-socket')!);
  ix.add(new Interactable({ id: 'sample-lantern', kind: 'pickup', item: 'lantern', object: lantern }));
  ix.add(new Interactable({ id: 'sample-pedestal', kind: 'place', item: 'lantern', object: pedestal }));
  addStand('sample-lantern', LANE_X, 4, 17.6, 4);

  // place：灯台 A（东）
  const standA = socketStand('sample-stand-a', 17.6, 7, 1.0);
  ix.add(new Interactable({ id: 'sample-stand-a', kind: 'place', item: 'lantern', object: standA }));
  addStand('sample-stand-a', LANE_X, 7, 17.6, 7);

  // ---- 西侧 ----
  // use：小潮汐钟（敲一下摆动），交互点在钟前 1 m
  const bell = new THREE.Group();
  bell.name = 'sample-bell';
  bell.position.set(14.2, 0, -2);
  const frame = mesh(new THREE.BoxGeometry(0.15, 1.8, 0.9), wood, 'sample-bell-frame', -0.25, 0.9, 0);
  const swing = new THREE.Group();
  swing.name = 'bell-swing';
  swing.position.set(0.05, 1.6, 0);
  swing.add(mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.45, 16, 1, true), mat(0x6d7f76, { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }), 'bell-body', 0, -0.25, 0));
  bell.add(frame, swing);
  root.add(bell);
  physics.addMesh(frame);
  const bellPoint = interactNode('sample-bell', 15.25, -2, 14.2, -2);
  root.add(bellPoint);
  ix.add(new Interactable({ id: 'sample-bell', kind: 'use', prompt: 'ui.prompt.ring', object: bell, interactPoint: bellPoint, focus: new THREE.Vector3(14.2, 1.2, -2), reach: 0.3 }));
  addStand('sample-bell', LANE_X, -2, 14.2, -2);
  const bellSwing = { t: 0 };

  // hold：油阀（按住 E 2 s 拧开，手轮转动）
  const valve = new THREE.Group();
  valve.name = 'sample-valve';
  valve.position.set(14.2, 0, 1);
  const pipe = mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), metal, 'sample-valve-pipe', -0.1, 0.6, 0);
  const wheel = mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 24), mat(0x9a4a3a, { metalness: 0.5 }), 'valve-wheel', 0.12, 0.9, 0);
  wheel.rotation.y = Math.PI / 2;
  valve.add(pipe, wheel);
  root.add(valve);
  physics.addMesh(pipe);
  const valvePoint = interactNode('sample-valve', 15.0, 1, 14.2, 1);
  root.add(valvePoint);
  ix.add(new Interactable({ id: 'sample-valve', kind: 'hold', object: valve, interactPoint: valvePoint, holdSeconds: 2, reach: 0.3 }));
  addStand('sample-valve', LANE_X, 1, 14.2, 1);
  let wheelSpin = 0;

  // place：灯台 B（西）
  const standB = socketStand('sample-stand-b', 14.4, 4, 1.0);
  ix.add(new Interactable({ id: 'sample-stand-b', kind: 'place', item: 'lantern', object: standB }));
  addStand('sample-stand-b', LANE_X, 4, 14.4, 4);

  // push：浮台（沿 +Z 推 3 m 到终点卡位）。交互点在浮台南侧、随浮台移动
  const raft = mesh(new THREE.BoxGeometry(1.2, 0.5, 1.0), wood, 'sample-raft', 13.4, 0.25, 6.5);
  root.add(raft);
  raft.updateWorldMatrix(true, false);
  physics.addMesh(raft, { dynamic: true });
  const raftPoint = new THREE.Object3D();
  raftPoint.name = 'sample-raft-interact';
  raftPoint.position.set(0, -0.25, -0.95);
  raft.add(raftPoint);
  ix.add(
    new Interactable({
      id: 'sample-raft',
      kind: 'push',
      object: raft,
      interactPoint: raftPoint,
      track: { from: new THREE.Vector3(13.4, 0.25, 6.5), to: new THREE.Vector3(13.4, 0.25, 9.5) },
    }),
  );
  addStand('sample-raft', 13.4, 5.3, 13.4, 6.5);
  // 终点卡位：放一块挡板（白盒标示）
  root.add(mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), stone, 'sample-raft-stop', 13.4, 0.06, 10.1));

  // ---- puzzle：测试机关底座上的两个部件 ----
  const m = opts.mechanism;
  const dial = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 6), mat(0xb0a080), 'sample-dial', m.center.x - 0.18, m.center.y + 0.03, m.center.z);
  const notch = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.16), mat(0x2d2a26), 'sample-dial-notch', 0, 0.045, 0.1);
  dial.add(notch);
  const mirrorYaw = new THREE.Group();
  mirrorYaw.name = 'mirror-yaw';
  mirrorYaw.position.set(m.center.x + 0.2, m.center.y, m.center.z);
  const mirrorPitch = new THREE.Group();
  mirrorPitch.name = 'mirror-pitch';
  mirrorPitch.position.y = 0.2;
  mirrorPitch.add(mesh(new THREE.BoxGeometry(0.26, 0.26, 0.03), mat(0xc8d4da, { metalness: 0.9, roughness: 0.1 }), 'mirror-plane', 0, 0, 0));
  mirrorYaw.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), metal, 'mirror-post', 0, 0.1, 0), mirrorPitch);
  root.add(dial, mirrorYaw);
  const puzzle = new PuzzleGroup({
    id: 'sample-mechanism',
    camNode: m.cam,
    parts: [
      new RotatablePart({ id: 'dial', node: dial, axes: [{ axis: 'y', initial: 0 }] }),
      new RotatablePart({
        id: 'mirror',
        node: mirrorYaw,
        axes: [
          { axis: 'y', min: -90, max: 90, initial: 0, node: mirrorYaw },
          { axis: 'x', min: -30, max: 30, initial: 0, node: mirrorPitch },
        ],
      }),
    ],
  });
  ix.add(
    new Interactable({
      id: 'sample-mechanism',
      kind: 'puzzle',
      object: dial,
      puzzle,
      focus: m.center.clone(),
      reach: 0.4,
    }),
  );
  stands['sample-mechanism'] = { position: m.stand.clone().setY(0.02), facing: Math.atan2(m.center.x - m.stand.x, m.center.z - m.stand.z) };

  // 示例反馈（真实谜题逻辑同样只监听事件）
  events.on('interact:used', ({ id }) => {
    if (id === 'sample-bell') {
      bellSwing.t = 1.6;
      opts.beep?.(520, 0.6);
    } else if (id === 'sample-valve') {
      wheelSpin = 1.2;
      opts.beep?.(220, 0.3);
    } else if (id === 'sample-raft') opts.beep?.(140, 0.3);
  });
  events.on('puzzle:partRotated', ({ fine }) => opts.beep?.(fine ? 1400 : 1100, 0.03));

  return {
    root,
    stands,
    puzzle,
    bellSwing,
    update(dt: number): void {
      if (bellSwing.t > 0) {
        bellSwing.t = Math.max(0, bellSwing.t - dt);
        swing.rotation.z = Math.sin(bellSwing.t * 9) * 0.35 * (bellSwing.t / 1.6);
      }
      if (wheelSpin > 0) {
        wheelSpin = Math.max(0, wheelSpin - dt);
        wheel.rotation.x += dt * 6;
      }
    },
  };
}
