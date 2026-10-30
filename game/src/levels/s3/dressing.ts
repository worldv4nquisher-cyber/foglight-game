import type { DressingSpec } from '../dressing';
import { S3, S3_FRAME, toWorld } from './layout';

/** layout 点是 S3 局部坐标：回退时转世界、朝向跟 S3 框架 */
const W = (p: readonly [number, number, number]): [number, number, number] => toWorld(p).toArray();
const yaw = S3_FRAME.rotationY;

const surface = { roots: ['s3-art'], maxSnap: 0.1 };

/** S3 剧情物件（README-027） */
export function s3DressingSpecs(): DressingSpec[] {
  return [
    // 守灯日志：lighthouse 室内木架板 logbook-s3-read，挂白盒 logbook-s3
    { key: 'prop-logbook-s3', id: 'prop-logbook-s3', at: ['logbook-s3-read', W(S3.points.logbookRead)], yaw, greybox: 'logbook-s3', surface },
    // 点灯说明（纸 B）：灯室铁托盘 ignition-note-read，GLB 默认平放，不加 rotX
    { key: 'prop-letter-b', id: 'prop-letter-b-s3', at: ['ignition-note-read', W(S3.points.noteRead)], yaw, greybox: 'ignition-note-s3', surface },
    // 父亲日记（摊开版）：灯室 lamp-room-journal-socket
    {
      key: 'prop-journal-father-s3',
      id: 'prop-journal-father-s3',
      at: ['lamp-room-journal-socket', W(S3.points.journal)],
      yaw,
      variant: { show: 'prop-journal-father-open', hide: ['prop-journal-father-closed'] },
      surface,
    },
  ];
}
