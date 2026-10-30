import PATH from './footprints-path.json';

/**
 * 033 S1 脚印贴花路径（美术 art/models/props/preview/033-footprints-path.json 的入库拷贝，art/ 不在 git 里，
 * 只拉 game/ 时也要能构建）。verify-dressing「脚印路径 json = 美术原件」逐字节比对，美术改了 json 重新拷一份即可。
 * 坐标：世界坐标（+Z 北、东 = −X），center.y = 美术地面 artGroundY + 0.015，直接用作贴花高度（不再打物理射线：
 * 物理射线打在灰盒小径板上，比美术地面高 0.38–0.54 m）。
 */
export interface FootprintTile {
  /** T1…T4（沿走向：小径尽头 → 浮台） */
  id: string;
  center: readonly [number, number, number];
  /** 绕 Y：脚尖（纹理 −V）的世界走向 = (sin yaw, cos yaw) */
  yaw: number;
  from: readonly [number, number];
  to: readonly [number, number];
}

interface RawTile {
  center: number[];
  yaw: number;
  from_: number[];
  to: number[];
}

export const FOOTPRINT_TILES: readonly FootprintTile[] = (PATH.tiles as RawTile[]).map((t, i) => ({
  id: `T${i + 1}`,
  center: [t.center[0]!, t.center[1]!, t.center[2]!] as const,
  yaw: t.yaw,
  from: [t.from_[0]!, t.from_[1]!] as const,
  to: [t.to[0]!, t.to[1]!] as const,
}));

/** 独白「比我的脚印大。」触发圆：T2 中心、半径 1.4（不放 T1：T1 和小径尽头 reefPathEnd r 1.3 的触发圆重叠，两句字幕会一起弹） */
export const FOOTPRINTS_MONO_RADIUS = 1.4;
export function footprintsMonoZone(): { x: number; z: number; r: number } {
  const t2 = FOOTPRINT_TILES[1];
  if (!t2) throw new Error('033-footprints-path.json 少于 2 块贴花');
  return { x: t2.center[0], z: t2.center[2], r: FOOTPRINTS_MONO_RADIUS };
}
