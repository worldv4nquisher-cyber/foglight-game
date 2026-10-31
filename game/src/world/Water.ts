import * as THREE from 'three';
import { ATMO028 } from '@/config/atmosphere028';
import type { PlanarReflection } from '@/render/Reflections';
import { SEABED, seabedTexture, type SeabedMap } from './seabed';

/** 028 水面贴图 key（manifest common） */
export const WATER_NORMAL_KEY = ATMO028.textures.waterNormal;
export const RAIN_RIPPLE_KEY = ATMO028.textures.rainRipple;

/** 雨圈 flipbook 参数（按画质档：ATMO028.rainTiers[tier].ripples） */
export interface RippleOpts {
  enabled: boolean;
  tileM: number;
  fps: number;
  strength: number;
  layers: number;
}

/**
 * 占位水面：MeshStandardMaterial + 顶点着色器里叠加几组 Gerstner 风格正弦波（GPU，零 CPU 开销），
 * 法线由解析导数计算，配合低粗糙度得到暗沉、缓慢起伏的海面。以后可替换为带反射/折射的正式水体。
 *
 * v0.1-028（README-028 §5，照搬 atmo028.js waterShader 的法线部分）：setDetail() 给了贴图后，片元里在波浪法线上叠
 * - 两层 tex-water-normal（2048，裁定 18）：14 m / 5.3 m 平铺，各自 scroll 漂移，强度 = 预设 water.normalScale；
 * - 下雨时叠雨圈 flipbook tex-rain-ripple-normal（8×8 共 64 帧、24 fps、tile 1.5 m），用 textureGrad 采样，
 *   梯度长度夹到 mip ≤ 3（maxMipLevel），否则帧格边缘渗色；ultra 第二层旋转 37° ×1.37 错 4 帧打散平铺；12→30 m 淡出。
 * 菲涅尔 / 反射扭曲（presets.*.water.fresnel / reflectDistort）要平面反射，留给 025；泡沫带同样未接（见 028 报告）。
 */
export class Water extends THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  private uniforms = {
    uTime: { value: 0 },
    uWaveScale: { value: 1 },
    tWN: { value: null as THREE.Texture | null },
    tWR: { value: null as THREE.Texture | null },
    uL0: { value: new THREE.Vector4() },
    uL1: { value: new THREE.Vector4() },
    uNScale: { value: 0.35 },
    uRipK: { value: 0 },
    uRipTile: { value: 1 / 1.5 },
    uRipL2: { value: 0 },
    uRipFrame: { value: new THREE.Vector2() },
    uRipMaxGrad: { value: 8 / 1024 },
    // 025 平面反射（PlanarReflection 共享 tReflect / uReflMatrix / uReflK；没挂 = k 0）
    tReflect: { value: null as THREE.Texture | null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflK: { value: 0 },
    uFres: { value: new THREE.Vector2(0.32, 0.92) },
    uDistort: { value: 0.035 },
    // 1031 S1 沙斑（裁定 23 a）：海床高度图压浪（没挂 = uSeabedOn 0，浪不变）
    tSeabed: { value: null as THREE.Texture | null },
    uSeabedRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uSeabedOn: { value: 0 },
    uSeabedEmpty: { value: SEABED.empty as number },
    uShoal: { value: new THREE.Vector2(SEABED.shoal[0], SEABED.shoal[1]) },
  };
  /** 平板半边长（m，025 倒影视锥判定） */
  readonly halfExtent: number;
  private ripple: RippleOpts | null = null;
  private raining = false;

  /**
   * @param waveScale 波浪振幅倍数（潮汐分区的小片水面用 0.3 左右，免得浪高盖过 0.3 m 的送回判定）
   */
  constructor(size = 600, segments = 200, color = 0x1b252c, waveScale = 1) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.18,
      metalness: 0.0,
      envMapIntensity: 0.6,
    });
    super(geometry, material);
    this.name = 'water';
    this.receiveShadow = true;
    this.uniforms.uWaveScale.value = waveScale;
    this.halfExtent = size / 2;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uWaveScale = this.uniforms.uWaveScale;
      for (const k of ['tSeabed', 'uSeabedRect', 'uSeabedOn', 'uSeabedEmpty', 'uShoal'] as const) shader.uniforms[k] = this.uniforms[k];
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uTime;
          uniform float uWaveScale;
          uniform sampler2D tSeabed;
          uniform vec4 uSeabedRect;
          uniform float uSeabedOn, uSeabedEmpty;
          uniform vec2 uShoal;
          // 浅水压浪：水深 = 水位（模型原点 y）− 海床；露出来的沙上 0，水深 ≥ uShoal.y 全振幅
          float shoal(vec2 wxz) {
            if (uSeabedOn < 0.5) return 1.0;
            vec2 uv = (wxz - uSeabedRect.xy) * uSeabedRect.zw;
            float bed = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? uSeabedEmpty : textureLod(tSeabed, uv, 0.0).r;
            return smoothstep(uShoal.x, uShoal.y, modelMatrix[3].y - bed);
          }
          // dir.xy, 振幅, 波长, 速度
          vec3 waveSum(vec2 p, out vec2 grad) {
            const int N = 4;
            vec4 W[N];
            W[0] = vec4(normalize(vec2(1.0, 0.3)), 0.18, 9.0);
            W[1] = vec4(normalize(vec2(-0.4, 1.0)), 0.10, 5.5);
            W[2] = vec4(normalize(vec2(0.7, -0.8)), 0.06, 3.1);
            W[3] = vec4(normalize(vec2(-1.0, -0.2)), 0.035, 1.7);
            float h = 0.0;
            grad = vec2(0.0);
            for (int i = 0; i < N; i++) {
              float k = 6.28318 / W[i].w;
              float c = sqrt(9.8 / k) * 0.6;
              float f = k * (dot(W[i].xy, p) - c * uTime);
              h += W[i].z * uWaveScale * sin(f);
              grad += W[i].z * uWaveScale * k * cos(f) * W[i].xy;
            }
            return vec3(0.0, h, 0.0);
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `vec2 wGrad;
          vec3 wOffset = waveSum(position.xz, wGrad);
          float wShoal = shoal((modelMatrix * vec4(position, 1.0)).xz);
          wOffset *= wShoal;
          wGrad *= wShoal;
          vec3 objectNormal = normalize(vec3(-wGrad.x, 1.0, -wGrad.y));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = position + wOffset;');
      this.injectReflection(shader);
      if (!this.hasDetail) return;
      for (const k of ['tWN', 'tWR', 'uL0', 'uL1', 'uNScale', 'uRipK', 'uRipTile', 'uRipL2', 'uRipFrame', 'uRipMaxGrad'] as const) shader.uniforms[k] = this.uniforms[k];
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vWaterW;
          uniform sampler2D tWN, tWR;
          uniform vec4 uL0, uL1;
          uniform vec2 uRipFrame;
          uniform float uNScale, uRipK, uRipTile, uRipL2, uRipMaxGrad;
          // 梯度长度夹到 uRipMaxGrad（= 2^maxMip / 贴图边长）→ 采样 mip ≤ maxMipLevel，帧格边缘不渗色
          vec2 capGrad(vec2 g) { float l = length(g); return g * min(1.0, uRipMaxGrad / max(l, 1e-8)); }
          vec2 rippleN(vec2 ru, vec2 frame) {
            vec2 gx = capGrad(dFdx(ru) / 8.0), gy = capGrad(dFdy(ru) / 8.0);
            return textureGrad(tWR, (frame + fract(ru)) / 8.0, gx, gy).xy * 2.0 - 1.0;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          {
            vec2 wxz = vWaterW.xz;
            vec2 dn = (texture2D(tWN, wxz * uL0.xy + uL0.zw).xy * 2.0 - 1.0) + (texture2D(tWN, wxz * uL1.xy + uL1.zw).xy * 2.0 - 1.0);
            dn *= uNScale;
            if (uRipK > 0.0) {
              float dist = length(cameraPosition - vWaterW);
              vec2 rn = rippleN(wxz * uRipTile, uRipFrame);
              if (uRipL2 > 0.5) {
                vec2 r2 = mat2(0.8, -0.6, 0.6, 0.8) * wxz * uRipTile * 1.37 + 0.31;
                rn += rippleN(r2, mod(uRipFrame + vec2(4.0), 8.0));
                rn *= 0.7;
              }
              dn += rn * uRipK * (1.0 - smoothstep(12.0, 30.0, dist));
            }
            vec3 nW = inverseTransformDirection(normal, viewMatrix);
            nW = normalize(nW + vec3(dn.x, 0.0, dn.y));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`,
        );
    };
    material.customProgramCacheKey = () => (this.hasDetail ? 'water028' : 'water');
  }

  /**
   * 025：平面反射。投影坐标用「浪位移后的点压回平均水位」（镜像平面 = 平均水位，倒影不随网格起伏错位），
   * 扭曲 = 世界法线 xz（波浪 + 028 细节法线 + 雨圈）× reflectDistort（同美术 atmo028.js waterShader）；
   * 菲涅尔 mix(fresnel[0], fresnel[1], (1 − N·V)^4)；在本材质上完雾之后再混（倒影 RT 已按完整光路上过雾，不重复）。
   */
  private injectReflection(shader: THREE.WebGLProgramParametersWithUniforms): void {
    for (const k of ['tReflect', 'uReflMatrix', 'uReflK', 'uFres', 'uDistort'] as const) shader.uniforms[k] = this.uniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vReflW;\nvarying float vReflLevel;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vReflW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vReflLevel = modelMatrix[3].y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vReflW;
        varying float vReflLevel;
        uniform sampler2D tReflect;
        uniform mat4 uReflMatrix;
        uniform float uReflK, uDistort;
        uniform vec2 uFres;`,
      )
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `#include <fog_fragment>
        if (uReflK > 0.0) {
          vec3 rN = inverseTransformDirection(normal, viewMatrix);
          vec3 toC = cameraPosition - vReflW;
          float rDist = length(toC);
          vec3 rV = toC / max(rDist, 1e-4);
          vec4 ruv = uReflMatrix * vec4(vReflW.x, vReflLevel, vReflW.z, 1.0);
          ruv.xy += rN.xz * uDistort * ruv.w / (1.0 + rDist * 0.05);
          vec3 refl = texture2DProj(tReflect, ruv).rgb;
          float fr = mix(uFres.x, uFres.y, pow(1.0 - clamp(dot(rV, rN), 0.0, 1.0), 4.0));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, refl * 0.9, fr * uReflK);
        }`,
      );
  }

  /** 1031 S1 沙斑（裁定 23 a）：挂海床高度图 → 顶点里按水深压浪；null = 取消 */
  setSeabed(map: SeabedMap | null): void {
    const u = this.uniforms;
    u.tSeabed.value?.dispose();
    u.tSeabed.value = map ? seabedTexture(map) : null;
    u.uSeabedOn.value = map ? 1 : 0;
    if (map) {
      u.uSeabedRect.value.set(map.minX, map.minZ, 1 / map.sizeX, 1 / map.sizeZ);
      u.uSeabedEmpty.value = map.empty;
    }
  }

  get seabedOn(): boolean {
    return this.uniforms.uSeabedOn.value > 0;
  }

  /** 025：挂上平面反射（PlanarReflection 直接写本材质的 uniform 对象，不重新编译）；null = 关 */
  setReflection(r: PlanarReflection | null): void {
    if (r) r.bindUniforms(this.uniforms);
    else {
      this.uniforms.uReflK.value = 0;
      this.uniforms.tReflect.value = null;
    }
  }

  /** 当前倒影强度（测试用） */
  get reflectionStrength(): number {
    return this.uniforms.uReflK.value;
  }

  private get hasDetail(): boolean {
    return !!this.uniforms.tWN.value;
  }

  /** 028 细节法线 + 雨圈贴图（缺失 → 只有 Gerstner 波）；ripple = 本档雨圈参数（null = 关） */
  setDetail(normal: THREE.Texture | null, ripple: THREE.Texture | null): void {
    const had = this.hasDetail;
    for (const t of [normal, ripple]) {
      if (!t) continue;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    this.uniforms.tWN.value = normal;
    this.uniforms.tWR.value = ripple;
    const img = ripple?.image as { width?: number } | undefined;
    const maxMip = ATMO028.water.ripple.maxMipLevel;
    this.uniforms.uRipMaxGrad.value = 2 ** maxMip / (img?.width ?? 1024);
    if (had !== this.hasDetail) this.material.needsUpdate = true;
    this.updateRipK();
  }

  /** 预设：颜色 + 细节法线强度 */
  applyAtmosphere(a: { waterColor: number; water: { normalScale: number; fresnel?: readonly [number, number]; reflectDistort?: number }; rain: { enabled: boolean } }): void {
    this.material.color.set(a.waterColor);
    if (a.water.fresnel) this.uniforms.uFres.value.set(a.water.fresnel[0], a.water.fresnel[1]);
    if (a.water.reflectDistort !== undefined) this.uniforms.uDistort.value = a.water.reflectDistort;
    this.uniforms.uNScale.value = a.water.normalScale;
    this.raining = a.rain.enabled;
    this.updateRipK();
  }

  /** 画质档的雨圈设置（ATMO028.rainTiers[tier].ripples） */
  setRipples(r: RippleOpts | null): void {
    this.ripple = r;
    this.uniforms.uRipTile.value = 1 / (r?.tileM ?? 1.5);
    this.uniforms.uRipL2.value = r && r.layers > 1 ? 1 : 0;
    this.updateRipK();
  }

  private updateRipK(): void {
    const r = this.ripple;
    this.uniforms.uRipK.value = this.raining && r?.enabled && this.uniforms.tWR.value ? ATMO028.water.normal.rippleMix * r.strength : 0;
  }

  /** 当前雨圈强度（测试用） */
  get rippleStrength(): number {
    return this.uniforms.uRipK.value;
  }

  /** 水面高度（世界 y = 网格 position.y；潮汐 v0.1-011 每帧写） */
  get level(): number {
    return this.position.y;
  }

  setLevel(y: number): void {
    if (this.position.y === y) return;
    this.position.y = y;
    this.updateMatrixWorld();
  }

  update(dt: number): void {
    const u = this.uniforms;
    const t = (u.uTime.value += dt);
    const L = ATMO028.water.normal.layers;
    const l0 = L[0];
    const l1 = L[1];
    u.uL0.value.set(1 / l0.tileM, 1 / l0.tileM, ((l0.scroll[0] * t) / l0.tileM) % 1, ((l0.scroll[1] * t) / l0.tileM) % 1);
    u.uL1.value.set(1 / l1.tileM, 1 / l1.tileM, ((l1.scroll[0] * t) / l1.tileM) % 1, ((l1.scroll[1] * t) / l1.tileM) % 1);
    const R = ATMO028.water.ripple;
    const f = Math.floor(t * (this.ripple?.fps ?? R.fps)) % R.frames;
    u.uRipFrame.value.set(f % R.grid, Math.floor(f / R.grid));
  }
}
