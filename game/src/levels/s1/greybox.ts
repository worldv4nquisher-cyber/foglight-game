import * as THREE from 'three';
import { S1, pierPoint } from './layout';
import { S1_ROCKS } from './rocks';

/**
 * S1 白盒几何（v0.1-013）：纯 three.js（不碰 DOM），场景和 scripts/export-blockout-s1.mjs（导出
 * art/source/blockout/blockout-s1-ebb-shore.glb 给美术对位）共用。
 *
 * 命名约定同美术 GLB：`*-collider` = 碰撞体（白盒可见），`*-wall` = 空气墙（不可见）；
 * 潮汐开关写在 userData（导出为 extras）：walkableWhen = 'low'（礁石小径入口）、deepFloorY = 0.1（深水墙）。
 * 浮台（dynamic）不在这里，由场景创建。
 */
export interface S1Greybox {
  root: THREE.Group;
  colliders: THREE.Mesh[];
  walls: THREE.Mesh[];
  stoneSlotRails: THREE.Mesh[];
  /** 纯外观（脚印暗斑、石槽轨、钟台柱等） */
  decor: THREE.Object3D[];
}

export interface GreyboxMaterials {
  stone: THREE.Material;
  sand: THREE.Material;
  reef: THREE.Material;
  wood: THREE.Material;
  cliff: THREE.Material;
  dark: THREE.Material;
}

export function defaultGreyboxMaterials(): GreyboxMaterials {
  return {
    stone: new THREE.MeshStandardMaterial({ name: 'gb-stone', color: 0x6f7477, roughness: 0.92 }),
    sand: new THREE.MeshStandardMaterial({ name: 'gb-sand', color: 0x7d776b, roughness: 0.96 }),
    reef: new THREE.MeshStandardMaterial({ name: 'gb-reef', color: 0x4f5a57, roughness: 0.8 }),
    wood: new THREE.MeshStandardMaterial({ name: 'gb-wood', color: 0x5e5246, roughness: 0.85 }),
    cliff: new THREE.MeshStandardMaterial({ name: 'gb-cliff', color: 0x51575a, roughness: 0.95 }),
    dark: new THREE.MeshBasicMaterial({ name: 'gb-footprint', color: 0x22282a, transparent: true, opacity: 0.55, depthWrite: false }),
  };
}

const WALL_TOP = 6;

export function buildS1Greybox(mats: GreyboxMaterials = defaultGreyboxMaterials()): S1Greybox {
  const root = new THREE.Group();
  root.name = 'blockout-s1-ebb-shore';
  const colliders: THREE.Mesh[] = [];
  const walls: THREE.Mesh[] = [];
  const decor: THREE.Object3D[] = [];
  const wallMat = new THREE.MeshBasicMaterial({ name: 'gb-wall', color: 0x6aa0c0, transparent: true, opacity: 0.12, depthWrite: false });

  const addBox = (name: string, min: readonly [number, number, number], max: readonly [number, number, number], mat: THREE.Material, kind: 'collider' | 'wall'): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), kind === 'wall' ? wallMat : mat);
    mesh.name = `${name}-${kind}`;
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    if (kind === 'wall') {
      mesh.visible = false;
      walls.push(mesh);
    } else {
      mesh.castShadow = mesh.receiveShadow = true;
      colliders.push(mesh);
    }
    root.add(mesh);
    return mesh;
  };
  /** 两个顶面点之间的斜板（实心到 bottomY），宽 w；ext = 两端各延长 */
  const addSlab = (name: string, a: THREE.Vector3, b: THREE.Vector3, w: number, mat: THREE.Material, bottomY = -0.6, ext = 0.15): THREE.Mesh => {
    const len = a.distanceTo(b) + ext * 2;
    const h = Math.max(a.y, b.y) - bottomY;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
    mesh.name = `${name}-collider`;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    mesh.translateY(-h / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    colliders.push(mesh);
    root.add(mesh);
    return mesh;
  };
  /** 沿 a→b 的两侧墙（深水墙）：偏移 ±(w/2 + 0.1)，高 baseY → WALL_TOP */
  const addSideWalls = (name: string, a: THREE.Vector3, b: THREE.Vector3, w: number, deepFloorY: number): void => {
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.3;
    const baseY = Math.min(a.y, b.y);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, WALL_TOP - baseY, len), wallMat);
      mesh.name = `${name}-${side < 0 ? 'l' : 'r'}-wall`;
      mesh.position.set((a.x + b.x) / 2, (baseY + WALL_TOP) / 2, (a.z + b.z) / 2);
      mesh.lookAt(b.x, mesh.position.y, b.z);
      mesh.translateX(side * (w / 2 + 0.1));
      mesh.visible = false;
      mesh.userData.deepFloorY = deepFloorY;
      walls.push(mesh);
      root.add(mesh);
    }
  };
  const deep = (m: THREE.Mesh): THREE.Mesh => {
    m.userData.deepFloorY = S1.sandY;
    return m;
  };
  const sand = S1.sandY;

  // ---- 滩地（沙 0.1）与浮台沟
  const B = S1.bounds;
  const ch = S1.channel;
  addBox('s1-flat', [B.minX, -2, B.minZ], [B.maxX, sand, ch.z[0]], mats.sand, 'collider');
  addBox('s1-channel-track', [ch.trackMinX, -2, ch.z[0]], [B.maxX, sand, ch.z[1]], mats.sand, 'collider');
  // 石槽两侧挡石（美术 env-cliff-s1 石槽 kerb 0.28，低于台阶高 0.3，可以跨上去）
  for (const [z0, z1] of [[ch.z[0], ch.z[0] + 0.4], [ch.z[1] - 0.4, ch.z[1]]] as const) {
    addBox(`s1-channel-kerb-${z0}`, [ch.trackMinX, -0.65, z0], [0.62, 0.28, z1], mats.stone, 'collider');
  }
  // 对岸台阶东侧的岩坡脚（美术 env-cliff-s1 在潮沟北沿 x 1.2…2.6 抬到 ~1 m），挡住别走进石头里
  addBox('s1-farsteps-toe-e', [1.2, -0.65, 11.6], [2.6, 1.0, ch.z[1]], mats.reef, 'collider');
  addBox('s1-channel-deep', [-4.6, -2, ch.z[0]], [ch.trackMinX, ch.deepFloorY, ch.z[1]], mats.reef, 'collider');

  // ---- 岸台（钟台）
  const L = S1.ledge;
  addBox('s1-ledge', [L.min[0], -2, L.min[1]], [L.max[0], L.topY, L.max[1]], mats.stone, 'collider');

  // 岸台南沿 / 东沿的残破矮墙（美术 env-shore-ledge-s1 同位置，按最高段 0.58 连续挡），钟后护墙
  addBox('s1-ledge-parapet-s', [L.min[0] + 0.2, L.topY - 0.1, L.min[1] + 0.2], [L.max[0] - 0.4, L.topY + 0.6, L.min[1] + 0.56], mats.stone, 'collider');
  addBox('s1-ledge-parapet-e', [L.min[0] + 0.2, L.topY - 0.1, L.min[1] + 0.2], [L.min[0] + 0.56, L.topY + 0.6, L.max[1] - 0.3], mats.stone, 'collider');
  const BW = S1.bellWall;
  addBox('s1-bell-wall', [BW.min[0], L.topY - 0.1, BW.min[1]], [BW.max[0], BW.topY, BW.max[1]], mats.stone, 'collider');
  // 卸货吊杆桅脚与绞盘（art: build-env-s1.mjs DERRICK）
  addBox('s1-derrick', [-11.5, L.topY - 0.1, -9.8], [-11.0, L.topY + 4.5, -9.3], mats.stone, 'collider');
  addBox('s1-derrick-braces', [-12.2, L.topY - 0.1, -9.95], [-10.6, L.topY + 0.9, -9.1], mats.stone, 'collider');
  addBox('s1-winch', [-12.65, L.topY - 0.1, -9.7], [-11.95, L.topY + 0.7, -9.0], mats.stone, 'collider');
  // 石台上倒落的墙石（build-env-s1.mjs buildLedge，高 0.29 < 台阶高，可踩上去）
  for (const [k, [x0, z0, x1, z1]] of [[-16.62, -9.68, -16.01, -9.03], [-12.1, -9.61, -11.59, -8.91], [-18.24, -4.89, -17.56, -4.37], [-18.25, -8.42, -17.39, -7.88]].entries())
    addBox(`s1-ledge-fallen-${k}`, [x0!, L.topY - 0.05, z0!], [x1!, L.topY + 0.29, z1!], mats.stone, 'collider');
  // 美术崖脚 / 卸货岸凸出到滩地上的部分（env-cliff-s1 / env-unloading-shore-s1）
  addBox('s1-near-toe', [-6.05, -0.5, 6.75], [-4.6, 0.85, 8.25], mats.stone, 'collider');
  addBox('s1-channel-north-toe', [8.75, -0.5, 12.1], [12.25, 0.38, 12.5], mats.stone, 'collider');
  addBox('s1-channel-north-rock', [2.75, -0.5, 12.05], [3.3, 0.62, 12.5], mats.stone, 'collider');
  addBox('s1-shore-post', [-10.3, -0.5, 2.75], [-9.95, 2.15, 3.3], mats.stone, 'collider');

  // ---- 码头：甲板 0.3 厚（下面可以在退潮时钻过去）+ 桩
  const P = S1.pier;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(P.width, 0.3, P.length + 0.4), mats.wood);
  deck.name = 's1-pier-deck-collider';
  deck.position.set(P.mid[0], P.deckY - 0.15, P.mid[1]);
  deck.rotation.y = P.rotationY;
  deck.translateZ(0.2);
  deck.castShadow = deck.receiveShadow = true;
  colliders.push(deck);
  root.add(deck);
  // 桩：018 打磨起按美术 collider 逐根对位（S1.pierPiles，原 16 + 新增 22），圆柱顶截到甲板底
  const pileTop = P.deckY - 0.3;
  S1.pierPiles.forEach(([x, z, r], i) => {
    const p = pierPoint(z, x, 0);
    const h = pileTop - S1.pileBottomY;
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mats.wood);
    pile.name = `s1-pier-pile-${i}-collider`;
    pile.position.set(p.x, (pileTop + S1.pileBottomY) / 2, p.z);
    pile.castShadow = true;
    colliders.push(pile);
    root.add(pile);
  });
  // 码头两侧 + 海端深水墙（只挡甲板上）
  const pierWall = (name: string, along: number, side: number, len: number, rotate: boolean): void => {
    const c = pierPoint(along, side);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(rotate ? len : 0.2, WALL_TOP - P.deckY, rotate ? 0.2 : len), wallMat);
    mesh.name = `${name}-wall`;
    mesh.position.set(c.x, (P.deckY + WALL_TOP) / 2, c.z);
    mesh.rotation.y = P.rotationY;
    mesh.visible = false;
    walls.push(deep(mesh));
    root.add(mesh);
  };
  pierWall('s1-pier-deep-n', 0, P.width / 2 + 0.1, P.length, false);
  pierWall('s1-pier-deep-s', 0, -(P.width / 2 + 0.1), P.length, false);
  pierWall('s1-pier-deep-sea', -P.length / 2 - 0.1, 0, P.width + 0.4, true);
  // 美术码头（build-env-s1.mjs buildPier）上下的实物：+X 侧高桩系绳栏、−X 铁缆桩、每排桩之间的交叉斜撑
  const pierBox = (name: string, along: number, side: number, y0: number, y1: number, lenAlong: number, wSide: number, kind: 'collider' | 'wall'): void => {
    const c = pierPoint(along, side, (y0 + y1) / 2);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wSide, y1 - y0, lenAlong), kind === 'wall' ? wallMat : mats.wood);
    mesh.name = `${name}-${kind}`;
    mesh.position.copy(c);
    mesh.rotation.y = P.rotationY;
    if (kind === 'wall') {
      mesh.visible = false;
      walls.push(mesh);
    } else colliders.push(mesh);
    root.add(mesh);
  };
  pierBox('s1-pier-rope-rail', -1.01, 1.05, P.deckY, P.deckY + 1.0, 12.0, 0.24, 'wall');
  pierBox('s1-pier-bollard', -6.4, -1.0, P.deckY - 0.05, P.deckY + 0.4, 0.36, 0.36, 'collider');
  for (let i = 0; i < 8; i++) pierBox(`s1-pier-bent-${i}`, -6.8 + (i * 13.5) / 7, 0, S1.pileBottomY, pileTop, 0.25, 2.1, 'wall');

  // ---- 右下前景礁石（018 打磨，S1.foregroundRocks）：退潮滩地上，挡人
  for (const [idx, hx, hz, topY] of S1.foregroundRocks) {
    const r = S1_ROCKS[idx];
    if (!r) throw new Error(`S1.foregroundRocks: rocks.ts has no instance ${idx}`);
    const k = S1.rockColliderShrink;
    const bottom = -0.6;
    // 椭圆柱（S1.foregroundRockEllipse）：半轴 = 收缩后的盒半宽，去掉盒角（#157 盒角伸进深水区）
    // 1031：有网格轮廓（S1.foregroundRockHull）的用轮廓棱柱，贴合美术网格
    const hullPoly = S1.foregroundRockHull[idx];
    const geo = hullPoly
      ? prismGeometry(hullPoly, topY - bottom)
      : S1.foregroundRockEllipse.includes(idx)
        ? new THREE.CylinderGeometry(1, 1, topY - bottom, 24).scale(hx * k, 1, hz * k)
        : new THREE.BoxGeometry(hx * 2 * k, topY - bottom, hz * 2 * k);
    const box = new THREE.Mesh(geo, mats.reef);
    box.name = `s1-fg-rock-${idx}-collider`;
    box.position.set(r.translation[0], (topY + bottom) / 2, r.translation[2]);
    box.rotation.y = r.rotationY;
    box.castShadow = box.receiveShadow = true;
    colliders.push(box);
    root.add(box);
  }

  // ---- 岸台边沿深水墙：西沿留码头口（z −9.1…−5.9）和台阶口（z −3.8…−2.2），北沿留礁脊口（x −12.8…−11.2）
  const st = S1.reefStairs;
  const wy: [number, number] = [L.topY, WALL_TOP];
  for (const [z0, z1] of [[L.min[1], -9.1], [-5.9, st.z[0]], [st.z[1], L.max[1]]] as const) {
    deep(addBox(`s1-ledge-deep-w${z0}`, [L.max[0], wy[0], z0], [L.max[0] + 0.2, wy[1], z1], wallMat, 'wall'));
  }
  deep(addBox('s1-ledge-deep-s', [L.min[0], wy[0], L.min[1] - 0.2], [L.max[0] + 0.2, wy[1], L.min[1]], wallMat, 'wall'));
  for (const [x0, x1] of [[L.min[0], -12.8], [-11.2, L.max[0] + 0.2]] as const) {
    deep(addBox(`s1-ledge-deep-n${x0}`, [x0, wy[0], L.max[1]], [x1, wy[1], L.max[1] + 0.2], wallMat, 'wall'));
  }

  // ---- 岸台 → 礁石小径台阶（顶上 walkableWhen = low 的空气墙：涨潮挡住）
  for (let i = 0; i < st.count; i++) {
    const top = L.topY - st.rise * (i + 1);
    addBox(`s1-reef-stair-${i}`, [st.x0 + i * st.run, -2, st.z[0]], [st.x0 + (i + 1) * st.run, top, st.z[1]], mats.stone, 'collider');
  }
  const gate = addBox('s1-reef-gate', [st.x0 - 0.25, L.topY, st.z[0]], [st.x0 - 0.05, WALL_TOP, st.z[1]], wallMat, 'wall');
  gate.userData.walkableWhen = 'low';

  // ---- 礁石小径（谜题 1）：台阶底 → 6 块礁石 → 尽头，连续路面（美术礁石实例只做外观）
  const stairBottom = new THREE.Vector3(st.x0 + st.count * st.run - 0.15, L.topY - st.rise * st.count, (st.z[0] + st.z[1]) / 2);
  const pathPts = [stairBottom, ...S1.reefPath.map(([x, y, z]) => new THREE.Vector3(x, y, z)), new THREE.Vector3(S1.reefPathEnd[0], sand, S1.reefPathEnd[2])];
  for (let i = 0; i < pathPts.length - 1; i++) {
    addSlab(`s1-reef-path-${i}`, pathPts[i]!, pathPts[i + 1]!, S1.reefPathWidth, mats.reef, -0.5, 0.35);
  }
  // 脚印暗斑（退潮露出的「之前有人走过」）：相邻礁石之间各一对
  const footGeo = new THREE.PlaneGeometry(0.16, 0.3);
  for (let i = 1; i < pathPts.length - 2; i++) {
    const a = pathPts[i]!;
    const b = pathPts[i + 1]!;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (const [t, side] of [[0.35, -1], [0.65, 1]] as const) {
      const f = new THREE.Mesh(footGeo, mats.dark);
      f.name = `s1-footprint-${i}-${side < 0 ? 'l' : 'r'}`;
      f.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
      f.position.lerpVectors(a, b, t).add(new THREE.Vector3(Math.cos(yaw) * 0.12 * side, 0.012, -Math.sin(yaw) * 0.12 * side));
      f.renderOrder = 1;
      decor.push(f);
      root.add(f);
    }
  }

  // ---- 礁脊（高潮安全路线）
  const ridge = S1.ridge.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  for (let i = 0; i < ridge.length - 1; i++) {
    addSlab(`s1-ridge-${i}`, ridge[i]!, ridge[i + 1]!, S1.ridgeWidth, mats.stone, -0.5, 0.2);
    addSideWalls(`s1-ridge-deep-${i}`, ridge[i]!, ridge[i + 1]!, S1.ridgeWidth, sand);
  }
  for (let i = 1; i < ridge.length - 1; i++) {
    const p = ridge[i]!;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(S1.ridgeWidth / 2, S1.ridgeWidth / 2, p.y + 0.5, 16), mats.stone);
    pad.name = `s1-ridge-joint-${i}-collider`;
    pad.position.set(p.x, (p.y - 0.5) / 2, p.z);
    colliders.push(pad);
    root.add(pad);
  }

  // ---- 近岸平台（1.85）+ 四边深水墙（东沿留礁脊口 z 6.0…7.2；北沿 = 浮台沟，走 TraversalLink 上浮台）
  const N = S1.nearPlatform;
  addBox('s1-near-platform', [N.min[0], -2, N.min[1]], [N.max[0], N.topY, N.max[1]], mats.stone, 'collider');
  const ny: [number, number] = [N.topY, WALL_TOP];
  deep(addBox('s1-near-deep-s', [N.min[0], ny[0], N.min[1] - 0.2], [N.max[0] + 0.2, ny[1], N.min[1]], wallMat, 'wall'));
  deep(addBox('s1-near-deep-w', [N.max[0], ny[0], N.min[1]], [N.max[0] + 0.2, ny[1], N.max[1] + 0.2], wallMat, 'wall'));
  deep(addBox('s1-near-deep-n', [N.min[0] - 0.2, ny[0], N.max[1]], [N.max[0], ny[1], N.max[1] + 0.2], wallMat, 'wall'));
  deep(addBox('s1-near-deep-e1', [N.min[0] - 0.2, ny[0], N.min[1]], [N.min[0], ny[1], 6.0], wallMat, 'wall'));
  deep(addBox('s1-near-deep-e2', [N.min[0] - 0.2, ny[0], 7.2], [N.min[0], ny[1], N.max[1]], wallMat, 'wall'));

  // ---- 石槽（锚位）轨：外观 + 低矮碰撞
  const stoneSlotRails = [S1.stoneSlot.min[0] - 0.08, S1.stoneSlot.max[0] + 0.08].map((x) =>
    addBox(`s1-stone-slot-rail${x < -1 ? 'e' : 'w'}`, [x - 0.06, sand, S1.stoneSlot.min[1]], [x + 0.06, sand + 0.18, S1.stoneSlot.max[1]], mats.stone, 'collider'),
  );

  // ---- 远侧台阶（谜题 2 终点）→ 崖顶平台（出口）
  const F = S1.farSteps;
  addBox('s1-far-landing', [F.x[0], -2, F.z0], [F.x[1], F.baseY, F.z0 + F.landing], mats.stone, 'collider');
  for (let i = 0; i < F.count; i++) {
    const z0 = F.z0 + F.landing + i * F.run;
    addBox(`s1-far-step-${i}`, [F.x[0], -2, z0], [F.x[1], F.baseY + F.rise * (i + 1), z0 + F.run], mats.stone, 'collider');
  }
  const stepsEnd = F.z0 + F.landing + F.count * F.run;
  const Pl = S1.plateau;
  addBox('s1-plateau', [Pl.min[0], -2, stepsEnd], [Pl.max[0], Pl.topY, Pl.max[1]], mats.stone, 'collider');

  // ---- 崖壁（不可攀，顶 7）：围住浮台沟北侧、台阶两侧、崖顶平台
  const cliffTop = 7;
  addBox('s1-cliff-w', [F.x[1], -2, ch.z[1]], [B.maxX, cliffTop, 30], mats.cliff, 'collider');
  addBox('s1-cliff-e', [B.minX, -2, ch.z[1]], [F.x[0], cliffTop, stepsEnd], mats.cliff, 'collider');
  addBox('s1-cliff-ne', [B.minX, -2, stepsEnd], [Pl.min[0], cliffTop, 30], mats.cliff, 'collider');
  addBox('s1-cliff-n', [Pl.min[0], -2, Pl.max[1]], [F.x[1], cliffTop, 30], mats.cliff, 'collider');
  addBox('s1-cliff-channel-e', [B.minX, -2, ch.z[0]], [-4.6, cliffTop, ch.z[1]], mats.cliff, 'collider');

  // ---- 小船（返工 1029 挪到 +X 系船桩）：退潮时滩地白盒 0.1 可以走到船边，船浮在 −0.24、船舷顶 ≈ 0.56。
  // 放一块按船体朝向的隐形挡板（永久；涨潮时在水下，没人够得着），走过去不会穿过船身
  const bt = S1.boat;
  const hullTop = S1.tide.low - bt.belowWater + bt.hull.topY;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(bt.hull.beam, hullTop + 2, bt.hull.length), wallMat);
  hull.name = 's1-boat-hull-wall';
  hull.rotation.y = bt.rotationY;
  hull.position.set(bt.position[0], (hullTop - 2) / 2, bt.position[2]);
  hull.translateZ(bt.hull.centerZ);
  hull.visible = false;
  walls.push(hull);
  root.add(hull);

  // ---- 外框空气墙（永久）：东、西（雾里的渔具棚 / 晾网架）、南（外海）
  addBox('s1-bound-e', [B.minX - 0.3, -2, B.minZ - 0.3], [B.minX, 10, 30], wallMat, 'wall');
  addBox('s1-bound-w', [B.maxX, -2, B.minZ - 0.3], [B.maxX + 0.3, 10, 30], wallMat, 'wall');
  addBox('s1-bound-s', [B.minX - 0.3, -2, B.minZ - 0.3], [B.maxX + 0.3, 10, B.minZ], wallMat, 'wall');

  root.updateMatrixWorld(true);
  return { root, colliders, walls, stoneSlotRails, decor };
}

/** 竖直棱柱：轮廓 poly（局部 xz，任意绕向的凸 / 简单多边形），高 h，以 y = 0 为中心（和 BoxGeometry / CylinderGeometry 一致） */
export function prismGeometry(poly: readonly (readonly [number, number])[], h: number): THREE.BufferGeometry {
  const n = poly.length;
  // 统一成从上往下看逆时针（x 右、−z 上 → shape 用 (x, −z)）
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, -z));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const pos: number[] = [];
  const y0 = -h / 2;
  const y1 = h / 2;
  for (const p of pts) pos.push(p.x, y0, -p.y);
  for (const p of pts) pos.push(p.x, y1, -p.y);
  const idx: number[] = [];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) {
    idx.push(n + a!, n + b!, n + c!); // 顶面朝上
    idx.push(c!, b!, a!); // 底面朝下
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
