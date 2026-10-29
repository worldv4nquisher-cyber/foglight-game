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
  /** 潮汐（GDD §7 谜题 1、2、5，§9；v0.1-011）。高度基准全章统一：退潮水面 y = 0.0、涨潮 y = 1.6 */
  tide: {
    /** 退潮 / 涨潮水面高度（m，世界 y） */
    lowLevel: 0.0,
    highLevel: 1.6,
    /** 涨落一次的时长（s，smoothstep 过渡；期间钟不能再敲） */
    transitionSec: 6,
    /** 水深超过多少算「深水」（m）：深水隐形墙启用，角色进不去 */
    deepWaterDepth: 0.5,
    /** 送回阈值（m）：角色脚下的地面被淹没超过这个深度 → 黑场送回安全点 + 字幕 */
    recallDepth: 0.3,
    /** 送回黑场保持时长（s） */
    recallFadeSec: 0.5,
    /** 浮物漂浮时的起伏：振幅（m，±）与周期（s） */
    floatBobAmplitude: 0.02,
    floatBobPeriod: 3,
    /** 浮物不在锚位里浮起时漂回原位的演出时长（s） */
    floatDriftSec: 2,
    /** 潮汐钟敲响后的摆动时长（s，白盒动画） */
    bellSwingSec: 1.6,
  },
  /** 交互与机关（GDD §9；v0.1-004） */
  /** 字幕 / 阅读 / 日志（GDD §9、§10；任务单 005） */
  narrative: {
    /** 每字显示时长（s）：显示时长 = max(minSeconds, 字数 × perChar)；字数 = 去掉空白后的字符数（含标点） */
    subtitlePerChar: 0.12,
    /** 最短显示时长（s） */
    subtitleMinSeconds: 2.0,
    /** 「日志已更新」提示时长（s，左下角） */
    journalToastSeconds: 2.0,
  },
  interaction: {
    /** 可交互距离（m，角色到物体焦点的水平距离减去物体 reach） */
    distance: 1.8,
    /** 角色朝向与物体方向的最大夹角（°） */
    angleDeg: 60,
    /** 冷色小图标出现的距离（m） */
    iconDistance: 3.5,
    /** 没有 -interact 节点时，站位取物体前方（+Z）多远（m） */
    defaultPointDistance: 1.0,
    /** use / hold / push 自动走到交互点：最长时间（s，含转向）与最短时间（只转身时） */
    approachMaxTime: 0.4,
    approachMinTime: 0.15,
    /** hold：按住 E 的默认时长（s，油阀 2 s） */
    holdSeconds: 2,
    /** push：沿轨道移动速度（m/s，浮台） */
    pushSpeed: 0.8,
    /** 高亮默认时长（s，提示系统二级提示） */
    highlightSeconds: 3,
  },
  /** 三级提示（GDD §7、§9；v0.1-007）。计时 = 玩家在谜题区域里的游戏时间（离开暂停、不清零） */
  hint: {
    /** 进入区域多久解锁一级（s） */
    level1Delay: 180,
    /** 一级之后再多久解锁二级（s） */
    level2Delay: 180,
    /** 二级之后再多久解锁三级（s） */
    level3Delay: 240,
    /** 二级高亮关键物体的时长（s） */
    highlightSeconds: 3,
  },
  /** 机关操作模式（GDD §7；v0.1-004） */
  puzzle: {
    /** 档位角（°）与按住 Shift 的精调档位（°） */
    stepDeg: 15,
    fineStepDeg: 7.5,
    /** 鼠标累计转动多少（弧度，已乘灵敏度）算一档：默认灵敏度下约 32 px */
    mouseStepRad: 0.08,
    /** A/D、W/S 按住连发：首次延迟与间隔（s） */
    keyRepeatDelay: 0.35,
    keyRepeatInterval: 0.15,
  },
} as const;

export type GameplayConfig = typeof gameplay;
