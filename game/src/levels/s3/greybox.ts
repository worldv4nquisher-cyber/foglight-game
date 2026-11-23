import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S3, S3_FRAME, alongDoor, doorAxisYaw, polar, treadSpan, treadTop } from './layout';
import { tideCourtParapets } from './facility';

/**
 * S3 白盒几何（v0.1-015）：纯 three.js（不碰 DOM），场景、白盒导出（npm run export:blockout-s3）、verify-s3 共用。
 * 全部在 S3 局部坐标（塔心 = 原点）；场景把 root 挂到 S3_WORLD_FRAME 下。
 * 命名约定同 S1 / S2：`*-collider` = 碰撞体（白盒可见，挡光），`*-wall` = 空气墙（不可见、不挡光），`*-indoor` = 室内相机触发体。
 * 镜子、油阀、点火口、拉杆、潮钟等会动 / 有状态的件不在这里（beam.ts / puzzles.ts）；塔门门扇碰撞在这里，puzzles 控制开关。
 *
 * 塔壁 / 楼梯 / 灯室矮墙各合并成一个网格（一个 BVH），避免几百个小碰撞体。
 */
export interface S3Greybox {
  root: THREE.Group;
  colliders: THREE.Mesh[];
  walls: THREE.Mesh[];
  fixtureFallbacks: { mesh: THREE.Mesh; artKey: string }[];
  decor: THREE.Object3D[];
  indoor: THREE.Mesh[];
  /** 塔门（合页节点 = door-s3-hinge-socket；门扇碰撞是子网格） */
  door: THREE.Group;
  doorLeaf: THREE.Mesh;
  /** 底层地面（涨潮淹没：水深 1.4 → 送回） */
  groundFloor: THREE.Mesh;
  /** 云缝天光预演落点的挡光块（礁石上，玩家到不了） */
  skyBlocker: THREE.Mesh;
}

export interface S3GreyboxMaterials {
  stone: THREE.Material;
  rock: THREE.Material;
  wood: THREE.Material;
  metal: THREE.Material;
}

export function defaultS3GreyboxMaterials(): S3GreyboxMaterials {
  return {
    stone: new THREE.MeshStandardMaterial({ name: 'gb-stone', color: 0x7a7e80, roughness: 0.92 }),
    rock: new THREE.MeshStandardMaterial({ name: 'gb-rock', color: 0x4f5558, roughness: 0.96 }),
    wood: new THREE.MeshStandardMaterial({ name: 'gb-wood', color: 0x5e5246, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ name: 'gb-metal', color: 0x5f6b70, metalness: 0.6, roughness: 0.45 }),
  };
}

const DEG = Math.PI / 180;
const WALL_TOP = S3.lampRoom.floorY;
const RAIL_H = 1.1;

/** 环形扇块（r0…r1，θ0…θ1°，y0…y1）：盒子近似（切向宽取外径弦长，内侧重叠） */
function sectorBox(r0: number, r1: number, th0: number, th1: number, y0: number, y1: number): THREE.BufferGeometry {
  const mid = ((th0 + th1) / 2) * DEG;
  const half = ((th1 - th0) / 2) * DEG;
  const w = 2 * r1 * Math.tan(half) + 0.01;
  const g = new THREE.BoxGeometry(w, y1 - y0, r1 - r0);
  // 盒子局部 +Z = 径向朝外；放到 (r_mid, θ_mid)
  const rm = (r0 + r1) / 2;
  const m = new THREE.Matrix4().makeRotationY(Math.atan2(Math.cos(mid), Math.sin(mid)));
  m.setPosition(rm * Math.cos(mid), (y0 + y1) / 2, rm * Math.sin(mid));
  g.applyMatrix4(m);
  return g;
}

/** 两个角度（°）的最短差 */
const angDiff = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;

export function buildS3Greybox(mats: S3GreyboxMaterials = defaultS3GreyboxMaterials()): S3Greybox {
  const root = new THREE.Group();
  root.name = 'blockout-s3-lighthouse';
  const colliders: THREE.Mesh[] = [];
  const walls: THREE.Mesh[] = [];
  const fixtureFallbacks: S3Greybox['fixtureFallbacks'] = [];
  const decor: THREE.Object3D[] = [];
  const indoor: THREE.Mesh[] = [];
  const wallMat = new THREE.MeshBasicMaterial({ name: 'gb-wall', color: 0x6aa0c0, transparent: true, opacity: 0.12, depthWrite: false });

  const addMesh = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, kind: 'collider' | 'wall' = 'collider'): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, kind === 'wall' ? wallMat : mat);
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
  const merged = (name: string, geos: THREE.BufferGeometry[], mat: THREE.Material, kind: 'collider' | 'wall' = 'collider'): THREE.Mesh => {
    const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false);
    for (const x of geos) x.dispose();
    if (!g) throw new Error(`[s3] mergeGeometries failed: ${name}`);
    g.computeVertexNormals();
    return addMesh(name, g, mat, kind);
  };
  /** 门外平台 / 石桥坐标系里的盒子：s 沿门方向，t 横向 */
  const doorBox = (name: string, s0: number, s1: number, t0: number, t1: number, y0: number, y1: number, mat: THREE.Material, kind: 'collider' | 'wall' = 'collider'): THREE.Mesh => {
    const m = addMesh(name, new THREE.BoxGeometry(t1 - t0, y1 - y0, s1 - s0), mat, kind);
    const [x, , z] = alongDoor((s0 + s1) / 2, (t0 + t1) / 2, 0);
    m.position.set(x, (y0 + y1) / 2, z);
    m.rotation.y = doorAxisYaw;
    return m;
  };
  const addDecor = <T extends THREE.Object3D>(name: string, obj: T): T => {
    obj.name = name;
    obj.castShadow = obj.receiveShadow = true;
    decor.push(obj);
    root.add(obj);
    return obj;
  };

  // ======================================================== 塔壁（r 3–4，y 0–22）：2.5° 一片，门 / 西窗 / 楼梯窗挖空
  {
    const openings = [S3.door, S3.westWindow, ...S3.stairWindows];
    const geos: THREE.BufferGeometry[] = [];
    const step = 2.5;
    for (let th = 0; th < 360; th += step) {
      const c = th + step / 2;
      const cuts = openings
        .filter((o) => Math.abs(angDiff(c, o.th)) < ((o.w / 2 / S3.tower.rIn) * 180) / Math.PI)
        .map((o) => [o.y0, o.y1] as const)
        .sort((a, b) => a[0] - b[0]);
      let y = 0;
      for (const [a, b] of cuts) {
        if (a > y) geos.push(sectorBox(S3.tower.rIn, S3.tower.rBase, th, th + step, y, a));
        y = Math.max(y, b);
      }
      if (y < WALL_TOP) geos.push(sectorBox(S3.tower.rIn, S3.tower.rBase, th, th + step, y, WALL_TOP));
    }
    merged('s3-tower-wall', geos, mats.stone);
  }

  // ======================================================== 底层地面（0.2）+ 门口门槛
  const groundFloor = addMesh('s3-ground-floor', new THREE.CylinderGeometry(S3.tower.rIn + 0.05, S3.tower.rIn + 0.05, 0.5, 40), mats.stone);
  groundFloor.position.y = S3.groundFloorY - 0.25;
  // Solid furniture blocks movement, not the puzzle ray. Reuse the proxies when their art is missing.
  const fixture = (artKey: string, name: string, position: readonly [number, number, number], geometry: THREE.BufferGeometry, mat = mats.metal, yaw = 0) => {
    const m = addMesh(`s3-${name}`, geometry, mat, 'wall');
    m.material = mat;
    m.position.set(...position);
    m.rotation.y = yaw;
    fixtureFallbacks.push({ mesh: m, artKey });
  };
  const interiorArt = 'env-lighthouse-ch1-interior';
  const lampArt = 'env-lamp-room-ch1';
  fixture(interiorArt, 'oil-tank', polar(2.3, 40, 0.77), new THREE.CylinderGeometry(0.467, 0.467, 1.14, 24));
  fixture(interiorArt, 'oil-tank-lid', polar(2.3, 40, 1.395), new THREE.CylinderGeometry(0.39, 0.44, 0.11, 24));
  fixture(interiorArt, 'oil-crate-a', polar(2.45, 300, 0.45), new THREE.BoxGeometry(0.62, 0.5, 0.55), mats.wood, 0.4);
  fixture(interiorArt, 'oil-crate-b', polar(2.3, 318, 0.41), new THREE.BoxGeometry(0.5, 0.42, 0.45), mats.wood, 1.3);
  const [mx, , mz] = S3.mirrors.window.socket;
  fixture(interiorArt, 'window-mirror-seat', [mx, 0.56, mz], new THREE.BoxGeometry(0.62, 0.72, 0.72), mats.stone);
  fixture(interiorArt, 'window-mirror-cap', [mx, 0.96, mz], new THREE.BoxGeometry(0.7, 0.08, 0.8), mats.stone);
  {
    const [x, , z] = polar(3.5, S3.door.th, 0);
    const sill = addMesh('s3-door-sill', new THREE.BoxGeometry(1.2, S3.door.y0, 1.05), mats.stone);
    sill.position.set(x, S3.door.y0 / 2, z);
    sill.rotation.y = doorAxisYaw;
  }

  // ======================================================== 螺旋楼梯：踏步 1–10 实心（到地面），其余 0.3 厚板；平台按 span 分块
  {
    const [r0, r1] = S3.stair.r;
    const geos: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    for (let k = 1; k <= S3.stair.treads; k++) {
      const [a, b] = treadSpan(k);
      const top = treadTop(k);
      const bottom = k <= 10 ? 0 : top - 0.3;
      const n = Math.max(1, Math.ceil((b - a) / 6 - 1e-6));
      for (let i = 0; i < n; i++) {
        const t0 = a + ((b - a) * i) / n;
        const t1 = a + ((b - a) * (i + 1)) / n;
        geos.push(sectorBox(r0, r1, t0, t1, bottom, top));
        // 内侧栏杆（空气墙）：从门内平台往上（踏步 ≥ 5：底层几级矮，不需要）
        if (k >= 5) rails.push(sectorBox(r0 - 0.08, r0, t0, t1, top, top + RAIL_H));
      }
    }
    merged('s3-stair', geos, mats.stone);
    merged('s3-stair-rail', rails, mats.stone, 'wall');
    // 栏杆外观（细扶手，不碰撞）
    const handrail: THREE.BufferGeometry[] = [];
    for (let k = 5; k <= S3.stair.treads; k++) {
      const [a, b] = treadSpan(k);
      const n = Math.max(1, Math.ceil((b - a) / 6 - 1e-6));
      for (let i = 0; i < n; i++) handrail.push(sectorBox(r0 - 0.06, r0 - 0.01, a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n, treadTop(k) + 0.95, treadTop(k) + 1.0));
    }
    const hr = mergeGeometries(handrail.map((x) => x.toNonIndexed()), false);
    if (hr) addDecor('s3-stair-handrail', new THREE.Mesh(hr, mats.wood));
  }
  // 5 m 窗台平台的旧凳子
  {
    const p = S3.points.stool5m;
    const yaw = -331 * DEG + 0.35;
    // Inset the vertical proxy inside the rounded seat edge to retain capsule clearance along the rail.
    fixture(interiorArt, 'window-stool', [p[0], p[1] + 0.22375, p[2]], new THREE.BoxGeometry(0.29, 0.4475, 0.26), mats.wood, yaw);
  }

  // ======================================================== 灯室：地板（22，楼梯口 θ110–182 + 中心点火口挖空）、矮墙、玻璃空气墙、穹顶
  const L = S3.lampRoom;
  {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, S3.tower.rIn + 0.3, 0, Math.PI * 2, false);
    // ExtrudeGeometry 在 XY 平面，绕 X 转 −90° 后 shape y → 世界 −z：所以 y_s = −r sinθ
    const port = new THREE.Path();
    port.absarc(0, 0, 0.3, 0, Math.PI * 2, true);
    shape.holes.push(port);
    const hatch = new THREE.Path();
    const [h0, h1] = S3.stair.hatchDeg;
    const pt = (r: number, th: number): [number, number] => [r * Math.cos(th * DEG), -r * Math.sin(th * DEG)];
    hatch.moveTo(...pt(S3.stair.r[0] - 0.02, h0));
    for (let th = h0; th <= h1; th += 4) hatch.lineTo(...pt(S3.stair.r[0] - 0.02, th));
    for (let th = h1; th >= h0; th -= 4) hatch.lineTo(...pt(S3.stair.r[1] + 0.02, th));
    hatch.closePath();
    shape.holes.push(hatch);
    const g = new THREE.ExtrudeGeometry(shape, { depth: L.slab, bevelEnabled: false, curveSegments: 40 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, L.floorY - L.slab, 0);
    addMesh('s3-lamp-floor', g, mats.stone);
    // 楼梯口：θ110 那一侧的挡板（从灯室地面看是个洞，空气墙挡住；θ182 一侧是楼梯上来的口子）
    const [r0, r1] = S3.stair.r;
    addMesh('s3-hatch-end', sectorBox(r0, r1, h0 - 1.5, h0, L.floorY - 0.1, L.floorY + RAIL_H), mats.stone, 'wall');
    addMesh('s3-hatch-inner', sectorBox(r0 - 0.08, r0, h0, h1, L.floorY - 0.1, L.floorY + RAIL_H), mats.stone, 'wall');
    // 矮墙（r 3–3.4，22–22.7）+ 玻璃（空气墙到 24.3）
    const para: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    for (let th = 0; th < 360; th += 5) {
      para.push(sectorBox(S3.tower.rIn, S3.tower.rIn + 0.4, th, th + 5, L.floorY - L.slab, L.floorY + L.parapetH));
      glass.push(sectorBox(S3.tower.rIn, S3.tower.rIn + 0.1, th, th + 5, L.floorY + L.parapetH, L.floorY + L.glassTop));
    }
    merged('s3-lamp-parapet', para, mats.stone);
    merged('s3-lamp-glass', glass, mats.stone, 'wall');
    const dome = addDecor('s3-lamp-dome', new THREE.Mesh(new THREE.ConeGeometry(S3.tower.rIn + 0.4, S3.tower.height - L.floorY - L.glassTop, 24, 1, true), mats.metal));
    dome.position.y = L.floorY + L.glassTop + (S3.tower.height - L.floorY - L.glassTop) / 2;
    (dome.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    // 透镜底座（碰撞：挡住中心点火口，光从下面进点火口不受影响）
    const ped = addMesh('s3-lens-pedestal', new THREE.CylinderGeometry(0.5, 0.55, 0.6, 20), mats.metal);
    ped.position.y = L.floorY + 0.3;
    fixture(lampArt, 'lens-foot', [0, L.floorY + 0.03, 0], new THREE.CylinderGeometry(0.62, 0.62, 0.06, 32));
    // 灯室书桌 + 椅子（碰撞）
    const f = S3.points;
    // 高度跟美术（035：座 0.40 / 桌 0.68，layout.lampRoom.seatTop / deskTop）
    const desk = addMesh('s3-lamp-desk', new THREE.BoxGeometry(0.9, L.deskTop, 0.5), mats.wood);
    desk.position.set(f.deskCenter[0], L.floorY + L.deskTop / 2, f.deskCenter[2]);
    desk.rotation.y = -Math.PI / 4;
    const chair = addMesh('s3-lamp-chair', new THREE.BoxGeometry(0.42, L.seatTop, 0.4), mats.wood);
    chair.position.set(f.sitWrite[0], L.floorY + L.seatTop / 2, f.sitWrite[2]);
    chair.rotation.y = desk.rotation.y;
    const [cx, , cz] = f.sitWrite;
    const chairBack = new THREE.Vector3(0, L.floorY + L.seatTop + 0.18, 0.17).applyAxisAngle(new THREE.Vector3(0, 1, 0), chair.rotation.y);
    fixture(lampArt, 'lamp-chair-back', [cx + chairBack.x, chairBack.y, cz + chairBack.z], new THREE.BoxGeometry(0.4, 0.36, 0.042), mats.wood, chair.rotation.y);
  }

  // ======================================================== 门外平台（2.4）、3 级台阶、石桥（3.0）、空气墙
  {
    const P = S3.doorPlatform;
    doorBox('s3-door-platform', P.s[0], P.s[1], P.t[0], P.t[1], 0, P.top, mats.rock);
    const st = S3.steps;
    const run = (st.s[1] - st.s[0]) / st.count;
    for (let i = 0; i < st.count; i++) doorBox(`s3-step-${i + 1}`, st.s[0] + run * i, st.s[0] + run * (i + 1), -S3.bridge.w / 2, S3.bridge.w / 2, 0, P.top + st.rise * (i + 1), mats.stone);
    const B = S3.bridge;
    const sEnd = B.s[1];
    const hw = B.w / 2;
    doorBox('s3-bridge-deck', B.s[0], sEnd, -hw - B.parapetW, hw + B.parapetW, B.deck - 0.6, B.deck, mats.stone);
    for (const side of [-1, 1]) {
      const t0 = side > 0 ? hw : -hw - B.parapetW;
      doorBox(`s3-bridge-parapet-${side > 0 ? 'r' : 'l'}`, B.s[0], sEnd, t0, t0 + B.parapetW, B.deck, B.deck + B.parapetH, mats.stone);
      doorBox(`s3-bridge-air-${side > 0 ? 'r' : 'l'}`, B.s[0] - 0.9, sEnd, side > 0 ? hw - 0.02 : -hw - 0.03, side > 0 ? hw + 0.03 : -hw + 0.02, B.deck, B.deck + B.airWallH, mats.stone, 'wall');
      // 平台两侧 / 前沿（台阶口除外）/ 靠塔一侧（门洞除外）
      doorBox(`s3-platform-air-side-${side}`, P.s[0], P.s[1], side > 0 ? P.t[1] - 0.05 : P.t[0], side > 0 ? P.t[1] : P.t[0] + 0.05, P.top, P.top + B.airWallH, mats.stone, 'wall');
      doorBox(`s3-platform-air-front-${side}`, P.s[1] - 0.05, P.s[1], side > 0 ? hw : P.t[0], side > 0 ? P.t[1] : -hw, P.top, P.top + B.airWallH, mats.stone, 'wall');
      doorBox(`s3-platform-air-back-${side}`, P.s[0], P.s[0] + 0.05, side > 0 ? 1.2 : P.t[0], side > 0 ? P.t[1] : -1.2, P.top, P.top + B.airWallH, mats.stone, 'wall');
    }
    doorBox('s3-bridge-air-end', sEnd - 0.05, sEnd, -hw - 0.1, hw + 0.1, B.deck, B.deck + B.airWallH, mats.stone, 'wall');
    for (const { name, at, size, yaw } of tideCourtParapets) {
      const parapet = addMesh(name, new THREE.BoxGeometry(...size), mats.stone);
      parapet.position.set(...at);
      parapet.rotation.y = yaw;
    }
    for (const s of B.piers) {
      const pier = addDecor(`s3-bridge-pier-${s}`, new THREE.Mesh(new THREE.BoxGeometry(2.2, B.deck - 0.6 + 2, 1.2), mats.stone));
      const [x, , z] = alongDoor(s, 0, 0);
      pier.position.set(x, (B.deck - 0.6 - 2) / 2, z);
      pier.rotation.y = doorAxisYaw;
    }
  }

  // ======================================================== 礁岛外观（低于平台；不碰撞，玩家到不了）+ 云缝天光落点挡光块
  const islet = addDecor('s3-rock-islet', new THREE.Mesh(new THREE.CylinderGeometry(8.5, 11, 2.2, 18), mats.rock));
  islet.position.set(-1, -0.2, -1);
  const sb = S3.points.skyPreviewTarget;
  const skyBlocker = addMesh('s3-sky-preview-rock', new THREE.BoxGeometry(0.8, 0.4, 0.8), mats.rock);
  skyBlocker.position.set(sb[0], sb[1] - 0.2, sb[2]);

  // ======================================================== 塔门：合页节点（door-s3-hinge-socket），门扇沿局部 +X（把手在 +X 0.92）
  const D = S3.door;
  const door = new THREE.Group();
  door.name = 'door-s3';
  door.position.set(...D.hinge);
  door.rotation.y = D.hingeRotY;
  root.add(door);
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(D.w, D.y1 - D.y0, 0.08), mats.wood);
  doorLeaf.name = 'door-s3-leaf-collider';
  doorLeaf.position.set(D.w / 2, (D.y1 - D.y0) / 2, 0);
  doorLeaf.castShadow = doorLeaf.receiveShadow = true;
  door.add(doorLeaf);
  colliders.push(doorLeaf);

  // ======================================================== 室内相机触发体（塔内 y 0–24.5）
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(5.6, 24.5, 5.6), wallMat);
    m.name = 's3-tower-indoor';
    m.position.y = 12.25;
    // 场景根节点绕 Y 135°：这里转 −135° 让它在世界里轴对齐（collectIndoorVolumes 取世界 AABB）
    m.rotation.y = -S3_FRAME.rotationY;
    // BUG-020：雨丝剔除按内壁圆柱（layout rIn），相机室内判定仍用这个方盒的世界 AABB
    m.userData.indoorRadius = S3.tower.rIn;
    m.visible = false;
    root.add(m);
    indoor.push(m);
  }

  root.updateMatrixWorld(true);
  return { root, colliders, walls, fixtureFallbacks, decor, indoor, door, doorLeaf, groundFloor, skyBlocker };
}

export function setS3FixtureFallbacks(greybox: S3Greybox, artRoot: THREE.Group, showGreybox: boolean): void {
  for (const { mesh, artKey } of greybox.fixtureFallbacks) {
    mesh.visible = showGreybox || !artRoot.getObjectByName(artKey);
  }
}
