import * as THREE from 'three';
import { S2, slopeY } from './layout';

/**
 * S2 白盒几何（v0.1-014）：纯 three.js（不碰 DOM），场景和白盒导出共用。
 * 命名约定同 S1 / 美术 GLB：`*-collider` = 碰撞体（白盒可见），`*-wall` = 空气墙（不可见），`*-indoor` = 室内相机触发体。
 * 镜子、灯台、拨盘等会动 / 有状态的东西不在这里，由 beam.ts / puzzles.ts 创建（地窖门、拨盘铁门例外：门扇碰撞在这里，puzzles 控制开关）。
 */
export interface S2Greybox {
  root: THREE.Group;
  colliders: THREE.Mesh[];
  walls: THREE.Mesh[];
  decor: THREE.Object3D[];
  /** -indoor 触发体（相机 ≤ 2 m） */
  indoor: THREE.Mesh[];
  /** 地窖门扇（合页节点；门扇碰撞是它的子网格，puzzles 旋转它并开关碰撞） */
  cellarDoor: THREE.Group;
  cellarDoorLeaf: THREE.Mesh;
  /** 拨盘铁门（合页节点；门扇碰撞是子网格） */
  dialGate: THREE.Group;
  dialGateLeaf: THREE.Mesh;
  /** 白石占位（puzzleCritical） */
  whiteStones: THREE.Group;
  /** 观察点空节点（viewpoint-s2：眼睛位置、朝向目标，extras fov） */
  viewpoint: THREE.Object3D;
}

export interface S2GreyboxMaterials {
  stone: THREE.Material;
  ground: THREE.Material;
  plaster: THREE.Material;
  wood: THREE.Material;
  cliff: THREE.Material;
  white: THREE.Material;
}

export function defaultS2GreyboxMaterials(): S2GreyboxMaterials {
  return {
    stone: new THREE.MeshStandardMaterial({ name: 'gb-stone', color: 0x6f7477, roughness: 0.92 }),
    ground: new THREE.MeshStandardMaterial({ name: 'gb-ground', color: 0x5d6359, roughness: 0.96 }),
    plaster: new THREE.MeshStandardMaterial({ name: 'gb-plaster', color: 0x8a8680, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ name: 'gb-wood', color: 0x5e5246, roughness: 0.85 }),
    cliff: new THREE.MeshStandardMaterial({ name: 'gb-cliff', color: 0x51575a, roughness: 0.95 }),
    white: new THREE.MeshStandardMaterial({ name: 'gb-white-stone', color: 0xd9d8d2, roughness: 0.7 }),
  };
}

type V3 = readonly [number, number, number];
const WALL_TOP = 8;

export function buildS2Greybox(mats: S2GreyboxMaterials = defaultS2GreyboxMaterials()): S2Greybox {
  const root = new THREE.Group();
  root.name = 'blockout-s2-keeper-house';
  const colliders: THREE.Mesh[] = [];
  const walls: THREE.Mesh[] = [];
  const decor: THREE.Object3D[] = [];
  const indoor: THREE.Mesh[] = [];
  const wallMat = new THREE.MeshBasicMaterial({ name: 'gb-wall', color: 0x6aa0c0, transparent: true, opacity: 0.12, depthWrite: false });

  const boxMesh = (min: V3, max: V3, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), mat);
    m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    return m;
  };
  const addBox = (name: string, min: V3, max: V3, mat: THREE.Material, kind: 'collider' | 'wall' = 'collider'): THREE.Mesh => {
    const mesh = boxMesh(min, max, kind === 'wall' ? wallMat : mat);
    mesh.name = `${name}-${kind}`;
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
  const addDecor = (name: string, obj: THREE.Object3D): void => {
    obj.name = name;
    decor.push(obj);
    root.add(obj);
  };

  // ---- 崖顶平台（顶面 0，实心到海面 −16）：地窖（x −2.6…1.4，z −1.4…3.4）挖空
  const sea = S2.seaY;
  const [px0, px1] = S2.platform.x;
  const [pz0, pz1] = S2.platform.z;
  const C = S2.cellar;
  addBox('s2-ground-e', [px0, sea, pz0], [C.x[0], 0, pz1], mats.ground);
  addBox('s2-ground-w', [C.x[1], sea, pz0], [px1, 0, pz1], mats.ground);
  addBox('s2-ground-s', [C.x[0], sea, pz0], [C.x[1], 0, C.z[0]], mats.ground);
  addBox('s2-ground-n', [C.x[0], sea, C.z[1]], [C.x[1], 0, pz1], mats.ground);

  // 西侧坡地（x 8 → 25，每米降 0.0776）：斜板，实心到海面
  {
    const [sx0, sx1] = S2.slope.x;
    const y1 = slopeY(sx1);
    const len = Math.hypot(sx1 - sx0, y1);
    const h = 4;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(len + 0.3, h, pz1 - pz0), mats.ground);
    slab.name = 's2-west-slope-collider';
    slab.position.set((sx0 + sx1) / 2, y1 / 2, (pz0 + pz1) / 2);
    slab.rotation.z = Math.atan2(y1, sx1 - sx0);
    slab.translateY(-h / 2);
    slab.castShadow = slab.receiveShadow = true;
    colliders.push(slab);
    root.add(slab);
    addBox('s2-west-cliff', [sx0, sea, pz0], [sx1, y1 - 1.5, pz1], mats.cliff);
  }

  // 北侧崖径（铁门之后）+ 两侧 / 尽头空气墙
  const NP = S2.northPath;
  addBox('s2-north-path', [NP.x[0], sea, NP.z[0]], [NP.x[1], 0, NP.z[1]], mats.ground);
  addBox('s2-north-path-bound-e', [NP.x[0] - 0.3, 0, NP.z[0]], [NP.x[0], WALL_TOP, NP.endZ], wallMat, 'wall');
  addBox('s2-north-path-bound-w', [NP.x[1], 0, NP.z[0]], [NP.x[1] + 0.3, WALL_TOP, NP.endZ], wallMat, 'wall');
  addBox('s2-north-path-bound-n', [NP.x[0] - 0.3, 0, NP.endZ], [NP.x[1] + 0.3, WALL_TOP, NP.endZ + 0.3], wallMat, 'wall');

  // 北墙（矮石墙 1.2 + 上方空气墙），铁门洞 x 3.4…5.0（门扇 / 拨盘由 puzzles.ts 放）
  const NW = S2.northWall;
  const [gx0, gx1] = NW.gate;
  for (const [x0, x1] of [[px0, gx0 - 0.3], [gx1 + 0.3, S2.slope.x[1]]] as const) {
    addBox(`s2-north-wall-${x0 < 0 ? 'e' : 'w'}`, [x0, -1.2, NW.z[0]], [x1, NW.h, NW.z[1]], mats.stone);
    addBox(`s2-north-bound-${x0 < 0 ? 'e' : 'w'}`, [x0, NW.h, NW.z[0]], [x1, WALL_TOP, NW.z[1]], wallMat, 'wall');
  }
  for (const x of [gx0 - 0.15, gx1 + 0.15]) addBox(`s2-gate-pillar-${x < 4 ? 'e' : 'w'}`, [x - 0.15, 0, NW.z[0] - 0.05], [x + 0.15, 1.6, NW.z[1] + 0.05], mats.stone);

  // 外框空气墙：东（崖边）、西（坡地尽头崖边）、南（崖边 + 南石阶：不走回头路）
  addBox('s2-bound-e', [px0 - 0.3, -2, pz0 - 0.3], [px0, WALL_TOP, pz1], wallMat, 'wall');
  addBox('s2-bound-w', [S2.slope.x[1] - 0.3, -3, pz0 - 0.3], [S2.slope.x[1], WALL_TOP, pz1], wallMat, 'wall');
  addBox('s2-bound-s', [px0 - 0.3, -3, pz0 - 0.3], [S2.slope.x[1], WALL_TOP, pz0 + 0.4], wallMat, 'wall');

  // 南石阶（外观：往南 12 级 × 0.2 下到 S1 方向）
  {
    const st = S2.stairsSouth;
    const g = new THREE.Group();
    for (let i = 0; i < st.count; i++) {
      const top = -st.rise * (i + 1);
      const z1 = st.zTop - i * st.run;
      g.add(boxMesh([st.x[0], top - 0.4, z1 - st.run], [st.x[1], top, z1], mats.stone));
    }
    addDecor('s2-stairs-south', g);
  }

  // ---- 石屋外墙（厚 0.6，一层 0 → 檐口 5.6；山墙东西两侧到屋脊 8.3）
  const H = S2.house;
  const I = H.inner;
  type Opening = { a: number; b: number; y0: number; y1: number };
  const opens = (wall: 'S' | 'N' | 'E' | 'W'): Opening[] => Object.values(S2.openings).filter((o) => o.wall === wall);
  /** 沿 s 轴（x 或 z）的墙：按洞口把 [s0, s1] × [0, top] 切成格子，洞口格不放 */
  const wallWithOpenings = (name: string, axis: 'x' | 'z', s0: number, s1: number, t0: number, t1: number, top: number, os: Opening[]): void => {
    const ss = [...new Set([s0, s1, ...os.flatMap((o) => [o.a, o.b])])].sort((p, q) => p - q);
    const ys = [...new Set([0, top, ...os.flatMap((o) => [o.y0, o.y1])])].sort((p, q) => p - q);
    for (let i = 0; i < ss.length - 1; i++) {
      const a = ss[i]!;
      const b = ss[i + 1]!;
      // 同一列里连续的实心格合并成一块
      let y = 0;
      while (y < ys.length - 1) {
        const isHole = (k: number): boolean => os.some((o) => a >= o.a - 1e-6 && b <= o.b + 1e-6 && ys[k]! >= o.y0 - 1e-6 && ys[k + 1]! <= o.y1 + 1e-6);
        if (isHole(y)) {
          y++;
          continue;
        }
        let e = y;
        while (e + 1 < ys.length - 1 && !isHole(e + 1)) e++;
        const min: V3 = axis === 'x' ? [a, ys[y]!, t0] : [t0, ys[y]!, a];
        const max: V3 = axis === 'x' ? [b, ys[e + 1]!, t1] : [t1, ys[e + 1]!, b];
        addBox(`${name}-${i}-${y}`, min, max, mats.stone);
        y = e + 1;
      }
    }
  };
  wallWithOpenings('s2-house-wall-s', 'x', H.x0, H.x1, H.z0, I.z0, H.eave, opens('S'));
  wallWithOpenings('s2-house-wall-n', 'x', H.x0, H.x1, I.z1, H.z1, H.eave, opens('N'));
  wallWithOpenings('s2-house-wall-w', 'z', I.z0, I.z1, I.x1, H.x1, H.eave, opens('W'));
  wallWithOpenings('s2-house-wall-e', 'z', I.z0, I.z1, H.x0, I.x0, H.eave, opens('E'));
  // 山墙三角 + 坡屋顶（碰撞：挡相机；屋面两块斜板）
  {
    const zc = (H.z0 + H.z1) / 2;
    const half = (H.z1 - H.z0) / 2 + 0.3;
    const rise = H.ridge - H.eave;
    const ang = Math.atan2(rise, half);
    const len = Math.hypot(half, rise);
    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(H.x1 - H.x0 + 0.6, 0.2, len), mats.wood);
      roof.name = `s2-house-roof-${side < 0 ? 's' : 'n'}-collider`;
      roof.position.set((H.x0 + H.x1) / 2, H.eave + rise / 2 + 0.1, zc + (side * half) / 2);
      roof.rotation.x = side * ang;
      roof.castShadow = roof.receiveShadow = true;
      colliders.push(roof);
      root.add(roof);
    }
    const tri = new THREE.Shape([new THREE.Vector2(-half + 0.3, 0), new THREE.Vector2(half - 0.3, 0), new THREE.Vector2(0, rise)]);
    const tg = new THREE.ExtrudeGeometry(tri, { depth: H.wall, bevelEnabled: false });
    for (const x of [H.x0, H.x1 - H.wall]) {
      const g = new THREE.Mesh(tg, mats.stone);
      g.rotation.y = Math.PI / 2;
      g.position.set(x, H.eave, zc);
      g.castShadow = true;
      addDecor(`s2-house-gable-${x < 0 ? 'e' : 'w'}`, g);
    }
  }

  // ---- 一层地面（地窖上方楼板，楼梯间 x ≥ 0.09、z ≥ −0.06 敞开）
  const W = S2.well;
  addBox('s2-floor1-a', [C.x[0], -0.2, C.z[0]], [W.x0, 0, C.z[1]], mats.wood);
  addBox('s2-floor1-b', [W.x0, -0.2, C.z[0]], [C.x[1], 0, W.z1], mats.wood);
  // 地窖楼梯间隔墙（一层，到二层楼板下）
  addBox('s2-well-wall-e', [W.x0 - 0.06, 0, W.z1], [W.x0 + 0.06, H.upperFloorY - 0.2, I.z1], mats.plaster);
  addBox('s2-well-wall-s', [W.x0, 0, W.z1 - 0.06], [I.x1, H.upperFloorY - 0.2, W.z1 + 0.06], mats.plaster);

  // ---- 室内楼梯（实心到地面）+ 二层楼板（楼梯口 x −3.0…0.66、z < −0.5 敞开）
  const S = S2.stair;
  const xTop = S.x0 + (S.count - 1) * S.run;
  for (let i = 1; i < S.count; i++) {
    addBox(`s2-stair-${i}`, [S.x0 + (i - 1) * S.run, 0, S.z[0]], [S.x0 + i * S.run, i * S.rise, S.z[1]], mats.wood);
  }
  const F = H.upperFloorY;
  addBox('s2-floor2-e', [I.x0, F - 0.2, I.z0], [S.x0, F, I.z1], mats.wood);
  addBox('s2-floor2-w', [xTop, F - 0.2, I.z0], [I.x1, F, I.z1], mats.wood);
  addBox('s2-floor2-mid', [S.x0, F - 0.2, -0.5], [xTop, F, I.z1], mats.wood);
  // 楼梯口护栏（二层）
  addBox('s2-stair-rail-n', [S.x0, F, -0.53], [xTop - 0.95, F + 1.0, -0.47], mats.wood);
  addBox('s2-stair-rail-e', [S.x0 - 0.01, F, I.z0], [S.x0 + 0.05, F + 1.0, -0.5], mats.wood);

  // ---- 家具（碰撞）
  const Fu = S2.furniture;
  const t = Fu.table;
  addBox('s2-table', [t.c[0] - t.w / 2, 0, t.c[2] - t.d / 2], [t.c[0] + t.w / 2, t.h, t.c[2] + t.d / 2], mats.wood);
  addBox('s2-dresser', [Fu.dresser.x[0], 0, Fu.dresser.z[0]], [Fu.dresser.x[1], Fu.dresser.h, Fu.dresser.z[1]], mats.wood);
  addBox('s2-chimney', [Fu.chimney.x[0], 0, Fu.chimney.z[0]], [Fu.chimney.x[1], H.ceiling, Fu.chimney.z[1]], mats.plaster);
  addBox('s2-bed', [Fu.bed.x[0], F, Fu.bed.z[0]], [Fu.bed.x[1], F + Fu.bed.h, Fu.bed.z[1]], mats.wood);
  addBox('s2-chest', [Fu.chest.x[0], F, Fu.chest.z[0]], [Fu.chest.x[1], F + Fu.chest.h, Fu.chest.z[1]], mats.wood);
  // 书桌碰撞体前沿内收 8 cm（桌面下留腿位）：书桌站位 deskInteract x −4.6 与美术 / 017 clip 对齐，
  // 胶囊半径 0.25 到 −4.85，桌沿 −4.8 会让交互走位判“路被挡”原地不动；桌面板照常到 −4.8
  addBox('s2-desk', [Fu.desk.x[0], F, Fu.desk.z[0]], [Fu.desk.x[1] - 0.08, Fu.desk.top, Fu.desk.z[1]], mats.wood);
  {
    const lip = boxMesh([Fu.desk.x[1] - 0.08, Fu.desk.top - 0.04, Fu.desk.z[0]], [Fu.desk.x[1], Fu.desk.top, Fu.desk.z[1]], mats.wood);
    lip.castShadow = lip.receiveShadow = true;
    addDecor('s2-desk-lip', lip);
  }
  // 二层平顶（挡相机）
  addBox('s2-ceiling', [I.x0, H.ceiling, I.z0], [I.x1, H.ceiling + 0.15, I.z1], mats.plaster);

  // ---- 地窖：地面 −2.4、北门内平台（y 0）+ 12 级石阶向南下
  addBox('s2-cellar-floor', [C.x[0], sea, C.z[0]], [C.x[1], C.floorY, C.z[1]], mats.stone);
  addBox('s2-cellar-landing', [C.stepsX[0], -0.4, C.landingZ], [C.stepsX[1], 0, C.z[1]], mats.stone);
  {
    const run = (C.landingZ - C.bottomZ) / (C.steps - 1);
    for (let i = 1; i < C.steps; i++) {
      const z1 = C.landingZ - (i - 1) * run;
      addBox(`s2-cellar-step-${i}`, [C.stepsX[0], C.floorY, z1 - run], [C.stepsX[1], -0.2 * i, z1], mats.stone);
    }
  }
  addBox('s2-cellar-shelf', [Fu.cellarShelf.x[0], C.floorY, Fu.cellarShelf.z[0]], [Fu.cellarShelf.x[1], C.floorY + Fu.cellarShelf.h, Fu.cellarShelf.z[1]], mats.wood);
  addBox('s2-cellar-shelf-back', [Fu.cellarShelf.x[0] - 0.08, C.floorY, Fu.cellarShelf.z[0]], [Fu.cellarShelf.x[0], C.floorY + Fu.cellarShelf.backH, Fu.cellarShelf.z[1]], mats.wood);
  {
    const k = Fu.cellarCrate;
    addBox('s2-cellar-crate', [k.c[0] - k.w / 2, k.c[1], k.c[2] - k.d / 2], [k.c[0] + k.w / 2, k.c[1] + k.h, k.c[2] + k.d / 2], mats.wood);
  }

  // ---- 地窖门扇（关着；puzzles 在光感锁触发后绕合页转开并关掉碰撞）
  const cellarDoor = new THREE.Group();
  cellarDoor.name = 's2-cellar-door-hinge';
  const cd = S2.cellarDoor;
  cellarDoor.position.set(cd.hinge[0], cd.hinge[1], cd.hinge[2]);
  const cellarDoorLeaf = new THREE.Mesh(new THREE.BoxGeometry(cd.width + 0.13, cd.height, 0.08), mats.wood);
  cellarDoorLeaf.name = 's2-cellar-door-collider';
  cellarDoorLeaf.position.set(-(cd.width + 0.13) / 2 + 0.065, cd.height / 2, 0);
  cellarDoorLeaf.castShadow = cellarDoorLeaf.receiveShadow = true;
  cellarDoor.add(cellarDoorLeaf);
  colliders.push(cellarDoorLeaf);
  root.add(cellarDoor);

  // ---- 拨盘铁门（谜题 4）：门扇碰撞在这里（关着挡门洞），puzzles 放拨盘、对上 317 后转开并关掉碰撞
  const dialGate = new THREE.Group();
  dialGate.name = 's2-dial-gate-hinge';
  const dg = S2.dialGate;
  dialGate.position.set(dg.hinge[0], dg.hinge[1], dg.hinge[2]);
  const dialGateLeaf = new THREE.Mesh(new THREE.BoxGeometry(dg.width, dg.height, 0.1), mats.stone);
  dialGateLeaf.name = 's2-dial-gate-collider';
  dialGateLeaf.position.set(-dg.width / 2, dg.height / 2, 0);
  dialGateLeaf.castShadow = dialGateLeaf.receiveShadow = true;
  dialGate.add(dialGateLeaf);
  colliders.push(dialGateLeaf);
  root.add(dialGate);

  // ---- 东侧小院：石墙（高 1.1、厚 0.5 向院内）、院门柱、晾衣架（blocksLight）
  const Y = S2.yard;
  const wt = Y.wallT;
  const wh = Y.wallH;
  addBox('s2-yard-wall-s-e', [Y.x[0], 0, Y.z[0]], [Y.gate[0], wh, Y.z[0] + wt], mats.stone);
  addBox('s2-yard-wall-s-w', [Y.gate[1], 0, Y.z[0]], [Y.x[1], wh, Y.z[0] + wt], mats.stone);
  addBox('s2-yard-wall-w', [Y.x[1] - wt, 0, Y.z[0] + wt], [Y.x[1], wh, H.z0], mats.stone);
  addBox('s2-yard-wall-e', [Y.x[0], 0, Y.z[0] + wt], [Y.x[0] + wt, wh, Y.z[1]], mats.stone);
  addBox('s2-yard-wall-n', [Y.x[0] + wt, 0, Y.z[1] - wt], [Y.northGapX, wh, Y.z[1]], mats.stone);
  for (const [x, z, h] of [[Y.gate[0] - 0.3, Y.z[0] + 0.25, 1.35], [Y.gate[1] + 0.3, Y.z[0] + 0.25, 1.35], [Y.northGapX + 0.3, Y.z[1] - 0.25, 1.25]] as const) {
    addBox(`s2-yard-pillar-${x.toFixed(1)}`, [x - 0.36, 0, z - 0.36], [x + 0.36, h, z + 0.36], mats.stone);
  }
  const R = S2.rack;
  const rack = addBox('s2-laundry-rack', [R.at[0] - R.halfX, 0, R.at[2] - R.halfZ], [R.at[0] + R.halfX, R.h, R.at[2] + R.halfZ], mats.plaster);
  rack.userData.blocksLight = true;
  // 灯台基座（外观，顶面 0）
  for (const [k, p] of Object.entries(S2.lamps)) {
    const b = boxMesh([p[0] - 0.45, -0.3, p[2] - 0.45], [p[0] + 0.45, 0.01, p[2] + 0.45], mats.stone);
    addDecor(`s2-lamp-base-${k}`, b);
  }

  // ---- 白石组（白盒：分散白色方块，puzzleCritical）
  const whiteStones = new THREE.Group();
  whiteStones.name = 'white-stones-s2';
  whiteStones.userData.puzzleCritical = true;
  S2.whiteStones.forEach((p, i) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.45), mats.white);
    s.name = `white-stone-s2-${i}`;
    s.position.set(p[0], p[1] + 0.18, p[2]);
    s.rotation.y = i * 0.7;
    s.castShadow = s.receiveShadow = true;
    whiteStones.add(s);
  });
  addDecor('white-stones-s2', whiteStones);

  // ---- 观察点（viewpoint-s2：眼睛位置，-Z 朝向目标；extras fov / tolerance）
  const viewpoint = new THREE.Object3D();
  viewpoint.name = 'viewpoint-s2';
  const vp = S2.viewpoint;
  viewpoint.position.set(vp.eye[0], vp.eye[1], vp.eye[2]);
  viewpoint.lookAt(vp.lookAt[0], vp.lookAt[1], vp.lookAt[2]);
  viewpoint.rotateY(Math.PI); // Object3D.lookAt 让 +Z 朝目标；导出给美术按 glTF 相机约定 −Z 朝目标
  viewpoint.userData = { fov: vp.fov, toleranceDeg: vp.toleranceDeg, fadeFromDeg: vp.fadeFromDeg, floorY: vp.eye[1] - 1.35, lookAt: [...vp.lookAt] };
  root.add(viewpoint);

  // ---- 室内触发体（相机 ≤ 2 m）：石屋两层 + 地窖
  for (const [name, min, max] of [
    ['s2-house-indoor', [I.x0, 0, I.z0], [I.x1, H.ceiling, I.z1]],
    ['s2-cellar-indoor', [C.x[0], C.floorY, C.z[0]], [C.x[1], 0, C.z[1]]],
  ] as const) {
    const m = boxMesh(min, max, wallMat);
    m.name = name;
    m.visible = false;
    indoor.push(m);
    root.add(m);
  }

  root.updateMatrixWorld(true);
  return { root, colliders, walls, decor, indoor, cellarDoor, cellarDoorLeaf, dialGate, dialGateLeaf, whiteStones, viewpoint };
}
