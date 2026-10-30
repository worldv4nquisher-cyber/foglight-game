import type { ArtSlotSpec } from '../artSlots';

/**
 * S1 解谜道具（021）替换入口：文件到了（manifest pending 自动加载）就按这里挂上，白盒继续承担碰撞 / 交互 / 潮汐逻辑。
 * - 潮汐钟 prop-tide-bell：挂 018 岸台 env-shore-ledge-s1-bell-anchor（没有就挂白盒钟根）；`bell-swing` / `bell-clapper` 跟白盒钟摆 / 钟锤增量转，汐的站位读 `prop-tide-bell-interact`（S1Scene snapToArt）。
 * - 浮台 prop-raft-s1（10-30 交付）：根 = 甲板顶面中心 = 白盒 raft-s1 根，零变换挂上（跟着推 / 浮起 / 重置走）；碰撞仍是白盒 2.0×0.3×3.0，推把只是外观；
 *   汐的推站位读 prop-raft-s1-interact（S1Scene snapToArt，与白盒同位）。
 */
export const S1_ART_SLOTS: readonly ArtSlotSpec[] = [
  { key: 'prop-tide-bell', at: ['env-shore-ledge-s1-bell-anchor', 'tide-bell-s1'], drive: [{ art: 'bell-swing', logic: 'tide-bell-s1-swing' }, { art: 'bell-clapper', logic: 'tide-bell-s1-clapper' }], hide: ['tide-bell-s1'] },
  { key: 'prop-raft-s1', at: ['raft-s1'], hide: ['raft-s1'] },
];
