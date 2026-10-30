import * as THREE from 'three';
import { S3_WORLD_FRAME } from '@/levels/s1/layout';

/**
 * S2 守灯人小屋白盒布局（v0.1-014）——**白盒为准**。美术 019 的 art/source/env/s2-layout.json 是按 014 文字推定的占位；
 * 本白盒直接采用了它的房屋 / 院子 / 地窖 / 崖顶坐标（误差 0），所以 019 的 7 个 GLB 不用改；之后两边冲突以这里为准。
 *
 * 坐标（S2 局部）：+Y 上、+Z 北、右手系 ⇒ 东 = −X、西 = +X。单位 m，地面 y = 0。
 *
 *   南石阶顶（入口，面朝北）→ 东侧石墙小院（南墙院门）/ 中央两层石屋（南墙正门）
 *   → 小院：东灯台 → 镜 A → 镜 B → 绕过屋角 → 北墙光感锁（谜题 3）→ 地窖门（北墙）
 *   → 二层西窗观察点 → 西侧坡地白石（谜题 4）→ 北侧拨盘铁门 → 崖径 → 出口去 S3
 *
 * 世界坐标（S2_WORLD_FRAME）：S2 局部绕 Y 转 120° 放进 S1 / S3 共用的世界坐标——
 * 入口（南石阶顶）落在 S1 出口 (−9.6, ·, 21) 的平面位置，S3 灯塔正好在小屋的西北（局部方位 ≈ 315°）。
 * 高度：S2 地面 = 世界 y 16（崖底 / 海面 = 局部 −16）；S1 出口崖顶是 5.2，中间是画面外的长石阶（遗留：S1 / S2 高度没接上，只影响远景对位）。
 */

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

const HOUSE = { x0: -6, x1: 2, z0: -2, z1: 4, wall: 0.6 } as const;

export const S2 = {
  /** 入口：南石阶顶，面朝北（迎面是石墙小院和小屋） */
  spawn: [0, 0, -12.5] as V3,
  stairsTop: [0, 0, -13.5] as V3,
  /** 南石阶（只做外观 + 挡回头路）：x −1…1，从 z −13.5 往南 12 级 × 0.2 */
  stairsSouth: { x: [-1, 1] as V2, zTop: -13.5, run: 0.38, rise: 0.2, count: 12 },
  /** 崖顶平台（顶面 0）+ 西侧坡地（x 8 → 25，每米降 0.0776）；崖底 = 海面（局部 −16） */
  platform: { x: [-17.5, 8] as V2, z: [-14, 12] as V2 },
  slope: { x: [8, 25] as V2, dropPerM: 0.0776 },
  seaY: -16,
  /** 北侧崖径（拨盘铁门之后） */
  northPath: { x: [1.5, 8.5] as V2, z: [12, 27] as V2, endZ: 25.5 },
  exitToS3: [5, 0, 23] as V3,

  house: {
    ...HOUSE,
    center: [-2, 0, 1] as V3,
    inner: { x0: HOUSE.x0 + HOUSE.wall, x1: HOUSE.x1 - HOUSE.wall, z0: HOUSE.z0 + HOUSE.wall, z1: HOUSE.z1 - HOUSE.wall },
    upperFloorY: 3.0,
    eave: 5.6,
    ridge: 8.3,
    ceiling: 6.9,
  },
  /** 洞口（世界坐标，a…b 是沿墙的 x 或 z 范围） */
  openings: {
    frontDoor: { wall: 'S', a: -4.6, b: -3.6, y0: 0, y1: 2.05 },
    winS2: { wall: 'S', a: -1.25, b: -0.45, y0: 4.0, y1: 5.0 },
    winW2: { wall: 'W', a: 0.55, b: 1.45, y0: 3.9, y1: 5.1 },
    winN1: { wall: 'N', a: -3.2, b: -2.4, y0: 1.0, y1: 2.0 },
    cellarDoor: { wall: 'N', a: 0.2, b: 1.05, y0: 0, y1: 1.85 },
    winE1: { wall: 'E', a: 2.2, b: 3.0, y0: 0.95, y1: 2.05 },
    winE2: { wall: 'E', a: -0.65, b: -0.05, y0: 3.95, y1: 4.65 },
  } as Record<string, { wall: 'S' | 'N' | 'E' | 'W'; a: number; b: number; y0: number; y1: number }>,
  /** 室内楼梯：16 级 × 0.1875，踏步 0.244，沿南墙由东（x −3.0）往西上，到顶 x 0.66 */
  stair: { x0: -3.0, count: 16, rise: 3.0 / 16, run: 0.244, z: [-1.4, -0.55] as V2 },
  /** 地窖楼梯间隔墙（一层进不去地窖，只能走北墙外地窖门） */
  well: { x0: 0.09, z1: -0.06 },
  /** 地窖（屋子西半部下方）：地面 −2.4；北门内平台 z 3.1…3.4，12 级 × 0.2 向南下到 z 0.35 */
  cellar: { x: [-2.6, 1.4] as V2, z: [-1.4, 3.4] as V2, floorY: -2.4, steps: 12, landingZ: 3.1, stepsX: [0.15, 1.4] as V2, bottomZ: 0.35 },
  /** 地窖门扇（019 env-cellar-door-s2：合页在原点，绕 +Y 负角开约 100°） */
  cellarDoor: { hinge: [0.985, 0, 3.86] as V3, openAngle: (-100 * Math.PI) / 180, width: 0.72, height: 1.77 },
  /** 光感锁（北墙外墙面，受光面中心 y = beamY 0.85；美术 019 socket 已于 2026-10-29 返工下移到 0.85） */
  lightLock: [-4.8, 0.85, 4.0] as V3,

  /** 室内家具（碰撞 + 交互位） */
  furniture: {
    table: { c: [-2.6, 0, 1.6] as V3, w: 1.3, d: 0.8, h: 0.75 },
    dresser: { x: [-5.0, -3.65] as V2, z: [2.94, 3.4] as V2, h: 2.05 },
    chimney: { x: [-5.4, -4.98] as V2, z: [0.35, 1.65] as V2 },
    bed: { x: [-4.9, -2.9] as V2, z: [2.45, 3.39] as V2, h: 0.6 },
    chest: { x: [-2.82, -2.36] as V2, z: [2.6, 3.32] as V2, h: 0.52 },
    /** 书桌（二层东墙）：桌面 3.75 */
    desk: { x: [-5.4, -4.8] as V2, z: [-0.85, 0.25] as V2, top: 3.75 },
    /** 地窖木架：架面离地窖地面 1.1 m（制作人裁定：钥匙架面约 1.1 m；019 占位钥匙在 0.965 m，美术需上移 ≈13.5 cm），背板到 1.8 */
    cellarShelf: { x: [-2.56, -2.14] as V2, z: [1.0, 2.2] as V2, h: 1.1, backH: 1.8 },
    cellarCrate: { c: [-1.9, -2.4, -0.85] as V3, w: 0.8, d: 0.6, h: 0.9 },
  },
  /** 交互 / socket 点（019 GLB 节点，世界坐标） */
  points: {
    lanternSocket: [-5.05, 3.75, -0.35] as V3,
    journalSocket: [-5.0, 3.75, 0.02] as V3,
    /** 汐的纸条（书桌面上，yaw 0.3）：白盒 xi-note-s2 / 027 prop-letter-c */
    xiNote: [-5.15, 3.75, -0.68] as V3,
    xiNoteYaw: 0.3,
    deskInteract: [-4.6, 3.0, -0.25] as V3,
    stove: [-5.135, 0, 1.0] as V3,
    cups: [-2.55, 0.75, 1.6] as V3,
    bed: [-3.9, 3.6, 2.15] as V3,
    westWindowInteract: [1.15, 4.4, 1.0] as V3,
    cellarKey: [-2.35, -1.3, 1.35] as V3,
    cellarSketch: [-2.35, -1.3, 1.8] as V3,
    /** 美术返工 2026-10-29（s2-layout.json points.cellarShelfInteract）：站在地窖地面上、面朝 −X，钥匙在正前 0.45、偏右 5 cm */
    cellarShelfInteract: [-1.9, -2.4, 1.4] as V3,
  },

  /** 东侧小院：石墙高 1.1、厚 0.5（向院内），南墙院门 x −9.6…−8.4，北墙西段 x −9.5…−6.25 敞开（镜 B → 光感锁的光路） */
  yard: { x: [-15, -6.25] as V2, z: [-8, 9.5] as V2, gate: [-9.6, -8.4] as V2, wallH: 1.1, wallT: 0.5, northGapX: -9.5 },
  /** 灯台（基座顶面 0，朝 +Z）。光束平面 0.85（制作人裁定 2026-10-29：提灯放在灯座上出光高度 0.846 m，不是 019 占位的 1.2） */
  lamps: { east: [-13.2, 0, -5] as V3, west: [-8.0, 0, -5] as V3 },
  beamY: 0.85,
  lampEmitY: 0.846,
  /** 晾衣架（挡西灯台光路，blocksLight） */
  rack: { at: [-8.15, 0, -2.5] as V3, halfX: 1.36, halfZ: 0.45, h: 2.03 },
  /** 立镜镜心（y = beamY） */
  mirrors: { a: [-13.2, 0.85, 3.0] as V3, b: [-7.2, 0.85, 8.6] as V3 },
  /** 北墙（z 11.5…12，高 1.2）+ 拨盘铁门洞 x 3.4…5.0 */
  northWall: { z: [11.5, 12] as V2, h: 1.2, gate: [3.4, 5.0] as V2 },
  /** 拨盘铁门（谜题 4）：合页在西门柱内侧，门扇关着挡住门洞，开 = 绕 +Y 转 78° 向北（1030b：美术 95° 门扇擦进西门柱 2.6 cm，90° 仍擦 1.5 cm；78° 门边框离柱面约 2 mm，合页筒本身嵌柱不算）；三个 36° 拨盘在门扇南面 y 1.15，从左（西）到右（东） */
  dialGate: { hinge: [5.0, 0, 11.75] as V3, width: 1.6, height: 1.9, openAngle: (78 * Math.PI) / 180, dialY: 1.15, dialX: [4.65, 4.2, 3.75] as readonly number[], code: [3, 1, 7] as readonly number[] },

  /** 谜题 4 观察点：二层西窗内（站位地面 = 眼睛 − 1.35），朝白石组，观察 FOV 30° */
  /**
   * 白石观察点（制作人裁定 16）：按住右键 = 固定第一人称眼位 eye、FOV fov（不随站位）；对准度 = 视线与 eye → lookAt 的夹角（fadeFromDeg 起渐显、≤ toleranceDeg 完成）；
   * 进入时视线朝西窗、水平偏开 enterOffsetDeg（不直接对准）
   */
  viewpoint: { eye: [0.95, 4.35, 1.0] as V3, lookAt: [18, 0.2, 1] as V3, fov: 30, toleranceDeg: 6, fadeFromDeg: 12, enterOffsetDeg: 15 },
  /** 白石组（白盒：分散白色方块；021 按观察点做透视拼合）。y = 坡面高度 */
  whiteStones: [
    [15.2, -0.563, -1.6],
    [16.6, -0.667, 2.8],
    [17.4, -0.684, 0.3],
    [18.6, -0.825, -2],
    [19.3, -0.875, 3.6],
    [20.4, -0.969, 1.2],
    [21.2, -1.028, -0.8],
    [15.8, -0.625, 4.1],
  ] as V3[],

  /** 美术 019 GLB 摆放（与 s2-layout.json 一致） */
  artNodes: {
    'env-clifftop-s2': { translation: [0, 0, 0], rotationY: 0 },
    'env-keeper-house-ch1': { translation: [-2, 0, 1], rotationY: 0 },
    'env-keeper-house-ch1-interior': { translation: [-2, 0, 1], rotationY: 0 },
    'env-cellar-s2': { translation: [-2, 0, 1], rotationY: 0 },
    'env-courtyard-wall-s2': { translation: [-10.625, 0, 0.75], rotationY: 0 },
    'env-laundry-rack': { translation: [-8.15, 0, -2.5], rotationY: 0 },
  } as Record<string, { translation: V3; rotationY: number }>,

  /** 建立镜头：院墙外东南 → 扫过院墙 → 小屋二层窗口 → 角色身后 */
  establishing: [
    { position: [-15.5, 3.2, -15] as V3, lookAt: [-9, 1.2, -4] as V3, fov: 45 },
    { position: [-9.5, 4.6, -10.5] as V3, lookAt: [-5.4, 4.2, 0.6] as V3, fov: 42 },
  ],
  /** 远景 S3 灯塔（天空层材质，不钉远平面：143 m 在视距内，塔基要被 −16 的海面正确遮住） */
  farLayer: { color: 0x10151a, fogDensity: 0.003 },
} as const;

/**
 * S2 局部 → 世界：world = origin + R_y(rotationY) · local（three.js rotation.y 约定）。
 * origin 由「入口 (0, 0, −12.5) 落在 S1 出口 (−9.6, ·, 21)」解出；rotationY = 120° 让 S3 灯塔在小屋西北。
 */
export const S2_WORLD_FRAME = (() => {
  const rotationY = (120 * Math.PI) / 180;
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const [sx, , sz] = S2.spawn;
  const exitS1: V2 = [-9.6, 21];
  const origin: V3 = [exitS1[0] - (sx * c + sz * s), 16, exitS1[1] - (-sx * s + sz * c)];
  return { rotationY, origin };
})();

export function s2ToWorld(p: V3): THREE.Vector3 {
  const { rotationY: r, origin: o } = S2_WORLD_FRAME;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return new THREE.Vector3(o[0] + p[0] * c + p[2] * s, o[1] + p[1], o[2] - p[0] * s + p[2] * c);
}

export function worldToS2(p: V3): THREE.Vector3 {
  const { rotationY: r, origin: o } = S2_WORLD_FRAME;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p[0] - o[0];
  const dz = p[2] - o[2];
  return new THREE.Vector3(dx * c - dz * s, p[1] - o[1], dx * s + dz * c);
}

/** S3 灯塔岛 / 塔在 S2 局部里的位置与朝向（远景） */
export const S2_FAR = {
  island: { position: worldToS2(S3_WORLD_FRAME.towerCenter), rotationY: S3_WORLD_FRAME.islandRotationY - S2_WORLD_FRAME.rotationY },
  tower: {
    position: worldToS2([S3_WORLD_FRAME.towerCenter[0], S3_WORLD_FRAME.socketY, S3_WORLD_FRAME.towerCenter[2]]),
    rotationY: S3_WORLD_FRAME.rotationY - S2_WORLD_FRAME.rotationY,
  },
};

export const v3 = (a: V3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

/** 坡地顶面高度（x ≥ 8 起每米降 dropPerM） */
/**
 * 制作人裁定 19：西窗外室外第三人称相机限高带。沿固定眼位 → 字组中心的视线（eye / target 由 puzzles 读白石 viewpoint 节点或 layout 兜底），
 * 从西外墙（house.x1）往外到视线降到 endY 处为止，横向 halfWidth，相机高度 ≤ 视线 − margin；带外 fade 平滑放开。
 */
export const S2_WEST_CAM_CAP = { margin: 1.3, halfWidth: 3, fade: 1.5, endY: 1.2 };
export function s2CameraHeightCaps(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) {
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  const L = Math.hypot(dx, dy, dz), hl = Math.hypot(dx, dz);
  if (L < 1e-6 || hl < 1e-6 || dx <= 0) return [];
  const dir = { x: dx / L, y: dy / L, z: dz / L };
  const slope = dy / hl;
  const from = (S2.house.x1 - eye.x) * (hl / dx);
  const to = slope < 0 ? (S2_WEST_CAM_CAP.endY - eye.y) / slope : S2.slope.x[1] - eye.x;
  return [{ origin: { ...eye }, dir, from, to: Math.max(from, to), halfWidth: S2_WEST_CAM_CAP.halfWidth, margin: S2_WEST_CAM_CAP.margin, fade: S2_WEST_CAM_CAP.fade }];
}

export function slopeY(x: number): number {
  return x <= S2.slope.x[0] ? 0 : -(x - S2.slope.x[0]) * S2.slope.dropPerM;
}

/** 观察点到最远白石的距离（验收 ≤ 25 m） */
export function farthestStoneDistance(): number {
  const e = v3(S2.viewpoint.eye);
  return Math.max(...S2.whiteStones.map((p) => e.distanceTo(v3(p))));
}
