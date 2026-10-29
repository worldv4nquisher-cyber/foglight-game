import * as THREE from 'three';

/** 递归释放 Object3D 下的几何体、材质与纹理（GPU 资源） */
export function disposeObject3D(root: THREE.Object3D, opts: { keep?: Set<unknown> } = {}): void {
  const keep = opts.keep;
  root.traverse((obj) => {
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
