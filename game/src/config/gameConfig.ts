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
  assets: {
    /**
     * 美术 GLB 的 COLOR_0 是外扩描边用的平滑法线（v0.1-index §5.4），不是颜色：
     * true（默认）→ 加载后关掉材质 vertexColors、保留几何 color 属性给描边读（src/assets/vertexColors.ts）。
     * 单个资源的 COLOR_0 是真颜色时，在 manifest 条目写 `vertexColors: 'color'` 例外处理。
     */
    vertexColorsAreOutlineNormals: true as boolean,
  },
  camera: {
    /** 原始输入 → 弧度的换算（玩家灵敏度在设置里另乘）。相机规则数值在 config/gameplay.ts */
    mouseSensitivity: 0.0025,
    touchSensitivity: 0.005,
  },
} as const;

/**
 * 制作名单署名（text-ch1 `ui.credits.body` 的 {producer} 等占位，v0.1-008）。
 */
export const credits = {
  producer: 'worldv4nquisher-cyber',
  designer: 'worldv4nquisher-cyber',
  artist: 'worldv4nquisher-cyber、Grok Bot、Devin Bot',
  programmer: 'worldv4nquisher-cyber、Grok Bot、Devin Bot',
  audio: 'worldv4nquisher-cyber、Grok Bot、Devin Bot',
};
