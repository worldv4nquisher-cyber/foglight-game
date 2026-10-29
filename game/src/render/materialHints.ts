import type * as THREE from 'three';

/**
 * 加载 GLB 后按美术写在材质 extras（→ material.userData）里的提示调整材质（v0.1-013）。
 * - alphaHint = 'alphaHash'（渔网 mat-env-net）：网线远看是亚像素，mip 平均后 alpha < 0.5，alphaTest 会让整片网消失；
 *   改用 alphaHash（抖动透明，和 TAA / 后处理无关也稳定），alphaTest 置 0，不进透明排序。
 * @returns 改过的材质数
 */
export function applyMaterialHints(root: THREE.Object3D): number {
  const seen = new Set<THREE.Material>();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      const hint = (m.userData as { alphaHint?: unknown }).alphaHint;
      if (hint === 'alphaHash') {
        m.alphaHash = true;
        m.alphaTest = 0;
        m.transparent = false;
        m.depthWrite = true;
        m.needsUpdate = true;
        n++;
      } else if (hint === 'alphaToCoverage') {
        m.alphaToCoverage = true;
        m.alphaTest = 0;
        m.transparent = false;
        m.needsUpdate = true;
        n++;
      }
    }
  });
  return n;
}
