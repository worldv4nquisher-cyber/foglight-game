import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { gameplay } from '@/config/gameplay';
import type { TextId } from '@/content/text';
import type { PlayerRig } from '@/entities/createPlayer';
import { XiActions, igniteLeverAngleAt, XI_IGNITE_LEVER_ALIGN, type XiActionPlayer } from '@/entities/xiActions';
import { nodeAnim } from '@/entities/xi/clips';
import type { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import type { HintSystem } from '@/systems/HintSystem';
import type { Collider, PhysicsSystem } from '@/systems/PhysicsSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { WhiteboxBeamRenderer } from '@/systems/light/BeamRenderer';
import { TideController } from '@/systems/tide/TideController';
import { TideBell } from '@/systems/tide/TideBell';
import { S3, alongDoor, toLocal, v3 } from './layout';
import { buildS3Beam, type S3Beam, type S3MirrorKey } from './beam';
import type { S3Greybox } from './greybox';
import { IgniterHum } from './igniterHum';

/**
 * S3 谜题 5「灯塔光路」+ 点灯（v0.1-015，白盒）。流程自下而上、只爬一趟：
 * 门外潮汐钟退潮 → 开塔门 → 底层按住 E 2 s 开油阀（天光改常亮）→ 底层窗口镜 → 10 m 导光镜 1 → 16 m 导光镜 2 → 22 m 灯室点灯。
 * - 每面镜子是独立机关组：R 只重置当前这面；油阀不重置。
 * - 光斑落到下一个目标上（上升沿）：被命中的镜子冷白亮一下 + sfx-glass-resonance（天光刚亮起时不算）。
 * - 未开阀时光到点火口：红光 +「没有油。」（≥ 10 s 一次）；开阀时光仍在 → 从开阀那一刻重新计时。
 * - 涨潮时人在底层（底层地面 + 楼梯 1–5 级）→ 送回塔门外平台。
 * 环境不发暖光：暖光只在点灯后打开（灯室 PointLight + 旋转光束）。
 */
export const S3_IDS = {
  tide: 's3-base',
  bell: 'tide-bell-s3',
  door: 'door-s3',
  valve: 'oil-valve-s3',
  lever: 'ignite-lever-s3',
  logbook: 'logbook-s3',
  note: 'ignition-note-s3',
  lens: 'lens-s3',
  mirror: { window: S3.mirrors.window.id, a: S3.mirrors.a.id, b: S3.mirrors.b.id } as Record<S3MirrorKey, string>,
} as const;

/** 开门时长（s） */
export const S3_DOOR_SEC = 1.4;
/**
 * 点灯独白 `ch1.s3.ignite.mono`「亮了。……爸爸，回家吧。」（text-ch1 §5 结尾演出 0:00，文本表 177 条）：
 * lighthouse:ignited（xi-ignite-lever 第 34 帧）后 IGNITE_MONO_DELAY 秒显示，持续 IGNITE_MONO_SEC 秒，只一次，演出锁定（时间轴字幕，不可点掉）；
 * 必须在 0:04 透镜转动、切塔外远景（OUTRO_CUT_SEC）前消失。
 */
export const IGNITE_MONO_DELAY = 0.5;
export const IGNITE_MONO_SEC = 3.0;
/** 结尾演出 0:04：透镜开始转动、切塔外远景（035 接管；白盒阶段 = 章节结束页） */
export const OUTRO_CUT_SEC = 4.0;
/** 「没有油。」最短间隔（s） */
export const NO_OIL_INTERVAL = 10;
/** 镜子机关的高度门限（局部 y，离各自站立面）：楼梯从镜子上方 / 下方经过时不出提示 */
const MIRROR_FLOOR: Record<S3MirrorKey, number> = { window: S3.groundFloorY, a: S3.mirrors.a.platformY, b: S3.mirrors.b.platformY };
const COLD_FLASH = 0xdce6ee;

export interface S3PuzzleDeps {
  game: Game;
  /** S3 根节点（S3_WORLD_FRAME），所有谜题件挂在它下面（局部坐标） */
  frame: THREE.Object3D;
  scene: THREE.Scene;
  physics: PhysicsSystem;
  interaction: InteractionSystem;
  hints: HintSystem;
  rig: () => PlayerRig | undefined;
  cameraFollow: CameraFollowSystem;
  greybox: S3Greybox;
  collider: (m: THREE.Mesh) => Collider | undefined;
  beamDebug: boolean;
  /** 点灯（场景负责结束流程） */
  onIgnite: () => void;
  /** 美术根节点（art=1；交互点节点的 extras.anim 从这里读） */
  artRoot?: THREE.Object3D;
}

export interface S3Lamp {
  root: THREE.Group;
  light: THREE.PointLight;
  beam: THREE.Group;
  on: boolean;
  setOn(on: boolean): void;
  update(dt: number): void;
}

export interface S3State {
  doorOpen: number;
  valveOpen: boolean;
  /** 光路到了第几个目标：0 无 / 1 导光镜 1 / 2 导光镜 2 / 3 点火口 */
  reached: number;
  flashes: number;
  noOilSaid: number;
  ignited: boolean;
  /** 按 E 生效（演出开始，之后光路不再影响结果）；ignited = 到了 ignite 帧 */
  igniting: boolean;
  /** 本次可点灯状态里是否已提醒（ignition:reminder）；进入可点灯次数（测试读） */
  reminders: number;
  readyCount: number;
  said: Set<string>;
}

export interface S3Puzzles {
  beam: S3Beam;
  renderer: WhiteboxBeamRenderer;
  lamp: S3Lamp;
  tide: TideController;
  bell: TideBell;
  lever: THREE.Group;
  /** 拉杆转动节点（绕局部 +X，pullSign × 017 逐帧角度） */
  leverSwing: THREE.Group;
  leverKnob: THREE.Mesh;
  leverIx: Interactable;
  /** 透镜 inspect（BUG-015：可点灯期间禁用，让位给拉杆） */
  lensIx: Interactable;
  /** 「E 点灯」当前能不能生效（阀已开 + 可点灯状态，含 0.3 s 断光容差） */
  canIgnite(): boolean;
  /** 可点灯嗡鸣循环（on = 正在播 / 淡入；smoke 读） */
  hum: IgniterHum;
  /** 按 E 生效：锁输入 → 走到拉杆交互点 → xi-ignite-lever → 第 34 帧点燃。返回是否生效 */
  startIgnite(): boolean;
  /** 立即点燃（ignite 帧；smoke / 测试也可直接调）。全局只生效一次 */
  igniteNow(): void;
  /** 点燃后经过的游戏时间（s；未点燃 = -1）：结尾演出时间轴（独白 0.5–3.5 s，0:04 切远景） */
  readonly outroTime: number;
  doorIx: Interactable;
  valveIx: Interactable;
  mirrorIx: Record<S3MirrorKey, Interactable>;
  readonly state: S3State;
  /** 当前光路到达的目标数（每步重算） */
  traceReached(): number;
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

interface Timer {
  at: number;
  fn: () => void;
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

export function buildS3Puzzles(d: S3PuzzleDeps): S3Puzzles {
  const { game, frame, scene, interaction, hints } = d;
  const events = game.events;
  const offs: Array<() => void> = [];
  const root = new THREE.Group();
  root.name = 's3-puzzles';
  frame.add(root);
  const say = (id: TextId): void => void game.ui.subtitles.play([id]);
  const setGoal = (id: TextId): void => game.narrative.setGoal(id);
  const sfx = (id: string): void => events.emit('sfx:play', { id });
  let time = 0;
  const timers: Timer[] = [];
  const after = (sec: number, fn: () => void): void => void timers.push({ at: time + sec, fn });
  /** 局部 → 世界（Interactable 的 focus 吃世界坐标） */
  const W = (p: readonly [number, number, number] | THREE.Vector3): THREE.Vector3 => {
    frame.updateMatrixWorld(true);
    return frame.localToWorld(p instanceof THREE.Vector3 ? p.clone() : v3(p));
  };
  /** 站位节点（局部）：+Z 朝向 (fx, fz) */
  const standAt = (name: string, p: readonly [number, number, number], fx: number, fz: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = `${name}-interact`;
    o.position.set(p[0], p[1], p[2]);
    o.rotation.y = Math.atan2(fx - p[0], fz - p[2]);
    root.add(o);
    return o;
  };
  const wood = new THREE.MeshStandardMaterial({ name: 'gb-wood', color: 0x5e5246, roughness: 0.85 });
  const paper = new THREE.MeshStandardMaterial({ name: 'gb-paper', color: 0xd8d2c2, roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ name: 'gb-metal', color: 0x5f6b70, metalness: 0.6, roughness: 0.45 });
  const copper = new THREE.MeshStandardMaterial({ name: 'gb-bell-copper', color: 0x5f746b, metalness: 0.85, roughness: 0.26, side: THREE.DoubleSide });

  const state: S3State = {
    doorOpen: 0,
    valveOpen: false,
    reached: 0,
    flashes: 0,
    noOilSaid: -Infinity,
    ignited: false,
    igniting: false,
    reminders: 0,
    readyCount: 0,
    said: new Set(),
  };
  const once = (id: TextId): boolean => {
    if (state.said.has(id)) return false;
    state.said.add(id);
    say(id);
    return true;
  };

  // ======================================================== 光路
  const beam = buildS3Beam(d.physics, frame);
  const tracer = beam.tracer;
  offs.push(tracer.bind(events));
  const renderer = new WhiteboxBeamRenderer({ debug: d.beamDebug });
  scene.add(renderer.root);
  const lamp = buildS3Lamp(frame);
  beam.igniter.requires = () => state.valveOpen;

  // ======================================================== 潮汐：底层地面 + 楼梯 1–5 级（面高 ≤ 1.2，涨潮水深 > 0.3）→ 送回门外平台
  const tmpL = new THREE.Vector3();
  const facing = new THREE.Vector3(...S3.points.respawnFacing).applyAxisAngle(new THREE.Vector3(0, 1, 0), frame.rotation.y);
  const tide = new TideController({
    id: S3_IDS.tide,
    initial: 'high',
    events,
    lowLevel: S3.tide.low,
    highLevel: S3.tide.high,
    region: (p) => {
      const l = toLocal(p, tmpL);
      return Math.hypot(l.x, l.z) < S3.tower.rIn + 0.1 && l.y < 2.2;
    },
    safePoint: { position: W(S3.points.respawn), facing: Math.atan2(facing.x, facing.z) },
  });

  // ---- 潮汐钟（与 S1 同模型同尺寸，不缩放；钟架局部 +X = 站位方向）
  const [bx, by, bz] = S3.points.bellSocket;
  const [ix, , iz] = S3.points.bellInteract;
  const bellRoot = new THREE.Group();
  bellRoot.name = S3_IDS.bell;
  bellRoot.position.set(bx, by, bz);
  bellRoot.rotation.y = Math.atan2(-(iz - bz), ix - bx);
  const bellFrame = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), wood);
    post.position.set(0, 1.1, side * 0.55);
    post.castShadow = true;
    bellFrame.add(post);
  }
  const bellBeam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 1.3), wood);
  bellBeam.position.set(0, 2.15, 0);
  bellFrame.add(bellBeam);
  const swing = new THREE.Group();
  swing.name = `${S3_IDS.bell}-swing`;
  swing.position.set(0, 2.05, 0);
  const bellBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 0.56, 20, 1, true), copper);
  bellBody.name = `${S3_IDS.bell}-body`;
  bellBody.position.y = -0.32;
  bellBody.castShadow = true;
  swing.add(bellBody);
  const clapper = new THREE.Object3D();
  clapper.name = `${S3_IDS.bell}-clapper`;
  clapper.position.y = -0.28;
  swing.add(clapper);
  bellRoot.add(bellFrame, swing);
  const bellCollider = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 1.3));
  bellCollider.name = `${S3_IDS.bell}-frame-collider`;
  bellCollider.position.set(0, 1.1, 0);
  bellCollider.visible = false;
  bellRoot.add(bellCollider);
  root.add(bellRoot);
  root.updateMatrixWorld(true);
  d.physics.addMesh(bellCollider);
  const bellPoint = standAt(S3_IDS.bell, S3.points.bellInteract, bx, bz);
  root.updateMatrixWorld(true);
  const bell = new TideBell({ id: S3_IDS.bell, tide, object: bellRoot, swing, clapper, animSource: interaction, interactPoint: bellPoint, focus: W([bx, by + 1.6, bz]), events, anim: nodeAnim(d.artRoot, 'tide-bell-s3-interact', 'xi-ring-bell') });
  interaction.add(bell.interactable);

  // ======================================================== 塔门（use：1.4 s 向内开 −100°，开始转动就撤碰撞）
  const D = S3.door;
  const doorLeaf = d.greybox.doorLeaf;
  const doorStand = standAt(S3_IDS.door, alongDoor(4.7, 0, D.y0), alongDoor(3.5, 0, 0)[0], alongDoor(3.5, 0, 0)[2]);
  root.updateMatrixWorld(true);
  const doorIx = new Interactable({
    id: S3_IDS.door,
    kind: 'use',
    prompt: 'ui.prompt.open',
    object: d.greybox.door,
    interactPoint: doorStand,
    focus: W(alongDoor(3.55, 0, D.y0 + 1.1)),
    reach: 0.3,
  });
  interaction.add(doorIx);
  let doorT = -1;
  offs.push(
    events.on('interact:used', ({ id }) => {
      if (id !== S3_IDS.door || doorT >= 0) return;
      doorT = 0;
      doorIx.enabled = false;
      const c = d.collider(doorLeaf);
      if (c) c.enabled = false;
      sfx('sfx-door-lighthouse-unlock');
    }),
  );

  // ---- 门内墙值班簿（read）
  const logbook = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.3), paper);
  logbook.name = S3_IDS.logbook;
  logbook.position.set(...S3.points.logbookRead);
  root.add(logbook);
  interaction.add(new Interactable({ id: S3_IDS.logbook, kind: 'read', object: logbook, textId: 'ch1.s3.logbook.doc', focus: W(S3.points.logbookRead) }));

  // ======================================================== 油阀（hold 2 s；站位在阀轮正前方 0.40 m 的地面上）
  const [vx, vy, vz] = S3.points.oilValve;
  const valve = new THREE.Group();
  valve.name = S3_IDS.valve;
  valve.position.set(vx, vy, vz);
  valve.rotation.y = Math.atan2(-vx, -vz);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24), metal);
  wheel.name = `${S3_IDS.valve}-wheel`;
  valve.add(wheel);
  for (const a of [0, Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), metal);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), metal);
  stem.rotation.x = Math.PI / 2;
  stem.position.z = -0.09;
  valve.add(stem);
  root.add(valve);
  const r0 = Math.hypot(vx, vz);
  const vStand: [number, number, number] = [vx * (1 - 0.4 / r0), S3.groundFloorY, vz * (1 - 0.4 / r0)];
  const valveStand = standAt(S3_IDS.valve, vStand, vx, vz);
  root.updateMatrixWorld(true);
  const valveIx = new Interactable({ id: S3_IDS.valve, kind: 'hold', prompt: 'ui.prompt.turn_hold', object: valve, interactPoint: valveStand, focus: W(S3.points.oilValve), holdSeconds: 2, anim: 'xi-valve-hold' });
  interaction.add(valveIx);
  let wheelSpin = 0;
  offs.push(
    events.on('interact:holdProgress', ({ id, progress }) => {
      if (id !== S3_IDS.valve) return;
      if (wheelSpin === 0 && progress > 0) sfx('sfx-valve-turn');
      wheelSpin = progress;
    }),
    events.on('interact:used', ({ id }) => {
      if (id !== S3_IDS.valve || state.valveOpen) return;
      state.valveOpen = true;
      valveIx.enabled = false;
      wheelSpin = 1;
      sfx('sfx-oil-flow');
      // 天光改常亮（预告光同步）
      events.emit('beam:skyAlwaysOn', { id: beam.sky.id, alwaysOn: true });
      events.emit('beam:skyAlwaysOn', { id: beam.preview.id, alwaysOn: true });
      // 光已经在点火口上（先调镜子、后开阀）：从开阀这一刻重新计时
      if (beam.igniter.state === 'blocked') beam.igniter.resetState();
      hints.completeStep('p5', 'valve');
      after(0.4, () => say('ch1.s3.valve.mono_open'));
      if (!state.ignited) setGoal('ch1.s3.goal.light');
    }),
  );

  // ======================================================== 三面镜子（各自机关组；按站立面高度开放）
  const mirrorStand: Record<S3MirrorKey, readonly [number, number, number]> = {
    window: [1.45, S3.groundFloorY, 0],
    a: S3.points.platformA,
    b: S3.points.platformB,
  };
  const flashMat: Partial<Record<S3MirrorKey, THREE.MeshStandardMaterial>> = {};
  const flashT: Record<S3MirrorKey, number> = { window: 0, a: 0, b: 0 };
  const mirrorIx = {} as Record<S3MirrorKey, Interactable>;
  for (const key of ['window', 'a', 'b'] as const) {
    const m = beam.mirrors[key];
    const src = m.plane.material;
    if (src instanceof THREE.MeshStandardMaterial) {
      const mat = src.clone();
      mat.emissive.set(COLD_FLASH);
      mat.emissiveIntensity = 0;
      m.plane.material = mat;
      flashMat[key] = mat;
    }
    const p = mirrorStand[key];
    const stand = standAt(`${S3_IDS.mirror[key]}-stand`, p, m.center.x, m.center.z);
    root.updateMatrixWorld(true);
    const ix = new Interactable({ id: S3_IDS.mirror[key], kind: 'puzzle', object: m.root, puzzle: m.puzzle, interactPoint: stand, focus: W(m.center), reach: 0.3 });
    interaction.add(ix);
    mirrorIx[key] = ix;
  }

  // ---- 光斑落到下一个目标（上升沿）：镜子冷白亮一下 + 玻璃共鸣；步骤完成
  const traceReached = (): number => {
    if (!beam.sky.lit) return 0;
    const p = tracer.paths.find((q) => q.emitter === beam.sky);
    if (!p) return 0;
    // 反射过的镜子（末端打在背面 / 超限的那面不算命中）
    const ms = p.end === 'mirrorBack' || p.end === 'limit' ? p.mirrors.slice(0, -1) : p.mirrors;
    if (ms[0] !== beam.mirrors.window.mirror.id || ms[1] !== beam.mirrors.a.mirror.id) return 0;
    if (ms[2] !== beam.mirrors.b.mirror.id) return 1;
    return p.receiver === beam.igniter ? 3 : 2;
  };
  let skyWasLit = false;
  const flash = (key: S3MirrorKey | null): void => {
    state.flashes++;
    if (key) flashT[key] = 0.6;
    sfx('sfx-glass-resonance');
  };
  const stepOf = ['window_mirror', 'mid_a', 'mid_b'] as const;

  // ======================================================== 灯室：点火拉杆（白盒：枢轴 = ignite-lever-socket，杆长 0.3）、纸条、透镜
  // 拉杆节点坐标系 = 汐站在 -interact 面向拉杆时的局部系（+Z 朝 −X、+X 朝 S3 +Z），017 对位数据按这个系给：绕 +X 转 −60°
  const L = S3.igniteLever;
  const standYaw = Math.atan2(L.facing[0], L.facing[2]);
  const lever = new THREE.Group();
  lever.name = S3_IDS.lever;
  lever.position.copy(v3(L.pivot));
  lever.rotation.y = standYaw;
  root.add(lever);
  const leverSwing = new THREE.Group();
  leverSwing.name = `${S3_IDS.lever}-swing`;
  lever.add(leverSwing);
  const grip = v3(L.gripRest).sub(v3(L.pivot)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -standYaw);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L.len, 8), metal);
  arm.name = `${S3_IDS.lever}-arm`;
  arm.position.copy(grip.clone().multiplyScalar(0.5));
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), grip.clone().normalize());
  leverSwing.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), metal);
  knob.name = `${S3_IDS.lever}-grip`;
  knob.position.copy(grip);
  leverSwing.add(knob);
  const leverBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.12), metal);
  leverBase.name = `${S3_IDS.lever}-base`;
  lever.add(leverBase);
  const stand = new THREE.Object3D();
  stand.name = `${S3_IDS.lever}-interact`;
  stand.position.copy(v3(L.interact));
  stand.rotation.y = standYaw;
  root.add(stand);
  root.updateMatrixWorld(true);
  // 004 通用判定：焦点 = 握把（1.8 m、±60°）；approach:false —— 按 E 那一刻就判定，走位由点灯演出自己做（锁输入后）
  const leverIx = new Interactable({
    id: S3_IDS.lever,
    kind: 'use',
    prompt: 'ui.prompt.ignite',
    object: lever,
    interactPoint: stand,
    focus: W(L.gripRest),
    approach: false,
    priority: 20,
    // 点灯是关卡脚本的演出（锁输入 → 走位 → 拉杆），交互系统不自动播；clip 优先读美术节点 ignite-lever-interact 的 anim
    anim: nodeAnim(d.artRoot, 'ignite-lever-interact', 'xi-ignite-lever'),
    autoAnim: false,
  });
  leverIx.enabled = false;
  interaction.add(leverIx);
  const igniter = beam.igniter;
  const canIgnite = (): boolean => state.valveOpen && igniter.ready && !state.igniting && !state.ignited;
  const hum = new IgniterHum(events, igniter, () => state.igniting);

  // ---- 点灯演出：锁输入（cutscene 上下文）→ 走到 -interact（017 walk 1.6 m/s）→ xi-ignite-lever（第 34 帧点燃）
  let actions: XiActionPlayer | null = null;
  let popInput: (() => void) | null = null;
  let walk: { from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; t: number; dur: number } | null = null;
  const angleDiff = (a: number, b: number): number => {
    let x = (b - a) % (Math.PI * 2);
    if (x > Math.PI) x -= Math.PI * 2;
    if (x < -Math.PI) x += Math.PI * 2;
    return x;
  };
  const setLeverAngle = (deg: number): void => {
    leverSwing.rotation.x = XI_IGNITE_LEVER_ALIGN.pullSign * deg * (Math.PI / 180);
  };
  // 结尾演出时间轴（点燃 = 0:00）：独白走字幕时间轴（锁定、顶掉其他独白），到 0:04 结束时间轴
  let outroT = -1;
  const subs = game.ui.subtitles.track;
  const startOutro = (): void => {
    outroT = 0;
    if (game.narrative.hasSeen('ch1.s3.ignite.mono')) return;
    subs.setTimeline([{ at: IGNITE_MONO_DELAY, id: 'ch1.s3.ignite.mono', duration: IGNITE_MONO_SEC }]);
    subs.playAt(0);
  };
  const stepOutro = (dt: number): void => {
    if (outroT < 0 || outroT > OUTRO_CUT_SEC) return;
    outroT += dt;
    if (!subs.inTimeline) return;
    if (outroT >= OUTRO_CUT_SEC) subs.endTimeline();
    else subs.playAt(outroT);
  };
  const igniteNow = (): void => {
    if (state.ignited) return;
    state.ignited = true;
    startOutro();
    state.igniting = true;
    leverIx.enabled = false;
    setLeverAngle(XI_IGNITE_LEVER_ALIGN.pullDeg);
    // 点火口切暖（manual 接收器锁存）；不是 ready（smoke 直接调）时强制锁存
    if (!igniter.activate()) {
      igniter.state = 'activated';
      igniter.progress = 1;
    }
    events.emit('beam:setColor', { id: beam.sky.id, color: 'warm' });
    events.emit('beam:setColor', { id: beam.preview.id, color: 'warm' });
    sfx('sfx-ignite');
    hints.solve('p5');
    lamp.setOn(true);
    events.emit('lighthouse:ignited');
    d.onIgnite();
  };
  const startIgnite = (): boolean => {
    if (!canIgnite()) return false;
    const rig = d.rig();
    state.igniting = true;
    leverIx.enabled = false;
    // 从这一刻起光路不再影响结果
    if (!rig) {
      igniteNow();
      return true;
    }
    popInput = game.input.pushContext('cutscene');
    rig.controller.halt();
    rig.controller.locked = true;
    const sp = leverIx.standPoint(new THREE.Vector3());
    const from = rig.body.body.position.clone();
    const to = new THREE.Vector3(sp.position.x, from.y, sp.position.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const turn = Math.abs(angleDiff(rig.controller.facing, sp.facing));
    const dur = dist < 0.02 && turn < 0.05 ? 0 : Math.min(1.5, Math.max(0.2, dist / gameplay.player.walkSpeed, (turn / Math.PI) * 0.6));
    walk = { from, to, fromYaw: rig.controller.facing, toYaw: sp.facing, t: 0, dur };
    return true;
  };
  const playLever = (rig: PlayerRig): void => {
    actions ??= new XiActions(rig.controller, rig.animator);
    void actions.play(leverIx.resolveAnim() ?? 'xi-ignite-lever', { onTick: (t) => setLeverAngle(igniteLeverAngleAt(t)), onMarker: igniteNow }).then(() => {
      rig.controller.locked = true;
    });
  };
  const stepWalk = (rig: PlayerRig, dt: number): void => {
    const w = walk;
    if (!w) return;
    w.t += dt;
    const u = w.dur <= 0 ? 1 : Math.min(1, w.t / w.dur);
    const k = u * u * (3 - 2 * u);
    const body = rig.body.body;
    body.velocity.x = body.velocity.z = 0;
    body.position.x = w.from.x + (w.to.x - w.from.x) * k;
    body.position.z = w.from.z + (w.to.z - w.from.z) * k;
    rig.controller.facing = w.fromYaw + angleDiff(w.fromYaw, w.toYaw) * k;
    if (u < 1) return;
    rig.controller.facing = w.toYaw;
    walk = null;
    playLever(rig);
  };
  offs.push(
    () => popInput?.(),
    events.on('receiver:ready', ({ id }) => {
      if (id !== igniter.id || state.igniting) return;
      state.readyCount++;
    }),
    // 可点灯嗡鸣：进入可点灯淡入循环，退出（断光超过 0.3 s 宽限）/ 点燃后淡出（igniterHum.ts）
    hum.bind(),
    () => hum.stop(0),
    events.on('ignition:reminder', ({ id }) => {
      if (id !== igniter.id || state.igniting) return;
      state.reminders++;
      sfx('sfx-ignite-ready-pulse');
    }),
    events.on('receiver:blocked', ({ id }) => {
      if (id !== igniter.id || time - state.noOilSaid < NO_OIL_INTERVAL) return;
      state.noOilSaid = time;
      sfx('sfx-ignite-fail');
      say('ch1.s3.ignition.no_oil');
    }),
    // E：以按下那一刻为准（InteractionSystem 在按下的那一步发 interact:used，approach:false 不先走位）
    events.on('interact:used', ({ id }) => {
      if (id === S3_IDS.lever) startIgnite();
    }),
  );
  const note = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.22), paper);
  note.name = S3_IDS.note;
  note.position.set(S3.points.noteRead[0], S3.points.noteRead[1] + 0.005, S3.points.noteRead[2]);
  root.add(note);
  interaction.add(new Interactable({ id: S3_IDS.note, kind: 'read', object: note, textId: 'ch1.s3.ignition_note.doc', focus: W(S3.points.noteRead) }));
  const lensAnchor = new THREE.Object3D();
  lensAnchor.name = S3_IDS.lens;
  lensAnchor.position.set(...S3.points.lensSocket);
  root.add(lensAnchor);
  // BUG-015：透镜焦点（灯室中心 y 22.85）从拉杆站位看和握把几乎同方向，按离屏幕中心选会抢走「E 点灯」。
  // 可点灯期间（含 0.3 s 宽限，= 拉杆开放）透镜不当候选，见 fixedUpdate；其余时候照常可查看。
  const lensIx = new Interactable({ id: S3_IDS.lens, kind: 'inspect', object: lensAnchor, textId: 'ch1.s3.lens.inspect', focus: W(S3.points.lensSocket), reach: 0.6 });
  interaction.add(lensIx);

  // ======================================================== 提示（整座灯塔 + 门外平台；按步骤）
  hints.add({
    id: 'p5',
    zone: (p) => {
      const l = toLocal(p, tmpL);
      if (Math.hypot(l.x, l.z) < S3.tower.rBase + 0.3) return true;
      const s = -(l.x + l.z) / Math.SQRT2;
      const t = (l.x - l.z) / Math.SQRT2;
      return s >= S3.doorPlatform.s[0] && s <= S3.doorPlatform.s[1] + 1 && Math.abs(t) <= S3.doorPlatform.t[1] + 0.3;
    },
    l1: 'ch1.hint.p5.l1',
    stepTimed: true,
    // 步骤 5「点灯」：可点灯状态下按 H 只显示这一条（不高亮、不走二三级计时）；退出可点灯回到步骤 4
    override: () => (canIgnite() ? 'ch1.hint.p5.ignite.l3' : null),
    steps: [
      { id: 'valve', l2: 'ch1.hint.p5.valve.l2', l3: 'ch1.hint.p5.valve.l3', highlight: () => (tide.state === 'high' ? [S3_IDS.bell, S3_IDS.valve] : [S3_IDS.valve]) },
      { id: 'window_mirror', l2: 'ch1.hint.p5.window_mirror.l2', l3: 'ch1.hint.p5.window_mirror.l3', highlight: [S3_IDS.mirror.window] },
      { id: 'mid_a', l2: 'ch1.hint.p5.mid_a.l2', l3: 'ch1.hint.p5.mid_a.l3', highlight: [S3_IDS.mirror.a] },
      { id: 'mid_b', l2: 'ch1.hint.p5.mid_b.l2', l3: 'ch1.hint.p5.mid_b.l3', highlight: [S3_IDS.mirror.b] },
    ],
  });

  // ======================================================== 每步
  const player = new THREE.Vector3();
  const local = new THREE.Vector3();
  const api: S3Puzzles = {
    beam,
    renderer,
    lamp,
    tide,
    bell,
    lever,
    leverSwing,
    leverKnob: knob,
    leverIx,
    lensIx,
    canIgnite,
    hum,
    startIgnite,
    igniteNow,
    doorIx,
    valveIx,
    mirrorIx,
    state,
    traceReached,
    get outroTime(): number {
      return outroT;
    },
    fixedUpdate(dt: number): void {
      time += dt;
      stepOutro(dt);
      for (let i = timers.length - 1; i >= 0; i--) {
        const tm = timers[i]!;
        if (time >= tm.at) {
          timers.splice(i, 1);
          tm.fn();
        }
      }
      tracer.fixedUpdate(dt);
      const rig = d.rig();
      // 点灯演出（走位 → 动作）；「E 点灯」只在可点灯状态开放
      if (rig && walk) stepWalk(rig, dt);
      actions?.fixedUpdate(dt);
      leverIx.enabled = canIgnite();
      // BUG-015：可点灯时「E 点灯」优先——透镜 inspect 让位（和拉杆开放同一步切换）
      lensIx.enabled = !leverIx.enabled;
      // 光路进度（上升沿反馈；天光刚亮起那一步不算，避免 40 s 周期里每次亮起都响）
      const reached = traceReached();
      const skyLit = beam.sky.lit;
      if (skyLit && skyWasLit && reached > state.reached) {
        for (let k = state.reached + 1; k <= reached; k++) flash(k === 1 ? 'a' : k === 2 ? 'b' : null);
      }
      for (let k = 1; k <= reached; k++) hints.completeStep('p5', stepOf[k - 1]!);
      state.reached = reached;
      skyWasLit = skyLit;
      for (const key of ['window', 'a', 'b'] as const) {
        flashT[key] = Math.max(0, flashT[key] - dt);
        const mat = flashMat[key];
        if (mat) mat.emissiveIntensity = 1.2 * (flashT[key] / 0.6) ** 2;
      }
      // 门
      if (doorT >= 0 && doorT < S3_DOOR_SEC) {
        doorT = Math.min(S3_DOOR_SEC, doorT + dt);
        state.doorOpen = smooth(doorT / S3_DOOR_SEC);
        d.greybox.door.rotation.y = D.hingeRotY + D.openDeg * (Math.PI / 180) * state.doorOpen;
      }
      // 阀轮
      // 1030c：开阀绕手轮本地 +Z（朝塔心）转 +90°，与美术 valve-wheel openDeg 90 同向同角（美术 delta 驱动跟着转）
      wheel.rotation.z = wheelSpin * (Math.PI / 2);
      if (!rig) return;
      player.copy(rig.body.position);
      toLocal(player, local);
      const r = Math.hypot(local.x, local.z);
      // 镜子：只在各自站立面上开放（楼梯从上下经过时不出提示）
      for (const key of ['window', 'a', 'b'] as const) mirrorIx[key].enabled = Math.abs(local.y - MIRROR_FLOOR[key]) < 0.6;
      valveIx.enabled = !state.valveOpen && local.y < 1.2;
      // 独白
      const s = -(local.x + local.z) / Math.SQRT2;
      if (r > S3.tower.rBase && s > 17 && s < 24) once('ch1.s3.bridge.mono_arrive');
      if (r > S3.tower.rBase + 0.5 && beam.preview.lit && state.said.has('ch1.s3.bridge.mono_arrive') && s < 14) once('ch1.s3.sky_light.mono');
      if (Math.hypot(local.x - S3.points.doorLanding[0], local.z - S3.points.doorLanding[2]) < 0.9 && Math.abs(local.y - S3.door.y0) < 0.5) {
        if (!state.said.has('goal.base')) {
          state.said.add('goal.base');
          if (!state.valveOpen) setGoal('ch1.s3.goal.base');
        }
        if (tide.state === 'high' && !tide.transitioning) once('ch1.s3.base.mono_flooded');
      }
      if (r < S3.tower.rIn && local.y < 1.2 && d.cameraFollow.pitch > 0.6) once('ch1.s3.stairwell.mono_look_up');
    },
    update(dt: number): void {
      renderer.update(dt, tracer);
      lamp.update(dt);
      hum.update();
    },
    dispose(): void {
      for (const off of offs) off();
      renderer.dispose();
      scene.remove(renderer.root);
    },
  };
  return api;
}
