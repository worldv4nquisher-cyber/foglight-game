import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * v0.1-028 镜头水滴（rainTiers.ultra.lensDroplets：仅 ultra、仅过场、下雨时；fadeIn 0.6 s）。
 * tex-lens-droplets-normal：RG = 法线，A = 水珠遮罩；按屏幕高度平铺 tilesPerScreenH 次，
 * 水珠处按法线偏移采样画面（refraction = uv 偏移量），轻微提亮。强度 0 时整个 pass 关掉。
 */
const fragmentShader = /* glsl */ `
uniform sampler2D tDrops;
uniform float strength;
uniform float refraction;
uniform float tiles;
uniform float aspect;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 n = texture2D(tDrops, vec2(uv.x * aspect, uv.y) * tiles);
  float m = n.a * strength;
  vec2 off = (n.xy * 2.0 - 1.0) * refraction * m;
  vec3 c = texture2D(inputBuffer, uv - off).rgb;
  outputColor = vec4(mix(inputColor.rgb, c * 1.04, m), inputColor.a);
}
`;

export class LensDropletsEffect extends Effect {
  constructor(opts: { refraction: number; tilesPerScreenH: number }) {
    super('LensDropletsEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['tDrops', new THREE.Uniform(null)],
        ['strength', new THREE.Uniform(0)],
        ['refraction', new THREE.Uniform(opts.refraction)],
        ['tiles', new THREE.Uniform(opts.tilesPerScreenH)],
        ['aspect', new THREE.Uniform(16 / 9)],
      ]),
    });
  }

  set map(t: THREE.Texture | null) {
    if (t) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
    }
    this.uniforms.get('tDrops')!.value = t;
  }

  get map(): THREE.Texture | null {
    return this.uniforms.get('tDrops')!.value as THREE.Texture | null;
  }

  set strength(v: number) {
    this.uniforms.get('strength')!.value = v;
  }

  get strength(): number {
    return this.uniforms.get('strength')!.value as number;
  }

  override setSize(width: number, height: number): void {
    this.uniforms.get('aspect')!.value = width / Math.max(1, height);
  }
}
