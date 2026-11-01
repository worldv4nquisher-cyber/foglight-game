/**
 * batch27 第 2 项：structuredClone 降级的**唯一实现**（Safari 15.0–15.3 及更老 WebView 没有 structuredClone，15.4 才有）。
 * 两处用法共用这一份源码：
 *   1. index.html 的内联 <script id="polyfill-structured-clone">：vite 插件（vite.config.ts → scripts/lib/inline-polyfill.mjs）
 *      在 dev / 构建时把本文件去掉 export 后原样内联，普通脚本先于所有 type="module"（含 three / vendor 分包）执行；
 *   2. 模块里：clone.ts（deepClone / cloneFallback）与 polyfills.ts（main.ts 第一个 import，内联脚本没跑时兜底）直接 import。
 * 只拷数据：普通对象 / 数组 / Date / Map / Set / 环引用（存档和参数表都是纯 JSON 数据，够用）；transfer 选项不支持（全仓没人用）。
 * 约束（因为要内联进 HTML）：纯 JS、不 import 别的模块、只有顶层 function 声明、不出现 HTML 的脚本结束标签。
 */

/** 无 structuredClone 时的降级深拷贝 */
export function cloneFallback(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  if (!seen) seen = new Map();
  if (seen.has(value)) return seen.get(value);
  var out, i, keys;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    out = [];
    seen.set(value, out);
    for (i = 0; i < value.length; i++) out.push(cloneFallback(value[i], seen));
    return out;
  }
  if (value instanceof Map) {
    out = new Map();
    seen.set(value, out);
    value.forEach(function (v, k) {
      out.set(cloneFallback(k, seen), cloneFallback(v, seen));
    });
    return out;
  }
  if (value instanceof Set) {
    out = new Set();
    seen.set(value, out);
    value.forEach(function (v) {
      out.add(cloneFallback(v, seen));
    });
    return out;
  }
  out = {};
  seen.set(value, out);
  keys = Object.keys(value);
  for (i = 0; i < keys.length; i++) out[keys[i]] = cloneFallback(value[keys[i]], seen);
  return out;
}

/** 没有原生 structuredClone 时在 target 上装降级版（不可枚举、可写、可配置）；有原生不覆盖。返回是否装了 */
export function installStructuredClonePolyfill(target) {
  if (typeof target.structuredClone === 'function') return false;
  Object.defineProperty(target, 'structuredClone', {
    value: function structuredClone(value) {
      return cloneFallback(value, new Map());
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return true;
}
