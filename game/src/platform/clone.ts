/**
 * batch26 ②：深拷贝。Safari 15.0–15.3（及更老的 WebView）没有 structuredClone（15.4 才有），
 * 直接调用会在第一次存档 / 读档（SaveSystem 构造里 load）时抛 ReferenceError。
 * 有原生就用原生；没有就走降级：递归拷贝普通对象 / 数组 / Date / Map / Set（存档和参数表都是纯 JSON 数据，够用）。
 * 不覆盖全局（不做全局 polyfill），调用方统一用 deepClone。
 */
export function deepClone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (typeof sc === 'function') return sc(value);
  return cloneFallback(value, new Map());
}

/** 无 structuredClone 时的降级（导出给单测直接比对） */
export function cloneFallback<T>(value: T, seen: Map<unknown, unknown> = new Map()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const v of value) out.push(cloneFallback(v, seen));
    return out as T;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [k, v] of value) out.set(cloneFallback(k, seen), cloneFallback(v, seen));
    return out as T;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const v of value) out.add(cloneFallback(v, seen));
    return out as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = cloneFallback((value as Record<string, unknown>)[k], seen);
  return out as T;
}
