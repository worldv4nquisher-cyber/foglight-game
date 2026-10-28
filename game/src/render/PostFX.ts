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

/**
 * 后处理管线（pmndrs/postprocessing + N8AO）：
 *
 *   RenderPass(HDR, HalfFloat)
 *     → N8AOPostPass（环境光遮蔽，standard 档关闭）
 *     → EffectPass[ Bloom → ACES 色调映射 → 冷色低饱和调色(色相/饱和度、亮度/对比度) → 暗角 → 胶片颗粒 ]
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

  private bloom: BloomEffect | null = null;
  private toneMapping: ToneMappingEffect | null = null;
  private hueSat: HueSaturationEffect | null = null;
  private brightContrast: BrightnessContrastEffect | null = null;
  private vignette: VignetteEffect | null = null;
  private noise: NoiseEffect | null = null;

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
    this.hueSat = new HueSaturationEffect();
    this.brightContrast = new BrightnessContrastEffect();
    this.vignette = new VignetteEffect();
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });

    this.gradePass = new EffectPass(
      camera,
      this.bloom,
      this.toneMapping,
      this.hueSat,
      this.brightContrast,
      this.vignette,
      this.noise,
    );
    this.composer.addPass(this.gradePass);

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
    if (this.hueSat) {
      this.hueSat.hue = a.grade.hue;
      this.hueSat.saturation = a.grade.saturation;
    }
    if (this.brightContrast) {
      this.brightContrast.brightness = a.grade.brightness;
      this.brightContrast.contrast = a.grade.contrast;
    }
    if (this.vignette) {
      this.vignette.offset = a.vignette.offset;
      this.vignette.darkness = a.vignette.darkness;
    }
    if (this.noise) this.noise.blendMode.opacity.value = a.grain;
    if (this.aoPass) {
      const c = this.aoPass.configuration;
      c.aoRadius = a.ao.radius;
      c.distanceFalloff = a.ao.distanceFalloff;
      c.intensity = a.ao.intensity;
      c.color = new THREE.Color(a.ao.color);
    }
  }

  applyQuality(q: QualityPreset): void {
    const rebuild = q.postprocessing !== this.quality.postprocessing;
    this.quality = q;
    if (this.aoPass) {
      this.aoPass.enabled = q.ao;
      this.aoPass.setQualityMode(q.aoQuality);
      this.aoPass.configuration.halfRes = q.aoHalfRes;
    }
    if (this.smaaPass) this.smaaPass.enabled = q.smaa;
    if (this.bloom) this.bloom.mipmapBlurPass.levels = q.bloomMipmapBlur ? 8 : 4;
    if (rebuild && q.postprocessing && this.scene && !this.renderPass) this.build();
    this.composer.setSize(this.width, this.height, false);
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
    for (const p of [this.renderPass, this.aoPass, this.gradePass, this.smaaPass]) p?.dispose();
    this.renderPass = this.aoPass = this.gradePass = this.smaaPass = null;
    this.bloom = this.toneMapping = this.hueSat = this.brightContrast = this.vignette = this.noise = null;
  }

  dispose(): void {
    this.disposePasses();
    this.composer.dispose();
  }
}
