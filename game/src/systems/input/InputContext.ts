import type { InputContextName } from './actions';

/**
 * 输入上下文栈：explore（自由探索，栈底常驻）/ puzzle（机关）/ reading（阅读）/ cutscene（演出）/ menu（暂停等菜单）。
 * 栈顶决定当前按键映射。push 返回一个只弹出「这一次 push」的函数，避免嵌套时弹错层。
 */
export class InputContextStack {
  private stack: Array<{ name: InputContextName; id: number }> = [];
  private nextId = 1;
  private onChange: (cur: InputContextName, prev: InputContextName) => void;

  constructor(onChange: (cur: InputContextName, prev: InputContextName) => void = () => undefined) {
    this.onChange = onChange;
  }

  get current(): InputContextName {
    return this.stack[this.stack.length - 1]?.name ?? 'explore';
  }

  /** 从栈底到栈顶，用于调试显示 */
  get names(): InputContextName[] {
    return ['explore', ...this.stack.map((e) => e.name)];
  }

  push(name: InputContextName): () => void {
    const prev = this.current;
    const id = this.nextId++;
    this.stack.push({ name, id });
    if (this.current !== prev) this.onChange(this.current, prev);
    return () => this.remove(id);
  }

  /** 弹出栈顶（或指定名字的最上面一层）。没有可弹的返回 false */
  pop(name?: InputContextName): boolean {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const e = this.stack[i]!;
      if (name === undefined || e.name === name) return this.remove(e.id);
    }
    return false;
  }

  clear(): void {
    const prev = this.current;
    this.stack = [];
    if (this.current !== prev) this.onChange(this.current, prev);
  }

  private remove(id: number): boolean {
    const i = this.stack.findIndex((e) => e.id === id);
    if (i < 0) return false;
    const prev = this.current;
    this.stack.splice(i, 1);
    if (this.current !== prev) this.onChange(this.current, prev);
    return true;
  }
}
