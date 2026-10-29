import type { ArtSlotSpec } from '../artSlots';

/**
 * S3 解谜道具（022）替换入口：文件到了（manifest pending 自动加载）就按这里挂上，白盒继续承担碰撞 / 交互 / 光路 / 潮汐逻辑。
 * - 潮汐钟 prop-tide-bell（s3 组 key prop-tide-bell-s3，同一文件不缩放）：挂 env-rock-islet-a 的 tide-bell-s3-socket。
 * - 油阀 prop-oil-valve-s3：挂 oil-valve-s3-socket，`valve-wheel` 跟白盒手轮增量转。
 * - 窗口镜 prop-guide-mirror-window-s3：`-mirror-plane` 对齐白盒镜面；`mirror-yaw` / `mirror-pitch` 直接拷白盒 yaw / pitch。
 * - 导光镜 prop-guide-mirror-wall-s3 ×2：`-mirror-plane` 对齐；`mirror-pivot` 拷白盒 yaw（固定俯仰做在支架里）。
 * - 点火口 + 拉杆 prop-ignition-port-s3：挂 ignition-port-s3-socket，`-receiver` 对齐白盒受光点；`ignite-lever` 跟白盒拉杆增量转；
 *   白盒透镜保留（四态发光反馈，美术发光材质接程序前先用它）。
 */
const wall = (k: 'a' | 'b'): ArtSlotSpec => ({
  key: 'prop-guide-mirror-wall-s3',
  id: `prop-guide-mirror-wall-s3-${k}`,
  at: [`guide-mirror-s3-mid-${k}`],
  align: { art: 'mirror-plane', logic: `guide-mirror-s3-mid-${k}-mirror-plane` },
  drive: [{ art: 'mirror-pivot', logic: `guide-mirror-s3-mid-${k}-yaw`, mode: 'copy' }],
  hide: [`guide-mirror-s3-mid-${k}`],
});

export const S3_ART_SLOTS: readonly ArtSlotSpec[] = [
  { key: 'prop-tide-bell-s3', at: ['tide-bell-s3-socket', 'tide-bell-s3'], drive: [{ art: 'bell-swing', logic: 'tide-bell-s3-swing' }], hide: ['tide-bell-s3'] },
  { key: 'prop-oil-valve-s3', at: ['oil-valve-s3-socket', 'oil-valve-s3'], drive: [{ art: 'valve-wheel', logic: 'oil-valve-s3-wheel' }], hide: ['oil-valve-s3'] },
  {
    key: 'prop-guide-mirror-window-s3',
    at: ['guide-mirror-s3-window'],
    align: { art: 'mirror-plane', logic: 'guide-mirror-s3-window-mirror-plane' },
    drive: [
      { art: 'mirror-yaw', logic: 'guide-mirror-s3-window-yaw', mode: 'copy' },
      { art: 'mirror-pitch', logic: 'guide-mirror-s3-window-pitch', mode: 'copy' },
    ],
    hide: ['guide-mirror-s3-window'],
  },
  wall('a'),
  wall('b'),
  {
    key: 'prop-ignition-port-s3',
    at: ['ignition-port-s3-socket'],
    align: { art: 'receiver', logic: 'ignition-port-s3-receiver' },
    drive: [{ art: 'ignite-lever', logic: 'ignite-lever-s3-swing' }],
    hide: ['ignite-lever-s3'],
  },
];
