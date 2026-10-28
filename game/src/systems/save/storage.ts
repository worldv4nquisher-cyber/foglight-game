/** localStorage 的最小接口，便于 Node 校验脚本注入假实现（含「写入抛错」的隐私模式模拟） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 浏览器里的 localStorage；某些隐私模式下访问 localStorage 本身就会抛错，返回 null */
export function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 实际写一次再删掉，检测是否可写（Safari 旧版隐私模式 getItem 正常、setItem 抛 QuotaExceededError） */
export function probeWritable(storage: StorageLike | null): boolean {
  if (!storage) return false;
  const k = '__foglight_probe__';
  try {
    storage.setItem(k, '1');
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function safeGet(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(storage: StorageLike | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(storage: StorageLike | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* ignore */
  }
}
