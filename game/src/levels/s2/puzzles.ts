import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { t, type TextId } from '@/content/text';
import type { PlayerRig } from '@/entities/createPlayer';
import { XiActions, type XiActionPlayer } from '@/entities/xiActions';
import { nodeAnim, XI_KEY_BONE, XI_SOCKET_STAND, xiClipDuration, xiInteractEventSec } from '@/entities/xi/clips';
import { ViewpointTarget } from '@/entities/components/ViewpointTarget';
import type { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { boxZone, type HintSystem, type HintZone } from '@/systems/HintSystem';
import type { Collider, PhysicsSystem } from '@/systems/PhysicsSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { PuzzleGroup } from '@/systems/interaction/PuzzleMode';
import { RotatablePart, wrap360 } from '@/systems/interaction/RotatablePart';
import { WhiteboxBeamRenderer } from '@/systems/light/BeamRenderer';
import { S2, v3 } from './layout';
import { buildS2Beam, type S2Beam } from './beam';
import type { S2Greybox } from './greybox';
import { sevenSegment } from './digits';

/**
 * S2 谜题 3「借光开锁」+ 地窖 + 谜题 4「窗中的数字」+ 文本挂点（v0.1-014 part2，白盒）。
 *
 * 流程（GDD §6、任务单 014、text-ch1 §3）：
 *  进院独白 → 二层书桌读父亲日志（第一次：汐先把风灯放到书桌 socket，xi-place-table 占位动作；此后东侧二层小窗透暖光）
 *  → 关闭日志 0.5 s 后独白、目标 → cellar → E 拿起风灯 → 放东灯台（西灯台被晾衣架挡，5 s 后独白一次）
 *  → 转镜 A、B（机位 mirror-stands-s2-cam，R 重置）→ 光感锁受光 1.5 s → 地窖门转开（门缝透光）→ 独白「门开了。」
 *  → 地窖拿钥匙（toast + 0.5 s 后木牌）、读草图 → 目标 → gate → 二层西窗观察点按住右键对准白石（≤ 6° 风铃 + 「三，一，七。」）
 *  → 拨盘铁门输入 317 自动开门 → 崖径 → 出口去 S3。
 * 暖光只来自风灯（风灯自带一盏小 PointLight + 窗口暖光贴片），环境不发暖光。
 */

export const S2_IDS = {
  lantern: 'lantern',
  deskSocket: 'desk-lantern-s2-socket',
  journal: 'journal-s2',
  mirrorPuzzle: 'mirror-stands-s2',
  dialGate: 'dial-gate-s2',
  key: 'cellar-key-s2',
  lock: 'light-lock-s2',
} as const;

/** 拨盘角度 → 数字（36° 一档；拨盘正转 = 数字 +1） */
export function dialDigit(angleDeg: number): number {
  return Math.round(wrap360(angleDeg) / 36) % 10;
}

export interface S2PuzzleDeps {
  game: Game;
  scene: THREE.Scene;
  physics: PhysicsSystem;
  interaction: InteractionSystem;
  hints: HintSystem;
  rig: PlayerRig;
  cameraFollow: CameraFollowSystem;
  camera: THREE.Camera;
  greybox: S2Greybox;
  collider: (m: THREE.Mesh) => Collider | undefined;
  /** 美术根节点（拿走钥匙时隐藏 GLB 里同名的钥匙占位） */
  artRoot: THREE.Object3D;
  beamDebug: boolean;
}

export interface S2Puzzles {
  beam: S2Beam;
  renderer: WhiteboxBeamRenderer;
  lantern: THREE.Group;
  lanternLight: THREE.PointLight;
  windowGlow: THREE.Mesh;
  dials: RotatablePart[];
  dialPuzzle: PuzzleGroup;
  viewpoint: ViewpointTarget;
  digits: THREE.Group;
  actions: XiActionPlayer;
  readonly state: {
    journalRead: boolean;
    lanternOnDesk: boolean;
    lockOpen: boolean;
    doorOpen: number;
    hasKey: boolean;
    digitsSeen: boolean;
    gateOpen: boolean;
    westBlockedSaid: boolean;
  };
  /** 观察点：站在上面时替代 E 提示 */
  viewpointPrompt(): string | null;
  /** 白盒小道具（杯子、日志、纸条、抽屉、海图、观察点地板）：美术 019 只给了 socket 没有这些模型，始终显示 */
  props: THREE.Object3D[];
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  dispose(): void;
}

type Timer = { at: number; fn: () => void };

export function buildS2Puzzles(d: S2PuzzleDeps): S2Puzzles {
  const { game, scene, interaction, hints, rig, greybox } = d;
  const events = game.events;
  const root = new THREE.Group();
  root.name = 's2-puzzles';
  scene.add(root);
  const offs: Array<() => void> = [];
  const props: THREE.Object3D[] = [];
  const say = (id: TextId): void => void game.ui.subtitles.play([id]);
  const setGoal = (id: TextId): void => game.narrative.setGoal(id);
  let time = 0;
  const timers: Timer[] = [];
  const after = (sec: number, fn: () => void): void => void timers.push({ at: time + sec, fn });

  const wood = new THREE.MeshStandardMaterial({ name: 'gb-wood', color: 0x5e5246, roughness: 0.85 });
  const paper = new THREE.MeshStandardMaterial({ name: 'gb-paper', color: 0xd8d2c2, roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ name: 'gb-metal', color: 0x5f6b70, metalness: 0.6, roughness: 0.45 });
  const stone = new THREE.MeshStandardMaterial({ name: 'gb-stone', color: 0x6f7477, roughness: 0.92 });
  const box = (name: string, w: number, h: number, dd: number, mat: THREE.Material, p: readonly [number, number, number], parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat);
    m.name = name;
    m.position.set(p[0], p[1], p[2]);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const prop = <T extends THREE.Object3D>(o: T): T => {
    props.push(o);
    return o;
  };
  /** 站位节点：+Z 朝向物体（Interactable.standPoint 约定），yaw = 世界朝向角 */
  const standAt = (name: string, x: number, y: number, z: number, faceX: number, faceZ: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = `${name}-interact`;
    o.position.set(x, y, z);
    o.rotation.y = Math.atan2(faceX - x, faceZ - z);
    root.add(o);
    return o;
  };
  const inspect = (id: string, object: THREE.Object3D, textId: TextId, focus?: THREE.Vector3, reach = 0): Interactable => {
    const it = new Interactable({ id, kind: 'inspect', object, textId, ...(focus ? { focus } : {}), reach });
    interaction.add(it);
    return it;
  };
  const read = (id: string, object: THREE.Object3D, textId: TextId, focus?: THREE.Vector3): Interactable => {
    const it = new Interactable({ id, kind: 'read', object, textId, ...(focus ? { focus } : {}) });
    interaction.add(it);
    return it;
  };
  const byName = (n: string): THREE.Object3D => {
    const o = greybox.root.getObjectByName(n);
    if (!o) throw new Error(`[s2] 白盒缺节点 ${n}`);
    return o;
  };

  const state = {
    journalRead: false,
    lanternOnDesk: false,
    lockOpen: false,
    doorOpen: 0,
    hasKey: false,
    digitsSeen: false,
    gateOpen: false,
    westBlockedSaid: false,
  };

  // ======================================================== 风灯（汐带着进 S2）
  const warmMat = new THREE.MeshStandardMaterial({ name: 'lantern-glass-warm', color: 0xffd38a, emissive: 0xffa040, emissiveIntensity: 1.4 });
  const lantern = new THREE.Group();
  lantern.name = 's2-lantern';
  lantern.userData.warmLight = true;
  box('s2-lantern-base', 0.16, 0.03, 0.16, metal, [0, 0.015, 0], lantern);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.2, 12), warmMat);
  glass.name = 's2-lantern-glass';
  glass.position.y = 0.13;
  lantern.add(glass);
  box('s2-lantern-cap', 0.14, 0.04, 0.14, metal, [0, 0.25, 0], lantern);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI), metal);
  handle.name = 's2-lantern-handle';
  handle.position.y = 0.27;
  lantern.add(handle);
  const lanternLight = new THREE.PointLight(0xffb060, 1.8, 7, 2);
  lanternLight.name = 's2-lantern-light';
  lanternLight.position.y = 0.15;
  lantern.add(lanternLight);
  const held = interaction.held;
  held.pickUp(S2_IDS.lantern, lantern);
  // 017：风灯在书桌上 → xi-pickup-table（站 0.45 m），在灯台上 → xi-pickup（站 0.65 m）；deskSocket 在下面创建
  const onDesk = (): boolean => lantern.parent?.name === S2_IDS.deskSocket;
  const pickLantern = new Interactable({
    id: 'lantern-s2',
    kind: 'pickup',
    object: lantern,
    item: S2_IDS.lantern,
    anim: () => (onDesk() ? 'xi-pickup-table' : 'xi-pickup'),
    animStand: () => (onDesk() ? XI_SOCKET_STAND.table : XI_SOCKET_STAND.stand),
  });
  interaction.add(pickLantern);

  // ======================================================== 二层书桌：日志、纸条、抽屉信纸、海图、风灯 socket
  const [jx, jy, jz] = S2.points.journalSocket;
  const [dsx, dsy, dsz] = S2.points.deskInteract;
  const deskStand = standAt('desk-s2', dsx, dsy, dsz, dsx - 1, dsz);
  // 书桌风灯 socket = 美术 019 lanternSocket (−5.05, 3.75, −0.35)（制作人 1029：z 用美术值；相对站位是正前 0.45、偏右 10 cm，
  // 017 xi-place-table 按 5 cm 调，差 5 cm 手上看不出——README-s2-layout）
  const [lsx, lsy, lsz] = S2.points.lanternSocket;
  const deskSocket = new THREE.Object3D();
  deskSocket.name = S2_IDS.deskSocket;
  deskSocket.position.set(lsx, lsy, lsz);
  root.add(deskSocket);
  const journal = prop(box('journal-s2', 0.22, 0.03, 0.3, wood, [jx, jy + 0.015, jz]));
  const journalIx = new Interactable({ id: S2_IDS.journal, kind: 'use', object: journal, prompt: 'ui.prompt.read', interactPoint: deskStand, focus: new THREE.Vector3(jx, jy + 0.05, jz) });
  interaction.add(journalIx);
  const note = prop(box('xi-note-s2', 0.15, 0.005, 0.1, paper, [-5.15, 3.755, -0.68]));
  note.rotation.y = 0.3;
  read('xi-note-s2', note, 'ch1.s2.xi_note.doc', new THREE.Vector3(-5.15, 3.78, -0.68));
  const drawer = prop(box('desk-drawer-s2', 0.04, 0.12, 0.4, wood, [S2.furniture.desk.x[1] + 0.02, 3.55, -0.5]));
  read('reply-draft-s2', drawer, 'ch1.s2.reply_draft.doc');
  const chart = prop(box('chart-s2', 0.02, 0.5, 0.7, paper, [S2.house.inner.x0 + 0.015, 4.35, -0.3]));
  inspect('chart-s2', chart, 'ch1.s2.chart.inspect');
  // 书桌放风灯（读过日志之后玩家也可以放回来）
  const deskPlace = new Interactable({ id: 'desk-lantern-s2', kind: 'place', object: deskSocket, socket: deskSocket, item: S2_IDS.lantern, focus: deskSocket.position.clone().setY(S2.furniture.desk.top + 0.15), anim: 'xi-place-table', animStand: XI_SOCKET_STAND.table });
  deskPlace.enabled = false;
  interaction.add(deskPlace);

  // 二层东侧小窗（朝院子）透出的暖光：只在风灯放在书桌上时亮
  const op = S2.openings['winE2']!;
  const glowMat = new THREE.MeshBasicMaterial({ name: 'window-glow-warm', color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(op.b - op.a, op.y1 - op.y0), glowMat);
  windowGlow.name = 's2-window-glow-warm';
  windowGlow.userData.warmLight = true;
  windowGlow.position.set(S2.house.x0 + S2.house.wall * 0.5, (op.y0 + op.y1) / 2, (op.a + op.b) / 2);
  windowGlow.rotation.y = -Math.PI / 2;
  windowGlow.visible = false;
  root.add(windowGlow);

  const actions: XiActionPlayer = new XiActions(rig.controller, rig.animator);
  offs.push(
    events.on('interact:used', ({ id }) => {
      if (id !== S2_IDS.journal) return;
      // 第一次读：汐先把风灯放到书桌上（短动作 xi-place-table，关键帧放下），再打开日志
      if (!state.journalRead && held.isHolding(S2_IDS.lantern) && held.socketFree(deskSocket)) {
        void actions.play('xi-place-table', { onMarker: () => held.place(deskSocket) }).then(() => game.ui.reader.open('ch1.s2.journal.doc'));
      } else game.ui.reader.open('ch1.s2.journal.doc');
    }),
    events.on('reader:close', ({ docId }) => {
      if (docId !== 'ch1.s2.journal.doc' || state.journalRead) return;
      state.journalRead = true;
      deskPlace.enabled = true;
      after(0.5, () => say('ch1.s2.journal.mono_after'));
      if (!state.lockOpen) setGoal('ch1.s2.goal.cellar');
    }),
  );

  // ======================================================== 一层 / 二层查看
  const tableTop = S2.furniture.table.h;
  const [cx, , cz] = S2.points.cups;
  const cupGeo = new THREE.CylinderGeometry(0.04, 0.035, 0.09, 10);
  const cups = new THREE.Group();
  cups.name = 'cups-s2';
  for (const [dx, flip] of [[-0.08, false], [0.08, true]] as const) {
    const c = new THREE.Mesh(cupGeo, paper);
    c.position.set(cx + dx, tableTop + 0.045, cz);
    if (flip) c.rotation.x = Math.PI;
    cups.add(c);
  }
  root.add(prop(cups));
  inspect('cups-s2', cups, 'ch1.s2.cups.inspect', new THREE.Vector3(cx, tableTop + 0.1, cz));
  const [sx, , sz] = S2.points.stove;
  inspect('stove-s2', byName('s2-chimney-collider'), 'ch1.s2.stove.inspect', new THREE.Vector3(sx + 0.2, 0.8, sz));
  inspect('bed-s2', byName('s2-bed-collider'), 'ch1.s2.bed.inspect', v3(S2.points.bed));
  // 西窗：不在观察点上时可查看；站上观察点后换成「按住右键 观察」
  const westWin = new THREE.Object3D();
  westWin.name = 'west-window-s2';
  westWin.position.set(...S2.points.westWindowInteract);
  root.add(westWin);
  const westWindowIx = inspect('west-window-s2', westWin, 'ch1.s2.window.inspect', v3(S2.points.westWindowInteract), 0.3);

  // 进院独白（只一次）
  const yardZone = boxZone({ x: S2.yard.x[0], y: -1, z: S2.yard.z[0] + 0.5 }, { x: S2.yard.x[1], y: 3, z: S2.yard.z[1] });
  let yardSaid = false;

  // ======================================================== 谜题 3：灯台、两面镜子、光感锁
  const beam = buildS2Beam(d.physics);
  root.add(beam.root);
  const tracer = beam.tracer;
  offs.push(tracer.bind(events));
  const renderer = new WhiteboxBeamRenderer({ debug: d.beamDebug });
  scene.add(renderer.root);
  for (const lamp of [beam.lamps.east, beam.lamps.west]) {
    const ix = new Interactable({ id: `lamp-stand-${lamp.key}-s2`, kind: 'place', object: lamp.stand, socket: lamp.socket, item: S2_IDS.lantern, focus: lamp.socket.position.clone().setY(0.8), anim: 'xi-place', animStand: XI_SOCKET_STAND.stand });
    interaction.add(ix);
  }
  for (const [k, m] of [['a', beam.mirrorA], ['b', beam.mirrorB]] as const) {
    const ix = new Interactable({ id: `mirror-stand-s2-${k}`, kind: 'puzzle', object: m.root, puzzle: beam.puzzle, focus: m.center.clone(), reach: 0.3 });
    interaction.add(ix);
  }
  const lockIx = inspect(S2_IDS.lock, beam.lockFrame, 'ch1.s2.light_lock.inspect', beam.lockLens.position.clone(), 0.3);

  // 地窖门：受光 1.5 s → 绕合页转开（1.4 s）+ 门缝透光（冷白，不是暖光）→ 独白
  const slitMat = new THREE.MeshBasicMaterial({ name: 'cellar-door-slit', color: 0xdfe8ee, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const cd = S2.cellarDoor;
  const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.05, cd.height * 0.96), slitMat);
  slit.name = 's2-cellar-door-slit';
  slit.position.set(cd.hinge[0] - cd.width, cd.height / 2, cd.hinge[2] + 0.06);
  slit.visible = false;
  root.add(slit);
  const DOOR_SEC = 1.4;
  let doorT = -1;
  offs.push(
    events.on('receiver:activated', ({ id }) => {
      if (id !== beam.lock.id || state.lockOpen) return;
      state.lockOpen = true;
      lockIx.enabled = false;
      hints.solve('p3');
      events.emit('sfx:play', { id: 'sfx-lock-open' });
      slit.visible = true;
      doorT = 0;
      const c = d.collider(greybox.cellarDoorLeaf);
      if (c) c.enabled = false;
    }),
  );
  hints.add({
    id: 'p3',
    zone: boxZone({ x: S2.yard.x[0], y: -1, z: S2.yard.z[0] }, { x: S2.house.x0 + 1.5, y: 3, z: S2.yard.z[1] + 3 }),
    l1: 'ch1.hint.p3.l1',
    l2: 'ch1.hint.p3.l2',
    l3: 'ch1.hint.p3.l3',
    highlight: ['mirror-stand-s2-a', 'mirror-stand-s2-b', S2_IDS.lock],
  });
  let westBlockedT = 0;

  // ======================================================== 地窖：钥匙、草图
  const [kx, ky, kz] = S2.points.cellarKey;
  const key = new THREE.Group();
  key.name = 'cellar-key-s2';
  box('cellar-key-s2-bow', 0.05, 0.01, 0.05, metal, [0, 0.005, 0], key);
  box('cellar-key-s2-shaft', 0.012, 0.01, 0.1, metal, [0, 0.005, 0.07], key);
  box('cellar-key-s2-tag', 0.05, 0.004, 0.07, wood, [0.05, 0.002, -0.03], key);
  key.position.set(kx, ky, kz);
  root.add(key);
  const [shx, , shz] = S2.points.cellarShelfInteract;
  const shelfStand = standAt('cellar-shelf-s2', shx, S2.cellar.floorY, shz, shx - 1, shz);
  // 017：clip 优先读美术节点 env-cellar-s2-shelf-interact 的 anim（xi-pickup-shelf，grab 第 22 帧 = interact:used）
  const keyIx = new Interactable({
    id: S2_IDS.key,
    kind: 'use',
    object: key,
    prompt: 'ui.prompt.pickup',
    approach: false,
    focus: new THREE.Vector3(kx, ky + 0.03, kz),
    interactPoint: shelfStand,
    anim: nodeAnim(d.artRoot, 'env-cellar-s2-shelf-interact', 'xi-pickup-shelf'),
  });
  interaction.add(keyIx);
  const [skx, sky, skz] = S2.points.cellarSketch;
  const sketch = box('sketch-s2', 0.21, 0.004, 0.3, paper, [skx, sky + 0.002, skz]);
  read('sketch-s2', sketch, 'ch1.s2.sketch.doc');
  offs.push(
    events.on('interact:used', ({ id }) => {
      if (id !== S2_IDS.key || state.hasKey) return;
      state.hasKey = true;
      keyIx.enabled = false;
      // 017：有汐的动画时 grab 帧把钥匙挂到中指末节 middle_03_r（按这一帧的相对偏移，extras.align.keyShelf），clip 播完再收起
      const bone = interaction.animState?.clip === 'xi-pickup-shelf' ? rig.visual.getObjectByName(XI_KEY_BONE) : undefined;
      const artKeys: THREE.Object3D[] = [];
      d.artRoot.traverse((o) => {
        if (/(^|[-_])key([-_.]|$)/i.test(o.name) && !/keeper/i.test(o.name) && !/socket/i.test(o.name) && o.visible) artKeys.push(o);
      });
      const shown = artKeys.find((o) => (o as THREE.Mesh).isMesh) ?? (key.visible ? key : null);
      for (const o of artKeys) if (o !== shown) o.visible = false;
      if (bone && shown) {
        bone.updateWorldMatrix(true, false);
        shown.updateWorldMatrix(true, false);
        bone.attach(shown);
        if (shown !== key) key.visible = false;
        // 握着钥匙垂手回待机：clip 播完收进背包
        after(xiClipDuration('xi-pickup-shelf') - xiInteractEventSec('xi-pickup-shelf'), () => (shown.visible = false));
      } else {
        key.visible = false;
        if (shown) shown.visible = false;
      }
      events.emit('sfx:play', { id: 'sfx-key-pickup' });
      game.ui.hud.toast(t('ch1.common.key_obtained'));
      after(0.5, () => say('ch1.s2.key.tag_inspect'));
      setGoal('ch1.s2.goal.gate');
    }),
  );

  // ======================================================== 谜题 4：观察点 + 白石数字 + 拨盘铁门
  const vp = S2.viewpoint;
  const floorY = vp.eye[1] - 1.35;
  const viewpoint = new ViewpointTarget({
    center: new THREE.Vector3(vp.eye[0], floorY, vp.eye[2]),
    radius: 0.45,
    target: v3(vp.lookAt),
    toleranceDeg: vp.toleranceDeg,
    fadeDeg: vp.fadeFromDeg,
    view: () => {
      d.camera.updateMatrixWorld();
      return { position: d.camera.getWorldPosition(new THREE.Vector3()), forward: d.camera.getWorldDirection(new THREE.Vector3()) };
    },
    player: () => rig.body.position,
  });
  // 观察点地板（磨亮的一块）
  const polished = prop(new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshStandardMaterial({ name: 'gb-floor-polished', color: 0x8c7c68, roughness: 0.35 })));
  polished.name = 'viewpoint-s2-floor';
  polished.rotation.x = -Math.PI / 2;
  polished.position.set(vp.eye[0], floorY + 0.005, vp.eye[2]);
  root.add(polished);
  /** 站在观察点上：水平在区域内且在二层（一层同一平面位置不算） */
  const onViewpoint = (): boolean => viewpoint.inRegion && Math.abs(rig.body.position.y - floorY) < 0.5;
  // 白石数字贴片（白盒：七段数字，按对准度淡入；021 交付透视拼合模型后去掉）。从观察点看，左到右 = 南到北
  const digitMat = new THREE.MeshBasicMaterial({ name: 'white-stones-digits', color: 0xf2f0ea, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const digits = new THREE.Group();
  digits.name = 'white-stones-s2-digits';
  digits.userData.puzzleCritical = true;
  S2.dialGate.code.forEach((n, i) => {
    const g = sevenSegment(n, 2.2, digitMat, 0.16);
    g.position.set((i - 1) * 1.9, 0, 0);
    digits.add(g);
  });
  const tgt = v3(vp.lookAt);
  digits.position.set(tgt.x, tgt.y + 1.1, tgt.z);
  digits.lookAt(v3(vp.eye));
  digits.visible = false;
  root.add(digits);
  // 白石查看：任意一块
  greybox.whiteStones.children.forEach((s, i) => inspect(`white-stone-s2-${i}`, s, 'ch1.s2.white_stones.inspect'));

  // 拨盘铁门：门扇（白盒 collider）南面装三个拨盘，PuzzleGroup 机位在门前
  const dg = S2.dialGate;
  const dials: RotatablePart[] = [];
  const dialMat = new THREE.MeshStandardMaterial({ name: 'gb-dial', color: 0x4c5458, metalness: 0.5, roughness: 0.5 });
  const glyphMat = new THREE.MeshBasicMaterial({ name: 'gb-dial-glyph', color: 0xe8e4da });
  const dialPanel = box('dial-gate-s2-panel', 1.4, 0.5, 0.04, stone, [-dg.width / 2, dg.dialY, -0.07], greybox.dialGate);
  dialPanel.castShadow = false;
  dg.dialX.forEach((x, i) => {
    const dial = new THREE.Group();
    dial.name = `dial-gate-s2-dial-${i + 1}`;
    // 门扇局部：合页在原点、门扇沿 −X；拨盘面朝南（局部 −Z）⇒ 绕 Y 转 180° 让拨盘局部 +Z 朝南
    dial.position.set(x - dg.hinge[0], dg.dialY, -0.1);
    dial.rotation.y = Math.PI;
    greybox.dialGate.add(dial);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 24), dialMat);
    disc.rotation.x = Math.PI / 2;
    disc.name = `${dial.name}-disc`;
    dial.add(disc);
    for (let k = 0; k < 10; k++) {
      // 数字 k 在拨盘上的位置角 ψ = −36k（拨盘转 +36k 后到正上方指针处）
      const psi = THREE.MathUtils.degToRad(-36 * k);
      const g = sevenSegment(k, 0.055, glyphMat, 0.18);
      g.position.set(-Math.sin(psi) * 0.12, Math.cos(psi) * 0.12, 0.03);
      g.rotation.z = psi;
      dial.add(g);
    }
    const part = new RotatablePart({ id: `dial-gate-s2-${i + 1}`, node: dial, axes: [{ axis: 'z', initial: 0 }], stepDeg: 36, fineStepDeg: 36 });
    dials.push(part);
    // 指针（固定在门扇上，拨盘正上方）
    const ptr = box(`dial-gate-s2-pointer-${i + 1}`, 0.03, 0.05, 0.02, glyphMat, [x - dg.hinge[0], dg.dialY + 0.2, -0.12], greybox.dialGate);
    ptr.castShadow = false;
  });
  const gateCam = new THREE.Object3D();
  gateCam.name = 'dial-gate-s2-cam';
  const gateMidX = (dg.dialX[0]! + dg.dialX[2]!) / 2;
  gateCam.position.set(gateMidX, dg.dialY + 0.25, dg.hinge[2] - 1.15);
  gateCam.lookAt(gateMidX, dg.dialY, dg.hinge[2]);
  gateCam.rotateY(Math.PI);
  root.add(gateCam);
  const dialPuzzle = new PuzzleGroup({ id: S2_IDS.dialGate, camNode: gateCam, parts: dials });
  const gateStand = standAt('dial-gate-s2', gateMidX, 0, dg.hinge[2] - 0.9, gateMidX, dg.hinge[2]);
  const gateIx = new Interactable({ id: S2_IDS.dialGate, kind: 'puzzle', object: greybox.dialGateLeaf, puzzle: dialPuzzle, focus: new THREE.Vector3(gateMidX, dg.dialY, dg.hinge[2] - 0.1), interactPoint: gateStand, reach: 0.5 });
  interaction.add(gateIx);
  let gateInspectSaid = false;
  let gateT = -1;
  const GATE_SEC = 1.6;
  const code = (): number[] => dials.map((p) => dialDigit(p.angles[0] ?? 0));
  offs.push(
    events.on('puzzle:enter', ({ group }) => {
      if (group !== S2_IDS.dialGate || gateInspectSaid) return;
      gateInspectSaid = true;
      say('ch1.s2.dial_gate.inspect');
    }),
    events.on('puzzle:partRotated', ({ group }) => {
      if (group !== S2_IDS.dialGate || state.gateOpen) return;
      if (code().join('') !== dg.code.join('')) return;
      // 317：自动开门（错的组合什么都不发生）
      state.gateOpen = true;
      gateIx.enabled = false;
      after(0.35, () => {
        interaction.cancel();
        events.emit('sfx:play', { id: 'sfx-gate-open' });
        gateT = 0;
        const c = d.collider(greybox.dialGateLeaf);
        if (c) c.enabled = false;
        hints.solve('p4');
      });
    }),
  );
  const upstairsWest: HintZone = boxZone({ x: -0.6, y: S2.house.upperFloorY - 0.5, z: S2.house.inner.z0 }, { x: S2.house.inner.x1, y: S2.house.upperFloorY + 3, z: S2.house.inner.z1 });
  const outsideWest: HintZone = boxZone({ x: S2.house.x1, y: -4, z: S2.platform.z[0] }, { x: S2.slope.x[1], y: 3, z: S2.northWall.z[1] + 1 });
  hints.add({
    id: 'p4',
    zone: (p) => state.hasKey && (upstairsWest(p) || outsideWest(p)),
    l1: 'ch1.hint.p4.l1',
    l2: 'ch1.hint.p4.l2',
    l3: 'ch1.hint.p4.l3',
    highlight: ['west-window-s2'],
  });

  root.updateMatrixWorld(true);

  const smooth = (u: number): number => u * u * (3 - 2 * u);
  const api: S2Puzzles = {
    beam,
    renderer,
    lantern,
    lanternLight,
    windowGlow,
    dials,
    dialPuzzle,
    viewpoint,
    digits,
    actions,
    state,
    props,
    viewpointPrompt: () => (onViewpoint() ? t('ch1.s2.viewpoint.prompt') : null),
    fixedUpdate(dt: number): void {
      time += dt;
      for (let i = timers.length - 1; i >= 0; i--) {
        const tm = timers[i]!;
        if (time >= tm.at) {
          timers.splice(i, 1);
          tm.fn();
        }
      }
      actions.fixedUpdate(dt);
      tracer.fixedUpdate(dt);
      const p = rig.body.position;
      if (!yardSaid && yardZone(p)) {
        yardSaid = true;
        say('ch1.s2.yard.mono_arrive');
      }
      // 西灯台被晾衣架挡住 5 s：独白一次
      const west = tracer.paths.find((q) => q.emitter === beam.lamps.west.emitter);
      if (!state.westBlockedSaid && beam.lamps.west.emitter.lit && west?.end === 'blocker') {
        westBlockedT += dt;
        if (westBlockedT >= 5) {
          state.westBlockedSaid = true;
          say('ch1.s2.lantern_stand_west.blocked');
        }
      } else westBlockedT = 0;
      // 地窖门
      if (doorT >= 0 && doorT < DOOR_SEC) {
        doorT = Math.min(DOOR_SEC, doorT + dt);
        const u = smooth(doorT / DOOR_SEC);
        greybox.cellarDoor.rotation.y = cd.openAngle * u;
        state.doorOpen = u;
        slitMat.opacity = 0.85 * Math.sin(Math.PI * Math.min(1, doorT / DOOR_SEC));
        if (doorT >= DOOR_SEC) {
          slit.visible = false;
          after(0.3, () => say('ch1.s2.cellar.mono_open'));
        }
      }
      // 拨盘铁门
      if (gateT >= 0 && gateT < GATE_SEC) {
        gateT = Math.min(GATE_SEC, gateT + dt);
        greybox.dialGate.rotation.y = dg.openAngle * smooth(gateT / GATE_SEC);
      }
    },
    update(dt: number): void {
      renderer.update(dt, tracer);
      // 风灯在书桌上：二层东窗透暖光
      state.lanternOnDesk = held.sockets.get(deskSocket.name) === S2_IDS.lantern;
      const glowTarget = state.lanternOnDesk ? 0.8 : 0;
      glowMat.opacity += (glowTarget - glowMat.opacity) * (1 - Math.exp(-6 * dt));
      windowGlow.visible = glowMat.opacity > 0.01;
      // 观察点：按住右键（observe）时才算对准；对准度 → 数字淡入；≤ 6° 风铃 + 独白（只一次）
      viewpoint.evaluate();
      const on = onViewpoint();
      westWindowIx.enabled = !on;
      const a = on && d.cameraFollow.observing ? viewpoint.alignment : 0;
      digitMat.opacity = a;
      digits.visible = a > 0.01;
      if (a >= 1 && !state.digitsSeen) {
        state.digitsSeen = true;
        events.emit('sfx:play', { id: 'sfx-wind-chime' });
        after(0.8, () => say('ch1.s2.white_stones.mono_digits'));
      }
    },
    dispose(): void {
      for (const f of offs) f();
      actions.cancel();
      renderer.dispose();
    },
  };
  // ViewpointTarget 不挂实体，由 update 驱动求值
  return api;
}
