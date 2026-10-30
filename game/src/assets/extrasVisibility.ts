import type * as THREE from 'three';

/**
 * glTF 不存可见性：美术把「默认隐藏」写在节点 extras 里（→ three userData）。加载后统一按它设 visible：
 * - `defaultVisible: false`（美术 1030 船绳 -rope-low 的写法）
 * - `visible: false` / `hidden: true`（同义的通用写法）
 * 只隐藏，不会把 GLB 里本来就不可见的节点打开；之后游戏逻辑（如涨退潮两版切换）可以随时再改 visible。
 * 返回隐藏的节点数。
 */
export function isHiddenByExtras(u: Record<string, unknown> | undefined): boolean {
  if (!u) return false;
  return u.defaultVisible === false || u.visible === false || u.hidden === true;
}

export function applyExtrasVisibility(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (isHiddenByExtras(o.userData) && o.visible) {
      o.visible = false;
      n++;
    }
  });
  return n;
}
