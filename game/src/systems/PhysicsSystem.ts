import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { gameplay } from '@/config/gameplay';

/**
 * 角色物理（v0.1-002）：胶囊 vs 三角网格 BVH（three-mesh-bvh），自写 move-and-slide。
 *
 * 选型：只有一个角色、没有刚体玩法，Rapier 的 wasm（~2MB）和异步初始化都不划算；
 * three-mesh-bvh 只做空间查询（~40KB），碰撞规则全在这里，可在 Node 里直接单测（scripts/verify-physics.mjs）。
 *
 * 角色模型是「悬浮胶囊」：
 * - 碰撞胶囊的底部抬高 stepHeight（0.3 m），所以 ≤ 0.3 m 的台阶 / 小石头不会挡住水平移动；
 * - 脚底高度由向下的地面探测射线决定（中心 + 4 根 0.6r 偏移），探到可走的面（坡度 ≤ 40°）就贴上去，
 *   往上（迈台阶）最多 stepHeight，往下（下台阶 / 下坡）最多 groundSnap；
 * - 胶囊与墙 / 陡坡的接触只做水平推出（贴墙滑动，不会被陡坡「推上去」），朝下的接触（天花板）完整推出；
 * - 中心探到比当前高的陡坡（> 40°）时撤回这一步的水平位移，只保留沿坡脚方向的分量（走不上 45° 坡，但能沿着滑开）。
 *
 * 碰撞体来源：
 * - 美术模型里名字以 `-collider` / `-wall` 结尾的网格（可带 Blender 的 `.001` 后缀），见 addFromModel()：注册后隐藏；
 *   `-wall` 是空气墙（只挡水平移动，不能站上去）；自定义属性 dynamic = true（glTF extras → userData）表示会动；
 * - 灰盒代码直接 addMesh() / addBox()。
 * 静态碰撞体注册时烘焙到世界空间；dynamic 碰撞体（会动 / 会开关的门、升降台）保留局部几何，每步读 matrixWorld，
 * 站在上面的角色会被带着走。enabled = false 立即可通过。
 */

export type ColliderKind = 'collider' | 'wall';

export interface ColliderOptions {
  kind?: ColliderKind;
  blocksCamera?: boolean;
  /** 会移动 / 旋转的碰撞体（每个物理步读取 source.matrixWorld） */
  dynamic?: boolean;
  name?: string;
}

const COLLIDER_NAME = /-(collider|wall)(\.\d+)?$/i;

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

export class Collider {
  readonly name: string;
  readonly kind: ColliderKind;
  readonly blocksCamera: boolean;
  readonly dynamic: boolean;
  enabled = true;
  readonly bvh: MeshBVH;
  readonly geometry: THREE.BufferGeometry;
  /** 局部 → 世界（静态碰撞体为单位矩阵） */
  readonly matrix = new THREE.Matrix4();
  readonly inverse = new THREE.Matrix4();
  /** 本步相对上一步的世界变换增量（用于带着角色走） */
  readonly delta = new THREE.Matrix4();
  moved = false;
  /** 统一缩放系数（非等比缩放取最大轴，碰撞半径换算用） */
  scale = 1;
  readonly bounds = new THREE.Box3();
  readonly source: THREE.Object3D | null;
  private readonly localBounds = new THREE.Box3();
  private readonly prevMatrix = new THREE.Matrix4();

  constructor(geometry: THREE.BufferGeometry, source: THREE.Object3D | null, opts: ColliderOptions = {}) {
    this.kind = opts.kind ?? 'collider';
    this.blocksCamera = opts.blocksCamera ?? this.kind === 'collider';
    this.dynamic = opts.dynamic ?? false;
    this.name = opts.name ?? source?.name ?? 'collider';
    this.source = source;
    this.geometry = geometry;
    this.bvh = new MeshBVH(geometry);
    geometry.computeBoundingBox();
    this.localBounds.copy(geometry.boundingBox ?? new THREE.Box3());
    this.sync(true);
  }

  /** 读取 source 的世界矩阵；返回是否发生了移动 */
  sync(force = false): boolean {
    if (!this.dynamic && !force) return false;
    if (this.dynamic && this.source) {
      this.source.updateWorldMatrix(true, false);
      this.matrix.copy(this.source.matrixWorld);
    }
    this.moved = !force && !this.matrix.equals(this.prevMatrix);
    if (this.moved) this.delta.copy(this.prevMatrix).invert().premultiply(this.matrix);
    else this.delta.identity();
    this.prevMatrix.copy(this.matrix);
    this.inverse.copy(this.matrix).invert();
    const e = this.matrix.elements;
    this.scale = Math.max(
      Math.hypot(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0),
      Math.hypot(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0),
      Math.hypot(e[8] ?? 0, e[9] ?? 0, e[10] ?? 1),
    );
    this.bounds.copy(this.localBounds).applyMatrix4(this.matrix);
    return this.moved;
  }
}

/** 角色刚体状态（纯数据，组件 KinematicBody 持有一个） */
export class CharacterBody {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  /** 期望速度（水平分量由控制器写入；竖直分量由重力维护） */
  readonly velocity = new THREE.Vector3();
  /** 上一步的实际位移速度（含贴墙滑动、迈台阶，dev HUD 显示的速度） */
  readonly actualVelocity = new THREE.Vector3();
  readonly groundNormal = new THREE.Vector3(0, 1, 0);
  radius: number;
  height: number;
  enabled = true;
  useGravity = true;
  onGround = false;
  ground: Collider | null = null;
  justLanded = false;
  impactSpeed = 0;
  /** 本步因迈台阶 / 爬坡产生的竖直跳变（视觉平滑用） */
  stepUp = 0;
  /** 本步水平移动被墙 / 陡坡挡住的比例（0 = 畅通，1 = 完全挡住） */
  blocked = 0;

  constructor(radius: number = gameplay.player.radius, height: number = gameplay.player.height) {
    this.radius = radius;
    this.height = height;
  }

  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.prevPosition.copy(p);
    this.velocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.onGround = false;
    this.ground = null;
    this.stepUp = 0;
  }
}

export interface GroundHit {
  y: number;
  normal: THREE.Vector3;
  collider: Collider;
  walkable: boolean;
}

// ---- 复用的临时对象（物理每步零分配）
const segW = new THREE.Line3();
const segL = new THREE.Line3();
const triPt = new THREE.Vector3();
const segPt = new THREE.Vector3();
const dir = new THREE.Vector3();
const lipPt = new THREE.Vector3();
const lipNormal = new THREE.Vector3();
const push = new THREE.Vector3();
const before = new THREE.Vector3();
const capBox = new THREE.Box3();
const localBox = new THREE.Box3();
const m3 = new THREE.Matrix3();
const ray = new THREE.Ray();
const rayBox = new THREE.Box3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const start = new THREE.Vector3();
const moveH = new THREE.Vector3();
const normalM = new THREE.Matrix3();
const hitNormal = new THREE.Vector3();
const castP = new THREE.Vector3();
const castL = new THREE.Vector3();
const castBox = new THREE.Box3();
const castCands: Collider[] = [];
const closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const PROBE_LIFT = 0.002;
const PROBE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.6, 0],
  [-0.6, 0],
  [0, 0.6],
  [0, -0.6],
];

export class PhysicsSystem {
  readonly colliders: Collider[] = [];
  private bodies: CharacterBody[] = [];
  gravity: number = gameplay.player.gravity;
  maxFallSpeed: number = gameplay.player.maxFallSpeed;
  maxSlopeDeg: number = gameplay.player.maxSlopeDeg;
  stepHeight: number = gameplay.player.stepHeight;
  groundSnap: number = gameplay.player.groundSnap;
  /** 可直接迈过的陡面矮沿高度（BUG-007） */
  lipHeight = 0.06;
  /** 判矮沿时往前看多远找可走面 */
  lipLookahead = 0.12;
  /** 低于此高度视为掉出世界 */
  killY = -30;
  onFallOut?: (body: CharacterBody) => void;
  /** 上一步碰撞计算耗时（ms，dev 面板显示） */
  lastStepMs = 0;
  private cosSlope = Math.cos((gameplay.player.maxSlopeDeg * Math.PI) / 180);
  private hit: GroundHit = { y: 0, normal: new THREE.Vector3(), collider: null as unknown as Collider, walkable: false };

  addBody(body: CharacterBody): void {
    this.bodies.push(body);
  }

  removeBody(body: CharacterBody): void {
    this.bodies = this.bodies.filter((b) => b !== body);
  }

  /** 注册一个网格为碰撞体。静态碰撞体按当前世界矩阵烘焙。 */
  addMesh(mesh: THREE.Mesh, opts: ColliderOptions = {}): Collider {
    mesh.updateWorldMatrix(true, false);
    const geo = new THREE.BufferGeometry();
    const srcPos = mesh.geometry.getAttribute('position');
    geo.setAttribute('position', srcPos.clone());
    const index = mesh.geometry.getIndex();
    if (index) geo.setIndex(index.clone());
    if (!opts.dynamic) geo.applyMatrix4(mesh.matrixWorld);
    const c = new Collider(geo, mesh, { name: mesh.name, ...opts });
    this.colliders.push(c);
    return c;
  }

  /** 注册物体下所有网格（LOD 只取 LOD0），用于灰盒占位物体 */
  addObject(root: THREE.Object3D, opts: ColliderOptions = {}): Collider[] {
    root.updateWorldMatrix(true, true);
    const out: Collider[] = [];
    const visit = (o: THREE.Object3D): void => {
      if (o instanceof THREE.LOD) {
        const first = o.levels[0]?.object;
        if (first) visit(first);
        return;
      }
      if (isMesh(o)) out.push(this.addMesh(o, opts));
      for (const ch of o.children) visit(ch);
    };
    visit(root);
    return out;
  }

  /**
   * 美术模型约定：名字以 -collider / -wall 结尾的网格是碰撞体（注册后隐藏，不参与渲染）。
   * 返回注册的碰撞体；模型里没有约定命名的网格时返回空数组（调用方可回退为 addObject）。
   */
  addFromModel(root: THREE.Object3D, opts: Omit<ColliderOptions, 'kind'> = {}): Collider[] {
    root.updateWorldMatrix(true, true);
    const out: Collider[] = [];
    root.traverse((o) => {
      const m = COLLIDER_NAME.exec(o.name);
      if (!m || !isMesh(o)) return;
      const dynamic = opts.dynamic ?? o.userData.dynamic === true;
      out.push(this.addMesh(o, { ...opts, dynamic, kind: m[1]?.toLowerCase() === 'wall' ? 'wall' : 'collider' }));
      o.visible = false;
    });
    return out;
  }

  /** 世界空间的轴对齐盒子碰撞体（灰盒地面等） */
  addBox(box: THREE.Box3, opts: ColliderOptions = {}): Collider {
    const size = box.getSize(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const center = box.getCenter(new THREE.Vector3());
    geo.translate(center.x, center.y, center.z);
    const plain = new THREE.BufferGeometry();
    plain.setAttribute('position', geo.getAttribute('position'));
    plain.setIndex(geo.getIndex());
    const c = new Collider(plain, null, { name: 'box', ...opts, dynamic: false });
    this.colliders.push(c);
    return c;
  }

  removeCollider(c: Collider): void {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  clear(): void {
    this.colliders.length = 0;
    this.bodies = [];
  }

  step(dt: number): void {
    const t0 = performance.now();
    this.cosSlope = Math.cos((this.maxSlopeDeg * Math.PI) / 180);
    for (const c of this.colliders) if (c.dynamic) c.sync();
    for (const b of this.bodies) {
      if (!b.enabled) continue;
      this.stepBody(b, dt);
      if (b.position.y < this.killY) this.onFallOut?.(b);
    }
    this.lastStepMs = performance.now() - t0;
  }

  // ------------------------------------------------------------------ 查询（相机等）

  /**
   * 球形扫掠：半径 radius 的球从 origin 沿 dir（单位向量）移动，返回第一次碰到碰撞体时走过的距离；
   * 没碰到返回 maxDist；起点已经重叠返回 0。空气墙默认不参与，可用 blocksCamera 显式启用。
   * 实现为 sphere tracing（每步前进「到最近表面的距离 - 半径」），精确且不会漏掉薄墙。
   */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number): number {
    castBox.makeEmpty().expandByPoint(origin);
    castP.copy(origin).addScaledVector(dir, maxDist);
    castBox.expandByPoint(castP).expandByScalar(radius + 0.01);
    castCands.length = 0;
    for (const c of this.colliders) if (c.enabled && c.blocksCamera && c.bounds.intersectsBox(castBox)) castCands.push(c);
    if (castCands.length === 0) return maxDist;
    let t = 0;
    for (let i = 0; i < 48; i++) {
      castP.copy(origin).addScaledVector(dir, t);
      const d = this.distanceToSurface(castP, castCands, maxDist - t + radius + 0.01) - radius;
      if (d < 1e-3) return Math.max(0, t);
      t += d;
      if (t >= maxDist) return maxDist;
    }
    return t;
  }

  /** 射线检测（kind = 'collider'），返回命中距离；没命中返回 null */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, target?: THREE.Object3D): number | null {
    let best: number | null = null;
    castP.copy(origin).addScaledVector(dir, far);
    castBox.makeEmpty().expandByPoint(origin).expandByPoint(castP);
    for (const c of this.colliders) {
      if (!c.enabled || c.kind !== 'collider' || !c.bounds.intersectsBox(castBox)) continue;
      if (target) {
        let source = c.source;
        while (source && source !== target) source = source.parent;
        if (source) continue;
      }
      tmpA.copy(origin).applyMatrix4(c.inverse);
      tmpB.copy(dir).transformDirection(c.inverse);
      ray.set(tmpA, tmpB);
      const h = c.bvh.raycastFirst(ray, THREE.DoubleSide, 0, far / c.scale);
      if (!h) continue;
      const d = h.distance * c.scale;
      if (best === null || d < best) best = d;
    }
    return best;
  }

  private distanceToSurface(p: THREE.Vector3, list: Collider[], maxDist: number): number {
    let best = maxDist;
    for (const c of list) {
      castL.copy(p).applyMatrix4(c.inverse);
      const hit = c.bvh.closestPointToPoint(castL, closest, 0, best / c.scale);
      if (hit) best = Math.min(best, hit.distance * c.scale);
    }
    return best;
  }

  // ------------------------------------------------------------------ 单个角色

  private stepBody(b: CharacterBody, dt: number): void {
    const p = b.position;
    b.prevPosition.copy(p);
    b.justLanded = false;
    b.stepUp = 0;
    const wasGround = b.onGround;

    // 站在移动平台上：跟着平台走（只取平移与绕 Y 旋转造成的位移）
    if (wasGround && b.ground?.dynamic && b.ground.moved && b.ground.enabled) {
      p.applyMatrix4(b.ground.delta);
    }
    start.copy(p);

    // ---- 水平：分段移动 + 胶囊推出（贴墙滑动）
    moveH.set(b.velocity.x * dt, 0, b.velocity.z * dt);
    const len = moveH.length();
    this.moveHorizontal(b, moveH);

    // ---- 陡坡：中心探到比脚高的陡坡 → 撤回，改为沿坡脚滑
    if (len > 1e-6 && this.probe(b, p, this.stepHeight, 0.05, true) && !this.hit.walkable && this.hit.y > start.y + 0.02 && !this.isLip(b, start, moveH, len)) {
      const n = this.hit.normal;
      const hl = Math.hypot(n.x, n.z);
      p.copy(start);
      if (hl > 1e-4) {
        // 去掉朝坡里的分量
        const nx = -n.x / hl;
        const nz = -n.z / hl;
        const into = moveH.x * nx + moveH.z * nz;
        if (into > 0) moveH.set(moveH.x - nx * into, 0, moveH.z - nz * into);
        this.moveHorizontal(b, moveH);
        if (this.probe(b, p, this.stepHeight, 0.05, true) && !this.hit.walkable && this.hit.y > start.y + 0.02) {
          p.copy(start);
        }
      }
    }
    const moved = Math.hypot(p.x - start.x, p.z - start.z);
    b.blocked = len > 1e-6 ? THREE.MathUtils.clamp(1 - moved / len, 0, 1) : 0;

    // ---- 竖直：贴地 / 下落
    if (!b.useGravity) {
      b.velocity.y = 0;
    } else if (wasGround) {
      b.velocity.y = 0;
      if (this.probe(b, p, this.stepHeight, this.groundSnap, false)) {
        const dy = this.hit.y - p.y;
        if (dy > 0.005) b.stepUp = dy;
        p.y = this.hit.y;
        this.setGround(b, true);
      } else {
        this.setGround(b, false);
      }
    } else {
      const vy = Math.max(b.velocity.y - this.gravity * dt, -this.maxFallSpeed);
      b.velocity.y = vy;
      const dy = vy * dt;
      // 下落中也允许落到略高于脚底的面上（落地瞬间穿进去一点）
      if (dy <= 0 && this.probe(b, p, 0.05, -dy + 0.01, false)) {
        b.impactSpeed = -vy;
        b.justLanded = true;
        p.y = this.hit.y;
        b.velocity.y = 0;
        this.setGround(b, true);
      } else {
        p.y += dy;
        this.setGround(b, false);
      }
    }
    // 最终再解一次穿插（天花板、移动平台挤压）
    this.resolve(b, p);
    if (dt > 0) b.actualVelocity.subVectors(p, b.prevPosition).divideScalar(dt);
  }

  /**
   * BUG-007：中心射线打到的陡面只是一道矮沿（如斜板端面比岸台高出几厘米），
   * 而它前方紧接着是可走面、且高出量 ≤ lipHeight → 当台阶迈过去，不当陡坡撤回。
   * 真正的陡坡前方仍是陡面，照旧撤回。调用前 this.hit 是陡面命中；返回 false 时恢复它。
   */
  private isLip(b: CharacterBody, start: THREE.Vector3, moveH: THREE.Vector3, len: number): boolean {
    const rise = this.hit.y - start.y;
    if (rise > this.lipHeight) return false;
    const savedY = this.hit.y;
    lipNormal.copy(this.hit.normal);
    const savedCollider = this.hit.collider;
    const k = this.lipLookahead / len;
    lipPt.set(b.position.x + moveH.x * k, b.position.y, b.position.z + moveH.z * k);
    const ok = this.probe(b, lipPt, this.stepHeight, 0.05, true) && this.hit.walkable && this.hit.y - start.y <= this.lipHeight;
    if (!ok) {
      this.hit.y = savedY;
      this.hit.normal.copy(lipNormal);
      this.hit.collider = savedCollider;
      this.hit.walkable = false;
    }
    return ok;
  }

  private setGround(b: CharacterBody, on: boolean): void {
    b.onGround = on;
    if (on) {
      b.groundNormal.copy(this.hit.normal);
      b.ground = this.hit.collider;
    } else {
      b.groundNormal.set(0, 1, 0);
      b.ground = null;
    }
  }

  private moveHorizontal(b: CharacterBody, d: THREE.Vector3): void {
    const len = d.length();
    const n = Math.max(1, Math.ceil(len / (b.radius * 0.5)));
    for (let i = 0; i < n; i++) {
      b.position.x += d.x / n;
      b.position.z += d.z / n;
      this.resolve(b, b.position);
    }
  }

  /** 胶囊（底部抬高 stepHeight）与所有碰撞体的穿插推出 */
  private resolve(b: CharacterBody, p: THREE.Vector3): void {
    const r = b.radius;
    const bottom = Math.min(this.stepHeight, Math.max(0, b.height - 2 * r - 0.05));
    for (let iter = 0; iter < 4; iter++) {
      let any = false;
      capBox.min.set(p.x - r, p.y + bottom, p.z - r);
      capBox.max.set(p.x + r, p.y + b.height, p.z + r);
      for (const c of this.colliders) {
        if (!c.enabled || !c.bounds.intersectsBox(capBox)) continue;
        segW.start.set(p.x, p.y + bottom + r, p.z);
        segW.end.set(p.x, p.y + b.height - r, p.z);
        segL.copy(segW).applyMatrix4(c.inverse);
        const lr = r / c.scale;
        localBox.makeEmpty().expandByPoint(segL.start).expandByPoint(segL.end).expandByScalar(lr);
        before.copy(segL.start);
        m3.setFromMatrix4(c.inverse);
        normalM.setFromMatrix4(c.matrix);
        let touched = false;
        c.bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(localBox),
          intersectsTriangle: (tri) => {
            const d = tri.closestPointToSegment(segL, triPt, segPt);
            if (d >= lr - 1e-5) return false;
            if (d > 1e-6) dir.subVectors(segPt, triPt);
            else tri.getNormal(dir);
            dir.applyMatrix3(normalM).normalize();
            const depth = (lr - d) * c.scale;
            if (c.kind === 'collider' && dir.y >= this.cosSlope) {
              push.set(0, depth / dir.y, 0);
            } else if (dir.y > -0.3 || c.kind === 'wall') {
              const hl = Math.hypot(dir.x, dir.z);
              if (hl < 1e-4) return false;
              const k = depth / hl / hl;
              push.set(dir.x * k, 0, dir.z * k);
            } else {
              push.copy(dir).multiplyScalar(depth);
            }
            push.applyMatrix3(m3);
            segL.start.add(push);
            segL.end.add(push);
            touched = true;
            return false;
          },
        });
        if (touched) {
          tmpA.subVectors(segL.start, before).applyMatrix3(normalM.setFromMatrix4(c.matrix));
          p.add(tmpA);
          capBox.translate(tmpA);
          any = true;
        }
      }
      if (!any) break;
    }
  }

  /**
   * 向下探测地面：从脚底上方 up 处向下到脚底下方 down 处。
   * centerOnly = true 时只用中心射线（陡坡判定）；否则取 5 根射线里最高的可走面。
   * 命中结果写在 this.hit。
   */
  private probe(b: CharacterBody, p: THREE.Vector3, up: number, down: number, centerOnly: boolean): boolean {
    const r = b.radius;
    let best = -Infinity;
    let found = false;
    // 射线起点略高于 up：正好高出 up 的台面（如搁浅浮台 0.1 → 0.4）起点不落在面上、照样能迈上去
    const total = up + down + PROBE_LIFT;
    const count = centerOnly ? 1 : PROBE_OFFSETS.length;
    for (let i = 0; i < count; i++) {
      const off = PROBE_OFFSETS[i];
      if (!off) continue;
      const ox = p.x + off[0] * r;
      const oz = p.z + off[1] * r;
      const top = p.y + up + PROBE_LIFT;
      rayBox.min.set(ox - 1e-3, top - total, oz - 1e-3);
      rayBox.max.set(ox + 1e-3, top, oz + 1e-3);
      for (const c of this.colliders) {
        if (!c.enabled || c.kind === 'wall' || !c.bounds.intersectsBox(rayBox)) continue;
        tmpA.set(ox, top, oz).applyMatrix4(c.inverse);
        tmpB.set(0, -1, 0).transformDirection(c.inverse);
        ray.set(tmpA, tmpB);
        // 局部空间的远裁剪距离 = 世界距离 / 缩放（等比缩放下精确）
        const far = total / c.scale;
        const h = c.bvh.raycastFirst(ray, THREE.DoubleSide, 0, far);
        if (!h || !h.face) continue;
        const y = top - h.distance * c.scale;
        if (y <= best) continue;
        normalM.getNormalMatrix(c.matrix);
        hitNormal.copy(h.face.normal).applyMatrix3(normalM).normalize();
        if (hitNormal.y < 0) hitNormal.negate();
        const walkable = hitNormal.y >= this.cosSlope;
        // 多射线模式只接受可走面；中心射线模式两者都记录（陡坡判定）
        if (!centerOnly && !walkable) continue;
        best = y;
        found = true;
        this.hit.y = y;
        this.hit.normal.copy(hitNormal);
        this.hit.collider = c;
        this.hit.walkable = walkable;
      }
    }
    return found;
  }
}
