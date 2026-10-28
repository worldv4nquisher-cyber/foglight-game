import type * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { LodDistances } from '@/render/lod';
import type { Settings } from '@/systems/save/Settings';

/**
 * 画质档位（纯桌面），参数以 `art/style/style-guide.md` §8 为准（v0.1-009）。
 * - ultra 极致：默认档，基准 RTX 3060 / 1440p / 60 fps
 * - high 高：首次启动 3 秒检测 < 50 fps 时降到这里
 * - standard 标准：兜底（最低 GTX 1650）
 *
 * 表里很多键对应的渲染特性还没做（体积雾、CSM、描边、反射、TAA 等在 023–026 实现），
 * 那些系统做的时候直接从这里读参数；`scripts/verify-quality.mjs` 逐项核对本表与 §8。
 * 本文件会被 Node（strip-types）直接导入做校验：只能 `import type`，不能用参数属性 / enum。
 */
export type QualityTier = 'ultra' | 'high' | 'standard';

/** 外扩描边（反面外扩壳）覆盖对象：角色 / 道具 / 近景 / 可交互物 */
export type OutlineHullTarget = 'character' | 'prop' | 'near' | 'interactive';

export interface QualityPreset {
  tier: QualityTier;
  label: string;

  // ---------------------------------------------------------- style-guide §8（键名 = 表中 key）
  /** 渲染分辨率缩放（乘在像素比上） */
  renderScale: number;
  /** devicePixelRatio 上限（最终还会被 gameConfig.maxPixelRatio=2 截断） */
  maxPixelRatio: number;
  /** 主角（汐）三角面：极致 lod0 120k；高、标准共用 lod1 50k（标准档远景用 lod2 ≤ 25k）；拆单裁定第 4 条 */
  heroCharTris: number;
  npcCharTris: number;
  /** 可见场景总面数预算（F3 面板对照） */
  sceneVisibleTris: number;
  /** draw call 预算（F3 面板对照） */
  maxDrawCalls: number;
  /** 角色 / 重点道具贴图上限 */
  textureMaxSize: number;
  /** 普通环境贴图上限 */
  textureMaxSizeEnv: number;
  anisotropy: number;
  /** 外扩描边覆盖范围 */
  outlineHull: readonly OutlineHullTarget[];
  /** 后处理描边（标准档关闭，远景不描边） */
  outlinePost: { enabled: boolean; resolution: 'full'; inputs: readonly ('normal' | 'depth' | 'id')[]; maxDistance: number };
  fogMode: 'volumetric' | 'cards';
  /** 体积雾 froxel 网格（fogMode=cards 时为 null） */
  fogFroxels: readonly [number, number, number] | null;
  /** 雾墙 / 雾贴片：远景层数 + 补充贴片上限 */
  fogCards: { farLayers: number; extraMax: number };
  /** 光束：raymarch（步数、是否半分辨率）或 mesh（加法锥形网格 + 公告板） */
  lightShafts: { mode: 'raymarch' | 'mesh'; steps: number; halfRes: boolean };
  softParticles: boolean;
  /** 雨：GPU 粒子数、雨圈、镜头水滴 */
  rainParticles: { count: number; ripples: boolean; lensDroplets: boolean };
  /** 阴影：CSM 级数、每级贴图尺寸、过滤方式、接触阴影 */
  shadowType: { cascades: number; mapSize: number; filter: 'PCSS' | 'PCF_SOFT' | 'PCF'; contactShadows: boolean };
  pointLightShadows: { count: number; mapSize: number };
  /** 环境光遮蔽：GTAO 分辨率（off = 只用烘焙）+ 烘焙 AO */
  ao: { gtao: 'full' | 'half' | 'off'; baked: boolean };
  /**
   * 反射：SSR（full / half / off，wetOnly = 只给湿地面）、平面反射分辨率倍数、反射探针。
   * 极致 SSR + 平面 1.0×；高 平面 0.5× + 湿地面 SSR 半分辨率；标准 探针 + 平面 0.25×
   */
  reflections: { ssr: 'full' | 'half' | 'off'; ssrWetOnly: boolean; planar: number; probes: boolean };
  /** 景深：bokeh / 高斯（只在过场）/ 关 */
  dof: 'bokeh' | 'gaussian-cutscene' | 'off';
  bloom: { enabled: boolean; mipLevels: number };
  lut: boolean;
  toneMapping: 'AgX';
  filmGrain: boolean;
  vignette: boolean;
  antialias: 'TAA' | 'SMAA';
  /**
   * LOD 切换距离 [LOD0, LOD1, LOD2]（米）：LOD0 显示到第 1 个值，LOD1 到第 2 个，LOD2 到第 3 个（之后 impostor）。
   * puzzleCritical 物体不受影响，三档都固定 LOD0。
   */
  lodDistances: LodDistances;
  impostorDistance: number;
  grassDensity: number;

  // ---------------------------------------------------------- 实现细节（§8 没有的键，不与 §8 冲突）
  /** 是否启用后处理管线（?postfx=0 临时关闭，用于排查问题） */
  postprocessing: boolean;
  /** 现阶段 GTAO 用 N8AO 实现：它的质量档 */
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  /** 软阴影 PCF 采样半径（three r18x 用 PCFShadowMap + shadow.radius 实现软阴影；PCSS 在 023 做） */
  shadowRadius: number;
  /** 相机远裁剪面（米） */
  viewDistance: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  ultra: {
    tier: 'ultra',
    label: '极致',
    renderScale: 1,
    maxPixelRatio: 2,
    heroCharTris: 120_000,
    npcCharTris: 60_000,
    sceneVisibleTris: 6_000_000,
    maxDrawCalls: 2000,
    textureMaxSize: 4096,
    textureMaxSizeEnv: 2048,
    anisotropy: 16,
    outlineHull: ['character', 'prop', 'near'],
    outlinePost: { enabled: true, resolution: 'full', inputs: ['normal', 'depth', 'id'], maxDistance: 300 },
    fogMode: 'volumetric',
    fogFroxels: [160, 90, 128],
    fogCards: { farLayers: 5, extraMax: 20 },
    lightShafts: { mode: 'raymarch', steps: 64, halfRes: false },
    softParticles: true,
    rainParticles: { count: 30_000, ripples: true, lensDroplets: true },
    shadowType: { cascades: 4, mapSize: 4096, filter: 'PCSS', contactShadows: true },
    pointLightShadows: { count: 2, mapSize: 1024 },
    ao: { gtao: 'full', baked: true },
    reflections: { ssr: 'full', ssrWetOnly: false, planar: 1, probes: false },
    dof: 'bokeh',
    bloom: { enabled: true, mipLevels: 6 },
    lut: true,
    toneMapping: 'AgX',
    filmGrain: true,
    vignette: true,
    antialias: 'TAA',
    lodDistances: [60, 150, 400],
    impostorDistance: 600,
    grassDensity: 1,
    postprocessing: true,
    aoQuality: 'High',
    shadowRadius: 3,
    viewDistance: 600,
  },
  high: {
    tier: 'high',
    label: '高',
    renderScale: 1,
    maxPixelRatio: 1.5,
    heroCharTris: 50_000,
    npcCharTris: 40_000,
    sceneVisibleTris: 3_500_000,
    maxDrawCalls: 1200,
    textureMaxSize: 2048,
    textureMaxSizeEnv: 2048,
    anisotropy: 8,
    outlineHull: ['character', 'prop'],
    outlinePost: { enabled: true, resolution: 'full', inputs: ['normal', 'depth'], maxDistance: 150 },
    fogMode: 'volumetric',
    fogFroxels: [80, 45, 64],
    fogCards: { farLayers: 5, extraMax: 30 },
    lightShafts: { mode: 'raymarch', steps: 32, halfRes: true },
    softParticles: true,
    rainParticles: { count: 15_000, ripples: true, lensDroplets: false },
    shadowType: { cascades: 3, mapSize: 2048, filter: 'PCF_SOFT', contactShadows: false },
    pointLightShadows: { count: 1, mapSize: 1024 },
    ao: { gtao: 'half', baked: true },
    reflections: { ssr: 'half', ssrWetOnly: true, planar: 0.5, probes: false },
    dof: 'gaussian-cutscene',
    bloom: { enabled: true, mipLevels: 5 },
    lut: true,
    toneMapping: 'AgX',
    filmGrain: true,
    vignette: true,
    antialias: 'SMAA',
    lodDistances: [40, 100, 250],
    impostorDistance: 400,
    grassDensity: 0.7,
    postprocessing: true,
    aoQuality: 'Medium',
    shadowRadius: 2.5,
    viewDistance: 400,
  },
  standard: {
    tier: 'standard',
    label: '标准',
    renderScale: 0.8,
    maxPixelRatio: 1,
    heroCharTris: 50_000,
    npcCharTris: 25_000,
    sceneVisibleTris: 1_500_000,
    maxDrawCalls: 600,
    textureMaxSize: 2048,
    textureMaxSizeEnv: 1024,
    anisotropy: 4,
    outlineHull: ['character', 'interactive'],
    outlinePost: { enabled: false, resolution: 'full', inputs: [], maxDistance: 0 },
    fogMode: 'cards',
    fogFroxels: null,
    fogCards: { farLayers: 4, extraMax: 40 },
    lightShafts: { mode: 'mesh', steps: 0, halfRes: false },
    softParticles: true,
    rainParticles: { count: 6000, ripples: true, lensDroplets: false },
    shadowType: { cascades: 2, mapSize: 2048, filter: 'PCF', contactShadows: false },
    pointLightShadows: { count: 1, mapSize: 512 },
    ao: { gtao: 'off', baked: true },
    reflections: { ssr: 'off', ssrWetOnly: false, planar: 0.25, probes: true },
    dof: 'off',
    bloom: { enabled: true, mipLevels: 4 },
    lut: true,
    toneMapping: 'AgX',
    filmGrain: false,
    vignette: true,
    antialias: 'SMAA',
    lodDistances: [25, 60, 150],
    impostorDistance: 250,
    grassDensity: 0.4,
    postprocessing: true,
    aoQuality: 'Low',
    shadowRadius: 2,
    viewDistance: 250,
  },
};

const TIERS: readonly QualityTier[] = ['ultra', 'high', 'standard'];

export function isTier(v: unknown): v is QualityTier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

/** 低一档（标准档返回 null） */
export function lowerTier(t: QualityTier): QualityTier | null {
  const i = TIERS.indexOf(t);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1]! : null;
}

/** 读取 GPU 名称（WEBGL_debug_renderer_info，部分浏览器会返回模糊值）。只做日志 / 显示，不参与判档 */
export function getGpuName(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** quality:changed 的来源：user = 玩家手动；auto = 自动检测；settings = 设置变化（如恢复默认） */
export type QualityChangeSource = 'user' | 'auto' | 'settings';

/**
 * 画质管理。档位存在玩家设置里（`foglight.settings.v1`，v0.1-006）。
 * - 默认极致；不再按 GPU 名称判档（GPU 名只打日志、显示在暂停菜单底部）。
 * - 首次启动后第一次进入 S1 时由 QualityBenchmark 实测 3 秒决定（可能降档），之后不再自动改。
 * - URL ?quality=xx 临时覆盖（不写盘，也不跑检测）。
 * - 运行时切换不重载场景：发布 `quality:changed`，Game / PostFX / 场景各自重建阴影贴图与渲染目标。
 */
export class QualityManager {
  private current: QualityTier;
  readonly gpu: string;
  /** URL ?quality= 临时覆盖中（不写盘、不跑自动检测） */
  readonly urlOverride: boolean;

  private events: EventBus;
  private settings: Settings;
  private offSettings: () => void;

  // 不用参数属性写法：本文件会被 Node（strip-types）直接导入做校验
  constructor(events: EventBus, renderer: THREE.WebGLRenderer | null, settings: Settings, search = globalThis.location?.search ?? '') {
    this.events = events;
    this.settings = settings;
    this.gpu = renderer ? getGpuName(renderer) : 'unknown';
    const fromUrl = new URLSearchParams(search).get('quality');
    this.urlOverride = isTier(fromUrl);
    this.current = isTier(fromUrl) ? fromUrl : settings.get('quality');
    console.info(`[quality] GPU：${this.gpu}；档位 ${this.current}（${this.urlOverride ? 'URL 覆盖' : settings.get('qualitySource')}）`);
    // 设置里的档位变了（手动切换、恢复默认、自动检测写入）→ 运行时跟着切
    this.offSettings = settings.onChange((key, value) => {
      if (key !== 'quality' || this.urlOverride) return;
      this.apply(value as QualityTier, settings.get('qualitySource') === 'user' ? 'user' : 'settings');
    });
  }

  get tier(): QualityTier {
    return this.current;
  }

  get preset(): QualityPreset {
    const p = QUALITY_PRESETS[this.current];
    // ?postfx=0 可临时关闭后处理，便于排查渲染问题
    if (new URLSearchParams(globalThis.location?.search ?? '').get('postfx') === '0') return { ...p, postprocessing: false };
    return p;
  }

  /** 自动检测给出的档位（未检测时 null） */
  get detected(): QualityTier | null {
    return this.settings.get('qualityDetected') ? this.settings.get('qualityDetectedTier') : null;
  }

  /** 是否显示 `ui.settings.quality_auto_note`：自动检测降过档、且玩家没手动改过 */
  get showAutoNote(): boolean {
    return this.settings.get('qualitySource') === 'auto' && this.detected !== null && this.detected !== 'ultra';
  }

  /** 玩家手动切换：写进设置并标记为玩家选择（之后不会再被自动改动） */
  set(tier: QualityTier): void {
    if (this.urlOverride) {
      this.apply(tier, 'user');
      return;
    }
    // 先写来源再写档位：设置监听里据此判断事件来源
    this.settings.update({ qualitySource: 'user', quality: tier });
    this.apply(tier, 'user'); // 档位没变时（同一档再点一次）不会重复发布事件
  }

  /** 只切运行时档位，不写设置（自动检测测量过程中用） */
  apply(tier: QualityTier, source: QualityChangeSource): void {
    if (tier === this.current) return;
    const previous = this.current;
    this.current = tier;
    this.events.emit('quality:changed', { tier, previous, source });
  }

  dispose(): void {
    this.offSettings();
  }

  static readonly tiers = TIERS;
}
