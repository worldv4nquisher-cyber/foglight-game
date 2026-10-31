/**
 * 037 预算校验机位（scripts/verify-budget.mjs 读）：每个场景 3 个「最差」机位（可见三角面 / draw call 最多）。
 * - eye / at：世界坐标（米）；fov：竖直视场角（度）。
 * - 初值由 `verify-budget.mjs --scan` 自动扫出来（出生点周围 8 个方向、每个可交互物周围 4 个方向的第三人称机位，取极致档主 pass 面数最高的 3 个，互相隔开 ≥ 4 m）；
 *   制作人可以随时补机位（照抄格式，id 不重复即可），verify-budget 三档逐个量。
 * 本文件会被 Node 直接导入：只能 `import type`。
 */
export interface PerfSpot {
  id: string;
  /** 一句话说明（报告里显示） */
  label: string;
  eye: readonly [number, number, number];
  at: readonly [number, number, number];
  fov: number;
}

export type PerfSceneId = 's1' | 's2' | 's3';

export const PERF_SPOTS: Record<PerfSceneId, readonly PerfSpot[]> = {
  s1: [
    // --scan s1（10-31，极致档主 pass 面数前 3，互相隔开 ≥ 4 m）
    { id: 's1-raft-back', label: '木筏后上方朝 −z 看（draw call 最多）', eye: [9.1, 4.05, 15], at: [9.1, 2.85, 10.5], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    { id: 's1-neighbor-note', label: '邻居字条 +x 侧朝 −x 看', eye: [19.55, 2.33, -1.7], at: [15.05, 1.13, -1.7], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    { id: 's1-spawn-north', label: '出生点 −z 侧朝 +z 看', eye: [2.28, 4.4, -16.27], at: [2.28, 3.2, -11.77], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    // 025 开场大景（制作人补充位）
    { id: 's1-opening', label: '开场远景：沙滩 → 灯塔方向', eye: [-0.9, 4.2, 9.5], at: [6.58, 4.2, -29.78], fov: 40 }, // text-ok: 预算校验机位说明，只进性能报告
  ],
  s2: [
    // --scan s2（10-31 20:33，极致档主 pass 面数前 3，互相隔开 ≥ 4 m）
    { id: 's2-white-stone-5', label: '白石 5 +x 侧朝 −x 看（面数 / draw call 最多）', eye: [24.9, 1.41, 1.2], at: [20.4, 0.21, 1.2], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    { id: 's2-white-stone-1', label: '白石 1 +x 侧朝 −x 看', eye: [21.1, 1.71, 2.8], at: [16.6, 0.51, 2.8], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    { id: 's2-dial-gate', label: '转盘门 +z 侧朝 −z 看', eye: [4.2, 3.15, 16.25], at: [4.2, 1.95, 11.75], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
  ],
  s3: [
    // --scan s3（10-31 20:40，同上）
    { id: 's3-spawn-south', label: '出生点 +z 侧朝 −z 看（面数 / draw call 最多）', eye: [39.73, 5.2, -86.25], at: [39.73, 4, -90.75], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    { id: 's3-oil-valve', label: '油阀 −z 侧朝 +z 看', eye: [40.96, 3.1, -129.88], at: [40.96, 1.9, -125.38], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
    { id: 's3-logbook', label: '航海日志 −z 侧朝 +z 看', eye: [40.64, 5.58, -124.6], at: [40.64, 4.38, -120.1], fov: 50 }, // text-ok: 预算校验机位说明，只进性能报告
  ],
};
