import * as THREE from 'three';

/** 白石组交付（1030c）：只给数字石块的材质加亮；冷白 #F2EEE4 × 对准度 × 0.35 */
export const WHITE_STONES_HIGHLIGHT = { material: 'mat-prop-white-stones-digit-s2', color: 0xf2eee4, intensity: 0.35 };
/** 眼位相机节点（extras.fovDeg；−Z 朝 lookAt，glTF 相机约定）与三个数字节点 */
export const WHITE_STONES_VIEWPOINT_NODE = 'prop-white-stones-s2-viewpoint';
export const WHITE_STONES_DIGIT_NODES = ['white-stones-digit-3', 'white-stones-digit-1', 'white-stones-digit-7'];

type Emissive = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };
const hasEmissive = (m: THREE.Material): m is Emissive => (m as Partial<Emissive>).emissive instanceof THREE.Color;

const isCollider = (o: THREE.Object3D): boolean => /collider/i.test(o.name) || o.userData.collider === true;

/**
 * 制作人裁定 15：美术白石（固定眼位透视拼合成「3 1 7」）挂上后，对准度不再显七段贴片，改为数字石块加亮。
 * 只动 highlightMaterial（mat-prop-white-stones-digit-s2）那一份材质（克隆后替换，装饰石 / 暗石的 decor 材质不动）。
 * 没有该材质名（合成测试模型）时退回给所有网格加亮。
 */
export class WhiteStonesGlow {
  readonly materials: Emissive[] = [];
  glow = 0;

  constructor(model: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !isCollider(m)) meshes.push(m);
    });
    const named = (mat: THREE.Material): boolean => mat.name === WHITE_STONES_HIGHLIGHT.material;
    const any = meshes.some((m) => (Array.isArray(m.material) ? m.material.some(named) : named(m.material)));
    const clones = new Map<THREE.Material, THREE.Material>();
    const cloneOne = (mat: THREE.Material): THREE.Material => {
      if (!hasEmissive(mat) || (any && !named(mat))) return mat;
      let c = clones.get(mat);
      if (!c) {
        const e = mat.clone();
        e.emissive.set(WHITE_STONES_HIGHLIGHT.color);
        e.emissiveIntensity = 0;
        this.materials.push(e);
        clones.set(mat, e);
        c = e;
      }
      return c;
    };
    for (const mesh of meshes) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneOne) : cloneOne(mesh.material);
  }

  /** 对准度 0..1 → 加亮 */
  setGlow(a: number): void {
    const k = THREE.MathUtils.clamp(a, 0, 1);
    if (k === this.glow) return;
    this.glow = k;
    for (const m of this.materials) m.emissiveIntensity = WHITE_STONES_HIGHLIGHT.intensity * k;
  }
}

export interface WhiteStonesAim {
  /** 眼位（世界） */
  eye: THREE.Vector3;
  fov: number;
  /** 眼位节点朝向（−Z，世界单位向量） */
  forward: THREE.Vector3;
  /** 对准判定方向：三个数字石块在眼位视野里的角包围盒中心（世界单位向量） */
  center: THREE.Vector3;
  /** 角包围盒（°，眼位局部：方位 / 仰角） */
  azDeg: [number, number];
  elDeg: [number, number];
}

/**
 * 白石组交付（1030c）：眼位 / FOV / 朝向从 prop-white-stones-s2-viewpoint 读；对准中心 = 数字石块（不含碰撞体）全部顶点
 * 在眼位局部的方位角 / 仰角范围中点（美术：在 lookAt 视线下方 3.7°，字高 4.5°，水平 ±5.12°）。缺节点返回 null。
 */
export function whiteStonesAim(model: THREE.Object3D): WhiteStonesAim | null {
  const node = model.getObjectByName(WHITE_STONES_VIEWPOINT_NODE);
  const digits = WHITE_STONES_DIGIT_NODES.map((n) => model.getObjectByName(n));
  if (!node || digits.some((d) => !d)) return null;
  model.updateWorldMatrix(true, true);
  const eye = node.getWorldPosition(new THREE.Vector3());
  const q = node.getWorldQuaternion(new THREE.Quaternion());
  const inv = q.clone().invert();
  const ud = node.userData as { fovDeg?: unknown; fov?: unknown };
  const fovRaw = ud.fovDeg ?? ud.fov;
  const fov = typeof fovRaw === 'number' ? fovRaw : 30;
  let az0 = Infinity;
  let az1 = -Infinity;
  let el0 = Infinity;
  let el1 = -Infinity;
  const v = new THREE.Vector3();
  for (const d of digits) {
    d!.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || isCollider(m)) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(eye).applyQuaternion(inv);
        const az = Math.atan2(v.x, -v.z);
        const el = Math.atan2(v.y, Math.hypot(v.x, v.z));
        az0 = Math.min(az0, az);
        az1 = Math.max(az1, az);
        el0 = Math.min(el0, el);
        el1 = Math.max(el1, el);
      }
    });
  }
  if (!Number.isFinite(az0)) return null;
  const az = (az0 + az1) / 2;
  const el = (el0 + el1) / 2;
  const center = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).applyQuaternion(q).normalize();
  const D = THREE.MathUtils.RAD2DEG;
  return { eye, fov, forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize(), center, azDeg: [az0 * D, az1 * D], elDeg: [el0 * D, el1 * D] };
}
