import * as THREE from 'three';

/** 白盒风灯（原点在灯底）的光源中心高度 */
export const GB_LANTERN_LIGHT_Y = 0.15;

/**
 * 021 风灯 prop-lantern-brass：原点 = 提手（直接挂 hand_r_socket / 灯台 `-socket`，不加偏移）。
 * 返回 { hang：提手到灯底的高度（灯放桌面时 socket 要抬高这么多；读 `-collider` 包围盒底，读不到 0.28），light：`-emitter` 节点（光源中心）在灯局部的位置 }
 */
export function artLanternFrame(o: THREE.Object3D): { hang: number; light: THREE.Vector3 } {
  o.updateMatrixWorld(true);
  const inv = o.matrixWorld.clone().invert();
  let hang = 0.28;
  const light = new THREE.Vector3(0, -0.162, 0);
  o.traverse((c) => {
    if (/-collider(\.\d+)?$/i.test(c.name) && (c as THREE.Mesh).isMesh) {
      const g = (c as THREE.Mesh).geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!.clone().applyMatrix4(c.matrixWorld.clone().premultiply(inv));
      if (Number.isFinite(b.min.y) && b.min.y < 0) hang = -b.min.y;
    } else if (/-emitter(\.\d+)?$/i.test(c.name)) c.getWorldPosition(light).applyMatrix4(inv);
  });
  return { hang, light };
}
