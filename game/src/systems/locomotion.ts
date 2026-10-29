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
  /** 楼梯上的固定水平速度（m/s）：有值时代替慢走 / 小跑速度，sprint 不起作用（见 StairGait） */
  fixedSpeed?: number | null;
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
  const base = input.fixedSpeed != null ? input.fixedSpeed : input.sprint ? cfg.runSpeed : cfg.walkSpeed;
  const speed = base * len;
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

const stairCfg = cfg.stairs;

/**
 * 楼梯步态检测（002）：碰撞体是一级级的方块台阶，物理每迈一级会在单个固定步里竖直跳 0.19–0.2 m。
 * 最近 holdSec 内出现过这种跳变 ⇒ 在楼梯上；用 windowSec 内的竖直 / 水平位移估坡度，
 * 返回让竖直速度恒为 verticalSpeed 的水平速度（上下楼都一样，与是否按 Shift 无关）；不在楼梯上返回 null。
 */
export class StairGait {
  private samples: { t: number; dy: number; dist: number }[] = [];
  private time = 0;
  private lastStep = -Infinity;
  private distSinceStep = 0;
  /** 相邻两级之间实测的「级高 / 踏面」；没有就用滑动窗口估 */
  private treadSlope: number | null = null;
  private treads: number[] = [];
  private _speed: number | null = null;
  private _slope = 0;

  get speed(): number | null {
    return this._speed;
  }
  get slope(): number {
    return this._slope;
  }

  reset(): void {
    this.samples.length = 0;
    this.lastStep = -Infinity;
    this.distSinceStep = 0;
    this.treadSlope = null;
    this.treads.length = 0;
    this._speed = null;
  }

  /** 每个固定步调用：dy = 本步竖直位移，dist = 本步水平位移，onGround = 本步结束时是否着地 */
  update(dt: number, dy: number, dist: number, onGround: boolean): number | null {
    this.time += dt;
    if (!onGround) {
      this.reset();
      return null;
    }
    this.distSinceStep += dist;
    if (Math.abs(dy) >= stairCfg.stepMin && Math.abs(dy) <= cfg.stepHeight + cfg.groundSnap) {
      // 相邻两级：级高 / 两次迈步之间走过的水平距离 = 楼梯坡度（比滑动窗口稳，不会在两级之间忽快忽慢）
      if (this.time - this.lastStep <= stairCfg.holdSec * 2 && this.distSinceStep >= 0.1) {
        // 最近两级的平均（BUG-013：原来是指数平均 (旧 + 新) / 2，从小跑 / 平台进楼梯时第一级量得偏陡，要 4–5 级才收敛到 ±1%）
        const k = Math.abs(dy) / this.distSinceStep;
        this.treads.push(k);
        if (this.treads.length > 2) this.treads.shift();
        this.treadSlope = this.treads.reduce((a, b) => a + b, 0) / this.treads.length;
      }
      this.lastStep = this.time;
      this.distSinceStep = 0;
    }
    this.samples.push({ t: this.time, dy, dist });
    while (this.samples.length && this.samples[0]!.t < this.time - stairCfg.windowSec) this.samples.shift();
    if (this.time - this.lastStep > stairCfg.holdSec) {
      this.treadSlope = null;
      this.treads.length = 0;
      this._speed = null;
      return null;
    }
    let slope = this.treadSlope;
    if (slope == null) {
      let sy = 0;
      let sd = 0;
      for (const s of this.samples) {
        sy += s.dy;
        sd += s.dist;
      }
      slope = Math.abs(sy) / Math.max(sd, stairCfg.minRun);
    }
    this._slope = slope;
    this._speed = slope >= stairCfg.minSlope ? Math.min(cfg.walkSpeed, stairCfg.verticalSpeed / slope) : null;
    return this._speed;
  }
}
