import * as THREE from 'three';

/**
 * 递归释放 Object3D 下的几何体、材质与纹理（GPU 资源），
 * 以及灯光阴影贴图（Light.dispose → shadow.map 渲染目标）和蒙皮骨骼纹理（Skeleton.dispose → boneTexture）。
 * 后两者不挂在材质上，漏掉会每进一次关卡泄漏一张阴影 RT（ultra 4096² RGBA8+深度 ≈ 112 MB，v0.1-037）。
 */
export function disposeObject3D(root: THREE.Object3D, opts: { keep?: Set<unknown> } = {}): void {
  const keep = opts.keep;
  root.traverse((obj) => {
    const light = obj as Partial<THREE.Light>;
    if (light.isLight && !keep?.has(obj)) light.dispose?.();
    const skinned = obj as Partial<THREE.SkinnedMesh>;
    if (skinned.isSkinnedMesh && skinned.skeleton && !keep?.has(skinned.skeleton)) skinned.skeleton.dispose();
    const mesh = obj as Partial<THREE.Mesh>;
    if (mesh.geometry && !keep?.has(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat) {
      for (const m of Array.isArray(mat) ? mat : [mat]) {
        if (!keep?.has(m)) disposeMaterial(m, keep);
      }
    }
  });
}

export function disposeMaterial(material: THREE.Material, keep?: Set<unknown>): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture && !keep?.has(value)) value.dispose();
  }
  material.dispose();
}
