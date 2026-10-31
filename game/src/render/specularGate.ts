import type * as THREE from 'three';

/**
 * 镜面反射开关（裁定 25 ②：035 镜头 04「那边没有亮。」关灯室玻璃反射）。
 * onBeforeCompile 在 aomap_fragment 之后（直接 + 间接镜面都已累加完、合成 outgoingLight 之前）乘一个 uniform：
 * 1 = 原样，0 = 没有任何镜面（灯光亮斑 / 环境反射都去掉，漫反射、透明度、雾不变）。
 * 用 uniform 不用 define：开关不重新编译着色器（演出里按 cue 切，不能卡帧）。
 * 保留已有 onBeforeCompile / programCacheKey 链（光照贴图 / 潮位 / 按物体雾）。
 */
export interface SpecularGate {
  readonly uniform: { value: number };
  readonly materials: THREE.Material[];
  value: number;
}

export const SPECULAR_GATE_GLSL = /* glsl */ `#include <aomap_fragment>
reflectedLight.directSpecular *= uSpecGate;
reflectedLight.indirectSpecular *= uSpecGate;`;

export function withSpecularGate(material: THREE.Material, uniform: { value: number }): void {
  if (material.userData.specularGate) return;
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uSpecGate = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSpecGate;')
      .replace('#include <aomap_fragment>', SPECULAR_GATE_GLSL);
  };
  material.customProgramCacheKey = () => `${prevKey()}|specgate`;
  material.userData.specularGate = true;
  material.needsUpdate = true;
}

/** 给 root 下名字匹配 name 的材质（MeshStandardMaterial 系）挂同一个开关 */
export function makeSpecularGate(root: THREE.Object3D | null, name: RegExp): SpecularGate {
  const uniform = { value: 1 };
  const materials: THREE.Material[] = [];
  root?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial || !name.test(m.name) || materials.includes(m)) continue;
      withSpecularGate(m, uniform);
      materials.push(m);
    }
  });
  return {
    uniform,
    materials,
    get value() {
      return uniform.value;
    },
    set value(v: number) {
      uniform.value = v;
    },
  };
}
