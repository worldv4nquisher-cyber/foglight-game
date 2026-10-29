import * as THREE from 'three';
import { applyMaterialHints } from '@/render/materialHints';

/**
 * 021 / 022 解谜道具「直接替换」入口（美术未交付时什么也不做，白盒照常显示 + 承担全部逻辑）。
 *
 * 约定：交付的 GLB 只做外观；碰撞 / 交互 / 光路 / 谜题状态全部留在白盒节点上（不改逻辑）。按约定的文件名（manifest key）
 * 和节点名（需求单 021 / 022 表格）挂进场景：
 * - `at`：挂点，按顺序找第一个存在的节点（场景 GLB 的 `*-socket` 优先，找不到用白盒逻辑根）；美术根节点作为它的子节点、
 *   局部变换归零（会动的白盒根，如浮台、门扇铰链，美术自然跟着走）。
 * - `align`：挂好后把美术里 `art` 后缀节点的世界位置平移到白盒 `logic` 节点（镜面中心、受光点……），保证光路与外观重合。
 * - `drive`：每帧把白盒逻辑节点的旋转同步到美术子节点。`copy` = 直接拷局部旋转（美术根与白盒父节点同一朝向时用，如镜子偏航）；
 *   `delta`（默认）= 只拷「相对初始」的旋转增量（钟摆、手轮、拉杆、拨盘、门扇）；`sign: -1` 反向（轴向与白盒相反时）。
 * - `hide`：隐藏这些白盒节点下的网格（不含挂进去的美术；只改 visible，物理不受影响；`?greybox=1` 时不隐藏）；
 *   `keep` 里的白盒网格保留（如透镜：受光反馈仍由白盒材质做，美术透镜材质接入前不丢反馈）。
 * - 美术材质的自发光一律清零（环境不留暖光；透镜 / 点火口四态的发光等交付后再接程序控制）。
 * 节点名匹配：名字等于或以它结尾（美术节点通常带文件前缀，如 `prop-mirror-stand-s2-mirror-plane`）。
 */
export interface ArtSlotDrive {
  art: string;
  logic: string;
  mode?: 'copy' | 'delta';
  sign?: 1 | -1;
}
export interface ArtSlotSpec {
  /** manifest key（= 约定文件名去掉 .glb；同一文件多场景用时各组另登记一个 key） */
  key: string;
  /** 区分同一模型的多处摆放（如立镜 a / b） */
  id?: string;
  at: readonly string[];
  align?: { art: string; logic: string };
  drive?: readonly ArtSlotDrive[];
  hide?: readonly string[];
  keep?: readonly string[];
}
export interface ArtSlotModelSource {
  has(key: string): boolean;
  getModel(key: string): THREE.Object3D;
}
export interface MountedArtSlot {
  id: string;
  model: THREE.Object3D;
  /** 约定节点缺了哪些（drive / align 找不到的美术节点名）：开发期 console 提示，列入向美术确认 */
  missingNodes: string[];
}
export interface ArtSlots {
  mounted: MountedArtSlot[];
  /** 每帧调用（谜题更新之后）：同步 drive 节点 */
  update(): void;
}

const COLLIDER_NAME = /-(collider|wall)(\.\d+)?$/i;
export const matchName = (name: string, want: string): boolean => {
  const w = want.replace(/^-/, '');
  return name === w || name.endsWith(`-${w}`);
};

export function findNode(root: THREE.Object3D, want: string): THREE.Object3D | null {
  const exact = root.getObjectByName(want);
  if (exact) return exact;
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && o.name && matchName(o.name, want)) hit = o;
  });
  return hit;
}

function prepareArt(o: THREE.Object3D): void {
  const dark = new Map<THREE.Material, THREE.Material>();
  const noGlow = (m: THREE.Material): THREE.Material => {
    const s = m as THREE.MeshStandardMaterial;
    if (!s.emissive || (s.emissive.getHex() === 0 && !s.emissiveMap)) return m;
    let c = dark.get(m);
    if (!c) {
      const d = s.clone();
      d.emissive.setRGB(0, 0, 0);
      d.emissiveIntensity = 0;
      d.emissiveMap = null;
      dark.set(m, (c = d));
    }
    return c;
  };
  o.traverse((c) => {
    if (COLLIDER_NAME.test(c.name) || c.userData.collider === true || (c as THREE.Light).isLight) {
      c.visible = false;
      return;
    }
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(noGlow) : noGlow(mesh.material);
  });
  applyMaterialHints(o);
}

function hideGreybox(node: THREE.Object3D, keep: readonly string[]): void {
  if (node.userData.artSlot) return;
  if (keep.some((k) => node.name === k)) return;
  if ((node as THREE.Mesh).isMesh) node.visible = false;
  for (const c of node.children) hideGreybox(c, keep);
}

/** 按表挂入已交付的道具；没交付（assets 里没有 key）的跳过 */
export function mountArtSlots(assets: ArtSlotModelSource, scene: THREE.Object3D, specs: readonly ArtSlotSpec[], opts: { showGreybox?: boolean } = {}): ArtSlots {
  const mounted: MountedArtSlot[] = [];
  const drives: { art: THREE.Object3D; logic: THREE.Object3D; mode: 'copy' | 'delta'; sign: number; artRest: THREE.Quaternion; logicRestInv: THREE.Quaternion }[] = [];
  for (const spec of specs) {
    if (!assets.has(spec.key)) continue;
    const at = spec.at.map((n) => scene.getObjectByName(n)).find((o): o is THREE.Object3D => !!o);
    if (!at) {
      console.warn(`[art-slot] ${spec.id ?? spec.key}：挂点 ${spec.at.join(' / ')} 都不在场景里，先用白盒`);
      continue;
    }
    const model = assets.getModel(spec.key);
    model.name = spec.id ?? spec.key;
    model.userData.artSlot = true;
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.scale.setScalar(1);
    prepareArt(model);
    at.add(model);
    const missingNodes: string[] = [];
    for (const d of spec.drive ?? []) {
      const art = findNode(model, d.art);
      const logic = scene.getObjectByName(d.logic);
      if (!art) missingNodes.push(d.art);
      if (!art || !logic) continue;
      const mode = d.mode ?? 'delta';
      if (mode === 'copy') art.quaternion.copy(logic.quaternion);
      drives.push({ art, logic, mode, sign: d.sign ?? 1, artRest: art.quaternion.clone(), logicRestInv: logic.quaternion.clone().invert() });
    }
    if (spec.align) {
      const a = findNode(model, spec.align.art);
      const l = scene.getObjectByName(spec.align.logic);
      if (!a) missingNodes.push(spec.align.art);
      if (a && l) {
        scene.updateMatrixWorld(true);
        const delta = l.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3()));
        const target = model.getWorldPosition(new THREE.Vector3()).add(delta);
        model.position.copy(at.worldToLocal(target));
      }
    }
    if (!opts.showGreybox) for (const h of spec.hide ?? []) {
      const n = scene.getObjectByName(h);
      if (n) hideGreybox(n, spec.keep ?? []);
    }
    if (missingNodes.length) console.warn(`[art-slot] ${model.name} 缺节点：${missingNodes.join('、')}（外观已挂上，部件不跟着动）`);
    mounted.push({ id: model.name, model, missingNodes });
  }
  const q = new THREE.Quaternion();
  return {
    mounted,
    update() {
      for (const d of drives) {
        if (d.mode === 'copy') {
          d.art.quaternion.copy(d.logic.quaternion);
          continue;
        }
        q.copy(d.logicRestInv).multiply(d.logic.quaternion);
        if (d.sign < 0) q.invert();
        d.art.quaternion.copy(d.artRest).multiply(q);
      }
    },
  };
}

/** 表里白盒侧的节点名（logic / hide / align.logic）在场景里找不到的：改了白盒命名忘了改表时，冒烟测试会报出来 */
export function missingGreyboxNodes(scene: THREE.Object3D, specs: readonly ArtSlotSpec[]): string[] {
  const names = new Set<string>();
  for (const s of specs) {
    for (const d of s.drive ?? []) names.add(d.logic);
    for (const h of s.hide ?? []) names.add(h);
    if (s.align) names.add(s.align.logic);
  }
  return [...names].filter((n) => !scene.getObjectByName(n));
}
