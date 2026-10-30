import * as THREE from 'three';
import { stepAcrossSpan, type StepAcrossSpan } from '@/entities/xi/clips';

/**
 * S1 落潮滩白盒布局（v0.1-013）。018 返工 1029 后美术 `art/source/env/s1-layout.json` 已按这里对位；
 * **对位之后两边再不一致时以 s1-layout.json 为准**（制作人 1029 裁定），这里的美术摆放 / 关键点都是它的拷贝，
 * `scripts/verify-render.mjs`「S1 布局 = s1-layout.json」逐项比对（含 GLB 里的系船 / 船头环节点），改了任一边没跟上就会失败。
 *
 * 坐标：+Y 上、+Z 北、右手系 ⇒ 东 = −X、西 = +X（海在西 / 南，远景主岛在西南偏南）。单位 m，y = 世界高度。
 * 潮位：low 0、high 1.6（开场涨潮）。
 *
 *   码头（西南，朝海）→ 岸台 / 潮汐钟（东）→ 礁石小径（退潮，谜题 1）→ 浮台沟（北，谜题 2）→ 远侧台阶 → 崖顶出口（去 S2）
 *                     ↘ 礁脊（高潮安全路线，岸台北沿 → 近岸平台）
 */

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

export const S1 = {
  tide: { low: 0, high: 1.6 },
  sandY: 0.1,
  /** 码头：中点 / 朝向（局部 +Z 指向陆地 = 东偏北）/ 甲板顶面 */
  pier: { mid: [-3.39, -9.8] as V2, rotationY: -1.23594, landEnd: [-10, -7.5] as V2, seaEnd: [3.22, -12.1] as V2, deckY: 2.2, width: 2.5, length: 14 },
  /** 起点：码头尽头，面朝陆地（controller facing = −1.236：(sin, cos) = (−0.944, 0.329)） */
  spawnStart: [2.277, 2.2, -11.772] as V3,
  /** 岸台（潮汐钟平台）顶面 2.4 */
  ledge: { min: [-19, -10.5] as V2, max: [-10, -2] as V2, topY: 2.4 },
  /** 汐敲钟站位离钟轴（m）= 021 prop-tide-bell-interact 的 z 0.98（美术挂上后直接读该节点） */
  bellStandDist: 0.98,
  bellAnchor: [-15.5, 2.4, -6.2] as V3,
  /** 潮汐安全点（送回点）：岸台北侧，面朝礁石小径（+X 西） */
  safePoint: [-12.5, 2.4, -4] as V3,
  safeFacing: Math.PI / 2,
  /** 潮汐钟机位（-cam：同时看到钟和礁石小径） */
  bellCam: [-18.2, 6.4, -12.6] as V3,
  /** 岸台 → 礁石小径的台阶（11 级 × 0.2 m，x −10 → −6.48，z −3.8…−2.2；顶上一道 walkableWhen=low 的空气墙） */
  reefStairs: { x0: -10, run: 0.32, rise: 0.2, count: 11, z: [-3.8, -2.2] as V2 },
  /** 礁石小径（谜题 1）：6 块礁石的中心与顶面高度（退潮可走） */
  reefPath: [
    [-5.9, 0.42, -3],
    [-4.5, 0.5, -1.9],
    [-3.2, 0.38, -0.7],
    [-2, 0.55, 0.5],
    [-0.8, 0.45, 1.6],
    [0.4, 0.36, 2.6],
  ] as readonly V3[],
  reefPathWidth: 1.4,
  /** 小径尽头（踩到 = 谜题 1 解开） */
  reefPathEnd: [1.8, 0.1, 3.4] as V3,
  reefPathEndRadius: 1.3,
  /** 礁脊（高潮安全路线）：岸台北沿 → 近岸平台，顶面逐段下降 */
  ridge: [
    [-12, 2.35, -2.2],
    [-11, 2.25, 0.5],
    [-9, 2.1, 3],
    [-6.5, 1.95, 5.4],
    [-4.4, 1.85, 6.6],
  ] as readonly V3[],
  ridgeWidth: 1.6,
  /** 近岸平台（浮台沟南侧）顶面 1.85 */
  nearPlatform: { min: [-4.6, 5.6] as V2, max: [0.6, 8.5] as V2, topY: 1.85 },
  /** 浮台沟：z 8.5–12.5；石槽轨道 x ≥ −1.9 沟底 0.1（沙），以东 −0.5 */
  channel: { z: [8.5, 12.5] as V2, trackMinX: -1.9, deepFloorY: -0.5 },
  /** 浮台（2.0 × 3.0，厚 0.3）：搁浅甲板顶 0.4，涨潮在石槽里浮到 1.85（与近岸平台、远侧最低台阶齐平） */
  raft: { home: [9.1, 0.4, 10.5] as V3, slot: [-0.9, 0.4, 10.5] as V3, size: [2.0, 0.3, 3.0] as V3, floatOffset: 0.25 },
  /** 石槽（锚位）：x −1.9…0.1、z 9–12 */
  stoneSlot: { min: [-1.9, 9] as V2, max: [0.1, 12] as V2 },
  /** 跨越点（近岸平台北沿 / 远侧台阶南沿；中间浮台） */
  linkNear: [-0.9, 1.85, 8.5] as V3,
  linkFar: [-0.9, 1.85, 12.5] as V3,
  /** 远侧台阶：平台 z 12.5–13.5（1.85），往北 18 级 × 0.17 m（踏步 0.3333）到 4.91，再一步上崖顶 5.2 */
  farSteps: { x: [-2.4, 0.6] as V2, z0: 12.5, landing: 1.0, count: 18, rise: 0.17, run: 1 / 3, baseY: 1.85 },
  /** 远侧台阶触发（谜题 2 解开：站上远侧最低台阶） */
  farTrigger: { min: [-2.4, 1.7, 12.5] as V3, max: [0.6, 3, 13.6] as V3 },
  plateau: { min: [-12, 19.5] as V2, max: [0.6, 23.5] as V2, topY: 5.2 },
  exitToS2: [-9.6, 5.2, 21] as V3,
  /** 可走区外框（永久空气墙）：东 x = −19.5、西 x = 15.6（渔具棚 / 晾网架在雾里，不可进入）、南 z = −18 */
  bounds: { minX: -19.5, maxX: 15.6, minZ: -18 },
  fishShed: [18.73, 0, 1.46] as V3,
  netRacks: [
    [16.25, 0, -2.25],
    [17.31, 0, 8.13],
  ] as readonly V3[],
  /**
   * 小船（返工 1029：系在码头尽头 +X 系船桩上，船头朝桩；s1-layout.json nodes['prop-boat-rowboat']）。
   * y = 水位 − 0.24；此处海床 −0.44，退潮 0 时仍浮在 −0.24（groundY 只是下限）。
   * bowRing = 涨潮时船头环世界位置 = 码头节点 env-pier-wood-ch1-rope-bow-end（船绳端点）；mooring = 码头节点 -boat-mooring 世界位置。
   * 座位 / 桨架（-seat / -oarlock-l/r）归 017 动画接入，这里不用。
   */
  boat: { position: [5.508, 1.36, -10.757] as V3, rotationY: -1.70407, belowWater: 0.24, groundY: -0.24, seabedY: -0.44, bowRing: [4.071, 1.98, -10.95] as V3, mooring: [3.26, 2.2, -11.39] as V3,
    /** 船体（GLB extras beamM / lengthM、包围盒顶 0.80、船长中心局部 z +0.028）：白盒在退潮船位放一块挡板，退潮走过去不穿船 */
    hull: { beam: 1.2, length: 3.06, centerZ: 0.028, topY: 0.8 } },
  /**
   * 退潮深水区（制作人 1029 裁定）：码头尽头 / 小船一带美术海床（env-tidal-flat-s1）比白盒滩地 0.1 低得多（小船处 −0.44，旧船位 −0.62），
   * 退潮也有水。多边形 = 美术海床 < −0.3（= 送回水深 gameplay.tide.recallDepth）的连续区域（从南边界往北扫描，0.5 m 一列取边界），
   * 东段（x < −10）在岸台下方的部分取 −11.25，西段（x > 12.5）随西侧乱石岸抬高收窄。区域内脚踩滩地层（≤ maxFootY）时按 floorY 算送回水深：
   * 走进去 = 现有送回安全点流程（黑场 + 「水太冷了。」）。碰撞不变。码头甲板 / 岸台 / 礁石小径 / 台阶都在区外或高于 maxFootY。
   * scripts/verify-render.mjs「S1 深水区 = 美术海床」用 GLB 采样比对。
   */
  deepWater: {
    polygon: [
      [-19.6, -18.1], [-19.6, -11.25], [-10.5, -11.25], [-10.5, -10], [-10, -8.95], [12.5, -8.95], [13, -10.75],
      [13.5, -12.5], [14, -14.25], [14.5, -16.25], [15, -17.75], [15.2, -18.1],
    ] as readonly V2[],
    floorY: -0.44,
    maxFootY: 0.3,
  },
  /**
   * 船绳涨 / 退潮两版（制作人 1029；美术 1030 定名：`env-pier-wood-ch1-rope-high` / `-rope-low` 同父，默认 high 可见；
   * 船头端点 `-rope-bow-end-high` / `-rope-bow-end-low`）。
   * 水位 ≥ switchLevel 显示 high 列表、否则显示 low 列表；按名字在 S1 美术根下找（精确名，或 `<名>_lodN` / `<名>.001` 等）。
   * 列表里的名字是「候选」：找到几个算几个（旧配置 / 旧名字照样可用）；两个列表任一边一个都找不到 = 不切换（保持 GLB 现状）。
   * bowEnd：船头端点（涨潮版第一个候选兼容旧名 `-rope-bow-end`，= high）。美术 1030 世界坐标：桩端两版都在 (3.566, 2.65, −11.018)；
   * 船头端涨潮 (4.072, 1.98, −10.95) = boat.bowRing、退潮 (4.072, 0.38, −10.95)（船 y −0.24）。
   */
  boatRope: {
    high: ['env-pier-wood-ch1-rope-high'] as readonly string[],
    low: ['env-pier-wood-ch1-rope-low'] as readonly string[],
    switchLevel: 0.8,
    bowEnd: { high: ['env-pier-wood-ch1-rope-bow-end-high', 'env-pier-wood-ch1-rope-bow-end'] as readonly string[], low: ['env-pier-wood-ch1-rope-bow-end-low'] as readonly string[] },
  },
  sunkenBoat: { position: [10.2, -1.15, -17] as V3, rotationY: 0.6, rotationXDeg: 9, rotationZDeg: -21 },
  /** 美术节点摆放（GLB 根的平移 / 绕 Y 旋转；与 s1-layout.json nodes 一致） */
  artNodes: {
    'env-tidal-flat-s1': { translation: [4, 0, -3], rotationY: 0 },
    'env-pier-wood-ch1': { translation: [-3.39, 0, -9.8], rotationY: -1.23594 },
    'env-shore-ledge-s1': { translation: [-12.74, 0, -6.25], rotationY: 0 },
    'env-cliff-s1': { translation: [4, 0, 17], rotationY: 0 },
    'env-fish-shed-ruin': { translation: [18.73, 0, 1.46], rotationY: 0 },
    'env-net-rack-a': { translation: [16.25, 0, -2.25], rotationY: 0 },
    'env-net-rack-b': { translation: [17.31, 0, 8.13], rotationY: 0 },
  } as Record<string, { translation: V3; rotationY: number }>,
  /** 远景剪影（天空层）：另外两座灯塔 */
  silhouettes: [
    { translation: [23.1, -0.5, -321.9] as V3, rotationY: -0.8, scale: 0.8 },
    { translation: [142.9, -0.5, -268.5] as V3, rotationY: 1.9, scale: 0.72 },
  ],
  /** 开场 / 建立镜头第一帧构图（主菜单同构图：远景主岛 + S3 灯塔在画面中右） */
  openingCam: { position: [-0.9, 4.2, 9.5] as V3, lookAt: [6.58, 4.2, -29.78] as V3, fov: 40 },
  /** 027 远景单只海鸟航线：开场机位视线方向约 55 m 处、离海面 12 m 的圆弧；每 45 s 出现一次飞 1.6 rad（约 29 m） */
  seabird: { center: [9.4, 12, -44.5] as V3, radius: 18, bob: 0.8, speed: 7, period: 45, arc: 1.6, flapSeconds: 2.4, glideSeconds: 3.2 },
  /** 潮汐分区（可走区里 z < 12.6 的部分；崖上不受潮汐影响） */
  tideRegion: { minX: -19.6, maxX: 15.7, minZ: -18.1, maxZ: 12.6 },
  /** 远景按物体雾（GLB extras fogLayer 'mid' 的 fogDensityHint） */
  midFogDensity: 0.0036,
  /** 天空层剪影：颜色 / 雾 */
  skyLayer: { color: 0x10151a, fogDensity: 0.003 },
} as const;

/**
 * S3 灯塔岛的世界坐标（v0.1-013 定，美术对齐用）：
 * - S1 远景主岛（env-lighthouse-island-main-s3tower）根 = (39.73, 0, −122.75)，绕 Y −0.19；塔座 socket 顶 y = 6.6。
 * - S3 场景（levels/s3/S3Scene，塔心在局部原点）放进世界时：塔心 = (39.73, −122.75)，绕 Y 旋转 135°（2.35619 rad），
 *   让 S3 局部 θ = 225°（东南）的门 / 栈桥朝向世界北（S1 岸的方向）。S1 塔座里的 env-lighthouse-ch1 实例世界旋转同样是 135°。
 * - 从 S1 开场镜头 (−0.9, 4.2, 9.5) 看：方位角 ≈ 197°（南偏西 17°，SSW），水平距离 ≈ 138.4 m。
 * 遗留：S3 局部塔基 y = 0，与 S1 远景塔座顶 6.6 不一致（远景只看剪影，S3 场景自成一体；正式统一留给 015 / 美术）。
 */
export const S3_WORLD_FRAME = {
  towerCenter: [39.73, 0, -122.75] as V3,
  rotationY: (135 * Math.PI) / 180,
  islandRotationY: -0.19,
  socketY: 6.6,
} as const;

export const v3 = (a: V3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);

/** 码头局部 → 世界（局部 +Z 指向陆地，+X 是码头的北侧） */
export function pierPoint(alongToLand: number, side: number, y: number = S1.pier.deckY): THREE.Vector3 {
  const r = S1.pier.rotationY;
  const fz = new THREE.Vector3(Math.sin(r), 0, Math.cos(r));
  const fx = new THREE.Vector3(Math.cos(r), 0, -Math.sin(r));
  return new THREE.Vector3(S1.pier.mid[0], y, S1.pier.mid[1]).addScaledVector(fz, alongToLand).addScaledVector(fx, side);
}

/** 世界方位角（°，0 = 北 +Z，90 = 东 −X，180 = 南，270 = 西）与水平距离 */
export function bearingFrom(from: V3, to: V3): { azimuthDeg: number; distance: number } {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  // 北 = +Z、东 = −X
  const az = (Math.atan2(-dx, dz) * 180) / Math.PI;
  return { azimuthDeg: (az + 360) % 360, distance: Math.hypot(dx, dz) };
}

/**
 * S1 的四条跨越（近岸平台 ↔ 浮台 ↔ 远侧台阶，沿 +Z / −Z、x = linkNear.x = 浮台中心 x）：按 stepAcrossSpan 从两侧缝沿算起点 / 终点 z
 * （起跳点离近沿 0.15 m、落点离远沿 0.32 m，路径位移按实际 0.97 m 缩放）。缝沿：岸台北沿 nearPlatform.max.z、浮台南 / 北沿（锚位）、台阶南沿 farSteps.z0。
 */
export function s1StepLinks(): StepAcrossSpan[] {
  const raftS = S1.raft.slot[2] - S1.raft.size[2] / 2;
  const raftN = S1.raft.slot[2] + S1.raft.size[2] / 2;
  const shore = S1.nearPlatform.max[1];
  const steps = S1.farSteps.z0;
  return [
    stepAcrossSpan(shore, 1, raftS), // 岸台 → 浮台
    stepAcrossSpan(raftS, -1, shore), // 浮台 → 岸台
    stepAcrossSpan(raftN, 1, steps), // 浮台 → 台阶
    stepAcrossSpan(steps, -1, raftN), // 台阶 → 浮台
  ];
}
