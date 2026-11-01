/** 类型声明：实现见同名 .js（batch27 第 2 项，index.html 内联与模块共用的唯一实现） */
export declare function cloneFallback<T>(value: T, seen?: Map<unknown, unknown>): T;
export declare function installStructuredClonePolyfill(target: { structuredClone?: unknown }): boolean;
