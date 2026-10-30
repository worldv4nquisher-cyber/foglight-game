import { ATMO028, type Atmo028PresetName } from './atmosphere028';

/**
 * 气氛预设（Atmosphere Preset）：一个场景「情绪」需要的全部可调参数集中在这里，
 * 美术 / 策划调氛围只改这个文件，不需要动渲染代码。
 *
 * 当前基调（用户确认）：忧郁。冷色、低饱和、浓雾、阴天黄昏细雨，
 * 灯塔暖光是画面里唯一的温度。
 *
 * v0.1-028：预设名对齐 style-guide §3.1（overcast-dusk / overcast-after-rain / rain-night / after-lit，026 拆单第 6 条）；
 * 天空 / 雾 / 雨 / 水面 / LUT / 远景雾提示全部取美术 atmosphere-028.json（./atmosphere028.ts 原样副本）。
 * 制作人裁定 18 ①：全局雾改用 028 预设（替换旧 melancholy-dusk 的 0x4a555e / 0.028）。
 * 灯光（半球 / 主光 / 灯塔）、曝光、bloom、暗角、颗粒、AO 仍是 026 的值；雨夜天光与主光 ×0.35（README-028 §9.5：夜里必须比黄昏暗，剪影才不反转）。
 * 旧名 `?atmo=melancholy-dusk` / `lonely-night` 作为别名保留（→ overcast-dusk / rain-night）。
 *
 * 颜色均为 sRGB 十六进制；强度为物理灯光单位（three r155+）。
 */
type Sky028 = (typeof ATMO028.presets)[Atmo028PresetName]['sky'];

export interface AtmospherePreset {
  /** 预设 id（= ATMO028.presets 的键） */
  id: Atmo028PresetName;
  name: string;
  /** 028 天空：三段渐变 + 云层 + 黄昏低仰角暖灰带（不是光源） */
  sky: Sky028;
  /** FogExp2（028 预设 fog.color / density，裁定 18） */
  fogColor: number;
  fogDensity: number;
  /** 远景雾墙基准色（028 fog.farWallTint） */
  farWallTint: number;
  /** 主岛 / 灯塔（fogLayer 'mid'）的按物体雾密度（028 s1.fogDensityHint.mid，按预设覆盖 GLB extras） */
  midFogDensity: number;
  /** 天空层远景剪影：固定色 #56616B 向 farWallTint 混合的比例（黄昏 0.38 / 雨夜 0.5），不吃场景雾 */
  silhouetteMix: number;
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
  /** 水面（028 presets.*.water；fresnel / reflectDistort 留给 025 平面反射） */
  waterColor: number;
  water: { fresnel: readonly [number, number]; normalScale: number; reflectDistort: number };
  /** 调色 LUT 文件名（art/textures/lut/；1024×32，作用在色调映射 + sRGB 编码之后） */
  lut: string;
  /** 后处理 */
  exposure: number;
  bloom: { intensity: number; threshold: number; smoothing: number; radius: number };
  /** 色调：hue 弧度偏移；saturation -1..1（负值去饱和）。LUT 生效时不用（调色交给 LUT），?lut=0 回到这组 */
  grade: { hue: number; saturation: number; brightness: number; contrast: number };
  vignette: { offset: number; darkness: number };
  /** 胶片颗粒强度 0..1 */
  grain: number;
  ao: { radius: number; distanceFalloff: number; intensity: number; color: number };
  /** 雨（开关 / 颜色 / 速度 / 风斜按预设；数量、透明度、宽度按画质档 ATMO028.rainTiers） */
  rain: { enabled: boolean; speed: number; color: number; brightness: number; windTilt: number };
}

const hex = (s: string): number => parseInt(s.replace('#', ''), 16);

/** 026 现行灯光 / 后处理（原 melancholy-dusk） */
const DUSK_LIGHT = {
  hemiSky: 0x8c9cab,
  hemiGround: 0x1c2024,
  hemiIntensity: 1.6,
  sunColor: 0xa9b8c8,
  sunIntensity: 2.4,
  sunDirection: [-12, 18, -8] as [number, number, number],
  lighthouseColor: 0xffa95a,
  lighthouseIntensity: 60,
  lighthouseDistance: 28,
  lighthouseFlicker: 0.08,
  exposure: 1.05,
  bloom: { intensity: 0.55, threshold: 0.75, smoothing: 0.25, radius: 0.7 },
  grade: { hue: 0.06, saturation: -0.35, brightness: -0.02, contrast: 0.08 },
  vignette: { offset: 0.3, darkness: 0.65 },
  grain: 0.12,
  ao: { radius: 2.5, distanceFalloff: 1.0, intensity: 3.0, color: 0x05080b },
};

/** 雨夜：天光 / 主光 ×0.35（README-028 §9.5、JSON previewLightMul） */
export const RAIN_NIGHT_LIGHT_MUL = 0.35;

function from028(id: Atmo028PresetName, name: string, light: typeof DUSK_LIGHT, silhouetteMix: number): AtmospherePreset {
  const p = ATMO028.presets[id];
  return {
    id,
    name,
    ...light,
    sky: p.sky,
    fogColor: hex(p.fog.color),
    fogDensity: p.fog.density,
    farWallTint: hex(p.fog.farWallTint),
    midFogDensity: ATMO028.s1.fogDensityHint.mid[id],
    silhouetteMix,
    waterColor: hex(p.water.color),
    water: { fresnel: p.water.fresnel, normalScale: p.water.normalScale, reflectDistort: p.water.reflectDistort },
    lut: p.lut,
    rain: { enabled: p.rain.enabled, speed: p.rain.speed, color: hex(p.rain.color), brightness: p.rain.brightness, windTilt: p.rain.windTilt },
  };
}

export const ATMOSPHERE_PRESETS: Record<Atmo028PresetName, AtmospherePreset> = {
  /** 默认：忧郁的阴天黄昏细雨（S1 / S3） */
  'overcast-dusk': from028('overcast-dusk', '阴天黄昏', DUSK_LIGHT, 0.38),
  /** 阴天雨停（026 拟作 S2 默认，现阶段 ?atmo= 切换） */
  'overcast-after-rain': from028('overcast-after-rain', '雨后阴天', DUSK_LIGHT, 0.38),
  /** 雨夜（备用）：天光 / 主光 ×0.35 */
  'rain-night': from028(
    'rain-night',
    '雨夜',
    {
      ...DUSK_LIGHT,
      hemiIntensity: DUSK_LIGHT.hemiIntensity * RAIN_NIGHT_LIGHT_MUL,
      sunIntensity: DUSK_LIGHT.sunIntensity * RAIN_NIGHT_LIGHT_MUL,
      lighthouseFlicker: 0.12,
      vignette: { offset: 0.25, darkness: 0.8 },
      grain: 0.16,
    },
    0.5,
  ),
  /** 点灯后（026 点灯转暖的目标预设） */
  'after-lit': from028('after-lit', '点灯后', DUSK_LIGHT, 0.38),
};

export type AtmosphereName = Atmo028PresetName;
export const DEFAULT_ATMOSPHERE: AtmosphereName = 'overcast-dusk';
/** 026 之前的旧预设名（URL 调试兼容） */
const ALIASES: Record<string, AtmosphereName> = { 'melancholy-dusk': 'overcast-dusk', 'lonely-night': 'rain-night' };

export function resolveAtmosphereName(name: string | null | undefined): AtmosphereName | null {
  if (!name) return null;
  if (name in ATMOSPHERE_PRESETS) return name as AtmosphereName;
  return ALIASES[name] ?? null;
}

/** 当前使用的预设。可用 URL ?atmo=rain-night 临时切换对比 */
export function getAtmosphere(): AtmospherePreset {
  const fromUrl = resolveAtmosphereName(new URLSearchParams(location.search).get('atmo'));
  return ATMOSPHERE_PRESETS[fromUrl ?? DEFAULT_ATMOSPHERE];
}
