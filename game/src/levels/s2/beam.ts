import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { PuzzleGroup } from '@/systems/interaction/PuzzleMode';
import { RotatablePart } from '@/systems/interaction/RotatablePart';
import { BeamEmitter } from '@/systems/light/BeamEmitter';
import { Mirror } from '@/systems/light/Mirror';
import { BeamReceiver } from '@/systems/light/BeamReceiver';
import { BeamTracer } from '@/systems/light/BeamTracer';
import { S2 } from './layout';

/**
 * S2 谜题 3「两面镜子」光路（v0.1-014，白盒；纯 three.js + 物理，场景和 scripts/verify-s2.mjs 共用）。
 *
 *   东灯台 (−13.2, ·, −5) 风灯出光 0.846 → +Z → 镜 A (−13.2, 0.85, 3) → 镜 B (−7.2, 0.85, 8.6)
 *   → 绕过屋角（院子北墙西段敞开）→ 北墙外光感锁 (−4.8, 0.85, 4)
 *   西灯台 (−8, ·, −5) → +Z 被晾衣架挡住（z ≈ −2.95）。
 * 两面镜子都是单轴 15° 档（Shift 精调也是 15°：每面镜子 24 档里只有一档正确，verify-s2 穷举 24 × 24 验证唯一解），
 * 初始 0°，正解 A = +30°（右两档）、B = 315°（左三档）。镜子的基准朝向由几何反推（法线 ∝ 出射 − 入射）。
 */
export const S2_BEAM = {
  stepDeg: 15,
  solution: { a: 30, b: 315 },
  /** 光感锁接收器球心（锁框贴北墙外墙面 z 4.0…4.12，球心再往外 8 cm） */
  lockCenter: [S2.lightLock[0], S2.beamY, S2.lightLock[2] + 0.2] as const,
  /** 风灯放在灯台 socket 上：socket 高 0.70，风灯本体中心 0.15 ⇒ 出光 0.846（见 S2.lampEmitY） */
  lampSocketY: 0.7,
  /** 机位：院子东南高处看向两面镜子和光感锁所在的屋角 */
  cam: { position: [-12.4, 9.2, -4.8] as const, lookAt: [-8.9, 0.6, 5.0] as const },
} as const;

export interface S2Lamp {
  key: 'east' | 'west';
  stand: THREE.Group;
  socket: THREE.Object3D;
  emitter: BeamEmitter;
}

export interface S2MirrorRig {
  mirror: Mirror;
  part: RotatablePart;
  /** 镜心（世界坐标） */
  center: THREE.Vector3;
  root: THREE.Object3D;
}

export interface S2Beam {
  root: THREE.Group;
  tracer: BeamTracer;
  lamps: { east: S2Lamp; west: S2Lamp };
  mirrorA: S2MirrorRig;
  mirrorB: S2MirrorRig;
  lock: BeamReceiver;
  lockFrame: THREE.Mesh;
  lockLens: THREE.Mesh;
  puzzle: PuzzleGroup;
  cam: THREE.Object3D;
  /** 有碰撞的白盒件（灯台柱、镜座、锁框） */
  colliders: THREE.Mesh[];
  /** 两面镜子转到正解（测试 / 冒烟用） */
  solve(): void;
}

const mirrorYawDeg = (inDir: THREE.Vector3, outDir: THREE.Vector3): number => {
  const n = outDir.clone().sub(inDir).normalize();
  return THREE.MathUtils.radToDeg(Math.atan2(n.x, n.z));
};

export function buildS2Beam(physics: PhysicsSystem | null): S2Beam {
  const root = new THREE.Group();
  root.name = 's2-beam-puzzle';
  const stone = new THREE.MeshStandardMaterial({ name: 'gb-stone', color: 0x6f7477, roughness: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ name: 'gb-metal', color: 0x5f6b70, metalness: 0.6, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ name: 'gb-mirror', color: 0xc8d4da, metalness: 0.9, roughness: 0.08 });
  const lensMat = new THREE.MeshStandardMaterial({ name: 'gb-lens', color: 0x3a4246, roughness: 0.3 });
  const colliders: THREE.Mesh[] = [];
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, name: string, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const collider = (o: THREE.Mesh): THREE.Mesh => {
    colliders.push(o);
    return o;
  };

  // ---- 灯台：方柱（碰撞，顶 0.70）+ 聚光罩（朝 +Z）+ -socket（风灯放这里）+ -emitter
  const buildLamp = (key: 'east' | 'west'): S2Lamp => {
    const [x, , z] = S2.lamps[key];
    const stand = new THREE.Group();
    stand.name = `lamp-stand-${key}-s2`;
    root.add(stand);
    const h = S2_BEAM.lampSocketY;
    collider(mesh(new THREE.BoxGeometry(0.36, h, 0.36), stone, `lamp-stand-${key}-s2-collider`, x, h / 2, z, stand));
    const hood = mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.3, 14, 1, true), metal, `lamp-stand-${key}-s2-hood`, x, S2.lampEmitY, z + 0.1, stand);
    hood.rotation.x = Math.PI / 2;
    (hood.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    const socket = new THREE.Object3D();
    socket.name = `lamp-stand-${key}-s2-socket`;
    socket.position.set(x, h, z);
    stand.add(socket);
    const node = new THREE.Object3D();
    node.name = `lamp-stand-${key}-s2-emitter`;
    node.position.set(x, S2.lampEmitY, z + 0.2);
    stand.add(node);
    const emitter = new BeamEmitter({ id: `lamp-${key}-s2`, node, kind: 'socket', socket: socket.name, item: 'lantern', color: 'warm' });
    return { key, stand, socket, emitter };
  };
  const lamps = { east: buildLamp('east'), west: buildLamp('west') };

  // ---- 两面立镜：镜座（碰撞，顶 0.5，光从上面过）+ yaw 节点（RotatablePart）+ 镜面（局部 +Z 法线）
  const A = new THREE.Vector3(...S2.mirrors.a);
  const B = new THREE.Vector3(...S2.mirrors.b);
  const L = new THREE.Vector3(...S2_BEAM.lockCenter);
  const flat = (v: THREE.Vector3): THREE.Vector3 => v.setY(0).normalize();
  const inA = new THREE.Vector3(0, 0, 1);
  const outA = flat(B.clone().sub(A));
  const outB = flat(L.clone().sub(B));
  const buildMirror = (id: string, c: THREE.Vector3, correctYawDeg: number, solution: number): S2MirrorRig => {
    const g = new THREE.Group();
    g.name = id;
    root.add(g);
    collider(mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), stone, `${id}-base-collider`, c.x, 0.25, c.z, g));
    const yaw = new THREE.Group();
    yaw.name = `${id}-yaw`;
    yaw.position.copy(c);
    yaw.rotation.y = THREE.MathUtils.degToRad(correctYawDeg - solution);
    g.add(yaw);
    const plane = mesh(new THREE.PlaneGeometry(0.7, 0.7), glass, `${id}-mirror-plane`, 0, 0, 0, yaw);
    const back = mesh(new THREE.BoxGeometry(0.74, 0.74, 0.03), metal, `${id}-back`, 0, 0, -0.02, yaw);
    back.castShadow = false;
    plane.userData.puzzleCritical = true;
    const mirror = new Mirror({ id, node: plane, halfWidth: 0.35, halfHeight: 0.35 });
    const part = new RotatablePart({ id, node: yaw, axes: [{ axis: 'y', initial: 0 }], stepDeg: S2_BEAM.stepDeg, fineStepDeg: S2_BEAM.stepDeg });
    return { mirror, part, center: c.clone(), root: g };
  };
  const mirrorA = buildMirror('mirror-stand-s2-a', A, mirrorYawDeg(inA, outA), S2_BEAM.solution.a);
  const mirrorB = buildMirror('mirror-stand-s2-b', B, mirrorYawDeg(outA, outB), S2_BEAM.solution.b);

  // ---- 光感锁：锁框贴北墙外墙面（碰撞）+ 透镜 + -receiver
  const [lx, ly, lz] = S2.lightLock;
  const lockFrame = collider(mesh(new THREE.BoxGeometry(0.6, 0.7, 0.12), stone, 'light-lock-s2-frame-collider', lx, ly, lz + 0.06));
  const lockLens = mesh(new THREE.SphereGeometry(0.12, 16, 10), lensMat, 'light-lock-s2-lens', lx, ly, lz + 0.13);
  lockLens.userData.puzzleCritical = true;
  const lockNode = new THREE.Object3D();
  lockNode.name = 'light-lock-s2-receiver';
  lockNode.position.copy(L);
  root.add(lockNode);
  const lock = new BeamReceiver({ id: 'light-lock-s2', node: lockNode, holdSec: gameplay.beam.lockHoldSec, lens: lockLens });

  if (physics) for (const c of colliders) physics.addMesh(c);
  root.updateMatrixWorld(true);

  const tracer = new BeamTracer(physics);
  tracer.addEmitter(lamps.east.emitter);
  tracer.addEmitter(lamps.west.emitter);
  tracer.addMirror(mirrorA.mirror);
  tracer.addMirror(mirrorB.mirror);
  tracer.addReceiver(lock);

  // ---- 机位（-cam：-Z 看向目标，PuzzleGroup 约定同测试场）
  const cam = new THREE.Object3D();
  cam.name = 'mirror-stands-s2-cam';
  cam.position.set(...S2_BEAM.cam.position);
  cam.lookAt(...S2_BEAM.cam.lookAt);
  cam.rotateY(Math.PI);
  root.add(cam);
  const puzzle = new PuzzleGroup({ id: 'mirrors-s2', camNode: cam, parts: [mirrorA.part, mirrorB.part] });
  root.updateMatrixWorld(true);

  return {
    root,
    tracer,
    lamps,
    mirrorA,
    mirrorB,
    lock,
    lockFrame,
    lockLens,
    puzzle,
    cam,
    colliders,
    solve(): void {
      mirrorA.part.setAngle(0, S2_BEAM.solution.a);
      mirrorB.part.setAngle(0, S2_BEAM.solution.b);
    },
  };
}
