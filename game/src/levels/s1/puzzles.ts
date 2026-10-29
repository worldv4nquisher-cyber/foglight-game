import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { Collider, PhysicsSystem } from '@/systems/PhysicsSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import type { HintSystem } from '@/systems/HintSystem';
import { boxZone, circleZone } from '@/systems/HintSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { TideController } from '@/systems/tide/TideController';
import { TideBell } from '@/systems/tide/TideBell';
import { Floatable } from '@/systems/tide/Floatable';
import { TraversalLink } from '@/entities/components/TraversalLink';
import { Entity } from '@/entities/Entity';
import type { EntityManager } from '@/entities/EntityManager';
import type { TextId } from '@/content/text';
import { S1, pierPoint, v3 } from './layout';

/** 谜题 / 提示 / 交互 id（提示系统二级高亮、smoke 都按这些找） */
export const S1_IDS = {
  tide: 's1-tide',
  bell: 'tide-bell-s1',
  raft: 'raft-s1',
  stoneSlot: 'stone-slot-s1',
  p1: 's1-p1-reef',
  p2: 's1-p2-raft',
} as const;

/** 潮汐钟「风吹轻响」的距离与间隔（占位音效 sfx-bell-wind） */
const BELL_HEAR_DISTANCE = 12;
const BELL_WIND_INTERVAL = 7;

export interface S1PuzzleOptions {
  game: Game;
  root: THREE.Object3D;
  physics: PhysicsSystem;
  interaction: InteractionSystem;
  hints: HintSystem;
  entities: EntityManager;
  /** 白盒碰撞体 / 空气墙（userData.walkableWhen / deepFloorY 自动绑定到潮汐） */
  tideColliders: Collider[];
  wood: THREE.Material;
  metal: THREE.Material;
  addLink(link: TraversalLink): void;
}

/** 「R 放回浮台」提示：汐与浮台中心的水平距离上限（m，同交互图标距离） */
export const RESET_RAFT_PROMPT_DISTANCE = 3.5;

export interface S1Puzzles {
  tide: TideController;
  bell: TideBell;
  raft: Floatable;
  raftPush: Interactable;
  links: TraversalLink[];
  readonly p1Solved: boolean;
  readonly p2Solved: boolean;
  /** 退潮且浮台搁浅时 R：浮台回原位（谜题 2 重置）；谜题 2 解开后不再生效（制作人裁定 013 补充） */
  resetRaft(): boolean;
  /** R 现在按下是否生效（退潮且不在涨落中、浮台搁浅、谜题 2 未解） */
  readonly canResetRaft: boolean;
  /** 浮台离开了原位（推动过 / 卡进石槽） */
  readonly raftMoved: boolean;
  /**
   * 「R 放回浮台」提示是否显示（013 补充）：R 生效 + 浮台离开原位 + 汐在浮台 RESET_RAFT_PROMPT_DISTANCE 内。
   * explore = 汐在普通探索状态（场景判断：输入在 explore、没暂停、没在自动动作 / 推 / hold 中）。
   */
  resetRaftPromptVisible(player: THREE.Vector3, explore: boolean): boolean;
  fixedUpdate(dt: number, player: THREE.Vector3): void;
  dispose(): void;
}

/**
 * S1 谜题 1、2（v0.1-013，GDD §6 / text-ch1 §1）。
 *
 * 谜题 1「退潮」：岸台上敲潮汐钟 → 退潮（6 s）→ 台阶口的 walkableWhen=low 空气墙打开 → 走礁石小径到尽头 = 解开。
 * 谜题 2「浮台」：退潮时把沙地上的浮台（push，0.8 m/s）推进石槽 → 回岸台敲钟涨潮 → 浮台在石槽里浮到 1.85，
 *   与近岸平台 / 远侧台阶齐平 → 近岸平台 E 跨上浮台、再 E 跨到远侧台阶 = 解开。不在石槽里涨潮 → 2 s 漂回原位。
 * 涨潮路线：岸台北沿 → 礁脊 → 近岸平台（不下水）。下到水里（水深 > 0.3 m）→ 黑场送回岸台安全点。
 */
export function buildS1Puzzles(o: S1PuzzleOptions): S1Puzzles {
  const { game, root, physics, interaction, hints } = o;
  const { events, ui, narrative } = game;
  const R = S1.tideRegion;

  // ---- 潮汐分区（开场涨潮）
  const tide = new TideController({
    id: S1_IDS.tide,
    initial: 'high',
    events,
    region: (p) => p.x > R.minX && p.x < R.maxX && p.z > R.minZ && p.z < R.maxZ,
    safePoint: { position: v3(S1.safePoint), facing: S1.safeFacing },
  });
  tide.bindFromColliders(o.tideColliders);

  // ---- 潮汐钟（岸台东侧；高光金属 = 湿铜）
  const [bx, by, bz] = S1.bellAnchor;
  const bellRoot = new THREE.Group();
  bellRoot.name = 'tide-bell-s1';
  bellRoot.position.set(bx, by, bz);
  // 钟架朝西（+X，礁石小径方向）：站位在钟西侧
  const frame = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), o.wood);
    post.position.set(0, 1.1, side * 0.55);
    post.castShadow = true;
    frame.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 1.3), o.wood);
  beam.position.set(0, 2.15, 0);
  frame.add(beam);
  const swing = new THREE.Group();
  swing.name = 'tide-bell-s1-swing';
  swing.position.set(0, 2.05, 0);
  const bellBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 0.56, 20, 1, true), o.metal);
  bellBody.name = 'tide-bell-s1-body';
  bellBody.position.y = -0.32;
  bellBody.castShadow = true;
  swing.add(bellBody);
  bellRoot.add(frame, swing);
  root.add(bellRoot);
  bellRoot.updateMatrixWorld(true);
  const frameCollider = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 1.3));
  frameCollider.name = 'tide-bell-s1-frame-collider';
  frameCollider.position.set(bx, by + 1.1, bz);
  frameCollider.visible = false;
  root.add(frameCollider);
  physics.addMesh(frameCollider);
  const bellPoint = new THREE.Object3D();
  bellPoint.name = 'tide-bell-s1-interact';
  bellPoint.position.set(bx + 1.05, by, bz);
  bellPoint.lookAt(bx, by, bz);
  root.add(bellPoint);
  const bell = new TideBell({ id: S1_IDS.bell, tide, object: bellRoot, swing, interactPoint: bellPoint, focus: new THREE.Vector3(bx, by + 1.6, bz), events });
  interaction.add(bell.interactable);

  // ---- 浮台（2.0 × 3.0 × 0.3；根节点 = 甲板顶面）
  const rf = S1.raft;
  const raftRoot = new THREE.Group();
  raftRoot.name = 'raft-s1';
  raftRoot.position.copy(v3(rf.home));
  const raftMesh = new THREE.Mesh(new THREE.BoxGeometry(rf.size[0], rf.size[1], rf.size[2]), o.wood);
  raftMesh.name = 'raft-s1-collider';
  raftMesh.position.y = -rf.size[1] / 2;
  raftMesh.castShadow = raftMesh.receiveShadow = true;
  raftRoot.add(raftMesh);
  for (const dz of [-1, 0, 1]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(rf.size[0] + 0.1, 0.06, 0.18), o.wood);
    plank.position.set(0, 0.02, dz * 1.1);
    raftRoot.add(plank);
  }
  root.add(raftRoot);
  raftRoot.updateMatrixWorld(true);
  physics.addMesh(raftMesh, { dynamic: true });
  // 推的站位：浮台西侧（+X），面朝东（−X）推向石槽
  const raftPoint = new THREE.Object3D();
  raftPoint.name = 'raft-s1-interact';
  raftPoint.position.set(rf.size[0] / 2 + 0.45, -(rf.home[1] - S1.sandY), 0);
  raftPoint.rotation.y = -Math.PI / 2;
  raftRoot.add(raftPoint);
  const raftPush = new Interactable({
    id: S1_IDS.raft,
    kind: 'push',
    object: raftRoot,
    interactPoint: raftPoint,
    focus: raftMesh,
    reach: 0.9,
    track: { from: v3(rf.home), to: v3(rf.slot) },
  });
  interaction.add(raftPush);
  const slot = S1.stoneSlot;
  const raft = tide.addFloatable(
    new Floatable({
      id: S1_IDS.raft,
      object: raftRoot,
      restY: rf.home[1],
      floatOffset: rf.floatOffset,
      // 站立要求 ±5 cm：关掉漂浮起伏
      bob: false,
      anchors: [boxZone({ x: slot.min[0] + 0.4, y: -5, z: slot.min[1] + 1 }, { x: slot.max[0] - 0.4, y: 10, z: slot.max[1] - 1 })],
      homePosition: v3(rf.home),
      push: raftPush,
      events,
    }),
  );

  // ---- 跨越（近岸平台 ↔ 浮台 ↔ 远侧台阶）：浮台在石槽里浮到位、潮水不在变化时可用
  const deckY = S1.nearPlatform.topY;
  const ready = (): boolean => raft.state === 'floating' && raft.inAnchor && !tide.transitioning && Math.abs(raftRoot.position.y - deckY) < 0.05;
  const [lx, , lnz] = S1.linkNear;
  const lfz = S1.linkFar[2];
  const raftNear = rf.slot[2] - rf.size[2] / 2 + 0.45;
  const raftFar = rf.slot[2] + rf.size[2] / 2 - 0.45;
  const P = (z: number): THREE.Vector3 => new THREE.Vector3(lx, deckY, z);
  // 跨 0.5 m 的缝：中点抬高 0.25 m（小跳）
  const hop = (a: number, b: number): THREE.Vector3[] => [P((a + b) / 2).setY(deckY + 0.25)];
  const link = (a: number, b: number, radius: number): TraversalLink => new TraversalLink({ start: P(a), end: P(b), path: hop(a, b), radius, condition: ready });
  const links = [link(lnz - 0.35, raftNear, 0.7), link(raftNear, lnz - 0.35, 0.6), link(raftFar, lfz + 0.4, 0.6), link(lfz + 0.4, raftFar, 0.7)];
  links.forEach((l, i) => {
    const e = new Entity(`s1-link-${i}`);
    e.add(l);
    o.entities.add(e);
    o.addLink(l);
  });

  // ---- 可调查 / 可阅读
  const marker = (name: string, p: THREE.Vector3, size: [number, number, number], mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    m.name = name;
    m.position.copy(p);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x80878a, roughness: 0.85 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.9 });
  // 刻度柱（钟旁）：湿痕刻线
  const pillar = marker('s1-tide-pillar', new THREE.Vector3(-14.2, by + 1.1, -7.6), [0.3, 2.2, 0.3], stoneMat);
  // 告示板（码头靠岸一端北侧栏边）
  const noticeAt = pierPoint(5.2, S1.pier.width / 2 - 0.08, S1.pier.deckY + 1.2);
  const notice = marker('s1-notice', noticeAt, [0.9, 0.7, 0.06], paperMat);
  notice.rotation.y = S1.pier.rotationY;
  const slotMarker = new THREE.Object3D();
  slotMarker.position.set(slot.max[0] + 0.1, S1.sandY + 0.15, (slot.min[1] + slot.max[1]) / 2);
  root.add(slotMarker);
  const note = marker('s1-neighbor-note', new THREE.Vector3(15.05, S1.sandY + 0.03, -1.7), [0.22, 0.02, 0.3], paperMat);
  const items: Array<{ id: string; kind: 'inspect' | 'read'; object: THREE.Object3D; textId: TextId; focus?: THREE.Vector3; reach?: number }> = [
    { id: 's1-boat', kind: 'inspect', object: new THREE.Object3D(), textId: 'ch1.s1.boat.inspect', focus: new THREE.Vector3(S1.boat.position[0], 1.5, S1.boat.position[2]), reach: 1.4 },
    { id: 's1-tide-pillar', kind: 'inspect', object: pillar, textId: 'ch1.s1.tide_pillar.inspect' },
    { id: S1_IDS.stoneSlot, kind: 'inspect', object: slotMarker, textId: 'ch1.s1.stone_slot.inspect', focus: slotMarker.position.clone(), reach: 0.6 },
    { id: 's1-nets-a', kind: 'inspect', object: new THREE.Object3D(), textId: 'ch1.s1.nets.inspect', focus: new THREE.Vector3(15.9, 1.2, -2.25), reach: 0.6 },
    { id: 's1-nets-b', kind: 'inspect', object: new THREE.Object3D(), textId: 'ch1.s1.nets.inspect', focus: new THREE.Vector3(15.9, 1.2, 8.1), reach: 0.6 },
    { id: 's1-shed', kind: 'inspect', object: new THREE.Object3D(), textId: 'ch1.s1.shed.inspect', focus: new THREE.Vector3(16.6, 1.3, 1.46), reach: 1.0 },
    { id: 's1-notice', kind: 'read', object: notice, textId: 'ch1.s1.notice.doc' },
    { id: 's1-neighbor-note', kind: 'read', object: note, textId: 'ch1.s1.neighbor_note.doc', reach: 0.2 },
  ];
  for (const it of items) {
    if (!it.object.parent) root.add(it.object);
    interaction.add(
      new Interactable({
        id: it.id,
        kind: it.kind,
        object: it.object,
        textId: it.textId,
        ...(it.focus ? { focus: it.focus } : {}),
        ...(it.reach !== undefined ? { reach: it.reach } : {}),
      }),
    );
  }

  // ---- 三级提示
  hints.add({ id: S1_IDS.p1, zone: boxZone({ x: -19.5, y: -1, z: -11 }, { x: 1.5, y: 4, z: 1 }), l1: 'ch1.hint.p1.l1', l2: 'ch1.hint.p1.l2', l3: 'ch1.hint.p1.l3', highlight: [S1_IDS.bell] });
  hints.add({ id: S1_IDS.p2, zone: boxZone({ x: -4.6, y: -1, z: 4 }, { x: 15.6, y: 4, z: 12.5 }), l1: 'ch1.hint.p2.l1', l2: 'ch1.hint.p2.l2', l3: 'ch1.hint.p2.l3', highlight: [S1_IDS.raft, S1_IDS.stoneSlot] });

  // ---- 剧情 / 独白触发
  let p1Solved = false;
  let p2Solved = false;
  let firstLow = false;
  let bellHeard = false;
  let windTimer = 0;
  let footprintsShown = false;
  let channelShown = false;
  let prevFloat = raft.state;
  let driftBackSaid = false;
  const say = (id: TextId): void => void ui.subtitles.play([id]);
  const home = v3(rf.home);
  const tmpRaft = new THREE.Vector3();
  const canReset = (): boolean => !p2Solved && tide.state === 'low' && !tide.transitioning && raft.state === 'grounded';
  const raftMoved = (): boolean => raftPush.locked || raftPush.pushT > 1e-3 || raftRoot.position.distanceTo(home) > 0.05;
  const inPathEnd = circleZone({ x: S1.reefPathEnd[0], z: S1.reefPathEnd[2] }, S1.reefPathEndRadius);
  const inFootprints = circleZone({ x: S1.reefPath[2]![0], z: S1.reefPath[2]![2] }, 1.6);
  const N = S1.nearPlatform;
  const inChannelEdge = boxZone({ x: N.min[0], y: N.topY - 0.3, z: N.max[1] - 1.0 }, { x: N.max[0], y: N.topY + 1, z: N.max[1] + 0.1 });
  const ft = S1.farTrigger;
  const inFar = boxZone({ x: ft.min[0], y: ft.min[1], z: ft.min[2] }, { x: ft.max[0], y: ft.max[1], z: ft.max[2] });
  const bellXZ = new THREE.Vector2(bx, bz);

  const offs = [
    events.on('tide:changed', ({ zone, state }) => {
      if (zone !== S1_IDS.tide || state !== 'low' || firstLow) return;
      firstLow = true;
      say('ch1.s1.tide_bell.mono_first_low');
      if (!p1Solved) narrative.setGoal('ch1.s1.goal.reef_path');
    }),
    events.on('float:state', ({ id, state }) => {
      if (id !== S1_IDS.raft) return;
      // 「它漂回去了。」只在真的被推走又漂回原位时说，整局只说第一次（text-ch1.md:61，BUG-010）；没离开原位的浮起 Floatable 不会进 drifting
      if (prevFloat === 'drifting' && state !== 'drifting' && !driftBackSaid) {
        driftBackSaid = true;
        say('ch1.s1.raft.drift_back');
      }
      prevFloat = state;
    }),
  ];

  return {
    tide,
    bell,
    raft,
    raftPush,
    links,
    get p1Solved() {
      return p1Solved;
    },
    get p2Solved() {
      return p2Solved;
    },
    get canResetRaft() {
      return canReset();
    },
    get raftMoved() {
      return raftMoved();
    },
    resetRaftPromptVisible(player, explore) {
      if (!explore || !canReset() || !raftMoved()) return false;
      raftRoot.getWorldPosition(tmpRaft);
      return Math.hypot(player.x - tmpRaft.x, player.z - tmpRaft.z) <= RESET_RAFT_PROMPT_DISTANCE;
    },
    resetRaft() {
      if (!canReset()) return false;
      raftRoot.position.copy(v3(rf.home));
      raftRoot.updateMatrixWorld(true);
      raftPush.pushT = 0;
      raftPush.locked = false;
      return true;
    },
    fixedUpdate(dt, p) {
      // 钟：12 m 内风吹轻响；第一次听到时汐的独白
      const d = bellXZ.distanceTo(new THREE.Vector2(p.x, p.z));
      if (d < BELL_HEAR_DISTANCE) {
        if (!bellHeard) {
          bellHeard = true;
          say('ch1.s1.tide_bell.mono_seen');
        }
        windTimer -= dt;
        if (windTimer <= 0) {
          windTimer = BELL_WIND_INTERVAL;
          events.emit('sfx:play', { id: 'sfx-bell-wind' });
        }
      } else windTimer = Math.min(windTimer, 1);
      const low = tide.state === 'low' && !tide.transitioning;
      if (low && !footprintsShown && p.y < 1.2 && inFootprints(p)) {
        footprintsShown = true;
        say('ch1.s1.footprints.mono');
      }
      if (!p1Solved && p.y < 1.2 && inPathEnd(p)) {
        p1Solved = true;
        hints.solve(S1_IDS.p1);
        narrative.setGoal('ch1.s1.goal.cross_channel');
      }
      if (!channelShown && !ready() && inChannelEdge(p)) {
        channelShown = true;
        say('ch1.s1.channel.mono');
      }
      if (!p2Solved && inFar(p)) {
        p2Solved = true;
        hints.solve(S1_IDS.p2);
      }
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}
