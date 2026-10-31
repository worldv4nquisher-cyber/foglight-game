import { lutKeepSat } from '@/config/debug';
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { AtmospherePreset } from '@/config/atmosphere';
import type { QualityPreset } from '@/config/quality';
import { LutEffect, prepareLutTexture } from './LutEffect';
import { LensDropletsEffect } from './LensDropletsEffect';
import { ATMO028 } from '@/config/atmosphere028';

/** 调色 LUT 来源（Game 注入 AssetLoader；文件名 → manifest key = 去掉 .png） */
export type LutSource = (key: string) => THREE.Texture | null;

/** URL ?lut=0 关掉 LUT（回到 026 的色相 / 饱和度 / 亮度 / 对比度调色）；?lut=identity 换成 lut-identity（校验方向用） */
function lutOverride(): string | null {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('lut');
}

/**
 * 后处理管线（pmndrs/postprocessing + N8AO）：
 *
 *   RenderPass(HDR, HalfFloat)
 *     → N8AOPostPass（环境光遮蔽，standard 档关闭）
 *     → EffectPass[ Bloom → ACES 色调映射 → 028 调色 LUT → 冷色低饱和调色(色相/饱和度、亮度/对比度) → 暗角 → 胶片颗粒 ]
 *
 * v0.1-028：LUT 在色调映射之后（LutEffect 内部 linear → sRGB 查表 → linear）。LUT 生效时色相 / 饱和度 / 亮度 / 对比度置中性
 * （调色交给 LUT，避免调两遍）；LUT 缺失（?art=0）/ 画质档 lut 关 / ?lut=0 时回到预设 grade。
 *     → EffectPass[ 028 镜头水滴（ultra 过场下雨才开） ]
 *     → EffectPass[ SMAA ]
 *
 * 参数来源：效果强度来自「气氛预设」(config/atmosphere.ts)，开关与质量来自画质档位(config/quality.ts)。
 * 场景切换时调用 setScene() 重建管线；画质切换调用 applyQuality()；调氛围调用 applyAtmosphere()。
 */
export class PostFX {
  private composer: EffectComposer;
  private renderPass: RenderPass | null = null;
  private aoPass: N8AOPostPass | null = null;
  private gradePass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  /** 028 镜头水滴（单独一个 pass：要按偏移采样画面；强度 0 时关掉） */
  private lensPass: EffectPass | null = null;
  private lens: LensDropletsEffect | null = null;
  private lensStrength = 0;

  private bloom: BloomEffect | null = null;
  private toneMapping: ToneMappingEffect | null = null;
  private hueSat: HueSaturationEffect | null = null;
  private brightContrast: BrightnessContrastEffect | null = null;
  private vignette: VignetteEffect | null = null;
  private noise: NoiseEffect | null = null;
  private lutEffect: LutEffect | null = null;
  private lutSource: LutSource | null = null;

  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private quality: QualityPreset;
  private atmosphere: AtmospherePreset | null = null;
  private width = 1;
  private height = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    quality: QualityPreset,
  ) {
    this.quality = quality;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0, // 用 SMAA 代替 MSAA，避免与 N8AO 的深度读取冲突
      stencilBuffer: false,
    });
  }

  /** 当前是否有可用管线 */
  get active(): boolean {
    return this.quality.postprocessing && this.scene !== null;
  }

  /** 为场景/相机（重新）构建管线；scene 为 null 时清空管线（如加载界面直接渲染） */
  setScene(scene: THREE.Scene | null, camera: THREE.Camera | null, atmosphere?: AtmospherePreset): void {
    this.disposePasses();
    this.scene = scene;
    this.camera = camera;
    if (atmosphere) this.atmosphere = atmosphere;
    if (!scene || !camera) return;
    this.build();
  }

  private build(): void {
    const scene = this.scene;
    const camera = this.camera;
    if (!scene || !camera) return;
    const a = this.atmosphere;

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.aoPass = new N8AOPostPass(scene, camera, this.width, this.height);
    this.composer.addPass(this.aoPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: a?.bloom.intensity ?? 0.5,
      luminanceThreshold: a?.bloom.threshold ?? 0.8,
      luminanceSmoothing: a?.bloom.smoothing ?? 0.25,
      radius: a?.bloom.radius ?? 0.7,
    });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.lutEffect = new LutEffect();
    this.lutEffect.keepSat = lutKeepSat;
    this.hueSat = new HueSaturationEffect();
    this.brightContrast = new BrightnessContrastEffect();
    this.vignette = new VignetteEffect();
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });

    this.gradePass = new EffectPass(
      camera,
      this.bloom,
      this.toneMapping,
      this.lutEffect,
      this.hueSat,
      this.brightContrast,
      this.vignette,
      this.noise,
    );
    this.composer.addPass(this.gradePass);

    const ld = ATMO028.rainTiers.ultra.lensDroplets;
    this.lens = new LensDropletsEffect({ refraction: ld.refraction, tilesPerScreenH: ld.tilesPerScreenH });
    this.lens.map = this.lutSource?.(ATMO028.textures.lensDroplets) ?? null;
    this.lensPass = new EffectPass(camera, this.lens);
    this.composer.addPass(this.lensPass);
    this.setLensDroplets(this.lensStrength);

    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.composer.addPass(this.smaaPass);

    this.applyAtmosphere(a);
    this.applyQuality(this.quality);
    this.composer.setSize(this.width, this.height, false);
  }

  applyAtmosphere(a: AtmospherePreset | null): void {
    this.atmosphere = a;
    if (!a) return;
    this.renderer.toneMappingExposure = a.exposure;
    if (this.bloom) {
      this.bloom.intensity = a.bloom.intensity;
      this.bloom.luminanceMaterial.threshold = a.bloom.threshold;
      this.bloom.luminanceMaterial.smoothing = a.bloom.smoothing;
      this.bloom.mipmapBlurPass.radius = a.bloom.radius;
    }
    this.applyGrade();
    if (this.vignette) {
      this.vignette.offset = a.vignette.offset;
      this.vignette.darkness = a.vignette.darkness;
    }
    if (this.noise) this.noise.blendMode.opacity.value = this.quality.filmGrain ? a.grain : 0;
    if (this.aoPass) {
      const c = this.aoPass.configuration;
      c.aoRadius = a.ao.radius;
      c.distanceFalloff = a.ao.distanceFalloff;
      c.intensity = a.ao.intensity;
      c.color = new THREE.Color(a.ao.color);
    }
  }

  /** Game 注入：按 key 取 LUT 贴图（缺失 → null） */
  setLutSource(src: LutSource | null): void {
    this.lutSource = src;
    this.applyGrade();
  }

  /** 镜头水滴强度 0..1（场景按「ultra + 过场 + 下雨」带 fadeIn 驱动）；贴图缺失时始终关 */
  setLensDroplets(strength: number): void {
    this.lensStrength = strength;
    if (!this.lens || !this.lensPass) return;
    if (!this.lens.map) this.lens.map = this.lutSource?.(ATMO028.textures.lensDroplets) ?? null;
    const on = strength > 0.001 && !!this.lens.map;
    this.lens.strength = on ? strength : 0;
    this.lensPass.enabled = on;
  }

  get lensDroplets(): number {
    return this.lensPass?.enabled ? this.lensStrength : 0;
  }

  /** 调试 / 截图：运行时覆盖 LUT（'0' 关、'identity' 单位 LUT、null 回到 URL / 预设） */
  setLutOverride(o: '0' | 'identity' | null): void {
    this.lutDebug = o;
    this.applyGrade();
  }
  private lutDebug: '0' | 'identity' | null = null;

  /** 当前生效的 LUT key（null = 没用 LUT，走预设 grade） */
  get activeLut(): string | null {
    return this.activeLutKey;
  }
  private activeLutKey: string | null = null;

  /** LUT 有就用 LUT（grade 置中性），没有回到预设 grade */
  private applyGrade(): void {
    const a = this.atmosphere;
    if (!a) return;
    const o = this.lutDebug ?? lutOverride();
    let key: string | null = this.quality.lut && o !== '0' ? (o === 'identity' ? 'lut-identity' : a.lut.replace(/\.png$/, '')) : null;
    let tex = key && this.lutSource ? this.lutSource(key) : null;
    if (!tex) key = null;
    else if (tex.flipY || tex.colorSpace !== THREE.NoColorSpace || tex.generateMipmaps) tex = prepareLutTexture(tex);
    this.activeLutKey = key;
    if (this.lutEffect) this.lutEffect.lut = tex;
    const g = tex ? { hue: 0, saturation: 0, brightness: 0, contrast: 0 } : a.grade;
    if (this.hueSat) {
      this.hueSat.hue = g.hue;
      this.hueSat.saturation = g.saturation;
    }
    if (this.brightContrast) {
      this.brightContrast.brightness = g.brightness;
      this.brightContrast.contrast = g.contrast;
    }
  }

  applyQuality(q: QualityPreset): void {
    const rebuild = q.postprocessing !== this.quality.postprocessing;
    this.quality = q;
    // GTAO 现阶段用 N8AO 实现：off = 只用烘焙 AO
    if (this.aoPass) {
      this.aoPass.enabled = q.ao.gtao !== 'off';
      this.aoPass.setQualityMode(q.aoQuality);
      this.aoPass.configuration.halfRes = q.ao.gtao === 'half';
    }
    // TAA 在 025/026 做，之前极致档也用 SMAA
    if (this.smaaPass) this.smaaPass.enabled = q.antialias === 'SMAA' || q.antialias === 'TAA';
    // 三档 bloom 都开，只差 mip 级数（6 / 5 / 4）；改级数会重建 mip 链，没变就不碰
    if (this.bloom && this.bloom.mipmapBlurPass.levels !== q.bloom.mipLevels) this.bloom.mipmapBlurPass.levels = q.bloom.mipLevels;
    if (this.noise) this.noise.blendMode.opacity.value = q.filmGrain ? (this.atmosphere?.grain ?? 0) : 0;
    if (this.vignette) this.vignette.blendMode.opacity.value = q.vignette ? 1 : 0;
    this.applyGrade();
    if (rebuild && q.postprocessing && this.scene && !this.renderPass) this.build();
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer.setSize(width, height, false);
  }

  render(delta: number): void {
    this.composer.render(delta);
  }

  private disposePasses(): void {
    this.composer.removeAllPasses();
    for (const p of [this.renderPass, this.aoPass, this.gradePass, this.lensPass, this.smaaPass]) p?.dispose();
    this.renderPass = this.aoPass = this.gradePass = this.lensPass = this.smaaPass = null;
    this.lens = null;
    this.bloom = this.toneMapping = this.hueSat = this.brightContrast = this.vignette = this.noise = this.lutEffect = null;
  }

  dispose(): void {
    this.disposePasses();
    this.composer.dispose();
  }
}
