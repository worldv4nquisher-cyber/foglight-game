import type { ArtSlotSpec } from '../artSlots';

/**
 * S2 解谜道具（021）替换入口：文件到了（manifest pending 自动加载）就按这里挂上，白盒继续承担碰撞 / 交互 / 光路 / 谜题逻辑。
 * - 立镜 prop-mirror-stand-s2 ×2：挂院墙 `env-courtyard-wall-s2-mirror-a/b-socket`（缺失挂白盒立镜根）；`-mirror-plane` 对齐白盒镜面中心；`mirror-pivot` 世界旋转 = 白盒 yaw 的世界旋转（美术 0° = 镜面朝 +Z；socket 朝向与白盒不同也对）。
 * - 光感锁 prop-light-lock-s2：挂小屋 env-keeper-house-ch1-light-lock-socket，`-receiver` 对齐白盒受光点；
 *   1030c：透镜 / 指针 / 门闩由 LightLockArt 按受光进度驱动（#F4C978 × 进度 × 1.6、指针 60° → −60°、解锁门闩 +X 0.08 / 0.3 s），白盒透镜隐藏。
 * - 白漆石块组 prop-white-stones-s2：挂 env-clifftop-s2 根（石块按崖顶局部坐标摆，与 extras.stonesArea 同一坐标系）；白盒石块隐藏，「3 1 7」渐显仍由程序做。
 * - 拨盘铁门 prop-dial-gate-s2：挂 env-clifftop-s2-gate-socket，`gate-door` 对齐白盒合页；门扇 / 三个拨盘按白盒增量转。
 */
const mirror = (k: 'a' | 'b'): ArtSlotSpec => ({
  key: 'prop-mirror-stand-s2',
  id: `prop-mirror-stand-s2-${k}`,
  // 美术回复 1030：院墙 GLB 给安装位 env-courtyard-wall-s2-mirror-a/b-socket，优先挂它；缺失用白盒立镜根（= courtyard extras.mirrorsPlaceholder 坐标）
  at: [`env-courtyard-wall-s2-mirror-${k}-socket`, `mirror-stand-s2-${k}`],
  align: { art: 'mirror-plane', logic: `mirror-stand-s2-${k}-mirror-plane` },
  drive: [{ art: 'mirror-pivot', logic: `mirror-stand-s2-${k}-yaw`, mode: 'world' }],
  hide: [`mirror-stand-s2-${k}`],
});

export const S2_ART_SLOTS: readonly ArtSlotSpec[] = [
  mirror('a'),
  mirror('b'),
  { key: 'prop-light-lock-s2', at: ['env-keeper-house-ch1-light-lock-socket'], align: { art: 'receiver', logic: 'light-lock-s2-receiver' }, hide: ['light-lock-s2-frame-collider', 'light-lock-s2-lens'] },
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
    keep: ['dial-gate-s2-panel', 'dial-gate-s2-dial-1', 'dial-gate-s2-dial-2', 'dial-gate-s2-dial-3', 'dial-gate-s2-pointer-1', 'dial-gate-s2-pointer-2', 'dial-gate-s2-pointer-3'],
  },
];
