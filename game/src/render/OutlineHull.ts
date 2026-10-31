import * as THREE from 'three';

/**
 * 023 角色外扩描边（反向法线外扩，style-guide §7.3）：
 * - 平滑法线读 COLOR_0（`geometry.userData.outlineNormals = 'color'`，见 assets/vertexColors.ts），
 *   蒙皮网格的法线同样走骨骼矩阵，动起来描边跟着身体走；
 * - 在裁剪空间沿法线投影方向外扩，屏幕恒定线宽：1080p 约 1.5 px，其它分辨率按高度等比（NDC 下是常量）；
 * - 线色 = 固有色贴图 × 压暗 60% × 偏冷，不用纯黑；壳走 Lambert 受场景同一套光（不是无光照的纯色）：
 *   阴天 / 夜里场景光远低于 1，无光照的「固有色 × 0.4」会比表面本身还亮，描边变成浅色光晕（r4 首拍发现）；
 * - 只画背面（BackSide），不投影、不接收阴影、不参与拾取；
 * - 头发等 alphaMode MASK 的材质：壳沿用同一张固有色贴图的 alpha 和同一个 alphaTest，
 *   卡片的透明区不会描成实心块（「头发 alpha test」）。
 *
 * 用法：`addOutlineHull(model)`；壳挂在源网格下（同骨架、同几何），LOD 切档时跟着显隐。
 */
export const HULL_TAG = 'outlineHull';
/** 1080p 下的线宽（px） */
export const HULL_PX_1080 = 1.5;
/** 线色：固有色 × 0.4（压暗 60%）× 偏冷 */
export const HULL_DARKEN = 0.4;
export const HULL_COOL: readonly [number, number, number] = [0.86, 0.92, 1.0];

export interface HullStats {
  /** 加了壳的网格数 */
  meshes: number;
  /** 其中做了 alpha test 的（头发） */
  alphaTested: number;
  /** 没有 COLOR_0 平滑法线、跳过的网格名 */
  skipped: string[];
}

/** 外扩量（NDC，y 方向）：恒定 px@1080 → 2·px/1080；x 方向再除以宽高比 */
export function hullNdcOffset(aspect: number): { x: number; y: number } {
  const y = (2 * HULL_PX_1080) / 1080;
  return { x: y / Math.max(aspect, 1e-4), y };
}

function hullMaterial(src: THREE.Material, aspect: { value: number }): THREE.MeshLambertMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const color = new THREE.Color(1, 1, 1);
  if (s.color) color.copy(s.color);
  color.multiplyScalar(HULL_DARKEN);
  color.r *= HULL_COOL[0];
  color.g *= HULL_COOL[1];
  color.b *= HULL_COOL[2];
  const mat = new THREE.MeshLambertMaterial({
    name: `${src.name || 'mat'}-hull`,
    color,
    map: s.map ?? null,
    alphaTest: src.alphaTest,
    side: THREE.BackSide,
    fog: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHullAspect = aspect;
    shader.uniforms.uHullNdc = { value: hullNdcOffset(1).y };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 color;\nuniform float uHullAspect;\nuniform float uHullNdc;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        {
          vec3 hullN = color * 2.0 - 1.0;
          #ifdef USE_SKINNING
            hullN = (skinMatrix * vec4(hullN, 0.0)).xyz;
          #endif
          vec3 hullVN = normalize(normalMatrix * hullN);
          vec2 hullDir = (projectionMatrix * vec4(hullVN, 0.0)).xy;
          float hullLen = length(hullDir);
          if (hullLen > 1e-5) {
            hullDir /= hullLen;
            gl_Position.xy += vec2(hullDir.x / uHullAspect, hullDir.y) * uHullNdc * gl_Position.w;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'outline-hull-v2';
  return mat;
}

/** 给 root 下带 COLOR_0 平滑法线的网格加描边壳（已加过的不重复加） */
export function addOutlineHull(root: THREE.Object3D): HullStats {
  const stats: HullStats = { meshes: 0, alphaTested: 0, skipped: [] };
  const aspect = { value: 16 / 9 };
  const size = new THREE.Vector2();
  const mats = new Map<THREE.Material, THREE.MeshLambertMaterial>();
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData[HULL_TAG] || m.userData.ghostPrepass) return;
    if (m.children.some((c) => c.userData[HULL_TAG])) return;
    targets.push(m);
  });
  for (const m of targets) {
    if (m.geometry.userData.outlineNormals !== 'color' || !m.geometry.getAttribute('color')) {
      stats.skipped.push(m.name || '(unnamed)'); // 诊断统计，不上屏
      continue;
    }
    const srcMats = Array.isArray(m.material) ? m.material : [m.material];
    const hm = srcMats.map((sm) => {
      let h = mats.get(sm);
      if (!h) {
        h = hullMaterial(sm, aspect);
        mats.set(sm, h);
      }
      return h;
    });
    const material = Array.isArray(m.material) ? hm : hm[0]!;
    let hull: THREE.Mesh;
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(m.geometry, material);
      s.bindMode = sk.bindMode;
      s.bind(sk.skeleton, sk.bindMatrix);
      hull = s;
    } else {
      hull = new THREE.Mesh(m.geometry, material);
    }
    hull.name = `${m.name || 'mesh'}-hull`;
    hull.userData[HULL_TAG] = true;
    hull.castShadow = hull.receiveShadow = false;
    hull.frustumCulled = m.frustumCulled;
    hull.raycast = () => undefined;
    hull.onBeforeRender = (renderer) => {
      const rt = renderer.getRenderTarget();
      if (rt) size.set(rt.width, rt.height);
      else renderer.getDrawingBufferSize(size);
      if (size.y > 0) aspect.value = size.x / size.y;
    };
    m.add(hull);
    stats.meshes++;
    if (srcMats.some((sm) => sm.alphaTest > 0)) stats.alphaTested++;
  }
  return stats;
}
