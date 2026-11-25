export type Point = readonly [x: number, y: number, z: number];
export type Stage = 's1' | 's2' | 's3';

export const STAGES = {
  s1: { title: '峡口与船骸', spawn: [9, 2, -7], look: [-5, 10, -25], exit: [4.8, 11.2, -43], next: 's2' },
  s2: { title: '镜巷', spawn: [4.5, 11.2, -43], look: [-7, 14, -49], exit: [-18, 39, -12], next: 's3' },
  s3: { title: '崖顶与礁柱灯塔', spawn: [-19, 39, -11], look: [-5, 26, 28] },
} as const satisfies Record<Stage, { title: string; spawn: Point; look: Point; exit?: Point; next?: Stage }>;

export const VIEWS: Record<Stage, Record<string, readonly [eye: Point, target: Point]>> = {
  s1: {
    overview: [[11, 59, 71], [-2, 15, -22]],
    dock: [[8.6, 3.35, -5.5], [-3, 10.9, -29]],
    market: [[1, 7.6, -33], [-2, 7.6, -54]],
  },
  s2: {
    overview: [[2, 40, -101], [2, 13, -37]],
    plaza: [[4, 13, -36], [-9, 21, -58]],
  },
  s3: {
    overview: [[29, 69, 66], [-8, 21, -3]],
    cable: [[-19, 40.7, -4.1], [-3, 24, 34]],
  },
};

export const CABLE_FROM: Point = [-17, 39, -5];
export const CABLE_TO: Point = [-4, 14, 30];

// 各折返段垂直升高 7 m，斜段长 16 m；实体台阶另外以连续斜面作碰撞。
export const TERRACES = [
  [[-12.8, 11, -43], [-12.8, 18, -59]],
  [[-10.4, 18, -59], [-10.4, 25, -43]],
  [[-12.8, 25, -43], [-12.8, 32, -59]],
  [[-10.4, 32, -59], [-10.4, 39, -43]],
] as const satisfies ReadonlyArray<readonly [Point, Point]>;
