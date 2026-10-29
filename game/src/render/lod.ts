import * as THREE from 'three';

/**
 * 轻量 LOD 系统（约定见 art/style/style-guide.md §8，README「LOD 与解谜关键物体」）。
 *
 * 1. 命名约定：同一父节点下的兄弟节点 `<名字>_lod0`、`<名字>_lod1`、`<名字>_lod2`
 *    （也接受 `-lod1`；Blender 的 `.001` 重名后缀会被忽略）→ 组装成一个 THREE.LOD，名字为 `<名字>`。
 *    每级面数约减半；LOD 物体放在 LOD0 的位置，其余层级保持相对 LOD0 的变换。
 * 2. 切换距离来自画质档位 `lodDistances: [LOD0, LOD1, LOD2]`（米）：
 *    LOD0 显示到 d0，LOD1 显示到 d1，LOD2 显示到 d2；d2 以外以后交给 impostor（尚未实现，暂时继续显示 LOD2）。
 * 3. 解谜关键物体：节点或任一祖先 `userData.puzzleCritical === true`（glTF extras / Blender 自定义属性）
 *    → 三档都固定 LOD0：加载时直接丢弃并释放低级 LOD，不生成 THREE.LOD；
 *    运行时才标记的物体用 markPuzzleCritical() 折叠；applyLodDistances() 对它们也强制 LOD0 兜底。
 * 4. 强制 LOD0：`userData.forceLod0 === true`（glTF extras，例：菲涅尔透镜——低级 LOD 会破坏折射/高光轮廓）
 *    → LOD 处理与 puzzleCritical 完全相同（只保留 LOD0、释放低级 LOD），但不是解谜物体：
 *    不要求 -collider / -interact，也不写 puzzleCritical。
 *
 * 本文件只依赖 three，便于在 Node 里直接跑校验脚本（scripts/verify-lod.mjs）。
 */

/** [LOD0 最远距离, LOD1 最远距离, LOD2 最远距离]，单位米 */
export type LodDistances = readonly [number, number, number];

export interface LodBuildStats {
  /** 生成的 THREE.LOD 数量 */
  lodGroups: number;
  /** 因 puzzleCritical 只保留 LOD0 的物体数量 */
  criticalGroups: number;
  /** 因 forceLod0（非解谜）只保留 LOD0 的物体数量 */
  forcedGroups: number;
  /** 被丢弃并释放的低级 LOD 节点数量 */
  droppedLevels: number;
}

type DisposeFn = (obj: THREE.Object3D) => void;

const LOD_NAME_RE = /^(.+?)[_-]lod(\d+)(?:\.\d+)?$/i;
const LOD_HYSTERESIS = 0.08;

/** 解析 `<名字>_lodN`，返回基名（小写）与层级；不符合约定返回 null */
export function parseLodName(name: string): { base: string; level: number } | null {
  const m = LOD_NAME_RE.exec(name.trim());
  if (!m?.[1] || m[2] === undefined) return null;
  return { base: m[1].toLowerCase(), level: Number(m[2]) };
}

/** 原始节点名：GLTFLoader 会把 `.` 等字符剔除、重名加 `_1`，原名保存在 userData.name */
function sourceName(obj: THREE.Object3D): string {
  const n: unknown = obj.userData.name;
  return typeof n === 'string' && n.length > 0 ? n : obj.name;
}

/** 接受 Blender 导出的布尔 true、整数 1 或字符串 "true" */
function flagOn(v: unknown): boolean {
  return v === true || v === 1 || v === 'true';
}

/** 自身或任一祖先标记了 forceLod0 */
export function isForceLod0(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (flagOn(o.userData.forceLod0)) return true;
  }
  return false;
}

/** 固定 LOD0：puzzleCritical 或 forceLod0 */
export function isLod0Locked(obj: THREE.Object3D): boolean {
  return isPuzzleCritical(obj) || isForceLod0(obj);
}

/** 自身或任一祖先标记了 puzzleCritical */
export function isPuzzleCritical(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (flagOn(o.userData.puzzleCritical)) return true;
  }
  return false;
}

function isManagedLod(obj: THREE.Object3D): obj is THREE.LOD {
  return (obj as THREE.LOD).isLOD === true && obj.userData.lodManaged === true;
}

/**
 * 在（刚加载、尚未克隆的）GLB 场景里按命名约定组装 LOD。会原地修改 root。
 * @param dispose 用于释放被丢弃的低级 LOD 的 GPU 资源
 */
export function buildLods(root: THREE.Object3D, dispose?: DisposeFn): LodBuildStats {
  const stats: LodBuildStats = { lodGroups: 0, criticalGroups: 0, forcedGroups: 0, droppedLevels: 0 };

  // 先收集再修改，避免遍历中改树
  const groups = new Map<string, { parent: THREE.Object3D; base: string; nodes: Array<{ level: number; obj: THREE.Object3D }> }>();
  root.traverse((obj) => {
    if (!obj.parent || obj === root) return;
    const parsed = parseLodName(sourceName(obj));
    if (!parsed) return;
    const key = `${obj.parent.uuid}/${parsed.base}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { parent: obj.parent, base: parsed.base, nodes: [] }));
    g.nodes.push({ level: parsed.level, obj });
  });

  for (const { parent, base, nodes } of groups.values()) {
    nodes.sort((a, b) => a.level - b.level);
    const first = nodes[0];
    if (!first) continue;
    if (first.level !== 0) console.warn(`[lod] ${base} 缺少 _lod0，用 _lod${first.level} 作为最高精度`);
    const lod0 = first.obj;
    const critical = nodes.some((n) => isPuzzleCritical(n.obj));
    const forced = !critical && nodes.some((n) => isForceLod0(n.obj));

    if (critical || forced || nodes.length === 1) {
      // 只保留 LOD0：丢弃并释放其余层级
      for (const n of nodes.slice(1)) {
        n.obj.removeFromParent();
        dispose?.(n.obj);
        stats.droppedLevels++;
      }
      // 统一用基名访问；父级已叫这个名字（Blender 里「空物体 + 各级 LOD」的常见结构）时保留原名避免重名
      if (parent.name.toLowerCase() !== base) lod0.name = base;
      if (critical) {
        lod0.userData.puzzleCritical = true;
        stats.criticalGroups++;
      } else if (forced) {
        lod0.userData.forceLod0 = true;
        stats.forcedGroups++;
      }
      continue;
    }

    // 组装 THREE.LOD：放在 LOD0 的位置，其余层级保持相对 LOD0 的变换
    const lod = new THREE.LOD();
    lod.name = base;
    lod.userData = { ...lod0.userData, name: base, lodManaged: true };
    lod.position.copy(lod0.position);
    lod.quaternion.copy(lod0.quaternion);
    lod.scale.copy(lod0.scale);
    lod.updateMatrix();
    const inv = lod.matrix.clone().invert();

    const index = parent.children.indexOf(lod0);
    parent.children.splice(index, 0, lod);
    lod.parent = parent;

    nodes.forEach((n, i) => {
      n.obj.removeFromParent();
      n.obj.updateMatrix();
      n.obj.matrix.premultiply(inv).decompose(n.obj.position, n.obj.quaternion, n.obj.scale);
      // 初始距离只是占位，真正的距离由 applyLodDistances 按画质档位设置
      lod.addLevel(n.obj, i * 1000, LOD_HYSTERESIS);
    });
    stats.lodGroups++;
  }
  return stats;
}

/** 把一个托管 LOD 折叠为只剩 LOD0（释放其余层级），返回替换后的物体 */
function collapseLod(lod: THREE.LOD, dispose?: DisposeFn): THREE.Object3D {
  const [first, ...rest] = lod.levels;
  if (!first) return lod;
  for (const l of rest) {
    l.object.removeFromParent();
    dispose?.(l.object);
  }
  const keep = first.object;
  const parent = lod.parent;
  keep.removeFromParent();
  keep.applyMatrix4(lod.matrix);
  keep.name = lod.name;
  const { lodManaged: _managed, ...rest2 } = lod.userData;
  keep.userData = { ...rest2, puzzleCritical: true };
  if (parent) {
    parent.children.splice(parent.children.indexOf(lod), 1, keep);
    keep.parent = parent;
    lod.parent = null;
  }
  return keep;
}

/**
 * 运行时把物体（及子树）标记为解谜关键：设置 userData.puzzleCritical 并把子树里的 LOD 折叠为 LOD0。
 * 注意：克隆共享几何体/材质，传入 dispose 前确认它们不被其他实例使用（一般不传，只摘除节点）。
 */
export function markPuzzleCritical(root: THREE.Object3D, dispose?: DisposeFn): THREE.Object3D {
  root.userData.puzzleCritical = true;
  const lods: THREE.LOD[] = [];
  root.traverse((o) => {
    if (isManagedLod(o)) lods.push(o);
  });
  let result = root;
  for (const lod of lods) {
    const replaced = collapseLod(lod, dispose);
    if (lod === root) result = replaced;
  }
  return result;
}

/**
 * 按画质档位设置子树内所有托管 LOD 的切换距离（切换画质时再调用一次即可）。
 * puzzleCritical 子树内的 LOD 一律强制 LOD0（距离设为无穷大），作为兜底。
 * @returns 处理的 LOD 数量
 */
export function applyLodDistances(root: THREE.Object3D, distances: LodDistances): number {
  let count = 0;
  root.traverse((o) => {
    if (!isManagedLod(o)) return;
    const critical = isLod0Locked(o);
    o.levels.forEach((level, i) => {
      if (i === 0) level.distance = 0;
      else if (critical) level.distance = Infinity;
      else level.distance = distances[Math.min(i - 1, distances.length - 1)] ?? Infinity;
      level.hysteresis = LOD_HYSTERESIS;
    });
    count++;
  });
  return count;
}

/** 调试用：列出子树内所有托管 LOD 的当前层级 */
export function describeLods(root: THREE.Object3D): Array<{ name: string; level: number; levels: number; critical: boolean }> {
  const out: Array<{ name: string; level: number; levels: number; critical: boolean }> = [];
  root.traverse((o) => {
    if (isManagedLod(o)) out.push({ name: o.name, level: o.getCurrentLevel(), levels: o.levels.length, critical: isLod0Locked(o) });
    else if (flagOn(o.userData.puzzleCritical) || flagOn(o.userData.forceLod0)) out.push({ name: o.name, level: 0, levels: 1, critical: true });
  });
  return out;
}

/**
 * 运行时临时强制 / 取消 LOD0（拿在手里的道具：离相机近、但按自己到相机的距离可能切到低级；例：地窖钥匙挂在汐手上）。
 * 只改切换距离、不释放低级 LOD（放回去可以恢复）；不写 puzzleCritical。原距离存在 userData.lodSavedDistances。
 * @returns 处理的 LOD 数量
 */
export function setForceLod0(root: THREE.Object3D, on: boolean): number {
  root.userData.forceLod0 = on;
  let count = 0;
  root.traverse((o) => {
    if (!isManagedLod(o)) return;
    if (on) {
      if (!o.userData.lodSavedDistances) o.userData.lodSavedDistances = o.levels.map((l) => l.distance);
      o.levels.forEach((l, i) => (l.distance = i === 0 ? 0 : Infinity));
    } else {
      const saved = o.userData.lodSavedDistances as number[] | undefined;
      if (saved) o.levels.forEach((l, i) => (l.distance = saved[i] ?? l.distance));
      delete o.userData.lodSavedDistances;
    }
    count++;
  });
  return count;
}
