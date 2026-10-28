/**
 * 气氛预设（Atmosphere Preset）：一个场景「情绪」需要的全部可调参数集中在这里，
 * 美术 / 策划调氛围只改这个文件，不需要动渲染代码。
 *
 * 当前基调（用户确认）：忧郁。冷色、低饱和、浓雾、阴天黄昏细雨，
 * 灯塔暖光是画面里唯一的温度。
 *
 * 颜色均为 sRGB 十六进制；强度为物理灯光单位（three r155+）。
 */
export interface AtmospherePreset {
  name: string;
  /** 天空渐变：顶部 / 地平线 */
  skyTop: number;
  skyHorizon: number;
  /** FogExp2 */
  fogColor: number;
  fogDensity: number;
  /** 半球光（天空色 / 地面反弹色） */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** 主方向光（阴天的散射太阳 / 月光） */
  sunColor: number;
  sunIntensity: number;
  /** 方向光方向（从原点指向光源） */
  sunDirection: [number, number, number];
  /** 灯塔暖光（对比色） */
  lighthouseColor: number;
  lighthouseIntensity: number;
  lighthouseDistance: number;
  /** 灯光呼吸闪烁幅度（0 = 不闪） */
  lighthouseFlicker: number;
  /** 水面 */
  waterColor: number;
  /** 后处理 */
  exposure: number;
  bloom: { intensity: number; threshold: number; smoothing: number; radius: number };
  /** 色调：hue 弧度偏移；saturation -1..1（负值去饱和） */
  grade: { hue: number; saturation: number; brightness: number; contrast: number };
  vignette: { offset: number; darkness: number };
  /** 胶片颗粒强度 0..1 */
  grain: number;
  ao: { radius: number; distanceFalloff: number; intensity: number; color: number };
  /** 雨（0 = 关闭；数量由画质档位决定） */
  rain: { enabled: boolean; speed: number; opacity: number; color: number };
}

export const ATMOSPHERE_PRESETS = {
  /** 默认：忧郁的阴天黄昏 */
  'melancholy-dusk': {
    name: '忧郁黄昏',
    skyTop: 0x1a222c,
    skyHorizon: 0x5a6670,
    fogColor: 0x4a555e,
    fogDensity: 0.028,
    hemiSky: 0x8c9cab,
    hemiGround: 0x1c2024,
    hemiIntensity: 1.6,
    sunColor: 0xa9b8c8,
    sunIntensity: 2.4,
    sunDirection: [-12, 18, -8],
    lighthouseColor: 0xffa95a,
    lighthouseIntensity: 60,
    lighthouseDistance: 28,
    lighthouseFlicker: 0.08,
    waterColor: 0x1b252c,
    exposure: 1.05,
    bloom: { intensity: 0.55, threshold: 0.75, smoothing: 0.25, radius: 0.7 },
    grade: { hue: 0.06, saturation: -0.35, brightness: -0.02, contrast: 0.08 },
    vignette: { offset: 0.3, darkness: 0.65 },
    grain: 0.12,
    ao: { radius: 2.5, distanceFalloff: 1.0, intensity: 3.0, color: 0x05080b },
    rain: { enabled: true, speed: 22, opacity: 0.22, color: 0x9fb0c0 },
  },
  /** 备选：深夜浓雾（更暗、更孤独，灯塔更突出） */
  'lonely-night': {
    name: '孤夜浓雾',
    skyTop: 0x080b10,
    skyHorizon: 0x1f2830,
    fogColor: 0x1d252c,
    fogDensity: 0.04,
    hemiSky: 0x52606e,
    hemiGround: 0x0b0d10,
    hemiIntensity: 0.9,
    sunColor: 0x7d8da0,
    sunIntensity: 1.1,
    sunDirection: [10, 20, -6],
    lighthouseColor: 0xffb066,
    lighthouseIntensity: 90,
    lighthouseDistance: 32,
    lighthouseFlicker: 0.12,
    waterColor: 0x0d1318,
    exposure: 1.0,
    bloom: { intensity: 0.8, threshold: 0.6, smoothing: 0.3, radius: 0.75 },
    grade: { hue: 0.08, saturation: -0.45, brightness: -0.03, contrast: 0.12 },
    vignette: { offset: 0.25, darkness: 0.8 },
    grain: 0.16,
    ao: { radius: 2.5, distanceFalloff: 1.0, intensity: 3.5, color: 0x000000 },
    rain: { enabled: false, speed: 22, opacity: 0.2, color: 0x8a9aa8 },
  },
} satisfies Record<string, AtmospherePreset>;

export type AtmosphereName = keyof typeof ATMOSPHERE_PRESETS;

/** 当前使用的预设。可用 URL ?atmo=lonely-night 临时切换对比 */
export function getAtmosphere(): AtmospherePreset {
  const fromUrl = new URLSearchParams(location.search).get('atmo');
  if (fromUrl && fromUrl in ATMOSPHERE_PRESETS) return ATMOSPHERE_PRESETS[fromUrl as AtmosphereName];
  return ATMOSPHERE_PRESETS['melancholy-dusk'];
}
