import * as THREE from 'three';
import type { Component, ComponentClass } from './Component';

let nextId = 1;

/** 实体 = 一个 Object3D（可视/变换）+ 一组组件 */
export class Entity {
  name: string;
  readonly id = nextId++;
  readonly object3D: THREE.Object3D;
  readonly tags = new Set<string>();
  private components: Component[] = [];
  destroyed = false;

  constructor(
    name: string,
    object3D: THREE.Object3D = new THREE.Group(),
  ) {
    this.name = name;
    this.object3D = object3D;
    this.object3D.name = name;
    this.object3D.userData.entityId = this.id;
  }

  add<T extends Component>(component: T): T {
    component.entity = this;
    this.components.push(component);
    component.onAttach();
    return component;
  }

  get<T extends Component>(type: ComponentClass<T>): T | undefined {
    return this.components.find((c): c is T => c instanceof type);
  }

  require<T extends Component>(type: ComponentClass<T>): T {
    const c = this.get(type);
    if (!c) throw new Error(`Entity "${this.name}" 缺少组件 ${type.name}`);
    return c;
  }

  remove(component: Component): void {
    const i = this.components.indexOf(component);
    if (i >= 0) {
      this.components.splice(i, 1);
      component.onDetach();
    }
  }

  fixedUpdate(dt: number): void {
    for (const c of this.components) if (c.enabled) c.fixedUpdate(dt);
  }

  update(dt: number, alpha: number): void {
    for (const c of this.components) if (c.enabled) c.update(dt, alpha);
  }

  destroy(): void {
    for (const c of this.components) c.onDetach();
    this.components = [];
    this.destroyed = true;
  }
}
