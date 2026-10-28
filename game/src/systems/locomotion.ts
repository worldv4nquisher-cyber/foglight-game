import { gameplay } from '@/config/gameplay';

/**
 * 角色移动的纯数学部分（PlayerController 调用；Node 单测直接测这里）：
 * 相机相对的移动方向、慢走 / 小跑目标速度、0.12 s 内加速到位、540°/s 转身。
 */
export interface LocomotionState {
  vx: number;
  vz: number;
  /** 模型朝向（弧度，atan2(x, z)，0 = +z） */
  facing: number;
}

export interface LocomotionInput {
  /** 摇杆 / WASD：x 右，y 前，长度 ≤ 1 */
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** 相机水平朝向（弧度，相机看向 -z 时为 0） */
  cameraYaw: number;
}

const cfg = gameplay.player;

export function targetVelocity(input: LocomotionInput, out: { x: number; z: number }): { x: number; z: number } {
  const { moveX, moveY, cameraYaw: yaw } = input;
  const len = Math.min(1, Math.hypot(moveX, moveY));
  if (len < 1e-3) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let dx = rx * moveX + fx * moveY;
  let dz = rz * moveX + fz * moveY;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  const speed = (input.sprint ? cfg.runSpeed : cfg.walkSpeed) * len;
  out.x = dx * speed;
  out.z = dz * speed;
  return out;
}

const tv = { x: 0, z: 0 };

/** 推进一个固定步：速度按「accelTime 内到位」逼近目标，朝向按 turnSpeedDeg 转向移动方向 */
export function stepLocomotion(s: LocomotionState, input: LocomotionInput, dt: number): void {
  targetVelocity(input, tv);
  const moving = tv.x !== 0 || tv.z !== 0;
  const time = moving ? cfg.accelTime : cfg.decelTime;
  // 线性逼近：任何速度差都在 time 秒内补齐（最大速度变化率 = runSpeed / time）
  const maxDelta = ((input.sprint ? cfg.runSpeed : cfg.walkSpeed) / Math.max(1e-3, time)) * dt;
  const dx = tv.x - s.vx;
  const dz = tv.z - s.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) {
    s.vx = tv.x;
    s.vz = tv.z;
  } else {
    s.vx += (dx / d) * maxDelta;
    s.vz += (dz / d) * maxDelta;
  }
  if (moving) {
    const want = Math.atan2(tv.x, tv.z);
    let diff = want - s.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = ((cfg.turnSpeedDeg * Math.PI) / 180) * dt;
    s.facing += Math.max(-maxTurn, Math.min(maxTurn, diff));
    s.facing = Math.atan2(Math.sin(s.facing), Math.cos(s.facing));
  }
}
