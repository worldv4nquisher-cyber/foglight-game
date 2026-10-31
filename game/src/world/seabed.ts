import * as THREE from 'three';

/**
 * 1031 S1 沙斑（裁定 23 a 方案）：海床高度图。
 * 把海床网格（世界坐标）逐三角形光栅化到 xz 规则网格，每个格心取最高的表面 y（= 从上往下看到的那层）；没覆盖到的格 = empty（当深水）。
 * Water.setSeabed() 拿它在顶点里按「水位 − 海床」压浪：露出来的沙上振幅 0，浪峰不再从沙面下冒出来。
 */
export interface SeabedMap {
  /** 行优先：data[j * res.x + i]，i 沿 +x、j 沿 +z */
  data: Float32Array;
  res: { x: number; z: number };
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
  /** 没覆盖到的格的值 */
  empty: number;
  /** 光栅化的三角形数 */
  triangles: number;
}

export const SEABED = Object.freeze({
  /** 格距（m） */
  cell: 0.25,
  /** 单边最大格数 */
  maxRes: 512,
  /** 没覆盖到 = 深水 */
  empty: -10,
  /** 压浪：水深 ≤ x 振幅 0，≥ y 全振幅（smoothstep）。浪合计振幅 0.375，在 [0, 0.8] 内 a·0.375 < 水深，浪峰不高过海床 */
  shoal: Object.freeze([0.0, 0.8] as const),
});

export function bakeSeabed(meshes: readonly THREE.Mesh[], opts: { cell?: number; maxRes?: number; empty?: number } = {}): SeabedMap | null {
  const cell = opts.cell ?? SEABED.cell;
  const maxRes = opts.maxRes ?? SEABED.maxRes;
  const empty = opts.empty ?? SEABED.empty;
  const box = new THREE.Box3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  }
  if (box.isEmpty()) return null;
  const sizeX = box.max.x - box.min.x;
  const sizeZ = box.max.z - box.min.z;
  const rx = Math.max(2, Math.min(maxRes, Math.ceil(sizeX / cell)));
  const rz = Math.max(2, Math.min(maxRes, Math.ceil(sizeZ / cell)));
  const data = new Float32Array(rx * rz).fill(-Infinity);
  const dx = sizeX / rx;
  const dz = sizeZ / rz;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let triangles = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld);
      // xz 投影的有向面积（竖直面 ≈ 0 跳过）
      const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(area) < 1e-9) continue;
      triangles++;
      const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - box.min.x) / dx - 0.5));
      const i1 = Math.min(rx - 1, Math.floor((Math.max(a.x, b.x, c.x) - box.min.x) / dx - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - box.min.z) / dz - 0.5));
      const j1 = Math.min(rz - 1, Math.floor((Math.max(a.z, b.z, c.z) - box.min.z) / dz - 0.5));
      for (let j = j0; j <= j1; j++) {
        const z = box.min.z + (j + 0.5) * dz;
        for (let i = i0; i <= i1; i++) {
          const x = box.min.x + (i + 0.5) * dx;
          const w0 = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / area;
          const w1 = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const y = w0 * a.y + w1 * b.y + w2 * c.y;
          const k = j * rx + i;
          if (y > data[k]!) data[k] = y;
        }
      }
    }
  }
  for (let k = 0; k < data.length; k++) if (data[k] === -Infinity) data[k] = empty;
  return { data, res: { x: rx, z: rz }, minX: box.min.x, minZ: box.min.z, sizeX, sizeZ, empty, triangles };
}

/** 双线性采样（和 GPU LinearFilter + ClampToEdge 一致；范围外 = empty） */
export function sampleSeabed(map: SeabedMap, x: number, z: number): number {
  const u = (x - map.minX) / map.sizeX;
  const v = (z - map.minZ) / map.sizeZ;
  if (u < 0 || u > 1 || v < 0 || v > 1) return map.empty;
  const fx = Math.min(Math.max(u * map.res.x - 0.5, 0), map.res.x - 1);
  const fz = Math.min(Math.max(v * map.res.z - 0.5, 0), map.res.z - 1);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const i2 = Math.min(i + 1, map.res.x - 1);
  const j2 = Math.min(j + 1, map.res.z - 1);
  const tx = fx - i;
  const tz = fz - j;
  const d = map.data;
  const r = map.res.x;
  return (d[j * r + i]! * (1 - tx) + d[j * r + i2]! * tx) * (1 - tz) + (d[j2 * r + i]! * (1 - tx) + d[j2 * r + i2]! * tx) * tz;
}

/** 压浪系数（与 Water 顶点着色器同式）：水深 = 水位 − 海床 */
export function shoalFactor(depth: number): number {
  const [e0, e1] = SEABED.shoal;
  const t = Math.min(Math.max((depth - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** GPU 纹理：R16F（WebGL2 半浮点可线性过滤），边缘 ClampToEdge；着色器里范围外另判 */
export function seabedTexture(map: SeabedMap): THREE.DataTexture {
  const half = new Uint16Array(map.data.length);
  for (let k = 0; k < half.length; k++) half[k] = THREE.DataUtils.toHalfFloat(map.data[k]!);
  const tex = new THREE.DataTexture(half, map.res.x, map.res.z, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.name = 'seabed-height';
  return tex;
}
