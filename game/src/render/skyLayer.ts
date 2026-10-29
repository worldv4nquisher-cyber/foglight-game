import * as THREE from 'three';
import { withObjectFog } from './objectFog';

/**
 * 天空层 / impostor（v0.1-013）。远景剪影塔在 313 / 332 m，超过标准档 250 m 视距（camera.far）。
 * 天空层物体：
 * - 顶点着色器把深度钉在远平面内侧（gl_Position.z = w · SKY_DEPTH），不会被 camera.far 裁掉，也永远在所有近景后面；
 * - frustumCulled = false（视锥远平面剔除同样会丢掉它们）、不投 / 不收阴影；
 * - 子树里的 THREE.LOD 折叠到最后一级（各档构图、面数完全一样，不随 lodDistances 变）；
 * - 材质换成 unlit 单色 + 按物体雾（美术：「远景剪影：程序可换成 unlit + 雾色混合」），雾色跟场景 fog。
 * 所以三档画质看到的构图一致。天空穹顶 depthWrite = false、renderOrder -1，先画；天空层 renderOrder 0 盖在它上面。
 */
export const SKY_DEPTH = 0.999995;

export interface SkyLayerOptions {
  /** 剪影颜色（线性前的 sRGB hex） */
  color: number;
  /** 按物体雾密度（FogExp2 同义） */
  fogDensity: number;
  /**
   * 深度钉到远平面（默认 true）。false：只用天空层材质（unlit 单色 + 按物体雾、LOD 折叠到最后一级、不投影），
   * 深度照常——给在视距内、但比视线低、需要被近景（海面）正确遮住的远景（S2 看 143 m 外的 S3 灯塔，v0.1-014）。
   */
  pinDepth?: boolean;
}

export interface SkyLayerHandle {
  readonly material: THREE.MeshBasicMaterial;
  readonly fog: { value: number };
}

/** 把材质的深度钉到远平面内侧（原地修改） */
export function withSkyDepth<T extends THREE.Material>(material: T): T {
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n  gl_Position.z = gl_Position.w * ${SKY_DEPTH.toFixed(6)};`,
    );
  };
  material.customProgramCacheKey = () => `${prevKey()}|skydepth`;
  material.needsUpdate = true;
  return material;
}

/** 把一个 THREE.LOD 折叠为它的最后一级（远景用）；返回保留下来的物体 */
function collapseToLast(lod: THREE.LOD): THREE.Object3D {
  const last = lod.levels[lod.levels.length - 1];
  if (!last) return lod;
  const keep = last.object;
  for (const l of lod.levels) if (l.object !== keep) l.object.removeFromParent();
  keep.removeFromParent();
  keep.applyMatrix4(lod.matrix);
  const parent = lod.parent;
  if (parent) {
    parent.children.splice(parent.children.indexOf(lod), 1, keep);
    keep.parent = parent;
    lod.parent = null;
  }
  keep.name = lod.name;
  return keep;
}

/** 子树变成天空层（原地修改）。返回共用材质（改颜色 / 雾密度用） */
export function makeSkyLayer(root: THREE.Object3D, opts: SkyLayerOptions): SkyLayerHandle {
  const lods: THREE.LOD[] = [];
  root.traverse((o) => {
    if ((o as THREE.LOD).isLOD) lods.push(o as THREE.LOD);
  });
  for (const l of lods) collapseToLast(l);
  const fog = { value: opts.fogDensity };
  const base = withObjectFog(new THREE.MeshBasicMaterial({ color: opts.color }), fog);
  const material = opts.pinDepth === false ? base : withSkyDepth(base);
  material.name = 'mat-sky-layer';
  root.traverse((o) => {
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = false;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = material;
  });
  root.userData.skyLayer = true;
  return { material, fog };
}
