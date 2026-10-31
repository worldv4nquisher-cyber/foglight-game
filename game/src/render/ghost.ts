import * as THREE from 'three';

/**
 * 半透明「幽灵」材质 + 深度预写（裁定 25 ③，035 父亲回忆段）。
 *
 * 只把材质改成 transparent 的话，同一个角色身上的斗篷内层、手臂、背面会按三角形顺序互相叠出来（层次乱）。
 * 做法：每个网格挂一个同几何、同骨骼的子网格（深度预写）：材质 = 原材质克隆 + colorWrite=false + depthWrite=true，
 * 和半透明那遍同一个着色器程序（colorWrite 不进程序键），深度逐位相同；半透明那遍 depthFunc = LessEqual，
 * 于是只有最靠前那一层能写颜色，自身内层不再透出，身后的场景（已经画完的不透明物体）照样透过来。
 * - 两遍都放在透明队列：预写 renderOrder = GHOST_RENDER_ORDER，半透明 = +1（透明队列先按 renderOrder 排），
 *   这样预写发生在所有不透明物体之后，不会挡住身后的汐 / 场景。
 * - 淡出：setOpacity 只改半透明那遍；不透明度 ≤ GHOST_PREPASS_MIN 时把预写关掉（看不见的幽灵不该再遮东西）。
 */
export const GHOST_RENDER_ORDER = 10;
export const GHOST_PREPASS_MIN = 0.004;

export interface Ghost {
  /** 半透明那遍的材质（克隆） */
  readonly materials: THREE.Material[];
  /** 深度预写网格（每个原网格一个，挂在原网格下面） */
  readonly prepasses: THREE.Mesh[];
  /** 深度预写开关（冒烟 / 截图对比用；默认开） */
  prepassEnabled: boolean;
  readonly opacity: number;
  setOpacity(op: number): void;
}

function depthOnly(m: THREE.Material): THREE.Material {
  const c = m.clone();
  c.transparent = true;
  c.opacity = 1;
  c.colorWrite = false;
  c.depthWrite = true;
  c.depthTest = true;
  // clone() 不带实例上挂的 onBeforeCompile；接回去，保证和颜色那遍是同一个程序（同样的蒙皮 / 顶点变换）
  c.onBeforeCompile = m.onBeforeCompile.bind(m);
  c.customProgramCacheKey = m.customProgramCacheKey.bind(m);
  return c;
}

/** 把 root 下所有网格换成幽灵材质（克隆，不改共享材质）并挂深度预写；不投影 */
export function makeGhost(root: THREE.Object3D, opacity = 0): Ghost {
  const materials: THREE.Material[] = [];
  const prepasses: THREE.Mesh[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.ghostPrepass) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    mesh.castShadow = false;
    const conv = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      c.onBeforeCompile = m.onBeforeCompile.bind(m);
      c.customProgramCacheKey = m.customProgramCacheKey.bind(m);
      c.transparent = true;
      c.opacity = opacity;
      c.depthWrite = false;
      c.depthTest = true;
      c.depthFunc = THREE.LessEqualDepth;
      materials.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    const preMat = Array.isArray(mesh.material) ? mesh.material.map(depthOnly) : depthOnly(mesh.material);
    let pre: THREE.Mesh;
    const sk = mesh as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(sk.geometry, preMat);
      s.bindMode = sk.bindMode;
      s.bind(sk.skeleton, sk.bindMatrix);
      pre = s;
    } else {
      pre = new THREE.Mesh(mesh.geometry, preMat);
    }
    pre.name = `${mesh.name}-ghost-depth`;
    pre.userData.ghostPrepass = true;
    pre.frustumCulled = mesh.frustumCulled;
    pre.castShadow = pre.receiveShadow = false;
    pre.renderOrder = GHOST_RENDER_ORDER;
    mesh.renderOrder = GHOST_RENDER_ORDER + 1;
    // 子节点、单位变换：世界矩阵和原网格相同（attached 绑定按自己的 matrixWorld 求 bindMatrixInverse，结果一致）
    mesh.add(pre);
    prepasses.push(pre);
  }
  let op = opacity;
  const g: Ghost = {
    materials,
    prepasses,
    prepassEnabled: true,
    get opacity() {
      return op;
    },
    setOpacity(v: number) {
      op = v;
      for (const m of materials) m.opacity = v;
      const on = g.prepassEnabled && v > GHOST_PREPASS_MIN;
      for (const p of prepasses) p.visible = on;
    },
  };
  g.setOpacity(opacity);
  return g;
}
