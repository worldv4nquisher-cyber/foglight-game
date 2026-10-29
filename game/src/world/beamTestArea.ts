import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { PuzzleGroup } from '@/systems/interaction/PuzzleMode';
import { RotatablePart } from '@/systems/interaction/RotatablePart';
import { BeamEmitter } from '@/systems/light/BeamEmitter';
import { Mirror } from '@/systems/light/Mirror';
import { BeamReceiver } from '@/systems/light/BeamReceiver';
import { BeamTracer } from '@/systems/light/BeamTracer';
import { WhiteboxBeamRenderer } from '@/systems/light/BeamRenderer';

/**
 * 测试场地光路区（v0.1-012，白盒）：起点往西南，x −20…−14、z 4…17。光高 y = BEAM_Y = 0.85 m（v0.1-014 / QA batch5：与谜题 3 一致——提灯在灯座上出光 0.846 m）。
 *
 *   风灯灯台（带聚光罩）(−18, 0.85, 4) → +Z ── 镜 A (−18, 0.85, 10) ── +X → 镜 B (−15, 0.85, 10) ── +Z → 光感锁 (−15, 0.85, 16)
 *   镜 A 初始偏 30°（光打到旁边），机关台 (−16.5, 8) 上 E 进机位：A / D 转镜（15° 档，Shift 精调 7.5°），Q / E 换镜。
 *   云缝天光 (−19, 4, 15) 竖直向下 → 点火口 (−19, 0.8, 15)：40 s 一周期亮 25 s；没开油阀时命中只发红光（receiver:blocked）。
 *   点火口 manual 模式（015 C，与 S3 同一套）：阀已开 + 连续受光 1.0 s 进入可点灯（receiver:ready），断光 ≤ 0.3 s 不算断、超过退出（receiver:lost）；
 *   可点灯时在点火口 1.8 m、±60° 内出「E 点灯」，按 E 那一刻仍可点灯才点燃（测试场地没有拉杆 / 动作，直接锁存）；20 s 没点发 ignition:reminder。
 *   调试开关 autoIgnite（I 键，默认关）：开着时一进可点灯就自动点燃（012 旧行为，回归测光路用）。
 *   点火口触发后天光转暖（谜题 5「点火瞬间转暖」）。
 * 颜色规则（style-guide §0）：暖光只来自风灯（灯台光束）；天光 / 环境保持冷白。
 */
export interface BeamTestArea {
  tracer: BeamTracer;
  renderer: WhiteboxBeamRenderer;
  lamp: BeamEmitter;
  sky: BeamEmitter;
  mirrorA: { mirror: Mirror; part: RotatablePart };
  mirrorB: { mirror: Mirror; part: RotatablePart };
  lock: BeamReceiver;
  igniter: BeamReceiver;
  puzzle: PuzzleGroup;
  /** 机关台交互（没给 interaction 时为 null） */
  console: Interactable | null;
  readonly oilOpen: boolean;
  /** 点火口「E 点灯」交互（没给 interaction 时为 null） */
  igniteIx: Interactable | null;
  /** 调试：可点灯即自动点燃（默认关 = 按 E；测试场地 I 键切换） */
  autoIgnite: boolean;
  /** 按 E 点灯的判定（smoke 也直接调）：阀已开 + 可点灯（含 0.3 s 容差）才生效 */
  tryIgnite(): boolean;
  /** 开 / 关油阀（测试场地 U 键）：开 = 点火口前置条件满足 + 天光常亮 */
  setOil(open: boolean): void;
  /** 把两面镜子转到正解（测试 / 冒烟用） */
  solve(): void;
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** 光路高度（m）：与 S2 谜题 3（S2.beamY）一致，提灯灯座出光 0.846 m（制作人裁定，v0.1-014） */
export const BEAM_Y = 0.85;

export function buildBeamTestArea(opts: {
  scene: THREE.Scene;
  physics: PhysicsSystem;
  events: EventBus;
  interaction?: InteractionSystem;
  debug?: boolean;
}): BeamTestArea {
  const { physics, events } = opts;
  const root = new THREE.Group();
  root.name = 'beam-test-area';
  opts.scene.add(root);
  const stone = new THREE.MeshStandardMaterial({ color: 0x6f7477, roughness: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5f6b70, metalness: 0.6, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xc8d4da, metalness: 0.9, roughness: 0.08 });
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, name: string, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const post = (name: string, x: number, z: number, h: number): void => {
    mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 8), metal, `${name}-post`, x, h / 2, z);
  };
  const faceTo = (o: THREE.Object3D, dir: THREE.Vector3): void => {
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  };

  // ---- 风灯灯台（聚光罩）：-emitter 空节点 +Z 射出
  post('beam-lamp', -18, 3.6, BEAM_Y - 0.15);
  const hood = mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.34, 12, 1, true), metal, 'beam-lamp-hood', -18, BEAM_Y, 3.85);
  hood.rotation.x = Math.PI / 2;
  // 风灯本体（暖光只来自风灯）
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xffd38a, emissive: 0xffa040, emissiveIntensity: 1.2 }), 'beam-lamp-lantern', -18, BEAM_Y, 3.7);
  const lampNode = new THREE.Object3D();
  lampNode.name = 'beam-lamp-emitter';
  lampNode.position.set(-18, BEAM_Y, 4.05);
  root.add(lampNode);
  const lamp = new BeamEmitter({ id: 'beam-lamp', node: lampNode, kind: 'manual', on: true, color: 'warm' });

  // ---- 两面单轴镜（yaw 节点 = RotatablePart；子节点 -mirror-plane 局部 +Z 为镜面法线）
  const buildMirror = (id: string, x: number, z: number, normal: THREE.Vector3, initial: number): { mirror: Mirror; part: RotatablePart } => {
    post(id, x, z, BEAM_Y - 0.35);
    const yaw = new THREE.Group();
    yaw.name = `${id}-yaw`;
    yaw.position.set(x, BEAM_Y, z);
    faceTo(yaw, normal);
    root.add(yaw);
    const plane = mesh(new THREE.PlaneGeometry(0.7, 0.7), glass, `${id}-mirror-plane`, 0, 0, 0, yaw);
    // 背板：深色，表示背面挡光
    const back = mesh(new THREE.BoxGeometry(0.74, 0.74, 0.03), metal, `${id}-back`, 0, 0, -0.02, yaw);
    back.castShadow = false;
    const mirror = new Mirror({ id, node: plane, halfWidth: 0.35, halfHeight: 0.35 });
    const part = new RotatablePart({ id, node: yaw, axes: [{ axis: 'y', initial }] });
    return { mirror, part };
  };
  const mirrorA = buildMirror('beam-mirror-a', -18, 10, new THREE.Vector3(1, 0, -1), 30);
  const mirrorB = buildMirror('beam-mirror-b', -15, 10, new THREE.Vector3(-1, 0, 1), 0);

  // ---- 光感锁：-receiver 节点 + 透镜
  post('beam-lock', -15, 16.25, BEAM_Y);
  const lockFrame = mesh(new THREE.BoxGeometry(0.7, 0.9, 0.2), stone, 'beam-lock-frame', -15, BEAM_Y, 16.35);
  physics.addMesh(lockFrame, { kind: 'collider' });
  const lockLens = mesh(new THREE.SphereGeometry(0.13, 16, 10), new THREE.MeshStandardMaterial({ color: 0x3a4246, roughness: 0.3 }), 'beam-lock-lens', -15, BEAM_Y, 16.2);
  const lockNode = new THREE.Object3D();
  lockNode.name = 'beam-lock-receiver';
  lockNode.position.set(-15, BEAM_Y, 16.15);
  root.add(lockNode);
  const lock = new BeamReceiver({ id: 'beam-lock', node: lockNode, holdSec: gameplay.beam.lockHoldSec, lens: lockLens });

  // ---- 云缝天光 → 点火口（前置条件：油阀）
  let oilOpen = false;
  const skyNode = new THREE.Object3D();
  skyNode.name = 'beam-sky-emitter';
  skyNode.position.set(-19, 4, 15);
  faceTo(skyNode, new THREE.Vector3(0, -1, 0));
  root.add(skyNode);
  mesh(new THREE.BoxGeometry(0.8, 0.08, 0.8), stone, 'beam-sky-slit', -19, 4.08, 15);
  const sky = new BeamEmitter({ id: 'beam-sky', node: skyNode, kind: 'sky', color: 'coldWhite' });
  const igniterBase = mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 12), stone, 'beam-igniter-base', -19, 0.3, 15);
  physics.addMesh(igniterBase, { kind: 'collider' });
  const igLens = mesh(new THREE.SphereGeometry(0.12, 16, 10), new THREE.MeshStandardMaterial({ color: 0x3a4246, roughness: 0.3 }), 'beam-igniter-lens', -19, 0.68, 15);
  const igNode = new THREE.Object3D();
  igNode.name = 'beam-igniter-receiver';
  igNode.position.set(-19, 0.8, 15);
  root.add(igNode);
  const igniter = new BeamReceiver({
    id: 'beam-igniter',
    node: igNode,
    holdSec: gameplay.beam.igniterHoldSec,
    requires: () => oilOpen,
    lens: igLens,
    mode: 'manual',
    graceSec: gameplay.beam.igniterGraceSec,
    reminderSec: gameplay.beam.igniterReminderSec,
  });
  let autoIgnite = false;
  const tryIgnite = (): boolean => oilOpen && igniter.ready && igniter.activate();

  const tracer = new BeamTracer(physics);
  tracer.addEmitter(lamp);
  tracer.addEmitter(sky);
  tracer.addMirror(mirrorA.mirror);
  tracer.addMirror(mirrorB.mirror);
  tracer.addReceiver(lock);
  tracer.addReceiver(igniter);
  const offs: Array<() => void> = [tracer.bind(events)];
  // 谜题 5：点火瞬间光转暖
  offs.push(
    events.on('receiver:ready', ({ id }) => {
      if (id === igniter.id && autoIgnite) igniter.activate();
    }),
    events.on('interact:used', ({ id }) => {
      if (id === 'beam-igniter-ignite') tryIgnite();
    }),
    events.on('receiver:activated', ({ id }) => {
      if (id === igniter.id) events.emit('beam:setColor', { id: sky.id, color: 'warm' });
    }),
  );
  const renderer = new WhiteboxBeamRenderer({ debug: opts.debug ?? false });
  opts.scene.add(renderer.root);

  // ---- 机关台：E 进机位转两面镜子
  const cam = new THREE.Object3D();
  cam.name = 'beam-console-cam';
  cam.position.set(-16.5, 5.5, 5.5);
  cam.lookAt(-16.5, BEAM_Y, 11);
  cam.rotateY(Math.PI);
  root.add(cam);
  const puzzle = new PuzzleGroup({ id: 'beam-console', camNode: cam, parts: [mirrorA.part, mirrorB.part] });
  const consoleMesh = mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), stone, 'beam-console', -16.5, 0.45, 7);
  physics.addMesh(consoleMesh, { kind: 'collider' });
  let consoleIx: Interactable | null = null;
  if (opts.interaction) {
    consoleIx = new Interactable({ id: 'beam-console', kind: 'puzzle', object: consoleMesh, puzzle, focus: new THREE.Vector3(-16.5, 0.9, 7), reach: 0.4 });
    opts.interaction.add(consoleIx);
  }
  let igniteIx: Interactable | null = null;
  if (opts.interaction) {
    igniteIx = new Interactable({
      id: 'beam-igniter-ignite',
      kind: 'use',
      prompt: 'ui.prompt.ignite',
      object: igniterBase,
      focus: new THREE.Vector3(-19, 0.68, 15),
      reach: 0.3,
      approach: false,
    });
    igniteIx.enabled = false;
    opts.interaction.add(igniteIx);
  }
  root.updateMatrixWorld(true);

  return {
    tracer,
    renderer,
    lamp,
    sky,
    mirrorA,
    mirrorB,
    lock,
    igniter,
    puzzle,
    console: consoleIx,
    igniteIx,
    tryIgnite,
    get oilOpen() {
      return oilOpen;
    },
    get autoIgnite() {
      return autoIgnite;
    },
    set autoIgnite(v: boolean) {
      autoIgnite = v;
      if (v && igniter.ready) igniter.activate();
    },
    setOil(open: boolean): void {
      oilOpen = open;
      events.emit('beam:skyAlwaysOn', { id: sky.id, alwaysOn: open });
    },
    solve(): void {
      mirrorA.part.setAngle(0, 0);
      mirrorB.part.setAngle(0, 0);
    },
    fixedUpdate(dt: number): void {
      tracer.fixedUpdate(dt);
      if (igniteIx) igniteIx.enabled = oilOpen && igniter.ready;
    },
    update(dt: number): void {
      renderer.update(dt, tracer);
    },
    dispose(): void {
      for (const f of offs) f();
      renderer.dispose();
    },
  };
}
