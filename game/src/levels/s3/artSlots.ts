import type { ArtSlotSpec } from '../artSlots';

/**
 * S3 解谜道具（022）替换入口：文件到了（manifest pending 自动加载）就按这里挂上，白盒继续承担碰撞 / 交互 / 光路 / 潮汐逻辑。
 * - 潮汐钟 prop-tide-bell（s3 组 key prop-tide-bell-s3，同一文件不缩放）：挂 env-rock-islet-a 的 tide-bell-s3-socket。
 * - 油阀 prop-oil-valve-s3：挂 oil-valve-s3-socket，`valve-wheel` 跟白盒手轮增量转。
 * - 窗口镜 prop-guide-mirror-window-s3：`-mirror-plane` 对齐白盒镜面；`mirror-yaw` / `mirror-pitch` 直接拷白盒 yaw / pitch
 *   （1030c 交付：正解法线 15.8° / 66.3° 与白盒一致，站位读 `-interact`）。
 * - 导光镜 prop-guide-mirror-wall-s3-a / -b（1030b 拆两个文件，根原点 = 镜心、轴向 = S3 局部不旋转）：挂白盒组、`-mirror-plane` 对齐；
 *   `mirror-pivot` 拷白盒 yaw（单轴；正解 ψ = 白盒 yaw.rotation.y，a 109.777° / b −70.755°）；`mirror-pitch` 固定俯仰烘在节点里，不转。
 * - 点火口 + 拉杆 prop-ignition-port-s3：挂 ignition-port-s3-socket，`-receiver` 对齐白盒受光点；`ignite-lever` 跟白盒拉杆增量转；
 *   1030c：美术 glowNodes 用 mat-prop-ignition-glow，每帧拷白盒透镜材质的四态 emissive（无油红 / 冷白呼吸 / 脉冲 / 点燃暖光），白盒透镜隐藏；站位读 `-interact`。
 * - 油阀 1030c：`valve-wheel` 开阀绕本地 +Z 转 +90°（白盒手轮同向同角，delta 驱动）；站位读 `-interact`（手轮正前 0.40 m 地面）。
 */
const wall = (k: 'a' | 'b'): ArtSlotSpec => ({
  key: `prop-guide-mirror-wall-s3-${k}`,
  id: `prop-guide-mirror-wall-s3-${k}`,
  at: [`guide-mirror-s3-mid-${k}`],
  align: { art: 'mirror-plane', logic: `guide-mirror-s3-mid-${k}-mirror-plane` },
  drive: [{ art: 'mirror-pivot', logic: `guide-mirror-s3-mid-${k}-yaw`, mode: 'copy' }],
  hide: [`guide-mirror-s3-mid-${k}`],
});

export const S3_ART_SLOTS: readonly ArtSlotSpec[] = [
  { key: 'prop-tide-bell-s3', at: ['tide-bell-s3-socket', 'tide-bell-s3'], drive: [{ art: 'bell-swing', logic: 'tide-bell-s3-swing' }, { art: 'bell-clapper', logic: 'tide-bell-s3-clapper' }], hide: ['tide-bell-s3'] },
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
    // 1030c：glowNodes（透镜 + 观察窗，mat-prop-ignition-glow）跟白盒透镜四态（BeamRenderer.igniterLens）；白盒透镜球隐藏（光路 / 受光逻辑不受影响）
    glow: { material: 'mat-prop-ignition-glow', logic: 'ignition-port-s3-lens' },
    hide: ['ignite-lever-s3', 'ignition-port-s3-lens'],
  },
];
