import type * as THREE from 'three';
import type { Entity } from './Entity';

/** 管理场景内实体：添加到 three 场景、统一更新、延迟移除 */
export class EntityManager {
  private entities: Entity[] = [];
  private pendingRemove = new Set<Entity>();

  constructor(private root: THREE.Object3D) {}

  add(entity: Entity): Entity {
    this.entities.push(entity);
    this.root.add(entity.object3D);
    return entity;
  }

  remove(entity: Entity): void {
    this.pendingRemove.add(entity);
  }

  findByTag(tag: string): Entity[] {
    return this.entities.filter((e) => e.tags.has(tag));
  }

  fixedUpdate(dt: number): void {
    for (const e of this.entities) e.fixedUpdate(dt);
    this.flush();
  }

  update(dt: number, alpha: number): void {
    for (const e of this.entities) e.update(dt, alpha);
  }

  private flush(): void {
    if (this.pendingRemove.size === 0) return;
    this.entities = this.entities.filter((e) => {
      if (!this.pendingRemove.has(e)) return true;
      e.destroy();
      e.object3D.removeFromParent();
      return false;
    });
    this.pendingRemove.clear();
  }

  /** 销毁全部实体并从场景摘下；返回摘下的根节点，调用方负责释放它们的 GPU 资源（摘下后场景 dispose 遍历不到） */
  clear(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    for (const e of this.entities) {
      e.destroy();
      e.object3D.removeFromParent();
      roots.push(e.object3D);
    }
    this.entities = [];
    this.pendingRemove.clear();
    return roots;
  }
}
