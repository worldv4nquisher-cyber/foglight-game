import type { ArtSlotSpec } from '../artSlots';

/**
 * S1 解谜道具（021）替换入口：文件到了（manifest pending 自动加载）就按这里挂上，白盒继续承担碰撞 / 交互 / 潮汐逻辑。
 * - 潮汐钟 prop-tide-bell：挂 018 岸台 env-shore-ledge-s1-bell-anchor（没有就挂白盒钟根）；`bell-swing` 跟白盒钟摆增量转。
 * - 浮台 prop-raft-s1：挂白盒浮台根（= 甲板顶面，跟着推 / 浮起 / 重置走）；美术原点请放甲板顶面中心。
 */
export const S1_ART_SLOTS: readonly ArtSlotSpec[] = [
  { key: 'prop-tide-bell', at: ['env-shore-ledge-s1-bell-anchor', 'tide-bell-s1'], drive: [{ art: 'bell-swing', logic: 'tide-bell-s1-swing' }], hide: ['tide-bell-s1'] },
  { key: 'prop-raft-s1', at: ['raft-s1'], hide: ['raft-s1'] },
];
