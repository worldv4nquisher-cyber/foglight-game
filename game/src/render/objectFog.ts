import type * as THREE from 'three';

/**
 * 按物体雾（v0.1-013）。场景 FogExp2 的密度是给近景调的（S1 0.028：138 m 外就全白），
 * 远景岛 / 灯塔要用美术给的 fogDensityHint（GLB extras：fogLayer = 'mid'，fogDensityHint ≈ 0.0036）才能在亮雾里留住暗剪影。
 *
 * 做法：克隆子树里的材质，onBeforeCompile 把 `#include <fog_fragment>` 换成读自己 uniform 的指数平方雾（颜色仍用场景 fogColor，
 * 所以大气预设换雾色时远景跟着变）。同一个密度共用一个 uniform 对象，运行时改 `handle.density` 即可。
 */
export interface ObjectFogHandle {
  /** 当前密度（FogExp2 同义：fog = 1 - exp(-(density·depth)²)） */
  density: number;
  readonly uniform: { value: number };
  readonly materials: THREE.Material[];
}

export const OBJECT_FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
  float objFogFactor = 1.0 - exp( - uObjFogDensity * uObjFogDensity * vFogDepth * vFogDepth );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, objFogFactor );
#endif
`;

/** 给单个材质挂按物体雾（原地修改；返回同一材质） */
export function withObjectFog<T extends THREE.Material>(material: T, uniform: { value: number }): T {
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uObjFogDensity = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uObjFogDensity;')
      .replace('#include <fog_fragment>', OBJECT_FOG_GLSL);
  };
  material.customProgramCacheKey = () => `${prevKey()}|objfog`;
  material.userData.objectFog = uniform;
  (material as THREE.Material & { fog?: boolean }).fog = true;
  material.needsUpdate = true;
  return material;
}

/**
 * 子树里所有网格改用按物体雾。材质先克隆（GLB 缓存里的原材质被其它实例共用），同一原材质只克隆一次。
 * 纹理不克隆（仍是缓存里的共享纹理）。
 */
export function applyObjectFog(root: THREE.Object3D, density: number): ObjectFogHandle {
  const uniform = { value: density };
  const cloned = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material): THREE.Material => {
      let c = cloned.get(m);
      if (!c) {
        c = withObjectFog(m.clone(), uniform);
        cloned.set(m, c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  const materials = [...cloned.values()];
  return {
    get density() {
      return uniform.value;
    },
    set density(v: number) {
      uniform.value = v;
    },
    uniform,
    materials,
  };
}

/** FogExp2 在 depth 处的雾占比（0–1；测试 / 调参用） */
export function fogExp2Factor(density: number, depth: number): number {
  return 1 - Math.exp(-((density * depth) ** 2));
}

/** 读 GLB 根上的雾提示（extras → userData：fogLayer 'near' | 'mid' | 'far'，fogDensityHint） */
export function readFogHint(root: THREE.Object3D): { layer: string | null; density: number | null } {
  let layer: string | null = null;
  let density: number | null = null;
  root.traverse((o) => {
    const u = o.userData as { fogLayer?: unknown; fogDensityHint?: unknown };
    if (layer === null && typeof u.fogLayer === 'string') layer = u.fogLayer;
    if (density === null && typeof u.fogDensityHint === 'number') density = u.fogDensityHint;
  });
  return { layer, density };
}
