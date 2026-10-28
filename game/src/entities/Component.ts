import type { Entity } from './Entity';

/**
 * 组件基类（轻量 ECS 风格：组件持有数据 + 可选的行为钩子）。
 * 简单行为直接写在组件 update 里；跨实体的逻辑（物理、相机）放到 systems/。
 */
export abstract class Component {
  entity!: Entity;
  enabled = true;

  /** 挂到实体上时调用 */
  onAttach(): void {}
  /** 固定步长逻辑 */
  fixedUpdate(_dt: number): void {}
  /** 每帧（渲染前）逻辑，alpha 为插值系数 */
  update(_dt: number, _alpha: number): void {}
  onDetach(): void {}
}

export type ComponentClass<T extends Component> = abstract new (...args: never[]) => T;
