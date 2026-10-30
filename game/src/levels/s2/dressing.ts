import type { DressingSpec } from '../dressing';
import { S2 } from './layout';

/** S2 美术根名（书桌 / 桌面实测落点用） */
const S2_ART_ROOT = 's2-art';
/** 桌面实测吸附上限：超过当作没打中真桌面（落在别的东西上），保留 layout 高度 */
const SURFACE_SNAP = 0.1;

/** S2 剧情物件（README-027；坐标 = env socket 优先，缺 socket 时回退 layout） */
export function s2DressingSpecs(): DressingSpec[] {
  const d = S2.furniture.desk;
  const t = S2.furniture.table;
  const surface = { roots: [S2_ART_ROOT], maxSnap: SURFACE_SNAP };
  return [
    // 书桌静物组（原点 = 桌面中心；先摆，纸条要落在它的航海图上）
    { key: 'prop-desk-set-a', id: 'prop-desk-set-a-s2', at: [[(d.x[0] + d.x[1]) / 2, d.top, (d.z[0] + d.z[1]) / 2]], surface },
    // 餐桌静物组（原点 = 桌面中心；局部 +0.05 处留给杯子）
    { key: 'prop-kitchen-set-a', id: 'prop-kitchen-set-a-s2', at: [[t.c[0], t.h, t.c[2]]], surface },
    // 父亲日记（合上版）：S2 书桌 journalSocket，挂白盒 journal-s2（交互焦点改读美术 -interact）
    {
      key: 'prop-journal-father',
      id: 'prop-journal-father-s2',
      at: ['env-keeper-house-ch1-interior-journal-socket', S2.points.journalSocket],
      variant: { show: 'prop-journal-father-closed', hide: ['prop-journal-father-open'] },
      greybox: 'journal-s2',
      surface,
    },
    // 汐的纸条（压在书桌组的航海图上）
    { key: 'prop-letter-c', id: 'prop-letter-c-s2', at: [S2.points.xiNote], yaw: S2.points.xiNoteYaw, greybox: 'xi-note-s2', surface: { roots: [S2_ART_ROOT, 'prop-desk-set-a-s2'], maxSnap: SURFACE_SNAP } },
    // 两只铁皮杯：一正一倒扣（倒扣 = GLB extras.poses.upturned），挂白盒 cups-s2
    { key: 'prop-cup-tin', id: 'prop-cup-tin-s2-a', at: ['env-keeper-house-ch1-interior-cups-socket', S2.points.cups], offset: [-0.06, 0, 0.01], greybox: 'cups-s2', surface },
    { key: 'prop-cup-tin', id: 'prop-cup-tin-s2-b', at: ['env-keeper-house-ch1-interior-cups-socket', S2.points.cups], offset: [0.06, 0, -0.01], pose: 'upturned', greybox: 'cups-s2', surface },
    // 地窖草图：env 地窖 sketch socket
    { key: 'prop-sketch-window', id: 'prop-sketch-sheet-s2', at: ['env-cellar-s2-sketch-socket', S2.points.cellarSketch], greybox: 'sketch-s2' },
  ];
}
