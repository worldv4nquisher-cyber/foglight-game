import { isDev } from './debug';

/** 全局技术参数。玩法数值（移动速度、胶囊尺寸、坡度等）在 config/gameplay.ts。 */
export const gameConfig = {
  /** 固定步长（秒） */
  fixedDelta: 1 / 60,
  /** devicePixelRatio 硬上限（各画质档再各自限制） */
  maxPixelRatio: 2,
  /** 开发模式默认显示 FPS；生产环境默认隐藏（可在暂停菜单或按 F3 切换） */
  showFpsByDefault: isDev,
  /** 加载界面最短显示时间（毫秒），避免闪屏 */
  minLoadingMs: 300,
  input: {
    /** 点击画布进入指针锁定，鼠标移动直接转视角（GDD §3）。不支持时回退为按住左键拖拽 */
    pointerLock: true,
  },
  camera: {
    fov: 60,
    distance: 6,
    minDistance: 2,
    height: 1.4,
    minPitch: -0.35,
    maxPitch: 1.2,
    mouseSensitivity: 0.0025,
    touchSensitivity: 0.005,
    followLerp: 12,
  },
} as const;
