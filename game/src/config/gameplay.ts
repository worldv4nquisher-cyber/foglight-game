/**
 * 玩法数值（GDD §9 初值）。所有玩法数值集中在这里，策划调参只改这个文件。
 * 本文件不依赖 DOM / import.meta，Node 校验脚本可以直接导入。
 */
export const gameplay = {
  player: {
    /** 胶囊总高（m，脚底原点，与 016 char-xi.glb 身高一致：13 岁女孩） */
    height: 1.5,
    /** 胶囊半径（m） */
    radius: 0.25,
    /** 慢走（默认，m/s） */
    walkSpeed: 1.6,
    /** 小跑（按住 Shift，m/s） */
    runSpeed: 3.2,
    /** 转身角速度（°/s） */
    turnSpeedDeg: 540,
    /** 从静止加速到目标速度的时间（s，GDD 要求 ≤ 0.15） */
    accelTime: 0.12,
    /** 松开按键后停下的时间（s） */
    decelTime: 0.1,
    /** 可行走的最大坡度（°） */
    maxSlopeDeg: 40,
    /** 可自动迈上的最大台阶高度（m） */
    stepHeight: 0.3,
    /** 重力（m/s²），只用于贴地和走下台阶（本作不做跳跃） */
    gravity: 20,
    maxFallSpeed: 30,
    /** 走下台阶 / 下坡时向下吸附的最大距离（m） */
    groundSnap: 0.35,
    /** 迈台阶时视觉上的平滑时间（s），避免一级一级跳 */
    stepSmoothTime: 0.08,
  },
  traversal: {
    /** 自动跨越的移动速度（m/s）；时长 = 路径长度 / 速度，限制在 [minTime, maxTime] */
    speed: 1.8,
    minTime: 1.0,
    maxTime: 2.0,
  },
  /** 第三人称相机（GDD §4；v0.1-003）。角度单位：度 */
  camera: {
    fov: 55,
    /** 小跑时 FOV 增量 */
    sprintFovBoost: 3,
    /** 观察模式（按住右键）FOV */
    observeFov: 30,
    /** FOV 过渡时间（s） */
    fovBlendTime: 0.3,
    /** 观察模式下视角灵敏度倍率 */
    observeLookScale: 0.5,
    /** 跟随点：脚底以上高度（m，头部） */
    pivotHeight: 1.35,
    /** 跟随点：向相机右方偏移（m，肩后偏右） */
    shoulderOffset: 0.4,
    distance: 4.0,
    minDistance: 2.5,
    maxDistance: 6.0,
    /** 滚轮每格（m） */
    zoomStep: 0.5,
    /** 俯仰：负 = 俯视（往下看），正 = 仰视（往上看） */
    minPitchDeg: -35,
    maxPitchDeg: 55,
    /** 遮挡检测球半径（m） */
    collisionRadius: 0.2,
    /** 遮挡解除后恢复到目标距离的时间（s） */
    recoverTime: 0.25,
    /** 相机离墙 / 地面的最小距离（m，被挡时最近也不贴到角色身上） */
    minCollisionDistance: 0.35,
    /** -indoor 触发体内的最大距离（m） */
    indoorMaxDistance: 2.0,
    /** 跟随点竖直方向的平滑（1/s），上下台阶时不抖 */
    pivotYDamping: 12,
    /** 自动回正：静止多久后开始（s）与漂移速度（°/s） */
    autoRecenterDelay: 8,
    autoRecenterSpeedDeg: 4,
    /** 机关机位过渡时间（s）与可小范围转动的角度（±°） */
    puzzleBlendTime: 0.6,
    puzzleFreeLookDeg: 20,
    /** 演出结束交还控制的过渡时间（s） */
    cutsceneReturnTime: 0.8,
    /** 场景进入时的建立镜头时长（s） */
    establishingTime: 3,
    /** 观察点：完全对准的容差与渐显范围（°） */
    viewpointToleranceDeg: 6,
    viewpointFadeDeg: 12,
  },
  teleport: {
    /** 强制送回的黑场时长（s） */
    fadeSec: 0.5,
  },
} as const;

export type GameplayConfig = typeof gameplay;
