import * as THREE from 'three';

/**
 * v0.1-017 汐的材质（art/tools/README §5、char-xi.glb materials[].extras）：
 * - 三个材质（body / face / hair）都用 tex-xi-ramp 做卡通明暗：直射漫反射按半 Lambert 采样 ramp，暗部 = 冷色（XI_SHADOW_TINT），
 *   不引入任何暖色（环境不发暖光；暖光只来自风灯）。镜面照常（乘 ramp，不在暗部发亮）。
 * - 脸：SDF 脸部阴影代替 N·L。TEXCOORD_1 = 脸正面投影 UV；θ = 光的水平角 / 90°（0 = 正前方），亮 = θ ≤ sdf；
 *   光从角色右侧（−X）来时直接采样，从左侧（+X）来时 u → 1 − u。
 * - 湿痕：ORM.a = 湿润遮罩。color *= 1 − 0.22·wet·uWetness；roughness = mix(rough, 0.28, wet·uWetness)。
 * 以下纯函数与 shader 同一公式（scripts/verify-xi.mjs 校验）。
 */

/** 暗部冷色（线性）：灰蓝，不偏暖 */
export const XI_SHADOW_TINT: readonly [number, number, number] = [0.3, 0.34, 0.42];
/** 湿了以后的粗糙度 */
export const XI_WET_ROUGHNESS = 0.28;
/** 湿了以后颜色变暗比例 */
export const XI_WET_DARKEN = 0.22;
/** SDF 明暗交界的软化宽度（θ 单位） */
export const XI_SDF_SOFT = 0.02;
/**
 * r4：光接近竖直时 θ 不稳——θ 只看光的水平方位，和仰角无关；仰角 87° 的点光源，脸挪 3 cm 方位就能转半圈，
 * θ 在 0（全亮）和 2（全暗）之间跳，u 也来回翻（逐片元方向不同时还会成块花脸）。
 * 处理：按光的水平分量长度 h（单位光向量，= cos 仰角）把 θ 往 0（正前方 = 全亮，和正上方的原约定一致）淡出：
 * θ' = θ · smoothstep(LO, HI, h)。h ≥ HI（仰角 ≤ 69.5°）完全不变；h ≤ LO（仰角 ≥ 84.3°）按正上方算。
 */
export const XI_SDF_TOP_LO = 0.1;
export const XI_SDF_TOP_HI = 0.35;

const smooth01 = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function xiWetColor(wet: number, wetness: number): number {
  return 1 - XI_WET_DARKEN * wet * wetness;
}

export function xiWetRoughness(rough: number, wet: number, wetness: number): number {
  const k = wet * wetness;
  return rough + (XI_WET_ROUGHNESS - rough) * k;
}

/**
 * 脸部 SDF 采样参数：光方向（指向光源，角色局部坐标：+Z 前、+X 左、+Y 上）→ θ（水平角 / 90°）和是否翻转 u。
 * 光从正上方（没有水平分量）按正前方算（θ = 0）。
 */
export function xiFaceSdfParams(lightLocal: { x: number; y: number; z: number }): { theta: number; flipU: boolean } {
  const h = Math.hypot(lightLocal.x, lightLocal.z);
  if (h < 1e-6) return { theta: 0, flipU: false };
  const len = Math.hypot(h, lightLocal.y);
  const ang = Math.acos(Math.max(-1, Math.min(1, lightLocal.z / h)));
  return { theta: (ang / (Math.PI / 2)) * smooth01(XI_SDF_TOP_LO, XI_SDF_TOP_HI, h / len), flipU: lightLocal.x > 0 };
}

/** 亮 = θ ≤ sdf（硬判定；shader 里在 ±XI_SDF_SOFT 内平滑） */
export function xiFaceLit(theta: number, sdf: number): boolean {
  return theta <= sdf;
}

export type XiMaterialKind = 'body' | 'face' | 'hair';

export function xiMaterialKind(name: string): XiMaterialKind | null {
  if (/^mat-char-xi-face/.test(name)) return 'face';
  if (/^mat-char-xi-hair/.test(name)) return 'hair';
  if (/^mat-char-xi-body/.test(name)) return 'body';
  return null;
}

export interface XiLook {
  /** 0 = 干，1 = 全湿（按 ORM.a 遮罩分布） */
  wetness: number;
  /** 打过补丁的材质数（测试 / dev） */
  readonly patched: number;
  /** 每帧：更新脸的朝向（角色根节点世界矩阵 → 前 / 左轴） */
  update(): void;
}

const RE_DIRECT_XI = /* glsl */ `
uniform sampler2D uXiRamp;
uniform vec3 uXiShadowTint;
#ifdef XI_SDF_FACE
uniform sampler2D uXiSdf;
uniform vec3 uXiFwd;
uniform vec3 uXiLeft;
uniform vec3 uXiUp;
varying vec2 vXiFaceUv;
#endif
void RE_Direct_Xi( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
#ifdef XI_SDF_FACE
  // 光方向（view 空间）→ 角色水平面：θ = 与正前方的水平夹角 / 90°；从左侧（+X）来时 u 翻转
  vec3 fwd = normalize( ( viewMatrix * vec4( uXiFwd, 0.0 ) ).xyz );
  vec3 left = normalize( ( viewMatrix * vec4( uXiLeft, 0.0 ) ).xyz );
  vec3 up = normalize( ( viewMatrix * vec4( uXiUp, 0.0 ) ).xyz );
  vec3 lh = directLight.direction - up * dot( directLight.direction, up );
  float hl = length( lh );
  float theta = hl < 1e-5 ? 0.0 : acos( clamp( dot( lh / hl, fwd ), -1.0, 1.0 ) ) / 1.5707963;
  // 光接近竖直：θ 往 0 淡出（xiFaceSdfParams 同式；directLight.direction 是单位向量，hl = cos 仰角）
  theta *= smoothstep( ${XI_SDF_TOP_LO.toFixed(3)}, ${XI_SDF_TOP_HI.toFixed(3)}, hl );
  vec2 fuv = vXiFaceUv;
  if ( hl >= 1e-5 && dot( lh, left ) > 0.0 ) fuv.x = 1.0 - fuv.x;
  float sdf = texture2D( uXiSdf, fuv ).r;
  float lit = smoothstep( theta - ${XI_SDF_SOFT.toFixed(3)}, theta + ${XI_SDF_SOFT.toFixed(3)}, sdf );
#else
  float nl = dot( geometryNormal, directLight.direction );
  float lit = texture2D( uXiRamp, vec2( clamp( nl * 0.5 + 0.5, 0.004, 0.996 ), 0.5 ) ).r;
#endif
  vec3 shade = mix( uXiShadowTint, vec3( 1.0 ), lit );
  reflectedLight.directDiffuse += directLight.color * shade * BRDF_Lambert( material.diffuseContribution );
  ReflectedLight spec = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, spec );
  reflectedLight.directSpecular += spec.directSpecular * lit;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Xi
`;

const WET_GLSL = /* glsl */ `
#ifdef USE_ROUGHNESSMAP
  float xiWet = texelRoughness.a * uXiWetness;
  roughnessFactor = mix( roughnessFactor, ${XI_WET_ROUGHNESS.toFixed(2)}, xiWet );
  diffuseColor.rgb *= 1.0 - ${XI_WET_DARKEN.toFixed(2)} * xiWet;
#endif
`;

/**
 * 给 char-xi 模型换上汐的材质（克隆材质，不动资源缓存里的原件）。ramp / sdf 没加载（art=0 或缺文件）时不打补丁，保持 PBR。
 * 返回的 XiLook 由场景每帧 update、按需设 wetness。
 */
export function applyXiMaterials(model: THREE.Object3D, tex: { ramp: THREE.Texture | null; sdf: THREE.Texture | null }): XiLook {
  const uniforms = {
    uXiRamp: { value: tex.ramp },
    uXiShadowTint: { value: new THREE.Vector3(...XI_SHADOW_TINT) },
    uXiWetness: { value: 0 },
    uXiSdf: { value: tex.sdf },
    uXiFwd: { value: new THREE.Vector3(0, 0, 1) },
    uXiLeft: { value: new THREE.Vector3(1, 0, 0) },
    uXiUp: { value: new THREE.Vector3(0, 1, 0) },
  };
  if (tex.ramp) {
    tex.ramp.wrapS = tex.ramp.wrapT = THREE.ClampToEdgeWrapping;
    tex.ramp.needsUpdate = true;
  }
  const clones = new Map<THREE.Material, THREE.Material>();
  let patched = 0;
  const patch = (m: THREE.Material): THREE.Material => {
    const kind = xiMaterialKind(m.name);
    if (!kind || !tex.ramp || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
    let c = clones.get(m);
    if (c) return c;
    const mat = (m as THREE.MeshStandardMaterial).clone();
    const face = kind === 'face' && !!tex.sdf;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (face) {
        shader.defines = { ...(shader.defines ?? {}), XI_SDF_FACE: '' };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vXiFaceUv;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvXiFaceUv = uv1;');
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uXiWetness;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + WET_GLSL)
        .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + RE_DIRECT_XI);
    };
    mat.customProgramCacheKey = () => `xi-${kind}${face ? '-sdf' : ''}`;
    mat.needsUpdate = true;
    clones.set(m, (c = mat));
    patched++;
    return c;
  };
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(patch) : patch(mesh.material);
  });
  const e = new THREE.Matrix4();
  return {
    get wetness() {
      return uniforms.uXiWetness.value;
    },
    set wetness(v: number) {
      uniforms.uXiWetness.value = Math.max(0, Math.min(1, v));
    },
    get patched() {
      return patched;
    },
    update() {
      model.updateWorldMatrix(true, false);
      e.extractRotation(model.matrixWorld);
      e.extractBasis(uniforms.uXiLeft.value, uniforms.uXiUp.value, uniforms.uXiFwd.value);
      uniforms.uXiLeft.value.normalize();
      uniforms.uXiUp.value.normalize();
      uniforms.uXiFwd.value.normalize();
    },
  };
}
