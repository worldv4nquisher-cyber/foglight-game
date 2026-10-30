import type { TextId } from '@/content/text';
import { S1 } from './layout';
import { footprintsMonoZone } from './footprints';

/** 潮汐钟「风吹轻响」/ 第一次看到钟独白的距离（m） */
export const BELL_HEAR_DISTANCE = 12;

/** 水平面（XZ）上的触发区形状：圆 / 轴对齐矩形 */
export type S1ZoneShape = { kind: 'circle'; x: number; z: number; r: number } | { kind: 'box'; min: readonly [number, number]; max: readonly [number, number] };

/**
 * S1 会弹字幕的位置触发区（独白 / 目标换行）。puzzles.ts 的小径尽头 / 脚印独白直接用这里的圆（s1SubtitleCircle），
 * 钟（BELL_HEAR_DISTANCE）和沟边（nearPlatform）用同一组 layout 数据。
 * verify-dressing 断言两两在 XZ 上不重叠（033：脚印独白挪到 T2，就是为了不和小径尽头同时弹）。
 */
export function s1SubtitleZones(): { id: TextId; shape: S1ZoneShape }[] {
  const fz = footprintsMonoZone();
  const N = S1.nearPlatform;
  return [
    { id: 'ch1.s1.tide_bell.mono_seen', shape: { kind: 'circle', x: S1.bellAnchor[0], z: S1.bellAnchor[2], r: BELL_HEAR_DISTANCE } },
    { id: 'ch1.s1.footprints.mono', shape: { kind: 'circle', x: fz.x, z: fz.z, r: fz.r } },
    { id: 'ch1.s1.goal.cross_channel', shape: { kind: 'circle', x: S1.reefPathEnd[0], z: S1.reefPathEnd[2], r: S1.reefPathEndRadius } },
    { id: 'ch1.s1.channel.mono', shape: { kind: 'box', min: [N.min[0], N.max[1] - 1.0], max: [N.max[0], N.max[1] + 0.1] } },
  ];
}

/** 取一个圆形字幕触发区（puzzles.ts 用） */
export function s1SubtitleCircle(id: TextId): { x: number; z: number; r: number } {
  const z = s1SubtitleZones().find((e) => e.id === id)?.shape;
  if (!z || z.kind !== 'circle') throw new Error('s1SubtitleCircle: no circle zone ' + id);
  return { x: z.x, z: z.z, r: z.r };
}
