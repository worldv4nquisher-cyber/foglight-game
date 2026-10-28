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
  teleport: {
    /** 强制送回的黑场时长（s） */
    fadeSec: 0.5,
  },
} as const;

export type GameplayConfig = typeof gameplay;
