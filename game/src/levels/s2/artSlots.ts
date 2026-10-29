import type { ArtSlotSpec } from '../artSlots';

/**
 * S2 解谜道具（021）替换入口：文件到了（manifest pending 自动加载）就按这里挂上，白盒继续承担碰撞 / 交互 / 光路 / 谜题逻辑。
 * - 立镜 prop-mirror-stand-s2 ×2：`-mirror-plane` 对齐白盒镜面中心；`mirror-pivot` 直接拷白盒 yaw 的旋转（美术 0° = 镜面朝 +Z）。
 * - 光感锁 prop-light-lock-s2：挂小屋 env-keeper-house-ch1-light-lock-socket，`-receiver` 对齐白盒受光点；白盒透镜保留（受光提亮反馈）。
 * - 白漆石块组 prop-white-stones-s2：挂 env-clifftop-s2 根（石块按崖顶局部坐标摆，与 extras.stonesArea 同一坐标系）；白盒石块隐藏，「3 1 7」渐显仍由程序做。
 * - 拨盘铁门 prop-dial-gate-s2：挂 env-clifftop-s2-gate-socket，`gate-door` 对齐白盒合页；门扇 / 三个拨盘按白盒增量转。
 */
const mirror = (k: 'a' | 'b'): ArtSlotSpec => ({
  key: 'prop-mirror-stand-s2',
  id: `prop-mirror-stand-s2-${k}`,
  at: [`mirror-stand-s2-${k}`],
  align: { art: 'mirror-plane', logic: `mirror-stand-s2-${k}-mirror-plane` },
  drive: [{ art: 'mirror-pivot', logic: `mirror-stand-s2-${k}-yaw`, mode: 'copy' }],
  hide: [`mirror-stand-s2-${k}`],
});

export const S2_ART_SLOTS: readonly ArtSlotSpec[] = [
  mirror('a'),
  mirror('b'),
  { key: 'prop-light-lock-s2', at: ['env-keeper-house-ch1-light-lock-socket'], align: { art: 'receiver', logic: 'light-lock-s2-receiver' }, hide: ['light-lock-s2-frame-collider'] },
  { key: 'prop-white-stones-s2', at: ['env-clifftop-s2', 'white-stones-s2'], hide: ['white-stones-s2'] },
  {
    key: 'prop-dial-gate-s2',
    at: ['env-clifftop-s2-gate-socket', 's2-dial-gate-hinge'],
    align: { art: 'gate-door', logic: 's2-dial-gate-hinge' },
    drive: [
      { art: 'gate-door', logic: 's2-dial-gate-hinge' },
      { art: 'dial-0', logic: 'dial-gate-s2-dial-1' },
      { art: 'dial-1', logic: 'dial-gate-s2-dial-2' },
      { art: 'dial-2', logic: 'dial-gate-s2-dial-3' },
    ],
    hide: ['s2-dial-gate-hinge'],
  },
];
