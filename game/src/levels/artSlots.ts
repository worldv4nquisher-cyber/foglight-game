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
 *   `delta`（默认）= 白盒节点相对初始的**世界空间**旋转增量套到美术节点上（钟摆、手轮、拉杆、拨盘、门扇）：
 *   与美术 / 白盒各自的局部轴向无关（如 S1 白盒钟绕局部 Z 摆、美术 bell-swing 绕局部 X 摆，挂点又转了 90°，结果一致）；
 *   `sign: -1` 反向。`world` = 美术节点世界旋转直接等于白盒节点世界旋转（挂点与白盒父节点朝向可能不同时用，如立镜挂院墙 socket；
 *   挂点就是白盒根时与 `copy` 结果一致）。
 * - `hide`：隐藏这些白盒节点下的网格（不含挂进去的美术；只改 visible，物理不受影响；`?greybox=1` 时不隐藏）；
 *   `keep` 里的白盒网格保留（如透镜：受光反馈仍由白盒材质做，美术透镜材质接入前不丢反馈）。
 * - 美术材质的自发光一律清零（环境不留暖光；透镜 / 点火口四态的发光等交付后再接程序控制）。
 * 节点名匹配：名字等于或以它结尾（美术节点通常带文件前缀，如 `prop-mirror-stand-s2-mirror-plane`）。
 */
export interface ArtSlotDrive {
  art: string;
  logic: string;
  mode?: 'copy' | 'delta' | 'world';
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
  /**
   * 程序控制的发光件：美术里用 `material` 这个材质名的网格换成同一份克隆，每帧把白盒 `logic` 网格材质的
   * emissive 颜色 / 强度拷过来（如点火口四态：白盒透镜由 BeamRenderer 驱动，美术 glowNodes 跟着亮）
   */
  glow?: { material: string; logic: string };
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
  const glows: { art: THREE.MeshStandardMaterial; logic: THREE.Mesh }[] = [];
  const drives: { art: THREE.Object3D; logic: THREE.Object3D; mode: 'copy' | 'delta' | 'world'; sign: number; artRestW: THREE.Quaternion; logicRestWInv: THREE.Quaternion }[] = [];
  const worldQ = (o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion => {
    o.updateWorldMatrix(true, false);
    return o.getWorldQuaternion(out);
  };
  /** 把 o 的世界旋转设为 w（换回父节点局部；w 会被改写） */
  const setWorldQ = (o: THREE.Object3D, w: THREE.Quaternion): void => {
    if (o.parent) w.premultiply(worldQ(o.parent, new THREE.Quaternion()).invert());
    o.quaternion.copy(w);
  };
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
      if (mode === 'world') setWorldQ(art, worldQ(logic, new THREE.Quaternion()));
      drives.push({ art, logic, mode, sign: d.sign ?? 1, artRestW: worldQ(art, new THREE.Quaternion()), logicRestWInv: worldQ(logic, new THREE.Quaternion()).invert() });
    }
    if (spec.glow) {
      const g = spec.glow;
      const logic = scene.getObjectByName(g.logic) as THREE.Mesh | undefined;
      let clone: THREE.MeshStandardMaterial | null = null;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material) || m.material.name !== g.material || !(m.material instanceof THREE.MeshStandardMaterial)) return;
        clone ??= m.material.clone();
        m.material = clone;
      });
      if (!clone) missingNodes.push(`material:${g.material}`); // text-ok: 开发期 console 提示
      else if (logic?.isMesh) glows.push({ art: clone, logic });
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
  const p = new THREE.Quaternion();
  return {
    mounted,
    update() {
      for (const g of glows) {
        const src = g.logic.material;
        if (Array.isArray(src) || !(src instanceof THREE.MeshStandardMaterial)) continue;
        g.art.emissive.copy(src.emissive);
        g.art.emissiveIntensity = src.emissiveIntensity;
      }
      for (const d of drives) {
        if (d.mode === 'copy') {
          d.art.quaternion.copy(d.logic.quaternion);
          continue;
        }
        if (d.mode === 'world') {
          setWorldQ(d.art, worldQ(d.logic, q));
          continue;
        }
        // 世界增量 Δ = L · L0⁻¹；美术世界旋转 = Δ · A0；再换回美术父节点局部（父节点可能也被 drive，先更新它的世界矩阵）
        worldQ(d.logic, q).multiply(d.logicRestWInv);
        if (d.sign < 0) q.invert();
        q.multiply(d.artRestW);
        if (d.art.parent) q.premultiply(worldQ(d.art.parent, p).invert());
        d.art.quaternion.copy(q);
      }
    },
  };
}

/**
 * 把白盒逻辑节点（如交互站位）对到已挂上美术里的约定节点上（世界位置 + 朝向；只在挂上时做一次）。
 * 用于美术给的点比白盒更准、逻辑按美术来的情况（021 潮汐钟 `prop-tide-bell-interact`：站位 0.98 m）。
 * 美术没挂上 / 没这个节点 → 白盒不动，返回 false。
 */
export function snapToArt(slots: ArtSlots | null | undefined, slotId: string, artNode: string, target: THREE.Object3D | null | undefined): boolean {
  const m = slots?.mounted.find((x) => x.id === slotId);
  const a = m ? findNode(m.model, artNode) : null;
  if (!a || !target) return false;
  a.updateWorldMatrix(true, false);
  const pos = a.getWorldPosition(new THREE.Vector3());
  const q = a.getWorldQuaternion(new THREE.Quaternion());
  if (target.parent) {
    target.parent.updateWorldMatrix(true, false);
    target.parent.worldToLocal(pos);
    q.premultiply(target.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
  target.position.copy(pos);
  target.quaternion.copy(q);
  target.updateMatrixWorld(true);
  return true;
}

/** 表里白盒侧的节点名（logic / hide / align.logic）在场景里找不到的：改了白盒命名忘了改表时，冒烟测试会报出来 */
export function missingGreyboxNodes(scene: THREE.Object3D, specs: readonly ArtSlotSpec[]): string[] {
  const names = new Set<string>();
  for (const s of specs) {
    for (const d of s.drive ?? []) names.add(d.logic);
    if (s.glow) names.add(s.glow.logic);
    for (const h of s.hide ?? []) names.add(h);
    if (s.align) names.add(s.align.logic);
  }
  return [...names].filter((n) => !scene.getObjectByName(n));
}
