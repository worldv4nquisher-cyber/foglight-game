import type * as THREE from 'three';

/**
 * 美术 GLB 的 COLOR_0 约定（v0.1-index §5.4、art/tools/build-props-ch1.mjs）：
 * **COLOR_0 不是颜色，是给外扩描边（v0.1-023 反向法线外扩）用的平滑法线**——
 * 网格本地空间，编码为 `n * 0.5 + 0.5`（通常 RGBA8 归一化，A 恒为 1）。
 *
 * GLTFLoader 看到 COLOR_0 会自动给材质开 `vertexColors = true`，固有色就会被「法线颜色」染花，
 * 所以加载后要关掉材质的 vertexColors。几何体上的 `color` 属性**保留**：023 的描边着色器从这里读平滑法线
 * （解码：`n = color.rgb * 2.0 - 1.0`）。
 *
 * 开关：`gameConfig.assets.vertexColorsAreOutlineNormals`（全局，默认 true）；
 * 个别资源的 COLOR_0 真的是颜色时，在 manifest 条目上写 `vertexColors: 'color'`。
 *
 * 本文件只依赖 three 类型，可在 Node 里直接导入（scripts/verify-lod.mjs <文件>）。
 */

/** COLOR_0 解码后的长度允许偏离 1 的范围（RGBA8 量化误差约 0.01） */
const LENGTH_TOLERANCE = 0.06;
/** 最多抽样多少个顶点（运行时校验要便宜） */
const MAX_SAMPLES = 512;

export interface OutlineNormalCheck {
  ok: boolean;
  /** 抽样顶点数 */
  samples: number;
  /** 解码后长度不在 1 ± LENGTH_TOLERANCE 内的比例 */
  badLengthRatio: number;
  /** 平滑法线与顶点法线夹角 > 90° 的比例（平滑法线是相邻面法线的平均，不该和自身法线反向） */
  flippedRatio: number;
  /** 不通过的原因（中文，给日志用） */
  reason?: string;
}

/**
 * 抽样检查几何体的 `color` 属性是否像「编码后的平滑法线」：
 * 解码 `c * 2 - 1` 后应接近单位长度，并且与顶点法线大体同向。
 */
export function checkOutlineNormals(geometry: THREE.BufferGeometry): OutlineNormalCheck {
  const color = geometry.getAttribute('color') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!color) return { ok: false, samples: 0, badLengthRatio: 1, flippedRatio: 0, reason: '没有 COLOR_0' };
  if (color.itemSize < 3) {
    return { ok: false, samples: 0, badLengthRatio: 1, flippedRatio: 0, reason: `COLOR_0 只有 ${color.itemSize} 个分量` };
  }
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  const n = color.count;
  const step = Math.max(1, Math.floor(n / MAX_SAMPLES));
  let samples = 0;
  let badLength = 0;
  let flipped = 0;
  for (let i = 0; i < n; i += step) {
    // getX/Y/Z 会按 normalized 自动反量化到 [0,1]
    const x = color.getX(i) * 2 - 1;
    const y = color.getY(i) * 2 - 1;
    const z = color.getZ(i) * 2 - 1;
    const len = Math.hypot(x, y, z);
    samples++;
    if (Math.abs(len - 1) > LENGTH_TOLERANCE) badLength++;
    if (normal && x * normal.getX(i) + y * normal.getY(i) + z * normal.getZ(i) < 0) flipped++;
  }
  const badLengthRatio = samples ? badLength / samples : 1;
  const flippedRatio = samples ? flipped / samples : 0;
  // 允许少量异常（退化顶点、量化），超过 5% 判定为「不是平滑法线」
  let reason: string | undefined;
  if (badLengthRatio > 0.05) reason = `${(badLengthRatio * 100).toFixed(0)}% 的顶点解码后不是单位向量（像是普通顶点色或没按 n*0.5+0.5 编码）`;
  else if (flippedRatio > 0.05) reason = `${(flippedRatio * 100).toFixed(0)}% 的顶点平滑法线与顶点法线反向（坐标系或编码不对）`;
  return reason ? { ok: false, samples, badLengthRatio, flippedRatio, reason } : { ok: true, samples, badLengthRatio, flippedRatio };
}

export interface OutlineNormalStats {
  /** 带 COLOR_0 的网格数 */
  meshes: number;
  /** 关掉了 vertexColors 的材质数 */
  materialsFixed: number;
  /** 校验不通过的网格：[网格名, 原因] */
  invalid: Array<[string, string]>;
}

/**
 * 加载后处理：把 COLOR_0 视为描边平滑法线。
 * - 关掉所有用到它的材质的 `vertexColors`（needsUpdate 重新编译）；
 * - 几何体 `color` 属性保留不动，并在 `geometry.userData.outlineNormals = 'color'` 标明属性名（023 读取）；
 * - 抽样校验数据像不像平滑法线，不像的记进 `invalid`（只告警，不改数据）。
 * @param treatAsOutlineNormals false 时什么都不做（COLOR_0 当普通顶点色用）
 */
export function prepareOutlineNormals(root: THREE.Object3D, treatAsOutlineNormals = true): OutlineNormalStats {
  const stats: OutlineNormalStats = { meshes: 0, materialsFixed: 0, invalid: [] };
  if (!treatAsOutlineNormals) return stats;
  const fixed = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute('color')) return;
    stats.meshes++;
    // 保留 color 属性：它就是描边要用的平滑法线，不能删
    mesh.geometry.userData.outlineNormals = 'color';
    const check = checkOutlineNormals(mesh.geometry);
    if (!check.ok) stats.invalid.push([mesh.name || '(未命名)', check.reason ?? '未知']);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (mat.vertexColors && !fixed.has(mat)) {
        mat.vertexColors = false;
        mat.needsUpdate = true;
        fixed.add(mat);
      }
    }
  });
  stats.materialsFixed = fixed.size;
  return stats;
}
