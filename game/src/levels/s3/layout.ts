import * as THREE from 'three';
import { S3_WORLD_FRAME } from '@/levels/s1/layout';

/**
 * S3 初望灯塔白盒布局（v0.1-015）。坐标全部取自美术 020 rework-1029：art/source/env/s3-layout.json + 各 GLB 的空节点
 * （scripts/verify-s3.mjs 逐项比对 layout ↔ json ↔ GLB 节点，误差 ≤ 5 cm）。
 *
 * S3 局部坐标：塔中心 = 原点，y 0 = 退潮海面，+Y 上、+Z 北、西 = +X、东 = −X；θ 从 +X 逆时针（90 北 / 180 东 / 270 南）。
 * 世界坐标：S3 根节点 = S3_WORLD_FRAME（塔心 (39.73, 0, −122.75)，绕 Y 135°），局部 θ225 的塔门 / 石桥朝世界北（S1 岸）。
 * 高度：塔基局部 y 0 / 低潮 0 / 涨潮 1.6；S1 远景塔座顶 6.6 是远景摆位（不是同一套潮位，见 s3-layout.json worldFrame.towerBaseY），两处不混用。
 *
 *   石桥（桥面 3.0，s 8.5–33）→ 3 级台阶 → 门外平台（2.4，潮钟 + 送回点）→ 塔门（θ225）→ 门内平台（踏步 11，2.4）
 *   → 底层机房（地面 0.2，涨潮水深 1.4：油阀 θ70 / 西窗窗口镜 θ0）→ 螺旋楼梯 108 级（r 2–3，0.2 m × 6°）
 *   → 5 m 窗台平台（踏步 24）→ 10 m 平台 A（踏步 49，导光镜 1）→ 16 m 平台 B（踏步 79，导光镜 2）→ 22 m 灯室（楼梯口 θ110–182）
 */

type V3 = readonly [number, number, number];

const DEG = Math.PI / 180;
/** 极坐标 → S3 局部（θ°，从 +X 逆时针） */
export const polar = (r: number, thDeg: number, y: number): [number, number, number] => [r * Math.cos(thDeg * DEG), y, r * Math.sin(thDeg * DEG)];

export const S3 = {
  tower: { rBase: 4, rTop: 3.5, rIn: 3, height: 25 },
  tide: { low: 0, high: 1.6 },
  groundFloorY: 0.2,
  door: { th: 225, w: 1.1, y0: 2.4, y1: 4.6, hinge: [-2.6304, 2.4, -1.8668] as V3, hingeRotY: -5.497787, openDeg: -100 },
  westWindow: { th: 0, w: 0.8, y0: 1, y1: 2.2 },
  /** 楼梯小窗（k = 所在踏步；第一扇是 5 m 平台的大窗） */
  stairWindows: [
    { th: 320, w: 0.8, y0: 5.9, y1: 7.4, k: 24 },
    { th: 59, w: 0.45, y0: 8.75, y1: 9.55, k: 38 },
    { th: 245, w: 0.45, y0: 13.95, y1: 14.75, k: 64 },
    { th: 83, w: 0.45, y0: 19.55, y1: 20.35, k: 92 },
    { th: 140, w: 0.5, y0: 11, y1: 11.9, k: 49 },
    { th: 350, w: 0.5, y0: 17, y1: 17.9, k: 79 },
  ],
  stair: {
    r: [2, 3] as const,
    rise: 0.2,
    degPerTread: 6,
    treads: 108,
    firstTreadDeg: 152,
    /** 平台踏步（踏步 k 的面高 = 0.2 + 0.2k）：门内 / 5 m 窗台 / A / B */
    landings: { door: { tread: 11, span: [212, 238] }, window5m: { tread: 24, span: [310, 338] }, A: { tread: 49, span: [482, 518] }, B: { tread: 79, span: [692, 728] } },
    hatchDeg: [110, 182] as const,
  },
  /**
   * 灯室：seatTop / deskTop = 椅子座面 / 桌面离地（035 美术降低：0.45 → 0.40 / 0.75 → 0.68）。
   * 与 env-lamp-room-ch1.glb 节点 lamp-room-sit-write extras、char-xi-anims xi-sit-write extras.align.sitWrite 同值（verify-s3 校验）
   */
  lampRoom: { floorY: 22, slab: 0.25, parapetH: 0.7, glassTop: 2.3, portHoleR: 0.22, seatTop: 0.4, deskTop: 0.68 },
  /** 门外平台（沿门的方向 θ225：s = 离塔心距离，t = 横向）；石桥（GLB axis：s 8.5 → 33.0） */
  doorPlatform: { s: [3.3, 7.6] as const, t: [-2.4, 2.4] as const, top: 2.4 },
  steps: { s: [7.6, 8.5] as const, rise: 0.2, count: 3 },
  bridge: { s: [8.5, 33.0] as const, w: 1.5, deck: 3, parapetW: 0.3, parapetH: 0.5, airWallH: 1.5, piers: [14, 19.5, 25] },

  points: {
    spawnFromS2: [-22.627, 3, -22.627] as V3,
    bridgeExit: [-23.264, 3, -23.264] as V3,
    bridgeHead: [-6.0104, 3, -6.0104] as V3,
    respawn: [-4.526, 2.4, -3.677] as V3,
    /** 送回点朝向：+Z = (0.776, 0, 0.631) */
    respawnFacing: [0.776, 0, 0.631] as V3,
    doorPlatformCenter: [-4.207, 2.4, -4.207] as V3,
    bellSocket: [-2.758, 2.4, -5.162] as V3,
    bellInteract: [-3.451, 2.4, -4.469] as V3,
    bellContact: [-2.913, 3.5, -4.95] as V3,
    oilValve: [0.992, 0.9, 2.725] as V3,
    logbookRead: [-2.517, 3.38, -1.227] as V3,
    lookUp: [0, 1.6, 0] as V3,
    stairBottom: [-2.12, 0.2, 1.325] as V3,
    doorLanding: [-1.768, 2.4, -1.768] as V3,
    platformA: [-1.915, 10, 1.607] as V3,
    platformB: [2.462, 16, -0.434] as V3,
    stairTop: [-2.498, 21.8, 0.087] as V3,
    view5m: [1.877, 5, -1.575] as V3,
    stool5m: polar(2.68, 331, 5),
    lampRoomArrive: [-2.462, 22, -0.434] as V3,
    ignitionPort: [0, 21.85, 0] as V3,
    lensSocket: [0, 22.85, 0] as V3,
    lampLightOrigin: [0, 23.55, 0] as V3,
    noteRead: [-0.941, 22.03, 0.132] as V3,
    sitWrite: [1.57, 22, -1.57] as V3,
    /** 桌面上的日志 / 风灯 socket：y = floorY + deskTop（运行时优先读 GLB 节点 lamp-room-journal-socket / -lantern-socket） */
    journal: [1.839, 22.68, -1.839] as V3,
    lantern: [1.655, 22.68, -2.079] as V3,
    deskCenter: [1.902, 22, -1.902] as V3,
    standGaze: [0.43, 22, 2.514] as V3,
    standGazeFacing: [0.168, 0, 0.986] as V3,
    skyPreviewTarget: [7.2, 0.908, 1.2] as V3,
    /** 美术 sky-beam-emitter 占位 (40, 30, 2) → west-window-outer：与 lightpath-0 → 窗口镜的方向不一致（见 verify-s3），光源用 lightpath-0 */
    artSkyEmitter: [40, 30, 2] as V3,
  },
  /** 光路（lightpath-0…4）：云缝天光入口 → 窗口镜 → 导光镜 1 → 导光镜 2 → 点火口 */
  lightPath: [
    [9.5, 4.6, 0.6],
    [2.35, 1.35, 0],
    [-0.9958577760546713, 10.6, 0.8356238925925014],
    [1.2802500789158704, 16.6, -0.2257426309670095],
    [0, 21.85, 0],
  ] as readonly V3[],
  mirrors: {
    window: { id: 'guide-mirror-s3-window', socket: [2.35, 1, 0] as V3, center: [2.35, 1.35, 0] as V3, seatTop: 1, artCam: [0.2, 2.5, -1.4] as V3 },
    a: { id: 'guide-mirror-s3-mid-a', socket: [-0.996, 10.6, 0.836] as V3, center: [-0.9958577760546713, 10.6, 0.8356238925925014] as V3, fixedPitchDeg: -1.1, artYawDeg: -19.777, platformY: 10, artCam: [-2.377, 11.6, 0.334] as V3 },
    b: { id: 'guide-mirror-s3-mid-b', socket: [1.28, 16.6, -0.226] as V3, center: [1.2802500789158704, 16.6, -0.2257426309670095] as V3, fixedPitchDeg: 4.4, artYawDeg: 160.755, platformY: 16, artCam: [1.784, 17.6, -1.606] as V3 },
  },
  /** 策划按新坐标算的法线（竖轴角从 +X 往 +Z 量）：窗口镜 15.8° / 66.3°；导光镜 1 −19.8° / −1.1°；导光镜 2 160.7° / +4.4° */
  plannedNormals: { window: { yaw: 15.8, pitch: 66.3 }, a: { yaw: -19.8, pitch: -1.1 }, b: { yaw: 160.7, pitch: 4.4 } },
  igniteLever: { interact: [1.45, 22, -0.15] as V3, facing: [-1, 0, 0] as V3, pivot: [0.9, 22.74, 0] as V3, gripRest: [1.05, 23, 0] as V3, gripPulled: [1.2, 22.74, 0] as V3, len: 0.3, pullDeg: -60 },
  /** 远处灯塔剪影（结尾才出现；5 m 窗要背开）：S3 局部 */
  silhouettes: { F1: [152.58, -0.5, 129.06] as V3, F2: [30.11, -0.5, 176.01] as V3 },
} as const;

/** 踏步 k（1…108）的起始角（°，未取模）：平台踏步占 span，其余 6° */
export function treadSpan(k: number): [number, number] {
  const st = S3.stair;
  let a = st.firstTreadDeg;
  for (let i = 1; i < k; i++) a += landingSpan(i) ?? st.degPerTread;
  return [a, a + (landingSpan(k) ?? st.degPerTread)];
}
function landingSpan(k: number): number | null {
  for (const l of Object.values(S3.stair.landings)) if (l.tread === k) return l.span[1] - l.span[0];
  return null;
}
export const treadTop = (k: number): number => S3.groundFloorY + S3.stair.rise * k;
export const isLandingTread = (k: number): boolean => landingSpan(k) !== null;

/** 门外平台 / 石桥的 (s, t) → S3 局部：s 沿 θ225（塔心 → 门 → 桥），t 横向（右手：u × up） */
const U = new THREE.Vector2(Math.cos(225 * DEG), Math.sin(225 * DEG));
const T = new THREE.Vector2(-U.y, U.x);
export const alongDoor = (s: number, t: number, y: number): [number, number, number] => [U.x * s + T.x * t, y, U.y * s + T.y * t];
export const doorAxisYaw = Math.atan2(U.x, U.y);

// ---------------------------------------------------------------- 世界坐标

export const S3_FRAME = { position: S3_WORLD_FRAME.towerCenter, rotationY: S3_WORLD_FRAME.rotationY } as const;
export function lampRoomFramingWeight(position: THREE.Vector3): number {
  const [x, , z] = S3_FRAME.position;
  if (Math.hypot(position.x - x, position.z - z) >= S3.tower.rIn) return 0;
  return THREE.MathUtils.smoothstep(position.y, treadTop(S3.stair.treads - 2), treadTop(S3.stair.treads));
}
const cosR = Math.cos(S3_FRAME.rotationY);
const sinR = Math.sin(S3_FRAME.rotationY);
/** S3 局部 → 世界（three.js R_y：x' = x cos + z sin，z' = −x sin + z cos） */
export function toWorld(p: readonly [number, number, number] | THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  const [x, y, z] = p instanceof THREE.Vector3 ? [p.x, p.y, p.z] : p;
  return out.set(x * cosR + z * sinR + S3_FRAME.position[0], y + S3_FRAME.position[1], -x * sinR + z * cosR + S3_FRAME.position[2]);
}
/** 世界 → S3 局部 */
export function toLocal(p: { x: number; y: number; z: number }, out = new THREE.Vector3()): THREE.Vector3 {
  const x = p.x - S3_FRAME.position[0];
  const z = p.z - S3_FRAME.position[2];
  return out.set(x * cosR - z * sinR, p.y - S3_FRAME.position[1], x * sinR + z * cosR);
}
/** 局部方向 → 世界 yaw（CameraFollowSystem 约定：forward = (−sin, 0, −cos)） */
export function cameraYawFacing(localDir: readonly [number, number, number]): number {
  const w = new THREE.Vector3(localDir[0], 0, localDir[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), S3_FRAME.rotationY);
  return Math.atan2(-w.x, -w.z);
}

export const v3 = (a: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
