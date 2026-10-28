import type * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';

/**
 * 画质档位（纯桌面）。与美术风格指南的「极致 / 高 / 标准」三档一一对应：
 * - ultra：独显（RTX 3060 / RX 6600 及以上）满配
 * - high：默认档，主流独显 / Apple M 系列 Pro/Max
 * - standard：核显 / 轻薄本兜底，关闭 AO、降低阴影与像素比
 */
export type QualityTier = 'ultra' | 'high' | 'standard';

export interface QualityPreset {
  tier: QualityTier;
  label: string;
  /** devicePixelRatio 上限（最终还会被 gameConfig.maxPixelRatio=2 截断） */
  maxPixelRatio: number;
  /** 是否启用后处理管线（关闭时直接渲染 + 渲染器自带 ACES，用于排查问题） */
  postprocessing: boolean;
  /** SMAA 抗锯齿 */
  smaa: boolean;
  /** N8AO 环境光遮蔽 */
  ao: boolean;
  aoQuality: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  aoHalfRes: boolean;
  /** Bloom mipmap 模糊（更柔和、更贵） */
  bloomMipmapBlur: boolean;
  shadows: boolean;
  /**
   * 软阴影半径（PCF 采样半径，单位：阴影贴图像素）。
   * 注：three r18x 已移除 PCFSoftShadowMap，PCFShadowMap + shadow.radius 即为软阴影实现。
   */
  shadowRadius: number;
  shadowMapSize: number;
  /** 相机远裁剪面 */
  viewDistance: number;
  /** 雨滴数量（氛围粒子） */
  rainCount: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  ultra: {
    tier: 'ultra',
    label: '极致',
    maxPixelRatio: 2,
    postprocessing: true,
    smaa: true,
    ao: true,
    aoQuality: 'High',
    aoHalfRes: false,
    bloomMipmapBlur: true,
    shadows: true,
    shadowRadius: 3,
    shadowMapSize: 4096,
    viewDistance: 400,
    rainCount: 6000,
  },
  high: {
    tier: 'high',
    label: '高',
    maxPixelRatio: 1.5,
    postprocessing: true,
    smaa: true,
    ao: true,
    aoQuality: 'Medium',
    aoHalfRes: true,
    bloomMipmapBlur: true,
    shadows: true,
    shadowRadius: 2.5,
    shadowMapSize: 2048,
    viewDistance: 300,
    rainCount: 3500,
  },
  standard: {
    tier: 'standard',
    label: '标准',
    maxPixelRatio: 1,
    postprocessing: true,
    smaa: true,
    ao: false,
    aoQuality: 'Low',
    aoHalfRes: true,
    bloomMipmapBlur: false,
    shadows: true,
    shadowRadius: 2,
    shadowMapSize: 1024,
    viewDistance: 200,
    rainCount: 1500,
  },
};

const STORAGE_KEY = 'game.quality';
const TIERS: readonly QualityTier[] = ['ultra', 'high', 'standard'];

function isTier(v: unknown): v is QualityTier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

/** 读取 GPU 名称（WEBGL_debug_renderer_info，部分浏览器会返回模糊值） */
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

/**
 * 按 GPU 名称粗判档位。判断不准时玩家可在暂停菜单手动切换（会记住）。
 * 以后可加入运行时 FPS 自适应降档。
 */
export function detectQualityTier(gpu: string): QualityTier {
  const g = gpu.toLowerCase();
  // 软件渲染 / 核显 / 低端
  if (/swiftshader|llvmpipe|software|microsoft basic|intel|uhd|iris|mali|adreno|powervr|vega [0-9] |radeon\(tm\) graphics/.test(g)) {
    return 'standard';
  }
  // 中高端独显 / Apple 高端芯片
  if (
    /rtx\s?(30[6-9]0|40[6-9]0|50[6-9]0)|rtx\s?a?[456]000|rx\s?(6[6-9]|7[6-9]|9[0-9])[0-9]{2}|apple m[1-9] (pro|max|ultra)/.test(g)
  ) {
    return 'ultra';
  }
  return 'high';
}

/**
 * 画质管理：优先级 URL ?quality=xx > localStorage（玩家手动选择）> GPU 粗判。
 */
export class QualityManager {
  private current: QualityTier;
  readonly auto: QualityTier;
  readonly gpu: string;

  constructor(
    private events: EventBus,
    renderer: THREE.WebGLRenderer,
  ) {
    this.gpu = getGpuName(renderer);
    this.auto = detectQualityTier(this.gpu);
    const fromUrl = new URLSearchParams(location.search).get('quality');
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* 隐私模式等情况下 localStorage 不可用 */
    }
    this.current = isTier(fromUrl) ? fromUrl : isTier(stored) ? stored : this.auto;
  }

  get tier(): QualityTier {
    return this.current;
  }

  get preset(): QualityPreset {
    const p = QUALITY_PRESETS[this.current];
    // ?postfx=0 可临时关闭后处理，便于排查渲染问题
    if (new URLSearchParams(location.search).get('postfx') === '0') return { ...p, postprocessing: false };
    return p;
  }

  set(tier: QualityTier, persist = true): void {
    if (tier === this.current) return;
    this.current = tier;
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, tier);
      } catch {
        /* ignore */
      }
    }
    this.events.emit('quality:change', { tier });
  }

  static readonly tiers = TIERS;
}
