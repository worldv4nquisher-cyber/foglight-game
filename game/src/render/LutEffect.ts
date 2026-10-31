import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';

/**
 * v0.1-028 调色 LUT（README-028 §6，采样同 art/tools/preview/atmo028.js LUT_GLSL）：
 * - 32³ 展开成 1024×32 PNG：第 b 片 = B（横排），片内 x = R，PNG 自上而下 G 0→1；
 * - 贴图 flipY = false、NoColorSpace、LinearFilter、无 mip（prepareLutTexture）；
 * - 作用在色调映射 + sRGB 编码之后（display space）：EffectPass 里排在 ToneMapping 后面，
 *   中间缓冲是线性的，所以这里先 linear → sRGB，查表（两片之间按 B 线性插值），再 sRGB → linear 交给后面的效果 / 输出编码。
 * lut-identity.png 套上去画面不变（scripts/verify-atmo028.mjs 的 CPU 查表 + 冒烟 lut 校验）。
 */
const fragmentShader = /* glsl */ `
uniform sampler2D tLut;
uniform float lutOn;
uniform float lutKeepSat;
vec3 lutToSRGB(vec3 c) {
  return mix(c * 12.92, pow(c, vec3(0.41666)) * 1.055 - 0.055, step(0.0031308, c));
}
vec3 lutToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 applyLut(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * 31.0;
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, 31.0);
  vec2 q = vec2(c.r * 31.0 + 0.5, c.g * 31.0 + 0.5);
  vec3 a0 = texture2D(tLut, vec2((b0 * 32.0 + q.x) / 1024.0, q.y / 32.0)).rgb;
  vec3 a1 = texture2D(tLut, vec2((b1 * 32.0 + q.x) / 1024.0, q.y / 32.0)).rgb;
  return mix(a0, a1, b - b0);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (lutOn > 0.5) {
    vec3 s = lutToSRGB(clamp(c, 0.0, 1.0));
    vec3 o = applyLut(s);
    // r4 第 6 项对比（?lutKeepSat，默认 0 = 原样）：亮度用 LUT 的，色度往 LUT 之前拉回 lutKeepSat
    if (lutKeepSat > 0.0) {
      const vec3 W = vec3(0.2126, 0.7152, 0.0722);
      float yo = dot(o, W);
      o = clamp(vec3(yo) + mix(o - vec3(yo), s - vec3(dot(s, W)), lutKeepSat), 0.0, 1.0);
    }
    c = lutToLinear(o);
  }
  outputColor = vec4(c, inputColor.a);
}
`;

/** LUT 贴图的采样设置（原地修改） */
export function prepareLutTexture(t: THREE.Texture): THREE.Texture {
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export class LutEffect extends Effect {
  constructor() {
    super('LutEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['tLut', new THREE.Uniform(null)],
        ['lutOn', new THREE.Uniform(0)],
        ['lutKeepSat', new THREE.Uniform(0)],
      ]),
    });
  }

  /** null = 关（画面不经 LUT） */
  set lut(t: THREE.Texture | null) {
    this.uniforms.get('tLut')!.value = t;
    this.uniforms.get('lutOn')!.value = t ? 1 : 0;
  }

  /** r4 第 6 项对比：LUT 后保留多少原色度（0 = 原样） */
  set keepSat(v: number) {
    this.uniforms.get('lutKeepSat')!.value = Math.max(0, Math.min(1, v));
  }
  get lut(): THREE.Texture | null {
    return this.uniforms.get('tLut')!.value as THREE.Texture | null;
  }
}

/** CPU 版查表（与着色器同一公式；校验 / 测试用）。lut = 1024×32 RGB(A) 像素，0..255；c = sRGB 0..1 */
export function applyLutCpu(lut: { data: ArrayLike<number>; width: number; channels: number }, c: [number, number, number]): [number, number, number] {
  const fetch = (u: number, v: number): number[] => {
    // 线性过滤（同 GPU LinearFilter），u / v 为 0..1 纹理坐标
    const x = u * lut.width - 0.5;
    const y = v * 32 - 0.5;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(lut.width - 1, x0 + 1);
    const y1 = Math.min(31, y0 + 1);
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    const px = (xx: number, yy: number, k: number): number => lut.data[(yy * lut.width + xx) * lut.channels + k]! / 255;
    return [0, 1, 2].map((k) => {
      const a = px(x0, y0, k) * (1 - fx) + px(x1, y0, k) * fx;
      const b = px(x0, y1, k) * (1 - fx) + px(x1, y1, k) * fx;
      return a * (1 - fy) + b * fy;
    });
  };
  const [r, g, bl] = c.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  const b = bl * 31;
  const b0 = Math.floor(b);
  const b1 = Math.min(b0 + 1, 31);
  const qx = r * 31 + 0.5;
  const qy = (g * 31 + 0.5) / 32;
  const a0 = fetch((b0 * 32 + qx) / 1024, qy);
  const a1 = fetch((b1 * 32 + qx) / 1024, qy);
  return [0, 1, 2].map((k) => a0[k]! + (a1[k]! - a0[k]!) * (b - b0)) as [number, number, number];
}
