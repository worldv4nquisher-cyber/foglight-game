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
  s2: [],
  s3: [],
};
