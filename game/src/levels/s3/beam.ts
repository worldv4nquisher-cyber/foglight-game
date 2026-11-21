import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { PuzzleGroup } from '@/systems/interaction/PuzzleMode';
import { RotatablePart } from '@/systems/interaction/RotatablePart';
import { BeamEmitter } from '@/systems/light/BeamEmitter';
import { Mirror } from '@/systems/light/Mirror';
import { BeamReceiver } from '@/systems/light/BeamReceiver';
import { BeamTracer } from '@/systems/light/BeamTracer';
import { S3, v3 } from './layout';

/**
 * S3 谜题 5「灯塔光路」（v0.1-015，白盒；场景和 scripts/verify-s3.mjs 共用）。全部坐标是 S3 局部，节点挂在 S3 根节点下
 * （BeamTracer / 物理都按世界矩阵算，所以 buildS3Beam 先挂到 parent 再加碰撞）。
 *
 *   云缝天光 lightpath-0 (9.5, 4.6, 0.6) → 西窗 → 窗口镜 (2.35, 1.35, 0)（双轴）→ 楼梯井 → 导光镜 1 (10.6 m，单轴，俯仰固定 −1.1°)
 *   → 导光镜 2 (16.6 m，单轴，俯仰固定 +4.4°) → 灯室地板点火口 (0, 21.85, 0)
 *
 * 档位：竖轴 15°（Shift 精调 7.5°），初始全 0；正解 窗口镜 竖轴 45 / 俯仰 −30（范围 −60…+30），导光镜 1 = 60，导光镜 2 = 300。
 * verify-s3 按 7.5° 穷举验证每面镜子只有一档能把光送到下一目标。
 * 每面镜子单独一个 PuzzleGroup：R 只重置当前这面镜子。
 */
export const S3_BEAM = {
  solution: { windowYaw: 45, windowPitch: -30, a: 60, b: 300 },
  windowPitchRange: [-60, 30] as const,
  mirrorHalf: 0.35,
  /**
   * 机位（局部，lookAt 按 frame() 取两/三个目标方向的平分线，FOV 按 16:9 框住所有目标再留余量）：
   * - 窗口镜：楼梯内沿以内俯拍窗口与镜面，出射光向画面上方延伸
   * - 导光镜 1 / 2：悬在楼梯井里（玩家到不了），能看到镜面正面和下一目标
   */
  cams: {
    window: { position: [1, 2.6, -0.9] as const, targets: ['window', 'windowOuter'] as const, fov: 64 },
    a: { position: [0.3, 9.4, 1.4] as const, targets: ['a', 'b'] as const, fov: 58 },
    b: { position: [0.3, 15.2, 1.2] as const, targets: ['b', 'port'] as const, fov: 56 },
  },
  windowOuter: [4.034, 1.6, 0] as const,
} as const;

export type S3MirrorKey = 'window' | 'a' | 'b';
export type S3CamTarget = 'window' | 'a' | 'b' | 'port' | 'windowOuter';

export interface S3MirrorRig {
  key: S3MirrorKey;
  mirror: Mirror;
  part: RotatablePart;
  puzzle: PuzzleGroup;
  cam: THREE.Object3D;
  center: THREE.Vector3;
  root: THREE.Group;
  plane: THREE.Mesh;
  /** 理想法线（局部） */
  idealNormal: THREE.Vector3;
}

export interface S3Beam {
  root: THREE.Group;
  tracer: BeamTracer;
  /** 主天光（lightpath-0 → 窗口镜） */
  sky: BeamEmitter;
  /** 塔外礁石上的冷光预告（同周期同相位；照到 skyPreviewTarget 的挡光块就停） */
  preview: BeamEmitter;
  mirrors: Record<S3MirrorKey, S3MirrorRig>;
  igniter: BeamReceiver;
  igniterLens: THREE.Mesh;
  colliders: THREE.Mesh[];
  /** 下一目标（局部）：window → A，A → B，B → 点火口 */
  targets: Record<S3MirrorKey, THREE.Vector3>;
  solve(): void;
  reset(): void;
}

const DEG = Math.PI / 180;
const P = (k: number): THREE.Vector3 => v3(S3.lightPath[k] as readonly [number, number, number]);

/** 法线 ↔ （竖轴 ψ = atan2(nx, nz)，仰角 e） */
export const normalOf = (psiDeg: number, eDeg: number): THREE.Vector3 =>
  new THREE.Vector3(Math.sin(psiDeg * DEG) * Math.cos(eDeg * DEG), Math.sin(eDeg * DEG), Math.cos(psiDeg * DEG) * Math.cos(eDeg * DEG));

export const reflect = (d: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 => d.clone().sub(n.clone().multiplyScalar(2 * d.dot(n)));

/** 射线（o, d 单位）到点 p 的最近距离（只算前方） */
export const rayPointDist = (o: THREE.Vector3, d: THREE.Vector3, p: THREE.Vector3): number => {
  const t = Math.max(0, p.clone().sub(o).dot(d));
  return o.clone().addScaledVector(d, t).distanceTo(p);
};

/** 俯仰固定时，黄金分割找竖轴角（°）让反射光最接近目标 */
export function solveYawAtPitch(center: THREE.Vector3, inDir: THREE.Vector3, target: THREE.Vector3, eDeg: number, guessDeg: number): number {
  const f = (psi: number): number => rayPointDist(center, reflect(inDir, normalOf(psi, eDeg)), target);
  let a = guessDeg - 20;
  let b = guessDeg + 20;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (f(c) < f(d)) b = d;
    else a = c;
  }
  return (a + b) / 2;
}

/** 机位：从 position 看一组点，返回 lookAt（局部）和 16:9 下框住全部点所需的竖直 FOV（°） */
export function frame(position: readonly [number, number, number], pts: THREE.Vector3[], aspect = 16 / 9): { lookAt: THREE.Vector3; needFov: number } {
  const c = v3(position);
  const f = new THREE.Vector3();
  for (const p of pts) f.add(p.clone().sub(c).normalize());
  f.normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  let need = 0;
  for (const p of pts) {
    const d = p.clone().sub(c).normalize();
    const z = d.dot(f);
    const x = Math.abs(d.dot(r)) / z;
    const y = Math.abs(d.dot(u)) / z;
    need = Math.max(need, (2 * Math.atan(y)) / DEG, (2 * Math.atan(x / aspect)) / DEG);
  }
  return { lookAt: c.clone().add(f), needFov: need };
}

export function buildS3Beam(physics: PhysicsSystem | null, parent: THREE.Object3D): S3Beam {
  const root = new THREE.Group();
  root.name = 's3-beam-puzzle';
  parent.add(root);
  const stone = new THREE.MeshStandardMaterial({ name: 'gb-stone', color: 0x6f7477, roughness: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ name: 'gb-metal', color: 0x5f6b70, metalness: 0.6, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ name: 'gb-mirror', color: 0xc8d4da, metalness: 0.9, roughness: 0.08 });
  const lensMat = new THREE.MeshStandardMaterial({ name: 'gb-lens', color: 0x3a4246, roughness: 0.3 });
  const colliders: THREE.Mesh[] = [];
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, name: string, x: number, y: number, z: number, p: THREE.Object3D = root): THREE.Mesh => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    p.add(o);
    return o;
  };

  const L0 = P(0);
  const W = P(1);
  const A = P(2);
  const B = P(3);
  const PORT = P(4);
  const targets: Record<S3MirrorKey, THREE.Vector3> = { window: A.clone(), a: B.clone(), b: PORT.clone() };
  const ideal = (from: THREE.Vector3, at: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 =>
    to.clone().sub(at).normalize().sub(at.clone().sub(from).normalize()).normalize();
  const sol = S3_BEAM.solution;
  const half = S3_BEAM.mirrorHalf;

  const buildRig = (key: S3MirrorKey, from: THREE.Vector3, at: THREE.Vector3, to: THREE.Vector3): S3MirrorRig => {
    const spec = S3.mirrors[key];
    const g = new THREE.Group();
    g.name = spec.id;
    root.add(g);
    const n = ideal(from, at, to);
    let psi = Math.atan2(n.x, n.z) / DEG;
    let e = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) / DEG;
    if (key !== 'window') {
      e = (spec as { fixedPitchDeg: number }).fixedPitchDeg;
      psi = solveYawAtPitch(at, at.clone().sub(from).normalize(), to, e, psi);
    }
    const yawSol = key === 'window' ? sol.windowYaw : key === 'a' ? sol.a : sol.b;
    const yaw = new THREE.Group();
    yaw.name = `${spec.id}-yaw`;
    yaw.position.copy(at);
    yaw.rotation.y = (psi - yawSol) * DEG;
    g.add(yaw);
    const pitch = new THREE.Group();
    pitch.name = `${spec.id}-pitch`;
    pitch.rotation.x = key === 'window' ? (-e - sol.windowPitch) * DEG : -e * DEG;
    yaw.add(pitch);
    const plane = mesh(new THREE.PlaneGeometry(half * 2, half * 2), glass, `${spec.id}-mirror-plane`, 0, 0, 0, pitch);
    plane.userData.puzzleCritical = true;
    const back = mesh(new THREE.BoxGeometry(half * 2 + 0.04, half * 2 + 0.04, 0.03), metal, `${spec.id}-back`, 0, 0, -0.02, pitch);
    back.castShadow = false;
    if (key === 'window') {
      // 镜座：底层地面 0.2 → 座顶 1.0（碰撞；光从上方镜面走）
      const h = S3.mirrors.window.seatTop - S3.groundFloorY;
      colliders.push(mesh(new THREE.BoxGeometry(0.36, h, 0.36), stone, `${spec.id}-base-collider`, at.x, S3.groundFloorY + h / 2, at.z, g));
    } else {
      // 悬臂：从楼梯内侧栏杆（r 2）伸到镜心（楼梯井里，无碰撞，纯装饰）
      const dir = new THREE.Vector3(at.x, 0, at.z).normalize();
      const r0 = Math.hypot(at.x, at.z);
      const len = 2 - r0;
      const arm = mesh(new THREE.BoxGeometry(0.06, 0.06, len), metal, `${spec.id}-arm`, at.x + dir.x * (len / 2), at.y - half - 0.05, at.z + dir.z * (len / 2), g);
      arm.rotation.y = Math.atan2(dir.x, dir.z);
      const post = mesh(new THREE.CylinderGeometry(0.03, 0.03, half + 0.05, 8), metal, `${spec.id}-post`, at.x, at.y - (half + 0.05) / 2, at.z, g);
      post.castShadow = false;
    }
    const mirror = new Mirror({ id: spec.id, node: plane, halfWidth: half, halfHeight: half });
    const part =
      key === 'window'
        ? new RotatablePart({
            id: spec.id,
            node: yaw,
            axes: [
              { axis: 'y', node: yaw, initial: 0 },
              { axis: 'x', node: pitch, min: S3_BEAM.windowPitchRange[0], max: S3_BEAM.windowPitchRange[1], initial: 0 },
            ],
          })
        : new RotatablePart({ id: spec.id, node: yaw, axes: [{ axis: 'y', initial: 0 }] });
    const cs = S3_BEAM.cams[key];
    const cam = new THREE.Object3D();
    cam.name = `${spec.id}-cam`;
    cam.position.set(cs.position[0], cs.position[1], cs.position[2]);
    cam.userData.fov = cs.fov;
    root.add(cam);
    const puzzle = new PuzzleGroup({ id: `${spec.id}-puzzle`, camNode: cam, parts: [part] });
    return { key, mirror, part, puzzle, cam, center: at.clone(), root: g, plane, idealNormal: n };
  };
  const mirrors: Record<S3MirrorKey, S3MirrorRig> = { window: buildRig('window', L0, W, A), a: buildRig('a', W, A, B), b: buildRig('b', A, B, PORT) };

  // ---- 点火口：灯室地板中心（透镜 + -receiver）；油阀没开时 requires 由谜题脚本注入
  const igniterLens = mesh(new THREE.SphereGeometry(0.12, 16, 10), lensMat, 'ignition-port-s3-lens', PORT.x, PORT.y, PORT.z);
  igniterLens.userData.puzzleCritical = true;
  const portNode = new THREE.Object3D();
  portNode.name = 'ignition-port-s3-receiver';
  portNode.position.copy(PORT);
  root.add(portNode);
  // manual（015 C）：连续受光 1.0 s 进入可点灯（receiver:ready），断光 ≤ 0.3 s 不算断，20 s 没点发 ignition:reminder；按 E 由谜题脚本 activate()
  const igniter = new BeamReceiver({
    id: 'ignition-port-s3',
    node: portNode,
    holdSec: gameplay.beam.igniterHoldSec,
    lens: igniterLens,
    mode: 'manual',
    graceSec: gameplay.beam.igniterGraceSec,
    reminderSec: gameplay.beam.igniterReminderSec,
  });

  // ---- 光源：节点 +Z 指向目标（Object3D.lookAt 吃世界坐标）
  root.updateMatrixWorld(true);
  const aim = (name: string, from: THREE.Vector3, to: THREE.Vector3): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.copy(from);
    root.add(o);
    o.updateMatrixWorld(true);
    o.lookAt(root.localToWorld(to.clone()));
    return o;
  };
  const sky = new BeamEmitter({ id: 'sky-s3', node: aim('sky-beam-s3-emitter', L0, W), kind: 'sky', color: 'coldWhite' });
  const previewTarget = v3(S3.points.skyPreviewTarget);
  const previewFrom = previewTarget.clone().addScaledVector(W.clone().sub(L0).normalize(), -9);
  const preview = new BeamEmitter({ id: 'sky-preview-s3', node: aim('sky-preview-s3-emitter', previewFrom, previewTarget), kind: 'sky', color: 'coldWhite' });

  // ---- 机位
  for (const rig of Object.values(mirrors)) {
    const cs = S3_BEAM.cams[rig.key];
    const pts = cs.targets.map((t) => (t === 'window' ? W : t === 'a' ? A : t === 'b' ? B : t === 'port' ? PORT : v3(S3_BEAM.windowOuter)));
    const { lookAt } = frame(cs.position, pts);
    rig.cam.updateMatrixWorld(true);
    rig.cam.lookAt(root.localToWorld(lookAt));
    rig.cam.rotateY(Math.PI);
  }

  root.updateMatrixWorld(true);
  if (physics) for (const c of colliders) physics.addMesh(c);

  const tracer = new BeamTracer(physics);
  tracer.addEmitter(sky);
  tracer.addEmitter(preview);
  for (const rig of Object.values(mirrors)) tracer.addMirror(rig.mirror);
  tracer.addReceiver(igniter);

  return {
    root,
    tracer,
    sky,
    preview,
    mirrors,
    igniter,
    igniterLens,
    colliders,
    targets,
    solve(): void {
      mirrors.window.part.setAngle(0, sol.windowYaw);
      mirrors.window.part.setAngle(1, sol.windowPitch);
      mirrors.a.part.setAngle(0, sol.a);
      mirrors.b.part.setAngle(0, sol.b);
    },
    reset(): void {
      for (const rig of Object.values(mirrors)) rig.part.reset();
    },
  };
}
